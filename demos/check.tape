# Offing demo tape: Check one dependency before adding it.
#
# Rendered by CI (.github/workflows/demos.yml) from the repository root after
# `npm run build`; never recorded by hand. demos/colorize.sh prepares a clean
# copy of examples/demo in /tmp/offing-demo, sets the prompt, and colors the
# output. Regenerate every recording with:
#
#   for tape in demos/*.tape; do vhs "$tape" || exit 1; done

Output docs/assets/demos/check.gif

Require node
Require bash

Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 17
Set LineHeight 1.1
Set Width 1400
Set Height 570
Set Padding 28
Set Margin 56
Set MarginFill "demos/frame.png"
Set BorderRadius 14
Set WindowBar Colorful
Set Theme {"name":"Kanagawa","black":"#16161d","red":"#c34043","green":"#76946a","yellow":"#c0a36e","blue":"#7e9cd8","magenta":"#957fb8","cyan":"#6a9589","white":"#c8c093","brightBlack":"#727169","brightRed":"#e82424","brightGreen":"#98bb6c","brightYellow":"#e6c384","brightBlue":"#7fb4ca","brightMagenta":"#938aa9","brightCyan":"#7aa89f","brightWhite":"#dcd7ba","background":"#1f1f28","foreground":"#dcd7ba","selection":"#2d4f67","cursor":"#c8c093"}
Set TypingSpeed 40ms
Set CursorBlink false

Hide
Type "source demos/colorize.sh" Enter
Type "offing_demo_setup" Enter
Type "clear" Enter
Show

Type "npx @velella/offing check pkg:npm/request@2.88.2" Enter
Wait@30s /❯ *$/
Sleep 4
