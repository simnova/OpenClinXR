import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { solveArmChain, type ChainJoint } from "../../../packages/openclinxr/motion-compiler/src/ik/solve-chain.js";

/**
 * OBSERVABLE: on the rig that actually ships, the IK solver bends the forearm at its TWIST segment
 * and treats the elbow as the shoulder.
 *
 * `solveArmChain` picks its three joints by walking exactly two parent hops from the effector
 * (`solve-chain.ts:204-208`): wrist = effector, elbow = wrist.parent, shoulder = elbow.parent. That is
 * correct on the Anny rail and wrong on MPFB, because the two rails do not have the same arm.
 *
 * MEASURED 2026-09-03 by parsing the shipped GLBs' glTF JSON chunks directly:
 *
 *   Anny  (23 joints, ed_chest_pain_adult_cast.glb)
 *     clavicle.L -> upper_arm.L -> forearm.L -> hand.L                       3 links, one elbow
 *   MPFB2 (137 joints, mpfb-clinical-nurse-adult.glb)
 *     clavicle.L -> shoulder01.L -> upperarm01.L -> upperarm02.L
 *                -> lowerarm01.L -> lowerarm02.L -> wrist.L                  6 links, two of them twist
 *
 * So on MPFB the two-hop walk from `wrist.L` names `lowerarm02.L` the ELBOW — a twist segment — and
 * `lowerarm01.L`, the real elbow, the SHOULDER. `ELBOW_BEND_LIMIT_RAD = 2.7` (155 deg) is then applied
 * to a bone that twists rather than flexes, and the true shoulder is never driven at all.
 *
 * ## WHY THE EXISTING THREE-RIG CONTRACT DID NOT CATCH THIS
 *
 * `the-guard-primitive-hits-four-targets-on-three-rigs.test.ts` is 7 passed and its `MPFB2_137_JOINT`
 * is a six-bone literal:
 *
 *     armProfile("mpfb2_137_joint",
 *       { shoulder: "upperarm01R", elbow: "lowerarm01R", wrist: "wristR", ... })
 *
 * It hand-wires wrist.parent = lowerarm01R, deleting exactly the two twist bones that break the walk,
 * and its bone names carry no dot separator while the shipped rig uses `wrist.L` / `lowerarm01.L`.
 * The fixture does not exhibit the defect, so the contract is green about a topology no asset has.
 * That test's own header already concedes the point — "three CONSTRUCTED rigs". This file is the
 * counterweight it needed: its profiles come from the shipped bytes and cannot be hand-shaped.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block below. Do not
 * rewrite the measured tables or paths.
 *
 * claimScope: which three bones `solveArmChain` selects when handed the real topology of each shipped
 *   rail, read from the GLB rather than from a literal.
 * notEvidenceFor: that the resulting pose looks right — no pixels are graded here; the bend LIMIT
 *   values, which are a separate question from which bone they are applied to; three.js CCDIKSolver,
 *   which this repo's runtime does not yet use; anything about the leg chain.
 */

/**
 * ## FIXED (#0)
 *
 * `solveArmChain` now selects its chain by walking parent links and SKIPPING MakeHuman/MPFB `*02`
 * twist helpers (`solve-chain.ts`: `flexingParent`, `MPFB_TWIST_HELPER`). On the shipped MPFB arm
 * the walk from `wrist.L` now names:
 *
 *   wrist    = wrist.L        (effector, unchanged)
 *   elbow    = lowerarm01.L   (was lowerarm02.L — the twist segment; it twists, it does not flex)
 *   shoulder = upperarm01.L   (was lowerarm01.L — the real elbow, which was never driven at all)
 *
 * `upperarm02.L` sits between the shoulder and elbow slots and is skipped by the same walk. The Anny
 * rail carries no `*02` bones, so `flexingParent` returns the direct parent there and clause (3) —
 * hand.L -> forearm.L -> upper_arm.L — is untouched. Clauses (1) and (2) `it.fails` markers were
 * flipped to `it`.
 *
 * Measured on the shipped bytes through this file's own `jointsFromGlb` (no literals):
 *
 *   solveOn(mpfb-clinical-nurse-adult.glb, "wrist.L")
 *     -> shoulderBone "upperarm01.L", elbowBone "lowerarm01.L", wristBone "wrist.L"
 *   solveOn(ed_chest_pain_adult_cast.glb, "hand.L")
 *     -> shoulderBone "upper_arm.L", elbowBone "forearm.L", wristBone "hand.L"
 *
 * notEvidenceFor (this card): pose correctness. The analytic two-bone solve still models the arm as
 * one adjacent shoulder->elbow->wrist triple, so on a six-link chain the emitted rotations are not
 * pixel-graded here; the CCDIK runtime-goal arm card (tsk_6744647da1454e53) owns full-chain reach.
 * `shoulder01.L` above `upperarm01.L` is left undriven — widening the output triple is a separate
 * contract change, not this card's.
 */

