import { lstat, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { RegistryV2Rule } from "@velella/ebb/registry";
import { parsePurl, purlIdentity } from "@velella/ebb/purl";

import { checkAgainst, type DependencyFinding } from "../check-dependency.js";
import { loadConfig } from "../config.js";
import { exportRef, git } from "../diff.js";
import type { Finding, PolicyException, ScanResult, SourceLocation } from "../domain.js";
import { resolveLifecyclePolicy } from "../fleet-policy/load.js";
import { OffingError } from "../offing-error.js";
import { relativePosix } from "../paths.js";
import { readSbomDocument } from "../sbom-scan.js";
import { scanSbomInput } from "../sbom/input.js";
import { lifecyclePackageRules, lifecycleRules } from "../sbom/lifecycle.js";
import { scanWithBuiltIns } from "../scan-builtins.js";
import {
  decideRelease,
  type GateDecision,
  type GateInput,
  type GateWindow,
  type LifecycleObservation,
} from "./decision.js";
import { componentPredictions } from "./prediction.js";

type RuleDetails = Pick<DependencyFinding, "ruleId" | "event" | "deadline" | "sources">;

function observation(
  component: string,
  detector: string,
  location: SourceLocation,
  rule: RuleDetails,
): LifecycleObservation {
  return {
    component,
    detector,
    location,
    rule: {
      id: rule.ruleId,
      event: rule.event,
      sources: rule.sources.map(({ url }) => url),
      ...(rule.deadline ? { date: rule.deadline } : {}),
    },
  };
}

function scanFinding(finding: Finding, activeRules: ReadonlyMap<string, RegistryV2Rule>): LifecycleObservation {
  const rule = activeRules.get(finding.ruleId);
  if (!rule) return { component: finding.ruleId, detector: finding.detector, location: finding.location };
  return observation(rule.purl, finding.detector, finding.location, { ...rule, ruleId: rule.id });
}

export async function repositoryObservations(result: ScanResult): Promise<LifecycleObservation[]> {
  const rules = new Map((await lifecycleRules()).map((rule) => [rule.id, rule]));
  return [
    ...result.findings.map((finding) => scanFinding(finding, rules)),
    ...(result.unclassified?.references ?? []).map(({ component, detector, location }) => ({
      component,
      detector,
      location,
    })),
  ];
}

export async function sbomObservations(
  file: string,
  root: string,
  workspaceOnly = false,
): Promise<LifecycleObservation[]> {
  const input = await readSbomDocument(file, root, workspaceOnly);
  const relative = relativePosix(root, resolve(root, file));
  const path = file === "-" ? "stdin.sbom.json" : relative.startsWith("../") ? basename(file) : relative;
  const unknown: LifecycleObservation[] = [];
  const predictions: LifecycleObservation[] = [];
  const byPackage = lifecyclePackageRules(await lifecycleRules());
  const checks = await scanSbomInput(input, {
    check: (component) => checkAgainst(byPackage.get(purlIdentity(parsePurl(component.purl))) ?? [], component),
    onMissingPurl(component, jsonPointer) {
      unknown.push({ component, detector: "sbom", location: { path, jsonPointer } });
    },
    onComponent({ version, findings, location: jsonPointer }, purl, owner, format) {
      if (!version || findings.some(({ event, deadline }) => deadline && event !== "deprecated")) return;
      for (const prediction of componentPredictions(purl, version, owner, format)) {
        predictions.push({ component: prediction.purl, detector: "sbom", location: { path, jsonPointer }, prediction });
      }
    },
  });
  const dated = checks.flatMap(({ status, purl, version, location: jsonPointer, findings }) => {
    const component = version ? `${purl}@${version}` : purl;
    const location = { path, jsonPointer };
    const detector = parsePurl(purl).type;
    if (status === "no-data" || status === "version-dependent") return [{ component, detector, location }];
    return findings.map((finding) => observation(component, finding.ecosystem, location, finding));
  });
  if (checks.length === 0 && unknown.length === 0)
    unknown.push({ component: "empty SBOM", detector: "sbom", location: { path } });
  return [...dated, ...unknown, ...predictions];
}

async function missingPath(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return true;
    throw error;
  }
}

export async function releaseInput(target: string): Promise<GateInput> {
  if (await missingPath(target)) return { kind: "git-ref", target };
  if ((await stat(target)).isDirectory()) return { kind: "path", target };
  throw new OffingError("invalid-argument", "Expected a directory, Git ref, --sbom or --attestation.");
}

export function verifyRef(root: string, ref: string): string {
  return git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    .toString()
    .trim();
}

export function verifyTag(root: string, tag: string): string {
  const target = git(root, ["show-ref", "--verify", "--hash", "--", `refs/tags/${tag}`])
    .toString()
    .trim();
  return verifyRef(root, target);
}

export async function localExceptions(root: string, window: GateWindow): Promise<readonly PolicyException[]> {
  const config = await loadConfig(root);
  return (await resolveLifecyclePolicy({ root, config, today: window.asOf }))?.exceptions ?? [];
}

async function evaluateTree(root: string, input: GateInput, window: GateWindow): Promise<GateDecision> {
  const config = await loadConfig(root);
  const observations = await repositoryObservations(await scanWithBuiltIns(root));
  const policy = await resolveLifecyclePolicy({ root, config, today: window.asOf });
  return decideRelease(input, observations, window, policy?.exceptions);
}

/** Archive the committed tree with export filters disabled in a disposable object-store view. */
async function snapshotTree(cwd: string, commit: string, directory: string): Promise<string> {
  const repository = join(directory, "objects-view");
  const tree = join(directory, "tree");
  await mkdir(repository);
  await mkdir(tree);
  const format = commit.length === 64 ? "sha256" : "sha1";
  git(repository, ["init", "--bare", "--template=", `--object-format=${format}`]);
  await mkdir(join(repository, "info"));
  await writeFile(join(repository, "info/attributes"), "* -export-ignore -export-subst\n");
  const objects = git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]).toString();
  await writeFile(join(repository, "objects/info/alternates"), objects);
  exportRef(repository, commit, tree);
  return tree;
}

export async function evaluateRepository(
  input: GateInput,
  window: GateWindow,
  cwd: string,
  commit?: string,
): Promise<GateDecision> {
  if (input.kind === "path") return evaluateTree(resolve(cwd, input.target), input, window);
  const resolved = commit ?? verifyRef(cwd, input.target);
  const directory = await mkdtemp(join(tmpdir(), "offing-release-gate-"));
  try {
    const tree = await snapshotTree(cwd, resolved, directory);
    // Never read a configuration symlink from an archived tree or inherit a config above the snapshot.
    const configPath = join(tree, ".offing.json");
    if (await missingPath(configPath)) {
      await writeFile(configPath, "{}\n", { flag: "wx" });
    } else if (!(await lstat(configPath)).isFile()) {
      throw new OffingError("invalid-argument", "A Git ref must store .offing.json as a regular file.");
    }
    return await evaluateTree(tree, input, window);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
