# Recorded agent experiments

This harness replays recorded edits for Offing's [public staleness tasks](../agent-staleness/tasks.json). The CLI gives each attempt its own pinned Docker container and writes the target there. Scoring parses the saved target offline. The [historical seed report](../agent-staleness/README.md) records a separate experiment.

## Repeatable fixture

Run this fixture from a clean, committed Offing checkout with a local Docker daemon. The runner may fetch the pinned Node image during setup.

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

## Isolation and compatibility

Each replay unpacks a bounded archive into a new container with `--network none`, a read-only root, bounded scratch space and an unprivileged user. The container receives the starting project at `checkout/`, the task prompt at `prompt.md`, and the selected recording at `recording.json`. The `hooks` arm also receives its generated project instructions and hook settings. The launcher uses a fresh Docker configuration and the container has its own temporary home. Each attempt exports only the declared target and the replay result. Normal scoring parses the target as data.

For a Docker-free replay of existing text data, pass `--static-replay` with the same plan and recordings. This mode writes and parses text in a temporary directory and launches no generated program. The default mode fails if the container is unavailable. `--rescore` remains a static operation. The old `--agent` entry point refuses live vendor CLIs because their subprocess isolation is unverified. Use recordings from an independently approved capture host for measured experiments.

To run the boundary fixture locally, build the checkout and set `OFFING_AGENT_LEADERBOARD_DOCKER=1` for `node --test dist/tests/agent-harness-sandbox.test.js`. The fixture executes a harmless generated script in the replay container. It verifies network denial, an inaccessible synthetic host agent-config marker, access to declared inputs, and a fresh workspace on retry. The [Package smoke workflow](https://github.com/velella-sh/offing/actions/workflows/package-smoke.yml) can run it with `agent_leaderboard_only=true`.

## Inputs and outputs

- A plan names the originating agent, version, model and settings, its UTC scoring date, its task IDs and its provenance (`fixture` or `recorded`). The available settings are `reasoningEffort`, `temperature` and `maxTurns`. An empty object records that no settings were supplied. Omit `repeats` for five attempts per task and arm. Supply a numbered replay file per attempt, starting with `1.json`, under `<arm>/<task-id>/`.
- All arms use the same starting files. Supply `"fixture": "gallery/nodejs"` or `"fixture": "demo"` to use one of the committed examples. `plain` uses the task prompt. `hooks` installs the same local instructions and supported hooks as the legacy harness. `context` appends Offing's stack-context document computed from the starting files. Replay applies captured edits, so the hook setup and context prompt are observable. Measuring their effect on a model requires a live experiment.
- Each attempt contains `meta.json` and `result.json` with `schemaVersion: "offing.agent-run.v1"`, the prompt sent to the replay driver, and its target file when produced. Metadata includes the replay and output SHA-256 values, attempt status and number, the Offing commit, and the bundled Ebb version and digest. `plan.json` seals the completed experiment directory.
- Rescore accepts inputs with the same scoring date, Offing revision and Ebb version/digest as the first experiment. Pass `--rescore` once per output directory to compare disjoint agent/model groups. Duplicate attempts, incomplete experiments, missing model metadata and changed output bytes fail validation. Only completed attempts with a recorded target contribute to the rate. The 95% Wilson intervals describe those outcomes. Repeat fixture replays use the recorded data.

## Rebuild the leaderboard offline

`npm run leaderboard` reads the committed experiment directories in `benchmarks/agent-staleness/outputs/recorded/` and writes `docs/_data/agent-leaderboard.json`. Supply `--input <experiment>` for each explicit input directory. Every attempt must have `recorded` provenance. The generator keeps the common recorded Offing revision and verifies that the scoring date and bundled Ebb version and digest match across attempts. The CI run identifies the checkout used to rescore those inputs.

For an offline example, pass `--fixture`, the committed fixture input, and an output path outside `docs/`.

```bash
fixture=$(mktemp -d)
npm run leaderboard -- --fixture --input tests/fixtures/agent-leaderboard/recorded \
  --output "$fixture/leaderboard.json"
npm run leaderboard -- --check-committed
```

`--check` compares an existing output against a fresh byte-for-byte rescore. `--check-committed` always checks the quarantined fixture snapshot and checks the public file whenever measured input directories or a public dataset are present. The fixture snapshot uses hand-written edits with its original Offing and Ebb pins. [Committed fixture evidence](../../tests/fixtures/agent-leaderboard/)

## Submit a new agent

Open a pull request with one experiment in `benchmarks/agent-staleness/outputs/recorded/<experiment>/`. Use a directory name that identifies the agent, model, and run date. Include the generated `plan.json` and each `<arm>/<task-id>/<attempt>/` directory with `meta.json`, `result.json`, `prompt.md`, and the produced target when present. In the pull request, link the capture method and state the agent version, model, settings, starting fixture, and shared Offing and Ebb pins. Keep the raw attempt directories, including failed attempts, and remove any credentials or private data before committing evidence. If a capture contains private data, capture the experiment again using public inputs.

Generate the attempt directories with the replay command above. Use `source: recorded` only for a measured capture with that provenance. The `offing.agent-run.v1` metadata carries the hashes of the recording and emitted target, the attempt status, and the run's pins. Use the same scoring date, Offing revision, and Ebb version and digest as the leaderboard inputs. Include each task, arm, and repeat listed in the plan. Generate `docs/_data/agent-leaderboard.json` with `npm run leaderboard` and include it in the same PR.

Rehearse the submission offline from a clean checkout with dependencies installed. This example gives the [committed fixture](../../tests/fixtures/agent-leaderboard/) a different agent ID, rebuilds its attempt layout, and checks its rescore twice. It needs no Docker daemon or provider key. The temporary files use `fixture` provenance and stay outside the published data.

```bash
work=$(mktemp -d)
seed=tests/fixtures/agent-leaderboard
sed 's/"agent": "offline-fixture"/"agent": "contributor-fixture"/' \
  "$seed/recorded/plan.json" > "$work/plan.json"
npm run bench:staleness:run -- --static-replay --replay-plan "$work/plan.json" \
  --recordings "$seed/recordings" --output "$work/experiment"
npm run leaderboard -- --fixture --input "$work/experiment" --output "$work/leaderboard.json"
npm run leaderboard -- --fixture --input "$work/experiment" --output "$work/leaderboard.json" --check
npm run leaderboard -- --check-committed
```

CI validates the run layout and metadata, compares pins, checks the target digests, and compares the committed leaderboard byte for byte with a fresh rescore. Drop stale outputs and regenerate from the matching recordings when the comparison fails. Include the relevant [Package smoke](https://github.com/velella-sh/offing/actions/workflows/package-smoke.yml) run in the PR. Its `agent_leaderboard_only` dispatch runs `acc-agent-leaderboard` against the selected revision.

[Ebb's cutoff-report dry run](https://github.com/velella-sh/ebb/issues/698) can use this replay-plan and result format for captured file-shaped responses. Ebb's [answer-key scorer](https://github.com/velella-sh/ebb/issues/743) scores raw recommendation answers. Offing's scorer measures lifecycle findings in produced files. The [recorded Codex migration evaluation](../agent-migrations/results/2026-11-28-codex-evaluation.json) measures a different cohort with its own verification criteria.
