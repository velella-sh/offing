import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { bundledRules } from "@velella/ebb/bundled-rules";
import { normalizePurl, parsePurl } from "@velella/ebb/purl";
import semver from "semver";

import type { ScanResult } from "../../../src/domain.js";
import { INPUT_PATH, RESULT_DIR, type OffingDate, type SbomCapture, type SbomCase } from "./types.js";

const run = promisify(execFile);
const syftVersion = "0.92.0";
const cliInputs = [
  "src",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "tools/generate-commands-index.mjs",
  "tools/generate-codemod-registry.mjs",
];
const dateEvents = new Set(["end-of-life", "end-of-support", "scheduled-end-of-life"]);

interface SyftDocument {
  artifacts: Array<{ purl?: string; version?: string }>;
  descriptor: { version: string };
}

function npmPackagePurl(purl: string | undefined): string | undefined {
  if (!purl?.startsWith("pkg:npm/")) return undefined;
  const normalized = normalizePurl(purl);
  const version = parsePurl(normalized).version;
  if (version && semver.valid(version)) return normalized;
  return undefined;
}

export function filterNpmSbom(sbom: SyftDocument): string[] {
  const seen = new Set<string>();
  sbom.artifacts = sbom.artifacts.filter((item) => {
    const purl = npmPackagePurl(item.purl);
    if (!purl || seen.has(purl)) return false;
    seen.add(purl);
    return true;
  });
  return [...seen].sort();
}

function offingDates(scan: ScanResult, sbom: SyftDocument, lifecycleRules: ReadonlySet<string>): OffingDate[] {
  return scan.findings
    .flatMap((finding) => {
      if (!finding.deadline || !lifecycleRules.has(finding.ruleId)) return [];
      const index = Number(finding.location.jsonPointer?.split("/").at(-1));
      const purl = npmPackagePurl(sbom.artifacts[index]?.purl);
      const source = finding.sources[0]?.url;
      return purl && source ? [{ purl, ruleId: finding.ruleId, eol: finding.deadline, source }] : [];
    })
    .sort((left, right) => left.purl.localeCompare(right.purl) || left.ruleId.localeCompare(right.ruleId));
}

async function collectCase(
  root: string,
  cache: string,
  pin: Pick<SbomCase, "repository" | "commit">,
  lifecycleRules: ReadonlySet<string>,
  outputDir: string,
): Promise<{ entry: SbomCase; dataVersion: string }> {
  const cwd = join(cache, `${pin.repository.replace("/", "__")}@${pin.commit}`);
  const { stdout } = await run("syft", ["packages", "dir:.", "-o", "json"], {
    cwd,
    env: { ...process.env, SYFT_CHECK_FOR_APP_UPDATE: "false", SYFT_JAVA_USE_NETWORK: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const sbom = JSON.parse(stdout) as SyftDocument;
  if (sbom.descriptor.version !== syftVersion) throw new Error(`Expected Syft ${syftVersion}.`);
  const original = sbom.artifacts.length;
  const packages = filterNpmSbom(sbom);
  const inputFile = join(outputDir, `${pin.repository.replace("/", "__")}.json`);
  await writeFile(inputFile, JSON.stringify(sbom));
  const output = await run(process.execPath, ["dist/src/cli.js", "scan", "--sbom", inputFile, "--json"], {
    cwd: root,
    env: { ...process.env, EBB_DATA_DIR: outputDir },
    maxBuffer: 16 * 1024 * 1024,
  });
  const scan = JSON.parse(output.stdout) as ScanResult;
  if (scan.data?.source !== "bundled") throw new Error("Expected the bundled Offing data.");
  return {
    entry: { ...pin, packages, excluded: original - packages.length, offing: offingDates(scan, sbom, lifecycleRules) },
    dataVersion: scan.data.version,
  };
}

async function collect(root: string, cache: string, outputDir: string): Promise<SbomCapture> {
  const pins = JSON.parse(await readFile(join(root, RESULT_DIR, "repositories.json"), "utf8")) as Array<
    Pick<SbomCase, "repository" | "commit">
  >;
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
  const { stdout: dirty } = await run("git", ["status", "--porcelain", "--", ...cliInputs], { cwd: root });
  if (dirty) throw new Error("Commit changes to the Offing CLI build inputs before collecting.");
  const { stdout: commit } = await run("git", ["log", "-1", "--format=%H", "--", ...cliInputs], { cwd: root });
  const rules = await bundledRules();
  const lifecycleRules = new Set(rules.filter((rule) => dateEvents.has(rule.event)).map((rule) => rule.id));
  const collected = await Promise.all(pins.map((pin) => collectCase(root, cache, pin, lifecycleRules, outputDir)));
  const versions = new Set(collected.map(({ dataVersion }) => dataVersion));
  const dataVersion = collected[0]?.dataVersion;
  if (dataVersion === undefined || versions.size !== 1) throw new Error("Expected one Offing data version.");
  return {
    offingVersion: version,
    offingCommit: commit.trim(),
    dataVersion,
    syftVersion,
    cases: collected.map(({ entry }) => entry),
  };
}

async function main(): Promise<void> {
  const cache = process.env.OFFING_CORPUS_CACHE;
  if (!cache) throw new Error("Set OFFING_CORPUS_CACHE to the warmed pinned checkout cache.");
  const root = process.cwd();
  const [keepParent, ...rest] = process.argv.slice(2);
  if (rest.length > 0) throw new Error("Usage: collect.js [directory for kept SBOMs]");
  const outputDir = await mkdtemp(join(keepParent ? resolve(keepParent) : tmpdir(), "offing-comparison-"));
  let keep = false;
  try {
    const result = await collect(root, resolve(cache), outputDir);
    await writeFile(join(root, INPUT_PATH), `${JSON.stringify(result, null, 2)}\n`);
    if (keepParent) {
      process.stdout.write(`Shared SBOMs: ${outputDir}\n`);
      keep = true;
    }
  } finally {
    if (!keep) await rm(outputDir, { force: true, recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
