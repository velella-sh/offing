---
title: Guard your coding agent in one command
description: Set up project-local edit hooks and try a package refusal.
---

# Guard your coding agent in one command

Install Offing where your agent host can find it. Open the host once or put
its CLI on your PATH. From the project root, run the setup command.

```bash
npm install --global @velella/offing
offing init --hooks-for claude-code
```

Use `codex` or `cursor` in the second command if you use one of those hosts.
The [host guides](https://velella.sh/offing/guides/) show the file written, how to load the
project configuration, and a first edit to try.

The published `0.1.1` package installs after-edit feedback. The sample
pre-write refusals in the host guides require a build with pre-write support. To try that build
from an Offing checkout, run `npm ci`, `npm run build`, and
`npm pack --ignore-scripts`, then install the resulting tarball in place
of the registry package so the host can find its `offing` command.

Try a package refusal from the terminal with the bundled data.

```bash
offing guard --data-version bundled npm install --dry-run --offline request@2.88.2
```

```text
Replacement: Native fetch or a maintained HTTP client
Evidence: https://www.npmjs.com/package/request
```

![Offing refuses the offline installation of deprecated request 2.88.2 and suggests native fetch or a maintained HTTP client](https://velella.sh/offing/launch/img/guard-release-0.1.1.webp)

This frame shows the refusal in the [0.1.1 guard recording](https://velella.sh/offing/demos/guard.mp4).

That command exits with status 1 before npm starts. To remove Offing's
project hook registrations for Claude Code, run the following. Use the same
host name you chose during setup.

```bash
offing init --hooks --remove --hooks-for claude-code
```

See [Guard package installs](https://velella.sh/offing/guard/) for the CLI gate and
[troubleshooting](https://velella.sh/offing/launch/TROUBLESHOOTING/) for hook setup and removal.
