# 0060 — Preview test plans and record test outcomes separately

Status: proposed. Issues #368, #630, #735, and #806.

`offing doctor --tests --json` adds an optional `tests` property to `offing.doctor.v1`. It holds an ordered list of
argument arrays labeled with a tool and step kind, plus notes about projects or dependency files that need
attention. Default doctor output keeps its existing fields. Test plans are local, read-only advice.

`offing.test-run.v1` records approved argv and up to two attempts. Each attempt has an exit code, elapsed
milliseconds, status, optional JUnit totals, failing case names and source paths where reported, a bounded
output tail, and SHA-256 hashes of complete streamed stdout and stderr. A JUnit case counts as flaky only
when it is observed failing and subsequently passing. Absence from the retry is insufficient.

The internal recorder gets a trusted execution backend explicitly. That backend owns the isolated worktree,
approved process environment, and process lifetime. Neither scan nor doctor calls the recorder. Guardrail and
pinned-container integrations are tracked separately on the epic.
