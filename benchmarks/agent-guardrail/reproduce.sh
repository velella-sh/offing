#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
npm ci
npm run build --silent
export OFFING_DATA_VERSION=bundled
node dist/benchmarks/agent-guardrail/run.js "$@"
