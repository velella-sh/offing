import { loadDataFile } from "@velella/ebb/data-source";
import type { UnclassifiedReference } from "../../domain.js";
import { validateRegistryV2 } from "@velella/ebb/registry";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { DETECTOR_API_VERSION } from "../../sdk.js";
import type { Detector, DetectorAnalysis, DetectorContext, DetectorFinding, DetectorInputs } from "../../sdk.js";
import { versContains } from "@velella/ebb/vers";
import { jdkRuleVersion, parseJdkVersion } from "../java/jdk-version.js";
import type { Runtime } from "./parse-dockerfile.js";
import { parseImageReference } from "./parse-image.js";
import { findRootfsSnapshots } from "./rootfs.js";
import { required } from "../../required.js";
import { distroCodenameVersion, imageLifecycle, loadImageRules, rulesFor } from "./image-lifecycle.js";
import type { ImageRules } from "./image-lifecycle.js";
import { readLineageInputs, type LineageDocument, type LineageInputs } from "../../lineage/inputs.js";
import type { RootfsOsRelease, RootfsSnapshot } from "./rootfs.js";

/**
 * Finds base images and Dockerfile runtime install commands whose release line has reached end of life,
 * the deprecated Dockerfile `MAINTAINER` instruction and legacy `ENV key value` form,
 * plus the OS and runtimes that ship inside a built image's filesystem.
 *
 * It reads Dockerfile / Containerfile `FROM`, supported `RUN`, and legacy syntax lines plus Compose
 * `services.*.image` values. A version is classified only when every version it can stand for is
 * inside a rule's range, so a floating image tag such as `mysql:8` is not guessed. When the scanned
 * directory is an unpacked root filesystem, or holds a local root filesystem archive, the same
 * reviewed rules judge `os-release` and well-known runtime paths.
 */

const MAINTAINER_RULE = "container.dockerfile.maintainer";
const LEGACY_ENV_RULE = "container.dockerfile.legacy-env-format";

const UNBOUNDED = 999_999;

interface ImageCandidate {
  kind: "image";
  path: string;
  line: number;
  value: string;
  dynamic: boolean;
}

interface RuntimeCandidate {
  kind: "runtime";
  path: string;
  line: number;
  value: string;
  runtime: Runtime;
}

interface MaintainerCandidate {
  kind: "maintainer";
  path: string;
  line: number;
}

interface LegacyEnvCandidate {
  kind: "legacy-env";
  path: string;
  line: number;
  key: string;
}

type Candidate = ImageCandidate | RuntimeCandidate | MaintainerCandidate | LegacyEnvCandidate;

function candidates({ path, declarations }: LineageDocument): Candidate[] {
  return declarations.map((declaration): Candidate => {
    const { line } = declaration;
    if (declaration.kind === "runtime") {
      return { kind: "runtime", path, line, value: declaration.value, runtime: declaration.runtime };
    }
    if (declaration.kind === "image" || declaration.kind === "dynamic") {
      return { kind: "image", path, line, value: declaration.value, dynamic: declaration.kind === "dynamic" };
    }
    if (declaration.kind === "maintainer") return { kind: "maintainer", path, line };
    return { kind: "legacy-env", path, line, key: declaration.key };
  });
}

const RUNTIME_RULES: Readonly<Record<Runtime, { file: string; purl: string; prefix: string }>> = {
  dotnet: { file: "registry/dotnet.json", purl: "pkg:generic/dotnet", prefix: "dotnet.runtime." },
  golang: { file: "registry/go.json", purl: "pkg:generic/golang", prefix: "go.runtime." },
  java: { file: "registry/java.json", purl: "pkg:generic/java", prefix: "java.jdk." },
  nodejs: { file: "registry/nodejs.json", purl: "pkg:generic/nodejs", prefix: "nodejs.runtime." },
  php: { file: "registry/php.json", purl: "pkg:generic/php", prefix: "php.runtime." },
  python: { file: "registry/python.json", purl: "pkg:generic/python", prefix: "python.runtime." },
  ruby: { file: "registry/ruby.json", purl: "pkg:generic/ruby", prefix: "ruby.runtime." },
};

