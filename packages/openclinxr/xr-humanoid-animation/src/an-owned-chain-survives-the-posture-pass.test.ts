import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { applyGeneratedHumanoidClinicalIdlePosture } from "@openclinxr/xr-pose";

// A planted RED reads a dynamically imported module whose shape is exactly what the slice
// must define. Narrowing it here would encode the answer the card is supposed to produce.
// biome-ignore lint/suspicious/noExplicitAny: see the two lines above
type Loose = any;

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
  it("(1) ASYMMETRY: an OWNED bone is unchanged across the posture pass while a neighbouring UNOWNED bone is still written", async () => {
    // The contracted symbols are read at runtime so this file loads before they exist.
    const mod = await import("@openclinxr/xr-pose");
    const boneIsOwned = (mod as Record<string, unknown>)["boneIsOwned"] as Loose;
    expect(typeof boneIsOwned).toBe("function");

    const humanoid = buildTestHumanoid();

    // Ownership is DECLARED. The left arm is owned; the right arm is the unowned neighbour.
    const ownedChains: Array<{ ownerId: string; boneNames: readonly string[] }> = [
      { ownerId: "test_executor_left", boneNames: ["upper_armL", "forearmL", "handL"] as const },
    ];
    for (const name of ["upper_armL", "forearmL", "handL"]) {
      expect(boneIsOwned(ownedChains, name)).toBe(true);
    }
    for (const name of ["upper_armR", "forearmR", "handR"]) {
      expect(boneIsOwned(ownedChains, name)).toBe(false);
    }
    humanoid.userData["openClinXrOwnedBoneChains"] = ownedChains;

    const upperArmL = humanoid.getObjectByName("upper_armL")!;
    const forearmL = humanoid.getObjectByName("forearmL")!;
    const handL = humanoid.getObjectByName("handL")!;
    const upperArmR = humanoid.getObjectByName("upper_armR")!;
    const forearmR = humanoid.getObjectByName("forearmR")!;
    const handR = humanoid.getObjectByName("handR")!;

    // Capture BOTH arms BEFORE the pass. The first draft compared the right arm with a clone of
    // ITSELF taken after the pass — always equal, so the assertion was UNFALSIFIABLE and would
    // have failed identically after a perfect fix. The two-sided gate cannot see that: a clause
    // that can never pass still satisfies "fails now" and "the file passes as it.fails".
    const beforeL = [upperArmL, forearmL, handL].map((b) => b.rotation.clone());
    const beforeR = [upperArmR, forearmR, handR].map((b) => b.rotation.clone());

    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    const ownedUnchanged = [upperArmL, forearmL, handL].every(
      (bone, i) => bone.rotation.equals(beforeL[i]!),
    );
    const unownedWritten = [upperArmR, forearmR, handR].some(
      (bone, i) => !bone.rotation.equals(beforeR[i]!),
    );

    expect(ownedUnchanged, "an OWNED bone was overwritten by the posture pass").toBe(true);
    expect(unownedWritten, "no UNOWNED bone was written; the carve-out froze the whole skeleton").toBe(true);
  });

  it("(2) Ownership is DECLARED, not inferred from a name pattern", async () => {
    const mod = await import("@openclinxr/xr-pose");
    const boneIsOwned = (mod as Record<string, unknown>)["boneIsOwned"] as Loose;

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

  it("(3) CHAIN INTEGRITY is the acceptance measure, not effector residual: every bone the executor wrote keeps its value across a posture pass", async () => {
    // The recorded bake-off returned verdict "other" with a wristR residual of 0.0000 m for a
    // chain that rendered the right arm ABSENT through a torn shoulder
    // (tools/openclinxr/evidence/motion-backend-bakeoff/report.json:67). Effector residual is
    // disqualified here by measurement. This clause asserts JOINT STATE for every bone in the
    // chain instead, which a torn chain cannot satisfy.
    const mod = await import("@openclinxr/xr-pose");
    const boneIsOwned = (mod as Record<string, unknown>)["boneIsOwned"] as Loose;
    expect(typeof boneIsOwned).toBe("function");

    const humanoid = buildTestHumanoid();
    const ownedChains: Array<{ ownerId: string; boneNames: readonly string[] }> = [
      { ownerId: "ik_solver_left", boneNames: ["upper_armL", "forearmL", "handL"] as const },
    ];
    for (const name of ["upper_armL", "forearmL", "handL"]) {
      expect(boneIsOwned(ownedChains, name)).toBe(true);
    }
    humanoid.userData["openClinXrOwnedBoneChains"] = ownedChains;

    const chain = ["upper_armL", "forearmL", "handL"].map((n) => humanoid.getObjectByName(n)!);
    // An executor writes its own pose onto the whole owned chain.
    chain[0]!.rotation.set(0.5, 0.1, -0.3);
    chain[1]!.rotation.set(-0.2, 0.0, 0.1);
    chain[2]!.rotation.set(0.05, -0.05, 0.02);
    const executorPose = chain.map((b) => b.rotation.clone());

    applyGeneratedHumanoidClinicalIdlePosture(humanoid);

    // EVERY bone, not just the effector. A carve-out that preserves only the hand leaves a torn
    // shoulder and still reports a perfect wrist position, which is exactly the bake-off failure.
    for (const [i, bone] of chain.entries()) {
      expect(
        bone.rotation.equals(executorPose[i]!),
        `owned bone ${["upper_armL", "forearmL", "handL"][i]} was overwritten by the posture pass`,
      ).toBe(true);
    }
  });
});