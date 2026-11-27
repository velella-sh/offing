import type { AutopilotDriver } from "./config.js";

const inherited = new Set(["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SYSTEMROOT"]);
const credentials: Readonly<Partial<Record<AutopilotDriver, string>>> = {
  claude: "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  aider: "OPENAI_API_KEY",
};

const patterns = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{12,})(?![A-Za-z0-9_-])/g,
];

function secretRanges(text: string, values: readonly string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length]);
  }
  for (const value of values) {
    let start = text.indexOf(value);
    while (start !== -1) {
      ranges.push([start, start + value.length]);
      start = text.indexOf(value, start + 1);
    }
  }
  return ranges;
}

function redact(text: string, values: readonly string[]): string {
  let result = "";
  let claimed = 0;
  for (const [start, end] of secretRanges(text, values).sort(([a], [b]) => a - b)) {
    if (start >= claimed) result += text.slice(claimed, start) + "[REDACTED]";
    claimed = Math.max(claimed, end);
  }
  return result + text.slice(claimed);
}

/** Construct complete child environments, never deltas to merge into the current process environment. */
export function childEnvironments(source: NodeJS.ProcessEnv, driver: AutopilotDriver, secretEnv: readonly string[]) {
  const marked = new Set(secretEnv.map((name) => name.toUpperCase()));
  const secretNames = new Set([...marked, ...Object.values(credentials)]);
  const credential = credentials[driver];
  const tests: Record<string, string> = {};
  const secrets = new Set<string>();
  for (const [name, value] of Object.entries(source)) {
    const normalized = name.toUpperCase();
    if (value === undefined) continue;
    if (secretNames.has(normalized) && value.length > 0) secrets.add(value);
    if (inherited.has(normalized) && !marked.has(normalized)) tests[name] = value;
  }
  const key = credential === undefined ? undefined : source[credential];
  const agent = credential !== undefined && key ? { ...tests, [credential]: key } : { ...tests };
  const values = [...secrets];
  return {
    agent,
    tests,
    containsSecret: (text: string) =>
      patterns.some((pattern) => text.search(pattern) !== -1) || values.some((value) => text.includes(value)),
    redact: (text: string) => redact(text, values),
  };
}
