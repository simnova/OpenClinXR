#!/usr/bin/env bash
# Runner: spawn fresh Python process per subject for #237 isolation bake.
# Run this once; then vitest reads the artifacts.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/.openclinxr/evidence/issue-237"
VENV_PYTHON="$HOME/.openclinxr-tools/trellis2-apple/venv/bin/python3"
TRELLIS_ROOT="$HOME/.openclinxr-tools/trellis2-apple/src"
WEIGHTS="$HOME/ComfyUI/models/trellis2"
DINOV3="$HOME/ComfyUI/models/dinov3"
PACKS_235="$HOME/.grok/worktrees/src-openclinxr/issue-235/.openclinxr/evidence/issue-232"
SCRIPT="$REPO_ROOT/tools/openclinxr/evidence/blender/run_bake_isolated.py"

mkdir -p "$EVIDENCE_DIR"

echo "=== #237 TRELLIS Metal per-subject isolation bake ==="
echo "Evidence: $EVIDENCE_DIR"
echo ""

# Subject 1: wall-clock
echo ">>> Subject 1/2: wall-clock (fresh process)"
"$VENV_PYTHON" "$SCRIPT" \
  --subject-id wall-clock \
  --display-name "wall clinical / exam-room analog clock" \
  --input-image "$PACKS_235/wall-clock/front.png" \
  --output-dir "$EVIDENCE_DIR/wall-clock" \
  --weights-path "$WEIGHTS" \
  --dinov3-path "$DINOV3" \
  --trellis-root "$TRELLIS_ROOT"
echo ""

# Brief pause to let OS reclaim GPU memory
echo ">>> Cooling down 10s..."
sleep 10
echo ""

# Subject 2: bedside-monitor
echo ">>> Subject 2/2: bedside-monitor (fresh process)"
"$VENV_PYTHON" "$SCRIPT" \
  --subject-id bedside-monitor \
  --display-name "multi-parameter bedside monitor" \
  --input-image "$PACKS_235/bedside-monitor/front.png" \
  --output-dir "$EVIDENCE_DIR/bedside-monitor" \
  --weights-path "$WEIGHTS" \
  --dinov3-path "$DINOV3" \
  --trellis-root "$TRELLIS_ROOT"

echo ""
echo "=== Both subjects baked. Run vitest to verify. ==="
