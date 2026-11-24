import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
  clipText,
  estimateTokens,
  limitToolAnswer,
  MAX_TOOL_TOKENS,
  type MorePointer,
  serialized,
  TRUNCATION_MARKER,
} from "../src/mcp/limit.js";
import type { JsonObject } from "../src/mcp/output-schema.js";

/** A small answer schema with the parts the cap has to respect: a severity, a list with a minimum, and `more`. */
async function answerSchema(): Promise<JsonObject> {
  const { $schema, $id, title, description, ...more } = JSON.parse(
    await readFile(resolve("schemas/more.v1.schema.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.ok($schema && $id && title && description);
  const text: JsonObject = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "findings", "sources"],
    properties: {
      status: text,
      replacement: text,
      note: text,
      detail: text,
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "severity", "steps"],
          properties: {
            id: text,
            severity: { enum: ["info", "low", "medium", "high", "critical"] },
            steps: { type: "array", items: text },
            usages: { type: "array", items: text },
          },
        },
      },
      sources: { type: "array", minItems: 1, items: text },
      constraints: { type: "array", minItems: 8, items: text },
      files: { type: "array", items: text },
      more,
    },
  };
}

const SCHEMA = await answerSchema();
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(SCHEMA);

type Severity = "info" | "low" | "medium" | "high" | "critical";

interface Finding {
  id: string;
  severity: Severity;
  steps: string[];
}

interface Answer extends Record<string, unknown> {
  status: string;
  replacement?: string;
  note?: string;
  detail?: string;
  findings: Finding[];
  sources: string[];
  constraints?: string[];
  files?: string[];
  more?: MorePointer;
}

const finding = (id: string, severity: Severity, steps = 3): Finding => ({
  id,
  severity,
  steps: Array.from({ length: steps }, (_, index) => `step ${index} of ${id}: rewrite the call and its tests`),
});

/** Many equal findings whose whole answer is far over the cap. */
const manyFindings = (count: number): Finding[] =>
  Array.from({ length: count }, (_, index) =>
    finding(`rule.${String(index).padStart(4, "0")}:src/file${index}.ts`, "high"),
  );

/** Cuts a copy of `answer` and returns it, after checking the two promises every cut answer keeps. */
function limited(answer: Answer): Answer {
  const cut = JSON.parse(JSON.stringify(answer)) as Answer;
  limitToolAnswer(cut, SCHEMA, "Run the CLI for the complete answer.");
  assert.equal(validate(cut), true, `the cut answer must still validate: ${JSON.stringify(validate.errors)}`);
  const tokens = estimateTokens(serialized(cut));
  assert.ok(tokens <= MAX_TOOL_TOKENS, `expected at most ${MAX_TOOL_TOKENS} tokens, got ${tokens}`);
  return cut;
}

function omitted(cut: Answer, path: string): MorePointer["omitted"][number] | undefined {
  return cut.more?.omitted.find((entry) => entry.path === path);
}

test("an answer inside the cap is returned exactly as it was, without a pointer", () => {
  const answer: Answer = { status: "affected", findings: manyFindings(2), sources: ["https://example.com/a"] };
  const before = serialized(answer);
  limitToolAnswer(answer, SCHEMA, "Run the CLI for the complete answer.");
  assert.equal(serialized(answer), before);
  assert.equal("more" in answer, false);
});

test("a huge answer is cut under the cap and its pointer counts exactly what is missing", () => {
  const cut = limited({ status: "affected", findings: manyFindings(3000), sources: ["https://example.com/a"] });

  assert.equal(cut.more?.truncated, true);
  assert.equal(cut.more.hint, "Run the CLI for the complete answer.");
  assert.equal(cut.more.estimatedTokens, estimateTokens(serialized(cut)));
  assert.ok(cut.findings.length > 5 && cut.findings.length < 3000);

  const findings = omitted(cut, "findings");
  assert.deepEqual(findings, { path: "findings", shown: cut.findings.length, total: 3000 });
  const shownSteps = cut.findings.reduce((count, item) => count + item.steps.length, 0);
  assert.deepEqual(omitted(cut, "findings[].steps"), {
    path: "findings[].steps",
    shown: shownSteps,
    total: 9000,
  });
  // The list that fits is not reported, and nothing was shortened.
  assert.deepEqual(
    cut.more.omitted.map((entry) => entry.path),
    ["findings", "findings[].steps"],
  );
  assert.equal(cut.more.clipped, undefined);
});

