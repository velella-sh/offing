# Sourced by the demo tapes (hidden). It prepares a clean copy of the demo
# project, sets the prompt, and defines `npx` so a tape can type the command a
# reader runs (`npx @velella/offing ...`) while the recording runs the local
# build and colors its plain-text output. Color applies only when stdout is a
# terminal, so redirects and pipes stay plain. The only text it changes is the
# volatile age suffix of the data line ("(today)", "(3 days ago)"), which would
# otherwise make every recording differ from day to day.

PS1=$'\[\e[38;2;126;156;216m\]❯\[\e[0m\] '
OFFING_CLI="$PWD/dist/src/cli.js"

offing_demo_setup() {
  rm -rf /tmp/offing-demo
  cp -r examples/demo /tmp/offing-demo
  cd /tmp/offing-demo || return 1
  git init -q
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
  shift
  if [ -t 1 ]; then
    node "$OFFING_CLI" "$@" | _offing_color
    return "${PIPESTATUS[0]}"
  fi
  node "$OFFING_CLI" "$@"
}
