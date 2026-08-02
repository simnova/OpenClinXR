#!/usr/bin/env bash
# Weekly / catch-up docs hygiene (PMO temporal owner). Safe if repo path wrong.
# Prefer SessionStart --auto-run for multi-week offline; this covers Sunday/cron when machine is on.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
pnpm docs:hygiene:run || true
