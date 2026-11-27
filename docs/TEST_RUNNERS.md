---
title: Preview test and build commands
description: Inspect Offing's static test and build plan for a local project.
---

# Preview test and build commands

Run `offing doctor ./project --tests` to see the commands that the files at that path suggest. Add `--json` for the
`tests.steps` list with its argument arrays and `tests.notes` for actionable checks. This is a dry plan. Doctor reads
local metadata and runs no project commands. Point it at a package or solution directory to inspect a nested project.

| Tool | Root marker | Planned commands |
| --- | --- | --- |
| npm | `package.json` scripts and optional `package-lock.json` or `npm-shrinkwrap.json` | `npm ci` with a lock, then `npm run build` and `npm run test` for scripts present |
| pnpm | `package.json` scripts and `pnpm-lock.yaml` or a declared pnpm manager | `pnpm install --frozen-lockfile` with a lock, then available `pnpm run` scripts |
| Yarn | `package.json` scripts and `yarn.lock` or a declared Yarn manager | `yarn install --immutable` with a lock, then available `yarn run` scripts |
| pytest | `pytest.ini`, `.pytest.ini`, or a pytest section in `pyproject.toml` or `setup.cfg` | `python3 -m pytest` |
| tox | `tox.ini` | `python3 -m tox` |
| Go | `go.mod` | `go build -mod=readonly ./...` and `go test -mod=readonly ./...` |
| Maven | `pom.xml` | `mvn -DskipTests package` and `mvn test`, preferring the available Maven wrapper |
| Gradle | `gradlew` or `gradlew.bat` | `./gradlew assemble` and `./gradlew test`, with the batch wrapper on Windows |
| .NET | `*.sln` or `*.slnx`, otherwise `*.csproj` | `dotnet build ./{target}` and `dotnet test ./{target}` for each target |

Set `packageManager` in `package.json` to choose the Node manager when several lockfiles are present. For Python,
a `requirements.txt` made entirely of exact pins adds a plan to create `.offing-venv`, install with
`pip install --no-deps -r requirements.txt`, and run the tool from that environment. On Windows the plan uses
`python` and the corresponding virtual environment path. The plan omits install commands when the supported
lockfile is missing. Build tools may still resolve their own dependencies if someone later runs a shown command.

If the plan is empty, use the directory containing a supported manifest or add the required scripts or test tool
configuration. Offing config overrides for test commands are tracked in [#689](https://github.com/velella-sh/offing/issues/689).
