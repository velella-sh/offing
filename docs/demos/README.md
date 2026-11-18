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
bash demos/build.sh
```

The script builds Offing, runs both tapes against the local build, and exports
12 fps GIFs with 128-color palettes and captioned MP4s. For the Codex clip,
follow [the recording script](https://github.com/velella-sh/offing/blob/main/demos/SCRIPT.md). Its frames show the
request, hook response, and verification output from a live Codex CLI run,
with the CLI events formatted for the recording and idle time trimmed.

Run `bash demos/build.sh --check` after building Offing to exercise the
Demos CI check locally. This mode needs GNU `timeout` and discards its renders.

## Other tape sources

These tapes render standalone. With Offing built and on your `PATH`, run
`vhs docs/demos/<name>.tape` from the repository root.

| Tape | Size | Source |
| --- | ---: | --- |
| [countdown.tape](countdown.tape) | 372 B | `gallery` example and `offing countdown` |
| [fix-show.tape](fix-show.tape) | 377 B | `codemods/dockerfile-legacy` example and `offing fix --show` |
| [glance.tape](glance.tape) | 355 B | `gallery` example and `offing glance` |
| [prompt.tape](prompt.tape) | 433 B | `examples/` scan and `offing prompt` |
| [timelapse.tape](timelapse.tape) | 364 B | Current checkout and `offing timelapse` |
| [watch-board.tape](watch-board.tape) | 328 B | Local watch list and `offing watch --board` |
| [wrapped.tape](wrapped.tape) | 346 B | Current checkout and `offing wrapped` |
| `README.md` | 3.0 kB | This inventory |
