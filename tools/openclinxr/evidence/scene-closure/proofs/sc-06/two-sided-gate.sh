#!/usr/bin/env bash
# SC-06 two-sided gate.
#
# For every clause this card adds, REVERT the fix that clause guards, rebuild the affected package,
# and prove the clause FAILS. Then restore and prove it passes. A revert that produces NO CHANGE is
# a gap in the gate, not a pass: it means the clause is green for a reason other than the fix.
#
# Cross-package tests resolve through dist/, so every revert rebuilds before the probe runs.
# Without that the probe measures the last build and passes in both directions.
#
# Usage: bash tools/openclinxr/evidence/scene-closure/proofs/sc-06/two-sided-gate.sh
set -uo pipefail
cd "$(dirname "$0")/../../../../../.." || exit 1
ROOT="$PWD"

BEHAVIOR_TEST="apps/ui-xr/src/the-normal-consumer-replays-and-invalidates-the-frozen-scene.test.ts"
FREEZE_TESTS="tools/openclinxr/evidence/supine-control-freeze/"
VERIFIER_TEST="tools/openclinxr/evidence/scene-closure/proofs/sc-06/verifier.test.ts"

BROKE=0
TOTAL=0

# run_probe <test-path> -> "PASS" or "FAIL"
run_probe() {
  if pnpm exec vitest run "$1" >/tmp/sc06-probe.log 2>&1; then echo PASS; else echo FAIL; fi
}

# revert <label> <file> <python-edit> <rebuild-filter> <probe-path> <expected-clause>
revert() {
  local label="$1" file="$2" edit="$3" filter="$4" probe="$5" clause="$6"
  TOTAL=$((TOTAL + 1))
  cp "$ROOT/$file" "/tmp/sc06-backup-$TOTAL"
  python3 -c "$edit" || { echo "[$label] EDIT FAILED"; return; }
  if [ -n "$filter" ]; then pnpm --filter "$filter" build >/dev/null 2>&1; fi
  local result
  result=$(run_probe "$probe")
  cp "/tmp/sc06-backup-$TOTAL" "$ROOT/$file"
  if [ -n "$filter" ]; then pnpm --filter "$filter" build >/dev/null 2>&1; fi
  local restored
  restored=$(run_probe "$probe")
  if [ "$result" = "FAIL" ] && [ "$restored" = "PASS" ]; then
    BROKE=$((BROKE + 1))
    echo "[$TOTAL] $label -> reverted:FAIL restored:PASS  (breaks: $clause)"
  else
    echo "[$TOTAL] $label -> reverted:$result restored:$restored  GAP: no named clause caught this"
  fi
}

echo "=== SC-06 two-sided gate ==="
echo "commit: $(git rev-parse HEAD)"
echo "started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

REC="$ROOT/packages/openclinxr/session-state/src/accepted-scene-plan.ts"
EVID="$ROOT/packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts"
PLAN="$ROOT/packages/openclinxr/asset-registry/src/case-owned-scene-plan.ts"
REPLAY="$ROOT/packages/openclinxr/asset-registry/src/frozen-scene-replay.ts"
FREEZE="$ROOT/packages/openclinxr/asset-registry/src/scene-plan-freeze.ts"
SOLVE="$ROOT/packages/openclinxr/asset-registry/src/layout-solve.ts"
ADMIT="$ROOT/packages/openclinxr/asset-registry/src/encounter-bundle-admission.ts"
MAIN="$ROOT/apps/ui-xr/src/main.ts"
BOOT="$ROOT/apps/ui-xr/src/encounter-bundle-boot/index.ts"
CONTROL="$ROOT/tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.ts"

revert "instance asset digests are not compared" \
  "packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts" \
  "import pathlib;p=pathlib.Path('$EVID');s=p.read_text();s=s.replace('  for (const instance of record.instances) {','  for (const instance of [] as typeof record.instances) {',1);p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(e) changed/missing/corrupt GLB refusals"

revert "missing collapses into changed" \
  "packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts" \
  "import pathlib;p=pathlib.Path('$EVID');s=p.read_text();s=s.replace('kind: \"missing\",','kind: \"changed\",');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(e) the three refusal reasons are distinct"

