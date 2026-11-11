# 0035 — One error model with stable reason codes

Status: accepted

## Problem

The CLI already sorted every failure into one of five classes (`policy`, `usage`, `data`, `parse`, `internal`) with
fixed exit codes. Beneath that, about twenty ad-hoc `Error` subclasses were mapped to a class one call site at a time,
and the MCP server reported a failure as a bare message. A caller could not tell two `usage` failures apart without
parsing prose, and an MCP client could not branch on a failure at all.

## Decision

1. `src/offing-error.ts` owns the model: `EXIT_CODES`, the `ERROR_CODES` table of stable reason codes (each
   belongs to exactly one class), and `OffingError`, which carries one reason code. Domain errors extend it, so
   the class and exit code follow from the code.
2. The CLI top-level handler and `ctx.failError` map an `OffingError` to its class and exit code. A thrown value
   that is not an `OffingError` is `internal`.
3. `offing.error.v1` gains an `error.reason` field holding the reason code. `error.code` (the class) and
   `error.exitCode` are unchanged, so existing callers keep working.
4. An MCP tool failure keeps its text and `isError` flag and adds `_meta.offing` with `code`, `class`, and
   `exitCode`. It still carries no structured content.
5. Reason codes are never renamed or moved to another class. A new failure gets a new code.

## Alternatives rejected

- **Renaming `error.code` to the specific reason.** It would break every script that branches on the class.
- **Structured content on MCP failures.** The tool output schemas describe success; a failure document there would
  not validate against them.
