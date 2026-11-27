# Offing guard demo

The 30-second video replays the recorded Codex session from a disposable
project. The prompt, attempted dependency edit, refusal text, and fallback
come from that session. The recording uses three fixed terminal frames.

| Time | On screen |
| --- | --- |
| 0–8 s | The prompt asks Codex to add `request@2.88.2` and use native `fetch` if the hook blocks it. |
| 8–20 s | Codex attempts the edit with `apply_patch`. Offing's refusal shows the deprecation, replacement, and npm evidence. |
| 20–30 s | The fallback uses native `fetch` and prints `OK` from a `data:` URL. |

## Rebuild and verify

```bash
npm ci
OFFING_VERSION=0.1.1 bash demos/build.sh --record guard-agent
OFFING_VERSION=0.1.1 bash demos/build.sh --check guard-agent
bash demos/build.sh --check-source guard-agent
```

Docker renders the [tape](guard-agent.tape) and
[captions](../docs/demos/guard-agent.srt) in one digest-pinned Linux renderer.
Each check renders twice and compares the finished MP4 files. The
[replay script](guard-agent.mjs) checks the recorded behavior in a temporary
project. The source check exercises the actual Codex pre-write hook, asserts
that the manifest stays unchanged, and runs the fallback. The published
`0.1.1` predates that hook and verifies the same finding via `offing check`.
No Codex login, model call, or network request from the fallback is needed.
