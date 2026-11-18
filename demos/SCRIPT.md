# Offing guard demo

**30 seconds.** Record a live Codex CLI session in a disposable project with Offing's
shipped Codex pre-write hook enabled. The matching terminal demo shows the npm
command that Offing can stop directly.

| Time | On screen |
| --- | --- |
| 0–8 s | Prompt asking Codex to add `request@2.88.2` to `package.json` and use native `fetch` if blocked. |
| 8–10 s | Codex attempts the dependency edit with `apply_patch`. |
| 10–20 s | Offing refuses the patch. Hold the deprecation, replacement, and npm evidence in view. |
| 20–30 s | Codex runs `node client.mjs` and the native `fetch` example prints `OK`. |

Keep the actual tool and hook output. Use a throwaway project and show only
relative project paths. The example fetches `data:,OK` so the fallback needs no
network service or new dependency.

## Record another take

1. Run `npm ci && npm run build` in Offing. Put that build on the demo shell's
   `PATH` as `offing`, for example with an executable wrapper that invokes
   `node /absolute/path/to/offing/dist/src/cli.js "$@"`. Set
   `OFFING_DATA_VERSION=bundled` in the demo shell.
2. Create a disposable Git repository containing
   `{"name":"offing-guard-demo","private":true,"dependencies":{}}` as its
   `package.json`. Run `offing init --hooks-for codex .`, open Codex there and
   approve the Offing hook in `/hooks` if it is pending. See the
   [Codex hook guide](../docs/hooks/codex.md).
3. Record just the terminal using your OS screen recorder or OBS Studio at
   16:9 with a readable monospace font. Hide the terminal title bar and
   crop startup output with local paths. Use this prompt:

   > Add request@2.88.2 to package.json using apply_patch. If blocked, use native fetch in client.mjs and run node client.mjs to print the body of data:,OK.

4. Keep a take where the hook blocks the dependency edit, `package.json`
   stays unchanged, and the fallback prints `OK`. Trim idle time to 30 seconds
   and sync [the agent captions](../docs/demos/guard-agent.srt) to the cut.
   From the Offing checkout, run
   `bash demos/build.sh --agent /absolute/path/to/trimmed.mp4`.
