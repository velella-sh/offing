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

## Downloads

Sizes are rounded for media. The forecast GIF is also published at the
[existing README image URL](../assets/demos/forecast.gif).

| Asset | Size | Source |
| --- | ---: | --- |
| [guard-agent.mp4](guard-agent.mp4) | 2.8 MB | Live Codex run with Offing's pre-write hook, edited to 30 seconds |
| [guard-agent.srt](guard-agent.srt) | 598 B | Captions timed to the Codex recording |
| [guard.gif](guard.gif) | 461 kB | [Guard tape](https://github.com/velella-sh/offing/blob/main/demos/guard.tape) |
| [guard.mp4](guard.mp4) | 2.1 MB | Guard tape and captions |
| [guard.srt](guard.srt) | 529 B | Exact CLI text from the guard tape |
| [forecast.gif](forecast.gif) | 366 kB | [Forecast tape](https://github.com/velella-sh/offing/blob/main/demos/forecast.tape) |
| [forecast.mp4](forecast.mp4) | 1.2 MB | Forecast tape and captions |
| [forecast.srt](forecast.srt) | 277 B | Exact CLI text from the forecast tape |

## Rebuild

From a fresh checkout, install Node.js 22+, VHS 0.12.1, ttyd, FFmpeg with
`libass` and `libx264`, a Chromium-based browser, and JetBrains Mono. Run:

```bash
npm ci
OFFING_VERSION=0.1.1 bash demos/build.sh
```

The script installs that exact npm version once with package scripts disabled.
Both tapes run the installed CLI and export 12 fps GIFs with 128-color
palettes and captioned MP4s. The checkout supplies the example files. For the Codex clip,
follow [the recording script](https://github.com/velella-sh/offing/blob/main/demos/SCRIPT.md). Its frames show the
request, hook response, and verification output from a live Codex CLI run,
with the CLI events formatted for the recording and idle time trimmed.

Run `OFFING_VERSION=0.1.1 bash demos/build.sh --check` to smoke-test all tapes
against that release. Use `bash demos/build.sh --check-source` to smoke-test
the checkout, as pull request CI does. Both checks use `timeout`, shorten
display pauses, and discard the rendered files. The Demos workflow accepts
an exact version for a hosted check of the released package.

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
