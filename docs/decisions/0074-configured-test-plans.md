# 0074 — Share configured test plans

Status: proposed. Issues #689, #690, and #735.

The `tests.steps[].tool` field of `offing.doctor.v1` supports the additional value `configured` for an argv supplied
through `autopilot.tests`. A nonempty list replaces automatic detection for both the doctor and Autopilot previews.
An omitted or empty list preserves detection. Each configured entry has `kind: test` and retains its argv structure
with known secrets redacted in the previews.

Detection proposes a locked Yarn install only when `yarn.lock` is present. It uses `--immutable` for an explicitly
declared Yarn 2 or newer and `--frozen-lockfile` otherwise. The latter is supported by Yarn Classic and is an alias
in current Yarn. Detector and preview output remains read-only advice. The execution boundary from decision 0060
still requires a separately approved command and an isolated backend.
