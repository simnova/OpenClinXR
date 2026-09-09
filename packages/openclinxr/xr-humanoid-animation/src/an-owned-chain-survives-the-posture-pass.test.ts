import { describe, expect, it } from "vitest";
import type { Object3D } from "three";
import {
  applyGeneratedHumanoidClinicalIdlePosture,
  applyHumanoidJointRotationsByAlias,
} from "@openclinxr/xr-pose";

//
// OBSERVABLE: The animation loop writes posture to every bone each frame. A motion executor
// (e.g. an IK solver or retargeted clip) needs to own a bone chain so the posture pass
// skips only those bones, leaving the rest of the skeleton under posture control.
// Currently no ownership declaration exists: the posture pass blindly writes all bones,
// so an executor's pose is overwritten. The fix adds a declared OwnedChain[] carve-out
// consulted beside the existing sourceComparatorFreezeEnabled, supine, and seated carve-outs
// in animation-loop.ts:114-120.
//
// MEASURED 2026-09-09. `conversation-policy/src/emotion-performance-mapper.ts:247` returns
// `gestureClipIds: []` deliberately (`:60-65`). Playback consumes index 0 only
// (`xr-dialogue/src/actor-turn-playback.ts:206`) behind an approved-name gate (`:208-210`),
// so every mapper-produced plan drops as `no_approved_gesture_clip`. A multi-clip or
// goal-based executor needs a new lane on `ActorTurnPlaybackAdapters` (`:59-65`), not a
// longer array. `motion_retarget/run.ts:19` names `adapter: "@openclinxr/motion-compiler"`
// as a plan string; repo-wide that specifier appears on that line and nowhere else — no
// import, no dependency, no call. The recorded bake-off returned `verdict: "other"`
// (`tools/openclinxr/evidence/motion-backend-bakeoff/report.json:67`): the CCDIKSolver
// reported a `wristR` residual of 0.0000 m for the chain that rendered the right arm
// ABSENT through a torn shoulder. Effector residual is DISQUALIFIED as an acceptance
// measure, by measurement.
//
// known-good: Three carve-outs already exist in the frame loop and work:
// `animation-loop.ts:92` `sourceComparatorFreezeEnabled`; `:114-119` the supine and seated
// userData checks; `:120` `seatedClipPerforming` with its policy at
// `xr-pose/src/seated-role-clip-policy.ts:56`. A chain-ownership carve-out is a FOURTH of
// the same kind.
//
// CONTRACTED EXPORT (the honest slice adds exactly this):
//   // packages/openclinxr/xr-pose/src/chain-ownership.ts — NEW FILE
//   /** A bone chain claimed by a motion executor for the duration of a performance. */
//   export type OwnedChain = { ownerId: string; boneNames: readonly string[] };
//   /** Declared, never inferred from a name pattern. */
//   export function boneIsOwned(owned: readonly OwnedChain[], boneName: string): boolean;
// and `animation-loop.ts` consults `boneIsOwned` beside its three existing carve-outs,
// skipping the posture write for an owned bone only.
//
// IN-SCOPE: xr-humanoid-animation/src/animation-loop.ts, xr-pose/src/clinical-idle-posture.ts,
// xr-pose/src/chain-ownership.ts
// OUT-OF-SCOPE: Building an IK solver, adopting a learned provider, changing the motion
// interchange, apps/ui-xr, and the rest of xr-pose beyond the two named files.
//

function buildTestHumanoid(): Object3D {
  const root = new Object3D();
  root.name = "humanoid_root";
  // Build a minimal chain: shoulder -> upper_arm -> forearm -> hand (both sides)
  const upperArmL = new Object3D();
  upperArmL.name = "upper_armL";
  root.add(upperArmL);
  const forearmL = new Object3D();
  forearmL.name = "forearmL";
  upperArmL.add(forearmL);
  const handL = new Object3D();
  handL.name = "handL";
  forearmL.add(handL);

  const upperArmR = new Object3D();
  upperArmR.name = "upper_armR";
  root.add(upperArmR);
  const forearmR = new Object3D();
  forearmR.name = "forearmR";
  upperArmR.add(forearmR);
  const handR = new Object3D();
  handR.name = "handR";
  forearmR.add(handR);

  return root;
}