test("when a list must be cut, the most severe elements stay, in the order the answer had them", () => {
  const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const order: Severity[] = ["low", "critical", "info", "high", "medium", "info", "high"];
  // Each list of steps is short enough to be restored before the list of findings grows, so every kept finding is whole.
  const cut = limited({
    status: "affected",
    findings: order.map((severity, index) => finding(`rule.${index}`, severity, 20)),
    sources: ["https://example.com/a"],
  });

  const kept = cut.findings.map((item) => item.id);
  assert.ok(kept.length >= 2 && kept.length < order.length, `kept ${kept.length} of ${order.length}`);
  const mostSevere = order
    .map((severity, index) => ({ severity, index }))
    .sort((left, right) => rank[right.severity] - rank[left.severity] || left.index - right.index)
    .slice(0, kept.length)
    .sort((left, right) => left.index - right.index);
  assert.deepEqual(
    kept,
    mostSevere.map(({ index }) => `rule.${index}`),
  );
  assert.ok(
    cut.findings.every((item) => item.steps.length === 20),
    "a kept element is whole",
  );
  // The steps of the findings that were left out are counted with them; a kept finding lost none.
  assert.deepEqual(omitted(cut, "findings[].steps"), {
    path: "findings[].steps",
    shown: 20 * kept.length,
    total: 20 * order.length,
  });
});

test("the first element is shown with its own lists cut when the whole element does not fit", () => {
  const cut = limited({
    status: "affected",
    findings: [finding("rule.huge", "critical", 5000), ...manyFindings(3)],
    sources: ["https://example.com/a"],
  });

  const first = cut.findings[0];
  assert.equal(first?.id, "rule.huge", "the most severe finding is first, so it is the one shown cut");
  assert.ok((first?.steps.length ?? 0) > 0 && (first?.steps.length ?? 0) < 5000);
  assert.equal(omitted(cut, "findings"), undefined, "every finding is shown, so the list itself is not reported");
  assert.equal(
    cut.findings.slice(1).every((item) => item.steps.length === 3),
    true,
    "the others are whole",
  );
  assert.deepEqual(omitted(cut, "findings[].steps"), {
    path: "findings[].steps",
    shown: (first?.steps.length ?? 0) + 9,
    total: 5009,
  });
  assert.equal(omitted(cut, "findings[].usages"), undefined, "a list with nothing missing is not reported");
});

test("no list loses its first element to the arrays inside another list's first element", () => {
  // The first finding wraps a list of steps that fits on its own, whole, and leaves less than one other element.
  const files = Array.from({ length: 40 }, (_, index) => `src/${"deep/".repeat(90)}file-${index}.ts`);
  const cut = limited({
    status: "affected",
    findings: [finding("rule.wrapper", "critical", 80)],
    sources: ["a"],
    files,
  });

  assert.equal(cut.files?.length, 1, "the second list still shows its first element");
  assert.deepEqual(omitted(cut, "files"), { path: "files", shown: 1, total: 40 });
  const steps = cut.findings[0]?.steps.length ?? 0;
  assert.ok(steps > 0 && steps < 80, `the long list inside the first element takes the cut (${steps} of 80)`);
  assert.deepEqual(omitted(cut, "findings[].steps"), { path: "findings[].steps", shown: steps, total: 80 });
});

