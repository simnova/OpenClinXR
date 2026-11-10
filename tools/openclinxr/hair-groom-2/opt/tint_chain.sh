#!/bin/bash
# tint_chain.sh <in.glb> <strands.npz> <out.glb> <record-dir> <amax> <wideAmax> <closeMm> <closeSoftMm> <fadeFrac> <fadeLenMm>
# cards/p2_scalp.sh with the tint knobs open (p2_scalp.sh itself is not edited). Frozen: sigma 0.6, wide sigma 3,
# sideburn weight 0.2. With (0.8 0.3 2 1.5 0.6 60) it is p2_scalp.sh's g2 chain.
set -euo pipefail
exec 3>&2
IN=$1; ST=$2; OUT=$3; R=$4; AMAX=$5; WAMAX=$6; CLOSE=$7; CSOFT=$8; FFRAC=$9; FLEN=${10}
mkdir -p "$R"
H="$(cd "$(dirname "$0")/../cards" && pwd)"
export PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules"
B=(/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-use-system-env --python)
CMD1=("${B[@]}" "$H/scalp_tint.py" -- "$IN" "$ST" "$R/tint.glb" "$R/tint.json" --sigma-mm 0.6 --wide-sigma-mm 3 --wide-amax "$WAMAX" --amax "$AMAX" --sideburn-weight 0.2 --close-mm "$CLOSE" --close-soft-mm "$CSOFT")
CMD2=("${B[@]}" "$H/hairline_edge_fade.py" -- "$R/tint.glb" "$ST" "$OUT" "$R/edge.json" --frac "$FFRAC" --len-mm "$FLEN")
if [ -n "${DRY:-}" ]; then echo "DRY ${CMD1[*]}" >&3; echo "DRY ${CMD2[*]}" >&3; exit 0; fi
"${CMD1[@]}" > "$R/tint.log" 2>&1
"${CMD2[@]}" > "$R/edge.log" 2>&1
rm -f "$R/tint.glb"
