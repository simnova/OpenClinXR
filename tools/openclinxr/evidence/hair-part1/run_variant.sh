#!/bin/zsh
# hair-part1: build one variant on groom36 and run the lane's instruments.
# Usage: run_variant.sh TAG ROOTS [extra interp_children flags...]
# Build = groom36's exact build-36 command + only the variant's flags.
set -u
TAG=$1; ROOTS=$2; shift 2
W=/Users/patrick/.grok/worktrees/hair-hairdeck
cd $W
B=/Applications/Blender.app/Contents/MacOS/Blender
ST=/Volumes/files/openclinxr-assets/store
S36=$ST/hair-groom36
OUT=$ST/hair-part1/build-$TAG
E=tools/openclinxr/evidence/hair-part1
LOG=$E/run-$TAG.log
[ "${SKIP_BUILD:-0}" = 1 ] || : > $LOG
step() { echo "STEP $1 rc=$2 $(date +%H:%M:%S)" >> $LOG; }
if [ "${SKIP_BUILD:-0}" != 1 ]; then
mise exec -- python3 tools/openclinxr/hair-groom/strands/interp_children.py \
  --outdir $OUT --guides $S36/guides-36.npz --roots $ROOTS \
  --sdf tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz \
  --hull tools/openclinxr/evidence/hair-hull5/hull.npz \
  --pinna $ST/hair-groom35/ear_pinna-mirror35.npz \
  --ear-frame tools/openclinxr/evidence/hair-groom35/earframe-mirror35.json \
  --region-weight --uv-cutoff 0.15 --pool-max-move-mm 60 \
  --pool-ref $S36/pool-ref-36.npz --temple-taper 0.5 --lobe-drop-roots \
  --sideburn-cap-lobe --cap-reproject \
  --shirt-sdf $ST/hair-groom31/shirt-sdf-4mm.npz --shirt-clear-mm 0.5 --expect-n-new 2669 \
  "$@" > $E/build-$TAG.log 2>&1
step build $?
fi
[ -f $OUT/strands.npz ] || exit 1
[ "${BUILD_ONLY:-0}" = 1 ] && exit 0
mise exec -- python3 tools/openclinxr/evidence/hair-groom36/run_gates36.py \
  --strands $OUT/strands.npz --proxy $ST/hair-groom34/ear-proxy.npz \
  --cameras tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json \
  --out $E/gates-$TAG.json --tag $TAG > $E/gates-$TAG-run.log 2>&1
step gates $?
$B --background --python tools/openclinxr/hair-groom/strands/render_studio.py -- \
  --strands $OUT/strands.npz --params tools/openclinxr/evidence/hair-groom7/params-c08.json \
  --cameras tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json \
  --body-glb apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb \
  --outdir $E/renders-$TAG --opened $E/opened-$TAG.txt > $E/render-$TAG-std.log 2>&1
step render_std $?
mise exec -- python3 tools/openclinxr/evidence/hair-groom35/iou35.py $E/renders-$TAG $TAG > $E/iou-$TAG.log 2>&1
step iou $?
# iou35 writes into its own dir (E35/iou-TAG.json): move it here.
mv tools/openclinxr/evidence/hair-groom35/iou-$TAG.json $E/ 2>/dev/null
$B --background --python $E/part1_metric.py -- --strands $OUT/strands.npz --tag $TAG > $E/part-$TAG-render.log 2>&1
step part_render $?
$B --background --python $E/part1_metric.py -- --strands $OUT/strands.npz --tag $TAG --measure > $E/part-$TAG-measure.log 2>&1
step part_measure $?
echo DONE >> $LOG
