import assert from "node:assert/strict";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { archiveTree, connectDocker, prepareImage, sandbox } from "../../src/test-runners/docker.js";
import { type Profile, profiles } from "../../src/test-runners/profiles.js";
import { runApprovedTest } from "../../src/test-runners/run.js";
import { fixtureSource, tempSource } from "./source.js";

const cases = {
  npm: ["fix-evals/green", "passed"],
  python: ["test-runners/pytest", "failed"],
  go: ["test-runners/go", "failed"],
  java: ["test-runners/maven", "failed"],
  terraform: ["fix-evals/terraform"],
  kubernetes: ["fix-evals/kubernetes"],
  "github-actions": ["fix-evals/github-actions"],
} as const satisfies Record<Profile, readonly [fixture: string, test?: "passed" | "failed"]>;

function assertStatus(
  profile: Profile,
  check: string,
  result: Awaited<ReturnType<typeof runApprovedTest>>,
  expected: string,
) {
  const attempt = result.attempts.at(-1);
  assert.ok(attempt);
  const logs = attempt.logs.stdout.tail + attempt.logs.stderr.tail;
  assert.equal(attempt.status, expected, profile + " " + check + "\n" + logs);
  if (expected === "failed") assert.match(logs, /intentional fixture failure|test_failing_example|failingExample/);
  return {
    status: attempt.status,
    totals: attempt.totals,
    hashes: [attempt.logs.stdout.sha256, attempt.logs.stderr.sha256],
  };
}

/** Exercise the seven pinned profiles against Offing's own source fixtures. */
export async function proveRunnerProfiles(target?: Profile): Promise<void> {
  const selected = (Object.keys(cases) as Profile[]).filter((profile) => !target || profile === target);
  await tempSource(async (config) => {
    const docker = await connectDocker(config);
    for (const profile of selected) {
      await tempSource(async (root) => {
        const [fixture, expected] = cases[profile];
        await fixtureSource(root, join("tests/fixtures", fixture));
        if (profile === "java") {
          const cache = process.env.OFFING_FIXTURE_MAVEN_REPOSITORY;
          assert.ok(cache, "Set OFFING_FIXTURE_MAVEN_REPOSITORY to a dedicated Maven fixture cache.");
          await mkdir(join(root, ".m2"));
          await cp(cache, join(root, ".m2/repository"), { recursive: true });
        }
        const recipe =
          profile === "kubernetes" ? await readFile("benchmarks/fix-evals/Dockerfile.kubeconform", "utf8") : "";
        const image = await prepareImage(docker, profile, recipe);
        const executor = sandbox(docker, image, await archiveTree(root));
        const commands = profiles[profile];
        const build = await runApprovedTest(commands.build, (argv, output) => executor(argv, output, false), 120_000);
        const result = assertStatus(profile, "build", build, "passed");
        if (expected && "test" in commands) {
          const test = await runApprovedTest(commands.test, (argv, output) => executor(argv, output, true), 120_000);
          console.log(
            JSON.stringify({ profile, image, build: result, test: assertStatus(profile, "test", test, expected) }),
          );
        } else console.log(JSON.stringify({ profile, image, build: result }));
      });
    }
  });
}
