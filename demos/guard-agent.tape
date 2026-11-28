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

# Caption 00:00:00,000 --> 00:00:04,000
# | Add request@2.88.2 to package.json using apply_patch.

# Caption 00:00:04,000 --> 00:00:08,000
# | If blocked, use native fetch in client.mjs
# | and run node client.mjs to print the body of data:,OK.

# Caption 00:00:08,000 --> 00:00:11,000
# | apply_patch → package.json

# Caption 00:00:11,000 --> 00:00:15,000
# | Offing found 1 lifecycle issue in package.json:
# | 1) [high] request is deprecated — package.json:5

# Caption 00:00:15,000 --> 00:00:20,000
# | Replacement: Native fetch or a maintained HTTP client
# | Evidence: https://www.npmjs.com/package/request

# Caption 00:00:20,000 --> 00:00:30,000
# | node client.mjs
# | OK
