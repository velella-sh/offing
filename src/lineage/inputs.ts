import { lstat, readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { LineCounter, isMap, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";

import { parseCompose, type ComposeDeclaration } from "../detectors/container/parse-compose.js";
import { parseDevcontainer, type DevcontainerDeclaration } from "../detectors/container/parse-devcontainer.js";
import {
  parseDockerfileBuild,
  type DockerfileDeclaration,
  type DockerfileStage,
} from "../detectors/container/parse-dockerfile.js";
import { parseImageReference } from "../detectors/container/parse-image.js";
import { childPosixPath } from "../paths.js";
import { DETECTOR_LIMITS } from "../sdk.js";

const MAXIMUM_DEPTH = 8;
const MAXIMUM_FILES = 2000;
const MAXIMUM_WORKFLOWS = 200;
const MAXIMUM_BUILDS = 2_000;
const MAXIMUM_TAGS_PER_STEP = 128;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "fixtures",
  "__fixtures__",
  "testdata",
]);

const DOCKERFILE = /^(?:Dockerfile|Containerfile)|\.(?:Dockerfile|Containerfile)$/;
const COMPOSE = /^(?:docker-)?compose(?:\.[A-Za-z0-9_.-]+)?\.ya?ml$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const DEVCONTAINER = "devcontainer.json";

export interface LineageDocument {
  path: string;
  kind: "dockerfile" | "compose" | "devcontainer";
  stages: DockerfileStage[];
  declarations: Array<DockerfileDeclaration | ComposeDeclaration | DevcontainerDeclaration>;
}

export interface ImageBuild {
  reference: string;
  path: string;
  stage: number;
  evidence: { path: string; line: number; source?: string };
}

export interface LineageInputs {
  documents: LineageDocument[];
  builds: ImageBuild[];
  repository?: { name: string; host: string; commit: string };
}

interface Files {
  documents: string[];
  workflows: string[];
}

async function findFiles(root: string): Promise<Files> {
  const documents: string[] = [];
  const workflows: string[] = [];
  async function walk(prefix: string, depth: number): Promise<void> {
    if (depth > MAXIMUM_DEPTH || documents.length >= MAXIMUM_FILES) return;
    const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      if (documents.length >= MAXIMUM_FILES) break;
      const path = childPosixPath(prefix, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        await walk(path, depth + 1);
      } else if (entry.isFile() && WORKFLOW.test(path) && workflows.length < MAXIMUM_WORKFLOWS) {
        workflows.push(path);
      } else if (
        entry.isFile() &&
        (DOCKERFILE.test(entry.name) || COMPOSE.test(entry.name) || entry.name === DEVCONTAINER)
      ) {
        documents.push(path);
      }
    }
  }
  await walk("", 0);
  return { documents, workflows };
}

