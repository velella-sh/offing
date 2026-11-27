---
title: Set up Offing in Claude Code
---

# Set up Offing in Claude Code

With [Offing installed](https://velella.sh/offing/launch/guard-in-one-command/), configure it
from the project root.

```bash
offing init --hooks-for claude-code
```

Open the project in Claude Code. Run `/hooks` and look for the Offing
`PreToolUse` and `PostToolUse` entries from `.claude/settings.json`.

In a scratch project, ask Claude Code to use its Write tool to create
`test.js` containing `const value = new Buffer(9);`. The pre-write hook
refuses the proposed edit and shows `Buffer.alloc` as the replacement.

See the [Claude Code hook reference](https://velella.sh/offing/hooks/claude-code/) for supported
tools, output, and removal.
