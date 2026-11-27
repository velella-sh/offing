# Render with OFFING_VERSION set and bash demos/build.sh --record guard-agent.
# The driver uses these still frames to give each scene an exact duration.
Output preroll.gif

Set Shell "bash"
Set Theme "Kanagawa"
Set FontFamily "JetBrains Mono"
Set FontSize 22
Set Width 1280
Set Height 720
Set Padding 40
Set Framerate 15
Set CursorBlink false

Type@1ms 'PS1=; clear; printf "\033[?25l"; cat prompt.txt' Enter
Wait+Screen@10s /and run node client.mjs to print the body/
Sleep 300ms
Screenshot prompt.png
Sleep 1s

Type@1ms 'clear; cat blocked.txt' Enter
Wait+Screen@10s /www\.npmjs\.com\/package\/request/
Sleep 300ms
Screenshot blocked.png
Sleep 1s

Type@1ms 'clear; cat fallback.txt' Enter
Wait+Screen@10s /(?m)^OK *$/
Sleep 300ms
Screenshot fallback.png
Sleep 1s