async function readBounded(root: string, path: string): Promise<string | undefined> {
  const file = join(root, path);
  try {
    const stat = await lstat(file);
    if (stat.isFile() && stat.size <= DETECTOR_LIMITS.maximumFileBytes) return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

function readDocument(path: string, contents: string): LineageDocument {
  const name = posix.basename(path);
  if (COMPOSE.test(name)) return { kind: "compose", path, stages: [], declarations: parseCompose(contents) };
  if (name === DEVCONTAINER)
    return { kind: "devcontainer", path, stages: [], declarations: parseDevcontainer(contents) };
  return { kind: "dockerfile", path, ...parseDockerfileBuild(contents) };
}

function stringValue(map: YAMLMap, key: string): string | undefined {
  const value = map.get(key, true);
  return isScalar(value) && typeof value.value === "string" ? value.value : undefined;
}

function repositoryPath(value: string): string | undefined {
  if (!/^[a-zA-Z0-9_./@+-]+$/.test(value) || value.startsWith("/") || value.split("/").includes("..")) return undefined;
  return posix.normalize(value);
}

function buildFile(inputs: YAMLMap): string | undefined {
  const context = stringValue(inputs, "context") ?? (inputs.has("context") ? "" : ".");
  const literalContext = repositoryPath(context);
  if (literalContext === undefined && context !== "{{defaultContext}}") return undefined;
  const file = stringValue(inputs, "file");
  return file === undefined && !inputs.has("file")
    ? posix.join(literalContext ?? ".", "Dockerfile")
    : repositoryPath(file ?? "");
}

function sourceLabel(values: string[]): { source?: string } | undefined {
  if (values.length === 0) return {};
  try {
    const sources = new Set(
      values.map((value) => {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new TypeError();
        return `${url.origin}${url.pathname.replace(/\/?$/, "").replace(/\.git$/, "")}`;
      }),
    );
    const [source] = sources;
    return sources.size === 1 && source !== undefined ? { source } : undefined;
  } catch {
    return undefined;
  }
}

function buildStage(inputs: YAMLMap, document: LineageDocument): number {
  const target = stringValue(inputs, "target");
  return target === undefined && !inputs.has("target")
    ? document.stages.length - 1
    : document.stages.findIndex(({ name }) => name.toLowerCase() === target?.toLowerCase());
}

function buildsFromStep(
  step: YAMLMap,
  workflow: string,
  lines: LineCounter,
  documents: ReadonlyMap<string, LineageDocument>,
): ImageBuild[] {
  if (!/^docker\/build-push-action@[^\s$]+$/.test(stringValue(step, "uses") ?? "")) return [];
  const inputs = step.get("with", true);
  if (!isMap(inputs) || inputs.has("build-args") || inputs.has("build-contexts")) return [];
  const tags = inputs.get("tags", true);
  if (!isScalar(tags) || typeof tags.value !== "string" || !tags.range) return [];
  const path = buildFile(inputs);
  const document = path === undefined ? undefined : documents.get(path);
  if (!document || document.stages.length === 0) return [];
  const stage = buildStage(inputs, document);
  const selected = document.stages[stage];
  if (!selected) return [];
  const labels = (stringValue(inputs, "labels") ?? "")
    .split(/\r?\n/)
    .flatMap((label) => (label.trim().startsWith("org.opencontainers.image.source=") ? [label.trim().slice(32)] : []));
  const source = sourceLabel([...selected.sourceLabels, ...labels]);
  if (!source) return [];
  const line = lines.linePos(tags.range[0]).line;
  return tags.value
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, MAXIMUM_TAGS_PER_STEP)
    .flatMap((reference) => {
      const image = parseImageReference(reference);
      return image?.tag && !image.digest
        ? [{ reference, path: document.path, stage, evidence: { path: workflow, line, ...source } }]
        : [];
    });
}

function readBuilds(contents: string, workflow: string, documents: ReadonlyMap<string, LineageDocument>): ImageBuild[] {
  const lines = new LineCounter();
  try {
    const document = parseDocument(contents, { lineCounter: lines, merge: false });
    if (document.errors.length || !isMap(document.contents)) return [];
    const jobs = document.contents.get("jobs", true);
    if (!isMap(jobs)) return [];
    return jobs.items.flatMap(({ value }) => {
      const steps = isMap(value) ? value.get("steps", true) : undefined;
      if (!isSeq(steps)) return [];
      return steps.items.flatMap((step) => (isMap(step) ? buildsFromStep(step, workflow, lines, documents) : []));
    });
  } catch {
    return [];
  }
}

export async function readLineageInputs(root: string): Promise<LineageInputs> {
  const files = await findFiles(root);
  const documents = new Map<string, LineageDocument>();
  for (const path of files.documents) {
    const contents = await readBounded(root, path);
    if (contents !== undefined) documents.set(path, readDocument(path, contents));
  }
  const builds: ImageBuild[] = [];
  if (documents.size > 0) {
    for (const path of files.workflows) {
      if (builds.length >= MAXIMUM_BUILDS) break;
      const contents = await readBounded(root, path);
      if (contents !== undefined)
        builds.push(...readBuilds(contents, path, documents).slice(0, MAXIMUM_BUILDS - builds.length));
    }
  }
  return { documents: [...documents.values()], builds };
}
