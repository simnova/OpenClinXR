#!/bin/zsh
# build_target_scene_env.sh [worktree]: hair-groom-2 P1. Target-scene panorama (Cycles, head centre) ->
# three-convention RGBA half floats served at the URL in cards/target-scene-rig.json.
set -e
W=${1:-$(git rev-parse --show-toplevel)}; cd $W
B=/Applications/Blender.app/Contents/MacOS/Blender
export PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules"
PY=/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13
O=.openclinxr/evidence/hair-groom-2/p1/env; mkdir -p $O
C=tools/openclinxr/hair-groom-2/cards
$B --background --python $C/target_scene_env.py -- apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb \
  tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json $O/target-scene.exr > $O/env.log 2>&1
$B --background --python $C/exr_to_npy.py -- $O/target-scene.exr $O/target-scene.npy | grep DUMP
$PY $C/env_to_three.py $O/target-scene.npy $O/target-scene-512.f16 512
D=apps/ui-xr/public/generated-humanoids/_hair-transplant-probe/env; mkdir -p $D; cp $O/target-scene-512.f16 $D/
shasum -a 256 $D/target-scene-512.f16
