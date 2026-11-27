import { type AgentUsage, unknownUsage } from "./contract.js";
import { numberOrNull, record } from "./result.js";

interface Metrics {
  usage: AgentUsage;
  turns: number | null;
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function anthropic(summary: Record<string, unknown>): Metrics {
  const usage = record(summary.usage);
  return {
    usage: {
      inputTokens: numberOrNull(usage?.input_tokens),
      outputTokens: numberOrNull(usage?.output_tokens),
      costUsd: numberOrNull(summary.total_cost_usd, false),
    },
    turns: numberOrNull(summary.num_turns),
  };
}

function codex(stdout: string): Metrics {
  for (const line of stdout.split("\n").reverse()) {
    const event = parse(line);
    if (event?.type !== "turn.completed") continue;
    const usage = record(event.usage);
    return {
      usage: {
        inputTokens: numberOrNull(usage?.input_tokens),
        outputTokens: numberOrNull(usage?.output_tokens),
        costUsd: null,
      },
      turns: 1,
    };
  }
  return { usage: { ...unknownUsage }, turns: null };
}

function tokens(models: readonly unknown[], key: "prompt" | "candidates"): number | null {
  const counts = models.map((model) => numberOrNull(record(record(model)?.tokens)?.[key]));
  if (!counts.length || counts.some((count) => count === null)) return null;
  return counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

export function readMetrics(name: string, stdout: string): Metrics {
  if (name === "codex") return codex(stdout);
  const summary = parse(stdout);
  if (name === "claude" && summary) return anthropic(summary);
  if (name === "gemini" && summary) {
    const models = Object.values(record(record(summary.stats)?.models) ?? {});
    return {
      usage: { inputTokens: tokens(models, "prompt"), outputTokens: tokens(models, "candidates"), costUsd: null },
      turns: null,
    };
  }
  return { usage: { ...unknownUsage }, turns: null };
}
