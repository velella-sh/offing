#!/bin/bash
# Renders PNG and ICO files from the Offing SVG masters with headless Chrome.
# usage: render.sh <brand dir> <work dir>
set -euo pipefail
O="$1"; W="$2"; mkdir -p "$W"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE="$(cd "$(dirname "$0")" && pwd)"
render() { # svg width height out.png
  local page="$W/page-$RANDOM.html"
  printf '<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}img{display:block}</style></head><body><img src="file://%s" width="%s" height="%s"></body></html>' "$1" "$2" "$3" > "$page"
  "$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2,$3" --screenshot="$4" "file://$page" >/dev/null 2>&1
  rm -f "$page"
}
R="$O/_render"
[ -f "$O/social-preview.svg" ] && render "$O/social-preview.svg" 1280 640 "$O/social-preview.png"
render "$R/16.svg" 16 16 "$O/favicon-16.png"
render "$R/32.svg" 32 32 "$O/favicon-32.png"
render "$R/120.svg" 48 48 "$W/favicon-48.png"
render "$R/apple.svg" 180 180 "$O/apple-touch-icon.png"
render "$R/120.svg" 192 192 "$O/icon-192.png"
render "$R/120.svg" 512 512 "$O/icon-512.png"
render "$O/mark-night.svg" 1024 1024 "$O/mark-night-1024.png"
render "$O/mark-day.svg" 1024 1024 "$O/mark-day-1024.png"
python3 -I "$HERE/ico.py" "$O/favicon.ico" "$O/favicon-16.png" "$O/favicon-32.png" "$W/favicon-48.png"
rm -rf "$R"
