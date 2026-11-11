# Offing demo tape: look up one product's lifecycle status offline.
#
# The `lookup` output is registry data only — no clock, no paths, no network —
# so re-renders change only when the bundled lifecycle data for the product
# changes. `Output` paths resolve against the current directory, so always
# render from the repository root; see demos/scan.tape for the one-command
# regeneration loop and the CI drift gate in .github/workflows/demos.yml.

Output docs/assets/demos/lookup.gif

Require node
Require bash

Set Shell "bash"
Set Width 1280
Set Height 380
Set FontSize 16
Set Padding 24
Set FontFamily "JetBrains Mono"
Set Theme "Catppuccin Mocha"
Set TypingSpeed 25ms
Set CursorBlink false

# Pin the prompt so the recording never shows the build machine's PS1.
Hide
Type "export PS1='offing $ '" Enter
Type "source demos/colorize.sh" Enter
Type "clear" Enter
Show

Type "npx @velella/offing lookup node 18" Enter
Wait@30s /offing .*$/
Sleep 3
