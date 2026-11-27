---
title: Set up Offing in Cursor
---

# Set up Offing in Cursor

With [Offing installed](../launch/guard-in-one-command.md), configure it
from the project root.

```bash
offing init --hooks-for cursor
```

Open the project in Cursor and check **Settings → Hooks** for the
project's `.cursor/hooks.json`.

In a scratch project, ask the Agent to use its Write tool to create `test.js`
containing `const value = new Buffer(9);`. The pre-write hook denies the
write and recommends `Buffer.alloc`.

See the [Cursor hook reference](../hooks/cursor.md) for the after-edit audit
log, project rule, and removal.