function versionBounds(runtime: Runtime, value: string): { lowest: string; highest: string } | undefined {
  if (runtime === "java") {
    const parsed = parseJdkVersion(value);
    if (!parsed) return undefined;
    const version = jdkRuleVersion(parsed.major);
    return { lowest: version, highest: version };
  }
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value);
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  return {
    lowest: `${major}.${minor ?? "0"}.${patch ?? "0"}`,
    highest: `${major}.${minor ?? UNBOUNDED}.${patch ?? UNBOUNDED}`,
  };
}

function matchingRuntimeRule(
  rules: readonly RegistryV2Rule[],
  runtime: Runtime,
  value: string,
): RegistryV2Rule | undefined {
  const bounds = versionBounds(runtime, value);
  if (!bounds) return undefined;
  return rules.find((rule) => {
    try {
      return versContains(rule.vers, bounds.lowest) && versContains(rule.vers, bounds.highest);
    } catch {
      return false;
    }
  });
}

/** The release line an `os-release` names, from `VERSION_ID` or a Debian or Ubuntu codename. */
function osReleaseVersion(osRelease: RootfsOsRelease): string | undefined {
  if (osRelease.versionId !== undefined) return osRelease.versionId;
  const codename = osRelease.codename;
  if (codename === undefined) return undefined;
  return distroCodenameVersion(osRelease.id, codename);
}

function osVersionBounds(value: string): { lowest: string; highest: string } | undefined {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  return {
    lowest: `${Number(major)}.${minor === undefined ? "0" : Number(minor)}.${patch === undefined ? "0" : Number(patch)}`,
    highest: `${Number(major)}.${minor === undefined ? UNBOUNDED : Number(minor)}.${patch === undefined ? UNBOUNDED : Number(patch)}`,
  };
}

function matchingOsRule(
  rules: ReadonlyMap<string, RegistryV2Rule[]>,
  osRelease: RootfsOsRelease,
): RegistryV2Rule | undefined {
  const version = osReleaseVersion(osRelease);
  const bounds = version === undefined ? undefined : osVersionBounds(version);
  if (!bounds) return undefined;
  return rules.get(`library/${osRelease.id}`)?.find((rule) => {
    try {
      return versContains(rule.vers, bounds.lowest) && versContains(rule.vers, bounds.highest);
    } catch {
      return false;
    }
  });
}

function rootfsRuleFinding(rule: RegistryV2Rule, path: string, line: number, summary: string): DetectorFinding {
  return {
    id: `${rule.id}:${path}:${line}`,
    ruleId: rule.id,
    title: rule.title,
    summary: `${summary} ${rule.summary}`,
    severity: rule.severity,
    location: { path, line },
    ...(rule.replacement ? { replacement: rule.replacement } : {}),
    ...(rule.deadline ? { deadline: rule.deadline } : {}),
    ...(rule.migration ? { migration: rule.migration } : {}),
    sources: rule.sources,
  };
}

function osFinding(
  snapshot: RootfsSnapshot,
  osRules: ReadonlyMap<string, RegistryV2Rule[]>,
): DetectorFinding | undefined {
  const osRelease = snapshot.osRelease;
  const osRule = osRelease === undefined ? undefined : matchingOsRule(osRules, osRelease);
  if (!osRelease || !osRule) return undefined;
  const description =
    osRelease.prettyName ?? [osRelease.id, osRelease.versionId ?? osRelease.codename].filter(Boolean).join(" ");
  return rootfsRuleFinding(osRule, osRelease.path, osRelease.line, `${osRelease.path} reports ${description}.`);
}

function rootfsFindings(
  snapshots: readonly RootfsSnapshot[],
  osRules: ReadonlyMap<string, RegistryV2Rule[]>,
  runtimeRules: ReadonlyMap<Runtime, RegistryV2Rule[]>,
): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  for (const snapshot of snapshots) {
    const os = osFinding(snapshot, osRules);
    if (os) findings.push(os);
    for (const evidence of snapshot.runtimes) {
      const rule = matchingRuntimeRule(runtimeRules.get(evidence.runtime) ?? [], evidence.runtime, evidence.version);
      if (!rule) continue;
      const summary = `${evidence.path} ships ${evidence.runtime} ${evidence.version}.`;
      findings.push(rootfsRuleFinding(rule, evidence.path, evidence.line, summary));
    }
  }
  return findings;
}

interface CandidateContext extends ImageRules {
  maintainerRule: RegistryV2Rule | undefined;
  legacyEnvRule: RegistryV2Rule | undefined;
  runtimeRules: ReadonlyMap<Runtime, RegistryV2Rule[]>;
}

