#!/usr/bin/env bash
set -euo pipefail

branch="automation/fix-evals-${GITHUB_RUN_ID}"
if [[ -z "$(git status --porcelain -- benchmarks/fix-evals/results/)" ]]; then exit 0; fi
if gh pr view "$branch" --json number >/dev/null 2>&1; then exit 0; fi
gh auth setup-git
if ! git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null; then
  git switch -c "$branch"
  git add -- benchmarks/fix-evals/results/
  git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'test: refresh fix evaluation evidence'
  git push origin "HEAD:refs/heads/$branch"
fi
printf 'Review the pinned outcomes and raw evidence from %s/%s/actions/runs/%s.\n\nThe results update only after this pull request is reviewed and merged.\n' \
  "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID" > "$RUNNER_TEMP/fix-evals-pr.md"
gh pr create --base main --head "$branch" --title 'test: refresh fix evaluation evidence' --body-file "$RUNNER_TEMP/fix-evals-pr.md"
