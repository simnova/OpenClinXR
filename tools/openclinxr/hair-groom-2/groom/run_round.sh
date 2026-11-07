#!/bin/sh
# One groom round: render 3 views, copy the recipe, build the sheet.
#   run_round.sh <round-name> [samples]
set -eu
W=$(cd "$(dirname "$0")/../../../.." && pwd)
B=/Applications/Blender.app/Contents/MacOS/Blender
BPY=/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13
G="$W/tools/openclinxr/hair-groom-2/groom"
EV="$W/.openclinxr/evidence/hair-groom-2/groom-r1/$1"
RECIPE="$G/recipes/straight_centre_part_collarbone.json"
mkdir -p "$EV"
cp "$RECIPE" "$EV/recipe.json"
"$B" --background --factory-startup --python "$G/groom.py" -- \
  --body "$W/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb" \
  --recipe "$EV/recipe.json" --out-dir "$EV" --samples "${2:-128}" \
  --views front,three_quarter_left,side 2>&1 | grep -E 'VIEW_DONE|GROOM_DONE|Error|Traceback|line [0-9]'
PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules" "$BPY" "$G/sheet.py" \
  --target "$W/tools/openclinxr/evidence/hair-eval/fixtures/target.png" --round-dir "$EV"
