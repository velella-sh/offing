import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const [installed] = process.argv.slice(2);
if (!installed) throw new Error("Usage: node acc-launch-docs.mjs <installed offing bin>");
const bin = resolve(installed);
const root = mkdtempSync(join(tmpdir(), "offing-launch-guides-"));
const home = join(root, "home");
mkdirSync(home);
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
  EBB_DATA_DIR: join(root, "ebb"),
  OFFING_CACHE_DIR: join(root, "cache"),
  OFFING_DATA_VERSION: "bundled",
};

function run(cwd, args, status = 0, options = {}) {
  const result = spawnSync(bin, args, { cwd, env, encoding: "utf8", timeout: 15_000, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, status, `${args.join(" ")}: ${result.stderr}`);
  return result;
}

function checkAutopilotPreview() {
  const project = join(root, "autopilot");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify({ dependencies: { request: "2.88.2" } }));
  writeFileSync(join(project, ".offing.json"), JSON.stringify({ autopilot: { tests: [["node", "tests/check.cjs"]] } }));
  const result = run(project, ["autopilot", ".", "--dry-run", "--wave", "0"]).stdout;
  assert.match(result, /Plan: wave 0[\s\S]*request is deprecated/);
  assert.match(result, /\["node","tests\/check\.cjs"\]/);
}

function checkUnsignedAttestation() {
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    components: [{ type: "platform", name: "Alpine 3.18", purl: "pkg:docker/library/alpine@3.18" }],
  };
  writeFileSync(join(root, "artifact.tgz"), "launch guide sample artifact\n");
  writeFileSync(join(root, "bom.cdx.json"), JSON.stringify(sbom));
  const statement = run(root, [
    "attest", "--subject", "artifact.tgz", "--sbom", "bom.cdx.json", "--data-version", "bundled",
  ]);
  writeFileSync(join(root, "lifecycle.intoto.json"), statement.stdout);
  const result = run(root, [
    "attest", "check", "lifecycle.intoto.json", "--subject", "artifact.tgz", "--today", "2026-03-31",
  ]);
  assert.match(result.stdout, /alpine@3\.18[^\n]*: 1 days? left/u);
}

function checkRecordedFleet() {
  const project = join(root, "fleet-guide");
  const fixture = "tests/fixtures/campaign-20";
  mkdirSync(join(project, fixture), { recursive: true });
  for (const name of ["fleet.json", "campaign.json", "plan.json"]) {
    cpSync(new URL(`../../${fixture}/${name}`, import.meta.url), join(project, fixture, name));
  }
  const fleet = `${fixture}/fleet.json`;
  const campaign = `${fixture}/campaign.json`;
  const recorded = JSON.parse(readFileSync(join(project, fleet), "utf8"));
  assert.equal(recorded.forecastAsOf, "2026-11-27");
  assert.equal(recorded.repositoryStatus.length, 20);
  assert.equal(new Set(recorded.repositoryStatus.map(({ commit }) => commit)).size, 20);
  assert.ok(recorded.repositoryStatus.every(({ status }) => status === "scanned"));
  const forecast = ["forecast", "--fleet", fleet, "--by", "owner"];
  const captured = run(project, forecast).stdout;
  assert.match(captured, /as of 2026-11-27 \(by owner\)/u);
  assert.deepEqual(captured.match(/0–3 months: \d+/gu), ["0–3 months: 0", "0–3 months: 0"]);
  const historical = run(project, [...forecast, "--as-of", "2025-03-01"]).stdout;
  assert.match(historical, /as of 2025-03-01 \(by owner\)/u);
  assert.match(historical, /@fixture\/platform[\s\S]*?0–3 months: 6/u);
  assert.match(historical, /@fixture\/runtime[\s\S]*?0–3 months: 14/u);
  const plan = run(project, ["campaign", "plan", campaign, "--fleet", fleet, "--json"]).stdout;
  assert.deepEqual(JSON.parse(plan), JSON.parse(readFileSync(join(project, fixture, "plan.json"), "utf8")));
  writeFileSync(join(project, "campaign-state.json"), plan);
  const status = run(project, ["campaign", "status", "campaign-state.json"]).stdout;
  assert.match(status, /Target: nodejs@22/u);
  assert.equal(status.match(/· queued$/gmu)?.length, 20);
  console.log("acc-launch-docs: one pinned Fleet capture replayed both owner windows and the exact four-batch Campaign plan");
}

