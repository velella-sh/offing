# Records the time-lapse section of docs/SHOWCASE.md.
# Record with OFFING_VERSION set and bash demos/build.sh --record timelapse.
# Standalone recording
Output docs/demos/timelapse.gif

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 400
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Hide
Type@1ms 'source demos/colorize.sh && clear' Enter
Wait@10s /❯ *$/
Show

Type "offing timelapse . --from 2026-11 --to 2028-10 --no-animation" Enter
Wait@30s /❯ *$/
Sleep 4s
