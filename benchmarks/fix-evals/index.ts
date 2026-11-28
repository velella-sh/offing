import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { configureActiveData, getActiveDataSync } from "@velella/ebb/data-source";

import { fixers } from "../../src/fix/index.js";
import { readBounded } from "../../src/forecast-tool/remote/body.js";
import { connectDocker, pinnedDockerRunner } from "../../src/test-runners/docker.js";
import { isProfile } from "../../src/test-runners/profiles.js";
import { type Asset, type Candidate, readCohort } from "./cohort.js";
import { evaluate, type Evidence, scannedAt, sha256 } from "./evaluate.js";
import { summarize } from "./report.js";
import { proveRunnerProfiles } from "./runner-fixtures.js";
import { checkoutPublic, fixtureSource, tempSource } from "./source.js";
import { isFixtureTool, proveTestTools } from "./tool-fixtures.js";

async function inputs(fixtures: boolean): Promise<{ candidates: Candidate[]; selectionRevision: string | null }> {
  if (fixtures) {
    return {
      selectionRevision: null,
      candidates: ["green", "red"].map((id) => ({ input: { id, repository: null, commit: null, profile: "npm" } })),
    };
  }
  const { revision, candidates } = await readCohort();
  return { selectionRevision: revision, candidates };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function stageAsset(root: string, asset: Asset): Promise<void> {
  const response = await fetch(asset.url, { credentials: "omit", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not read pinned evaluation input ${asset.path}.`);
  const bytes = await readBounded(response, 24 * 1024 * 1024, asset.path);
  if (asset.sha256 !== undefined && sha256(Buffer.from(bytes)) !== asset.sha256) {
    throw new Error(`Pinned evaluation input ${asset.path} did not match its SHA-256.`);
  }
  const path = join(root, asset.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
}

async function run(out: string, rows: Awaited<ReturnType<typeof inputs>>, selected: typeof fixers): Promise<void> {
  const output = resolve(out);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim();
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  await tempSource(async (config) => {
    configureActiveData({ cacheDirectory: config });
    const runner = pinnedDockerRunner(await connectDocker(config), () =>
      readFile("benchmarks/fix-evals/Dockerfile.kubeconform", "utf8"),
    );
    const evidence: Evidence[] = [];
    for (const { input, commands, paths, image: expectedImage, assets = [] } of rows.candidates) {
      const load = async (root: string) => {
        if (input.repository !== null && input.commit !== null) {
          await checkoutPublic(root, input.repository, input.commit);
        } else {
          await fixtureSource(root, join("tests/fixtures/fix-evals", input.id));
        }
        for (const asset of assets) await stageAsset(root, asset);
      };
      const result = await evaluate(input, load, {
        output,
        fixers: selected,
        ...(commands === undefined ? {} : { commands }),
        ...(paths === undefined ? {} : { paths }),
        backend: (profile, root) =>
          runner.prepare(profile, root, expectedImage === undefined ? {} : { image: expectedImage }),
      });
      evidence.push(result);
      await writeJson(join(output, input.id, "evidence.json"), result);
    }
    await writeJson(join(output, "report.json"), {
      ...summarize(
        evidence,
        selected.map(({ id }) => id),
      ),
      revision,
      scannedAt,
      ebb: getActiveDataSync().info.version,
      selectionRevision: rows.selectionRevision,
      selected: rows.candidates.length,
      fixtures: rows.selectionRevision === null,
      images: Object.fromEntries(runner.images),
    });
  });
  process.stdout.write(`Fix evaluation evidence: ${output}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      fixtures: { type: "boolean", default: false },
      "runner-profile": { type: "string" },
      "runner-tool": { type: "string" },
      fixer: { type: "string" },
      out: { type: "string", default: "artifacts/fix-evals" },
    },
  });
  if (values["runner-tool"] !== undefined) {
    const tool = values["runner-tool"];
    if (
      !values.fixtures ||
      values.fixer !== undefined ||
      values["runner-profile"] !== undefined ||
      (tool !== "all" && !isFixtureTool(tool))
    ) {
      throw new Error("Use --fixtures --runner-tool <all or test tool> without --fixer or --runner-profile.");
    }
    await proveTestTools(tool === "all" ? undefined : tool);
    return;
  }
  if (values["runner-profile"] !== undefined) {
    const profile = values["runner-profile"];
    if (!values.fixtures || values.fixer !== undefined || (profile !== "all" && !isProfile(profile))) {
      throw new Error("Use --fixtures --runner-profile <all or pinned profile> without --fixer.");
    }
    await proveRunnerProfiles(profile === "all" ? undefined : profile);
    return;
  }
  const selected = fixers.filter(({ id }) => values.fixer === undefined || values.fixer === id);
  if (selected.length === 0) throw new Error(`Unknown registered fixer: ${values.fixer}`);
  await run(values.out, await inputs(values.fixtures), selected);
}

await main().catch((error: unknown) => {
  process.stderr.write(`fix-evals: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
