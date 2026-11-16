import assert from "node:assert/strict";
import { test } from "node:test";

import { loadGuardrailTasks, validateGuardrailTasks } from "../benchmarks/agent-guardrail/validate.js";

test("100 balanced guardrail tasks and their expected edits validate with bundled lifecycle rules", async () => {
  const { issues, counts } = await validateGuardrailTasks(await loadGuardrailTasks());
  assert.deepEqual(issues, [], issues.join("\n"));
  assert.deepEqual(counts, { package: 25, runtime: 25, action: 25, api: 25 });
});
