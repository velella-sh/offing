import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";

import { readCohort } from "../benchmarks/fix-evals/cohort.js";
import { sha256 } from "../benchmarks/fix-evals/evaluate.js";
import {
  fixEvalPageData,
  fixEvalReport,
  latestFixEval,
  renderFixEvalCollections,
} from "../benchmarks/fix-evals/site.js";
import { tempSource } from "../benchmarks/fix-evals/source.js";

test("acc-fix-evals data validates, records the full selection and links the raw evidence", async () => {
  const { candidates } = await readCohort();
  const data = await fixEvalPageData(".");
  const schema: object = JSON.parse(await readFile("benchmarks/fix-evals/site-data.schema.json", "utf8"));
  const validate = new Ajv2020().compile(schema);
  assert.equal(validate(data), true, JSON.stringify(validate.errors));
  const run = data.run[0] ?? assert.fail("Missing run");
  assert.equal(run.selected, candidates.length);
  assert.equal(run.measured + run.excluded, run.selected);
  assert.match(run.evidence, /evidence\.tar\.gz/u);
  const { path } = await latestFixEval(".");
  const snapshot = fixEvalReport.parse(JSON.parse(await readFile(path, "utf8")));
  const raw = await readFile(join(dirname(path), "evidence.tar.gz"));
  assert.equal(sha256(raw), snapshot.evidenceSha256);
  for (const { failures } of snapshot.fixers) {
    for (const { repository } of failures) {
      await access(join(dirname(path), "failures", repository + ".json"));
    }
  }
  for (const { date, project, both } of data.agent) {
    assert.equal(project === "not run", both === "not run", date);
  }
});

test("acc-fix-evals builds the data page and nav with pinned Mizzen and Lateen without network access", async (t) => {
  const tools = resolve(process.env.OFFING_SITE_TOOLS ?? ".github/site-tools");
  const mizzen = join(tools, "node_modules/@velella/mizzen/bin/mizzen.js");
  const theme = join(tools, "node_modules/@velella/lateen");
  try {
    await access(mizzen);
  } catch {
    if (process.env.OFFING_SITE_TOOLS) throw new Error(`Mizzen is missing under ${tools}`);
    t.skip("Install .github/site-tools to run the offline site integration check.");
    return;
  }

  const root = resolve(".");
  await tempSource(async (directory) => {
    const docs = join(directory, "docs");
    const production = parse(await readFile("docs/mizzen.yml", "utf8")) as {
      collections: Record<string, unknown>;
    };
    const collections = Object.fromEntries(
      Object.entries(production.collections).filter(([name]) => name.startsWith("fix-evals-")),
    );
    const navigation = parse(await readFile("docs/_data/navigation.yml", "utf8")) as {
      main: { children?: { title: string; url: string }[] }[];
    };
    const link = navigation.main.flatMap(({ children }) => children ?? []).find(({ url }) => url === "/fix-evals/");
    assert.ok(link);
    await mkdir(join(docs, "_data"), { recursive: true });
    await mkdir(join(docs, "_templates"));
    await writeFile(join(docs, "_data/navigation.json"), JSON.stringify({ main: [link] }));
    await copyFile(join(root, "docs/_templates/fix-evals.md"), join(docs, "_templates/fix-evals.md"));
    await copyFile(join(root, "docs/FIX_EVALS_METHOD.md"), join(docs, "FIX_EVALS_METHOD.md"));
    await writeFile(join(docs, "mizzen.yml"), JSON.stringify({ title: "Offing", base: "/offing", collections }));
    for (const [file, contents] of Object.entries(await renderFixEvalCollections(root))) {
      await writeFile(join(directory, file), contents);
    }
    const deny = join(directory, "deny-network.mjs");
    await writeFile(
      deny,
      `
      import { Socket } from 'node:net';
      function blocked() { throw new Error('The fix evaluation page attempted network access.'); }
      Socket.prototype.connect = blocked;
      globalThis.fetch = blocked;
    `,
    );
    const out = join(directory, "out");
    await promisify(execFile)(
      process.execPath,
      ["--import", deny, mizzen, "build", docs, "--theme", theme, "--out", out, "--workers", "1"],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    const html = await readFile(join(out, "fix-evals/index.html"), "utf8");
    assert.match(html, /Outcomes by registered fixer/u);
    assert.match(html, /Agent outcomes by verification profile and prompt/u);
    assert.match(html, /bar-chart-svg/u);
    assert.match(html, /too few cases/u);
    assert.match(html, /href="\/offing\/fix-evals\//u);
    assert.doesNotMatch(html, /:field\[/u);
  });
});
