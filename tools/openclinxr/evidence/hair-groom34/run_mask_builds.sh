#!/bin/zsh
# groom34 mask sweep builds (sequential): same flags as nomask, masked roots.
set -e
S=/Volumes/files/openclinxr-assets/store/hair-groom34
for R in 10 15 20; do
  mise exec -- python3 tools/openclinxr/hair-groom/strands/interp_children.py \
    --outdir $S/build-mask$R \
    --guides $S/guides-34mirror.npz --roots $S/roots-34mask$R.npz \
    --sdf tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz \
    --hull tools/openclinxr/evidence/hair-hull5/hull.npz \
    --ear-frame tools/openclinxr/evidence/hair-groom4/tucked/earframe.json \
    --region-weight --uv-cutoff 0.15 --pool-max-move-mm 60 \
    --pool-ref $S/guides-8amirror.npz --temple-taper 0.5 \
    --lobe-drop-roots --sideburn-cap-lobe --cap-reproject \
    --shirt-sdf /Volumes/files/openclinxr-assets/store/hair-groom31/shirt-sdf-4mm.npz \
    --shirt-clear-mm 0.5 \
    > tools/openclinxr/evidence/hair-groom34/build-mask$R.log 2>&1
  echo "mask R=$R done rc=$?" >> tools/openclinxr/evidence/hair-groom34/build-mask-chain.log
done
echo ALLDONE >> tools/openclinxr/evidence/hair-groom34/build-mask-chain.log
