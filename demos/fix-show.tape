# Records the fix before-and-after section of docs/SHOWCASE.md.
# Record with OFFING_VERSION set and bash demos/build.sh --record fix-show.
# Standalone recording
Output docs/demos/fix-show.gif

Set Shell "bash"
Set FontSize 14
Set Width 1100
Set Height 520
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Hide
Type@1ms 'source demos/colorize.sh && offing_demo_setup codemods/dockerfile-legacy && clear' Enter
Wait@10s /❯ *$/
Show

Type "offing fix --show" Enter
Wait@30s /❯ *$/
Sleep 8s
