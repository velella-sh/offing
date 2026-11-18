#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

build_dir=$(mktemp -d)
trap 'rm -rf -- "$build_dir"' EXIT

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

case ${1:-} in
  --check)
    # VHS fails on an unmet Wait, but cannot see Bash exit statuses itself.
    # The check and guard tapes assert their own expected exit code of 1.
    for tape in demos/*.tape; do
      name=${tape##*/}
      output=$(sed -n 's/^Output //p' "$tape" | head -n 1)
      if [[ -z $output ]] || ! git ls-files --error-unmatch -- "$output" >/dev/null; then
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
      PROMPT_COMMAND="$prompt_check" OFFING_DEMO_ERROR="$status_file" \
        timeout 120s vhs "$tape" -o "$build_dir/${name%.tape}.gif"
      if [[ -s $status_file ]]; then
        echo "$tape contained a command that exited $(<"$status_file")" >&2
        exit 1
      fi
    done
    exit ;;
  --agent)
    encode_mp4 guard-agent "${2:?pass the path to the trimmed Codex capture}"
    exit ;;
  '')
    ;;
  *)
    echo "Usage: bash demos/build.sh [--check | --agent /absolute/path/to/trimmed.mp4]" >&2
    exit 2 ;;
esac

npm run build
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

# Keep the existing README image URL in sync with the forecast in this gallery.
cp docs/demos/forecast.gif docs/assets/demos/forecast.gif
