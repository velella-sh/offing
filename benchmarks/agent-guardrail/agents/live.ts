import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Host } from "./hooks.js";

const exec = promisify(execFile);
const binaries = { codex: "codex", cursor: "cursor-agent" };

export async function agentVersion(host: Host) {
  const { stdout } = await exec(binaries[host], ["--version"], { timeout: 20_000 });
  const version = stdout.trim();
  if (!version) throw new Error(`Could not determine ${host} version.`);
  return version;
}

function isExplicitRefusal(stdout: string): boolean {
  return stdout.split("\n").some((line) => {
    try {
      const event = JSON.parse(line) as { result?: string; item?: { type?: string; text?: string } };
      const text = event.item?.type === "agent_message" ? event.item.text : event.result;
      return text?.trim() === "REFUSED";
    } catch {
      return false;
    }
  });
}

async function configureCursor(cwd: string, target: string) {
  const directory = join(cwd, ".cursor");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "cli.json"),
    JSON.stringify({
      permissions: {
        allow: [`Write(${target})`],
        deny: ["Shell(*)", "WebFetch(*)", "Mcp(*:*)"],
      },
    }),
  );
}

export async function runLive(
  host: Host,
  model: string,
  cwd: string,
  target: string,
  prompt: string,
  env: NodeJS.ProcessEnv,
) {
  if (host === "cursor") await configureCursor(cwd, target);
  const args =
    host === "codex"
      ? [
          "exec",
          "--ephemeral",
          "--json",
          "--sandbox",
          "workspace-write",
          "--dangerously-bypass-hook-trust",
          "-c",
          'approval_policy="never"',
          "-c",
          "features.hooks=true",
          "-c",
          `projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`,
          "-c",
          "mcp_servers={}",
          "-c",
          "plugins={}",
          "--model",
          model,
          "--",
          prompt,
        ]
      : ["--print", "--trust", "--output-format", "json", "--workspace", cwd, "--model", model, "--", prompt];
  try {
    const child = exec(binaries[host], args, { cwd, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    child.child.stdin?.end();
    const { stdout, stderr } = await child;
    return { stdout, stderr, refused: isExplicitRefusal(stdout), failed: false };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr || failure.message, refused: false, failed: true };
  }
}
