import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Limits } from "../autopilot/limits/config.js";
import { git } from "../migrate/worktree.js";
import { type AgentDriver, type AgentRunInput, makeResult, withRunFiles } from "./contract.js";
import { runProcess } from "./process.js";
import { record } from "./result.js";
import { readMetrics } from "./usage.js";

interface Invocation {
  args: string[];
  input?: string;
  env?: Record<string, string>;
}

interface Vendor {
  binary: string;
  range: string;
  projectConfig?: readonly string[];
  accepts(version: string): boolean;
  invoke(promptFile: string, input: AgentRunInput): Promise<Invocation> | Invocation;
}

const vendors: Readonly<Record<string, Vendor>> = {
  claude: {
    binary: "claude",
    range: "2.1.330 to <2.2.0",
    accepts: (version) => /^2\.1\.\d+$/.test(version) && Number(version.split(".")[2]) >= 330,
    async invoke(promptFile) {
      return {
        args: [
          "--print",
          "--restricted",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--permission-mode",
          "acceptEdits",
          "--tools",
          "Read,Glob,Grep,Edit,Write",
          "--output-format",
          "json",
          "--no-session-persistence",
        ],
        input: await readFile(promptFile, "utf8"),
      };
    },
  },
  codex: {
    binary: "codex",
    range: "0.171.x (including 0.171.0-alpha.13.2)",
    projectConfig: [".codex"],
    accepts: (version) => /^0\.171\.\d+$/.test(version) || version === "0.171.0-alpha.13.2",
    async invoke(promptFile, input) {
      return {
        args: [
          "-a",
          "never",
          "exec",
          "--ignore-user-config",
          "--disable",
          "hooks",
          "--ephemeral",
          "--sandbox",
          "workspace-write",
          "-C",
          input.worktreePath,
          "-c",
          "sandbox_workspace_write.writable_roots=[]",
          "-c",
          "sandbox_workspace_write.network_access=false",
          "-c",
          "sandbox_workspace_write.exclude_tmpdir_env_var=true",
          "-c",
          "sandbox_workspace_write.exclude_slash_tmp=true",
          "--json",
          "-",
        ],
        input: await readFile(promptFile, "utf8"),
      };
    },
  },
  gemini: {
    binary: "gemini",
    range: "0.71.x",
    projectConfig: [".gemini", ".env"],
    accepts: (version) => /^0\.71\.\d+$/.test(version),
    async invoke(promptFile) {
      return {
        args: [
          "--prompt",
          "",
          "--sandbox",
          "--approval-mode",
          "auto_edit",
          "--extensions",
          "",
          "--output-format",
          "json",
        ],
        input: await readFile(promptFile, "utf8"),
        env: { SANDBOX_MOUNTS: "", SEATBELT_PROFILE: "permissive-closed" },
      };
    },
  },
  aider: {
    binary: "aider",
    range: "0.86.x starting at 0.86.2",
    projectConfig: [".aider.conf.yml", ".env"],
    accepts: (version) => /^0\.86\.\d+$/.test(version) && Number(version.split(".")[2]) >= 2,
    invoke(promptFile, input) {
      return {
        args: [
          "--message-file",
          promptFile,
          "--no-git",
          "--no-gitignore",
          "--no-suggest-shell-commands",
          "--map-tokens",
          "0",
          "--input-history-file",
          join(dirname(promptFile), "input-history"),
          "--chat-history-file",
          join(dirname(promptFile), "chat-history"),
          "--no-auto-commits",
          "--no-dirty-commits",
          "--no-auto-lint",
          "--no-auto-test",
          "--no-stream",
          "--no-check-update",
          "--no-analytics",
          "--disable-playwright",
          ...(input.allowedPaths ?? []).flatMap((file) => ["--file", file]),
        ],
      };
    },
  },
};

async function versionOf(binary: string): Promise<string | null> {
  const output = await runProcess(binary, ["--version"], { cwd: process.cwd(), timeoutMs: 5_000 });
  if (output.exitCode !== 0) return null;
  return (output.stdout + output.stderr).match(/\b\d+\.\d+\.\d+(?:-[\w.]+)?\b/)?.[0] ?? null;
}

