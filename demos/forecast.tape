# From the repository root after npm run build.
Output docs/demos/forecast.gif

Require node
Require bash

Set Shell "bash"
Set Theme "Kanagawa"
Set FontFamily "JetBrains Mono"
Set FontSize 23
Set Width 1440
Set Height 810
Set Padding 36
Set Framerate 15
Set TypingSpeed 25ms
Set CursorBlink false
Env NO_COLOR "1"

Hide
Type@1ms 'source demos/colorize.sh && demo=$(node dist/tools/examples.js demo) && cd "$demo" && clear' Enter
Wait@10s /❯ *$/
Show
Sleep 1s

Type "npx @velella/offing forecast . --as-of 2026-07-01 --data-version bundled" Enter
Wait+Screen@10s /(?m)^Weather: (clear|cloudy|storm) *$/
Wait+Screen@10s /(?m)^0-3 months *$/
Wait+Screen@10s /(?m)^3-6 months *$/
Wait+Screen@10s /(?m)^6-12 months *$/
Wait@10s /❯ *$/
Sleep 10s
Hide
Type@1ms 'forecast_status=$?; cd / && rm -rf -- "$demo" && [[ $forecast_status == 0 ]] && echo "forecast-demo: ok"' Enter
Wait+Screen@10s /(?m)^forecast-demo: ok *$/
