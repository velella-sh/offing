# Offing demo tape: what a coding agent sees when it checks a deprecated
# package before adding it. The agent runs `offing check`, which exits 1 for a
# high-severity rule; the tape prints that exit code so the refusal is visible.
#
# Reproducible without an API key: `check` reads the bundled lifecycle data
# only, and no model or network is involved. Render from the repository root;
# see demos/scan.tape for the one-command regeneration loop and the CI drift
# gate in .github/workflows/demos.yml.

Output docs/assets/demos/agent.gif

Require node
Require bash

Set Shell "bash"
Set Width 1280
Set Height 520
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

Type 'npx @velella/offing check pkg:npm/request@2.88.2 ; echo "exit $?"' Enter
Wait+Screen@30s /exit 1/
Sleep 4
