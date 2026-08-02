#!/usr/bin/env bash
# Backward-compatible wrapper → consolidated env doctor (TypeScript).
# Prefer: pnpm env:doctor | mise run doctor
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
exec pnpm env:doctor "$@"
