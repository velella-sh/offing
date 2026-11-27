import { readdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { parse } from "semver";

import { readRunnerText } from "./files.js";

type Tool = "npm" | "pnpm" | "yarn" | "pytest" | "tox" | "go" | "maven" | "gradle" | "dotnet";
type Command = [executable: string, ...args: string[]];

interface Step {
  tool: Tool | "configured";
  kind: "setup" | "install" | "build" | "test";
  command: Command;
}

export interface TestPlan {
  steps: Step[];
  notes: string[];
}

const nodeInstall = {
  npm: { lock: "package-lock.json", args: ["ci"] },
  pnpm: { lock: "pnpm-lock.yaml", args: ["install", "--frozen-lockfile"] },
  yarn: { lock: "yarn.lock", args: ["install", "--immutable"] },
} satisfies Record<string, { lock: string; args: string[] }>;

type NodeTool = keyof typeof nodeInstall;
const nodeTools: NodeTool[] = ["npm", "pnpm", "yarn"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function selectNodeTool(manifest: Record<string, unknown>, files: Set<string>): NodeTool | undefined {
  const declared = typeof manifest.packageManager === "string" ? manifest.packageManager.split("@")[0] : undefined;
  if (declared !== undefined) return nodeTools.find((tool) => tool === declared);
  const candidates = nodeTools.filter((tool) => hasNodeLock(tool, files));
  if (candidates.length > 1) return undefined;
  return candidates[0] ?? "npm";
}

function hasNodeLock(tool: NodeTool, files: Set<string>): boolean {
  return files.has(nodeInstall[tool].lock) || (tool === "npm" && files.has("npm-shrinkwrap.json"));
}

function lockedInstallArgs(tool: NodeTool, packageManager: unknown): string[] {
  if (tool !== "yarn") return nodeInstall[tool].args;
  const version = typeof packageManager === "string" ? parse(packageManager.slice("yarn@".length)) : null;
  return version && version.major >= 2 ? nodeInstall.yarn.args : ["install", "--frozen-lockfile"];
}

function addNode(plan: TestPlan, files: Set<string>, manifest: Record<string, unknown> | undefined): void {
  if (!manifest) {
    plan.notes.push("Fix package.json so its scripts can be detected.");
    return;
  }
  const tool = selectNodeTool(manifest, files);
  if (!tool) {
    plan.notes.push("Set packageManager to npm, pnpm, or yarn in package.json to select a supported runner.");
    return;
  }
  const scripts = isObject(manifest.scripts) ? manifest.scripts : {};
  const tasks = (["build", "test"] as const).filter(
    (kind) => typeof scripts[kind] === "string" && scripts[kind].trim() !== "",
  );
  if (tasks.length === 0) return;
  if (hasNodeLock(tool, files)) {
    plan.steps.push({ tool, kind: "install", command: [tool, ...lockedInstallArgs(tool, manifest.packageManager)] });
  } else plan.notes.push(`Commit ${nodeInstall[tool].lock} to plan a locked ${tool} install.`);
  for (const kind of tasks) plan.steps.push({ tool, kind, command: [tool, "run", kind] });
}

const pytestMarkers = {
  "pyproject.toml": /^\s*\[tool\.pytest(?:\.ini_options)?\]\s*(?:#.*)?$/m,
  "setup.cfg": /^\s*\[tool:pytest\]\s*(?:#.*)?$/m,
};
const exactRequirement = /^[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?==[A-Za-z0-9.!+_-]+$/;

function pinnedRequirements(text: string | undefined): boolean {
  const lines = text
    ?.split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  return Boolean(lines?.length && lines.every((line) => exactRequirement.test(line)));
}

async function pythonTool(root: string, files: Set<string>): Promise<"tox" | "pytest" | undefined> {
  if (files.has("tox.ini")) return "tox";
  if (files.has("pytest.ini") || files.has(".pytest.ini")) return "pytest";
  for (const [file, marker] of Object.entries(pytestMarkers)) {
    if (files.has(file) && marker.test((await readRunnerText(join(root, file))) ?? "")) return "pytest";
  }
  return undefined;
}

async function addPython(plan: TestPlan, root: string, files: Set<string>, platform: NodeJS.Platform): Promise<void> {
  const tool = await pythonTool(root, files);
  if (!tool) return;
  const python = platform === "win32" ? "python" : "python3";
  const venvPython = platform === "win32" ? ".offing-venv/Scripts/python.exe" : "./.offing-venv/bin/python";
  const requirements = files.has("requirements.txt") ? await readRunnerText(join(root, "requirements.txt")) : undefined;
  if (pinnedRequirements(requirements)) {
    plan.steps.push(
      { tool, kind: "setup", command: [python, "-m", "venv", ".offing-venv"] },
      { tool, kind: "install", command: [venvPython, "-m", "pip", "install", "--no-deps", "-r", "requirements.txt"] },
      { tool, kind: "test", command: [venvPython, "-m", tool] },
    );
    return;
  }
  plan.notes.push("Commit a fully pinned requirements.txt to plan a locked Python install.");
  plan.steps.push({ tool, kind: "test", command: [python, "-m", tool] });
}

function addCompiled(plan: TestPlan, files: Set<string>, platform: NodeJS.Platform): void {
  if (files.has("go.mod"))
    plan.steps.push(
      { tool: "go", kind: "build", command: ["go", "build", "-mod=readonly", "./..."] },
      { tool: "go", kind: "test", command: ["go", "test", "-mod=readonly", "./..."] },
    );
  if (files.has("pom.xml")) {
    const wrapper = platform === "win32" ? "mvnw.cmd" : "mvnw";
    const command = files.has(wrapper) ? `./${wrapper}` : "mvn";
    plan.steps.push(
      { tool: "maven", kind: "build", command: [command, "-DskipTests", "package"] },
      { tool: "maven", kind: "test", command: [command, "test"] },
    );
  }
  const gradle = platform === "win32" ? "gradlew.bat" : "gradlew";
  if (files.has(gradle))
    plan.steps.push(
      { tool: "gradle", kind: "build", command: [`./${gradle}`, "assemble"] },
      { tool: "gradle", kind: "test", command: [`./${gradle}`, "test"] },
    );
}

function addDotnet(plan: TestPlan, files: Set<string>): void {
  const solutions = [...files].filter((file) => /\.slnx?$/i.test(file));
  const targets = solutions.length ? solutions : [...files].filter((file) => /\.csproj$/i.test(file));
  for (const file of targets.sort()) {
    plan.steps.push(
      { tool: "dotnet", kind: "build", command: ["dotnet", "build", `./${file}`] },
      { tool: "dotnet", kind: "test", command: ["dotnet", "test", `./${file}`] },
    );
  }
}

/** Plans commands from regular root-level project files. This does not execute commands or read nested projects. */
export async function detectTestPlan(root: string, platform = process.platform): Promise<TestPlan> {
  const plan: TestPlan = { steps: [], notes: [] };
  const entries = await readdir(root, { withFileTypes: true }).catch(() => undefined);
  if (!entries) return { steps: [], notes: ["Choose a readable project directory."] };
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  if (files.has("package.json")) addNode(plan, files, parseManifest(await readRunnerText(join(root, "package.json"))));
  await addPython(plan, root, files, platform);
  addCompiled(plan, files, platform);
  addDotnet(plan, files);
  if (plan.steps.length === 0)
    plan.notes.push("Point doctor --tests at a directory with a supported project manifest.");
  return plan;
}

/** A nonempty config override replaces the detected plan. Both paths only produce candidate argv. */
export async function selectTestPlan(
  root: string,
  configured: readonly Readonly<Command>[] = [],
  platform = process.platform,
): Promise<TestPlan> {
  if (configured.length === 0) return detectTestPlan(root, platform);
  return {
    steps: configured.map(([executable, ...args]) => ({
      tool: "configured",
      kind: "test",
      command: [executable, ...args],
    })),
    notes: [],
  };
}
