# Records the glance section of docs/SHOWCASE.md.
# Record with OFFING_VERSION set and bash demos/build.sh --record glance.
# Standalone recording
Output docs/demos/glance.gif

Set Shell "bash"
Set FontSize 14
Set Width 1100
Set Height 520
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Hide
Type@1ms 'source demos/colorize.sh && offing_demo_setup gallery && clear' Enter
Wait@10s /❯ *$/
Show

Type "offing glance --as-of 2026-10-25" Enter
Wait@30s /❯ *$/
Sleep 6s
