import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { childEnvironments } from "../autopilot/limits/secrets.js";
import { invalidCampaign } from "./document.js";
import type { HostTarget } from "./host-config.js";

const execute = promisify(execFile);

function isolatedGit(directory: string) {
  // Git for Windows rejects Node's null-device path when opening a global config file.
  const hooks = join(directory, "unused-hooks");
  const env = {
    ...childEnvironments(process.env, "replay", []).tests,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(directory, "unused-global-git-config"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
  };
  const run = (args: string[], operationEnv = env) =>
    execute(
      "git",
      [
        "-c",
        `core.hooksPath=${hooks}`,
        "-c",
        "credential.helper=",
        "-c",
        "protocol.allow=never",
        "-c",
        "http.followRedirects=false",
        ...args,
      ],
      { cwd: directory, env: operationEnv, timeout: 60_000, maxBuffer: 256 * 1024, windowsHide: true },
    );
  return { env, run };
}

function pushAuthorization(target: HostTarget) {
  const username = target.gitlab ? "oauth2" : "x-access-token";
  const authorization = Buffer.from(username + ":" + target.token).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: "Authorization: Basic " + authorization,
  };
}

export async function createCampaignBranch(
  target: HostTarget,
  checkout: string,
  base: string,
  head: string,
  branch: string,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "offing-campaign-push-"));
  const { env, run: git } = isolatedGit(directory);
  try {
    await git(["init", "--bare", "--template=", "--object-format=" + (head.length === 64 ? "sha256" : "sha1")]);
    await git([
      "-c",
      "protocol.file.allow=always",
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--",
      checkout,
      head,
    ]);
    await git(["merge-base", "--is-ancestor", base, head]);
    const remote = new URL(target.repo + ".git", target.origin);
    const ref = "refs/heads/" + branch;
    // The empty lease is an atomic assertion that the destination ref does not exist.
    await git(
      [
        "-c",
        "protocol.https.allow=always",
        "-c",
        "protocol.http.allow=always",
        "push",
        "--porcelain",
        "--no-verify",
        `--force-with-lease=${ref}:`,
        "--",
        remote.href,
        `${head}:${ref}`,
      ],
      { ...env, ...pushAuthorization(target) },
    );
  } catch {
    throw invalidCampaign("Campaign could not create its branch. Existing refs were preserved.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
