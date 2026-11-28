# Offing demo: the first run and the available offline Autopilot edit.
# Record against a release or an installed candidate using OFFING_CLI.

Output docs/demos/first-run.gif

Require node
Require bash

Set Shell "bash"
Set Theme "Kanagawa"
Set FontFamily "JetBrains Mono"
Set FontSize 23
Set Width 1440
Set Height 810
Set Padding 36
Set Framerate 12
Set TypingSpeed 35ms
Set CursorBlink false

Hide
Type@1ms 'source demos/colorize.sh && offing_demo_setup gallery/nodejs && clear' Enter
Wait@10s /❯ *$/
Show
Sleep 1s

Type "npx @velella/offing" Enter
Wait+Screen@10s /Weather:/
Wait+Screen@10s /Autopilot can fix 1; run offing autopilot \. --dry-run --wave 0 to preview\./
Wait@10s /❯ *$/
Sleep 5s
