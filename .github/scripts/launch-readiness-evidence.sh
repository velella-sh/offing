#!/usr/bin/env bash
set -euo pipefail

repo=velella-sh/offing
directory="${1:?Pass an evidence directory.}"
mkdir -p "$directory/timing"

# Never read artifacts from branches or from the triggering release run.
if timing_runs="$(gh run list --repo "$repo" --workflow first-minute.yml --branch main --status completed --limit 5 \
  --json databaseId,createdAt --jq '.[] | [.databaseId, .createdAt[0:10]] | @tsv')"; then
  while IFS=$'\t' read -r run date; do
    [[ "$run" =~ ^[1-9][0-9]*$ && "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
    gh run download "$run" --repo "$repo" --pattern 'first-minute-*-node-*' --dir "$directory/timing/$date--$run" || true
  done <<< "$timing_runs"
fi

# A superseded Pages run succeeds while skipping deployment, so require a successful deploy job.
if site_runs="$(gh run list --repo "$repo" --workflow pages.yml --branch main --status success --limit 12 \
  --json databaseId --jq '.[].databaseId')"; then
  while read -r run; do
    [[ "$run" =~ ^[1-9][0-9]*$ ]] || continue
    if gh api "repos/$repo/actions/runs/$run/jobs?per_page=100" --jq \
      '.jobs[] | select(.name == "Deploy to GitHub Pages" and .conclusion == "success") | .id' | grep -q .; then
      if gh run download "$run" --repo "$repo" --name docs-site --dir "$directory/site"; then
        printf '%s\n' "$run" > "$directory/site-run"
      fi
      break
    fi
  done <<< "$site_runs"
fi
