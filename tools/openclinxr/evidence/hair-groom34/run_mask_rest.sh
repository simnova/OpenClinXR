#!/bin/zsh
set -e
cd /Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2
S=/Volumes/files/openclinxr-assets/store/hair-groom34
B=/Applications/Blender.app/Contents/MacOS/Blender
P=tools/openclinxr/hair-groom/strands/render_studio.py
G=apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb
HAIR_VIEWS=three_quarter,profile_90 $B --background --python $P -- \
  --strands $S/build-mask20/strands.npz \
  --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras tools/openclinxr/evidence/hair-groom34/cameras-mirror34.json \
  --body-glb $G --outdir tools/openclinxr/evidence/hair-groom34/renders-34mask20neg \
  --opened tools/openclinxr/evidence/hair-groom34/opened-34mask20neg.txt \
  > tools/openclinxr/evidence/hair-groom34/render34mask20neg.log 2>&1
echo "neg done rc=$?" >> tools/openclinxr/evidence/hair-groom34/render-rest-chain.log
HAIR_VIEWS=profile_90 $B --background --python $P -- \
  --strands $S/build-mask20/strands.npz \
  --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json \
  --body-glb $G --outdir tools/openclinxr/evidence/hair-groom34/renders-34mask20 \
  --opened tools/openclinxr/evidence/hair-groom34/opened-34mask20prof.txt \
  > tools/openclinxr/evidence/hair-groom34/render34mask20prof.log 2>&1
echo "prof done rc=$?" >> tools/openclinxr/evidence/hair-groom34/render-rest-chain.log
echo ALLDONE >> tools/openclinxr/evidence/hair-groom34/render-rest-chain.log
