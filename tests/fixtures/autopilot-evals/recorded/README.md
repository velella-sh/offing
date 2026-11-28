# Recorded synthetic Autopilot replays

Captured on November 28, 2026 using Offing source at `fc3a84a53dfc404c679024b99e9f49d26d6582c7`, with the capture case in `tests/autopilot-loop.test.ts`. The built CLI reported 0.1.1, bundled Ebb 0.2.0 and ran on Node.js 22.23.1. The synthetic test scripts ran in the pinned Docker profile with networking disabled. Capturing the four cases took 45.3 seconds on the local machine.

`results.json` preserves the recorded run states and verified proofs for the three attempted fixture cases. Each non-green row includes the digest of its failure receipt. The excluded case stopped at preflight before an agent turn. The four outcome counts and median usage come from the saved replay. [Capture and build commands](../../../../benchmarks/autopilot-evals/README.md#recorded-replay-scoreboard)
