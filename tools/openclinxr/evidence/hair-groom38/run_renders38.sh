#!/bin/zsh
# groom38 renders: std (front/3q/prof/back, scorer cams), neg (mirror cams),
# ear (ear cams). Usage: run_renders38.sh STRANDS
set -e
cd /Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2
S=$1
B=/Applications/Blender.app/Contents/MacOS/Blender
P=tools/openclinxr/hair-groom/strands/render_studio.py
G=apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb
C=tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json
E=tools/openclinxr/evidence/hair-groom38
HAIR_VIEWS=front,three_quarter $B --background --python $P -- \
  --strands $S --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras $C --body-glb $G --outdir $E/renders-38 --opened $E/opened-38.txt \
  > $E/render38-std.log 2>&1
echo "std/front3q done rc=$?" >> $E/render38-chain.log
HAIR_VIEWS=profile_90,back $B --background --python $P -- \
  --strands $S --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras $C --body-glb $G --outdir $E/renders-38 --opened $E/opened-38.txt \
  > $E/render38-profback.log 2>&1
echo "profback done rc=$?" >> $E/render38-chain.log
HAIR_VIEWS=three_quarter,profile_90 $B --background --python $P -- \
  --strands $S --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras tools/openclinxr/evidence/hair-groom34/cameras-mirror34.json \
  --body-glb $G --outdir $E/renders-38neg --opened $E/opened-38neg.txt \
  > $E/render38-neg.log 2>&1
echo "neg done rc=$?" >> $E/render38-chain.log
HAIR_VIEWS=front,three_quarter $B --background --python $P -- \
  --strands $S --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras tools/openclinxr/evidence/hair-groom34/cameras-ear34.json \
  --body-glb $G --outdir $E/renders-38ear --opened $E/opened-38ear.txt \
  > $E/render38-ear.log 2>&1
echo "ear done rc=$?" >> $E/render38-chain.log
echo ALLDONE >> $E/render38-chain.log
