import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { loadConfig } from "../src/config.js";
import { cachedPolicy, savePolicy } from "../src/fleet-policy/cache.js";
import { parseFleetPolicy, pickTeam } from "../src/fleet-policy/document.js";
import { loadFleetPolicy } from "../src/fleet-policy/load.js";
import { parsePolicyReference } from "../src/fleet-policy/reference.js";
import { fetchRemotePolicy } from "../src/fleet-policy/remote.js";
import { runGitHubAction } from "../src/github-action.js";
import { runCli } from "./cli-runner.js";

const today = "2027-04-01";
const organization = {
  schemaVersion: "offing.fleet-policy.v1",
  policy: { rules: [{ id: "runtime", "days-left": 30, severity: "medium" }] },
  teams: {
    platform: { policy: { rules: [{ id: "runtime", "days-left": 45 }] } },
    mapped: { repositories: ["explicit"], policy: { rules: [{ id: "runtime", "days-left": 60 }] } },
  },
};

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function fixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-fleet-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "org.json"), json(organization));
  await writeFile(join(root, "package.json"), '{"engines":{"node":"22"}}');
  await writeFile(join(root, "CODEOWNERS"), "* @example/platform\n");
  return root;
}

test("local organization, CODEOWNERS, and repository fields retain the effective sources", async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, ".offing.json"),
    json({
      extends: "org.json",
      policy: { rules: [{ id: "runtime", severity: "low" }] },
    }),
  );
  const config = await loadConfig(root);
  const result = await loadFleetPolicy({ root, config, today });
  assert.deepEqual(result?.policy.rules, [{ id: "runtime", "days-left": 45, severity: "low" }]);
  assert.equal(result?.rules[0]?.origins["days-left"]?.layer, "team");
  assert.equal(result?.rules[0]?.origins.severity?.layer, "repository");
  assert.equal(result?.rules[0]?.origins.severity?.line, 7);
  const mapped = await loadFleetPolicy({ root, config, today, repository: "example/explicit" });
  assert.equal(mapped?.policy.rules[0]?.["days-left"], 60);
  const policy = await parseFleetPolicy(json(organization), "org.json");
  assert.equal(pickTeam(policy, "unknown", []), undefined);
  assert.equal(pickTeam(policy, "unknown", ["@example/platform/path"]), undefined);
  assert.throws(
    () => pickTeam(policy, "repo", ["@example/platform", "@example/mapped"]),
    /multiple fleet policy teams/,
  );
  const explained = await runCli(["policy", "explain", "runtime", root, "--today", today]);
  assert.equal(explained.code, 0, explained.stderr);
  assert.match(explained.stdout, /days-left = 45 \(team, .*org\.json:/);
  assert.match(explained.stdout, /severity = "low" \(repository, .*\.offing\.json:7\)/);
});

test("narrowing a rule fails with both source files, including newly added selectors", async (t) => {
  const root = await fixture(t);
  for (const change of [{ "days-left": 3 }, { severity: "high" }, { path: "examples/" }, { "after-eol": true }]) {
    await writeFile(
      join(root, ".offing.json"),
      json({ extends: "org.json", policy: { rules: [{ id: "runtime", ...change }] } }),
    );
    await assert.rejects(
      loadFleetPolicy({ root, config: await loadConfig(root), today }),
      /\.offing\.json:7 loosens rule runtime .*org\.json:\d+/,
    );
  }
});

test("all layers require an active, owned exception and lower layers need organization permission", async (t) => {
  const root = await fixture(t);
  const exception = { path: "examples/", owner: "@example/platform", reason: "migration scheduled", expires: today };
  const writeConfig = async (exceptions: unknown[]) => {
    await writeFile(
      join(root, ".offing.json"),
      json({
        extends: "org.json",
        policy: { rules: [{ id: "runtime", severity: "low" }], exceptions },
      }),
    );
    return loadFleetPolicy({ root, config: await loadConfig(root), today });
  };
  await assert.rejects(writeConfig([exception]), /without permission/);
  await writeFile(join(root, "org.json"), json({ ...organization, allowLoosen: ["exceptions"] }));
  assert.equal((await writeConfig([exception]))?.exceptions[0]?.exception.owner, exception.owner);
  const { owner, ...unowned } = exception;
  assert.equal(owner, "@example/platform");
  await assert.rejects(writeConfig([unowned]), /requires an exception owner/);
  await assert.rejects(writeConfig([{ ...exception, expires: "2027-03-31" }]), /expired on 2027-03-31/);
  await assert.rejects(
    parseFleetPolicy(json({ ...organization, policy: { ...organization.policy, exceptions: [unowned] } }), "org.json"),
    /owner/,
  );
});

test("offline consumers use only an exact cached commit; explicit refresh validates a remote snapshot", async (t) => {
  const root = await fixture(t);
  const cache = join(root, "cache");
  const alias = "github:example/.github";
  const commit = "a".repeat(40);
  await writeFile(join(root, ".offing.json"), json({ extends: alias }));
  const options = { root, cache, today, config: await loadConfig(root) };
  await assert.rejects(loadFleetPolicy(options), /No pinned policy/);
  let refreshes = 0;
  const effective = await loadFleetPolicy({
    ...options,
    async fetchPolicy(reference) {
      refreshes++;
      assert.equal(reference.path, ".offing-policy.json");
      assert.equal(reference.ref, "HEAD");
      return { commit, text: json(organization) };
    },
  });
  assert.equal(refreshes, 1);
  assert.ok(effective?.rules[0]?.origins["days-left"]?.file.endsWith(commit));
  assert.deepEqual(await loadFleetPolicy(options), effective);
  const pinned = parsePolicyReference(`${alias}@${commit}`);
  assert.ok(pinned);
  assert.equal((await cachedPolicy(pinned, cache))?.commit, commit);
  await assert.rejects(savePolicy(pinned, { commit: "b".repeat(40), text: "{}" }, cache), /expected commit/);
  const missingPinned = parsePolicyReference(`${alias}@${"c".repeat(40)}`);
  assert.ok(missingPinned);
  assert.equal(await cachedPolicy(missingPinned, cache), undefined);
  const other = parsePolicyReference("gitlab:org/team/project");
  assert.equal(other?.repository, "org/team/project");
  assert.throws(() => parsePolicyReference("github:org/repo/../secret@main"), /Invalid remote policy reference/);
});

