# Record with OFFING_VERSION set and bash demos/build.sh --record guard.
Output docs/demos/guard.gif

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

Hide
Type@1ms 'source demos/colorize.sh && clear' Enter
Wait@10s /❯ *$/
Show
Sleep 1s

Type "offing guard --data-version bundled npm install --dry-run --offline request@2.88.2" Enter
Wait+Screen@10s /request is deprecated/
Wait@10s /❯ *$/
Sleep 8s
Hide
Type@1ms "guard_status=$?" Enter
Wait@10s /❯ *$/
Ctrl+l
Show

Type `node -e 'fetch("data:,OK").then(r => r.text()).then(console.log)'` Enter
Wait+Screen@10s /(?m)^OK *$/
Wait@10s /❯ *$/
Sleep 9s
Hide
Type@1ms '[[ $? == 0 && $guard_status == 1 ]] && echo "guard-demo: ok"' Enter
Wait+Screen@10s /(?m)^guard-demo: ok *$/

# Caption 00:00:00,000 --> 00:00:03,300
# | offing guard --data-version bundled npm install
# | --dry-run --offline request@2.88.2

# Caption 00:00:03,300 --> 00:00:07,400
# | offing guard: refused to run npm (1 blocked, --fail-on high).
# | pkg:npm/request@2.88.2 — request is deprecated

# Caption 00:00:07,400 --> 00:00:11,200
# | Replacement: Native fetch or a maintained HTTP client
# | Evidence: https://www.npmjs.com/package/request

# Caption 00:00:11,200 --> 00:00:13,300
# | node -e 'fetch("data:,OK").then(r => r.text()).then(console.log)'

# Caption 00:00:13,300 --> 00:00:22,000
# | OK