revert "acknowledgment always binds" \
  "packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts" \
  "import pathlib;p=pathlib.Path('$EVID');s=p.read_text();s=s.replace('  return record.acknowledgment.acknowledgedPlanRevision === record.planRevision;','  return true;');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(f) stale_acknowledgment"

revert "a re-baseline may reuse its own revision" \
  "packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts" \
  "import pathlib;p=pathlib.Path('$EVID');s=p.read_text();s=s.replace('  if (observation.planRevision === record.planRevision) {','  if (false) {');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(g) repair requires fresh observation"

revert "the seed is not required to be a digest" \
  "packages/openclinxr/session-state/src/accepted-scene-plan.ts" \
  "import pathlib;p=pathlib.Path('$REC');s=p.read_text();s=s.replace('    if (!/^[0-9a-f]{64}\$/u.test(String(variation[\"seed\"]))) {','    if (false) {');p.write_text(s)" \
  "@openclinxr/session-state" "$BEHAVIOR_TEST" \
  "(j2) requireAcceptedScenePlan refuses a wall-clock seed"

revert "the solver is bypassed for a fixed side" \
  "packages/openclinxr/asset-registry/src/case-owned-scene-plan.ts" \
  "import pathlib;p=pathlib.Path('$PLAN');s=p.read_text();s=s.replace('    ...(input.intent === undefined ? {} : { intent: input.intent }),\n  });\n  if (!layout.resolved) {','    intent: { approachSide: \"patient_right\", standoffMeters: 0.75 },\n  });\n  if (!layout.resolved) {',1);p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(c) authorized indices produce both outcomes"

revert "the reopen does not re-solve, it echoes the record" \
  "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts" \
  "import pathlib;p=pathlib.Path('$REPLAY');s=p.read_text();s=s.replace('    seed: record.variation.seed,','    seed: \"0\".repeat(64),',1);p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(b) reproduced.seed equals the persisted seed"

revert "the frozen arrival is not graded against the rubric" \
  "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts" \
  "import pathlib;p=pathlib.Path('$REPLAY');s=p.read_text();s=s.replace('  const arrivalProblems = arrivalRubricProblems(record);','  const arrivalProblems: string[] = [];');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(j) an out-of-rubric arrival is refused"

revert "the freeze records an empty digest instead of reading bytes" \
  "packages/openclinxr/asset-registry/src/scene-plan-freeze.ts" \
  "import pathlib;p=pathlib.Path('$FREEZE');s=p.read_text();s=s.replace('      assetSha256: sha256Hex(bytes),','      assetSha256: \"\".padEnd(64, \"0\"),');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(a) every actor instance carries a real digest"

revert "the browser half reaches node:crypto" \
  "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts" \
  "import pathlib;p=pathlib.Path('$REPLAY');s=p.read_text();s='import { createHash } from \"node:crypto\";\n'+s;p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(i) the browser entry reaches no server-only builtin"

revert "the dialogue identity is not bound to the event order" \
  "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts" \
  "import pathlib;p=pathlib.Path('$REPLAY');s=p.read_text();s=s.replace('  const dialogueProblem = dialogueIdentityProblem(record);','  const dialogueProblem: string | null = null;');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(j) dialogue_identity_mismatch"

revert "the seeded solver accepts any string as a seed" \
  "packages/openclinxr/asset-registry/src/layout-solve.ts" \
  "import pathlib;p=pathlib.Path('$SOLVE');s=p.read_text();s=s.replace('  if (!LAYOUT_SEED_PATTERN.test(input.seed)) {','  if (false) {');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(k) resolveBedsideLayoutFromSeed throws on a non-digest seed"

revert "the pinned record type drifts from the durable one" \
  "packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts" \
  "import pathlib;p=pathlib.Path('$EVID');s=p.read_text();s=s.replace('  dialogueTurnIds: string[];\n};','  dialogueTurnIds: string[];\n  driftedField: string;\n};',1);p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(k0) the two record declarations correspond"

