import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

import { loadImageRules } from "../src/detectors/container/image-lifecycle.js";
import { parseDockerfileBuild } from "../src/detectors/container/parse-dockerfile.js";
import { scanFleet } from "../src/fleet/index.js";
import type { FleetHost } from "../src/fleet/host.js";
import { buildImageLineage, repositoryLineage } from "../src/lineage/index.js";
import { restoreFixtureNames } from "../src/fixture-names.js";
import { readLineageInputs } from "../src/lineage/inputs.js";
import { renderLineageMermaid, renderLineageText } from "../src/lineage/render.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";
import { copyFixtureTree } from "./fixture-copies.js";

const fixtureSource = resolve("tests/fixtures/lineage");
let fixture: string;
const roots: string[] = [];
before(async () => {
  fixture = await copyFixtureTree(fixtureSource, roots);
});
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
const nodeRule = "container.node.eol-21-and-older";
const debianRule = "container.debian.eol-11-and-older";

test("lineage follows FROM aliases and COPY branches with exact source locations", async () => {
  const result = await repositoryLineage(fixture);
  const validate = new Ajv2020().compile(JSON.parse(await readFile("schemas/lineage.v1.schema.json", "utf8")));
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...result, chains: [{}] }), false);
  assert.deepEqual(await repositoryLineage(fixture), result);
  const chain = result.chains.find(({ path }) => path === "Dockerfile");
  assert.ok(chain);
  assert.equal(chain.stage, "final");
  assert.deepEqual(
    chain.links.map(({ reference, line, parents }) => [reference, line, parents]),
    [
      ["empty", 6, []],
      ["scratch", 5, [0]],
      ["0", 7, [0]],
      ["build", 8, [0]],
      ["${BASE}", 3, [2, 3]],
    ],
  );
  const resolved = chain.links.at(-1);
  assert.equal(resolved?.resolvedReference, "node:18");
  assert.equal(resolved?.ruleId, nodeRule);
  assert.equal(resolved?.baseOs, "no-data");
  assert.match(renderLineageText(result), /FROM \$\{BASE\} → node:18 \(Dockerfile:3\)/);
  assert.match(renderLineageMermaid(result), /^flowchart TD/);
  const dev = result.chains.find(({ path }) => path === ".devcontainer/devcontainer.json");
  assert.equal(dev?.line, 4);
  assert.equal(dev?.links[1]?.reference, "debian:buster");
  const internal = result.chains.find(({ path }) => path === "app.Dockerfile");
  assert.equal(internal?.links[0]?.producer?.source, "https://github.com/acme/base");
  assert.equal(internal?.links[0]?.producer?.path, ".github/workflows/base.yml");
  const compose = result.chains.filter(({ path }) => path === "compose.yaml");
  assert.equal(compose[0]?.links[0]?.status, "unknown");
  assert.equal(compose[1]?.links[0]?.status, "unknown");
  assert.match(compose[1]?.links[0]?.reason ?? "", /tag next to the digest/);
  assert.equal(compose[2]?.links[0]?.ruleId, nodeRule);
  assert.match(compose[2]?.links[0]?.digest ?? "", /^sha256:/);
});