test("status and replacement are never cut; a long text is shortened at a line break and named", () => {
  const replacement = "Use the maintained client instead.";
  const note = Array.from(
    { length: 300 },
    (_, index) => `Line ${index} of the note is long enough to use the budget.`,
  ).join("\n");
  const cut = limited({
    status: "version-dependent",
    replacement,
    note,
    findings: [],
    sources: ["https://example.com/a"],
  });

  assert.equal(cut.status, "version-dependent");
  assert.equal(cut.replacement, replacement);
  assert.deepEqual(cut.more?.clipped, ["note"]);
  assert.deepEqual(cut.more?.omitted, []);
  const lines = (cut.note ?? "").split("\n");
  assert.ok(
    lines.slice(0, -1).every((line) => /^Line \d+ of the note/.test(line)),
    "the cut lands on a line break",
  );
  assert.ok((cut.note ?? "").endsWith(`use the budget.${TRUNCATION_MARKER}`));
});

test("a replacement longer than the cap is kept whole, and the pointer reports the answer's true size", () => {
  const replacement = "x".repeat(MAX_TOOL_TOKENS * 6);
  const cut = JSON.parse(JSON.stringify({ status: "affected", replacement, findings: [], sources: ["a"] })) as Answer;
  limitToolAnswer(cut, SCHEMA, "Run the CLI for the complete answer.");

  assert.equal(cut.replacement, replacement);
  assert.equal(cut.more?.estimatedTokens, estimateTokens(serialized(cut)));
  assert.ok((cut.more?.estimatedTokens ?? 0) > MAX_TOOL_TOKENS, "the cap yields to the replacement, and says so");
  assert.equal(validate(cut), true);
});

test("a list never drops below the fewest elements its schema requires", () => {
  const constraints = Array.from({ length: 8 }, (_, index) => `constraint ${index}`);
  const cut = limited({
    status: "affected",
    findings: manyFindings(600),
    sources: Array.from({ length: 800 }, (_, index) => `https://example.com/source-${index}`),
    constraints,
  });

  assert.ok((cut.sources.length ?? 0) >= 1, "sources keeps the one element its schema requires");
  assert.deepEqual(cut.constraints, constraints, "a short list is restored whole before the long ones");
  assert.equal(omitted(cut, "constraints"), undefined);
});

test("a list that fits entirely is restored before a longer one", () => {
  const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const cut = limited({ status: "affected", findings: manyFindings(500), sources: ["a"], files });

  assert.deepEqual(cut.files, files);
  assert.equal(omitted(cut, "files"), undefined);
});

test("an answer whose fixed texts alone are too long is still brought under the cap", () => {
  const cut = limited({
    status: "no-data",
    note: "n".repeat(5000),
    detail: "d".repeat(5000),
    findings: [],
    sources: [`one source ${"detail ".repeat(90)}`],
    constraints: Array.from({ length: 8 }, (_, index) => `constraint ${index} ${"detail ".repeat(95)}`),
  });

  assert.equal(cut.status, "no-data");
  assert.equal(cut.sources.length, 1);
  assert.equal(cut.constraints?.length, 8);
  assert.deepEqual([...(cut.more?.clipped ?? [])].sort(), ["constraints[]", "detail", "note", "sources[]"]);
  assert.ok((cut.sources[0] ?? "").endsWith(TRUNCATION_MARKER));
});

test("the same answer is always cut the same way", () => {
  const answer: Answer = { status: "affected", findings: manyFindings(700), sources: ["a"] };
  assert.deepEqual(limited(answer), limited(answer));
});

test("a long text is cut at its last line or sentence break, once, however often it is cut again", () => {
  assert.equal(clipText("short", 10), "short");
  // A text with lines is cut after a whole line, even when a later space would fit more of the last line.
  assert.equal(clipText("first line\nsecond line\nthird line", 30), `first line\nsecond line${TRUNCATION_MARKER}`);
  assert.equal(clipText("one two three four five", 12), `one two${TRUNCATION_MARKER}`);
  assert.equal(clipText("abcdefghijklmnopqrstuvwxyz", 10), `abcdefghij${TRUNCATION_MARKER}`);

  const once = clipText("first line\nsecond line\nthird line", 30);
  assert.equal(clipText(once, 30), once, "cutting again at the same length changes nothing");
  assert.equal(clipText(once, 18), `first line${TRUNCATION_MARKER}`);
});
