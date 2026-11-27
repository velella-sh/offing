# Fleet benchmark

From the repository root, build Offing and then give the benchmark permission
to contact GitHub.

```sh
npm run build
node dist/benchmarks/fleet/index.js --live
```

The benchmark scans three public repositories at the commits pinned in
`index.ts`, using two workers and a fresh temporary cache. It measures a
cold scan and repeats the same commits with the cache populated. It reports
repositories per minute, cache hit rate, and the downloaded Git object
size on disk or compressed archive bytes. The Git transport measure omits
HTTP overhead.
