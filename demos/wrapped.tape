# Records the year-in-review section of docs/SHOWCASE.md.
# Record with OFFING_VERSION set and bash demos/build.sh --record wrapped.
# Standalone recording
Output docs/demos/wrapped.gif

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 400
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Hide
Type@1ms 'source demos/colorize.sh && offing_demo_history && clear' Enter
Wait@10s /❯ *$/
Show

Type "offing wrapped . --year 2025 --no-animation" Enter
Wait+Screen@10s /Findings fixed in 2025/
Wait@30s /❯ *$/
Sleep 4s
