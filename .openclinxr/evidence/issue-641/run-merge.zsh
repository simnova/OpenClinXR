#!/bin/zsh
# #641 floors-only merge: after the batch re-bake, restore every non-floor
# texture (walls/ceiling/AO/text) from the git-committed original so the only
# shipped change is the floor bake + repaired floor UVs.
set -u
cd /Users/patrick/.grok/worktrees/src-openclinxr/issue-641 || exit 1
ROOMS=(adult-ed-abdominal-bay behavioral-health-private ed-exam-bay ed-stroke-bay \
  inpatient-ward ob-triage oncology-consult pediatric-fever-urgent-care \
  pediatric-urgent-care-bay primary-care-clinic stepdown surgical-ward \
  telehealth-home-visit urgent-care-clinic)
FAILED=0
for r in $ROOMS; do
  f="apps/ui-xr/public/xr-assets/environment/infinigen-$r.glb"
  if ! pnpm exec tsx .openclinxr/evidence/issue-641/floors-only-merge.ts "$f" >> /tmp/merge-final.log 2>&1; then
    echo "[merge] FAIL $f"
    FAILED=1
  fi
done
echo "[merge] done failed=$FAILED"
exit $FAILED