test("scan reports linked lifecycle rules with full evidence, and stays network-free", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("scan must never ask the registry");
  };
  try {
    const { findings } = await scanWithBuiltIns(fixture, { noCache: true });
    const copied = findings.find(({ ruleId, location }) => ruleId === nodeRule && location.path === "Dockerfile");
    assert.equal(copied?.location.line, 3);
    assert.match(copied?.summary ?? "", /COPY 0 \(Dockerfile:7\).*COPY build \(Dockerfile:8\)/);
    const internal = findings.find(
      ({ ruleId, location }) => ruleId === debianRule && location.path === "app.Dockerfile",
    );
    assert.equal(internal?.detector, "container");
    assert.match(
      internal?.summary ?? "",
      /ghcr\.io\/acme\/base:3 \(app\.Dockerfile:1\).*debian:buster \(images\/base\.Dockerfile:1\)/,
    );
    assert.ok(internal?.sources[0]?.url);
    assert.equal(
      findings.some(({ location }) => location.path === "compose.yaml" && location.line === 5),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("removing a build declaration invalidates cached consumer findings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "offing-lineage-cache-"));
  try {
    const root = join(directory, "repo");
    await cp(fixtureSource, root, { recursive: true });
    await restoreFixtureNames(root);
    const options = { cacheDirectory: join(directory, "cache") };
    const related = ({ location, ruleId }: { location: { path: string }; ruleId: string }) =>
      location.path === "app.Dockerfile" && ruleId === debianRule;
    assert.ok((await scanWithBuiltIns(root, options)).findings.some(related));
    assert.ok((await scanWithBuiltIns(root, options)).findings.some(related));
    await rm(join(root, ".github/workflows/base.yml"));
    assert.equal((await scanWithBuiltIns(root, options)).findings.some(related), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ambiguous producers and arguments without global defaults are left unresolved", async () => {
  const [local, rules] = await Promise.all([readLineageInputs(fixture), loadImageRules()]);
  const [build] = local.builds;
  assert.ok(build);
  const conflicted = { ...local, builds: [build, { ...build, stage: 1 }] };
  const ambiguous = buildImageLineage([conflicted], rules);
  assert.equal(ambiguous.chains.find(({ path }) => path === "app.Dockerfile")?.links.length, 1);
  const dynamic = parseDockerfileBuild("ARG NONE\nFROM node:${NONE}\nARG NONE=18\nFROM node:${NONE}");
  assert.deepEqual(
    dynamic.stages.map(({ resolved }) => resolved),
    ["node:${NONE}", "node:${NONE}"],
  );
});

test("a floating latest consumer has no confirmed producer or lifecycle finding", async () => {
  const root = await mkdtemp(join(tmpdir(), "offing-lineage-floating-"));
  try {
    await cp(fixtureSource, root, { recursive: true });
    await restoreFixtureNames(root);
    const workflow = join(root, ".github/workflows/base.yml");
    await writeFile(workflow, (await readFile(workflow, "utf8")).replace("base:3", "base:latest"));
    await writeFile(join(root, "app.Dockerfile"), "FROM ghcr.io/acme/base:latest\n");
    const report = await repositoryLineage(root);
    const chain = report.chains.find(({ path }) => path === "app.Dockerfile");
    assert.equal(chain?.links.length, 1);
    assert.equal(chain?.links[0]?.status, "unknown");
    assert.equal(
      (await scanWithBuiltIns(root, { noCache: true })).findings.some(
        ({ location }) => location.path === "app.Dockerfile",
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Dockerfile heredoc bodies never add false build stages", () => {
  const build = parseDockerfileBuild(
    [
      "FROM node:18 AS build",
      'RUN echo "<<IGNORED"',
      "RUN <<-'SCRIPT'",
      "FROM debian:buster AS false_stage",
      "\tSCRIPT",
      "FROM scratch AS final",
      "COPY --from=build /app /app",
    ].join("\n"),
  );
  assert.deepEqual(
    build.stages.map(({ name, line }) => [name, line]),
    [
      ["build", 1],
      ["final", 6],
    ],
  );
  assert.equal(build.stages.at(-1)?.copies[0]?.stage, 0);
});

test("fleet lineage links distinct authorized pinned repositories, with no effect on standard output", async () => {
  const commit = "a".repeat(40);
  const host: FleetHost = {
    origin: "https://github.com",
    async listRepositories() {
      return ["acme/app", "acme/base"].map((name) => ({
        name,
        defaultBranch: "main",
        archived: false,
        fork: false,
        disabled: false,
        topics: [],
      }));
    },
    async readDefaultBranchHead() {
      return commit;
    },
    async fetchFilesAtCommit(repo, pinned, root) {
      assert.equal(pinned, commit);
      const source = repo.name === "acme/app" ? "FROM ghcr.io/acme/base:3\n" : "FROM debian:buster\n";
      await writeFile(join(root, "Dockerfile"), source);
      if (repo.name === "acme/base") {
        await mkdir(join(root, ".github", "workflows"), { recursive: true });
        const workflow = await readFile(join(fixture, ".github", "workflows", "base.yml"), "utf8");
        await writeFile(join(root, ".github/workflows/base.yml"), workflow.replace(/ +(?:file|target):[^\n]+\n/g, ""));
      }
      return source.length;
    },
  };
  const standard = await scanFleet(host, "acme", { noCache: true });
  assert.equal(standard.imageLineage, undefined);
  const enriched = await scanFleet(host, "acme", { imageLineage: true });
  const chain = enriched.imageLineage?.chains.find(({ repository }) => repository === "acme/app");
  assert.equal(chain?.links[0]?.producer?.commit, commit);
  assert.equal(chain?.links[1]?.repository, "acme/base");
  assert.equal(chain?.links[1]?.ruleId, debianRule);
  assert.equal(enriched.findings, standard.findings);
  const ajv = new Ajv2020();
  const validate = ajv.compile(JSON.parse(await readFile("schemas/lineage.v1.schema.json", "utf8")));
  assert.equal(validate(enriched.imageLineage), true, JSON.stringify(validate.errors));
  const valid = ajv.compile(JSON.parse(await readFile("schemas/fleet.v1.schema.json", "utf8")));
  assert.equal(valid(enriched), true, JSON.stringify(valid.errors));
});