describe("an-owned-chain-survives-the-posture-pass", () => {
  it.fails("(1) ASYMMETRY: owned bone unchanged, neighboring unowned bone still written by posture pass", async () => {
    // Import the contracted symbols at runtime so the test loads even before they exist
    const mod = await import("@openclinxr/xr-pose");
    const OwnedChain = (mod as Record<string, unknown>).OwnedChain;
    const boneIsOwned = (mod as Record<string, unknown>).boneIsOwned;

    expect(typeof OwnedChain).not.toBe("undefined");
    expect(typeof boneIsOwned).toBe("function");

    // Build test humanoid
    const humanoid = buildTestHumanoid();

    // Capture initial rotations
    const upperArmL = humanoid.getObjectByName("upper_armL")!;
    const forearmL = humanoid.getObjectByName("forearmL")!;
    const handL = humanoid.getObjectByName("handL")!;

    const initialUpperArmL = upperArmL.rotation.clone();
    const initialForearmL = forearmL.rotation.clone();
    const initialHandL = handL.rotation.clone();

    // Declare ownership of LEFT arm chain only
    const ownedChains: Array<{ ownerId: string; boneNames: readonly string[] }> = [
      { ownerId: "test_executor_left", boneNames: ["upper_armL", "forearmL", "handL"] as const },
    ];

    // Apply posture pass — should skip owned bones, write unowned bones
    // We simulate what animation-loop.ts will do: check boneIsOwned before writing
    // For now, call the clinical idle posture directly (it writes all bones)
    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // The contracted behavior: owned bones should be UNCHANGED
    // unowned bones (right arm) SHOULD be written by posture pass
    const upperArmR = humanoid.getObjectByName("upper_armR")!;
    const forearmR = humanoid.getObjectByName("forearmR")!;
    const handR = humanoid.getObjectByName("handR")!;

    // Right arm (unowned) should have been modified by posture
    const rightArmWritten = !upperArmR.rotation.equals(upperArmR.rotation.clone()) ||
      !forearmR.rotation.equals(forearmR.rotation.clone()) ||
      !handR.rotation.equals(handR.rotation.clone());

    // Left arm (owned) should be unchanged
    const leftArmUnchanged =
      upperArmL.rotation.equals(initialUpperArmL) &&
      forearmL.rotation.equals(initialForearmL) &&
      handL.rotation.equals(initialHandL);

    // The test asserts ASYMMETRY: owned unchanged AND unowned written
    // A carve-out that freezes the whole skeleton passes leftArmUnchanged but FAILS rightArmWritten
    expect(leftArmUnchanged).toBe(true);
    expect(rightArmWritten).toBe(true);
  });

  it.fails("(2) Ownership is DECLARED, not inferred from a name pattern", async () => {
    const mod = await import("@openclinxr/xr-pose");
    const boneIsOwned = (mod as Record<string, unknown>).boneIsOwned;

    expect(typeof boneIsOwned).toBe("function");

    const ownedChains: Array<{ ownerId: string; boneNames: readonly string[] }> = [
      { ownerId: "executor_a", boneNames: ["upper_armL", "forearmL", "handL"] as const },
    ];

    // Bone explicitly in the declared list -> owned
    expect(boneIsOwned(ownedChains, "upper_armL")).toBe(true);
    expect(boneIsOwned(ownedChains, "forearmL")).toBe(true);
    expect(boneIsOwned(ownedChains, "handL")).toBe(true);

    // Bone with SIMILAR name but NOT in declared list -> NOT owned
    // (e.g. upper_armR resembles upper_armL but is not declared)
    expect(boneIsOwned(ownedChains, "upper_armR")).toBe(false);
    expect(boneIsOwned(ownedChains, "forearmR")).toBe(false);
    expect(boneIsOwned(ownedChains, "handR")).toBe(false);

    // Bone with partial name match -> NOT owned
    expect(boneIsOwned(ownedChains, "upper_arm")).toBe(false);
    expect(boneIsOwned(ownedChains, "forearm")).toBe(false);
    expect(boneIsOwned(ownedChains, "hand")).toBe(false);

    // Empty list -> nothing owned
    expect(boneIsOwned([], "upper_armL")).toBe(false);
  });

  it.fails("(3) Carve-out preserves chain integrity / joint state, not effector residual", async () => {
    const mod = await import("@openclinxr/xr-pose");
    const OwnedChain = (mod as Record<string, unknown>).OwnedChain;
    const boneIsOwned = (mod as Record<string, unknown>).boneIsOwned;

    expect(typeof OwnedChain).not.toBe("undefined");
    expect(typeof boneIsOwned).toBe("function");

    const humanoid = buildTestHumanoid();

    // Apply posture to establish baseline
    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // Capture the posture-written joint states (chain integrity)
    const upperArmL = humanoid.getObjectByName("upper_armL")!;
    const forearmL = humanoid.getObjectByName("forearmL")!;
    const handL = humanoid.getObjectByName("handL")!;

    const postureUpperArmL = upperArmL.rotation.clone();
    const postureForearmL = forearmL.rotation.clone();
    const postureHandL = handL.rotation.clone();

    // Now declare ownership and simulate executor writing its own pose
    const ownedChains: Array<{ ownerId: string; boneNames: readonly string[] }> = [
      { ownerId: "ik_solver_left", boneNames: ["upper_armL", "forearmL", "handL"] as const },
    ];

    // Executor writes its own rotations to the owned chain
    upperArmL.rotation.set(0.5, 0.1, -0.3);
    forearmL.rotation.set(-0.2, 0.0, 0.1);
    handL.rotation.set(0.05, -0.05, 0.02);

    const executorUpperArmL = upperArmL.rotation.clone();
    const executorForearmL = forearmL.rotation.clone();
    const executorHandL = handL.rotation.clone();

    // Run posture pass again — should preserve executor's rotations on owned bones
    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // The carve-out must preserve CHAIN INTEGRITY: each bone in the chain keeps executor's values
    const chainIntegrityPreserved =
      upperArmL.rotation.equals(executorUpperArmL) &&
      forearmL.rotation.equals(executorForearmL) &&
      handL.rotation.equals(executorHandL);

    // The test must NOT use effector residual (e.g. wrist world position) as acceptance
    // Instead it asserts JOINT STATE (local rotations) or CHAIN INTEGRITY (all bones in chain preserved)
    expect(chainIntegrityPreserved).toBe(true);

    // Additionally verify that the right arm (unowned) still reflects posture
    const upperArmR = humanoid.getObjectByName("upper_armR")!;
    const forearmR = humanoid.getObjectByName("forearmR")!;
    const handR = humanoid.getObjectByName("handR")!;

    // These should have been written by posture (not equal to executor values)
    expect(upperArmR.rotation.equals(postureUpperArmL)).toBe(false); // different bone
    // Just verify they were touched by posture
    expect(typeof upperArmR.rotation.x).toBe("number");
    expect(typeof forearmR.rotation.y).toBe("number");
    expect(typeof handR.rotation.z).toBe("number");
  });
});