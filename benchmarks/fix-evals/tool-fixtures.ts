import assert from "node:assert/strict";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  archiveTree,
  connectDocker,
  prepareImage,
  sandbox,
  type ContainerExecutor,
} from "../../src/test-runners/docker.js";
import { parseJUnit } from "../../src/test-runners/junit.js";
import { type Profile, profiles } from "../../src/test-runners/profiles.js";
import { fixtureSource, tempSource } from "./source.js";

type Command = Parameters<ContainerExecutor>[0];
type ToolCase = {
  profile?: Profile;
  image?: string;
  setup: readonly Command[];
  command: Command;
  names: readonly RegExp[];
};

const python = "./.offing-venv/bin/python";
const pythonSetup: readonly Command[] = [
  ["python3", "-m", "venv", ".offing-venv"],
  [python, "-m", "pip", "install", "--no-deps", "--find-links", ".wheelhouse", "-r", "requirements.txt"],
];
const corepackSetup: Command = ["corepack", "install", "-g", "--cache-only", ".offing-corepack.tgz"];
const nodeNames = [/ok 1 - passing example/, /not ok 2 - failing example/];
const cases = {
  npm: {
    profile: "npm",
    setup: [["npm", "ci", "--offline", "--no-audit", "--no-fund"]],
    command: ["npm", "test"],
    names: nodeNames,
  },
  pnpm: {
    profile: "npm",
    setup: [corepackSetup, ["corepack", "pnpm", "install", "--offline", "--frozen-lockfile"]],
    command: ["corepack", "pnpm", "test"],
    names: nodeNames,
  },
  yarn: {
    profile: "npm",
    setup: [corepackSetup, ["corepack", "yarn", "install", "--immutable"]],
    command: ["corepack", "yarn", "test"],
    names: nodeNames,
  },
  pytest: {
    profile: "python",
    setup: pythonSetup,
    command: [python, "-m", "pytest", "-v", "--junitxml=.offing-junit.xml"],
    names: [/test_passing_example PASSED/, /test_failing_example FAILED/],
  },
  tox: {
    profile: "python",
    setup: pythonSetup,
    command: [python, "-m", "tox"],
    names: [/test_passing_example.*ok/, /test_failing_example.*FAIL/],
  },
  go: {
    profile: "go",
    setup: [],
    command: ["go", "test", "-mod=vendor", "-v", "./..."],
    names: [/PASS: TestPassingExample/, /FAIL: TestFailingExample/],
  },
  maven: {
    profile: "java",
    setup: [],
    command: profiles.java.test,
    names: [/Tests run: 2, Failures: 1/, /failingExample/],
  },
  gradle: {
    image: "docker.io/library/gradle@sha256:20b50a53c1d216f54da635643e26066e41f4c647f770bdf3179e6fa1b2a25d8d",
    setup: [],
    command: ["sh", "./gradlew", "--offline", "-g", "/tmp/.gradle", "--no-daemon", "--console=plain", "test"],
    names: [/2 tests completed, 1 failed/, /failingExample/],
  },
  dotnet: {
    image: "mcr.microsoft.com/dotnet/sdk@sha256:8c6edfb26c85153f236d26efebd9ad349aec403583f343f201ee67838b23658d",
    setup: [["dotnet", "restore", "--source", ".offline-nuget"]],
    command: ["dotnet", "test", "--no-restore"],
    names: [/Passed:\s+1/, /Failed:\s+1/],
  },
} as const satisfies Record<string, ToolCase>;
type Tool = keyof typeof cases;

export function isFixtureTool(value: string): value is Tool {
  return Object.hasOwn(cases, value);
}

function requireCache(name: string): string {
  const path = process.env[name];
  assert.ok(path, "Set " + name + " to the dedicated fixture dependency cache.");
  return path;
}

async function stageCache(root: string, tool: Tool) {
  if (tool === "pytest" || tool === "tox") {
    const wheels = join(requireCache("OFFING_FIXTURE_WHEELHOUSES"), tool);
    await cp(wheels, join(root, ".wheelhouse"), { recursive: true });
  }
  if (tool === "pnpm" || tool === "yarn") {
    const packed = join(requireCache("OFFING_FIXTURE_COREPACK"), tool + ".tgz");
    await cp(packed, join(root, ".offing-corepack.tgz"));
  }
  if (tool === "maven") {
    await mkdir(join(root, ".m2"));
    await cp(requireCache("OFFING_FIXTURE_MAVEN_REPOSITORY"), join(root, ".m2/repository"), { recursive: true });
  }
  if (tool === "gradle") {
    const artifacts = requireCache("OFFING_FIXTURE_MAVEN_REPOSITORY");
    await mkdir(join(root, "lib"));
    await cp(join(artifacts, "junit/junit/4.13.2/junit-4.13.2.jar"), join(root, "lib/junit-4.13.2.jar"));
    await cp(
      join(artifacts, "org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar"),
      join(root, "lib/hamcrest-core-1.3.jar"),
    );
  }
  if (tool === "dotnet") {
    await cp(requireCache("OFFING_FIXTURE_NUGET_REPOSITORY"), join(root, ".offline-nuget"), { recursive: true });
  }
}

async function exerciseTool(tool: Tool, root: string, docker: Awaited<ReturnType<typeof connectDocker>>) {
  await fixtureSource(root, join("tests/fixtures/test-runners", tool));
  await stageCache(root, tool);
  const fixture: ToolCase = cases[tool];
  const image = fixture.profile ? await prepareImage(docker, fixture.profile, "") : fixture.image;
  assert.ok(image, "Expected a pinned tool image.");
  if (!fixture.profile) {
    await docker(["pull", "--platform", "linux/amd64", image]);
  }
  const execute = sandbox(docker, image, await archiveTree(root), fixture.setup);
  const chunks: Uint8Array[] = [];
  const capture = (chunk: Uint8Array) => {
    chunks.push(chunk);
  };
  const result = await execute(
    fixture.command,
    { signal: AbortSignal.timeout(120_000), stdout: capture, stderr: capture },
    true,
  );
  const log = Buffer.concat(chunks).toString("utf8");
  assert.equal(result.exitCode, 1, log);
  for (const expected of fixture.names) assert.match(log, expected);
  const totals = (result.reports ?? []).flatMap((report) => parseJUnit(report, new Set())?.totals ?? []);
  console.log(JSON.stringify({ tool, image, passed: 1, intentionallyFailed: 1, totals }));
}

/** Run the controlled positive and negative cases through each actual test tool. */
export async function proveTestTools(target?: Tool): Promise<void> {
  const selected = (Object.keys(cases) as Tool[]).filter((tool) => !target || tool === target);
  await tempSource(async (config) => {
    const docker = await connectDocker(config);
    for (const tool of selected) await tempSource((root) => exerciseTool(tool, root, docker));
  });
}
