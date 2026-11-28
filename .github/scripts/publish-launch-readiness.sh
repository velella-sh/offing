#!/usr/bin/env bash
set -euo pipefail

repo=velella-sh/offing
title='Offing launch readiness report'
marker='<!-- offing-launch-readiness-report -->'
[[ "${GITHUB_REPOSITORY:-}" == "$repo" ]]
report="${1:?Pass the Markdown report.}"
artifact="${2:?Pass the workflow artifact link.}"
[[ "$artifact" =~ ^https://github\.com/velella-sh/offing/actions/runs/[1-9][0-9]*/artifacts/[1-9][0-9]*$ ]]
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
{
  printf '%s\n\n' "$marker"
  cat "$report"
  printf '\n[Read the Markdown and JSON evidence under metrics/launch-readiness/](%s)\n' "$artifact"
} > "$body_file"

issues="$(gh api --method GET "repos/$repo/issues" --paginate \
  -f state=all -f 'creator=github-actions[bot]' -f per_page=100 \
  --jq '.[] | select(.user.login == "github-actions[bot]" and .title == "Offing launch readiness report" and
    (.body // "" | startswith("<!-- offing-launch-readiness-report -->"))) | [.number, .state] | @tsv')"
if [[ -z "$issues" ]]; then
  issue_url="$(gh issue create --repo "$repo" --title "$title" --body-file "$body_file")"
  [[ "$issue_url" =~ ^https://github\.com/velella-sh/offing/issues/([1-9][0-9]*)$ ]]
  issue="${BASH_REMATCH[1]}"
else
  open_issue=$'^([1-9][0-9]*)\topen$'
  if [[ ! "$issues" =~ $open_issue ]]; then
    echo 'Expected one open automation-owned launch readiness issue.' >&2
    exit 1
  fi
  issue="${BASH_REMATCH[1]}"
  gh issue edit "$issue" --repo "$repo" --body-file "$body_file"
fi
gh issue pin "$issue" --repo "$repo"
