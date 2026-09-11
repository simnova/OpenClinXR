import {
  DEFAULT_PATIENT_CHAIR_POSITION,
  DEFAULT_STRETCHER_POSITION,
} from "@openclinxr/asset-registry/actor-posture";
import { createEdChestPainRuntimeSceneManifest } from "@openclinxr/asset-registry/runtime-bundles";
import {
  applyCleanEncounterVisualReviewActorFraming,
  type EncounterActorFramingInput,
} from "@openclinxr/xr-scene";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

// OBSERVABLE: the last link of the placement chain REPLACES the resolved position instead of
// composing it. apps/ui-xr/src/main.ts:843-848 reads
//     const position = hasVector3(placement?.position) ? placement.position : fallback.position;
//     ...
//     position: seated
//       ? (familyChairWorldPosition ?? seatedActorWorldPosition({}))
//       : supine ? supineActorWorldPosition({}) : position,
// so `position` — the authored or bundle value — is used ONLY on the standing branch. For
// `seated` and `supine`, precisely the two supportSurface values that are not "none", it is
// discarded and a fixture anchor is substituted. Every upstream card in this chain changes
// nothing a learner can see until this composes.
//
// MEASURED 2026-09-09, and this clause list was written by trying to test it:
// the decision lives in a LOCAL function inside main.ts, a 4,800-line entry script that no test
// in apps/ui-xr imports. Every existing ui-xr test drives PACKAGE seams (@openclinxr/xr-scene,
// @openclinxr/xr-station, @openclinxr/asset-registry) and builds real three objects. The only
// honest way to assert this behaviour is to EXTRACT the composition into a package, which is
// also what agents/rules and the-apps-are-composition-roots.test.ts already require of an app:
// main.ts should wire, not decide.
//
// known-good: the standing branch already composes correctly — it passes the resolved `position`
// straight through. Standing is the known-good column, and clause (5) is written as a plain it(
// because it must be green both before and after this slice.
//
// Diagnosis header IMMUTABLE. Flip it.fails -> it and append a ## FIXED block below. Do not
// rewrite the measured anchors. A refusal still flips: a clause asserts the report, not the
// outcome.
//
// CONTRACTED EXPORT (the honest slice adds exactly this to
// packages/openclinxr/asset-registry/src/actor-posture.ts, which is already re-exported from
// that package's entrypoint at index.ts:3):
//
//   export type SupportedActorPositionRefusal = { refused: true; reason: string };
//   /**
//    * Compose an authored plant offset onto a fixture anchor for a SUPPORTED posture.
//    * Frame, from the brief: right-handed, world metres, x/z TANGENT to the contact plane,
//    * y its NORMAL. x and z add to the anchor. A nonzero y on a supported posture is REFUSED
//    * rather than clamped — "a nonzero normal offset fails this supported-patient control".
//    * The offset is already in world metres and must NOT be multiplied by the mounted asset's
//    * scale a second time.
//    */
//   export function composeSupportedActorWorldPosition(input: {
//     posture: "standing" | "seated" | "supine";
//     fixtureAnchor: { x: number; y: number; z: number };
//     authoredOffsetMeters?: { x: number; y: number; z: number };
//     resolvedPosition: { x: number; y: number; z: number };
//   }): { x: number; y: number; z: number } | SupportedActorPositionRefusal;
//
// and main.ts:846-848 calls it instead of substituting the anchor.
//
// IN-SCOPE: asset-registry/src/actor-posture.ts, apps/ui-xr/src/main.ts,
// xr-station-room/src/actor-staging.ts, and this file.
// OUT-OF-SCOPE: the factory, the compile node, the admin control, motion.

const CLINIC_PATIENT_OFFSET = { x: 0.4, y: 0, z: 0 } as const; // clinic-knee-pain.ts:53
const CLINIC_FAMILY_OFFSET = { x: -0.55, y: 0, z: 0.2 } as const; // clinic-knee-pain.ts:76

