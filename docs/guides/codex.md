---
title: Set up Offing in Codex
---

# Set up Offing in Codex

With [Offing installed](../launch/guard-in-one-command.md), configure it
from the project root.

```bash
offing init --hooks-for codex
```

Open the trusted project in Codex. Use `/hooks` to approve the registration
from `.codex/hooks.json` if it is pending.

In a scratch project, ask Codex to use `apply_patch` to add `test.js`
containing `const value = new Buffer(9);`. The pre-write hook refuses the
patch and shows `Buffer.alloc` as the replacement.

See the [Codex hook reference](../hooks/codex.md) for the payload format,
output, and removal.
