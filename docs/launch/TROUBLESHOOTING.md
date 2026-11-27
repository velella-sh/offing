---
title: Troubleshoot Offing hooks and first runs
---

# Troubleshoot Offing hooks and first runs

## The host cannot run the hook

Run `offing --version` in the environment the host uses. If the command
cannot be found, put the installed npm binary directory on that environment's
PATH and reopen the project. Run `offing init --hooks --list` from the
project root to inspect host setup. The [host guides](../guides/index.md)
show the project file and where to check that the host loaded it.

## A proposed edit or install is refused

Read the replacement and evidence in the refusal. For the sample install in
the [guard guide](guard-in-one-command.md), replacing `request` with native
`fetch` or a maintained HTTP client avoids adding that deprecated dependency.
For a hook refusal on the sample `new Buffer(9)` edit, use `Buffer.alloc(9)`.
To undo Offing's hook registrations, use the removal command for your host.

```bash
offing init --hooks --remove --hooks-for claude-code
offing init --hooks --remove --hooks-for codex
offing init --hooks --remove --hooks-for cursor
```

Run only the line for your host. Cursor keeps its shared project rule, which
you can manage in Cursor's Rules settings.

## The hook reports unavailable lifecycle data

Run `offing data status` and check whether `OFFING_DATA_VERSION` points to a
missing or unusable bundle. Run `offing data status --data-version bundled`
to check the data shipped with the installation. See
[pinning and updates](../DATA.md#pinning).

## The first invocation is slow

An uncached `npx` invocation downloads and installs the package before
Offing starts. Use an [installed CLI](../INSTALL.md) if you want to reuse
the same installation across runs. See the
[quickstart timings](../QUICKSTART.md#time-to-the-first-forecast) for how
download, installation, and forecast time are measured.
