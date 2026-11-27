#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

build_dir=$(mktemp -d)
trap 'rm -rf -- "$build_dir"' EXIT
mkdir "$build_dir/examples"
export TMPDIR="$build_dir/examples"
export XDG_CONFIG_HOME="$build_dir/config"
export OFFING_DATA_DIR="$build_dir/cache" OFFING_DATA_VERSION=bundled

prepare_cli() {
  local mode=$1
  agent_replay_mode=''
  if [[ $mode == source ]]; then
    export OFFING_CLI="$PWD/dist/src/cli.js"
  else
    local version=${OFFING_VERSION:-}
    if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
      echo 'Set OFFING_VERSION to an exact published version, for example 0.1.1.' >&2
      return 2
    fi
    npm install --prefix "$build_dir/installed" --registry https://registry.npmjs.org \
      --ignore-scripts --no-audit --no-fund --no-save "@velella/offing@$version"
    export OFFING_CLI="$build_dir/installed/node_modules/.bin/offing"
    [[ $(node "$OFFING_CLI" --version) == "$version" ]] || {
      echo "Installed Offing did not report version $version." >&2
      return 1
    }
    echo "Rendering with installed Offing $version."
    if [[ $version == 0.1.1 ]]; then agent_replay_mode=legacy; fi
  fi
  # The local build prepares fixture files. The tape's Offing commands use OFFING_CLI.
  npm run build
}

tape_path() {
  if [[ ! $1 =~ ^[a-z]+(-[a-z]+)*$ || ! -f demos/$1.tape ]]; then
    echo "Unknown demo tape: $1" >&2
    return 2
  fi
  printf 'demos/%s.tape\n' "$1"
}

encode_mp4() {
  local name=$1 input=$2
  shift 2
  local canvas="scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"
  local captions="subtitles=docs/demos/$name.srt:force_style='FontName=DejaVu Sans,FontSize=14,BorderStyle=3,Outline=1,Shadow=0,MarginV=12'"

  ffmpeg -v error -nostdin -y -i "$input" "$@" -an \
    -vf "$canvas,setsar=1,fps=30,$captions" -c:v libx264 -pix_fmt yuv420p \
    -b:v 750k -minrate 750k -maxrate 750k -bufsize 1500k -x264-params nal-hrd=cbr \
    -movflags +faststart "$build_dir/$name.mp4"
  mv -- "$build_dir/$name.mp4" "docs/demos/$name.mp4"
}

render_guard_agent() {
  local output_dir=$1
  # The amd64 VHS 0.12.1 image also pins Chromium, ttyd, fonts and FFmpeg.
  local renderer='ghcr.io/charmbracelet/vhs@sha256:3afed459e6d7860f6bb8b9a22ae29d5927d628dac6e30f32a250113406a348b9'
  mkdir "$output_dir"
  node demos/guard-agent.mjs "$OFFING_CLI" "$output_dir" "$agent_replay_mode"
  cp demos/guard-agent.tape docs/demos/guard-agent.srt "$output_dir/"

  # Record the three terminal states, then give each still frame a fixed length.
  # Render delays and host CPU instruction sets do not affect the MP4.
  docker run --rm --platform linux/amd64 --network none --cap-drop ALL \
    --security-opt no-new-privileges --user "$(id -u):$(id -g)" --env HOME=/tmp \
    --volume "$output_dir:/vhs" --entrypoint /bin/bash -i "$renderer" -es <<'RENDER'
timeout 120s vhs guard-agent.tape
[[ -s prompt.png && -s blocked.png && -s fallback.png ]]
printf '%s\n' "file prompt.png" "duration 8" "file blocked.png" "duration 12" \
  "file fallback.png" "duration 10" "file fallback.png" > frames.txt
ffmpeg -v error -nostdin -y -cpuflags 0 -threads 1 -filter_threads 1 -f concat -i frames.txt \
  -t 30 -vf "setsar=1,fps=30,subtitles=guard-agent.srt:force_style='FontName=DejaVu Sans,FontSize=14,BorderStyle=3,Outline=1,Shadow=0,MarginV=12'" \
  -an -c:v libx264 -preset veryfast -pix_fmt yuv420p -threads 1 -b:v 750k -minrate 750k -maxrate 750k \
  -bufsize 1500k -x264-params asm=0:nal-hrd=cbr -map_metadata -1 -fflags +bitexact \
  -flags +bitexact -movflags +faststart guard-agent.mp4
RENDER
}

