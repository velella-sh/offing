#!/usr/bin/env bash
set -euo pipefail

# The caller exposes a blocked fixture only for an explicit dry run. Real tags
# always scan their production dependency inventory before the first publish.
npm run build --silent
candidate="$RUNNER_TEMP/offing-release-gate.cdx.json"
if [[ "$USE_BLOCKED_FIXTURE" == true ]]; then
  cp tests/fixtures/release-gate/blocked.cdx.json "$candidate"
else
  npm sbom --omit=dev --sbom-format=cyclonedx --package-lock-only > "$candidate"
fi
OFFING_DATA_VERSION=bundled node dist/src/cli.js release-gate --sbom "$candidate" --within-days 30 |
  tee -a "$GITHUB_STEP_SUMMARY"
