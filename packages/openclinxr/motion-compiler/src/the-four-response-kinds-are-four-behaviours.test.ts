import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: `TouchResponse.responseKind` has four values and the compiler produces two behaviours.
 * A patient guarding spontaneously and a patient resisting an examiner-imposed movement compile to
 * byte-identical tracks.
 *
 * MEASURED at main 79d3f382 on 2026-09-03, through the package's public surface:
 *
 *   RESPONSE_KIND_TO_PRIMITIVE = { guarding: guard_body_region, palpation: reach_target,
 *                                  passive_rom: guard_body_region, positioning: reach_target }
 *   distinct primitives: 2 of 4 kinds
 *   guarding vs passive_rom tracks identical: true
 *
 * ## HOW THIS HAPPENED, recorded so it is not read as a clinical decision
 *
 * The compiler-repair card (5f36a63d) inherited a map whose `passive_rom` and `positioning` entries
 * named `brace` and `posture_shift`, neither of which is in `PRIMITIVE_IDS`. My clause on that card
 * asked only that every kind "maps to a primitive the registry can supply", so repointing the two
 * orphans at existing primitives satisfied it literally. The worker did that and stated its reasoning
 * inline rather than smuggling it.
 *
 * **The weak clause was mine.** It bounded RESOLVABILITY when the concern was BEHAVIOUR — the
 * quantity-versus-shape trap in `contract-design`. This file is the repair, and it asserts the shape.
 *
 * ## WHY THESE ARE NOT THE SAME BEHAVIOUR
 *
 * `guarding` in the Keefe & Block sense is the patient's own protective motor pattern, produced
 * without being asked. `passive_rom` is motion the EXAMINER imposes on a limb; what the patient
 * contributes is resistance, and CPOT scores its top level as literally "inability to complete the
 * movement". One is a self-initiated withdrawal; the other is a failure to yield. `positioning` is
 * guided contact with a dwell and a release, not a reach.
 *
 * The repo already models the distinction it is losing here:
 * `packages/openclinxr/arena/physics-touch-contract/src/scenarios/passive-rom.ts` treats passive ROM
 * as a grasped arc, and `positioning.ts` as guided contact with dwell and release. Sources for the
 * clinical anchors are in `docs/openclinxr/humanoid-motion-architecture-brief-2026-09-02.md`.
 *
 * IMMUTABLE diagnosis. Flip planted() -> it and append a `## FIXED` block. Remove each flipped clause
 * from planted-red-manifest.ts in the same change.
 *
 * claimScope: whether the four authored response kinds produce four distinguishable compiled motions.
 * notEvidenceFor: that any of the four looks right — no pixels are graded here; that these are the
 *   correct clinical primitives, which is a faculty question; runtime IK, contact, or apps/ui-xr.
 */

/**
 * ## FIXED (BothyBoard issue #0) — clauses (1) and (2) are now live `it` tests.
 *
 * The two orphaned kinds got primitives of their own instead of aliases:
 *
 *   - src/imposed-limb-arc.ts      `imposed_limb_arc` — the limb CARRIED through an out-and-back
 *                                  minimum-jerk arc by an examiner's grasp (passive-rom.ts's
 *                                  grasped-arc shape): the shoulder sweeps while elbow and wrist
 *                                  stay nearly quiet under the grasp, no hold plateau, limb back
 *                                  to rest at clip end. passive_rom now resolves here.
 *   - src/guided-placement.ts      `guided_placement` — the effector GUIDED to a placed offset,
 *                                  dwelt on, then released with the placement retained (the
 *                                  positioning.ts guide/dwell/release shape): one node-local
 *                                  translation track that ends displaced rather than returning
 *                                  to rest. positioning now resolves here.
 *
 * Both are registered in src/primitive-registry.ts (PRIMITIVE_IDS grew from five to seven) and
 * RESPONSE_KIND_TO_PRIMITIVE remaps passive_rom -> imposed_limb_arc, positioning ->
 * guided_placement in src/program/compile-scenario-motion.ts. Clause (3) — guarding keeps
 * guard_body_region, palpation keeps reach_target — is untouched. Their manifest entries were
 * removed in planted-red-manifest.ts in the same change.
 *
 * What the compiled tracks are NOT evidence of is unchanged from the header: no pixels are graded,
 * and whether these are the clinically correct primitives for the two kinds is a faculty question.
 */