check_tapes() {
    local tape name output status_file prompt_check smoke_tape
    # VHS fails on an unmet Wait, but cannot see Bash exit statuses itself.
    # The check and guard tapes assert their own expected exit code of 1.
    for tape in "$@"; do
      name=${tape##*/}
      if [[ $name == guard-agent.tape ]]; then
        render_guard_agent "$build_dir/agent-first"
        render_guard_agent "$build_dir/agent-second"
        cmp "$build_dir/agent-first/guard-agent.mp4" "$build_dir/agent-second/guard-agent.mp4"
        cmp "$build_dir/agent-first/guard-agent.mp4" docs/demos/guard-agent.mp4
        echo "acc-demo-tapes: guard-agent replay, refusal evidence, native fetch, and byte-identical MP4 passed."
        continue
      fi
      output=$(sed -n '/^Output / { s/^Output //; p; q; }' "$tape")
      if [[ -z $output ]] || {
        ! grep -qx '# Standalone recording' "$tape" &&
          ! git ls-files --error-unmatch -- "$output" >/dev/null 2>&1
      }; then
        echo "$tape needs a committed recording: $output" >&2
        exit 1
      fi
      status_file="$build_dir/${name%.tape}.status"
      prompt_check=''
      if [[ $name != guard.tape && $name != check.tape ]]; then
        # Expand the status and destination in the recorded shell.
        # shellcheck disable=SC2016
        prompt_check='status=$?; if (( status != 0 )); then printf "%s\n" "$status" > "$OFFING_DEMO_ERROR"; fi'
      fi
      # Keep the commands and waits. Shorten the presentation-only timing.
      smoke_tape="$build_dir/$name"
      awk '
        /^Set Framerate / { next }
        /^Set Shell / { print; print "Set Framerate 15"; next }
        /^Set TypingSpeed / { print "Set TypingSpeed 5ms"; next }
        /^Sleep / { print "Sleep 300ms"; next }
        { print }
      ' "$tape" > "$smoke_tape"
      PROMPT_COMMAND="$prompt_check" OFFING_DEMO_ERROR="$status_file" \
        timeout 120s vhs "$smoke_tape" -o "$build_dir/${name%.tape}.gif"
      if [[ -s $status_file ]]; then
        echo "$tape contained a command that exited $(<"$status_file")" >&2
        exit 1
      fi
      echo "Rendered ${name%.tape}."
    done
}

case ${1:-} in
  --check | --check-source)
    if [[ $1 == --check-source ]]; then
      prepare_cli source
    else
      prepare_cli release
    fi
    shift
    tapes=()
    for name in "$@"; do
      tapes+=("$(tape_path "$name")")
    done
    if (( ${#tapes[@]} == 0 )); then
      tapes=(demos/*.tape)
    fi
    check_tapes "${tapes[@]}"
    exit ;;
  --record)
    tape=$(tape_path "${2:?pass a tape name}")
    prepare_cli release
    if [[ $tape == demos/guard-agent.tape ]]; then
      render_guard_agent "$build_dir/agent"
      mv -- "$build_dir/agent/guard-agent.mp4" docs/demos/guard-agent.mp4
    else
      vhs "$tape"
    fi
    exit ;;
  '')
    prepare_cli release
    ;;
  *)
    echo "Usage: bash demos/build.sh [--check [name ...] | --check-source [name ...] | --record name]" >&2
    exit 2 ;;
esac

for name in guard forecast; do
  vhs "demos/$name.tape" -o "$build_dir/$name-source.gif,$build_dir/$name-source.mp4"
  ffmpeg -v error -nostdin -y -i "$build_dir/$name-source.mp4" \
    -filter_complex 'fps=12,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer' \
    "$build_dir/$name.gif"
  if (( $(wc -c < "$build_dir/$name.gif") >= 3000000 )); then
    echo "$name.gif must be smaller than 3 MB" >&2
    exit 1
  fi
  encode_mp4 "$name" "$build_dir/$name-source.mp4"
  mv -- "$build_dir/$name.gif" "docs/demos/$name.gif"
done

render_guard_agent "$build_dir/agent"
mv -- "$build_dir/agent/guard-agent.mp4" docs/demos/guard-agent.mp4

# Keep the existing README image URL in sync with the forecast in this gallery.
cp docs/demos/forecast.gif docs/assets/demos/forecast.gif
