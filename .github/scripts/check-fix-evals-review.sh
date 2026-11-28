#!/usr/bin/env bash
set -euo pipefail

root=$PWD
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
archive="$root/dist/benchmarks/fix-evals/archive.js"
verify="$root/benchmarks/fix-evals/verify-archive.py"
publish="$root/.github/scripts/publish-fix-evals.sh"
reported="$root/benchmarks/fix-evals/results/2026-11-28"
selection="$root/benchmarks/fix-evals/selection.json"
python3 "$verify" "$reported" --selection "$selection" --extract "$scratch/raw"

export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GITHUB_RUN_ID=77 GITHUB_SERVER_URL=https://example.invalid GITHUB_REPOSITORY=fixture/fix-evals
export RUNNER_TEMP="$scratch" PR_TRACE="$scratch/pr.json"
mkdir "$scratch/bin"
cat > "$scratch/bin/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'auth setup-git') ;;
  'pr view') [[ -s "$PR_TRACE" ]] ;;
  'pr create')
    [[ ! -e "$PR_TRACE" && $3 == --base && $4 == main && $5 == --head && $6 == automation/fix-evals-77 ]]
    [[ $9 == --body-file ]]
    git ls-remote --exit-code origin "refs/heads/$6" >/dev/null
    grep -F 'https://example.invalid/fixture/fix-evals/actions/runs/77' "${10}"
    printf '{"base":"%s","head":"%s"}\n' "$4" "$6" > "$PR_TRACE"
    ;;
  *) exit 2 ;;
esac
GH
chmod u+x "$scratch/bin/gh"
export PATH="$scratch/bin:$PATH"
export GIT_AUTHOR_NAME='Fix Evals fixture' GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
git init -q --bare "$scratch/remote.git"
git init -q -b main "$scratch/consumer"
cd "$scratch/consumer"
git remote add origin "$scratch/remote.git"
previous=benchmarks/fix-evals/results/2026-11-28
next=benchmarks/fix-evals/results/2026-11-29
mkdir -p "$previous"
cp "$root/tests/fixtures/fix-evals/review-baseline.report.json" "$previous/report.json"
git add . && git commit -qm 'Previous recorded evaluation'
git push -q origin main
main=$(git rev-parse HEAD)

node "$archive" "$scratch/raw" 2026-11-29 --changed
python3 "$verify" "$next" --selection "$selection"
bash "$publish"
branch=$(git rev-parse HEAD)
[[ -s $PR_TRACE && $(git --git-dir="$scratch/remote.git" rev-parse refs/heads/main) == "$main" ]]
[[ $(git --git-dir="$scratch/remote.git" rev-parse refs/heads/automation/fix-evals-77) == "$branch" ]]
changed=$(git diff-tree --no-commit-id --name-only -r "$branch")
[[ -n "$changed" ]]
while IFS= read -r path; do [[ "$path" == "$next/"* ]]; done <<< "$changed"

# A repeat with identical numbers has no archive or second pull request.
node "$archive" "$scratch/raw" 2026-11-30 --changed
bash "$publish"
[[ -z $(git status --porcelain) && ! -e benchmarks/fix-evals/results/2026-11-30 ]]
echo 'acc-fix-evals: two recorded outcomes drove one review request and an unchanged repeat in a disposable Git repository.'
