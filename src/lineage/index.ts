import type { RegistryV2Rule } from "@velella/ebb/registry";

import {
  imageLifecycle,
  lacksBaseOsData,
  loadImageRules,
  type ImageRules,
} from "../detectors/container/image-lifecycle.js";
import { isInterpolated, parseImageReference, type ImageReference } from "../detectors/container/parse-image.js";
import { readLineageInputs, type ImageBuild, type LineageDocument, type LineageInputs } from "./inputs.js";

export interface LineageLink {
  reference: string;
  resolvedReference?: string;
  path: string;
  line: number;
  stage: string | null;
  repository?: string;
  digest?: string;
  parents: number[];
  relationship: "from" | "copy" | "image" | "os";
  status: RegistryV2Rule["event"] | "unknown" | "no-data" | "not-applicable";
  ruleId?: string;
  deadline?: string;
  reason?: string;
  baseOs?: "no-data";
  matchingTags?: readonly string[];
  tagLookupIncomplete?: true;
  producer?: ImageBuild["evidence"] & { path: string; repository?: string; commit?: string };
}

export interface ImageChain {
  image: string;
  path: string;
  line: number;
  stage: string | null;
  repository?: string;
  links: LineageLink[];
  truncated?: true;
}

export interface DigestTags {
  tags: readonly string[];
  complete: boolean;
}

export interface ImageLineage {
  schemaVersion: "offing.lineage.v1";
  chains: ImageChain[];
}

interface BuildTarget {
  inputs: LineageInputs;
  document: LineageDocument;
  index: number;
  build?: ImageBuild;
}

interface GraphContext {
  rules: ImageRules;
  producers: Map<string, BuildTarget[]>;
  targets: Map<string, BuildTarget[]>;
  digestTags: ReadonlyMap<string, DigestTags>;
}

type LinkOrigin = Pick<LineageLink, "reference" | "path" | "line" | "stage" | "relationship" | "repository">;

const MAXIMUM_LINKS = 128;

function nameWithTag(image: ImageReference): string {
  return `${image.registry}/${image.repository}:${image.tag ?? "latest"}`;
}

export function digestKey(image: ImageReference): string {
  return `${image.registry}/${image.repository}@${image.digest}`;
}

function documentKey(inputs: LineageInputs, doc: LineageDocument): string {
  return JSON.stringify([inputs.repository?.host, inputs.repository?.name, doc.path]);
}

function targetKey({ inputs, document, index }: BuildTarget): string {
  return `${documentKey(inputs, document)}:${index}`;
}

function publishedTargets(inputs: LineageInputs): BuildTarget[] {
  const documents = new Map(inputs.documents.map((doc) => [doc.path, doc]));
  return inputs.builds.flatMap((build) => {
    const document = documents.get(build.path);
    if (!document) return [];
    const repository = inputs.repository;
    if (build.evidence.source && repository && build.evidence.source !== `${repository.host}/${repository.name}`)
      return [];
    return [{ inputs, document, index: build.stage, build }];
  });
}

function repositoryOf(inputs: LineageInputs): { repository?: string } {
  return inputs.repository ? { repository: inputs.repository.name } : {};
}

function producerFor(producers: ReadonlyMap<string, BuildTarget[]>, image: ImageReference): BuildTarget | undefined {
  if (image.tag === undefined || image.tag === "latest") return undefined;
  const matches = producers.get(nameWithTag(image)) ?? [];
  const [first] = matches;
  return first && matches.every((entry) => targetKey(entry) === targetKey(first)) ? first : undefined;
}

function indexTarget(context: GraphContext, target: BuildTarget): void {
  const image = parseImageReference(target.build?.reference ?? "");
  if (!image) return;
  for (const [map, key] of [
    [context.producers, nameWithTag(image)],
    [context.targets, documentKey(target.inputs, target.document)],
  ] as const) {
    const entries = map.get(key);
    if (entries) entries.push(target);
    else map.set(key, [target]);
  }
}

