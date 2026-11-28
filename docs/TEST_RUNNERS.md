---
title: Preview test and build commands
description: Inspect Offing's static test and build plan for a local project.
---

# Preview test and build commands

Run `offing doctor ./project --tests` to see the candidate commands. Add `--json` for the `tests.steps` list with its
argument arrays and `tests.notes` for actionable checks. Doctor reads local metadata and runs no project commands.
Point it at a package or solution directory to inspect a nested project.

A nonempty `autopilot.tests` list in `.offing.json` replaces all detected setup, install, build and test steps in
both `doctor --tests` and `autopilot --dry-run`. Use one array per command, with the executable first and each
argument in its own string.

```json
{"autopilot":{"tests":[["npm","run","check:ci"]]}}
```

Validate the example with `offing config validate ./project/.offing.json`. Doctor labels these test steps
`configured`. An omitted or empty list uses automatic detection. The previews redact known secrets and list
candidates for review. Running a command requires a separate approval and an isolated backend.

| Tool | Root marker | Planned commands |
| --- | --- | --- |
| npm | `package.json` scripts and optional `package-lock.json` or `npm-shrinkwrap.json` | `npm ci` with a lock, then `npm run build` and `npm run test` for scripts present |
| pnpm | `package.json` scripts and `pnpm-lock.yaml` or a declared pnpm manager | `pnpm install --frozen-lockfile` with a lock, then `pnpm run build` and `pnpm run test` for scripts present |
| Yarn | `package.json` scripts and `yarn.lock` or a declared Yarn manager | With a lock, `yarn install --immutable` for declared Yarn 2+, otherwise `yarn install --frozen-lockfile`. It then plans `yarn run build` and `yarn run test` for scripts present |
| pytest | `pytest.ini`, `.pytest.ini`, or a pytest section in `pyproject.toml` or `setup.cfg` | `python3 -m pytest` |
| tox | `tox.ini` | `python3 -m tox` |
| Go | `go.mod` | `go build -mod=readonly ./...` and `go test -mod=readonly ./...` |
| Maven | `pom.xml` | `mvn -DskipTests package` and `mvn test`, preferring the available Maven wrapper |
| Gradle | `gradlew` on Unix or `gradlew.bat` on Windows | `./gradlew assemble` and `./gradlew test`, with the batch wrapper on Windows |
| .NET | `*.sln` or `*.slnx`, otherwise `*.csproj` | `dotnet build ./{target}` and `dotnet test ./{target}` for each target |

Set `packageManager` in `package.json` to choose the Node manager when several lockfiles are present. For Python,
a `requirements.txt` made entirely of exact pins adds a plan to create `.offing-venv`, install with
`pip install --no-deps -r requirements.txt`, and run the tool from that environment. On Windows the plan uses
`python` and the corresponding virtual environment path. The plan omits install commands when the supported
lockfile is missing. Build tools may still resolve their own dependencies if someone later runs a shown command.

If the plan is empty, read `tests.notes`, then point Doctor at the directory containing the manifest. For a Node
project, define a nonempty `test` script in `package.json`. For pytest, add a supported pytest configuration
from the table. A test suite outside these detection rules can still be previewed with `autopilot.tests`.

## Run tests in the pinned container

Use a clean Git checkout after reviewing the commit and its candidate commands. An explicit test-only request runs
tests inside the same pinned Docker runner that Fix Evals uses for its benchmark checks.

```bash
offing autopilot ./project --test-only --container
```

`--test-only` uses the pinned Docker runtime by default. `--container` and the committed setting
`autopilot.testRuntime: "container"` explicitly select that same runtime. Test-only uses the detected test steps
with their offline prerequisites. To choose the commands yourself, commit an `autopilot.tests` array like the
example above. Offing uses the configured argument arrays and skips automatically detected setup and install steps.
Both modes require exactly one supported Linux runtime profile inferred from the project's detected test tools.
If several profiles are detected, use a checkout with just the project you want to test at its root.
The streamed snapshot excludes Git internals and stays separate from the original checkout.
The sandbox uses an unprivileged user, a read-only image, temporary space, and limits on time,
processes, CPU and memory. It has no network or host mounts. Tool image downloads happen before execution.

The test environment uses the bundled Node, Python, Go or Java image. Supply any project dependencies as
offline materials. npm can use `.npm-cache`, pnpm and modern Yarn can use a pinned Corepack archive named
`.offing-corepack.tgz`, Python can use `.wheelhouse`, and Maven can use `.m2/repository`. A Gradle wrapper needs
its own offline distribution. The .NET plan is available in Doctor with no pinned test-only profile yet.
Go's container command uses vendored modules. Maven's native command uses its offline repository.

The runtime retries a failed command once when time remains. Each attempt starts from the same clean snapshot
and sets `OFFING_TEST_ATTEMPT` to `1` or `2`. A case is reported as flaky when JUnit evidence shows that it failed
first and passed on retry. The command succeeds when its last attempt passes.

See [Autopilot safety](AUTOPILOT_SAFETY.md) for execution boundaries, secret handling, and undo.