interface CandidateResult {
  finding?: DetectorFinding;
  unclassified?: Omit<UnclassifiedReference, "detector">;
}

type Location = { path: string; line: number };

async function loadRuntimeRules(
  found: readonly Candidate[],
  rootfs: readonly RootfsSnapshot[],
): Promise<Map<Runtime, RegistryV2Rule[]>> {
  const runtimeRules = new Map<Runtime, RegistryV2Rule[]>();
  const runtimes = new Set<Runtime>([
    ...found
      .filter((candidate): candidate is RuntimeCandidate => candidate.kind === "runtime")
      .map((candidate) => candidate.runtime),
    ...rootfs.flatMap((snapshot) => snapshot.runtimes.map((evidence) => evidence.runtime)),
  ]);
  for (const runtime of runtimes) {
    const source = RUNTIME_RULES[runtime];
    const loaded = validateRegistryV2(await loadDataFile(source.file)).rules;
    runtimeRules.set(
      runtime,
      loaded.filter((rule) => rule.purl === source.purl && rule.id.startsWith(source.prefix)),
    );
  }
  return runtimeRules;
}

function candidateFinding(
  rule: RegistryV2Rule,
  location: Location,
  summary: string,
  withDeadline: boolean,
): DetectorFinding {
  return {
    id: `${rule.id}:${location.path}:${location.line}`,
    ruleId: rule.id,
    title: rule.title,
    summary,
    severity: rule.severity,
    location,
    ...(rule.replacement ? { replacement: rule.replacement } : {}),
    ...(withDeadline && rule.deadline ? { deadline: rule.deadline } : {}),
    ...(rule.migration ? { migration: rule.migration } : {}),
    sources: rule.sources,
  };
}

function analyzeRuntimeCandidate(
  candidate: RuntimeCandidate,
  location: Location,
  context: CandidateContext,
): CandidateResult {
  const rule = matchingRuntimeRule(
    context.runtimeRules.get(candidate.runtime) ?? [],
    candidate.runtime,
    candidate.value,
  );
  if (!rule) return {};
  const summary = `${candidate.path} installs ${candidate.runtime} ${candidate.value}. ${rule.summary}`;
  return { finding: candidateFinding(rule, location, summary, true) };
}

function analyzeMarkerCandidate(
  candidate: MaintainerCandidate | LegacyEnvCandidate,
  location: Location,
  context: CandidateContext,
): CandidateResult {
  const rule = candidate.kind === "maintainer" ? context.maintainerRule : context.legacyEnvRule;
  if (!rule) return {};
  const summary =
    candidate.kind === "maintainer"
      ? `${candidate.path} uses the deprecated MAINTAINER instruction. ${rule.summary}`
      : `${candidate.path} sets ${candidate.key} with the legacy "ENV key value" form. ${rule.summary}`;
  return { finding: candidateFinding(rule, location, summary, false) };
}

function analyzeDynamicImage(
  candidate: ImageCandidate,
  location: Location,
  context: CandidateContext,
): CandidateResult {
  // Only name a reference when its repository part is a literal tracked image, as in node:${VERSION}.
  const repository = required(candidate.value.split(":")[0], "image repository");
  const named = parseImageReference(repository);
  const tracked = named !== undefined && rulesFor(named, context) !== undefined;
  if (!tracked || repository.includes("$")) return {};
  return {
    unclassified: {
      component: named.repository,
      reference: candidate.value,
      reason: "the tag is a build argument or variable without a usable literal default",
      location,
    },
  };
}

function analyzeImage(candidate: ImageCandidate, location: Location, context: CandidateContext): CandidateResult {
  const image = parseImageReference(candidate.value);
  if (!image) return {};
  const lifecycle = imageLifecycle(image, context);
  if (lifecycle.rule) {
    return {
      finding: candidateFinding(
        lifecycle.rule,
        location,
        `${candidate.path} uses ${candidate.value}. ${lifecycle.rule.summary}`,
        true,
      ),
    };
  }
  if (lifecycle.reason && rulesFor(image, context)) {
    return {
      unclassified: { component: image.repository, reference: candidate.value, reason: lifecycle.reason, location },
    };
  }
  return {};
}

