#!/bin/zsh
# Lane push to main under the shared push lock. Usage: push-main.sh <worktree> <logfile>
# Rebases onto origin/main after taking the lock; refuses (exit 3) if the new main commits touch lane paths.
wt=$1; log=$2
LANE_PATHS=(packages/openclinxr/xr-sync-server packages/openclinxr/xr-sync-client apps/arena/ui-xr-iwsdk-spike tools/openclinxr/evidence/xr-sync pnpm-lock.yaml)
until (( $(sysctl -n vm.loadavg | awk -v max=${OPENCLINXR_PUSH_LOAD_MAX:-45} '{print ($3<max)}') )); do sleep 60; done
LOCK="${OPENCLINXR_PUSH_LOCK:-/private/tmp/openclinxr-push.lock}"
until mkdir "$LOCK" 2>/dev/null; do
  if [ -f "$LOCK/owner" ]; then echo "push lock held by:"; cat "$LOCK/owner"; fi
  sleep 60
done
trap 'if [ ! -f "$LOCK/owner" ] || grep -qx "pid=$$" "$LOCK/owner"; then rm -f "$LOCK/owner"; rmdir "$LOCK"; else echo "lock owner changed: not removing"; fi' EXIT
{ [ -z "$OPENCLINXR_PUSH_LOCK_OWNER_FAIL" ] && printf 'pid=%s\nworktree=%s\nstartedAt=%s\nlog=%s\n' $$ "$wt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$log" > "$LOCK/owner"; } 2>/dev/null || { echo "lock owner write failed"; exit 7; }
cd $wt || exit 2
export MISE_TRUSTED_CONFIG_PATHS=$HOME/.codex/worktrees:/Volumes/files/src/openclinxr-wt TURBO_CACHE_DIR=$HOME/.cache/openclinxr/turbo
SWEEP_CMD=${OPENCLINXR_SWEEP_CMD:-"pnpm exec tsx tools/openclinxr/evidence/station-luminance-sweep.ts"}
sync_and_stamp() {
git fetch -q origin || exit 4
base=$(git merge-base HEAD origin/main)
if [ "$base" != "$(git rev-parse origin/main)" ]; then
  touched=$(git diff --name-only $base origin/main -- $LANE_PATHS)
  if [ -n "$touched" ]; then echo "main moved on lane paths, re-verify needed:"; echo $touched; exit 3; fi
  git rebase -q origin/main || { git rebase --abort; echo "rebase conflict"; exit 3; }
  echo "rebased onto $(git rev-parse --short origin/main)"
fi
# Re-stamp: a rebase renames the main.ts commit, so the luminance sweep stamp (last main.ts commit) must be re-measured in this tree.
stamp=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("tools/openclinxr/evidence/station-luminance-sweep.json","utf8")).measuredAgainstCommit)')
head_main=$(git log -1 --format=%h -- apps/ui-xr/src/main.ts)
if [ "$stamp" != "$head_main" ]; then
  echo "sweep stamp $stamp != main.ts head $head_main: re-running the sweep"
  ${=SWEEP_CMD} > $log.sweep 2>&1 || { echo "sweep failed"; exit 5; }
  git add tools/openclinxr/evidence/station-luminance-sweep.json
  git commit -q -m "Re-run the luminance sweep after rebase: stamp follows the main.ts commit

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" || { echo "restamp commit failed"; exit 5; }
fi
}
sync_and_stamp
git push origin HEAD:main > $log 2>&1
rc=$?
if [ $rc -ne 0 ] && grep -Eq '^ ! \[(remote )?rejected\]' $log; then
  cp $log $log.try1
  echo "push rejected: origin/main moved; re-syncing and retrying once"
  sync_and_stamp
  git push origin HEAD:main > $log 2>&1
  rc=$?
  if [ $rc -ne 0 ] && grep -Eq '^ ! \[(remote )?rejected\]' $log; then
    echo "main moved twice"
    tail -4 $log
    exit 6
  fi
fi
echo "rc=$rc"; tail -4 $log
exit $rc
