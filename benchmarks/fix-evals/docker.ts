import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { runApprovedTest } from "../../src/test-runners/run.js";
import { type Profile, profiles } from "./profiles.js";

type Command = Parameters<typeof runApprovedTest>[0];
type Executor = Parameters<typeof runApprovedTest>[1];
type Docker = Awaited<ReturnType<typeof connectDocker>>;
const execute = promisify(execFile);
const platform = "linux/amd64";
const captureLimit = 8 * 1024 * 1024;
const script = 'mkdir /work/tree && tar -xf - -C /work/tree && cd /work/tree && exec timeout -k 5s 130s "$@"';

export async function connectDocker(config: string) {
  const sockets = [join(homedir(), ".docker/run/docker.sock"), "/var/run/docker.sock"];
  for (const socket of sockets) {
    if (!(await stat(socket).catch(() => null))?.isSocket()) continue;
    return (args: string[], signal?: AbortSignal) =>
      execute("docker", ["--host", `unix://${socket}`, ...args], {
        env: { PATH: process.env.PATH, DOCKER_CONFIG: config },
        encoding: "buffer",
        maxBuffer: captureLimit,
        ...(signal ? { signal } : { timeout: 180_000 }),
      });
  }
  throw new Error("A local Docker daemon is required. Start Docker and run again.");
}

export async function prepareImage(docker: Docker, profile: Profile, dockerfile: string): Promise<string> {
  const { image } = profiles[profile];
  if (profile !== "kubernetes") {
    await docker(["pull", "--platform", platform, image]);
    return image;
  }
  const child = docker(["build", "--platform", platform, "--network", "none", "--quiet", "-"]);
  child.child.stdin?.on("error", () => {});
  child.child.stdin?.end(dockerfile);
  const id = (await child).stdout.toString().trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(id)) throw new Error("Kubeconform image build did not return an immutable ID.");
  return id;
}

export async function archiveTree(root: string): Promise<Buffer> {
  const { stdout } = await execute("tar", ["-cf", "-", "-C", root, "."], {
    env: { PATH: process.env.PATH, COPYFILE_DISABLE: "1" },
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout;
}

/** No mounts, Docker socket, network, secrets, or host state are exposed to the case. */
export function dockerArgs(name: string, image: string, command: Command): string[] {
  return [
    "run",
    "--name",
    name,
    "--rm",
    "--pull=never",
    "--platform",
    platform,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/work:rw,exec,nosuid,nodev,mode=1777,size=768m",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,mode=1777,size=128m",
    "--user",
    "65532:65532",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "128",
    "--memory",
    "1024m",
    "--memory-swap",
    "1024m",
    "--cpus",
    "2",
    "--log-driver",
    "none",
    "--env",
    "HOME=/tmp",
    "--env",
    "GOTOOLCHAIN=local",
    "--env",
    "PIP_NO_INDEX=1",
    "--env",
    "TF_IN_AUTOMATION=1",
    "--entrypoint",
    "/bin/sh",
    "-i",
    image,
    "-ec",
    script,
    "sh",
    ...command,
  ];
}

function commandFailure(error: unknown): { exitCode: number; stdout: Buffer; stderr: Buffer } | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number" &&
    error.code !== 125 &&
    "stdout" in error &&
    Buffer.isBuffer(error.stdout) &&
    "stderr" in error &&
    Buffer.isBuffer(error.stderr)
  )
    return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
  return null;
}

export function sandbox(docker: Docker, image: string, source: Buffer): Executor {
  return async (command, output) => {
    const name = `offing-fix-eval-${randomUUID()}`;
    const child = docker(dockerArgs(name, image, command), output.signal);
    child.child.stdin?.on("error", () => {});
    child.child.stdin?.end(source);
    try {
      const result = await child.then(
        ({ stdout, stderr }) => ({ stdout, stderr, exitCode: 0 }),
        (error: unknown) => {
          const failure = commandFailure(error);
          if (failure) return failure;
          // execFile includes collected bytes when Docker is aborted. Preserve the partial log.
          if (output.signal.aborted && typeof error === "object" && error !== null) {
            if ("stdout" in error && Buffer.isBuffer(error.stdout)) output.stdout(error.stdout);
            if ("stderr" in error && Buffer.isBuffer(error.stderr)) output.stderr(error.stderr);
          }
          throw new Error("Docker runner failed before completing its command.", { cause: error });
        },
      );
      output.stdout(result.stdout);
      output.stderr(result.stderr);
      return { exitCode: result.exitCode };
    } finally {
      if (output.signal.aborted || child.child.exitCode === null || child.child.exitCode === 125) {
        await docker(["rm", "--force", name], AbortSignal.timeout(10_000)).catch(() => {});
      }
    }
  };
}
