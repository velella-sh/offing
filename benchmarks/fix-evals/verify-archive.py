#!/usr/bin/env python3
"""Verify archived Fix Evals results without running a repository or a build."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import re
import tarfile

MIB = 1024 * 1024
RESULT_PATH = re.compile(r"[a-z0-9][a-z0-9.-]*(?:/[a-z0-9][a-z0-9.-]*)*")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def archive_files(path):
    require(path.stat().st_size <= 20 * MIB, "Evidence archive exceeds 20 MiB")
    files = {}
    total = 0
    with tarfile.open(path, "r:gz") as archive:
        for count, member in enumerate(archive):
            require(count < 10_000, "Evidence archive contains too many entries")
            if member.isdir():
                continue
            name = member.name.removeprefix("./")
            require(member.isfile() and RESULT_PATH.fullmatch(name) and name not in files,
                    f"Unexpected evidence member: {name}")
            total += member.size
            require(total <= 64 * MIB, "Evidence archive expands beyond 64 MiB")
            with archive.extractfile(member) as stream:
                files[name] = stream.read()
    return files


def verify_digest(files, path, expected):
    require(path in files and sha256(files[path]).hexdigest() == expected,
            f"Evidence digest mismatch: {path}")


def verify_checks(files, checks, prefix):
    for name, check in checks.items():
        command = check["command"]
        attempts = check["attempts"]
        require(command and attempts and len(attempts) == len(check["files"]), f"Missing {prefix}/{name} receipts")
        saved = json.loads(files[f"{prefix}/{name}.v1.json"])
        require(saved == {key: value for key, value in check.items() if key != "files"},
                f"Check metadata differs from the saved receipt: {prefix}/{name}")
        for number, (attempt, paths) in enumerate(zip(attempts, check["files"]), 1):
            for stream in ("stdout", "stderr"):
                path = paths[stream]
                require(path == f"{prefix}/{name}-{number}.{stream}", f"Unexpected log path: {path}")
                verify_digest(files, path, attempt["logs"][stream]["sha256"])
                yield path


def passed(check):
    return all(attempt["status"] == "passed" for attempt in check["attempts"])


def check_cases(files, evidence, counts, by_fixer):
    repository = evidence["id"]
    for row in evidence["cases"]:
        fixer = row["fixer"]
        prefix = f"{repository}/{fixer}"
        patch = row["patch"]
        require(patch["path"] == f"{prefix}/fix.patch", f"Unexpected patch path: {patch['path']}")
        verify_digest(files, patch["path"], patch["sha256"])
        counts["patches"] += 1
        metrics = row["metrics"]
        require(repository not in by_fixer[fixer], f"Duplicate fixer evidence: {prefix}")
        by_fixer[fixer][repository] = metrics
        if not metrics["applied"]:
            require(row.get("applyError") == f"{prefix}/apply.stderr" and row["applyError"] in files,
                    f"Missing failed apply receipt: {prefix}")
            require(all(metrics[key] is None for key in ("buildKeptGreen", "testsKeptGreen")),
                    f"Checks reported after a failed apply: {prefix}")
            continue
        checks = row["checks"]
        counts["logs"] += sum(1 for _ in verify_checks(files, checks, prefix))
        require(metrics["buildKeptGreen"] == passed(checks["build"]), f"Post-apply build mismatch: {prefix}")
        expected = passed(checks["test"]) if "test" in checks else None
        require(metrics["testsKeptGreen"] == expected, f"Post-apply test mismatch: {prefix}")
        counts["postTests"] += int(expected is not None)


def check_summary(report, by_fixer):
    require(set(by_fixer) <= {entry["id"] for entry in report["fixers"]}, "Evidence contains an unreported fixer")
    for fixer in report["fixers"]:
        observed = by_fixer[fixer["id"]]
        require(fixer["cases"] == len(observed), f"Case count mismatch: {fixer['id']}")
        status = "measured" if len(observed) >= 5 else "too few cases"
        require(fixer["status"] == status, f"Status mismatch: {fixer['id']}")
        failures = {name: {key for key, value in metrics.items() if value is False}
                    for name, metrics in observed.items() if False in metrics.values()}
        require(failures == {entry["repository"]: set(entry["failures"]) for entry in fixer["failures"]},
                f"Failure rows mismatch: {fixer['id']}")
        for key, expected in fixer["metrics"].items():
            values = [row[key] for row in observed.values() if row[key] is not None]
            passed_count = sum(value is True for value in values)
            percent = 100 * passed_count / len(values) if len(values) >= 5 else None
            require(expected == {"passed": passed_count, "applicable": len(values), "percent": percent},
                    f"Metric mismatch: {fixer['id']} {key}")


def verify(directory):
    report = json.loads((directory / "report.json").read_bytes())
    require(report["schemaVersion"] == "offing.fix-evals.v1" and report["fixtures"] is False,
            "Expected a measured Fix Evals report")
    artifact = directory / "evidence.tar.gz"
    files = archive_files(artifact)
    require(report.pop("evidenceSha256") == sha256(artifact.read_bytes()).hexdigest(), "Archive digest mismatch")
    raw = json.loads(files["report.json"])
    for entry in raw["excluded"] + [failure for fixer in raw["fixers"] for failure in fixer["failures"]]:
        key = entry["id"] if "id" in entry else entry["repository"]
        require(entry.pop("evidence") == f"{key}/evidence.json" and f"{key}/evidence.json" in files,
                f"Archived report references missing evidence: {key}")
    require(raw == report, "Archived and published reports differ")
    counts = Counter()
    excluded = {}
    by_fixer = defaultdict(dict)
    for path, content in files.items():
        if not path.endswith("/evidence.json"):
            continue
        evidence = json.loads(content)
        repository = evidence["id"]
        require(path == f"{repository}/evidence.json" and evidence["repository"] and evidence["commit"],
                f"Missing repository identity: {path}")
        if baseline := evidence.get("baseline"):
            counts["logs"] += sum(1 for _ in verify_checks(files, baseline, f"{repository}/baseline"))
            counts["baselines"] += 1
        if reason := evidence.get("excluded"):
            excluded[repository] = reason
            require(not evidence["cases"], f"Excluded repository has cases: {repository}")
            continue
        require(baseline and all(passed(check) for check in baseline.values()),
                f"Measured repository has no passing baseline: {repository}")
        counts["measured"] += 1
        check_cases(files, evidence, counts, by_fixer)
    require(excluded == {item["id"]: item["reason"] for item in report["excluded"]}, "Exclusions differ")
    require(counts["measured"] == report["repositories"] and counts["measured"] + len(excluded) == report["selected"],
            "Repository totals differ")
    check_summary(report, by_fixer)
    print(f"acc-fix-evals: {report['selected']} selected, {counts['measured']} measured, {len(excluded)} excluded, "
          f"{counts['baselines']} baseline records, {counts['postTests']} post-apply tests, "
          f"{counts['patches']} patch digests, {counts['logs']} log digests")
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--extract", type=Path, help="write the verified files into a new directory")
    args = parser.parse_args()
    try:
        files = verify(args.directory)
        if args.extract:
            args.extract.mkdir()
            for name, content in files.items():
                path = args.extract / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
