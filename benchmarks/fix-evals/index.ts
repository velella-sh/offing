import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { configureActiveData, getActiveDataSync } from "@velella/ebb/data-source";
import { z } from "zod";

import { fixers } from "../../src/fix/index.js";
import { archiveTree, connectDocker, prepareImage, sandbox } from "./docker.js";
import { evaluate, type Evidence, type Input, scannedAt } from "./evaluate.js";
import { isProfile, type Profile } from "./profiles.js";
import { summarize } from "./report.js";
import { checkoutPublic, fixtureSource, tempSource } from "./source.js";

const repositoriesPath = "benchmarks/fix-evals/repositories.json";
const fileName = z.string().regex(/^[a-z][a-z0-9-]*$/u);
const publicCases = z
  .array(
    z.strictObject({
      id: fileName,
      repository: z.string().regex(/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/iu),
      commit: z.string().regex(/^[a-f0-9]{40}$/u),
      profile: z.custom<Profile>((value) => typeof value === "string" && isProfile(value)),
    }),
  )
  .min(1);

async function inputs(fixtures: boolean): Promise<Input[]> {
  if (fixtures) return ["green", "red"].map((id) => ({ id, repository: null, commit: null, profile: "npm" }));
  const data: unknown = JSON.parse(await readFile(repositoriesPath, "utf8"));
  const rows = publicCases.parse(data);
  if (new Set(rows.map(({ id }) => id)).size !== rows.length) throw new Error("Duplicate fix-evals case ID.");
  if (new Set(rows.map(({ repository }) => repository.toLowerCase())).size !== rows.length) {
    throw new Error("A public repository can occur only once in the fix-evals selection.");
  }
  return rows;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function run(out: string, rows: Input[], selected: typeof fixers): Promise<void> {
  const output = resolve(out);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim();
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  await tempSource(async (config) => {
    configureActiveData({ cacheDirectory: config });
    const docker = await connectDocker(config);
    const images = new Map<Profile, string>();
    const evidence: Evidence[] = [];
    for (const input of rows) {
      const load = (root: string) =>
        input.repository !== null && input.commit !== null
          ? checkoutPublic(root, input.repository, input.commit)
          : fixtureSource(root, join("tests/fixtures/fix-evals", input.id));
      const result = await evaluate(input, load, {
        output,
        fixers: selected,
        async backend(profile, root) {
          let image = images.get(profile);
          if (image === undefined) {
            const dockerfile =
              profile === "kubernetes" ? await readFile("benchmarks/fix-evals/Dockerfile.kubeconform", "utf8") : "";
            image = await prepareImage(docker, profile, dockerfile);
            images.set(profile, image);
          }
          return sandbox(docker, image, await archiveTree(root));
        },
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
      fixtures: rows.every(({ repository }) => repository === null),
      images: Object.fromEntries(images),
    });
  });
  process.stdout.write(`Fix evaluation evidence: ${output}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      fixtures: { type: "boolean", default: false },
      fixer: { type: "string" },
      out: { type: "string", default: "artifacts/fix-evals" },
    },
  });
  const selected = fixers.filter(({ id }) => values.fixer === undefined || values.fixer === id);
  if (selected.length === 0) throw new Error(`Unknown registered fixer: ${values.fixer}`);
  await run(values.out, await inputs(values.fixtures), selected);
}

await main().catch((error: unknown) => {
  process.stderr.write(`fix-evals: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
