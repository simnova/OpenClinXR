#!/bin/zsh
# groom34: front+3q (beauty+ID) for mask sweep IoU, sequential.
set -e
cd /Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2
S=/Volumes/files/openclinxr-assets/store/hair-groom34
for R in 10 15 20; do
  HAIR_VIEWS=front,three_quarter /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python tools/openclinxr/hair-groom/strands/render_studio.py -- \
    --strands $S/build-mask$R/strands.npz \
    --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
    --cameras tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json \
    --body-glb apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb \
    --outdir tools/openclinxr/evidence/hair-groom34/renders-34mask$R \
    --opened tools/openclinxr/evidence/hair-groom34/opened-34mask$R.txt \
    > tools/openclinxr/evidence/hair-groom34/render34mask$R.log 2>&1
  echo "render mask R=$R done rc=$?" >> tools/openclinxr/evidence/hair-groom34/render-mask-chain.log
done
echo ALLDONE >> tools/openclinxr/evidence/hair-groom34/render-mask-chain.log
