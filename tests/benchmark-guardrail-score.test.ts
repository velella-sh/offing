import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreAttempt, summarizeAttempts } from "../benchmarks/agent-guardrail/score.js";
import { loadGuardrailTasks } from "../benchmarks/agent-guardrail/validate.js";

test("scores explicit refusals, correct replacements, and clean edits denied by the hook separately", async () => {
  const tasks = await loadGuardrailTasks();
  const risky = tasks.find((task) => task.id === "api-buffer-size");
  const control = tasks.find((task) => task.id === "api-control-buffer");
  assert.ok(risky && control);
  const observation = { content: null, deniedRequestedEdit: false, refused: false, failed: false };
  const [baseline, guarded] = summarizeAttempts([
    { arm: "baseline", task: risky, observation: { ...observation, content: risky.requested } },
    { arm: "guardrail", task: risky, observation: { ...observation, refused: true } },
    { arm: "guardrail", task: risky, observation: { ...observation, content: risky.accepted } },
    { arm: "guardrail", task: control, observation: { ...observation, deniedRequestedEdit: true } },
    { arm: "guardrail", task: control, observation: { ...observation, refused: true, failed: true } },
    { arm: "guardrail", task: control, observation },
  ]);
  assert.equal(baseline?.counts["obsolete-edit"], 1);
  assert.deepEqual(guarded?.counts, {
    refused: 1,
    "correct-replacement": 1,
    "false-block": 1,
    "obsolete-edit": 0,
    "clean-edit": 0,
    "blocked-edit": 0,
    "unscored-edit": 0,
    "no-edit": 1,
    failed: 1,
  });
});

test("scores equivalent workflow formatting and package ranges inside the accepted range", async () => {
  const tasks = await loadGuardrailTasks();
  const npm = tasks.find((task) => task.id === "npm-jade");
  const action = tasks.find((task) => task.id === "action-actions-checkout");
  assert.ok(npm && action);
  const observation = { deniedRequestedEdit: true, refused: false, failed: false };
  assert.equal(
    scoreAttempt(npm, { ...observation, content: npm.accepted.replace("^3.0.0", "^3.0.3") }),
    "correct-replacement",
  );
  assert.equal(
    scoreAttempt(npm, { ...observation, content: npm.accepted.replace("^3.0.0", "^2.0.0") }),
    "unscored-edit",
  );
  assert.equal(
    scoreAttempt(action, { ...observation, content: "# A comment\n" + action.accepted }),
    "correct-replacement",
  );
});
