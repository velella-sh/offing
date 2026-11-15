# Offing compared with Dependabot

Run under [docs/COMPARISON_METHOD.md](../../../docs/COMPARISON_METHOD.md), whose section 7 records that Dependabot
cannot be run against a pinned commit. This is therefore **not a head-to-head result**: Dependabot was not run, and
no finding here was reported by it. What is measured is the update surface each repository's committed
`dependabot.yml` declares, checked against the same pinned checkouts. Read [README.md](README.md) for what the
numbers do and do not say.

Offing 0.1.1 at 945a32e9 (the base commit the run executed from).

## Summary

| Selection | Repositories | With a config | Without a config | Offing findings | Covered | Uncovered | Uncovered, no config | Uncovered, config present | Filtered | No entry |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Blind | 1361 | 189 | 1172 | 9397 | 399 | 5294 | 4802 | 492 | 46 | 3658 |
| Targeted | 5 | 3 | 2 | 166 | 0 | 114 | 52 | 62 | 16 | 36 |

- **Covered:** a matching `package-ecosystem` and directory is declared, with no `ignore` or `allow` list. The
  package and directory are inside the update surface the repository asked Dependabot to watch. This does not mean
  Dependabot reported the lifecycle fact; it only means it can see that dependency.
- **Uncovered:** the bridge maps the finding to a Dependabot `package-ecosystem`, but no declared entry watches that
  ecosystem and directory. It is split by whether the repository commits a Dependabot configuration at all.
- **Filtered:** a matching entry declares `ignore` or `allow`. Those dependency-level filters are not evaluated, so
  the finding is counted neither as covered nor as uncovered.
- **No entry:** the bridge has no `package-ecosystem` for the finding, so no update entry could carry it. The
  mapping is Offing's bridge, not Dependabot's ecosystem list; a missing mapping is a limit of the bridge.

## By Dependabot package-ecosystem

Findings the bridge maps to a Dependabot `package-ecosystem`, grouped by that ecosystem. Runtime findings, retired
APIs, host-image policies, and Dockerfile syntax are not in this table at all; they have no update entry.

| Selection | package-ecosystem | Covered | Uncovered | Filtered | Total |
| --- | --- | ---: | ---: | ---: | ---: |
| Blind | cargo | 1 | 31 | 0 | 32 |
| Blind | composer | 0 | 32 | 0 | 32 |
| Blind | docker | 2 | 375 | 1 | 378 |
| Blind | github-actions | 372 | 3490 | 28 | 3890 |
| Blind | gomod | 1 | 2 | 0 | 3 |
| Blind | gradle | 0 | 22 | 0 | 22 |
| Blind | maven | 1 | 63 | 0 | 64 |
| Blind | npm | 22 | 1269 | 17 | 1308 |
| Blind | nuget | 0 | 1 | 0 | 1 |
| Blind | pip | 0 | 9 | 0 | 9 |
| Targeted | docker | 0 | 16 | 0 | 16 |
| Targeted | github-actions | 0 | 77 | 0 | 77 |
| Targeted | npm | 0 | 21 | 16 | 37 |

## Findings with no Dependabot update entry

Grouped by the first two rule-id segments. They are not misses of Dependabot and not wins for Offing: the bridge
has no update entry to put them in.

| Selection | Rule family | Findings |
| --- | --- | ---: |
| Blind | `nodejs.runtime` | 629 |
| Blind | `dotnet.runtime` | 533 |
| Blind | `container.dockerfile` | 450 |
| Blind | `terraform.syntax` | 384 |
| Blind | `shell.powershell` | 199 |
| Blind | `python.runtime` | 198 |
| Blind | `serverless.aws-lambda` | 173 |
| Blind | `go.runtime` | 131 |
| Blind | `dart.sdk` | 98 |
| Blind | `ruby.runtime` | 98 |
| Blind | `terraform.function` | 73 |
| Blind | `github-actions.workflow-command` | 63 |
| Blind | `rust.toolchain` | 62 |
| Blind | `elixir.erlang` | 58 |
| Blind | `kubernetes.extensions` | 50 |
| Blind | `scala.sbt` | 47 |
| Blind | `swift.xcode` | 47 |
| Blind | `deno.runtime` | 36 |
| Blind | `deno.bun` | 35 |
| Blind | `database.postgresql` | 34 |
| Blind | `scala.runtime` | 30 |
| Blind | `cpp.cmake` | 28 |
| Blind | `elixir.runtime` | 28 |
| Blind | `kubernetes.rbac-authorization-k8s-io` | 28 |
| Blind | `ci-images.azure-pipelines` | 20 |
| Blind | `swift.app-store` | 17 |
| Blind | `kubernetes.policy` | 16 |
| Blind | `kubernetes.apps` | 13 |
| Blind | `kubernetes.batch` | 13 |
| Blind | `php.runtime` | 12 |
| Blind | `kubernetes.helm` | 11 |
| Blind | `database.mysql` | 8 |
| Blind | `terraform.cli` | 8 |
| Blind | `kubernetes.autoscaling` | 6 |
| Blind | `database.redis` | 5 |
| Blind | `database.mongodb` | 3 |
| Blind | `kubernetes.apiextensions-k8s-io` | 3 |
| Blind | `kubernetes.networking-k8s-io` | 3 |
| Blind | `kubernetes.storage-k8s-io` | 3 |
| Blind | `java.jdk` | 2 |
| Blind | `kubernetes.apiregistration-k8s-io` | 2 |
| Blind | `serverless.azure-app-service` | 1 |
| Targeted | `nodejs.runtime` | 24 |
| Targeted | `container.dockerfile` | 7 |
| Targeted | `github-actions.workflow-command` | 2 |
| Targeted | `python.runtime` | 2 |
| Targeted | `database.postgresql` | 1 |

## Repositories with a Dependabot config

Every repository in the comparison that commits a Dependabot configuration, with its pinned file linked. Rows with
no findings are still listed, because the configuration is part of the evidence.