const ROOT = join(import.meta.dirname, "../../..");
const ANNY = join(ROOT, "apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.glb");
const MPFB = join(ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");

/** Read a shipped GLB's node graph into the solver's own ChainJoint shape. No literals. */
function jointsFromGlb(path: string): ChainJoint[] {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLength = b.readUInt32LE(12);
  const gltf = JSON.parse(b.subarray(20, 20 + jsonLength).toString("utf8")) as {
    nodes?: { name?: string; children?: number[]; translation?: number[]; rotation?: number[] }[];
  };
  const nodes = gltf.nodes ?? [];
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
  return nodes.map((n, i) => {
    const t = n.translation ?? [0, 0, 0];
    const r = n.rotation ?? [0, 0, 0, 1];
    const p = parentOf.get(i);
    const parentName = p === undefined ? undefined : nodes[p]?.name;
    return {
      boneName: n.name ?? `#${i}`,
      ...(parentName === undefined ? {} : { parentBoneName: parentName }),
      bindLocalPosition: { x: t[0] ?? 0, y: t[1] ?? 0, z: t[2] ?? 0 },
      bindLocalQuaternion: { x: r[0] ?? 0, y: r[1] ?? 0, z: r[2] ?? 0, w: r[3] ?? 1 },
    };
  });
}

/** MakeHuman/MPFB names its twist segments `*02`; these flex nowhere and must never be the elbow. */
const TWIST = /(?:upperarm|lowerarm|upperleg|lowerleg)02\./u;
/** An upper-arm bone on either rail. The SHOULDER slot must be one of these, never a forearm. */
const UPPER_ARM = /(?:^upper_arm\.|^upperarm0|^shoulder0)/u;

const solveOn = (path: string, effector: string) =>
  solveArmChain({ joints: jointsFromGlb(path), effectorBone: effector, target: { x: 0.15, y: 1.1, z: 0.12 } });

describe("the arm chain is the real rig's arm chain", () => {
  it("(1) on the shipped MPFB rig the elbow slot is not a twist segment", () => {
    const solved = solveOn(MPFB, "wrist.L");
    expect(solved.elbowBone, `the solver called ${solved.elbowBone} the elbow; MakeHuman *02 bones twist, they do not flex`)
      .not.toMatch(TWIST);
  });

  it("(2) on the shipped MPFB rig the shoulder slot is an upper-arm bone", () => {
    // Naming alone is cheap to satisfy by relabelling, so this asserts the SECOND slot too: a chain
    // whose 'shoulder' is a forearm bone drives the whole reach from the wrong side of the elbow.
    const solved = solveOn(MPFB, "wrist.L");
    expect(solved.shoulderBone, `the solver called ${solved.shoulderBone} the shoulder — that is a forearm bone`)
      .toMatch(UPPER_ARM);
    expect(solved.elbowBone, "the elbow and shoulder collapsed onto the same bone").not.toBe(solved.shoulderBone);
  });

  it("(3) INVERTED GUARD: the Anny rail still resolves hand -> forearm -> upper_arm", () => {
    // This card ADDS the MPFB topology; it does not re-parameterise the rail that works. If this ever
    // fails, restore the two-hop walk for a 3-link arm rather than widening or deleting this clause —
    // the Anny rail's chain is hand.L -> forearm.L -> upper_arm.L and that is already correct.
    const solved = solveOn(ANNY, "hand.L");
    expect(solved.wristBone).toBe("hand.L");
    expect(solved.elbowBone).toBe("forearm.L");
    expect(solved.shoulderBone).toBe("upper_arm.L");
  });

  it("(0) VACUITY GUARD: both fixtures are the real rigs, not stubs", () => {
    // Without this, clauses (1) and (2) would pass identically against an empty or truncated file.
    const anny = jointsFromGlb(ANNY);
    const mpfb = jointsFromGlb(MPFB);
    expect(anny.length, "the Anny GLB parsed to too few nodes to be a rig").toBeGreaterThan(20);
    expect(mpfb.length, "the MPFB GLB parsed to too few nodes to be a 137-joint rig").toBeGreaterThan(130);
    // The topology this card is about must actually be present in the bytes.
    const byName = new Map(mpfb.map((j) => [j.boneName, j]));
    expect(byName.get("wrist.L")?.parentBoneName, "the shipped MPFB wrist's parent is the measured twist bone")
      .toBe("lowerarm02.L");
  });
});
