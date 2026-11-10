#!/bin/bash
# build_trial.sh <stage> <knobs.json> <out-dir>      (DRY=1 prints the commands and builds nothing)
#   stage material: r10 B donor -> transplant_donor runtime sheen (the EV/sheen3b/tools/s3b.sh path) -> transplant_library_hair
#                   -> (knobs.applyG2, default true) cards/p2_scalp.sh g2 on the result.
#   stage tint:     knobs.materialGlb (default: the BEST3 material GLB) -> tint_chain.sh with the tint knobs.
# <out-dir> = W2/.openclinxr/opt/hair-groom-2/build/<tag>; the GLB lands in
#   W2/apps/ui-xr/public/generated-humanoids/_hair-transplant-probe/opt/<tag>.glb. Prints "GLB <path>" and "GLB_SHA256 <hex>".
# Inputs read from the lane worktree W and its evidence EV are read-only.
set -euo pipefail
exec 3>&2
STAGE=$1; KNOBS=$2; OUT=$3
W2="$(cd "$(dirname "$0")/../../../.." && pwd)"
H="$W2/tools/openclinxr/hair-groom-2"
W=${LANE_W:-/Users/patrick/.grok/worktrees/src-openclinxr/hair-groom-2}
EV=$W/.openclinxr/evidence/hair-groom-2
export PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules"
PY=/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13
TAG=$(basename "$OUT")
PUB=$W2/apps/ui-xr/public
GLB=$PUB/generated-humanoids/_hair-transplant-probe/opt/$TAG.glb
P=$EV/r10/tw35ta15sm2                 # donor, cards.npz, card-members.npz, calib atlas (sheen3b/build/final/donor.json)
STRANDS=$EV/groom-r9/s1/strands.npz   # p2 records: EV/p2/g2/tint.json "strands"
BEST3_MAT=$W/apps/ui-xr/public/generated-humanoids/_hair-transplant-probe/aisha-cards-sheen3b-final.glb
mkdir -p "$OUT" "$(dirname "$GLB")"
T0=$(date +%s)
# knob -> shell var (default = BEST3 / g2)
eval "$($PY - "$KNOBS" <<'PYE'
import json, sys
k = json.load(open(sys.argv[1]))
d = dict(K=.65, spec=.3, roughness=.4, anisotropy=.5, specColorG=.45, specColorB=.25, streakAmp=.5, streakSigmaMm=.5,
         amax=.8, wideAmax=.3, closeMm=2., closeSoftMm=1.5, fadeFrac=.6, fadeLenMm=60., applyG2=True, materialGlb="")
d.update({a: b for a, b in k.items() if a in d})
for a, b in d.items():
    print("%s=%s" % (a, str(int(b)) if isinstance(b, bool) else b if isinstance(b, str) and not b else repr(b) if not isinstance(b, str) else "'%s'" % b))
PYE
)"
run() { if [ -n "${DRY:-}" ]; then echo "DRY $*" >&3; else "$@"; fi; }
if [ "$STAGE" = material ]; then
  MAT=$OUT/material.glb; [ "$applyG2" = 1 ] || MAT=$GLB
  run $PY "$H/cards/transplant_donor.py" "$P/aisha-cards-donor.glb" "$OUT/donor.glb" "$OUT/donor.json" \
    --runtime-sheen "$spec" "$roughness" "$anisotropy" "$P/calib/strand-atlas-cal.png" --aniso-rotation 0 \
    --base-color-scale "$K" --spec-color 1 "$specColorG" "$specColorB" \
    --spec-streaks "$P/cards.npz" "$P/card-members.npz" 0 "$streakAmp" "$streakSigmaMm" 0 > "$OUT/donor.log"
  run $PY "$H/../asset-pipeline/makeclothes/transplant_library_hair.py" \
    --input "$PUB/generated-humanoids/mpfb-ob-patient-aisha.glb" --bake "$OUT/donor.glb" --output "$MAT" --max-texture 2048 \
    --alpha-mode MASK --alpha-cutoff 0.85 --carry-extensions --carry-tangents --fringe-blend --output-provenance "$OUT/provenance.json" > "$OUT/transplant.log" 2>&1
  if [ "$applyG2" = 1 ]; then
    # g2 finish through the unedited p2_scalp.sh (needs the material GLB under a path it can read; record dir R)
    run zsh "$H/cards/p2_scalp.sh" "$MAT" "$STRANDS" "$GLB" "$OUT/p2" > "$OUT/p2.sha"
  fi
elif [ "$STAGE" = tint ]; then
  IN=${materialGlb:-$BEST3_MAT}; [ -n "$IN" ] || IN=$BEST3_MAT
  run "$H/opt/tint_chain.sh" "$IN" "$STRANDS" "$GLB" "$OUT/tint" "$amax" "$wideAmax" "$closeMm" "$closeSoftMm" "$fadeFrac" "$fadeLenMm"
else
  echo "stage must be material|tint" >&2; exit 2
fi
[ -n "${DRY:-}" ] && exit 0
SHA=$(shasum -a 256 "$GLB" | cut -d' ' -f1)
echo "$(( $(date +%s) - T0 ))" > "$OUT/build.seconds"
echo "$SHA" > "$OUT/glb.sha256"
echo "GLB $GLB"
echo "GLB_SHA256 $SHA"