revert "the control freeze auto-initializes on import" \
  "tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.ts" \
  "import pathlib;p=pathlib.Path('$CONTROL');s=p.read_text();s=s.replace('export function produceSupineControlFreeze(input: {','export function produceSupineControlFreeze(input: {\n  // reverted: accept an unattributed production',1);s=s.replace('  if (input.reason.trim() === \"\") {','  if (false) {');s=s.replace('  if (input.observedBy.trim() === \"\") {','  if (false) {');p.write_text(s)" \
  "" "$FREEZE_TESTS" \
  "(6) production refuses an unattributed re-baseline"

revert "the layout reproduction comparison is disabled (the owner's own probe)" \
  "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts" \
  "import pathlib;p=pathlib.Path('$REPLAY');s=p.read_text();s=s.replace('  if (layoutProblems.length > 0) {','  if (layoutProblems.length > 99) {');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(l) the reproduction comparison is load-bearing"

revert "the re-solved approach side is not compared with the stored one" \
  "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts" \
  "import pathlib;p=pathlib.Path('$REPLAY');s=p.read_text();s=s.replace('  if (resolved.approachSide !== record.resolvedLayout.approachSide) {','  if (false) {');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(l) a stored approach side the re-solve does not produce"

revert "the re-solved target offset is not compared with the tolerance" \
  "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts" \
  "import pathlib;p=pathlib.Path('$REPLAY');s=p.read_text();s=s.replace('  if (targetOffsetMeters > LAYOUT_REPRODUCTION_TOLERANCE_METERS) {','  if (false) {');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(l) a stored target moved past the reproduction tolerance"

revert "an unsatisfiable authored intent is not reported as a conflict" \
  "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts" \
  "import pathlib;p=pathlib.Path('$REPLAY');s=p.read_text();s=s.replace('      reason: \"unsatisfiable_intent\",','      reason: \"layout_not_reproduced\",');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(l) unsatisfiable_intent"

revert "the shipped frame loop stops calling the reopen" \
  "apps/ui-xr/src/main.ts" \
  "import pathlib;p=pathlib.Path('$MAIN');s=p.read_text();s=s.replace('    frozenScenePlanAdmission = admitFrozenScenePlanForObservedScene({','    frozenScenePlanAdmission = ((x) => x)({');p.write_text(s)" \
  "" "$BEHAVIOR_TEST" \
  "(m) main.ts calls it in the frame loop"

revert "the boot path stops admitting the carried plan" \
  "apps/ui-xr/src/encounter-bundle-boot/index.ts" \
  "import pathlib;p=pathlib.Path('$BOOT');s=p.read_text();s=s.replace('admitFrozenScenePlan({ bundle })','({ status: \"no_plan_carried\" } as ScenePlanAdmission)');p.write_text(s)" \
  "" "$BEHAVIOR_TEST" \
  "(m) the boot path admits the carried plan"

revert "the admission stops calling the reopen" \
  "packages/openclinxr/asset-registry/src/encounter-bundle-admission.ts" \
  "import pathlib;p=pathlib.Path('$ADMIT');s=p.read_text();s=s.replace('reopenFrozenScene(input.record,','reopenFrozenSceneAliased(input.record,');s='import { reopenFrozenScene as reopenFrozenSceneAliased } from \"./frozen-scene-replay.js\";\n'+s;p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(m) the admission calls the reopen"

revert "a repair may predate the acceptance it replaces" \
  "packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts" \
  "import pathlib;p=pathlib.Path('$EVID');s=p.read_text();s=s.replace('  if (Number.isFinite(acceptedAt) && observedAt < acceptedAt) {','  if (false) {');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(n) a repair must postdate the acceptance"

revert "the freeze stops persisting the clip revision" \
  "packages/openclinxr/asset-registry/src/scene-plan-freeze.ts" \
  "import pathlib;p=pathlib.Path('$FREEZE');s=p.read_text();s=s.replace('      clipRevision: input.revisions.clipRevision,','      clipRevision: \"\",');p.write_text(s)" \
  "@openclinxr/asset-registry" "$BEHAVIOR_TEST" \
  "(a) the A09 count is counted off the record, not typed"

echo
echo "TWO-SIDED GATE: $BROKE of $TOTAL reverts break a named clause"
echo "finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$BROKE" -eq "$TOTAL" ]