function checkReadmeQuickstart() {
  const readme = readFileSync(resolve(dirname(realpathSync(bin)), "../../README.md"), "utf8");
  const block = readme.match(/^## Quickstart[\s\S]*?```bash\n([^`]+)```/m)?.[1];
  assert.ok(block, "The packed README has a quickstart shell block");
  const commands = block.trim().split("\n").map((line) => {
    const prefix = "npx --yes @velella/offing ";
    assert.ok(line.startsWith(prefix), line);
    return line.slice(prefix.length).split(" ");
  });
  assert.equal(commands.length, 3);
  const project = join(root, "readme");
  cpSync(new URL("../../examples/demo/", import.meta.url), project, { recursive: true });
  const manifest = join(project, "package.json");
  cpSync(join(project, "package.json.fixture"), manifest);
  assert.equal(spawnSync("git", ["init", "-q", project]).status, 0);
  assert.match(run(project, commands[0]).stdout, /actions\/checkout/);
  assert.match(run(project, commands[1]).stdout, /Forecast from \d{4}-\d{2}-\d{2}/);
  assert.match(run(project, commands[2]).stdout, /Would create \.git\/hooks\/pre-push/);
  assert.equal(existsSync(join(project, ".git/hooks/pre-push")), false);
  console.log("acc-readme: packed quickstart scanned the fixture, forecast deadlines, and previewed the Git hook");
}

try {
  checkReadmeQuickstart();
  const forecast = join(root, "forecast");
  cpSync(new URL("../../examples/forecast/actions-before/", import.meta.url), forecast, { recursive: true });
  const output = run(forecast, ["forecast", ".", "--as-of", "2026-08-01", "--months", "3"]).stdout;
  assert.match(output, /Forecast from 2026-08-01 to 2026-11-01/);
  assert.match(output, /github-actions\.checkout\.node20\)[^\n]*\n\s+\.github\/workflows\/build\.yml:7/);
  assert.match(run(root, ["check", "pkg:npm/express@4.18.0", "--data-version", "bundled"]).stdout, /Status: no-data/);
  assert.match(run(root, ["check", "pkg:npm/request@2.88.2", "--data-version", "bundled"], 1).stdout, /request is deprecated/);
  assert.match(run(root, ["data", "status", "--data-version", "bundled"]).stdout, /Source: bundled/);
  run(root, ["--version"]);
  run(root, ["init", "--hooks", "--list"]);

  const guardBin = join(root, "bin");
  mkdirSync(guardBin);
  writeFileSync(join(guardBin, "npm"), "#!/bin/sh\ntouch npm-ran\n", { mode: 0o755 });
  const guard = run(root, ["guard", "--data-version", "bundled", "npm", "install", "--dry-run", "--offline", "request@2.88.2"], 1, {
    env: { ...env, PATH: `${guardBin}${delimiter}${env.PATH}` },
  });
  assert.match(guard.stderr, /refused to run npm[\s\S]*https:\/\/www\.npmjs\.com\/package\/request/);
  assert.equal(existsSync(join(root, "npm-ran")), false);

  for (const [host, file] of [
    ["claude-code", ".claude/settings.json"],
    ["codex", ".codex/hooks.json"],
    ["cursor", ".cursor/hooks.json"],
  ]) {
    const project = join(root, host);
    const config = join(project, file);
    mkdirSync(dirname(config), { recursive: true });
    run(project, ["init", "--hooks-for", host]);
    const cursor = host === "cursor";
    const event = cursor ? "preToolUse" : "PreToolUse";
    const { hooks } = JSON.parse(readFileSync(config, "utf8"));
    for (const hookEvent of [event, cursor ? "afterFileEdit" : "PostToolUse"]) {
      const entries = cursor ? hooks[hookEvent] : hooks[hookEvent]?.flatMap((entry) => entry.hooks);
      assert.ok(entries?.some(({ command }) => command === `offing hook ${host}`), `${host}: ${hookEvent}`);
    }
    const codex = host === "codex";
    const input = JSON.stringify({
      cwd: project,
      hook_event_name: event,
      tool_name: codex ? "apply_patch" : "Write",
      tool_input: codex
        ? { command: "*** Begin Patch\n*** Add File: test.js\n+const value = new Buffer(9);\n*** End Patch" }
        : { file_path: "test.js", content: "const value = new Buffer(9);" },
    });
    const result = run(project, ["hook", host], cursor ? 0 : 2, { input });
    if (cursor) assert.equal(JSON.parse(result.stdout).permission, "deny");
    assert.match(cursor ? result.stdout : result.stderr, /test\.js:1[\s\S]*Buffer\.alloc/, host);
    assert.equal(existsSync(join(project, "test.js")), false);
    run(project, ["init", "--hooks", "--remove", "--hooks-for", host]);
    assert.ok(!readFileSync(config, "utf8").includes(`offing hook ${host}`), host);
  }
  checkAutopilotPreview();
  checkUnsignedAttestation();
  checkRecordedFleet();
  console.log("acc-launch-docs: packed Autopilot preview and unsigned lifecycle attestation examples passed");
  console.log("acc-launch-docs: installed forecast, dependency refusal, data status, and three host setup/replay/removal flows passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
