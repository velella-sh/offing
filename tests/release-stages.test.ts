import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflowsDir = resolve(".github/workflows");

async function lineCount(path: string): Promise<number> {
  const text = await readFile(path, "utf8");
  return text.length === 0 ? 0 : text.split(/\r?\n/).length;
}

test("every release workflow file stays at or under 200 lines", async () => {
  const names = (await readdir(workflowsDir)).filter((name) => name === "release.yml" || name.startsWith("release-"));
  assert.ok(names.includes("release.yml"));
  assert.ok(names.length >= 8, "expected the orchestrator plus stage workflows");
  for (const name of names) {
    const path = join(workflowsDir, name);
    assert.equal((await stat(path)).isFile(), true);
    const lines = await lineCount(path);
    assert.ok(lines <= 200, `${name} has ${lines} lines (limit 200)`);
  }
});

test("release.yml calls verify, build, publish-per-channel, and smoke stages", async () => {
  const orchestrator = parse(await readFile(join(workflowsDir, "release.yml"), "utf8")) as {
    on: {
      push?: { branches?: string[]; tags?: string[] };
      workflow_dispatch: { inputs: Record<string, { type?: string; default?: boolean }> };
      workflow_run?: unknown;
    };
    jobs: Record<string, { uses?: string; if?: string; needs?: string | string[] }>;
  };
  assert.equal(orchestrator.on.workflow_dispatch.inputs.dry_run?.type, "boolean");
  assert.equal(orchestrator.on.workflow_dispatch.inputs.dry_run?.default, false);

  const expected = {
    "publish-npm": "./.github/workflows/publish.yml",
    verify: "./.github/workflows/release-verify.yml",
    "build-action": "./.github/workflows/release-build-action.yml",
    "build-binaries": "./.github/workflows/release-build-binaries.yml",
    "publish-tags": "./.github/workflows/release-publish-tags.yml",
    "publish-container": "./.github/workflows/release-publish-container.yml",
    "publish-binaries": "./.github/workflows/release-publish-binaries.yml",
    sbom: "./.github/workflows/release-sbom.yml",
    smoke: "./.github/workflows/release-smoke.yml",
  };
  for (const [job, uses] of Object.entries(expected)) {
    assert.equal(orchestrator.jobs[job]?.uses, uses, job);
  }
  assert.deepEqual(orchestrator.jobs["publish-npm"]!.needs, ["npm-publish"]);
  assert.match(orchestrator.jobs["publish-npm"]!.if ?? "", /!cancelled\(\).*needs\.npm-publish\.result == 'success'/);
  assert.deepEqual(orchestrator.jobs["publish-binaries"]!.needs, ["publish-npm", "build-binaries"]);
  assert.deepEqual(orchestrator.jobs.sbom!.needs, ["publish-binaries"]);

  for (const job of [
    "publish-npm",
    "verify",
    "build-action",
    "build-binaries",
    "publish-tags",
    "publish-container",
    "publish-binaries",
    "smoke",
  ]) {
    assert.match(orchestrator.jobs[job]!.if ?? "", /dry_run|workflow_dispatch|push|refs\/tags/, job);
  }
  assert.doesNotMatch(
    JSON.stringify(orchestrator.on),
    /workflow_run/,
    "the chain is one workflow run, not workflow_run",
  );
  assert.match(orchestrator.jobs["build-action"]!.if ?? "", /inputs\.dry_run/);
  assert.match(orchestrator.jobs.smoke!.if ?? "", /inputs\.dry_run/);
  assert.match(orchestrator.jobs["publish-container"]!.if ?? "", /inputs\.dry_run/);
  assert.match(orchestrator.jobs["build-binaries"]!.if ?? "", /inputs\.dry_run/);
  assert.match(orchestrator.jobs["publish-binaries"]!.if ?? "", /inputs\.dry_run/);
  assert.match(orchestrator.jobs["publish-tags"]!.if ?? "", /inputs\.dry_run/);
  assert.match(orchestrator.jobs["publish-npm"]!.if ?? "", /inputs\.dry_run/);
});

