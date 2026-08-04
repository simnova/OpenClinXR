#!/usr/bin/env bash
# promote-candidate-copy.sh — documented copy-to-deployed-path step for a promoted
# pipeline candidate. Reads a promotion record JSON (written by
# tools/openclinxr/evidence/promote-candidate.ts) and copies the candidate GLB to
# ALL deploy targets (primary generated-humanoids + cagematch current slot).
#
# Aesthetic-only asset staging. This does NOT confer production, clinical,
# scoring, or learner readiness (see notEvidenceFor in the promotion record).
#
# Usage:
#   scripts/promote-candidate-copy.sh <path/to/promotion-record.json>
# If no argument is given, uses the newest record in
#   .openclinxr/asset-production/promotions/
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROMOTIONS_DIR=".openclinxr/asset-production/promotions"
RECORD="${1:-}"

if [[ -z "$RECORD" ]]; then
  RECORD="$(ls -t "$PROMOTIONS_DIR"/*.json 2>/dev/null | grep -v '/index.json$' | head -1 || true)"
fi

if [[ -z "$RECORD" || ! -f "$RECORD" ]]; then
  echo "No promotion record found. Run: tsx tools/openclinxr/evidence/promote-candidate.ts --candidate-id <id>" >&2
  exit 1
fi

echo "[promote-candidate-copy] using record: $RECORD"

SRC="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).glbPath)" "$RECORD")"

if [[ ! -f "$SRC" ]]; then
  echo "Source GLB missing: $SRC (record ok; deploy skipped)" >&2
  exit 0
fi

# Prefer deployTargets[] when present; fall back to deployTargetSuggestion for older records.
node -e '
const fs = require("fs");
const path = require("path");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const src = process.argv[2];
const targets = Array.isArray(r.deployTargets) && r.deployTargets.length
  ? r.deployTargets
  : (r.deployTargetSuggestion ? [r.deployTargetSuggestion] : []);
if (!targets.length) {
  console.error("No deploy targets in record");
  process.exit(1);
}
for (const dest of targets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("[promote-candidate-copy] copied: " + src + " -> " + dest);
}
' "$RECORD" "$SRC"

echo "[promote-candidate-copy] aesthetic staging only; not production/clinical/scoring/learner readiness."
