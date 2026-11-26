# Version file fixtures

- [mise's local setup](https://github.com/jdx/mise/blob/f70c2d93e5baf4480af0286fa44a1e30ac3322a6/mise.toml) is included through its `[tools]` table. Node 24 is on line 35. Backend-qualified tools outside Offing's runtime map are skipped.
- [Forem's `.mise.toml`](https://github.com/forem/forem/blob/c2435d667eb5beed4e77d313a40c9ec804e5b966/.mise.toml) delegates Ruby and Node to their own files. Its Yarn, Postgres, and Redis declarations produce zero findings from Offing's mapped mise runtimes.
- [pnpm's `package.json`](https://github.com/pnpm/pnpm/blob/f2024ea710ed5c0e8d74029173a9c2091fd67dec/package.json) is reduced to `devEngines`. The Node 26.13.1 pin on fixture line 10 produces no lifecycle finding. pnpm 12.24.0 on line 5 has no lifecycle data in the bundled registry.
- [pandas' `environment.yml`](https://github.com/pandas-dev/pandas/blob/2e218d10984e9919f0296931d92ea851c6a6faf5/environment.yml) specifies Python 3.8 on line 6 and two pip requirements on lines 131–132. The Python line produces an EOL finding. Neither listed pip package has a matching rule.
- [asdf's own `.tool-versions`](https://github.com/asdf-vm/asdf/blob/1f8756be2273161c7ef50001bbae0d859d1c588d/.tool-versions) lists Bats, ShellCheck, shfmt, and Go in that order on lines 1–4.
- The synthetic `consumer/mise.toml` gives all supported runtime detectors an older version and gives Node an unresolved alias alongside its pin.