function classify(
  image: ImageReference,
  context: GraphContext,
): Pick<LineageLink, "status" | "ruleId" | "deadline" | "reason"> {
  const { rule, reason } = imageLifecycle(image, context.rules);
  if (rule) return { status: rule.event, ruleId: rule.id, ...(rule.deadline ? { deadline: rule.deadline } : {}) };
  if (reason) return { status: "unknown", reason };
  if (image.tag === undefined || image.tag === "latest") {
    return { status: "unknown", reason: "The image does not name a release tag." };
  }
  return { status: "no-data", reason: "No reviewed lifecycle rule covers this release line." };
}

function classifyUnresolved(value: string): Pick<LineageLink, "status" | "reason"> {
  return {
    status: "unknown",
    reason: isInterpolated(value)
      ? "A build argument or variable has no usable literal default."
      : "The reference does not name a recognized image.",
  };
}

function digestLink(
  link: LineageLink,
  image: ImageReference,
  context: GraphContext,
): { link: LineageLink; image?: ImageReference } {
  const found = context.digestTags.get(digestKey(image));
  const tags = found?.tags ?? [];
  const [tag] = tags;
  if (found?.complete && tags.length === 1 && tag !== undefined) {
    const resolved = { ...image, tag };
    return { image: resolved, link: { ...link, ...classify(resolved, context), matchingTags: tags } };
  }
  return {
    link: {
      ...link,
      reason: "Add the release tag next to the digest to identify the release line.",
      ...(found && !found.complete ? { tagLookupIncomplete: true } : {}),
      ...(tags.length > 0 ? { matchingTags: tags } : {}),
    },
  };
}

function imageLink(
  origin: LinkOrigin,
  value: string,
  context: GraphContext,
): { link: LineageLink; image?: ImageReference } {
  const base = { ...origin, ...(origin.reference === value ? {} : { resolvedReference: value }), parents: [] };
  const image = parseImageReference(value);
  if (!image) return { link: { ...base, ...classifyUnresolved(value) } };
  const digest = image.digest === undefined ? {} : { digest: image.digest };
  if (image.digest && !image.tag) return digestLink({ ...base, ...digest, status: "unknown" }, image, context);
  return { image, link: { ...base, ...digest, ...classify(image, context) } };
}

class ChainBuilder {
  private readonly stages = new Map<string, number>();
  private readonly ancestors = new Set<string>();
  readonly links: LineageLink[] = [];
  truncated = false;

  constructor(private readonly context: GraphContext) {}

  private append(link: LineageLink, parent?: number): number | undefined {
    if (this.links.length >= MAXIMUM_LINKS) {
      this.truncated = true;
      return undefined;
    }
    if (parent !== undefined) link.parents.push(parent);
    return this.links.push(link) - 1;
  }

  image(origin: LinkOrigin, value: string, parent?: number): void {
    const { image, link } = imageLink(origin, value, this.context);
    const producer = image && producerFor(this.context.producers, image);
    if (image && !producer && lacksBaseOsData(image)) link.baseOs = "no-data";
    const index = this.append(link, parent);
    if (index === undefined) return;
    if (producer?.build) {
      link.producer = {
        ...producer.build.evidence,
        ...repositoryOf(producer.inputs),
        ...(producer.inputs.repository ? { commit: producer.inputs.repository.commit } : {}),
      };
      this.stage(producer, index);
    }
  }

  private alias(origin: LinkOrigin, parent?: number): number | undefined {
    return this.append({ ...origin, parents: [], status: "not-applicable" }, parent);
  }

  private copy(target: BuildTarget, copy: { reference: string; line: number; stage?: number }, parent: number): void {
    const origin: LinkOrigin = {
      reference: copy.reference,
      path: target.document.path,
      line: copy.line,
      stage: target.document.stages[target.index]?.name ?? null,
      relationship: "copy",
      ...repositoryOf(target.inputs),
    };
    if (copy.stage === undefined) this.image(origin, copy.reference, parent);
    else {
      const index = this.alias(origin, parent);
      if (index !== undefined) this.stage({ ...target, index: copy.stage }, index);
    }
  }

