import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { childEnvironments } from "../autopilot/limits/secrets.js";
import { MAXIMUM_INPUT_BYTES } from "../detectors/dotnet/msbuild-xml.js";
import { type Profile, profiles } from "./profiles.js";
import type { runApprovedTest } from "./run.js";

type Command = Parameters<typeof runApprovedTest>[0];
type TestExecutor = Parameters<typeof runApprovedTest>[1];
type CommandOutput = Parameters<TestExecutor>[1];
export type ContainerExecutor = (
  command: Command,
  output: CommandOutput,
  collectReports: boolean,
  attempt?: 1 | 2,
) => ReturnType<TestExecutor>;
type Docker = Awaited<ReturnType<typeof connectDocker>>;
const execute = promisify(execFile);
const platform = "linux/amd64";
const captureLimit = 8 * 1024 * 1024;
const worktree = "/work/tree";
const reportLimit = 32;

export async function connectDocker(config: string) {
  const sockets = [join(homedir(), ".docker/run/docker.sock"), "/var/run/docker.sock"];
  const { tests } = childEnvironments(process.env, "replay", []);
  for (const socket of sockets) {
    if (!(await stat(socket).catch(() => null))?.isSocket()) continue;
    return (args: string[], signal?: AbortSignal) =>
      execute("docker", ["--host", `unix://${socket}`, ...args], {
        env: { ...tests, DOCKER_CONFIG: config },
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
    const installed = await docker(["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image]).catch(
      () => null,
    );
    if (installed?.stdout.toString().trim() !== platform) await docker(["pull", "--platform", platform, image]);
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
  const { stdout } = await execute("tar", ["-cf", "-", "--no-xattrs", "--exclude=.git", "-C", root, "."], {
    env: { PATH: process.env.PATH, COPYFILE_DISABLE: "1" },
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout;
}

/** No mounts, Docker socket, network, secrets, or host state are exposed to the case. */
export function dockerArgs(name: string, image: string): string[] {
  return [
    "run",
    "--name",
    name,
    "--rm",
    "--detach",
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
    "COREPACK_ENABLE_NETWORK=0",
    "--env",
    "TF_IN_AUTOMATION=1",
    "--entrypoint",
    "/bin/sh",
    image,
    "-ec",
    "exec sleep 150",
  ];
}

export function dockerExecArgs(name: string, command: Command, attempt?: 1 | 2): string[] {
  const metadata = attempt === undefined ? [] : ["--env", "OFFING_TEST_ATTEMPT=" + attempt];
  return ["exec", ...metadata, "--workdir", worktree, name, "timeout", "-k", "5s", "130s", ...command];
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

const readReports = `
count=0
for report in junit.xml .offing-junit.xml target/surefire-reports/TEST-*.xml \
  */target/surefire-reports/TEST-*.xml build/test-results/test/TEST-*.xml \
  */build/test-results/test/TEST-*.xml TestResults/junit.xml TestResults/*/junit.xml
do
  [ -f "$report" ] && [ ! -L "$report" ] || continue
  [ "$(realpath "./$report")" = "/work/tree/$report" ] || continue
  count=$((count + 1))
  [ "$count" -le "$1" ] || exit 1
  head -c "$2" -- "$report"
  printf '\\000'
done`;

async function captureReports(docker: Docker, name: string, signal: AbortSignal): Promise<string[] | undefined> {
  const args = [
    "exec",
    "--workdir",
    worktree,
    name,
    "sh",
    "-ec",
    readReports,
    "sh",
    String(reportLimit),
    String(MAXIMUM_INPUT_BYTES + 1),
  ];
  const result = await docker(args, signal).catch(() => undefined);
  if (!result) return undefined;
  const { stdout } = result;
  if (stdout.length === 0) return [];
  const raw = stdout.toString("utf8").split("\0");
  if (raw.pop() !== "" || raw.length > reportLimit) return undefined;
  return raw.every((report) => Buffer.byteLength(report) <= MAXIMUM_INPUT_BYTES) ? raw : undefined;
}

async function executeCommand(docker: Docker, name: string, command: Command, output: CommandOutput, attempt?: 1 | 2) {
  const child = docker(dockerExecArgs(name, command, attempt), output.signal);
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
  return result.exitCode;
}

export function sandbox(
  docker: Docker,
  image: string,
  source: Buffer,
  setup: readonly Command[] = [],
): ContainerExecutor {
  return async (command, output, collectReports, attempt) => {
    const name = `offing-fix-eval-${randomUUID()}`;
    try {
      await docker(dockerArgs(name, image), output.signal);
      const unpack = docker(
        ["exec", "-i", name, "sh", "-ec", "mkdir -p /work/tree && tar -xf - -C /work/tree"],
        output.signal,
      );
      unpack.child.stdin?.on("error", () => {});
      unpack.child.stdin?.end(source);
      await unpack;
      for (const prerequisite of setup) {
        const exitCode = await executeCommand(docker, name, prerequisite, output);
        if (exitCode !== 0) return { exitCode };
      }
      const previous = collectReports ? await captureReports(docker, name, output.signal) : undefined;
      const exitCode = await executeCommand(docker, name, command, output, attempt);
      if (!previous) return { exitCode };
      const priorReports = new Set(previous);
      const reports = await captureReports(docker, name, output.signal);
      return { exitCode, reports: reports?.filter((report) => !priorReports.has(report)) ?? [] };
    } finally {
      await docker(["rm", "--force", name], AbortSignal.timeout(10_000)).catch(() => {});
    }
  };
}
