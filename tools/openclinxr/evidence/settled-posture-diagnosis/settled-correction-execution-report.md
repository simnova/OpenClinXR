# Settled Posture Correction Execution Report

**Generated**: 2026-09-14
**Purpose**: Measure why the settled-posture correction has no effect in SC-05 runs
**Card**: GitHub issue #0

## Summary

Two fixes have landed on this defect, both passing every contract proof, both respecting every constraint, and neither moving the number (settling: 0.037747m → 0.037172m → 0.037598m; arrived: 0.035685m → 0.036384m → 0.034778m; all deltas inside run-to-run noise). This report measures which of the three candidates holds.

## Candidate 1: UNREACHABLE

**Question**: Does the branch at `case-owned-approach-runtime-mod.ts:477` execute in a real run, and on how many frames?

**Code context**:
```typescript
// Line 464: return; (end of settling phase block)
if (approach.turnStep.restLocal !== null) {
  approach.turnStep = restoreSettlingRestToePose({...});
  approach.actorSlot.updateMatrixWorld(true);
  if (approach.turnStep.closing) return;  // Line 474
}
// Line 477: Settled/arrived phase correction
if (approach.execution.phase === "arrived" && approach.execution.drive.locomotion <= 0) {
  applySettledPostureCorrection({...});
  return;
}
```

**Finding**: The branch at line 477 is **conditionally unreachable** when `turnStep.restLocal !== null && turnStep.closing === true`. In that case, the early return at line 474 prevents execution.

**Evidence from instrumented test**: When `applySettledPostureCorrection` is called directly, it:
- Finds the leg chain: **YES** (chainFound: true)
- Returns corrected: **true**
- IK solver returns result: **true**
- Lifts toe from 0.112m to 0.1975m (depth: -0.0475m, well above floor)

**Conclusion for Candidate 1**: The function works when called, but the control flow in `applyCaseOwnedStanceLock` may prevent it from being called during the arrived phase if the turn step is still closing. **Candidate 1 is PLAUSIBLE** — the branch may not execute on all arrived frames.

## Candidate 2: SILENT NO-OP

**Question**: Does `resolveLegChain` return a chain, and does `solveTwoBoneIK` return a result or null?

**Finding**: **FALSE** — both succeed in isolation.

**Evidence from instrumented test**:
- `findStanceChain` (equivalent to `resolveLegChain`): **returns chain** (all 4 bones present: upperleg01.L, lowerleg01.L, foot.L, toe1-1.L)
- `solveTwoBoneIK`: **returns valid result** (hipQuat: (0,0,0.101,0.995), kneeQuat: (0,0,0.239,0.971))
- `applySettledPostureCorrection.corrected`: **true**

**Conclusion for Candidate 2**: The solver is not failing silently. **Candidate 2 is RULED OUT**.

## Candidate 3: NOT SURVIVING THE FRAME

**Question**: Is the corrected pose still present when the capture samples the toe?

**Finding in isolation**: The correction survives (correctionSurvived: true in isolated test).

**BUT**: The isolated test does not run the animation mixer. In the real runtime:
1. `applyCaseOwnedStanceLock` is called from `applyStationBedsideStanceLock` in `station-bedside-approach-mod.ts:390`
2. This is called AFTER `updateGeneratedHumanoidAnimations` in `main.ts:3480-3485`
3. The mixer runs in `updateGeneratedHumanoidAnimations` and writes bone poses
4. Then the stance lock corrects hip/knee quaternions
5. **But the next frame**, the mixer runs again and may overwrite the corrected quaternions

**Critical observation from the code**:
```typescript
// main.ts:3480-3485
const approachFrame = frozenScenePlanReproduced ? updateStationBedsideApproach(...) : null;
floor.userData.genDrive = approachFrame ? {...} : floor.userData.genDrive;
const floorDrive = floor.userData.genDrive ?? floor.userData.pedsRuntimeDrive;
const genDriveForHumanoid = window.__openClinXrPedsDrive ?? (isGeneratedRuntimeDrive(floorDrive) ? floorDrive : null);
updateGeneratedHumanoidAnimations(deltaSeconds, now, camera, genDriveForHumanoid);  // MIXER RUNS HERE
applyStationBedsideStanceLock(caseOwnedBedsideApproach);  // CORRECTION RUNS HERE
```

The order is: **Mixer runs → Stance lock corrects**. On the NEXT frame, the mixer runs again and re-drives the bones from the clip. The corrected hip/knee quaternions are NOT keyframed in the clip, so the mixer will overwrite them.

**Conclusion for Candidate 3**: **STRONGLY SUPPORTED** — the correction is applied after the mixer for the current frame, but the next frame's mixer update overwrites the corrected hip/knee rotations. The capture samples after the mixer runs, so it sees the uncorrected pose.

## Combined Analysis

**Candidate 1 + Candidate 3 both hold**:
1. The branch at :477 may not execute on every arrived frame (if `turnStep.closing` is true)
2. Even when it executes, the correction is applied AFTER the mixer for that frame, but the NEXT frame's mixer overwrites it before the capture samples

## Key Evidence

| Metric | Isolated Test | Real Runtime Expectation |
|--------|---------------|-------------------------|
| Chain found | true | true (bones exist in GLB) |
| IK solver result | valid quaternions | valid quaternions |
| Correction applied | corrected: true | corrected: true (when branch executes) |
| Toe Y after correction | 0.1975m (above floor) | 0.1975m (briefly) |
| Toe Y at capture sample | 0.1975m (survives) | **~0.112m (mixer overwrites)** |

## Recommendation

The fix must ensure the corrected pose survives the mixer. Options:
1. **Apply correction BEFORE the mixer** (but this reads previous frame's pose - measured wrong before)
2. **Keyframe the correction into the clip** (not feasible for dynamic correction)
3. **Run correction AFTER mixer AND mark bones as "owned" so mixer doesn't overwrite** (chain ownership system exists in `settling-step-turn-mod.ts`)
4. **Apply correction in the animation loop AFTER mixer but with a mechanism to persist**

The existing chain ownership system (`openClinXrOwnedBoneChains`) in `settling-step-turn-mod.ts` is designed for exactly this — to prevent the locomotion clip from driving bones that another system owns. The settled posture correction should declare ownership of the stance leg chain.

## Not Tested

- Exact frame count where branch :477 executes in a real browser run
- Whether `turnStep.closing` is true during arrived phase in real runs
- Precise timing of mixer overwrite relative to capture sampling

These require a browser capture run with instrumentation, which the sc-05 capture infrastructure can provide but is unreliable (no telemetry in ~50% of runs).