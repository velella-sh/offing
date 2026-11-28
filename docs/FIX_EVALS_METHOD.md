---
title: Fix evaluation method
description: How Offing measures deterministic fixes against pinned source trees and isolated builds and tests.
---

# Fix evaluation method

Use a clean Offing source checkout with its locked dependencies installed and a local Docker daemon. Each run
writes to a new directory.

```bash
npm run fix-evals
npm run fix-evals -- --fixer github-actions-uses --out artifacts/fix-evals-actions
npm run fix-evals -- --fixtures --fixer node-buffer --out artifacts/fix-evals-fixtures
npm run fix-evals -- --fixtures --runner-profile all
npm run fix-evals -- --fixtures --runner-tool all
```

The command reads the checked-in public selection and records one outcome or exclusion for every pin. The
earlier four-repository pilot is retained in
[`benchmarks/fix-evals/repositories.json`](https://github.com/velella-sh/offing/blob/main/benchmarks/fix-evals/repositories.json).

## Selection and isolation

A repository can enter the
[`benchmarks/fix-evals/selection.json`](https://github.com/velella-sh/offing/blob/main/benchmarks/fix-evals/selection.json)
cohort once the original public commit has a green build or applicable validator and Offing emits at least one
nonempty patch from that commit. Select at least 60 distinct repositories and include a case for each registered
fixer. A repository may cover several fixers. For a validator, record the files it actually checks and count
patches on those paths. Keep the repository, full commit, Offing and Ebb versions, patch paths and hashes, and
baseline evidence so the selection can be audited independently.

Baseline evidence comes from a fresh isolated checkout with a digest-pinned tool or from a successful upstream
build or test job that checked out the exact source commit. An upstream job must identify the build or test it
ran, and every baseline check must pass on its first attempt. Use real repository source for the selection.
The evaluation reruns baselines and measures what happens after applying each patch.

For isolated checks that need packages, stage the public inputs from the recorded lockfile or pinned tool source
before running the check. Disable lifecycle scripts while staging JavaScript dependencies and run the recorded
build command with the prepared cache in a fresh container with networking disabled. The selection records the
input hashes or source commits needed to recreate that environment.

A candidate identifies a public GitHub repository, a full commit SHA, and the build or validation profile. An eligible
repository must produce a patch with the current Offing registry and have a passing baseline for every check that
profile defines. The current plan is limited to the recorded patch paths that the baseline validates. The evidence
lists candidates with no patch, failed or timed-out baselines, and pins with no comparable offline profile. The last
category includes upstream-only build jobs, a nested Docker build, and cases with dependency caches that cannot be
recreated by the runner. A failing
or timed-out baseline is retained with its first attempt and any retry. Retrying never promotes a failed baseline.

The harness fetches pinned Git objects over HTTPS and no application credentials are forwarded. Trees containing
links or submodules are outside the supported snapshot format. It scans snapshots with bundled Ebb data at the
recorded reference time. Each fixer is evaluated on its own copy of the same tree. A failure in one patch never
changes the source for another fixer. Fixture mode is for checking the harness. Its runs do not count as public
repositories or supply release figures.

Build and test commands are defined by the harness. Each check or retry starts on a fresh copy streamed to a Linux
x86-64 container. Tool images are pinned by digest. Containers run as an unprivileged user with a read-only root,
bounded CPU, memory, process count and run time, no network or host mounts, and temporary writable working space.
The only environment added by the harness contains fixed tool settings. Git fetches and tool image resolution happen
before container execution. Offing's normal scan and fix commands remain read-only with respect to repository
execution.

| Profile | Build or validation | Test |
| --- | --- | --- |
| npm | Offline locked install, then `npm run build` | Offline locked install, then `npm test` |
| Python | Compile Python sources | Standard-library unittest discovery |
| Go | Build using vendored modules | Test using vendored modules |
| Java | Offline Maven package using a repository under `.m2/repository` | Offline Maven test using the same repository |
| Terraform | `terraform validate` | No separate check |
| Kubernetes | `kubeconform` with pinned inputs in `manifests/` and `schemas/` | No separate check |
| GitHub Actions | `actionlint` over workflow files | No separate check |

Several source pins include their own recorded checks. The Go profile keeps its scratch cache in the container, the
small Node projects run their recorded syntax checks and tests, and the Terraform and Kubernetes pins stage their
recorded public provider or schemas. Provider bytes are checked against their SHA-256 before the isolated run.

The offline profiles exclude projects whose commands require missing dependencies, registries, live services, or
unavailable fixtures. Use versioned vendored materials in the pinned source. Validation profiles do not run workflow
jobs or deploy resources.

`--fixtures --runner-profile` exercises the approved profile commands on bundled synthetic projects. Supply `all`
or a profile name from the table. `java` and `all` require `OFFING_FIXTURE_MAVEN_REPOSITORY` to point to a dedicated
fixture dependency cache, with no credentials or settings files. Prepare that cache for the Maven fixture POM
using the dependency plugin's `go-offline` goal and include `org.apache.maven.surefire:surefire-junit4:3.5.4`
for the pinned Maven image's test provider. The actual build and test attempts then run offline. The profile
smoke prints the immutable image, observed status, report totals when available, and hashes for both streams.

`--fixtures --runner-tool` separately exercises the native test tools against one passing and one intentionally
failing test per fixture repository. The test command must report both cases. Select `all` or `npm`, `pnpm`,
`yarn`, `pytest`, `tox`, `go`, `maven`, `gradle`, or `dotnet`. For the fixture tools that need dependencies, stage
them before running the smoke in dedicated directories. Supply `OFFING_FIXTURE_COREPACK` with `pnpm.tgz` and
`yarn.tgz` generated by `corepack pack`, `OFFING_FIXTURE_WHEELHOUSES` with `pytest` and `tox` wheel directories
from the exact fixture requirements, `OFFING_FIXTURE_MAVEN_REPOSITORY` as above, and
`OFFING_FIXTURE_NUGET_REPOSITORY` with the `.nupkg` files for the fixture's project. The runtime tests consume the
staged materials offline. The Gradle and .NET images in this tool fixture check are for test coverage of those
native fixtures.

## Metrics

A case means one eligible repository and one registered fixer that planned at least one patch. There is never more
than one case for the same fixer in one repository. Every rate is the number of successful cases divided by the number
of applicable cases for that metric. Excluded candidates contribute neither. The summary includes the numerator
and denominator and displays percentages only when there are at least five applicable cases. It lists every registered
fixer, including those with zero cases, and links failed metrics back to their case evidence.

| Metric | A case passes when |
| --- | --- |
| Deterministic | Two independent scans of the original tree and plans produce the same patch bytes. Every case is applicable. |
| Applied | The patch applies to a clean copy with `git apply`. Every case is applicable. |
| Resolved | Every original scan finding on a patched path is gone after the patch. This is applicable when the patch applied and the scanner emitted an original finding on a patched path. Source-only codemods can have no such finding. |
| No new finding | A fresh post-patch scan introduces no finding according to the same fingerprint comparison as `offing diff`. This is applicable after successful application. |
| Idempotent | The same fixer plans no patch on the patched copy. This is applicable after successful application. |
| Build kept green | The first post-patch build or validation exits successfully. This is applicable after successful application. |
| Tests kept green | The first post-patch test exits successfully. This is applicable after successful application when the profile defines a test. |

## Evidence

`report.json` records the Offing source commit, bundled Ebb version, scan reference time, image identifiers, exclusion
reasons, counts, and failed metrics. Each candidate's `evidence.json` records its pinned commit, approved check
arguments, attempt statuses, and stream hashes. Each check also writes a standalone `build.v1.json` or `test.v1.json`
that validates against `offing.test-run.v1`. Test attempts can include JUnit counts and failing case details.
The harness reads up to 32 reports, each at most 1 MiB, from the isolated tree before removing it. It skips reports
with the same bytes as a file that was already present before the test. It accepts
`junit.xml` and `.offing-junit.xml` at the root and conventional Maven Surefire, Gradle test, and .NET `TestResults`
paths. Runners such as pytest and Go with an existing JUnit reporter can write to `junit.xml`. If report data
is unavailable or cannot be parsed, the harness uses the exit code and output tails. The adjacent raw stdout,
stderr, and patch files contain the bytes used for SHA-256. For example, use
`shasum -a 256 artifacts/fix-evals/<candidate>/<fixer>/build-1.stdout` to
check one log against its attempt. Raw output may contain text printed by an evaluated repository. Inspect it as
data. An infrastructure failure aborts the run without a summary so partial output cannot be mistaken for a complete
run. Individual command output and source archive sizes are bounded.

The [fix evaluation page](/fix-evals/) displays the measured cohort and all exclusions. It reads the latest dated
report under [`benchmarks/fix-evals/results/`](https://github.com/velella-sh/offing/tree/main/benchmarks/fix-evals/results).
Each report includes a SHA-256 for its adjacent evidence archive. Extract it to inspect the raw logs and patches
identified by the report and failure records. The weekly workflow proposes a pull request when the measured counts
change. GitHub's artifact retains the run evidence when the counts stay the same.

The page attributes the agent-assisted results to their separate runs and displays static and project-check
denominators separately. [Agent migration method](/BENCHMARKS/)

Verify a saved run with the standard-library archive reader. It reads the gzip archive as data, verifies the archive SHA-256 and each referenced patch, stdout and stderr digest, matches saved command receipts, and recomputes the report's case counts and rates. It distinguishes validation from a separate test and preserves exclusions without receipts.

```bash
python3 benchmarks/fix-evals/verify-archive.py benchmarks/fix-evals/results/2026-11-28 \
  --selection benchmarks/fix-evals/selection.json
```

The November 28 archive contains 50 passing baseline records and 51 patch digests. Three post-apply cases have a separate test. The other post-apply checks in the archive are build or validation commands. Ten selected repositories lack a comparable offline baseline and have no recorded project commands. Successful `git apply` operations are represented by the applied metric and patch bytes. The archive has a separate apply-error receipt when applying a patch fails.

The [November 28 main-branch run](https://github.com/velella-sh/offing/actions/runs/46094321774/job/140823148465) evaluated the public cohort and reported unchanged metrics, so it opened no review. The manual fixture path of [Fix Evals](https://github.com/velella-sh/offing/actions/workflows/fix-evals.yml) also runs the weekly review script on a disposable Git repository. It compares a captured 48-repository result from Offing revision `2a6b9538` with the verified 50-repository November 28 archive, pushes a review branch to a temporary bare remote, and records the `gh pr create` arguments at the GitHub boundary. A repeat with the same metrics leaves the archive and review request unchanged. These rehearsals use the real saved evaluation data. They leave the published results and GitHub review state untouched.
