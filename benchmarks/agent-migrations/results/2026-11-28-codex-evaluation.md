# Codex CLI migration evaluation

On 2026-11-28, Codex CLI `0.171.0-alpha.13.2` with model `gpt-6.2-sol` ran both arms on 24 pinned public-repository tasks using Offing commit `deedaed8`. These tasks and the [earlier static run](2026-11-27-codex-static.json) cover 40 of the 40 task pins. The two cohorts use different verification profiles, so their success rates are reported separately.

| Outcome | Bare prompt | Migration packet |
| --- | ---: | ---: |
| Live agent attempts | 24 | 24 |
| Static migration success | 15/24 | 17/24 |
| Isolated project check passed | 7/8 | 5/8 |
| Static and project checks passed | 5/8 | 5/8 |

Each arm used its own detached worktree at the named commit. The command adapter provided the harness prompt to Codex with workspace-write sandboxing, shell network access disabled, project instructions disabled, and no inherited shell variables. The agent was instructed to edit only the worktree and leave verification to the harness. The harness rescanned each edited tree offline and recorded time, changed paths, expected end state, and whether it found a new lifecycle finding.

Static success requires a zero agent exit status, a resolved finding, no new findings, the expected end state, `git diff --check HEAD`, and no edits outside the task scope. The end-state patterns were also checked on a read-only worktree mount in the pinned Node container. For the Rust tasks, the scoring allowlist also includes the files named by the upstream migration in the task set. Both arms use the same allowlist.

## Upstream project checks

A project entered this cohort only when its original verification commands passed at the pre-migration commit with the chosen toolchain. Both edited arms then used that toolchain and the same dependency cache. Before the runs, `go mod download`, `cargo fetch --locked`, or `npm ci --ignore-scripts` populated the project caches from the pinned manifests and lockfiles. The verification containers used `--network none`, no credentials or host services, no added capabilities, a non-root user, and read-only input mounts. The build ran in a disposable writable copy with a 2-CPU and 2.4-GB memory limit and a per-condition verification timeout. Go disabled VCS stamping for these copies and used the pinned compiler with toolchain downloads disabled.

| Task | Project check | Bare prompt | Migration packet |
| --- | --- | --- | --- |
| [auth0-request](https://github.com/auth0/db-connections-templates/tree/d169ed32e87f5d42fece97e83fd83cd9c66d5bcb) | `npm ci && npm test` | pass, static criteria failed | fail |
| [bubbletea-go](https://github.com/charmbracelet/bubbletea/tree/73b6d91ac1c3854dd4af046ab5f9e51d3b3b4290) | `go build ./...` | pass | pass |
| [dust-ansi-term](https://github.com/bootandy/dust/tree/6c20fae3e8bc63922e2f97dae1bdcf1512b1a255) | `cargo build --all-targets && cargo test` | pass, static criteria failed | pass |
| [hyperfine-atty](https://github.com/sharkdp/hyperfine/tree/769652353aacf84fb8ab691e4ec2c6435ad2ee3a) | `cargo build --all-targets && cargo test` | pass | pass |
| [just-ansi-term](https://github.com/casey/just/tree/0363b25013c193ea67ed7fea87946142393e2b21) | `cargo build --all-targets && cargo test` | fail | fail |
| [lazygit-go](https://github.com/jesseduffield/lazygit/tree/5e3cd6b5408218cc55e8b26df377e3912eea3c8d) | `go build ./...` | pass | pass |
| [lighthouse-node](https://github.com/cloudfour/lighthouse-parade/tree/e3cddd59a47c0dfac81a1178f3e0032b6d4acc8a) | `npm ci && npm test` | pass | pass |
| [node-exporter-go](https://github.com/prometheus/node_exporter/tree/baf644aaa87148ab0068cd334730a6c9737cfb46) | `go build ./...` | pass | fail |

The [run records](2026-11-28-codex-evaluation.json) give the exact image digests and platform per project, the clean checkout exit status, the source commit, and both migrated outcomes. The static cohort includes paths whose declared verification is static, projects whose unchanged checkout failed the bounded offline preflight, and projects without a prepared offline toolchain. Those cases are marked with their reason in the records.

## Package acceptance

The local `acc-agent-migrate` replay passed five tests against the candidate installed from a packed tarball. It checked the local migration branch, intact source checkout, matching verification receipt, refusal paths and timeout handling. The test used the candidate's package version `0.1.1`. The version `0.1.2` public acceptance run is tracked in [Offing #444](https://github.com/velella-sh/offing/issues/444).