const KINDS = ["guarding", "palpation", "passive_rom", "positioning"] as const;
const SITE = "abdomen_epigastric";

const rootModule = async (): Promise<Record<string, unknown>> =>
  (await import("./index.js")) as Record<string, unknown>;

const compileFor = async (primitiveId: string): Promise<string> => {
  const m = await rootModule();
  const resolve = m["resolvePrimitive"] as (id: string) => { compile: (r: unknown) => { tracks: unknown[] } };
  return JSON.stringify(resolve(primitiveId).compile({
    action: {
      actionId: "a", primitiveId, effector: "handR",
      target: { kind: "body_region", id: SITE },
      timing: { startMs: 0, durationMs: 900 }, constraints: [],
    },
    skeletonProfile: { rigFingerprint: "fixture", joints: {} },
    seed: "fixed-seed",
  }).tracks);
};

describe("the four response kinds are four behaviours", () => {
  it("(1) four authored kinds resolve to four DISTINCT primitives", async () => {
    const m = await rootModule();
    const map = m["RESPONSE_KIND_TO_PRIMITIVE"] as Record<string, string>;
    const ids = m["PRIMITIVE_IDS"] as readonly string[];
    const resolved = KINDS.map((k) => map[k] ?? "");
    expect(new Set(resolved).size,
      `four kinds collapsed onto ${new Set(resolved).size} primitives: ${JSON.stringify(map)}`).toBe(4);
    // COUNTERWEIGHT: distinctness is satisfiable by two ids the registry cannot supply, which is the
    // state this map was in BEFORE 5f36a63d. Both halves have to hold at once.
    for (const primitiveId of resolved) {
      expect(ids, `${primitiveId} is named by the map but is not a registered primitive`).toContain(primitiveId);
    }
    // SECOND COUNTERWEIGHT, and the one that names the real obligation. Distinctness plus
    // registration is satisfiable today by repointing passive_rom at `clutch_body_region` and
    // positioning at `cough_recoil` — MEASURED to turn both REDs green on 2026-09-03. That is the
    // cheapest pass and it is clinically wrong: clutching is still a self-initiated body-region
    // motion, and a cough recoil is not a guided placement. The two orphaned kinds owe NEW
    // primitives, so at least two of the four resolved ids must be outside the M2+M4 five.
    const M2_M4_FIVE = ["guard_body_region", "clutch_body_region", "reach_target", "look_at", "cough_recoil"];
    expect(resolved.filter((id) => !M2_M4_FIVE.includes(id)).length,
      "passive_rom and positioning were repointed at pre-existing primitives instead of getting their own")
      .toBeGreaterThanOrEqual(2);
  });

  it("(2) an examiner-imposed passive ROM does not compile to the patient's own guard", async () => {
    // The naming clause above is satisfiable by two aliases that emit identical tracks. This one is
    // the shape: a self-initiated withdrawal and a failure to yield are different motions.
    const m = await rootModule();
    const map = m["RESPONSE_KIND_TO_PRIMITIVE"] as Record<string, string>;
    expect(await compileFor(map["passive_rom"] ?? ""),
      "passive_rom compiles to the same tracks as guarding — the kinds are aliases, not behaviours")
      .not.toBe(await compileFor(map["guarding"] ?? ""));
    expect(await compileFor(map["positioning"] ?? ""),
      "positioning compiles to the same tracks as palpation")
      .not.toBe(await compileFor(map["palpation"] ?? ""));
  });

  it("(3) INVERTED GUARD: guarding and palpation keep the primitives they already had", async () => {
    // This is a REPLACEMENT of two orphaned entries, not a reshuffle of four. If this clause ever
    // fails, restore guarding -> guard_body_region and palpation -> reach_target; widening or
    // deleting it to accommodate a new mapping is the wrong repair, because the two kinds that
    // already worked are not what this card is about.
    const m = await rootModule();
    const map = m["RESPONSE_KIND_TO_PRIMITIVE"] as Record<string, string>;
    expect(map["guarding"], "guarding was remapped; this card only owes the two orphaned kinds")
      .toBe("guard_body_region");
    expect(map["palpation"], "palpation was remapped; this card only owes the two orphaned kinds")
      .toBe("reach_target");
  });
});