  stage(target: BuildTarget, parent?: number): void {
    const { document, index } = target;
    const stage = document.stages[index];
    if (!stage) return;
    const key = targetKey(target);
    const existing = this.stages.get(key);
    if (existing !== undefined && parent !== undefined) {
      if (this.ancestors.has(key)) this.truncated = true;
      else this.links[existing]?.parents.push(parent);
      return;
    }
    const origin: LinkOrigin = {
      reference: stage.reference,
      path: document.path,
      line: stage.line,
      stage: stage.name,
      relationship: "from",
      ...repositoryOf(target.inputs),
    };
    const next = this.links.length;
    if (next >= MAXIMUM_LINKS) {
      this.truncated = true;
      return;
    }
    this.ancestors.add(key);
    this.stages.set(key, next);
    if (stage.parent === undefined && stage.resolved.toLowerCase() !== "scratch")
      this.image(origin, stage.resolved, parent);
    else this.alias(origin, parent);
    if (this.links.length > next) {
      if (stage.parent !== undefined) this.stage({ ...target, index: stage.parent }, next);
      for (const copy of stage.copies) {
        if (this.truncated && this.links.length >= MAXIMUM_LINKS) break;
        this.copy(target, copy, next);
      }
    }
    this.ancestors.delete(key);
  }
}

/** A prefix remains valid if the MCP cap stops before the remaining links. */
function inDependencyOrder(links: LineageLink[]): LineageLink[] {
  const ordered: LineageLink[] = [];
  const indices = new Map<number, number>();
  function emit(index: number): number {
    const existing = indices.get(index);
    if (existing !== undefined) return existing;
    const link = links[index];
    if (!link) throw new Error("Invalid image lineage edge.");
    const parents = [...new Set(link.parents)].map(emit).sort((a, b) => a - b);
    const next = ordered.push({ ...link, parents }) - 1;
    indices.set(index, next);
    return next;
  }
  links.forEach((_, index) => emit(index));
  return ordered;
}

function describeChain(builder: ChainBuilder, origin: Omit<ImageChain, "links" | "truncated">): ImageChain {
  return { ...origin, links: inDependencyOrder(builder.links), ...(builder.truncated ? { truncated: true } : {}) };
}

function stageChain(target: BuildTarget, stage: LineageDocument["stages"][number], context: GraphContext): ImageChain {
  const builder = new ChainBuilder(context);
  builder.stage(target);
  return describeChain(builder, {
    image: target.build?.reference ?? `${target.document.path}:${stage.name}`,
    path: target.document.path,
    line: stage.line,
    stage: stage.name,
    ...repositoryOf(target.inputs),
  });
}

function documentChains(inputs: LineageInputs, document: LineageDocument, context: GraphContext): ImageChain[] {
  if (document.kind !== "dockerfile") {
    return document.declarations.flatMap((declaration) => {
      if (declaration.kind !== "image" && declaration.kind !== "dynamic") return [];
      const builder = new ChainBuilder(context);
      const origin = { path: document.path, line: declaration.line, stage: null, ...repositoryOf(inputs) };
      builder.image({ ...origin, reference: declaration.value, relationship: "image" }, declaration.value);
      return [describeChain(builder, { ...origin, image: declaration.value })];
    });
  }
  const last = document.stages.length - 1;
  const targets = context.targets.get(documentKey(inputs, document)) ?? [];
  const selected = targets.some(({ index }) => index === last)
    ? targets
    : [...targets, { inputs, document, index: last }];
  return selected.flatMap((target) => {
    const stage = document.stages[target.index];
    return stage ? [stageChain(target, stage, context)] : [];
  });
}

export function buildImageLineage(
  repositories: readonly LineageInputs[],
  rules: ImageRules,
  digestTags: ReadonlyMap<string, DigestTags> = new Map(),
): ImageLineage {
  const context = {
    rules,
    producers: new Map<string, BuildTarget[]>(),
    targets: new Map<string, BuildTarget[]>(),
    digestTags,
  };
  for (const inputs of repositories) {
    for (const target of publishedTargets(inputs)) indexTarget(context, target);
  }
  return {
    schemaVersion: "offing.lineage.v1",
    chains: repositories.flatMap((inputs) => inputs.documents.flatMap((doc) => documentChains(inputs, doc, context))),
  };
}

export async function repositoryLineage(path: string): Promise<ImageLineage> {
  const [inputs, rules] = await Promise.all([readLineageInputs(path), loadImageRules()]);
  return buildImageLineage([inputs], rules);
}
