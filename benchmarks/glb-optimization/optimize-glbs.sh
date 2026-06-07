#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
pnpm tsx benchmarks/glb-optimization/benchmark-glb-optimization.ts "$@"
