# shellcheck shell=bash
# Sourced by the demo tapes (hidden). It prepares a clean copy of the demo
# project, sets the prompt, and defines `npx` so a tape can type the command a
# reader runs (`npx @velella/offing ...`) while the recording uses the CLI
# selected by build.sh. Color applies only when stdout is a
# terminal, so redirects and pipes stay plain. The only text it changes is the
# volatile age suffix of the data line ("(today)", "(3 days ago)"), which would
# otherwise make every recording differ from day to day.

PS1=$'\[\e[38;2;126;156;216m\]❯\[\e[0m\] '
demo_examples="$PWD/dist/tools/examples.js"

offing_demo_setup() {
  local project
  project=$(node "$demo_examples" "${1:-demo}") || return
  cd "$project" || return
}

offing() {
  node "${OFFING_CLI:?run the tape through demos/build.sh}" "$@"
}

offing_demo_repository() {
  offing_demo_setup || return
  git init -q --template=
}

_offing_demo_snapshot() {
  git add . &&
    GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git \
      -c user.name='Offing demo' -c user.email=demo@example.invalid \
      -c core.hooksPath=/dev/null -c commit.gpgSign=false commit -qm "$2"
}

offing_demo_history() {
  offing_demo_repository &&
    printf 'FROM node:16\n' > Dockerfile &&
    _offing_demo_snapshot 2024-12-31T12:00:00Z 'Add the first image' &&
    printf 'FROM node:24\n' > Dockerfile &&
    _offing_demo_snapshot 2025-12-31T12:00:00Z 'Upgrade the image'
}

_offing_color() {
  local e=$'\033'
  # Wrap long lines at a word boundary so the terminal never splits a word.
  fold -s -w 104 | sed -E \
    -e 's/ \((today|[0-9]+ days? ago)\)$//' \
    -e "s/^(Offing[^:]*)/${e}[1;38;5;183m\1${e}[0m/" \
    -e "s/^(HIGH|CRITICAL)( |$)/${e}[1;91m\1${e}[0m\2/" \
    -e "s/^(MEDIUM)( |$)/${e}[1;93m\1${e}[0m\2/" \
    -e "s/^(LOW)( |$)/${e}[1;94m\1${e}[0m\2/" \
    -e "s/^( +)(HIGH|CRITICAL) /\1${e}[1;91m\2${e}[0m /" \
    -e "s/ (high|critical) / ${e}[1;91m\1${e}[0m /" \
    -e "s/ (medium) / ${e}[1;93m\1${e}[0m /" \
    -e "s/^(Status: )(affected)/\1${e}[91m\2${e}[0m/" \
    -e "s/^(Replacement: )(.*)$/${e}[2m\1${e}[0m${e}[92m\2${e}[0m/" \
    -e "s/^(Status|Data|Event|Affected versions|Deadline|Sources?|ID|Rule|Location|Repository|Findings|Confidence|Detected):/${e}[2m&${e}[0m/" \
    -e "s/^(\+\+\+|---) .*/${e}[1m&${e}[0m/" \
    -e "/^--- /,\${ s/^\+[^+].*/${e}[92m&${e}[0m/; s/^-[^-].*/${e}[91m&${e}[0m/; s/^@@.*/${e}[96m&${e}[0m/; }" \
    -e "s/^(20[0-9]{2}-[0-9]{2}) +\|(#+)/${e}[2m\1${e}[0m ${e}[2m|${e}[0m${e}[1;93m\2${e}[0m/" \
    -e "s#(https?://[^ ]+)#${e}[4;94m\1${e}[0m#g" \
    -e "s#( |^|\()(\.?[A-Za-z0-9_./-]+:[0-9]+)#\1${e}[96m\2${e}[0m#g"
}

npx() {
  if [[ ${1:-} != @velella/offing ]]; then
    command npx "$@"
    return
  fi
  shift
  if [ -t 1 ]; then
    (set -o pipefail; offing "$@" | _offing_color)
  else
    offing "$@"
  fi
}