test("a dry run passes dry_run into every stage and publishes nothing from those stages", async () => {
  const files = [
    "publish.yml",
    "release-verify.yml",
    "release-attest.yml",
    "release-build-action.yml",
    "release-build-binaries.yml",
    "release-publish-tags.yml",
    "release-publish-container.yml",
    "release-publish-binaries.yml",
    "release-smoke.yml",
  ];
  for (const name of files) {
    const workflow = parse(await readFile(join(workflowsDir, name), "utf8")) as {
      on: { workflow_call: { inputs: Record<string, { type?: string }> } };
      jobs: Record<string, { steps?: Array<{ if?: string; run?: string }>; if?: string }>;
    };
    assert.equal(workflow.on.workflow_call.inputs.dry_run?.type, "boolean", name);
  }

  const publish = parse(await readFile(join(workflowsDir, "publish.yml"), "utf8"));
  assert.equal(publish.jobs["dry-run"].if, "inputs.dry_run");
  assert.deepEqual(publish.permissions, {});
  assert.deepEqual(
    Object.keys(publish.jobs)
      .filter((name) => name !== "dry-run")
      .sort(),
    ["registry", "smoke", "verify-provenance"],
  );
  for (const name of ["registry", "smoke", "verify-provenance"]) {
    assert.match(publish.jobs[name].if, /!inputs\.dry_run/);
  }

  const action = await readFile(join(workflowsDir, "release-build-action.yml"), "utf8");
  assert.match(action, /!inputs\.dry_run/);
  assert.match(action, /git push origin "HEAD:refs\/heads\/release\/v\$VERSION"/);

  const container = await readFile(join(workflowsDir, "release-publish-container.yml"), "utf8");
  assert.match(container, /!inputs\.dry_run/);
  assert.match(container, /push: true/);

  const binaries = await readFile(join(workflowsDir, "release-publish-binaries.yml"), "utf8");
  assert.match(binaries, /!inputs\.dry_run/);
  assert.match(binaries, /gh release upload/);

  const tags = await readFile(join(workflowsDir, "release-publish-tags.yml"), "utf8");
  assert.match(tags, /DRY_RUN != 'true'/);
  assert.match(tags, /git push origin "refs\/tags\/\$MAJOR_TAG"/);
});

test("lifecycle signing is tag-only and the release verifies on a separate fresh consumer", async () => {
  const sbom = parse(await readFile(join(workflowsDir, "release-sbom.yml"), "utf8"));
  const chain = sbom.jobs;
  assert.equal(chain.attest.needs, "sbom");
  assert.equal(chain.attest.uses, "./.github/workflows/release-attest.yml");
  assert.equal(chain["verify-attestation"].needs, "attest");
  assert.equal(chain["verify-attestation"].uses, "./.github/workflows/release-verify.yml");
  assert.equal(chain["verify-attestation"].with.run_lifecycle, true);
  assert.equal(chain["verify-attestation"].with.dry_run, "${{ inputs.dry_run }}");

  const attest = parse(await readFile(join(workflowsDir, "release-attest.yml"), "utf8"));
  assert.deepEqual(attest.permissions, { contents: "read" });
  const { sign } = attest.jobs;
  assert.equal(sign.needs, "prepare");
  assert.match(sign.if, /!inputs\.dry_run.*github\.event_name == 'push'.*refs\/tags\/v/);
  assert.equal(sign.permissions.attestations, "write");
  assert.equal(sign.permissions["id-token"], "write");

  const verifier = parse(await readFile(join(workflowsDir, "release-verify.yml"), "utf8"));
  const steps = verifier.jobs.lifecycle.steps as Array<{ if?: string; run?: string; uses?: string }>;
  assert.ok(steps.every((step) => !step.uses?.includes("actions/checkout")));
  const signed = steps.find(({ run }) => run?.includes("gh attestation verify"));
  assert.match(signed?.if ?? "", /!inputs\.dry_run/);
  assert.match(signed?.run ?? "", /--signer-workflow.*--source-ref.*--source-digest/);
  assert.match(signed?.run ?? "", /verify-blob-attestation.*--check-claims=true/);
  assert.match(signed?.run ?? "", /verify_gh tampered\.tgz \|\| verify_cosign tampered\.tgz/);
});

test("release publication and consumer workflows wire the same opt-in lifecycle gate", async () => {
  const release = parse(await readFile(join(workflowsDir, "release.yml"), "utf8"));
  const steps = release.jobs["npm-publish"].steps as Array<{ run?: string; env?: Record<string, string> }>;
  const gateIndex = steps.findIndex(({ run }) => run === "bash .github/scripts/release-gate.sh");
  assert.ok(gateIndex > 0);
  assert.ok(steps.findIndex(({ run }) => run?.includes("npm publish")) > gateIndex);
  assert.match(
    steps[gateIndex]?.env?.USE_BLOCKED_FIXTURE ?? "",
    /workflow_dispatch.*inputs.dry_run.*inputs.release_gate_fixture/,
  );
  const script = await readFile(".github/scripts/release-gate.sh", "utf8");
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /npm sbom --omit=dev --sbom-format=cyclonedx --package-lock-only/);

  const consumer = parse(await readFile("templates/workflows/offing-release-gate.yml", "utf8"));
  assert.deepEqual(consumer.permissions, { contents: "read" });
  assert.deepEqual(consumer.on, { release: { types: ["published"] }, push: { tags: ["v*"] } });
  assert.equal(consumer.jobs.lifecycle.steps[1].with["release-gate-days"], "30");
});
