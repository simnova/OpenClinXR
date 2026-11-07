#!/bin/zsh
# groom35 renders for step2/step3: std (front/3q/prof/back, scorer cams),
# neg (3q/prof, mirror cams), ear (front/3q, ear cams). Usage: run_renders35.sh TAG STRANDS
set -e
cd /Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2
TAG=$1; S=$2
B=/Applications/Blender.app/Contents/MacOS/Blender
P=tools/openclinxr/hair-groom/strands/render_studio.py
G=apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb
C=tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json
E=tools/openclinxr/evidence/hair-groom35
HAIR_VIEWS=front,three_quarter $B --background --python $P -- \
  --strands $S --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras $C --body-glb $G --outdir $E/renders-35$TAG --opened $E/opened-35$TAG.txt \
  > $E/render35$TAG-std.log 2>&1
echo "std/front3q done rc=$?" >> $E/render35$TAG-chain.log
HAIR_VIEWS=profile_90,back $B --background --python $P -- \
  --strands $S --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras $C --body-glb $G --outdir $E/renders-35$TAG --opened $E/opened-35$TAG.txt \
  > $E/render35$TAG-profback.log 2>&1
echo "profback done rc=$?" >> $E/render35$TAG-chain.log
HAIR_VIEWS=three_quarter,profile_90 $B --background --python $P -- \
  --strands $S --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras tools/openclinxr/evidence/hair-groom34/cameras-mirror34.json \
  --body-glb $G --outdir $E/renders-35${TAG}neg --opened $E/opened-35${TAG}neg.txt \
  > $E/render35$TAG-neg.log 2>&1
echo "neg done rc=$?" >> $E/render35$TAG-chain.log
HAIR_VIEWS=front,three_quarter $B --background --python $P -- \
  --strands $S --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras tools/openclinxr/evidence/hair-groom34/cameras-ear34.json \
  --body-glb $G --outdir $E/renders-35${TAG}ear --opened $E/opened-35${TAG}ear.txt \
  > $E/render35$TAG-ear.log 2>&1
echo "ear done rc=$?" >> $E/render35$TAG-chain.log
echo ALLDONE >> $E/render35$TAG-chain.log