| Repository | Selection | Config | Entries | Findings | Covered | Uncovered | Filtered | No entry |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 8go/matrix-commander-rs | Blind | [`.github/dependabot.yml`](https://github.com/8go/matrix-commander-rs/blob/9f3a44cdcf36664b206936de28d2e598af1f7c13/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| a-kenji/tui-term | Blind | [`.github/dependabot.yml`](https://github.com/a-kenji/tui-term/blob/f0ffe97fb984c96ec9490ba8174fd26a01b994cf/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| aarongarrett/inspyred | Blind | [`.github/dependabot.yml`](https://github.com/aarongarrett/inspyred/blob/fb29ba3b9d9e582dabe72f278458ed0e6932eb7c/.github/dependabot.yml) | 1 | 3 | 0 | 0 | 0 | 3 |
| aaronsb/obsidian-mcp-plugin | Blind | [`.github/dependabot.yml`](https://github.com/aaronsb/obsidian-mcp-plugin/blob/103ee962ff879f5f062a89145969c8225f09b38c/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| acolomba/blackvuesync | Blind | [`.github/dependabot.yml`](https://github.com/acolomba/blackvuesync/blob/e2c382fa40392f5d4d1a156b29427d032911d736/.github/dependabot.yml) | 3 | 2 | 0 | 1 | 0 | 1 |
| adamyodinsky/TerminalGPT | Blind | [`.github/dependabot.yml`](https://github.com/adamyodinsky/TerminalGPT/blob/48739c452f5e16e8953a8c98deed47adcabcf736/.github/dependabot.yml) | 1 | 6 | 0 | 4 | 0 | 2 |
| aeria-org/aeria | Blind | [`.github/dependabot.yml`](https://github.com/aeria-org/aeria/blob/500099fcd90f3e63a3a00e283fbcc4c9355f58ba/.github/dependabot.yml) | 1 | 8 | 0 | 4 | 0 | 4 |
| ain-soph/trojanzoo | Blind | [`.github/dependabot.yml`](https://github.com/ain-soph/trojanzoo/blob/45d680c4d3bc7810a0a7a5b6fa939f87d5e6c551/.github/dependabot.yml) | 2 | 14 | 14 | 0 | 0 | 0 |
| aio-libs/aiosmtpd | Blind | [`.github/dependabot.yml`](https://github.com/aio-libs/aiosmtpd/blob/0aef6a19bf3c43ebded54ee943aaacbff93d68bf/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| ais-one/novex-kit | Blind | [`.github/dependabot.yml`](https://github.com/ais-one/novex-kit/blob/c095604ab38fc5b9ef7b92237fa88d4e6d368260/.github/dependabot.yml) | 3 | 3 | 0 | 1 | 0 | 2 |
| AlbertHernandez/nestjs-service-template | Blind | [`.github/dependabot.yml`](https://github.com/AlbertHernandez/nestjs-service-template/blob/74daaf0f42430483d9c47afcb31b9a596d22aa21/.github/dependabot.yml) | 2 | 23 | 20 | 1 | 0 | 2 |
| alexandregpereira/Monster-Compendium | Blind | [`.github/dependabot.yml`](https://github.com/alexandregpereira/Monster-Compendium/blob/8d7225ff3454c8e546d09bcc4791f3cdb9f8bdd3/.github/dependabot.yml) | 1 | 14 | 0 | 14 | 0 | 0 |
| alexhaberl/VaultLink | Blind | [`.github/dependabot.yml`](https://github.com/alexhaberl/VaultLink/blob/fddf07eccedb7abb414c9205ab83486b23f23872/.github/dependabot.yml) | 4 | 0 | 0 | 0 | 0 | 0 |
| allegro/node-worker-nodes | Blind | [`.github/dependabot.yml`](https://github.com/allegro/node-worker-nodes/blob/ad3c86730e8bf70bfad8d6d18a6fc5bf584c9443/.github/dependabot.yml) | 3 | 15 | 7 | 0 | 0 | 8 |
| allgpt-co/QuickVoice | Blind | [`.github/dependabot.yml`](https://github.com/allgpt-co/QuickVoice/blob/b4197d79af5d3fc94efb3ef2b251bcab8de8d34c/.github/dependabot.yml) | 5 | 41 | 41 | 0 | 0 | 0 |
| Androz2091/discord-backup | Blind | [`.github/dependabot.yml`](https://github.com/Androz2091/discord-backup/blob/472cb7c8eb3d899cd4348ac7381b6d695e068404/.github/dependabot.yml) | 1 | 5 | 0 | 2 | 2 | 1 |
| ardalis/GuardClauses | Blind | [`.github/dependabot.yml`](https://github.com/ardalis/GuardClauses/blob/61dde6c9d3e1715286bd100144a9edff1ad0664c/.github/dependabot.yml) | 2 | 3 | 0 | 0 | 0 | 3 |
| ardalis/SmartEnum | Blind | [`.github/dependabot.yml`](https://github.com/ardalis/SmartEnum/blob/e06da550950b347f0ee47b1ec370a7416e79b030/.github/dependabot.yml) | 1 | 68 | 0 | 26 | 0 | 42 |
| asciimoo/hister | Blind | [`.github/dependabot.yml`](https://github.com/asciimoo/hister/blob/5f04dd9352cdeefdc9602f0dba14045aad710a11/.github/dependabot.yml) | 5 | 0 | 0 | 0 | 0 | 0 |
| Automattic/simplenote-electron | Blind | [`.github/dependabot.yml`](https://github.com/Automattic/simplenote-electron/blob/a5a1a86f1ada16f97f14533491d1a85313c68edb/.github/dependabot.yml) | 1 | 11 | 0 | 6 | 0 | 5 |
| Automattic/wordpress-rs | Blind | [`.github/dependabot.yml`](https://github.com/Automattic/wordpress-rs/blob/7ee25d1aafe8c20b4f3be2aedf0f442bac9dbcab/.github/dependabot.yml) | 5 | 0 | 0 | 0 | 0 | 0 |
| aws-cloudformation/cloudformation-cli | Blind | [`.github/dependabot.yml`](https://github.com/aws-cloudformation/cloudformation-cli/blob/232d2983fcba15ff8f7da026c116efa51f5ae486/.github/dependabot.yml) | 1 | 7 | 6 | 0 | 0 | 1 |
| aws-cloudformation/cloudformation-guard | Blind | [`.github/dependabot.yml`](https://github.com/aws-cloudformation/cloudformation-guard/blob/d7cbdb08ea91a60739684c6c453176341f6e32aa/.github/dependabot.yml) | 3 | 38 | 0 | 32 | 0 | 6 |
| aws/graph-explorer | Blind | [`.github/dependabot.yml`](https://github.com/aws/graph-explorer/blob/2ff4ceabe1c7b4b1e786344decb184362b320306/.github/dependabot.yml) | 3 | 0 | 0 | 0 | 0 | 0 |
| awslabs/aws-config-rdklib | Blind | [`.github/dependabot.yml`](https://github.com/awslabs/aws-config-rdklib/blob/dd90eb67422b4c2d91a4dd79ec3e970d6f051b2a/.github/dependabot.yml) | 1 | 10 | 0 | 9 | 0 | 1 |
| axe-api/axe-api | Blind | [`.github/dependabot.yml`](https://github.com/axe-api/axe-api/blob/81deacdf696dfe3fc022cb9ce85c0bf0013c2f8a/.github/dependabot.yml) | 1 | 35 | 1 | 26 | 0 | 8 |
| Azure/azure-functions-powershell-worker | Blind | [`.github/dependabot.yml`](https://github.com/Azure/azure-functions-powershell-worker/blob/2debea0f983f5016d3c54302c749e8f7e4690544/.github/dependabot.yml) | 1 | 5 | 1 | 1 | 0 | 3 |
| backpack-exchange/bpx-api-client | Blind | [`.github/dependabot.yml`](https://github.com/backpack-exchange/bpx-api-client/blob/c1e31336b18dc91027451cd3caf918bfc56a994f/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| bcomnes/npm-run-all2 | Blind | [`.github/dependabot.yml`](https://github.com/bcomnes/npm-run-all2/blob/42aeadd27c352024a54c06b2b311703be52edf44/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| bcyran/timewall | Blind | [`.github/dependabot.yml`](https://github.com/bcyran/timewall/blob/c7c8a19163c871a5412c143418e9ae5b3b1e7572/.github/dependabot.yml) | 2 | 4 | 0 | 0 | 0 | 4 |
| bee-browser/bee | Blind | [`.github/dependabot.yml`](https://github.com/bee-browser/bee/blob/faef7663a0027eb1cae50361f1cd6848d8c6a193/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| BenoitZugmeyer/eslint-plugin-html | Blind | [`.github/dependabot.yml`](https://github.com/BenoitZugmeyer/eslint-plugin-html/blob/4cec5bff2686e014191c2281867d8c291cd8e7ca/.github/dependabot.yml) | 2 | 7 | 0 | 0 | 0 | 7 |
| bjankord/stylelint-config-sass-guidelines | Blind | [`.github/dependabot.yml`](https://github.com/bjankord/stylelint-config-sass-guidelines/blob/873156ec38b5e7e1e0f7bf4a17929bbf2fbce93a/.github/dependabot.yml) | 1 | 5 | 0 | 2 | 0 | 3 |
| blazejkustra/react-compiler-marker | Blind | [`.github/dependabot.yml`](https://github.com/blazejkustra/react-compiler-marker/blob/896da66c3f6f68c2472974cca6e154104736a993/.github/dependabot.yml) | 1 | 14 | 0 | 14 | 0 | 0 |
| BranchMetrics/android-branch-deep-linking-attribution | Blind | [`.github/dependabot.yml`](https://github.com/BranchMetrics/android-branch-deep-linking-attribution/blob/e12e2998cf1b4e3d87c613c49cd4ae78a003bf0a/.github/dependabot.yml) | 1 | 9 | 5 | 4 | 0 | 0 |
| bxcodec/go-clean-arch | Blind | [`.github/dependabot.yml`](https://github.com/bxcodec/go-clean-arch/blob/e06c6d0cb37069b0ef56e3df67f80ca130a1ab82/.github/dependabot.yml) | 1 | 4 | 0 | 3 | 0 | 1 |
| c410-f3r/wtx | Blind | [`.github/dependabot.yml`](https://github.com/c410-f3r/wtx/blob/20d7f68d96d13cc97c5acea14911f97106e68f2e/.github/dependabot.yml) | 2 | 2 | 0 | 0 | 2 | 0 |
| camshaft/bolero | Blind | [`.github/dependabot.yml`](https://github.com/camshaft/bolero/blob/7642943b6c1f8a9b5e824dd1cd29b7c8e56068b8/.github/dependabot.yml) | 2 | 2 | 0 | 0 | 0 | 2 |
| cfug/dio | Blind | [`.github/dependabot.yaml`](https://github.com/cfug/dio/blob/f1bef462289b40992d625d4eb2a2f42321217573/.github/dependabot.yaml) | 1 | 0 | 0 | 0 | 0 | 0 |
| chaibuilder/core | Blind | [`.github/dependabot.yml`](https://github.com/chaibuilder/core/blob/56a002fec825020467fef0f6709cfc028c079b51/.github/dependabot.yml) | 2 | 2 | 0 | 0 | 0 | 2 |
| charmbracelet/wish | Blind | [`.github/dependabot.yml`](https://github.com/charmbracelet/wish/blob/2af05484795152f53d9ad10b5be5748a4bec3c95/.github/dependabot.yml) | 4 | 0 | 0 | 0 | 0 | 0 |
| cinar/indicatorts | Blind | [`.github/dependabot.yml`](https://github.com/cinar/indicatorts/blob/c6bfb623b2ccbac2c536d60740e8c458e4efa7cd/.github/dependabot.yml) | 2 | 5 | 3 | 0 | 0 | 2 |
| clavia-labs/tardigrade | Blind | [`.github/dependabot.yml`](https://github.com/clavia-labs/tardigrade/blob/6a8e2250f2efc091cb10e97127b11bce98dfac55/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| clearloop/leetcode-cli | Blind | [`.github/dependabot.yml`](https://github.com/clearloop/leetcode-cli/blob/fba4448961b779ebb3ba6d3b45dccc4d11deea1b/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| CloudNationHQ/terraform-azure-func | Blind | [`.github/dependabot.yml`](https://github.com/CloudNationHQ/terraform-azure-func/blob/f3caae4c2184bfc1968fc64953d9a6558cab2575/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| cobrateam/splinter | Blind | [`.github/dependabot.yml`](https://github.com/cobrateam/splinter/blob/861539107381e848f63c350189360520c300ced9/.github/dependabot.yml) | 1 | 16 | 0 | 15 | 0 | 1 |
| cockpit-project/cockpit-machines | Blind | [`.github/dependabot.yml`](https://github.com/cockpit-project/cockpit-machines/blob/a759311b08871c32db4779d40df83ba4bfb4f24f/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| codama-idl/codama | Blind | [`.github/dependabot.yml`](https://github.com/codama-idl/codama/blob/f2cb3d0b99e7b53d467c18fd6f9fa1e2ed388204/.github/dependabot.yml) | 2 | 3 | 0 | 0 | 0 | 3 |
| coingaming/moon | Blind | [`.github/dependabot.yml`](https://github.com/coingaming/moon/blob/7b2881ef1a4b8e0d0d297f92df7085e6461e4d77/.github/dependabot.yml) | 1 | 19 | 6 | 10 | 0 | 3 |
| couetilc/react-social-icons | Blind | [`.github/dependabot.yml`](https://github.com/couetilc/react-social-icons/blob/3a02ba70dc892a94bac805e90b10984da5db8bd3/.github/dependabot.yml) | 2 | 9 | 5 | 0 | 3 | 1 |
| cunarist/rinf | Blind | [`.github/dependabot.yaml`](https://github.com/cunarist/rinf/blob/da30454e5bfeb89d6e273d29bb0c09458818d36d/.github/dependabot.yaml) | 1 | 0 | 0 | 0 | 0 | 0 |
| damianeickhoff/HaCasa | Blind | [`.github/dependabot.yml`](https://github.com/damianeickhoff/HaCasa/blob/70795463b4da5bb652f3b2081269c8c53177c82c/.github/dependabot.yml) | 1 | 1 | 0 | 0 | 0 | 1 |
| darkroomengineering/aniso | Blind | [`.github/dependabot.yml`](https://github.com/darkroomengineering/aniso/blob/59d0aa139b6964de2ba4c042f04505677aed4cd8/.github/dependabot.yml) | 1 | 2 | 1 | 1 | 0 | 0 |
| DarrenOfficial/dpaste | Blind | [`.github/dependabot.yml`](https://github.com/DarrenOfficial/dpaste/blob/64068f7a78158a09babd5880f1384610ffc710c8/.github/dependabot.yml) | 1 | 16 | 0 | 5 | 0 | 11 |
| dart-lang/sdk | Blind | [`.github/dependabot.yml`](https://github.com/dart-lang/sdk/blob/f017eb8d9c74c497aea4577ea700abbe975aba2a/.github/dependabot.yml) | 1 | 3 | 0 | 0 | 0 | 3 |
| darwinia-network/darwinia | Blind | [`.github/dependabot.yml`](https://github.com/darwinia-network/darwinia/blob/6719d526c59cc223152fd4de7bb891abb4e4073f/.github/dependabot.yml) | 2 | 20 | 16 | 2 | 0 | 2 |
| datafusion-contrib/datafusion-tracing | Blind | [`.github/dependabot.yml`](https://github.com/datafusion-contrib/datafusion-tracing/blob/d3d6d83cc3d65d9832772d74dd6c2bc0aac5d59c/.github/dependabot.yml) | 2 | 3 | 0 | 0 | 2 | 1 |
| davidpob99/nasa-wallpaper | Blind | [`.github/dependabot.yml`](https://github.com/davidpob99/nasa-wallpaper/blob/457c3eadce775423fe1399eeada78a29c95698ae/.github/dependabot.yml) | 1 | 6 | 0 | 6 | 0 | 0 |
| DesignLiquido/delegua | Blind | [`.github/dependabot.yml`](https://github.com/DesignLiquido/delegua/blob/94b319548996d03278b2029ded8d087136f5d317/.github/dependabot.yml) | 1 | 8 | 1 | 7 | 0 | 0 |
| django-haystack/celery-haystack | Blind | [`.github/dependabot.yml`](https://github.com/django-haystack/celery-haystack/blob/def20823844bde2a0b8bc8c16e8d4930346b7a1e/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| dmyersturnbull/tyrannosaurus | Blind | [`.github/dependabot.yml`](https://github.com/dmyersturnbull/tyrannosaurus/blob/d7df1cae6ffd470d524b4c9f7fd9963ba7c54d99/.github/dependabot.yml) | 5 | 17 | 15 | 1 | 0 | 1 |
| dodobrands/DBThreadSafe-ios | Blind | [`.github/dependabot.yml`](https://github.com/dodobrands/DBThreadSafe-ios/blob/0b822c3ed3c398d045bf44b52897b40c670e5858/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| dodobrands/Peekie | Blind | [`.github/dependabot.yml`](https://github.com/dodobrands/Peekie/blob/0369e354538a2e4230ea9a4562cb1087ab9725b1/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| doitintl/kube-no-trouble | Blind | [`.github/dependabot.yml`](https://github.com/doitintl/kube-no-trouble/blob/2366d92156c0cf94c31453593368077f13c183b7/.github/dependabot.yml) | 2 | 21 | 1 | 19 | 0 | 1 |
| domaindrivendev/Swashbuckle.AspNetCore | Blind | [`.github/dependabot.yml`](https://github.com/domaindrivendev/Swashbuckle.AspNetCore/blob/819734d42ad5bd0305b04f36aee7ec7cea01b7f1/.github/dependabot.yml) | 4 | 2 | 0 | 0 | 0 | 2 |
| dotnet/vscode-csharp | Blind | [`.github/dependabot.yml`](https://github.com/dotnet/vscode-csharp/blob/1833384d44a9b850bde1d13570a7a96d70df5d1a/.github/dependabot.yml) | 1 | 20 | 0 | 11 | 0 | 9 |
| dpgaspar/Flask-AppBuilder | Blind | [`.github/dependabot.yml`](https://github.com/dpgaspar/Flask-AppBuilder/blob/30e13dc7916167fa159452322aa00d03999970f9/.github/dependabot.yml) | 3 | 14 | 11 | 1 | 0 | 2 |
| dreamfactorysoftware/dreamfactory | Blind | [`.github/dependabot.yml`](https://github.com/dreamfactorysoftware/dreamfactory/blob/2965df25098ee1b580e2756807fa65c66dc8eb28/.github/dependabot.yml) | 1 | 19 | 0 | 19 | 0 | 0 |
| driesvints/blade-icons | Blind | [`.github/dependabot.yml`](https://github.com/driesvints/blade-icons/blob/7c464ea7b5ac12a4957871f3596e8cee09375aad/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| ecugol/pre-commit-hooks-django | Blind | [`.github/dependabot.yml`](https://github.com/ecugol/pre-commit-hooks-django/blob/7f436e6be071cfa69ba9f10091184d5c9cc94dcd/.github/dependabot.yml) | 1 | 5 | 4 | 0 | 0 | 1 |
| edera-dev/sprout | Blind | [`.github/dependabot.yml`](https://github.com/edera-dev/sprout/blob/45e8dcf597a17181d323250ff96b3f42e96d990b/.github/dependabot.yml) | 3 | 0 | 0 | 0 | 0 | 0 |
| EdJoPaTo/website-stalker | Blind | [`.github/dependabot.yml`](https://github.com/EdJoPaTo/website-stalker/blob/fe4fd4f27c66344d93b4f87c946f06282ee81545/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| ente/ente | Blind | [`.github/dependabot.yml`](https://github.com/ente/ente/blob/3ffa9616868b80ac05ca377dcfffc007d645962c/.github/dependabot.yml) | 9 | 0 | 0 | 0 | 0 | 0 |
| eser/deno-boilerplate-console | Blind | [`.github/dependabot.yml`](https://github.com/eser/deno-boilerplate-console/blob/99420bc23f36be4b0f037e7729dc536685f21c7a/.github/dependabot.yml) | 1 | 3 | 2 | 0 | 0 | 1 |
| ethereum/c-kzg-4844 | Blind | [`.github/dependabot.yml`](https://github.com/ethereum/c-kzg-4844/blob/a751e2d92abcd63b01d1400789789f5ea289a8b0/.github/dependabot.yml) | 1 | 3 | 0 | 1 | 0 | 2 |
| fe-lang/sonatina | Blind | [`.github/dependabot.yml`](https://github.com/fe-lang/sonatina/blob/c704ab11f6facf329ba91fe00e0ade5ec7a30ffb/.github/dependabot.yml) | 1 | 11 | 0 | 11 | 0 | 0 |
| felangel/bloc | Blind | [`.github/dependabot.yml`](https://github.com/felangel/bloc/blob/b9be1e252ee24ffbe9f2fb629edc7624b2cfbf05/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| Ff00ff/mammoth | Blind | [`.github/dependabot.yml`](https://github.com/Ff00ff/mammoth/blob/8122afe43425c135a1dd8f0cd22606fb0e0a994d/.github/dependabot.yml) | 1 | 30 | 0 | 16 | 9 | 5 |
| firebase/flutterfire | Blind | [`.github/dependabot.yml`](https://github.com/firebase/flutterfire/blob/d07113e3adfe128d2e4810bae22c5ca5bcbc48eb/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| flex-analytics/flexviz | Blind | [`.github/dependabot.yml`](https://github.com/flex-analytics/flexviz/blob/b8fe166eba7fbd39de8bb298ee924a29d5baedcf/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| flutter/samples | Blind | [`.github/dependabot.yaml`](https://github.com/flutter/samples/blob/9df2cac15cc3d28a51aace018ad822387d30ac72/.github/dependabot.yaml) | 25 | 3 | 0 | 0 | 0 | 3 |
| fluvio-community/fluvio | Blind | [`.github/dependabot.yml`](https://github.com/fluvio-community/fluvio/blob/52673942c1c7364f36f2e05da972436f761243cd/.github/dependabot.yml) | 2 | 6 | 0 | 1 | 2 | 3 |
| ForestAdmin/forest-express-sequelize | Blind | [`.github/dependabot.yml`](https://github.com/ForestAdmin/forest-express-sequelize/blob/2f254a4b2bc598719fc6a82b0af7de15e0dad5cb/.github/dependabot.yml) | 1 | 13 | 0 | 5 | 2 | 6 |
| Foxlider/FASTER | Blind | [`.github/dependabot.yml`](https://github.com/Foxlider/FASTER/blob/ca7c9b51ec5c28c57bc926d9e025daca39cffcc6/.github/dependabot.yml) | 3 | 5 | 0 | 0 | 0 | 5 |
| gethomepage/homepage | Targeted | [`.github/dependabot.yml`](https://github.com/gethomepage/homepage/blob/89b0d20655ca521e55ae65097c2da4285c87a403/.github/dependabot.yml) | 2 | 3 | 0 | 3 | 0 | 0 |
| ggwpez/zepter | Blind | [`.github/dependabot.yml`](https://github.com/ggwpez/zepter/blob/5884aca1faa716ffc3a0cabff588aa2b0aefc428/.github/dependabot.yml) | 1 | 13 | 0 | 12 | 0 | 1 |
| globus/django-globus-portal-framework | Blind | [`.github/dependabot.yaml`](https://github.com/globus/django-globus-portal-framework/blob/53eae48c609cd29c70ef9839762b3030f1895297/.github/dependabot.yaml) | 1 | 0 | 0 | 0 | 0 | 0 |
| hasura/ndc-postgres | Blind | [`.github/dependabot.yml`](https://github.com/hasura/ndc-postgres/blob/1493dc2f92e96d6a8442b2304edabcd62b0865b5/.github/dependabot.yml) | 3 | 1 | 0 | 0 | 0 | 1 |
| hbeberman/fathomable | Blind | [`.github/dependabot.yml`](https://github.com/hbeberman/fathomable/blob/63d9709f7afa06e481990ce60c522ad8862e94f0/.github/dependabot.yml) | 3 | 0 | 0 | 0 | 0 | 0 |
| hellofresh/action-changed-files | Blind | [`.github/dependabot.yml`](https://github.com/hellofresh/action-changed-files/blob/6e0e3a3fa45bb877dbcefee16c4d8a1f676fcee8/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| heroesofcode/swift-explorer | Blind | [`.github/dependabot.yml`](https://github.com/heroesofcode/swift-explorer/blob/67f106314b5e9b4de5c05821d03432139991448e/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| heroku/python-getting-started | Blind | [`.github/dependabot.yml`](https://github.com/heroku/python-getting-started/blob/561bc55e4aaf22f98c040611fd613994547b31bb/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| hiddify/hiddify-app | Blind | [`.github/dependabot.yml`](https://github.com/hiddify/hiddify-app/blob/0d6eb8826635babf392f34572727a3f9f6ef6316/.github/dependabot.yml) | 1 | 6 | 0 | 4 | 0 | 2 |
| hisaac/workbench | Blind | [`.github/dependabot.yml`](https://github.com/hisaac/workbench/blob/b9bbc706e7453bd46035b41e3f975d3d790e7957/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| horvathandris/dime | Blind | [`.github/dependabot.yml`](https://github.com/horvathandris/dime/blob/7c6b0b70fd36f580b2543acacbd3af438ec519e9/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| huggingface/hf_transfer | Blind | [`.github/dependabot.yml`](https://github.com/huggingface/hf_transfer/blob/dd35eb2e0ee11c8d0ee266634eb450038e6f97b4/.github/dependabot.yml) | 1 | 15 | 14 | 0 | 0 | 1 |
| iloveitaly/openbook | Blind | [`.github/dependabot.yml`](https://github.com/iloveitaly/openbook/blob/b26f05dc3cd4daff612cde6acb99429da23e9b5a/.github/dependabot.yml) | 2 | 6 | 4 | 0 | 0 | 2 |
| imaNNeo/fl_chart | Blind | [`.github/dependabot.yml`](https://github.com/imaNNeo/fl_chart/blob/ecada9478275e987dbac53c2d16b4fb3f2bcb78e/.github/dependabot.yml) | 2 | 18 | 16 | 0 | 0 | 2 |
| initializ/forge | Blind | [`.github/dependabot.yml`](https://github.com/initializ/forge/blob/7b29e9de7ce51c43cc7beebfd6415ebf29fc7c83/.github/dependabot.yml) | 5 | 24 | 0 | 24 | 0 | 0 |
| Inner-Heaven/libzetta-rs | Blind | [`.github/dependabot.yml`](https://github.com/Inner-Heaven/libzetta-rs/blob/54f50ab3d6de23f946dfae4b8a8b2b2d0926598c/.github/dependabot.yml) | 1 | 2 | 1 | 0 | 0 | 1 |
| iotaledger/starfish | Blind | [`.github/dependabot.yml`](https://github.com/iotaledger/starfish/blob/4f6d149ceb69cdce6f0be3cde2d3e053b9db0f52/.github/dependabot.yml) | 2 | 25 | 25 | 0 | 0 | 0 |
| iqlusioninc/abscissa | Blind | [`.github/dependabot.yml`](https://github.com/iqlusioninc/abscissa/blob/721fb340417578c00b3838098bb7990b7bd0f400/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| Jackett/Jackett | Blind | [`.github/dependabot.yml`](https://github.com/Jackett/Jackett/blob/9ce4f3973e6232199465e0230b018103db4bca03/.github/dependabot.yml) | 1 | 9 | 0 | 0 | 0 | 9 |
| jcgay/maven-color | Blind | [`.github/dependabot.yml`](https://github.com/jcgay/maven-color/blob/867eb67b296aaf336049e6eada92d49bfd50e9de/.github/dependabot.yml) | 1 | 3 | 0 | 3 | 0 | 0 |
| jdrouet/jolimail | Blind | [`.github/dependabot.yml`](https://github.com/jdrouet/jolimail/blob/28f5ac8e746777cfb7ce0a1f4815e5d281bb2a3d/.github/dependabot.yml) | 2 | 6 | 0 | 4 | 0 | 2 |
| jthegedus/asdf-firebase | Blind | [`.github/dependabot.yml`](https://github.com/jthegedus/asdf-firebase/blob/0fcfd62975045a313a840253adf0cf327f8ea8d9/.github/dependabot.yml) | 1 | 4 | 3 | 0 | 0 | 1 |
| jthegedus/asdf-gcloud | Blind | [`.github/dependabot.yml`](https://github.com/jthegedus/asdf-gcloud/blob/00cdf065aaf10f07ff3da8eba59746526e6a93c4/.github/dependabot.yml) | 1 | 6 | 5 | 0 | 0 | 1 |
| jthegedus/asdf-v | Blind | [`.github/dependabot.yml`](https://github.com/jthegedus/asdf-v/blob/17bcf55aca038017c111e182b4a715e0a3f001b9/.github/dependabot.yml) | 1 | 4 | 3 | 0 | 0 | 1 |
| jugglerchris/rust-html2text | Blind | [`.github/dependabot.yml`](https://github.com/jugglerchris/rust-html2text/blob/3164eb0d303b63fe66848bd7842e93ac31078ae5/.github/dependabot.yml) | 1 | 4 | 0 | 4 | 0 | 0 |
| kaitai-io/kaitai_struct_cpp_stl_runtime | Blind | [`.github/dependabot.yml`](https://github.com/kaitai-io/kaitai_struct_cpp_stl_runtime/blob/4ca1ba36d2e8816bae3875378c55cf2d01c3971e/.github/dependabot.yml) | 1 | 2 | 0 | 0 | 0 | 2 |
| Kimeur/duology | Blind | [`.github/dependabot.yml`](https://github.com/Kimeur/duology/blob/cffd95d90ac0c7a61578c9bfaada80f0b33e0190/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| lbdremy/solr-node-client | Blind | [`.github/dependabot.yml`](https://github.com/lbdremy/solr-node-client/blob/c1a2f2a3ec233a19f84b061eb01ff4ae718d14ef/.github/dependabot.yml) | 2 | 16 | 7 | 0 | 0 | 9 |
| lichess-org/leroyjenkins | Blind | [`.github/dependabot.yml`](https://github.com/lichess-org/leroyjenkins/blob/b7271a24ad484341dcc510061244cbb89e135ed1/.github/dependabot.yml) | 2 | 2 | 2 | 0 | 0 | 0 |
| lingui/swc-plugin | Blind | [`.github/dependabot.yml`](https://github.com/lingui/swc-plugin/blob/aa21c44c932e79da08fb3b2f85e5f27feba2973d/.github/dependabot.yml) | 1 | 3 | 0 | 0 | 0 | 3 |
| linuztx/alter-zero | Blind | [`.github/dependabot.yml`](https://github.com/linuztx/alter-zero/blob/24f7f4ba539b4763a610a8a45d0b3265ebd6ee28/.github/dependabot.yml) | 1 | 1 | 0 | 0 | 0 | 1 |
| lloydsmart/chd2iso-fuse | Blind | [`.github/dependabot.yml`](https://github.com/lloydsmart/chd2iso-fuse/blob/ee62c8bcd61ef24a050ab100758c8a01d7d49bef/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| localsend/localsend | Blind | [`.github/dependabot.yml`](https://github.com/localsend/localsend/blob/92e133aa43869e94d394fd04fa70c50a0f796a64/.github/dependabot.yml) | 1 | 16 | 14 | 0 | 0 | 2 |
| lollipopkit/flutter_server_box | Blind | [`.github/dependabot.yml`](https://github.com/lollipopkit/flutter_server_box/blob/3e2db60c8645d61519762feff87a114eccaae8a8/.github/dependabot.yml) | 8 | 1 | 0 | 0 | 0 | 1 |
| LSPosed/LSPosed | Blind | [`.github/dependabot.yml`](https://github.com/LSPosed/LSPosed/blob/df74d83eb03a44cc6ad268841ac2ada28d077c77/.github/dependabot.yml) | 1 | 15 | 0 | 11 | 0 | 4 |
| LyraVoid/FolkLite | Blind | [`.github/dependabot.yml`](https://github.com/LyraVoid/FolkLite/blob/56e092b316076c9db63312e9cd8113b3fe1544a4/.github/dependabot.yml) | 3 | 1 | 1 | 0 | 0 | 0 |
| maplibre/maplibre-compose | Blind | [`.github/dependabot.yml`](https://github.com/maplibre/maplibre-compose/blob/9662e569207c32af9e40990084af60fd9148c7ee/.github/dependabot.yml) | 3 | 0 | 0 | 0 | 0 | 0 |
| mattermost/mattermost-helm | Blind | [`.github/dependabot.yml`](https://github.com/mattermost/mattermost-helm/blob/07025cf61b2fd7f656d08723acdba53de238454e/.github/dependabot.yml) | 1 | 6 | 0 | 1 | 0 | 5 |
| mckenziearts/laravel-notify | Blind | [`.github/dependabot.yml`](https://github.com/mckenziearts/laravel-notify/blob/f57094aae5d336046ced7a5e1fd1eeb37c0219d4/.github/dependabot.yml) | 3 | 0 | 0 | 0 | 0 | 0 |
| mealie-recipes/mealie | Targeted | [`.github/dependabot.yml`](https://github.com/mealie-recipes/mealie/blob/50a341ed3febc98a5a20b61fad5e74a290394f16/.github/dependabot.yml) | 2 | 23 | 0 | 18 | 0 | 5 |
| microscaler/BRRTRouter | Blind | [`.github/dependabot.yml`](https://github.com/microscaler/BRRTRouter/blob/4f10fbb2f3b56522cce906fe3d648e733a7e1283/.github/dependabot.yml) | 3 | 3 | 0 | 2 | 0 | 1 |
| microsoft/azure-redcap-paas | Blind | [`.github/dependabot.yml`](https://github.com/microsoft/azure-redcap-paas/blob/616a73de969f04a0a57b65e989758a568bea0ef8/.github/dependabot.yml) | 1 | 1 | 0 | 0 | 0 | 1 |
| microsoft/BCQuality | Blind | [`.github/dependabot.yml`](https://github.com/microsoft/BCQuality/blob/634aba3df9af1b4579e8a735b186e3efdbf47de2/.github/dependabot.yml) | 1 | 7 | 0 | 0 | 0 | 7 |
| microsoft/FASTER | Blind | [`.github/dependabot.yml`](https://github.com/microsoft/FASTER/blob/332ea7da532a688acf648ee60c4f63a1caeaf1f7/.github/dependabot.yml) | 1 | 46 | 0 | 0 | 0 | 46 |
| microsoft/MSBuildSdks | Blind | [`.github/dependabot.yml`](https://github.com/microsoft/MSBuildSdks/blob/eeadbd0c1d4fecbd95f5c6d4c8194726998508bc/.github/dependabot.yml) | 1 | 20 | 0 | 0 | 0 | 20 |
| microsoft/SDCM | Blind | [`.github/dependabot.yml`](https://github.com/microsoft/SDCM/blob/939279a9f75f0c752aad39ad0ef12080ee832e81/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| microsoft/SwiftStreamingMarkdown | Blind | [`.github/dependabot.yml`](https://github.com/microsoft/SwiftStreamingMarkdown/blob/95bb755a9b23a1aea8682b9ebc912cb72b176c95/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| mislav/hub | Blind | [`.github/dependabot.yml`](https://github.com/mislav/hub/blob/5c547ed804368763064e51f3990851e267e88edd/.github/dependabot.yml) | 3 | 8 | 4 | 1 | 0 | 3 |
| moditect/jfrunit | Blind | [`.github/dependabot.yml`](https://github.com/moditect/jfrunit/blob/b676511be0506a8653358060eb2fdb4fe27873a3/.github/dependabot.yml) | 2 | 14 | 13 | 0 | 0 | 1 |
| mywalkb/LSPosed_mod | Blind | [`.github/dependabot.yml`](https://github.com/mywalkb/LSPosed_mod/blob/9cd7a47d644d33e09762f669e57f722d979eddfe/.github/dependabot.yml) | 2 | 14 | 10 | 0 | 0 | 4 |
| n8henrie/pycookiecheat | Blind | [`.github/dependabot.yml`](https://github.com/n8henrie/pycookiecheat/blob/eed8f7411fd498344a7c95592893828a42d20414/.github/dependabot.yml) | 0 | 8 | 0 | 4 | 0 | 4 |
| navikt/security-playbook | Blind | [`.github/dependabot.yml`](https://github.com/navikt/security-playbook/blob/7b310ffa2b7b55c1993b469de0eb130e631fb576/.github/dependabot.yml) | 2 | 1 | 1 | 0 | 0 | 0 |
| navinpeiris/geoip | Blind | [`.github/dependabot.yml`](https://github.com/navinpeiris/geoip/blob/444b82a2c88566348fc563a7b1c40087961c6e93/.github/dependabot.yml) | 2 | 6 | 3 | 0 | 0 | 3 |
| neo4j-examples/movies-java-spring-data-neo4j | Blind | [`.github/dependabot.yml`](https://github.com/neo4j-examples/movies-java-spring-data-neo4j/blob/e009df722b0d085e31b4cc4e7f84b12b16fb8925/.github/dependabot.yml) | 2 | 7 | 0 | 7 | 0 | 0 |
| nextstrain/augur | Blind | [`.github/dependabot.yml`](https://github.com/nextstrain/augur/blob/49d74672ef3f07a7e87375e45c381e17dce5be83/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| NSEcho/furlzz | Blind | [`.github/dependabot.yml`](https://github.com/NSEcho/furlzz/blob/4c5cac756d08166fb48642c47f86e2cd20ddcf1b/.github/dependabot.yml) | 1 | 5 | 0 | 4 | 0 | 1 |
| nulab/scala-oauth2-provider | Blind | [`.github/dependabot.yml`](https://github.com/nulab/scala-oauth2-provider/blob/ad54cbd909c4a9cd1a651840777c41f2d503c8ff/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| obbyworld/obby | Blind | [`.github/dependabot.yml`](https://github.com/obbyworld/obby/blob/67a31887dd2fb93414461577cacc1e17b6af1453/.github/dependabot.yml) | 4 | 6 | 0 | 0 | 1 | 5 |
| oculairmedia/Letta-MCP-server | Blind | [`.github/dependabot.yml`](https://github.com/oculairmedia/Letta-MCP-server/blob/622bffadc074a1fa5cc4e0faa48deac94a8573c2/.github/dependabot.yml) | 4 | 0 | 0 | 0 | 0 | 0 |
| ossf/package-analysis | Blind | [`.github/dependabot.yml`](https://github.com/ossf/package-analysis/blob/c5c45008da694036d701ba76fe9567fc8a5b9675/.github/dependabot.yml) | 4 | 4 | 1 | 2 | 0 | 1 |
| outline/outline | Targeted | [`.github/dependabot.yml`](https://github.com/outline/outline/blob/879c568a2ce55b0462651fa580de7f65faae026c/.github/dependabot.yml) | 1 | 67 | 0 | 41 | 16 | 10 |
| pacman82/odbc2parquet | Blind | [`.github/dependabot.yml`](https://github.com/pacman82/odbc2parquet/blob/e1b93b538ac875404d5fe7f7be9a3fb0dfb73a73/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| pallets-eco/flask-debugtoolbar | Blind | [`.github/dependabot.yml`](https://github.com/pallets-eco/flask-debugtoolbar/blob/5751c9ddac8d9571c0bcb25ff586a9eac27af022/.github/dependabot.yml) | 2 | 11 | 10 | 0 | 0 | 1 |
| paulgessinger/swift-paperless | Blind | [`.github/dependabot.yml`](https://github.com/paulgessinger/swift-paperless/blob/ceb007633eab1b33e092243b332247e72489d375/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| peek-travel/cocktail | Blind | [`.github/dependabot.yml`](https://github.com/peek-travel/cocktail/blob/80b7c9372e30d97ca6bee3f036fc0d9cf8b81ffc/.github/dependabot.yml) | 2 | 16 | 13 | 0 | 0 | 3 |
| pester/Pester | Blind | [`.github/dependabot.yml`](https://github.com/pester/Pester/blob/98e56d65da1642a7158992b50ded240c42a3ac18/.github/dependabot.yml) | 1 | 3 | 0 | 0 | 0 | 3 |
| petalframework/petal_components | Blind | [`.github/dependabot.yml`](https://github.com/petalframework/petal_components/blob/9f61e26713e886a0564f50035bf3da1d4a175366/.github/dependabot.yml) | 1 | 8 | 0 | 6 | 0 | 2 |
| phip1611/noto-sans-mono-bitmap-rs | Blind | [`.github/dependabot.yml`](https://github.com/phip1611/noto-sans-mono-bitmap-rs/blob/d9c813ad50fdaf0d9cdefa22f9b7675292cefb58/.github/dependabot.yml) | 2 | 1 | 0 | 0 | 0 | 1 |
| podusowski/walkers | Blind | [`.github/dependabot.yml`](https://github.com/podusowski/walkers/blob/1308f4131543f37f26f3cd020e52bdb26ae96a0d/.github/dependabot.yml) | 1 | 9 | 0 | 8 | 0 | 1 |
| PowerShell/PSReadLine | Blind | [`.github/dependabot.yml`](https://github.com/PowerShell/PSReadLine/blob/a2d143f78904f8a954f8d4b055e55ceca6939bfc/.github/dependabot.yml) | 1 | 8 | 1 | 0 | 0 | 7 |
| pyiron/pyiron | Blind | [`.github/dependabot.yml`](https://github.com/pyiron/pyiron/blob/fc126769378e33feec20da2aec2c29808f52e64c/.github/dependabot.yml) | 1 | 7 | 0 | 7 | 0 | 0 |
| QuipNetwork/hashsigs-rs | Blind | [`.github/dependabot.yml`](https://github.com/QuipNetwork/hashsigs-rs/blob/a45c4f250ec70213713de31eede652ea820fd314/.github/dependabot.yml) | 1 | 2 | 0 | 0 | 0 | 2 |
| railwayapp/nixpacks | Blind | [`.github/dependabot.yml`](https://github.com/railwayapp/nixpacks/blob/144b4f9ab1c3943af4dfe76d3c79d91263f5b465/.github/dependabot.yml) | 1 | 57 | 23 | 8 | 0 | 26 |
| reanimate/reanimate | Blind | [`.github/dependabot.yml`](https://github.com/reanimate/reanimate/blob/583ee9f426bb96ac15996772a6fd7ccf0caf08a7/.github/dependabot.yml) | 3 | 6 | 6 | 0 | 0 | 0 |
| replicate/cog | Blind | [`.github/dependabot.yml`](https://github.com/replicate/cog/blob/9b9f63390c08a2d1110956d50476331cdadd27e2/.github/dependabot.yml) | 5 | 7 | 0 | 0 | 5 | 2 |
| ReVanced/revanced-manager-downloaders | Blind | [`.github/dependabot.yml`](https://github.com/ReVanced/revanced-manager-downloaders/blob/41b9ab3aa39135e2f76ef76f1cd50cb3f4dd4e97/.github/dependabot.yml) | 3 | 7 | 7 | 0 | 0 | 0 |
| ReVanced/revanced-manager-downloaders-template | Blind | [`.github/dependabot.yml`](https://github.com/ReVanced/revanced-manager-downloaders-template/blob/14e7a50779268c1aad276b7bf1ec1c511f38a185/.github/dependabot.yml) | 3 | 6 | 6 | 0 | 0 | 0 |
| revelrylabs/ecto_soft_delete | Blind | [`.github/dependabot.yml`](https://github.com/revelrylabs/ecto_soft_delete/blob/03395d3f66b7844e12d1b4be5518fe868f0a868d/.github/dependabot.yml) | 1 | 3 | 0 | 2 | 0 | 1 |
| revelrylabs/text_chunker_ex | Blind | [`.github/dependabot.yml`](https://github.com/revelrylabs/text_chunker_ex/blob/e1781097d47a1dc741f441f3b89f7f12705995c0/.github/dependabot.yml) | 1 | 12 | 0 | 9 | 0 | 3 |
| rlane/oort3 | Blind | [`.github/dependabot.yml`](https://github.com/rlane/oort3/blob/05a0528dfc185838b3186ccd8d1a9d92b241d16e/.github/dependabot.yml) | 2 | 10 | 0 | 5 | 0 | 5 |
| rrousselGit/riverpod | Blind | [`.github/dependabot.yaml`](https://github.com/rrousselGit/riverpod/blob/7a02bedc149ef35311d856993e5bb76e528dd036/.github/dependabot.yaml) | 1 | 14 | 0 | 14 | 0 | 0 |
| Rve27/RvSystem-Monitor | Blind | [`.github/dependabot.yml`](https://github.com/Rve27/RvSystem-Monitor/blob/b07fe27598555e49084bbcc40be558803286b9ef/.github/dependabot.yml) | 3 | 1 | 0 | 0 | 0 | 1 |
| sapio-lang/sapio | Blind | [`.github/dependabot.yml`](https://github.com/sapio-lang/sapio/blob/4b4ace2efce0b67763c853c33cb9691d8600b65b/.github/dependabot.yml) | 3 | 3 | 1 | 0 | 0 | 2 |
| sestoft/C5 | Blind | [`.github/dependabot.yml`](https://github.com/sestoft/C5/blob/224386389d83bce81a55f9da304a95d18be15aac/.github/dependabot.yml) | 2 | 9 | 4 | 0 | 0 | 5 |
| shivammathur/setup-php | Blind | [`.github/dependabot.yml`](https://github.com/shivammathur/setup-php/blob/3bdfe21000ea9539e3a94c4f692f984b24fa97e0/.github/dependabot.yml) | 1 | 1 | 0 | 0 | 0 | 1 |
| Shopify/mobile-buy-sdk-ios | Blind | [`.github/dependabot.yaml`](https://github.com/Shopify/mobile-buy-sdk-ios/blob/350c914d8beea856026807cbd3effc73aaf8b7cd/.github/dependabot.yaml) | 1 | 5 | 5 | 0 | 0 | 0 |
| simeononsecurity/AnonUpload | Blind | [`.github/dependabot.yml`](https://github.com/simeononsecurity/AnonUpload/blob/98345b632ac1cc3eb8101f197beb7f1fff8d835f/.github/dependabot.yml) | 1 | 5 | 0 | 4 | 0 | 1 |
| Simnico99/MicaWPF | Blind | [`.github/dependabot.yml`](https://github.com/Simnico99/MicaWPF/blob/13d5924d65f78fe4139033034b7759172b35d77f/.github/dependabot.yml) | 4 | 8 | 0 | 0 | 0 | 8 |
| slackapi/bolt-js | Blind | [`.github/dependabot.yml`](https://github.com/slackapi/bolt-js/blob/af7900bb6c2f3fbaa23f79aec727f2aa3ee57fd2/.github/dependabot.yml) | 12 | 9 | 0 | 0 | 1 | 8 |
| slackhq/go-audit | Blind | [`.github/dependabot.yml`](https://github.com/slackhq/go-audit/blob/4739171bc7d5dea93f863c361eec2ce30b5daa5e/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| slimkit/plus | Blind | [`.github/dependabot.yml`](https://github.com/slimkit/plus/blob/01c87057426d5656e4c667ea228f758dc89e7793/.github/dependabot.yml) | 3 | 6 | 5 | 0 | 0 | 1 |
| spatie/db-dumper | Blind | [`.github/dependabot.yml`](https://github.com/spatie/db-dumper/blob/c968c8c93d4532caa6cab82ae56df10fbbdef9c6/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| spatie/laravel-backup | Blind | [`.github/dependabot.yml`](https://github.com/spatie/laravel-backup/blob/956cec9685e0a6910b31b6df852d896e44ea0dba/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| SpectrAI-Initiative/InnoClaw | Blind | [`.github/dependabot.yml`](https://github.com/SpectrAI-Initiative/InnoClaw/blob/67231f373deac3db29f685985a5632b6c0eb0f08/.github/dependabot.yml) | 2 | 3 | 0 | 0 | 0 | 3 |
| standard-webhooks/standard-webhooks | Blind | [`.github/dependabot.yml`](https://github.com/standard-webhooks/standard-webhooks/blob/ab6844147ce9cdb0d2dbf2e60d1ea85001fd2554/.github/dependabot.yml) | 9 | 25 | 0 | 0 | 17 | 8 |
| standard/ts-standard | Blind | [`.github/dependabot.yml`](https://github.com/standard/ts-standard/blob/5e45a1e2780f720de1328bf15bf71255881ffa7f/.github/dependabot.yml) | 2 | 9 | 2 | 0 | 0 | 7 |
| sublunarian/light-amp | Blind | [`.github/dependabot.yml`](https://github.com/sublunarian/light-amp/blob/729161a67019730aa2352d4d5aa3b01a42f640c3/.github/dependabot.yml) | 1 | 2 | 0 | 2 | 0 | 0 |
| suptejas/fleet | Blind | [`.github/dependabot.yml`](https://github.com/suptejas/fleet/blob/97c5bd2d92021b7f06cd18cb3d7f5ce38d29b4ae/.github/dependabot.yml) | 0 | 5 | 0 | 5 | 0 | 0 |
| suzaku-io/diode | Blind | [`.github/dependabot.yml`](https://github.com/suzaku-io/diode/blob/9aea00f1cf4382795e525608aecc575579ec86b5/.github/dependabot.yml) | 1 | 6 | 6 | 0 | 0 | 0 |
| thetonus/website | Blind | [`.github/dependabot.yml`](https://github.com/thetonus/website/blob/7fe004afa05df1e39ec35e2562c0f4ffef2f7098/.github/dependabot.yml) | 1 | 1 | 0 | 0 | 0 | 1 |
| timveil/leaves-of-blocks | Blind | [`.github/dependabot.yml`](https://github.com/timveil/leaves-of-blocks/blob/c410830654fa0e275aef687254e7c1a3d9377ec6/.github/dependabot.yml) | 2 | 0 | 0 | 0 | 0 | 0 |
| twitter/algebird | Blind | [`.github/dependabot.yml`](https://github.com/twitter/algebird/blob/464917d6a3f2b1c9f2048e3dd38df5dd97edc965/.github/dependabot.yml) | 1 | 12 | 12 | 0 | 0 | 0 |
| twitter/bijection | Blind | [`.github/dependabot.yml`](https://github.com/twitter/bijection/blob/35ecadc1a060167c8bff2a593c0b99b61327d65f/.github/dependabot.yml) | 1 | 1 | 1 | 0 | 0 | 0 |
| twitter/chill | Blind | [`.github/dependabot.yml`](https://github.com/twitter/chill/blob/f69dfa0edce9442a1f5c0413d8b797957b8b27d7/.github/dependabot.yml) | 1 | 11 | 10 | 0 | 0 | 1 |
| uber/AutoDispose | Blind | [`.github/dependabot.yml`](https://github.com/uber/AutoDispose/blob/b7205200096aae97db7f07afb87d27486bf684ac/.github/dependabot.yml) | 1 | 0 | 0 | 0 | 0 | 0 |
| webrecorder/browsertrix | Blind | [`.github/dependabot.yml`](https://github.com/webrecorder/browsertrix/blob/3462ea73b1d13be62ea0ab49c2cccea4e603f176/.github/dependabot.yml) | 3 | 44 | 0 | 39 | 0 | 5 |
| Yubico/yubioath-flutter | Blind | [`.github/dependabot.yml`](https://github.com/Yubico/yubioath-flutter/blob/b4eca6a3888bf504cb991b1898ba8542109ded4f/.github/dependabot.yml) | 5 | 0 | 0 | 0 | 0 | 0 |
| zu1k/Good-MITM | Blind | [`.github/dependabot.yml`](https://github.com/zu1k/Good-MITM/blob/e0ad482d12a289ea5801398786ebc80fd5df1e28/.github/dependabot.yml) | 1 | 20 | 0 | 19 | 0 | 1 |


## Config files that could not be read

None.

## Totals

- **Findings:** 9563 across 1366 repositories.
- **Config entries:** 399, of which 71 declare `ignore` or `allow`.
- **Configured repositories:** 192.
- **Continuity repositories:** `excalidraw/excalidraw`, `gethomepage/homepage`, `mealie-recipes/mealie`, `outline/outline`, `umami-software/umami`.
- **Dependabot:** not-run — Dependabot runs inside GitHub's service against a default branch and this repository has no runner, so no head-to-head run exists (docs/COMPARISON_METHOD.md section 7).

