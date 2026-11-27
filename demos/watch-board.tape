# Records the watch-board section of docs/SHOWCASE.md.
# Record with OFFING_VERSION set and bash demos/build.sh --record watch-board.
# Standalone recording
Output docs/demos/watch-board.gif

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 320
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Hide
Type@1ms 'source demos/colorize.sh && offing_demo_setup gallery && offing watch add . >/dev/null && clear' Enter
Wait@10s /❯ *$/
Show

Type "offing watch --board" Enter
Wait@30s /❯ *$/
Sleep 4s
