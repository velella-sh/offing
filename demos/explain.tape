# Offing demo tape: `explain` one finding of the offline demo project, with its
# source links and the replacement.
#
# Determinism: the finding id is fixed by the demo project, and `explain`
# prints no clock reading, so re-renders change only when the rule or the CLI
# output changes. Render from the repository root; see demos/scan.tape for the
# one-command regeneration loop and the CI drift gate in .github/workflows/demos.yml.

Output docs/assets/demos/explain.gif

Require node
Require bash

Set Shell "bash"
Set Width 1280
Set Height 520
Set FontSize 16
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 25ms
Set CursorBlink false

# Pin the prompt so the recording never shows the build machine's PS1.
Hide
Type "export PS1='offing $ '" Enter
Type "clear" Enter
Show

Type "node dist/src/cli.js explain 'github-actions.checkout.node20:.github/workflows/ci.yml:9' examples/demo" Enter
Wait@30s /offing .*$/
Sleep 4