async function compose() {
  const mod = (await import("@openclinxr/asset-registry/actor-posture")) as Record<string, unknown>;
  return mod.composeSupportedActorWorldPosition as
    | undefined
    | ((input: {
        posture: string;
        fixtureAnchor: { x: number; y: number; z: number };
        authoredOffsetMeters?: { x: number; y: number; z: number };
        resolvedPosition: { x: number; y: number; z: number };
      }) => { x: number; y: number; z: number } | { refused: true; reason: string });
}

describe("the authored offset reaches the posed humanoid", () => {
  it("(1) composeSupportedActorWorldPosition is exported from the actor-posture subpath", async () => {
    expect(typeof (await compose())).toBe("function");
  });

  it("(2) SEATED composes the authored tangential offset onto the chair anchor rather than replacing it", async () => {
    const fn = await compose();
    expect(typeof fn).toBe("function");
    const out = fn!({
      posture: "seated",
      fixtureAnchor: DEFAULT_PATIENT_CHAIR_POSITION,
      authoredOffsetMeters: CLINIC_FAMILY_OFFSET,
      resolvedPosition: DEFAULT_PATIENT_CHAIR_POSITION,
    });
    expect("refused" in out).toBe(false);
    const p = out as { x: number; y: number; z: number };
    expect(p.x).toBeCloseTo(DEFAULT_PATIENT_CHAIR_POSITION.x + CLINIC_FAMILY_OFFSET.x, 6);
    expect(p.z).toBeCloseTo(DEFAULT_PATIENT_CHAIR_POSITION.z + CLINIC_FAMILY_OFFSET.z, 6);
    // and it is NOT the bare anchor, which is what main.ts substitutes today
    expect(p.x).not.toBeCloseTo(DEFAULT_PATIENT_CHAIR_POSITION.x, 6);
  });

  it("(3) SUPINE composes onto the stretcher deck anchor rather than replacing it", async () => {
    const fn = await compose();
    expect(typeof fn).toBe("function");
    const out = fn!({
      posture: "supine",
      fixtureAnchor: DEFAULT_STRETCHER_POSITION,
      authoredOffsetMeters: CLINIC_PATIENT_OFFSET,
      resolvedPosition: DEFAULT_STRETCHER_POSITION,
    });
    expect("refused" in out).toBe(false);
    const p = out as { x: number; y: number; z: number };
    expect(p.x).toBeCloseTo(DEFAULT_STRETCHER_POSITION.x + CLINIC_PATIENT_OFFSET.x, 6);
    expect(p.z).toBeCloseTo(DEFAULT_STRETCHER_POSITION.z + CLINIC_PATIENT_OFFSET.z, 6);
  });

  it("(4) a nonzero NORMAL component on a supported posture is REFUSED, not clamped", async () => {
    // Brief, Authored intent versus resolved placement: "A nonzero normal offset fails this
    // supported-patient control." Silently zeroing y would let an unbuildable request promote.
    const fn = await compose();
    expect(typeof fn).toBe("function");
    for (const posture of ["seated", "supine"]) {
      const out = fn!({
        posture,
        fixtureAnchor: DEFAULT_STRETCHER_POSITION,
        authoredOffsetMeters: { x: 0.05, y: 0.12, z: 0 },
        resolvedPosition: DEFAULT_STRETCHER_POSITION,
      });
      expect("refused" in out, `${posture} accepted a nonzero normal offset`).toBe(true);
      expect((out as { reason: string }).reason).toMatch(/normal/iu);
    }
  });

  it("(5) CONTROL, GREEN ON HEAD AND AFTER: the ED bundle's stored supine patient position IS DEFAULT_STRETCHER_POSITION. That coincidence is the whole reason clause (7) needs a discriminator, and it must still hold after the slice: if it stops holding, the control moved and every 'the unauthored station did not move' claim in the factory and runtime cards is measuring something else.", () => {
    const stored = createEdChestPainRuntimeSceneManifest({}).actorPlacements[
      "patient_robert_hayes_v1"
    ];
    expect(stored).toBeDefined();
    expect(stored?.position).toEqual({ ...DEFAULT_STRETCHER_POSITION });
  });

  it("(6) STANDING is a pass-through with no offset, and REFUSES one — `none` is not a frame", async () => {
    // SUPERSEDED 2026-09-09. This clause asserted that standing WITH an authored offset was a
    // pass-through — the offset silently dropped. Brief §3 says "For standing, name a floor anchor;
    // `none` is not itself a frame", so that drop is now a refusal: an author who put a value in
    // the case saw no movement and nothing said why, which looks like the feature working.
    //
    // What the clause was protecting is unchanged and is asserted first: a standing actor is NOT
    // moved to the chair anchor. Restoring the old assertion means restoring the silent drop; if
    // that is ever wanted, the frame rule in actor-posture.ts is the thing to change, not this.
    const fn = await compose();
    expect(typeof fn).toBe("function");
    const resolved = { x: 1.95, y: 0.95, z: 0.15 };
    expect(fn!({
      posture: "standing",
      fixtureAnchor: DEFAULT_PATIENT_CHAIR_POSITION,
      resolvedPosition: resolved,
    })).toEqual(resolved);
    const refused = fn!({
      posture: "standing",
      fixtureAnchor: DEFAULT_PATIENT_CHAIR_POSITION,
      authoredOffsetMeters: CLINIC_PATIENT_OFFSET,
      resolvedPosition: resolved,
    }) as { refused?: true; reason?: string };
    expect(refused.refused).toBe(true);
    expect(refused.reason).toMatch(/not a frame/u);
  });

  it("(7) THE UNAUTHORED CONTROL, with a discriminator that can move: no authored offset leaves the supine anchor exactly at DEFAULT_STRETCHER_POSITION, and the discriminator is X because the authored clinic patient offset is x 0.4 while the anchor x is -0.9, so a leak would be visible on X. Z is NOT used here: the anchor z -0.1 and the clinic patient z 0 differ by less than the family offset, and Y is refused outright by clause 4.", async () => {
    const fn = await compose();
    expect(typeof fn).toBe("function");
    const out = fn!({
      posture: "supine",
      fixtureAnchor: DEFAULT_STRETCHER_POSITION,
      resolvedPosition: DEFAULT_STRETCHER_POSITION,
    }) as { x: number; y: number; z: number };
    expect(out.x).toBeCloseTo(DEFAULT_STRETCHER_POSITION.x, 6);
    expect(out.x).not.toBeCloseTo(DEFAULT_STRETCHER_POSITION.x + CLINIC_PATIENT_OFFSET.x, 6);
  });

  it("(8) the composed position SURVIVES framing: a supine actor carrying the composed XZ still has it after applyCleanEncounterVisualReviewActorFraming, which is the pass that runs between placement and the frame loop", async () => {
    const fn = await compose();
    expect(typeof fn).toBe("function");
    const composed = fn!({
      posture: "supine",
      fixtureAnchor: DEFAULT_STRETCHER_POSITION,
      authoredOffsetMeters: CLINIC_PATIENT_OFFSET,
      resolvedPosition: DEFAULT_STRETCHER_POSITION,
    }) as { x: number; y: number; z: number };

    const actor = new THREE.Group();
    actor.position.set(composed.x, composed.y, composed.z);
    actor.userData.openClinXrActorPosture = "supine";
    actor.userData.openClinXrSlotKind = "primary_patient";
    const framingInput: EncounterActorFramingInput = {
      actor,
      actorId: "patient_robert_hayes_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      role: "patient",
      posture: "supine",
      skipFraming: false,
    };
    applyCleanEncounterVisualReviewActorFraming(framingInput);

    expect(actor.position.x).toBeCloseTo(composed.x, 4);
    expect(actor.position.z).toBeCloseTo(composed.z, 4);
  });
});
