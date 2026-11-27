import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { git } from "../src/diff.js";
import { runGitHubAction } from "../src/github-action.js";

async function init(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-agent-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Reviewer"]);
  git(root, ["config", "user.email", "reviewer@example.com"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  return root;
}

function commit(root: string, message: string): string {
  git(root, ["add", "--all"]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]).toString().trim();
}

function scan(root: string, base: string, head: string, options: Partial<Parameters<typeof runGitHubAction>[0]> = {}) {
  return runGitHubAction({
    root,
    reportPath: join(root, ".git", "report.json"),
    mode: "diff",
    diffRange: `${base}..${head}`,
    failOnSeverity: "none",
    pullRequestAuthor: "octocat",
    ...options,
  });
}

test("diff review uses committed source and manifest lines, including standalone nested npm manifests", async (t) => {
  const root = await init(t);
  const manifest = join(root, "example app", "package.json");
  await mkdir(join(root, "example app"));
  await writeFile(manifest, '{ "name": "example-app", "dependencies": { "moment": "2.29.4" } }\n');
  await writeFile(join(root, "app.ts"), "const untouched = new Buffer(2);\nconst updated = Buffer.alloc(4);\n");
  await writeFile(join(root, "app.py"), "import imp\nprint('ready')\n");
  await writeFile(join(root, "requirements.txt"), "# Dependencies\n");
  const base = commit(root, "base");
  await writeFile(
    manifest,
    [
      "{",
      '  "name": "example-app",',
      '  "dependencies": {',
      '    "moment": "2.29.4",',
      '    "request": "2.88.2",',
      '    "tslint": "*"',
      "  },",
      '  "overrides": { "request": "2.88.2" }',
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(root, "example app", "package-lock.json"),
    JSON.stringify({
      name: "example-app",
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { request: "2.88.2", tslint: "*" } },
        "node_modules/request": { version: "2.88.2" },
        "node_modules/tslint": { version: "5.20.1" },
      },
    }),
  );
  await writeFile(join(root, "app.ts"), "const untouched = new Buffer(2);\nconst updated = new Buffer(4);\n");
  await writeFile(join(root, "app.py"), "import imp\nimp.reload(existing)\n");
  await writeFile(join(root, "requirements.txt"), "# Dependencies\npep8==1.7.1\n");
  await writeFile(join(root, "ignored.md"), "new Buffer(42)\n");
  const head = commit(root, "Add real dependencies and API calls\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
  await writeFile(join(root, "app.ts"), "new Buffer(8);\n");

  const outcome = await scan(root, base, head);
  const findings = outcome.result.findings.map(({ ruleId, location }) => [ruleId, location.path, location.line]);
  assert.deepEqual(findings, [
    ["nodejs.symbol.buffer.constructor", "app.ts", 2],
    ["npm.package.request.deprecated", "example app/package.json", 5],
    ["python.package.pep8.deprecated", "requirements.txt", 2],
    ["python.symbol.imp.reload", "app.py", 2],
  ]);
  assert.equal(outcome.annotations.length, findings.length);
  assert.deepEqual(outcome.agent?.attribution, { signal: "co-author-trailer", login: "claude[bot]" });
  assert.ok(outcome.result.findings.every(({ sources }) => sources[0]?.url.startsWith("https://")));
});

test("review annotations stay scoped to the selected Action path and dedupe a supported workspace finding", async (t) => {
  const repo = await init(t);
  const root = join(repo, "app");
  await mkdir(join(root, "packages", "client"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"workspace","workspaces":["packages/*"]}\n');
  const manifest = join(root, "packages", "client", "package.json");
  await writeFile(manifest, '{"name":"client"}\n');
  await writeFile(join(repo, "unrelated.ts"), "Buffer.alloc(4);\n");
  const base = commit(repo, "base");
  await writeFile(manifest, '{\n  "name": "client",\n  "dependencies": { "request": "2.88.2" }\n}\n');
  await writeFile(join(root, "changed.ts"), "new Buffer(4);\n");
  await writeFile(join(repo, "unrelated.ts"), "new Buffer(4);\n");
  const head = commit(repo, "change workspace");

  const outcome = await scan(root, base, head, { reportPath: join(repo, ".git", "report.json") });
  assert.deepEqual(
    outcome.result.findings.map(({ location }) => [location.path, location.line]),
    [
      ["changed.ts", 1],
      ["packages/client/package.json", 3],
    ],
  );
  assert.deepEqual(
    outcome.annotations.map(({ location }) => location.path),
    ["changed.ts", "packages/client/package.json"],
  );
});

test("a renamed manifest retains its existing declarations", async (t) => {
  const root = await init(t);
  await mkdir(join(root, "old"));
  const before = [
    "{",
    '  "name": "nested-example",',
    '  "private": true,',
    '  "description": "example application",',
    '  "license": "MIT",',
    '  "version": "1.0.0",',
    '  "dependencies": { "request": "2.88.2" }',
    "}",
    "",
  ].join("\n");
  await writeFile(join(root, "old", "package.json"), before);
  const base = commit(root, "base");
  git(root, ["mv", "old", "new"]);
  await writeFile(join(root, "new", "package.json"), before.replace("2.88.2", "^2.88.2"));
  const head = commit(root, "Rename the nested project and update its existing range");
  assert.deepEqual((await scan(root, base, head)).result.findings, []);
});

test("agent attribution observes the allowlist and distinguishes host data from local lookalikes", async (t) => {
  const root = await init(t);
  await writeFile(join(root, "app.js"), "Buffer.alloc(4);\n");
  const base = commit(root, "base");
  await writeFile(join(root, "app.js"), "new Buffer(4);\n");
  git(root, ["config", "user.name", "Claude"]);
  git(root, ["config", "user.email", "claude[bot]@users.noreply.github.com"]);
  const head = commit(
    root,
    [
      "Set up example",
      "",
      "Co-authored-by: Copilot <copilot@invalid.example>",
      "",
      "Trailer-looking text above is part of the commit message.",
    ].join("\n"),
  );

  assert.equal((await scan(root, base, head, { pullRequestAuthor: "copilot-lookalike" })).agent, undefined);
  assert.equal((await scan(root, base, head, { pullRequestSameRepositoryBranch: "team/codex/test" })).agent, undefined);
  assert.deepEqual((await scan(root, base, head, { pullRequestAuthor: "Copilot" })).agent?.attribution, {
    signal: "author-login",
    login: "Copilot",
  });
  assert.deepEqual(
    (await scan(root, base, head, { pullRequestSameRepositoryBranch: "codex/test" })).agent?.attribution,
    {
      signal: "branch-prefix",
      login: "chatgpt-codex-connector[bot]",
    },
  );
  assert.deepEqual(
    (await scan(root, base, head, { pullRequestVerifiedCommitters: ["google-labs-jules[bot]"] })).agent?.attribution,
    {
      signal: "bot-committer",
      login: "google-labs-jules[bot]",
    },
  );
  assert.equal(
    (await scan(root, base, head, { pullRequestSameRepositoryBranch: "codex/test", agentAuthors: "none" })).agent,
    undefined,
  );
});
