# Offing demo tape: scan the demo project, show the forecast timeline, then
# write the HTML report and print where it lives.
#
# Determinism and offline: every command reads only `examples/demo` and bundled
# registry data — no network, no API key. `forecast --as-of` pins the clock the
# timeline counts from, `--format compact` carries no clock or absolute paths,
# `--no-cache` keeps the scan from writing into the example, and the prompt is
# pinned below. The HTML report embeds a generation time, so the tape never
# renders its contents; it prints only the fixed path it wrote to. `Output`
# paths resolve against the current directory, so render from the repository
# root; see demos/scan.tape for the regeneration loop and the CI drift gate in
# .github/workflows/demos.yml. The recording stays under 30 seconds.

Output docs/assets/demos/forecast.gif

Require node
Require bash

Set Shell "bash"
Set Width 1280
Set Height 620
Set FontSize 16
Set Padding 24
Set FontFamily "JetBrains Mono"
Set Theme "Catppuccin Mocha"
Set TypingSpeed 15ms
Set CursorBlink false

# Pin the prompt so the recording never shows the build machine's PS1.
Hide
Type "export PS1='offing $ '" Enter
Type "source demos/colorize.sh" Enter
Type "clear" Enter
Show

Type "npx @velella/offing scan examples/demo --no-cache --format compact" Enter
Wait@30s /offing .*$/
Sleep 2

Type "npx @velella/offing forecast examples/demo --timeline --as-of 2026-11-06" Enter
Wait@30s /offing .*$/
Sleep 4

Type "npx @velella/offing scan examples/demo --no-cache --format html > /tmp/offing-report.html" Enter
Wait@30s /offing .*$/
Type "echo file:///tmp/offing-report.html" Enter
Wait@30s /offing .*$/
Sleep 3