async function changedFiles(cwd: string): Promise<string[]> {
  const output = await git(["status", "--porcelain=v1", "--no-renames", "--untracked-files=all", "-z"], cwd);
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .sort();
}

async function checkProjectConfig(root: string, filenames: readonly string[]): Promise<void> {
  for (const file of filenames) {
    const found = await lstat(join(root, file)).catch((error: unknown) => {
      if (record(error)?.code === "ENOENT") return undefined;
      throw error;
    });
    if (found)
      throw new Error(
        `Driver refused repository configuration at ${file}. Review it before invoking a trusted command.`,
      );
  }
}

function vendorDriver(name: string, vendor: Vendor): AgentDriver {
  const version = () => versionOf(vendor.binary);
  return {
    name,
    version,
    detect: async () => (await version()) !== null,
    async run(input) {
      const installed = await version();
      if (installed === null || !vendor.accepts(installed)) {
        throw new Error(`${vendor.binary} ${installed ?? "unavailable"}; supported versions: ${vendor.range}.`);
      }
      await checkProjectConfig(input.worktreePath, vendor.projectConfig ?? []);
      return withRunFiles(input, async ({ promptFile, env }) => {
        const invocation = await vendor.invoke(promptFile, input);
        const output = await runProcess(vendor.binary, invocation.args, {
          cwd: input.worktreePath,
          timeoutMs: input.timeoutMs,
          ...(invocation.input === undefined ? {} : { input: invocation.input }),
          env: { ...env, ...invocation.env },
          outputLimit: 1024 * 1024,
        });
        const metrics = readMetrics(name, output.stdout);
        const changes = await changedFiles(input.worktreePath);
        const result = makeResult({ name, version: installed }, output, changes, metrics.usage, metrics.turns);
        const permitted = new Set(input.allowedPaths ?? []);
        if (changes.some((file) => !permitted.has(file))) {
          return { ...output, exitCode: 1, result: { ...result, status: "blocked" } };
        }
        return { ...output, result };
      });
    },
  };
}

export const installedDrivers = Object.entries(vendors).map(([name, vendor]) => vendorDriver(name, vendor));

const actionClaudeVersion = "2.1.330";
const proposalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["edits"],
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
    },
  },
};

function parseProposalOutput(stdout: string) {
  try {
    return record(JSON.parse(stdout));
  } catch {
    return undefined;
  }
}

function proposalArgs(limit: Limits): string[] {
  return [
    "--print",
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--tools",
    "",
    "--disallowedTools",
    "mcp__*",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(proposalSchema),
    "--max-turns",
    String(limit.turns),
    "--max-budget-usd",
    String(limit.costCents / 100),
  ];
}

/** A tool-free proposal has no access to the checkout or tools that execute repository content. */
export async function proposeClaudeEdits(prompt: string, limit: Limits, key: string, path: string | undefined) {
  const started = performance.now();
  const directory = await mkdtemp(join(tmpdir(), "offing-action-claude-"));
  const env = { ...(path ? { PATH: path } : {}), HOME: directory };
  try {
    const options = { cwd: directory, replaceEnv: true, env, timeoutMs: Math.min(5_000, limit.wallTimeMs) };
    const version = await runProcess("claude", ["--version"], options);
    if (version.exitCode !== 0 || version.stdout.match(/\b\d+\.\d+\.\d+(?:-[\w.]+)?\b/)?.[0] !== actionClaudeVersion) {
      return { stop: "install-pinned-claude-code" } as const;
    }
    if (performance.now() - started >= limit.wallTimeMs) return undefined;
    const output = await runProcess("claude", proposalArgs(limit), {
      ...options,
      env: { ...env, ANTHROPIC_API_KEY: key },
      input: prompt,
      timeoutMs: Math.max(1, limit.wallTimeMs - Math.ceil(performance.now() - started)),
      outputLimit: 256 * 1024,
    });
    if (output.exitCode !== 0) return undefined;
    const raw = parseProposalOutput(output.stdout);
    if (raw?.subtype !== "success" || raw.is_error !== false) return undefined;
    const details = readMetrics("claude", output.stdout);
    const result = makeResult(
      { name: "claude", version: actionClaudeVersion },
      output,
      [],
      details.usage,
      details.turns,
    );
    return { edits: record(raw.structured_output)?.edits, result };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
