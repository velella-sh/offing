---
title: Set up Offing in Codex
---

# Set up Offing in Codex

With [Offing installed](https://velella.sh/offing/launch/guard-in-one-command/), configure it
from the project root.

```bash
offing init --hooks-for codex
```

Open the trusted project in Codex. Use `/hooks` to approve the registration
from `.codex/hooks.json` if it is pending.

In a scratch project, ask Codex to use `apply_patch` to add `test.js`
containing `const value = new Buffer(9);`. The pre-write hook refuses the
patch and shows `Buffer.alloc` as the replacement.

See the [Codex hook reference](https://velella.sh/offing/hooks/codex/) for the payload format,
output, and removal.
