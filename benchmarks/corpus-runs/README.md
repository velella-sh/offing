# Recorded full corpus runs

`npm run record:corpus-run -- --offline` writes one JSON file per complete, passing run. Each file names the measured Offing Git commit, Ebb data version, date, and repository count. The dashboard reads the saved counts to build its trend offline.

- The 2026-11-15 entry is the [original recorded run](https://github.com/velella-sh/offing/actions/runs/43716409478). Its source recorded overall and per-detector scores only, so its ecosystem scores are absent.
- The first 2026-11-26 entry comes from the [complete corpus CI report](https://github.com/velella-sh/offing/actions/runs/45910759854) at the exact commit recorded in the file.
- The second 2026-11-26 entry comes from the offline verification of the four added pins at the recorded commit. It uses the same bundled Ebb version as that day's CI run.
