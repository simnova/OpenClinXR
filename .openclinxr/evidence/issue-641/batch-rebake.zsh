#!/bin/zsh
# #641 batch re-bake: run the FIXED room-albedo-ao-bake.py over all 14 shipped
# rooms in place. Sequential (Cycles bakes share the GPU). Per-room means logs
# go to the issue evidence dir; stdout is captured per room.
set -u
cd /Users/patrick/.grok/worktrees/src-openclinxr/issue-641 || exit 1
EV=".openclinxr/evidence/issue-641"
mkdir -p "$EV"
ROOMS=(adult-ed-abdominal-bay behavioral-health-private ed-exam-bay ed-stroke-bay \
  inpatient-ward ob-triage oncology-consult pediatric-fever-urgent-care \
  pediatric-urgent-care-bay primary-care-clinic stepdown surgical-ward \
  telehealth-home-visit urgent-care-clinic)
FAILED=0
for r in $ROOMS; do
  f="infinigen-$r.glb"
  echo "[batch] start $f $(date +%H:%M:%S)"
  if ! blender --background --python tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py -- \
      --input "apps/ui-xr/public/xr-assets/environment/$f" \
      --output "apps/ui-xr/public/xr-assets/environment/$f" \
      --resolution 1024 \
      --means-log "$EV/means-$f.json" \
      --room-name "$f" > "$EV/bake-$f.log" 2>&1; then
    echo "[batch] FAIL $f"
    FAILED=1
  else
    echo "[batch] ok $f $(date +%H:%M:%S) -> $(grep -c 'baked ' "$EV/bake-$f.log")"
  fi
done
echo "[batch] done failed=$FAILED"
exit $FAILED
