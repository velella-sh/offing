export type AutopilotDriver = "replay" | "command" | "claude" | "codex" | "gemini" | "aider";

const drivers: readonly AutopilotDriver[] = ["replay", "command", "claude", "codex", "gemini", "aider"];
const budgetBounds = {
  wallTimeMs: 2_147_483_647,
  turns: 1_000,
  tokens: 1_000_000_000,
  costCents: 1_000_000,
};

export type Limits = typeof budgetBounds;

interface Budget {
  run: Limits;
  turn: Limits;
}

export interface AutopilotConfig {
  driver: AutopilotDriver;
  budget: Budget;
  allowedPaths?: readonly string[];
  deniedPaths: readonly string[];
  tests: readonly (readonly [string, ...string[]])[];
  testRuntime?: "container";
  secretEnv: readonly string[];
}

const defaultRun: Limits = {
  wallTimeMs: 300_000,
  turns: 3,
  tokens: 30_000,
  costCents: 100,
};
const defaultTurn: Limits = {
  wallTimeMs: 120_000,
  turns: 1,
  tokens: 10_000,
  costCents: 50,
};
const envPattern = /^[A-Za-z_][A-Za-z0-9_]*(?![\s\S])/;

export function isAutopilotPath(path: string): boolean {
  return (
    /\S/.test(path) &&
    !/[:\\]/.test(path) &&
    ![...path].some((character) => character.charCodeAt(0) < 32) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function invalid(location: string): never {
  throw new Error("Invalid autopilot configuration at " + location + ".");
}

function section<T extends object>(value: unknown, keys: readonly (keyof T)[], location: string): Partial<T> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(location);
  if (Object.keys(value).some((key) => !keys.some((allowed) => allowed === key))) invalid(location);
  return value;
}

function limit(value: unknown, defaultValue: number, max: number, location: string, min = 1): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalid(location);
  return value;
}

function limits(value: unknown, defaults: Limits, location: string): Limits {
  const fields = section<Limits>(value, ["wallTimeMs", "turns", "tokens", "costCents"], location);
  return {
    wallTimeMs: limit(fields.wallTimeMs, defaults.wallTimeMs, budgetBounds.wallTimeMs, location + ".wallTimeMs"),
    turns: limit(fields.turns, defaults.turns, budgetBounds.turns, location + ".turns"),
    tokens: limit(fields.tokens, defaults.tokens, budgetBounds.tokens, location + ".tokens"),
    costCents: limit(fields.costCents, defaults.costCents, budgetBounds.costCents, location + ".costCents", 0),
  };
}

function list(value: unknown, valid: (entry: string) => boolean, location: string): string[] {
  if (!Array.isArray(value)) invalid(location);
  return value.map((entry: unknown) => {
    if (typeof entry !== "string" || !valid(entry)) invalid(location);
    return entry;
  });
}

function testCommands(value: unknown): AutopilotConfig["tests"] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid("autopilot.tests");
  return value.map((command: unknown): [string, ...string[]] => {
    const [executable, ...args] = list(command, (arg) => /\S/.test(arg) && !arg.includes("\0"), "autopilot.tests");
    if (executable === undefined) invalid("autopilot.tests");
    return [executable, ...args];
  });
}

export function parseAutopilotConfig(value: unknown): AutopilotConfig {
  const fields = section<AutopilotConfig>(
    value,
    ["driver", "budget", "allowedPaths", "deniedPaths", "tests", "testRuntime", "secretEnv"],
    "autopilot",
  );
  const budget = section<Budget>(fields.budget, ["run", "turn"], "autopilot.budget");
  const driver = fields.driver === undefined ? "replay" : fields.driver;
  if (!drivers.includes(driver)) invalid("autopilot.driver");
  if (fields.testRuntime !== undefined && fields.testRuntime !== "container") invalid("autopilot.testRuntime");
  return {
    driver,
    budget: {
      run: limits(budget.run, defaultRun, "autopilot.budget.run"),
      turn: limits(budget.turn, defaultTurn, "autopilot.budget.turn"),
    },
    ...(fields.allowedPaths === undefined
      ? {}
      : {
          allowedPaths: list(fields.allowedPaths, isAutopilotPath, "autopilot.allowedPaths"),
        }),
    deniedPaths: list(
      fields.deniedPaths === undefined ? [] : fields.deniedPaths,
      isAutopilotPath,
      "autopilot.deniedPaths",
    ),
    tests: testCommands(fields.tests),
    ...(fields.testRuntime === undefined ? {} : { testRuntime: fields.testRuntime }),
    secretEnv: list(
      fields.secretEnv === undefined ? [] : fields.secretEnv,
      (name) => envPattern.test(name),
      "autopilot.secretEnv",
    ),
  };
}
