# Leaderboard rescore fixture

`recordings/` contains one hand-written Node.js source response. `recorded/` is its actual replay from Offing commit [`d5e7dc19`](https://github.com/velella-sh/offing/commit/d5e7dc194a59da49e20aee76fb03ea1fe0d123b2) with bundled Ebb 0.2.0. The attempt records its exact versions and content hashes.

`expected.json` is the offline rescore of `recorded/`. CI compares its bytes with a fresh rescore. A separate check alters a temporary copy to verify that drift fails. All rows carry `fixture` provenance and stay in the test fixture directory.
