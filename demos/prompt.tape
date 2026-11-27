# Records the shell prompt section of docs/SHOWCASE.md.
# Record with OFFING_VERSION set and bash demos/build.sh --record prompt.
# Standalone recording
Output docs/demos/prompt.gif

Set Shell "bash"
Set FontSize 14
Set Width 1100
Set Height 360
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Hide
Type@1ms 'source demos/colorize.sh && offing_demo_setup demo && clear' Enter
Wait@10s /❯ *$/
Show

Type "offing scan . --fail-on none > /dev/null && offing prompt ." Enter
Wait@30s /❯ *$/
Sleep 3s
Type "offing prompt . --symbol EOL:" Enter
Wait@30s /❯ *$/
Sleep 3s
