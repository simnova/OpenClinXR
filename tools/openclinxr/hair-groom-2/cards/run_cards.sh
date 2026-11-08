#!/bin/zsh
# One card sub-round end to end (cards-r2 onward). Usage: run_cards.sh <groom round> <out dir> [budget]
#   cards_from_strands.py -> atlas (ATLAS=members: atlas_from_members.py, a unique cell per card baked from
#   its member strands, cards-r3; ATLAS=tiles: atlas_bake.py, cards-r2) -> render_cards.py --hide-cards (base)
#   -> calib_search.py -> render_cards.py (round/ + donor GLB) -> _blender_dump_body.py (body-geo.npz, grade.py I13)
set -euo pipefail
W=${0:A:h:h:h:h:h}
B=/Applications/Blender.app/Contents/MacOS/Blender
PY=/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13
export PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules"
GR=$1; EV=$2; BUDGET=${3:-1200}; CLUSTERS=${CLUSTERS:-800}
SPEC=${SPEC:-0,0.05}
ATLAS=${ATLAS:-members}
CELL_W=${CELL_W:-16}
ALPHA=${ALPHA:-blend}; CUTOFF=${CUTOFF:-0.2}; CARD_SHADOW=${CARD_SHADOW:-on}; SHADOW_ALPHA=${SHADOW_ALPHA:-0.2}
ATLAS_ARGS=${ATLAS_ARGS:-}
BODY=$W/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb
C=$W/tools/openclinxr/hair-groom-2/cards
RARGS="--alpha-mode $ALPHA --alpha-cutoff $CUTOFF --card-shadow $CARD_SHADOW --shadow-alpha $SHADOW_ALPHA"
cd $W
mkdir -p $EV
$B --background --factory-startup --python $C/cards_from_strands.py -- --body $BODY --groom-round $GR \
  --out $EV/cards.npz --budget $BUDGET --clusters $CLUSTERS --cell-w $CELL_W --members-out $EV/card-members.npz \
  2>&1 | grep -E "^CARDS_DONE" > $EV/cards.log
if [[ $ATLAS == members ]]; then
  $B --background --factory-startup --python $C/atlas_from_members.py -- --round $GR --cards $EV/cards.npz \
    --members $EV/card-members.npz --out-dir $EV ${=ATLAS_ARGS} 2>&1 | grep -E "^ATLAS_DONE" > $EV/atlas.log
else
  $B --background --factory-startup --python $C/atlas_bake.py -- --round $GR --cards $EV/cards.npz \
    --out-dir $EV 2>&1 | grep -E "^ATLAS_DONE" > $EV/atlas.log
fi
$B --background --factory-startup --python $C/render_cards.py -- --body $BODY --groom-round $GR \
  --cards $EV/cards.npz --atlas $EV/strand-atlas.png --out-dir $EV/base --hide-cards 2>&1 | grep -q CARDS_RENDER_DONE
$PY $C/calib_search.py --blender $B --body $BODY --groom-round $GR --cards $EV/cards.npz \
  --atlas $EV/strand-atlas.png --base $EV/base --out-dir $EV/calib --specular $SPEC --render-args "$RARGS" > $EV/calib.log
SP=$($PY -c "import json;print(json.load(open('$EV/calib/calibration.json'))['kept']['specular'])")
$B --background --factory-startup --python $C/render_cards.py -- --body $BODY --groom-round $GR \
  --cards $EV/cards.npz --atlas $EV/calib/strand-atlas-cal.png --out-dir $EV/round \
  --bake-glb $EV/aisha-cards-donor.glb --specular $SP ${=RARGS} 2>&1 | grep -E "^CARDS_RENDER_DONE" > $EV/render.log
$B --background --factory-startup --python $W/tools/openclinxr/hair-groom/cards/_blender_dump_body.py -- \
  --glb $BODY --out $EV/body-geo.npz --opened $EV/inputs-opened.txt 2>&1 | grep -E "^BODY_DUMP" > $EV/body.log
shasum -a 256 $EV/cards.npz $EV/card-members.npz $EV/strand-atlas.png $EV/calib/strand-atlas-cal.png \
  $EV/aisha-cards-donor.glb | tee $EV/hashes.txt