test("remote fetch pins immutable provider requests, rejects redirects and never uses a supplied host", async () => {
  const commit = "a".repeat(40);
  for (const source of ["github:example/repo/policies/organization.json@teams/main", "gitlab:example/group/repo"]) {
    const reference = parsePolicyReference(source);
    assert.ok(reference);
    const urls: string[] = [];
    const result = await fetchRemotePolicy(
      reference,
      async (input, options) => {
        urls.push(String(input));
        assert.equal(options?.redirect, "error");
        assert.equal(new Headers(options?.headers).has("authorization"), false);
        return new Response(urls.length === 1 ? json({ sha: commit, id: commit }) : json(organization));
      },
      {},
    );
    assert.match(urls[0] ?? "", /https:\/\/(api\.github\.com|gitlab\.com\/api\/v4)\//);
    assert.ok(urls[1]?.endsWith(`?ref=${commit}`));
    assert.equal(result.commit, commit);
    await assert.rejects(
      fetchRemotePolicy(reference, async () => new Response("redirect", { status: 302 }), {}),
      /HTTP 302/,
    );
    await assert.rejects(
      fetchRemotePolicy(reference, async () => new Response('{"sha":"wrong"}'), {}),
      /valid commit/,
    );
  }
});

test("scan and Action apply the same local inheritance and fail on an unavailable policy", async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, ".offing.json"),
    json({ extends: "org.json", policy: { rules: [{ id: "runtime", severity: "low" }] } }),
  );
  const scan = await runCli(["scan", root, "--today", today, "--json"]);
  assert.equal(scan.code, 1, scan.stderr);
  assert.match(scan.stderr, /Policy rule runtime failed/);
  const reportPath = join(root, "report.json");
  const action = await runGitHubAction({ root, today, reportPath, policy: "org.json", failOnSeverity: "none" });
  assert.equal(action.failed, true);
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")).policy, JSON.parse(scan.stdout).policy);
  await assert.rejects(runGitHubAction({ root, today, reportPath, policy: "missing.json" }), /missing\.json/);
});

test("repository-owned config cannot follow a policy symlink outside the scanned root", async (t) => {
  if (process.platform === "win32") return t.skip("symlink creation requires developer mode on Windows");
  const root = await fixture(t);
  const external = await fixture(t);
  await symlink(join(external, "org.json"), join(root, "external.json"));
  await writeFile(join(root, ".offing.json"), json({ extends: "external.json" }));
  await assert.rejects(loadFleetPolicy({ root, today, config: await loadConfig(root) }), /must stay under/);
});

test("fleet compliance preserves status and policy identity while hiding private policy text", async (t) => {
  const { fleetPolicyCompliance } = await import("../src/fleet-policy/compliance.js");
  const root = await fixture(t);
  const report = {
    schemaVersion: "offing.scan.v1" as const,
    root,
    scannedAt: `${today}T00:00:00Z`,
    diagnostics: [],
    findings: [
      {
        id: "private-source",
        ruleId: "private-rule-id",
        detector: "npm",
        title: "private title",
        summary: "private excerpt",
        severity: "high" as const,
        confidence: "exact" as const,
        location: { path: "private/file.json" },
        sources: [],
        deadline: today,
      },
    ],
  };
  const options = { root, today, reference: "org.json" };
  const fail = await fleetPolicyCompliance(report, options);
  assert.equal(fail.status, "violation");
  assert.equal(fail.reason, "rule-threshold");
  assert.equal(fail.violations, 1);
  assert.deepEqual(await fleetPolicyCompliance({ ...report, findings: [] }, options), {
    status: "compliant",
    policy: fail.policy,
    violations: 0,
    reason: null,
  });
  assert.match(fail.policy, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(fail), /private|org\.json/);
  assert.equal(
    (await fleetPolicyCompliance(report, { ...options, reference: "missing.json" })).reason,
    "invalid-policy",
  );

  await writeFile(join(root, ".offing.json"), json({ policy: { rules: [{ id: "runtime", severity: "critical" }] } }));
  const rejected = await fleetPolicyCompliance(report, options);
  assert.equal(rejected.reason, "unauthorized-override");
  assert.equal(rejected.status, "invalid");
  assert.doesNotMatch(JSON.stringify(rejected), /private|\.offing|org\.json/);

  await writeFile(
    join(root, "org.json"),
    json({
      ...organization,
      policy: {
        ...organization.policy,
        exceptions: [{ owner: "private owner", reason: "secret text", path: "private/", expires: "2027-03-31" }],
      },
    }),
  );
  const expired = await fleetPolicyCompliance(report, options);
  assert.equal(expired.reason, "expired-exception");
  assert.doesNotMatch(JSON.stringify(expired), /private|secret/);
});

test("published policy templates validate with an active organization and team example", async () => {
  for (const name of ["organization", "team", "exceptions"]) {
    const path = `templates/fleet-policy/${name}.json`;
    const policy = await parseFleetPolicy(await readFile(path, "utf8"), path);
    assert.ok(policy.document.policy.rules?.some(({ id }) => id === "runtime"));
  }
});