function analyzeCandidate(candidate: Candidate, context: CandidateContext): CandidateResult {
  const location = { path: candidate.path, line: candidate.line };
  if (candidate.kind === "runtime") return analyzeRuntimeCandidate(candidate, location, context);
  if (candidate.kind === "maintainer" || candidate.kind === "legacy-env")
    return analyzeMarkerCandidate(candidate, location, context);
  return candidate.dynamic
    ? analyzeDynamicImage(candidate, location, context)
    : analyzeImage(candidate, location, context);
}

function hasLinkEvidence(inputs: LineageInputs): boolean {
  return (
    inputs.builds.length > 0 ||
    inputs.documents.some(({ stages }) =>
      stages.some(
        ({ copies, parent, reference, resolved }) =>
          copies.length > 0 || parent !== undefined || reference !== resolved,
      ),
    )
  );
}

async function addLineageFindings(
  findings: DetectorFinding[],
  inputs: LineageInputs,
  imageRules: ImageRules,
): Promise<DetectorFinding[]> {
  if (!hasLinkEvidence(inputs)) return findings;
  const [{ buildImageLineage }, { chainEvidence }] = await Promise.all([
    import("../../lineage/index.js"),
    import("../../lineage/render.js"),
  ]);
  const { chains } = buildImageLineage([inputs], imageRules);
  const result = new Map(findings.map((finding) => [finding.id, finding]));
  const rules = new Map([...imageRules.all, ...imageRules.dotnetRules].map((rule) => [rule.id, rule]));
  for (const chain of chains) {
    if (chain.links.length < 2 && chain.links[0]?.resolvedReference === undefined) continue;
    for (const [index, link] of chain.links.entries()) {
      if (link.ruleId === undefined) continue;
      const rule = rules.get(link.ruleId);
      if (rule === undefined) continue;
      const sameFile = link.path === chain.path;
      const location = sameFile ? { path: link.path, line: link.line } : { path: chain.path, line: chain.line };
      const existing = result.get(`${rule.id}:${location.path}:${location.line}`);
      const evidence = chainEvidence(chain, index);
      if (existing?.summary.includes(evidence)) continue;
      const summary =
        existing?.summary ?? `${chain.path} depends on ${link.resolvedReference ?? link.reference}. ${rule.summary}`;
      const finding = candidateFinding(rule, location, `${summary} ${evidence}`, true);
      result.set(finding.id, finding);
    }
  }
  return [...result.values()];
}

export class ContainerDetector implements Detector {
  readonly apiVersion = DETECTOR_API_VERSION;
  readonly id = "container";
  /** The files `scan` may read; conformance fails a scan that reads another. */
  readonly inputs: DetectorInputs = {
    fileNames: [
      "Dockerfile*",
      "Containerfile*",
      "*.Dockerfile",
      "*.Containerfile",
      "docker-compose*.yml",
      "docker-compose*.yaml",
      "compose*.yml",
      "compose*.yaml",
      "devcontainer.json",
      "os-release",
      "node_version.h",
      "VERSION",
      "release",
    ],
    extensions: [".tar", ".tar.gz", ".tgz"],
    directories: [".github/workflows"],
  };

  async scan(context: DetectorContext): Promise<DetectorFinding[]> {
    return [...(await this.analyze(context)).findings];
  }

  async analyze(context: DetectorContext): Promise<DetectorAnalysis> {
    const inputs = await readLineageInputs(context.root);
    const found = inputs.documents.flatMap(candidates);
    const rootfs = await findRootfsSnapshots(context.root);
    if (inputs.documents.length === 0 && rootfs.length === 0) return { findings: [], unclassified: [] };

    const imageRules = await loadImageRules();
    const candidateContext = {
      ...imageRules,
      maintainerRule: imageRules.all.find((rule) => rule.id === MAINTAINER_RULE),
      legacyEnvRule: imageRules.all.find((rule) => rule.id === LEGACY_ENV_RULE),
      runtimeRules: await loadRuntimeRules(found, rootfs),
    };
    const { rules, runtimeRules } = candidateContext;
    const findings: DetectorFinding[] = [];
    const unclassified: Omit<UnclassifiedReference, "detector">[] = [];

    for (const candidate of found) {
      const result = analyzeCandidate(candidate, candidateContext);
      if (result.finding) findings.push(result.finding);
      if (result.unclassified) unclassified.push(result.unclassified);
    }

    const linked = await addLineageFindings(findings, inputs, imageRules);
    linked.push(...rootfsFindings(rootfs, rules, runtimeRules));
    return { findings: linked, unclassified };
  }
}

export const containerDetector = new ContainerDetector();
