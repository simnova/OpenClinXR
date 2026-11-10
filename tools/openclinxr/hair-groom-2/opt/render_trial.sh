#!/bin/bash
# render_trial.sh <glb relative to apps/ui-xr/public> <tag> <out-dir> <nohair-key> [hair-only]    (DRY=1: write json only)
# Writes <out-dir>/batch.json (EV/p1/batch-ts.json entry format: rig frame world, environmentEquirect
# target-scene-512.f16, toneMapping AgX, exposure 1) for 4 views and runs opt/batch.ts (the lane's batch.ts: one dev-server
# boot, renderHeadFocusCrops, --body-frame 1.5 head crops, 1024 px) from the W2 root, so the app serves W2's public dir.
# Outputs <out-dir>/ts-<tag>-<view>.png (+ -hair.png, -empty.png), matte-<tag>-<view>.png and nohair-<view>.png. The nohair set is cached per <nohair-key> under
# W2/.openclinxr/opt/hair-groom-2/nohair/<key>/ and rendered (hideHair:true on this GLB) only when the cache is empty:
# key "g2" for material trials (body = g2 tint), a knob hash for tint trials (scalp tint changes the body albedo, so
# nohair depends on the tint knobs, not only on the body). Needs, copied from W public (not copied by this script):
#   _hair-transplant-probe/env/target-scene-512.f16
#   _hair-transplant-probe/aisha-cards-p2-b.glb, aisha-cards-sheen3b-final.glb   (incumbent + BEST3 material, for the baseline run)
# and node_modules reachable from W2 (symlink /Volumes/files/src/OpenClinXR/node_modules or pnpm install).
set -euo pipefail
GLB=$1; TAG=$2; OUT=$3; KEY=$4; HAIRONLY=${5:-}
W2="$(cd "$(dirname "$0")/../../../.." && pwd)"
CACHE=$W2/.openclinxr/opt/hair-groom-2/nohair/$KEY
mkdir -p "$OUT" "$CACHE"
python3 - "$GLB" "$TAG" "$OUT" "$CACHE" <<'PYE'
import json, os, sys
glb, tag, out, cache = sys.argv[1:5]
rig = {"frame": "world", "environmentEquirect": {"width": 512, "height": 256, "background": True,
       "url": "/generated-humanoids/_hair-transplant-probe/env/target-scene-512.f16"}, "toneMapping": "AgX", "exposure": 1}
views = ["front", "three_quarter_left", "side", "back"]
need_nohair = not all(os.path.exists("%s/nohair-%s.png" % (cache, v)) for v in views)
items = []
if need_nohair:
    items += [{"glb": glb, "view": v, "outName": "nohair-%s.png" % v, "rig": rig, "hideHair": True} for v in views]
items += [{"glb": glb, "view": v, "outName": "ts-%s-%s.png" % (tag, v), "rig": rig, "matte": True} for v in views]
json.dump(items, open(out + "/batch.json", "w"), indent=1)
print("NOHAIR_RENDER" if need_nohair else "NOHAIR_CACHED", len(items), "page loads;",
      "crops: colour 4, hair-only 4, empty 4, nohair %d" % (4 if need_nohair else 0), "(A1b matte: batch.ts matte:true)")
PYE
[ -n "${DRY:-}" ] && exit 0
cd "$W2"
T0=$(date +%s)
# renderHeadFocusCrops joins outputRoot onto cwd, so the out dir is passed relative to W2
REL=$(python3 -c 'import os,sys;print(os.path.relpath(sys.argv[1],sys.argv[2]))' "$OUT" "$W2")
npx tsx tools/openclinxr/hair-groom-2/opt/batch.ts "$OUT/batch.json" "$REL" > "$OUT/batch.log" 2>&1
if [ ! -e "$CACHE/nohair-front.png" ]; then cp "$OUT"/nohair-*.png "$CACHE/"; fi
for v in front three_quarter_left side back; do cp -f "$CACHE/nohair-$v.png" "$OUT/nohair-$v.png"; done
echo "RENDER_SECONDS $(( $(date +%s) - T0 ))"
# A1b: hair matte from the hair-only/empty/colour/nohair crops -> $OUT/matte-<tag>-<view>.png (alpha = matte)
PYB=${PYB:-/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13}
PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules" "$PYB" "$(dirname "$0")/matte.py" write "$OUT/ts-$TAG" "$OUT/nohair" "$OUT/matte-$TAG"
echo "MATTE_DONE"
