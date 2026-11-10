#!/bin/zsh
# p2_scalp.sh <in.glb> <strands.npz> <out.glb> <record-dir>
# DESIGN-realism.md P2 chain on a runtime GLB: scalp tint (scalp_tint.py) then hairline edge fade
# (hairline_edge_fade.py), with the arguments graded in P2 (slice 2, g2: tint gated to the closed root field).
# Deterministic: from aisha-cards-sheen3b-final.glb + groom-r9/s1 strands it reproduces sha256 f346382e3945281b...
set -e
IN=$1; ST=$2; OUT=$3; R=$4; mkdir -p $R
H=${0:A:h}
export PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules"
B=(/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-use-system-env --python)
$B $H/scalp_tint.py -- $IN $ST $R/tint.glb $R/tint.json \
  --sigma-mm 0.6 --wide-sigma-mm 3 --wide-amax 0.3 --amax 0.8 --sideburn-weight 0.2 \
  --close-mm 2 --close-soft-mm 1.5 > $R/tint.log 2>&1
$B $H/hairline_edge_fade.py -- $R/tint.glb $ST $OUT $R/edge.json --frac 0.6 --len-mm 60 > $R/edge.log 2>&1
rm -f $R/tint.glb
shasum -a 256 $OUT
