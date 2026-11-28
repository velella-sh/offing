---
title: Offing demo recordings
---

# Offing demo recordings

Watch [Codex run into Offing's dependency guard](guard-agent.mp4), see what
[the guard prints before an npm install](guard.mp4), or view
[the three forecast horizons](forecast.mp4). The silent MP4s have burned-in
captions and use one H.264 profile for X and LinkedIn (1280×720, 30 fps).
[See X's limits](https://help.x.com/en/using-x/x-videos) and
[LinkedIn's limits](https://www.linkedin.com/help/linkedin/answer/a548372).

## First-run candidate

The [first-run recording](first-run.gif) shows the Node.js gallery fixture. Its final line reads:

> Autopilot can fix 1; run offing autopilot . --dry-run --wave 0 to preview.

The [tape](https://github.com/velella-sh/offing/blob/main/demos/first-run.tape) waits for the same line as the first-run snapshot. This recording uses the candidate packed from commit `1e6d1225` with bundled data. The tarball reports `0.1.1` and has SHA-256 `0639a32042c9d2c9071b84b5b1630c20313d04aed594055f60f1584ceb811de3`. The published 0.1.1 package shows help for this invocation.

## Downloads

Sizes are rounded for media. The forecast GIF is also linked from the
[terminal recordings](../DEMO.md#terminal-recordings).

| Asset | Size | Source |
| --- | ---: | --- |
| [guard-agent.mp4](guard-agent.mp4) | 2.8 MB | Scripted replay of a recorded Codex run, with fixed frame times |
| [guard-agent.srt](guard-agent.srt) | 598 B | Captions timed to the replay |
| [guard.gif](guard.gif) | 355 kB | [Guard tape](https://github.com/velella-sh/offing/blob/main/demos/guard.tape) |
| [guard.mp4](guard.mp4) | 2.1 MB | Guard tape and captions |
| [guard.srt](guard.srt) | 529 B | Exact CLI text from the guard tape |
| [forecast.gif](forecast.gif) | 288 kB | [Forecast tape](https://github.com/velella-sh/offing/blob/main/demos/forecast.tape) |
| [forecast.mp4](forecast.mp4) | 1.2 MB | Forecast tape and captions |
| [forecast.srt](forecast.srt) | 277 B | Exact CLI text from the forecast tape |

## Release recording manifest

The [manifest](manifest.json) records the npm version and the tape, caption, and media digests for the released forecast, guard, and Codex guard recordings. Every file in `docs/demos/` and `docs/assets/demos/` is checked against the inventory, apart from this guide, the manifest, and the empty directory marker. All GIFs must be smaller than 3 MB.

The inventory also records supplemental media by exact file and source commit. The seven historical README recordings of baseline, check, explain, fix, lookup, scan, and setup preserve the bytes from [the original recording change](https://github.com/velella-sh/offing/commit/08709fe36c752c64a3310599a1ea913dbc4a158b). The Autopilot GIF shows the [source replay](https://github.com/velella-sh/offing/commit/b821f1ce170475aea318e7e72dc93a1c1af700ee), and the first-run GIF uses the candidate described above. These files carry their own provenance in the manifest. Regenerating the manifest rejects a supplemental file whose bytes differ from its recorded source. Regenerate a released export against the published CLI before claiming its package version.

After building the featured exports from the selected npm version, run:

```bash
node dist/tools/demo-manifest.js --check-captions
node dist/tools/demo-manifest.js --write 0.1.1
node dist/tools/demo-manifest.js --check 0.1.1
```

The Demos check validates the committed manifest and smoke-renders the tapes. The pinned guard-agent replay additionally compares the resulting video with the committed bytes. The pull request workflow also encodes a different caption from the same frames in a temporary directory. It checks that the old manifest rejects that MP4 and that a refreshed manifest accepts it.

## Rebuild

From a fresh checkout, install Node.js 22+, VHS 0.12.1, ttyd, FFmpeg with
`libass` and `libx264`, a Chromium-based browser, JetBrains Mono, and Docker.
Build the gallery with these commands.

```bash
npm ci
OFFING_VERSION=0.1.1 bash demos/build.sh
```

The script installs that exact npm version once with package scripts disabled.
The build turns the timed caption cues annotated in the featured tapes into SRT files before encoding the MP4s. The guard and forecast tapes export 12 fps GIFs with 128-color palettes and captioned MP4s. The checkout supplies the example files. The
[Codex replay](https://github.com/velella-sh/offing/blob/main/demos/SCRIPT.md)
uses a digest-pinned Docker renderer and preserves the recorded prompt, refusal,
and fallback. The published 0.1.1 CLI predates the Codex write hook, so the
released-package replay validates the finding with `offing check` and uses
the original recording for the refusal text. Rebuild just that MP4 with
`OFFING_VERSION=0.1.1 bash demos/build.sh --record guard-agent`.

Run `OFFING_VERSION=0.1.1 bash demos/build.sh --check guard-agent` to check
the replay against that release. Use `bash demos/build.sh --check-source`
to smoke-test all tapes against the checkout, as pull request CI does. The Codex
replay check compares two 30-second rebuilds and the checked-in MP4. The other
tape checks shorten display pauses. The checks discard the rendered files.
The Demos workflow compares the inventory version with the latest published GitHub release. Dispatch it with an exact version to install that package and replay the released recordings. Pass a tape name to the local check when you want to replay one tape. Test the first-run tape from a candidate with
`bash demos/build.sh --check-source first-run`.

## Other tape sources

The tape sources live under `demos/`. From the repository root, run
`OFFING_VERSION=0.1.1 bash demos/build.sh --record <name>` to record one tape.

| Tape | Source |
| --- | --- |
| [countdown.tape](https://github.com/velella-sh/offing/blob/main/demos/countdown.tape) | `gallery` example and `offing countdown` |
| [fix-show.tape](https://github.com/velella-sh/offing/blob/main/demos/fix-show.tape) | `codemods/dockerfile-legacy` example and `offing fix --show` |
| [glance.tape](https://github.com/velella-sh/offing/blob/main/demos/glance.tape) | `gallery` example and `offing glance` |
| [prompt.tape](https://github.com/velella-sh/offing/blob/main/demos/prompt.tape) | `demo` example and `offing prompt` |
| [timelapse.tape](https://github.com/velella-sh/offing/blob/main/demos/timelapse.tape) | Current checkout and `offing timelapse` |
| [watch-board.tape](https://github.com/velella-sh/offing/blob/main/demos/watch-board.tape) | Isolated watch list and `offing watch --board` |
| [wrapped.tape](https://github.com/velella-sh/offing/blob/main/demos/wrapped.tape) | Two dated example commits and `offing wrapped` |
