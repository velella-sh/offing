# Record with OFFING_VERSION set and bash demos/build.sh --record forecast.
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
Type@1ms 'source demos/colorize.sh && offing_demo_setup && clear' Enter
Wait@10s /❯ *$/
Show
Sleep 1s

Type "npx @velella/offing forecast . --as-of 2026-07-01 --data-version bundled" Enter
Wait+Screen@10s /(?m)^Forecast from 2026-07-01 to 2027-07-01 /
Wait+Screen@10s /github-actions\.checkout\.node20/
Wait+Screen@10s /\.github\/workflows\/ci\.yml:9/
Wait@10s /❯ *$/
Sleep 10s
Hide
Type@1ms '[[ $? == 0 ]] && echo "forecast-demo: ok"' Enter
Wait+Screen@10s /(?m)^forecast-demo: ok *$/
