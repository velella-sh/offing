---
title: "Codemod coverage"
description: "Which runtime and Kubernetes findings have deterministic patches, with a pinned before and after measurement."
---

# Codemod coverage

Use `offing fix --dry-run` to preview a migration and `offing fix --json` to read the patch and refusal reasons. The planner parses repository files offline. Use the project's tests or deployment validation to check the proposed runtime and API upgrades.

| Input | Patch | Cases requiring judgment |
| --- | --- | --- |
| `actions/setup-node` and `actions/setup-python` | Raise literal `node-version` and `python-version` inputs. Remove ended entries from a single-line literal matrix while a known supported line remains. | Expressions without a literal matrix stay unclassified. A matrix with include or exclude clauses, YAML anchors, a multiline layout, or no known supported survivor needs a manual edit. |
| Local JavaScript action metadata | Move a literal `runs.using: node12` or `node16` to `node24`. | A runner or action dependency may have its own compatibility requirements. [GitHub Actions runner retirement notice](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/) |
| `.tool-versions`, `mise.toml`, and `.mise.toml` | Raise one literal Node.js or Python pin. | Fallback lists, backend-specific syntax, and dynamic pins need the project's intended install order or backend. |
| `engines.node` and `setup.cfg` | Raise a single literal `>=` floor. | Compound constraints require choosing the supported compatibility range. |
| `tox.ini` and `pyproject.toml` | Raise literal Python environment names and factors in the tox environment list. Remove end-of-life Python Trove classifiers from a literal classifier array. | Check environment-specific tox settings after renaming an environment. Dynamic classifiers and Python declarations outside a supported syntax need review. [Python release status](https://devguide.python.org/versions/) |
| Kubernetes workloads | Move Deployment, DaemonSet, ReplicaSet, and StatefulSet findings to `apps/v1`. Add a missing selector from a plain, nonempty pod-label map. | Review missing or ambiguous labels, removed fields such as `rollbackTo`, and changes to upstream API defaults, such as rollout strategy. [Kubernetes workload migration guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/#v116) |
| Kubernetes HorizontalPodAutoscaler | Advance `v2beta2` to `v2`. Move literal `v2beta1` resource-metric targets under `target` with the corresponding type. | Custom or conflicting `v2beta1` metric shapes need a reviewed conversion. [Kubernetes autoscaling migration guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/#horizontalpodautoscaler) |
| Kubernetes PodDisruptionBudget | Advance `policy/v1beta1` when the selector is unset or selects through an explicit label or expression. | An empty selector would select every pod in the namespace under `policy/v1`. Choose the intended selector first. [Kubernetes policy migration guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/#poddisruptionbudget) |
| Helm template | Edit a confirmed literal `apiVersion` line for a schema-compatible replacement. | Template expressions and schema edits need the rendered context. |
| PodSecurityPolicy and legacy CustomResourceDefinition | The refusal points to the migration packet. | PodSecurityPolicy needs an admission replacement. A v1 CustomResourceDefinition needs a structural schema and a review of version and conversion fields. [Kubernetes API migration guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/) |

Pass the refusal’s `findingId` to `offing explain <finding-id> .` for its evidence and migration packet. The [codemod guide](CODEMODS.md) documents the existing source and manifest repairs.

## Pinned before and after

Measured on **2026-11-27** against the same seven [public corpus](validation/corpus.md) pins and the `github-actions`, `kubernetes`, `npm`, and `python` detectors. The baseline source is [`f9ee7edf`](https://github.com/velella-sh/offing/commit/f9ee7edf89715f80dc9483aca7d5ebddc51d3223).

| Build | Findings | Patch proposed | Refused | Unfixed |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 79 | 43 | 24 | 12 |
| Current | 84 | 62 | 15 | 7 |

The two builds scan the cohort separately, so the current build also counts newly detected findings. The tool measures proposed patches for individual findings and filters out unrelated or ambient patches. The fixture suites verify application and idempotence. This table covers the seven selected pins.

| Rule | Baseline patched / refused / unfixed | Current patched / refused / unfixed |
| --- | ---: | ---: |
| `kubernetes.policy.poddisruptionbudget.v1beta1.removed` | 0 / 9 / 0 | 1 / 8 / 0 |
| `kubernetes.helm.repository.stable.end-of-life` | 0 / 5 / 0 | 0 / 5 / 0 |
| `kubernetes.extensions.deployment.v1beta1.removed` | 0 / 3 / 0 | 3 / 0 / 0 |
| `kubernetes.autoscaling.horizontalpodautoscaler.v2beta2.removed` | 0 / 2 / 0 | 2 / 0 / 0 |
| `python.runtime.eol-3.9-and-older` | 1 / 0 / 3 | 6 / 0 / 0 |
| `python.runtime.eol-3.10-and-older` | 0 / 0 / 1 | 3 / 0 / 0 |
| `nodejs.runtime.eol-18` | 0 / 0 / 1 | 1 / 0 / 0 |
| `nodejs.runtime.eol-20` | 0 / 0 / 0 | 1 / 0 / 0 |

Run the report from a built checkout. Set `OFFING_CORPUS_CACHE` to an existing cache populated by [the corpus runner](validation/running-the-corpus.md#warm-ahead-run-offline). Point `OFFING_BASELINE_DIST` at the `dist` directory of a trusted, separately built Offing checkout to compare both planners.

```sh
npm run build
node dist/tools/codemod-coverage.js \
  --date 2026-11-27 --concurrency 2 \
  --baseline "$OFFING_BASELINE_DIST" \
  --detector github-actions --detector kubernetes --detector npm --detector python \
  --repo pypa/sampleproject --repo edvardsanta/GenerateMarkdown \
  --repo ali-zahedi/az-iranian-bank-gateways --repo plynx-team/plynx \
  --repo stefanprodan/k8s-prom-hpa --repo t3n/helm-charts --repo awslabs/ec2-spot-labs \
  --output codemod-coverage.md
```

The measurement accepted the older sparse marker `sparse:437df2b4cd26ef01` explicitly. The only change from that marker to the current one adds `gradle-wrapper.properties`, which is outside the four measured detectors' inputs. Pass `--accept-sparse-marker sparse:437df2b4cd26ef01` for those same cached pins.

## Fixture sources

The fixture trees save small, inert excerpts and use variations of those excerpts for refusal and edge cases.

- The asdf and mise fixtures use the layout of [dotfiles_old](https://github.com/collegeimprovements/dotfiles_old/blob/32b95bf94089418c980349a6f9aa5a5bcc9b76d5/.tool-versions) and [security-playbook](https://github.com/navikt/security-playbook/blob/7b310ffa2b7b55c1993b469de0eb130e631fb576/mise.toml). The mise version pins and compact `engines` sample exercise the same edits on short inputs.
- The Actions cases adapt setup steps from [grants-stack](https://github.com/gitcoinco/grants-stack/blob/572d3fb116354692af661339dea122cbfdd66648/.github/workflows/common.yml) and [di-account-management-frontend](https://github.com/govuk-one-login/di-account-management-frontend/blob/d9a4e9ec01e6b6a2f061d45b5d411b9b6c9df9ad/.github/workflows/validate-sam-template.yaml). The metadata excerpts come from github-script’s [Node.js 12 action](https://github.com/actions/github-script/blob/ffc2c79a5b2490bd33e0a41c1de74b877714d736/action.yml#L29) and [Node.js 16 action](https://github.com/actions/github-script/blob/00f12e3e20659f42342b1c0226afda7f7c042325/action.yml#L35).
- The packaging fixtures adapt [az-iranian-bank-gateways setup.cfg](https://github.com/ali-zahedi/az-iranian-bank-gateways/blob/481a8fc24daae1133ab3ce138a59ac9c6cc25947/setup.cfg), [its tox.ini](https://github.com/ali-zahedi/az-iranian-bank-gateways/blob/481a8fc24daae1133ab3ce138a59ac9c6cc25947/tox.ini), and [sampleproject classifiers](https://github.com/pypa/sampleproject/blob/621e4974ca25ce531773def586ba3ed8e736b3fc/pyproject.toml#L87).
- The manifest fixtures use [plynx's Deployment](https://github.com/plynx-team/plynx/blob/4b01cdad967d6d1e96ebe24af8921b1c7c6bec1f/kubernetes/backend-deployment.yaml), [podinfo's HPA](https://github.com/stefanprodan/k8s-prom-hpa/blob/2dbaabafd360e5c1d0f8a9aaa7bfaa7cb80b6c4b/podinfo/podinfo-hpa.yaml), [the EC2 Spot PDB](https://github.com/awslabs/ec2-spot-labs/blob/545190ba692d300e0c2f4ed176f26975edc8c8c3/ec2-spot-eks-solution/cluster-autoscaler/cluster-autoscaler-pdb.yaml), and [the t3n CronJob chart](https://github.com/t3n/helm-charts/blob/53c584dfd364b286b6a1134112169062fe80e3d7/cronjob/templates/cronjobs.yaml). The HPA `v2beta1` variant uses fields from [the pinned Kubernetes API types](https://github.com/kubernetes/api/blob/v0.25.0/autoscaling/v2beta1/types.go).

The manual API cases use declaration excerpts from pinned repositories. [Kubernetes PodSecurityPolicy example](https://github.com/kubernetes/examples/blob/d6b8cd27eacb51e651a1aa6f7c190a28713eff6e/_archived/podsecuritypolicy/rbac/policies.yaml), [monkeys CRD](https://github.com/dennyzhang/kubernetes-yaml-templates/blob/92efe395e76285cdfa1b6452c4f76ff47b35cfbd/crd/monkeys.yaml), [Chime HPA template](https://github.com/CodeForPhilly/chime/blob/d7417b01ddbe052736761f93fc1d24829f804300/helm-chart/templates/hpa.yaml).
