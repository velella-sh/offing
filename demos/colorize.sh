# Sourced by the demo tapes (hidden). Defines `npx` so a tape can type the
# command a reader runs (`npx @velella/offing ...`) while the recording runs
# the local build and colors its plain-text output for the terminal. Color is
# applied only when stdout is a terminal, so redirects and pipes stay plain.
_offing_color() {
  local e=$'\033'
  sed -E \
    -e "s/^(Offing[^:]*)/${e}[1;38;5;183m\1${e}[0m/" \
    -e "s/^(HIGH|CRITICAL)( |$)/${e}[1;31m\1${e}[0m\2/" \
    -e "s/^(MEDIUM)( |$)/${e}[1;33m\1${e}[0m\2/" \
    -e "s/^(LOW)( |$)/${e}[1;34m\1${e}[0m\2/" \
    -e "s/ (high|critical) / ${e}[1;31m\1${e}[0m /" \
    -e "s/ (medium) / ${e}[1;33m\1${e}[0m /" \
    -e "s/ (low) / ${e}[1;34m\1${e}[0m /" \
    -e "s/^(Status: )(affected)/\1${e}[31m\2${e}[0m/" \
    -e "s/^(Replacement: )(.*)$/${e}[2m\1${e}[0m${e}[32m\2${e}[0m/" \
    -e "s/^(Status|Data|Event|Affected versions|Deadline|Sources?|ID|Rule|Location):/${e}[2m&${e}[0m/" \
    -e "s#(https?://[^ ]+)#${e}[4;34m\1${e}[0m#g" \
    -e "s#([A-Za-z0-9_./-]+:[0-9]+)#${e}[36m\1${e}[0m#g"
}
npx() {
  shift
  if [ -t 1 ]; then
    node dist/src/cli.js "$@" | _offing_color
    return "${PIPESTATUS[0]}"
  fi
  node dist/src/cli.js "$@"
}
