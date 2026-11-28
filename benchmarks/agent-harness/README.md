# Recorded agent experiments

This harness replays recorded edits for Offing's [public staleness tasks](../agent-staleness/tasks.json). The replay driver writes the task's target file in a fresh temporary workspace. Scoring parses that file offline. The legacy maintainer live run and the [historical seed report](../agent-staleness/README.md) are separate experiments.

## Repeatable fixture

Run this fixture from a clean, committed Offing checkout.

```bash
npm ci
fixture=$(mktemp -d)
cat > "$fixture/plan.json" <<'JSON'
{
  "schemaVersion": "offing.agent-replay-plan.v1",
  "identity": {
    "agent": "offline-fixture",
    "agentVersion": "1",
    "model": "fixture-v1",
    "settings": {}
  },
  "source": "fixture",
  "asOf": "2026-11-28",
  "taskIds": ["manifest-package-json-cli"],
  "arms": ["plain"],
  "repeats": 1
}
JSON
mkdir -p "$fixture/recordings/plain/manifest-package-json-cli"
cat > "$fixture/recordings/plain/manifest-package-json-cli/1.json" <<'JSON'
{
  "schemaVersion": "offing.agent-replay.v1",
  "turns": [{"package.json":"{\"name\":\"fixture\",\"dependencies\":{\"request\":\"2.88.2\"}}"}]
}
JSON
npm run bench:staleness:run -- --replay-plan "$fixture/plan.json" \
  --recordings "$fixture/recordings" --output "$fixture/output"
npm run bench:staleness:run -- --rescore "$fixture/output"
```

The summary reports one completed output and one with a finding. The evidence records the rule and its source. This example is hand-written fixture data.

## Inputs and outputs

- A plan names the originating agent, version, model and settings, its UTC scoring date, its task IDs and its provenance (`fixture` or `recorded`). The available settings are `reasoningEffort`, `temperature` and `maxTurns`. An empty object records that no settings were supplied. Omit `repeats` for five attempts per task and arm. Supply a numbered replay file per attempt, starting with `1.json`, under `<arm>/<task-id>/`.
- All arms use the same starting files. Supply `"fixture": "gallery/nodejs"` or `"fixture": "demo"` to use one of the committed examples. `plain` uses the task prompt. `hooks` installs the same local instructions and supported hooks as the legacy harness. `context` appends Offing's stack-context document computed from the starting files. Replay applies captured edits, so the hook setup and context prompt are observable. Measuring their effect on a model requires a live experiment.
- Each attempt contains `meta.json` and `result.json` with `schemaVersion: "offing.agent-run.v1"`, the prompt sent to the replay driver, and its target file when produced. Metadata includes the replay and output SHA-256 values, attempt status and number, the Offing commit, and the bundled Ebb version and digest. `plan.json` seals the completed experiment directory.
- Rescore accepts inputs with the same scoring date, Offing revision and Ebb version/digest as the first experiment. Pass `--rescore` once per output directory to compare disjoint agent/model groups. Duplicate attempts, incomplete experiments, missing model metadata and changed output bytes fail validation. Only completed attempts with a recorded target contribute to the rate. The 95% Wilson intervals describe those outcomes. Repeat fixture replays use the recorded data.

[Ebb's cutoff-report dry run](https://github.com/velella-sh/ebb/issues/698) can use this replay-plan and result format for captured file-shaped responses. Ebb's [answer-key scorer](https://github.com/velella-sh/ebb/issues/743) scores raw recommendation answers. Offing's scorer measures lifecycle findings in produced files. The [recorded Codex migration evaluation](../agent-migrations/results/2026-11-28-codex-evaluation.json) measures a different cohort with its own verification criteria.
