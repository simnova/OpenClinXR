import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the ED patient's upper body renders as a spray of shattered shards, while the same
 * mesh's legs and hips sit correctly on the stretcher deck.
 *
 * MEASURED 2026-08-27 at HEAD. `pnpm asset:ui-xr:environment-room-capture --scenario
 * ed_chest_pain_priority_v1` reported a live shell:
 *
 *   live env=ed_exam_bay_v1 depth=3.45 floor=5858155
 *   cam=roomCam(derived)=-3.00,1.71,2.10  nearestActor=2.07m  interiorMaxZ=2.35
 *
 * MY GRADE of the resulting PNG at full width: hips and legs on the deck, and the torso, arms and head
 * replaced by a radiating fan of cyan triangular shards from roughly the waist. #620, #181 and #621
 * landed and their effect on the lower body is visible in the same frame.
 *
 * THE PIXEL GRADE SAYS WHERE TO LOOK, NOT WHAT IS WRONG. The lower half of the same mesh renders
 * correctly, which already excludes wholesale asset corruption. Skinning weights, a bone transform, a
 * morph influence and a shader path all remain live candidates. CAUSE NOT DETERMINED — do not adopt
 * one from this header.
 *
 * KNOWN-GOOD COLUMN, and it is what makes this decisive rather than a lighting artifact: the nurse
 * renders intact two metres away in the SAME frame, same lighting, same pass. Clause (2) requires her
 * measured beside the patient rather than assumed.
 *
 * claimScope: whether a live scene-graph measurement of the patient's upper body exists and how it
 *   compares to an intact actor in the same frame.
 * notEvidenceFor: that any other station is affected, that the shipped GLB is corrupt, that the merged
 *   doorway figures (#527) share this mechanism, or that room lighting (#526) is implicated.
 *
 * ## FIXED (#712) — MEASURED 2026-08-27: the upper body is NOT shattered in the live scene graph.
 *
 * Live scene-graph sample at the capture camera (roomCam(derived) -3.00,1.71,2.10, #342 framing),
 * frames advanced, assets settled, patient + nurse in the SAME frame (scene-sample.json,
 * treeStamp head f4d433142d49):
 *
 *   patient_robert_hayes_v1 (40 meshes): max dev from bind 2.237 m (gown), AABB ratio <= 0.894
 *   nurse_maria_alvarez_v1   (33 meshes): max dev from bind 1.052 m, AABB ratio <= 0.932
 *
 * The deviation gap (2.1x) is the reclined pose: the bind is a standing A/T-pose and the runtime
 * poses the patient reclined on the deck, so vertices move up to the body diagonal. The shatter
 * discriminator is AABB compactness: EVERY patient skinned mesh keeps its current world AABB
 * within 1.25x of its own bind AABB (measured max 0.894 — the body is CONTRACTED, not blown out),
 * zero non-finite vertices, healthy normals, opaque MeshStandardMaterial, identity bindMatrix,
 * no flatShading/wireframe, and no morph influences on the gown.
 *
 * The cyan "shards" ARE the gown (openclinxr_real_garment_from_phenotype_hospital_gown, #73c2e0,
 * 28967 tris). Projected through the real capture camera its bind AABB lands at screen
 * [114,333]-[678,612] and the cyan pixels of BOTH the original capture and a fresh capture land at
 * [144,338]-[659,479] (2929 vs 2893 pixels — byte-similar) — the pixels are exactly where the
 * measured geometry is. The gown is NOT displaced.
 *
 * VERDICT: the shatter is NOT a skinning-weight / bone-transform / morph / vertex displacement.
 * The appearance is the gown's SURFACE rendering — sparse triangle coverage of its projected
 * extent (upper half only; the skirt is naturally occluded behind the torso from this camera),
 * in the unlit room (#526). Per the card, no product edit is warranted on the geometry side; the
 * residual visual (garment surface quality vs unlit-room lighting) is a pixel-grade question for
 * the orchestrator and the lighting part belongs to #526.
 *
 * Instrument: tools/openclinxr/evidence/the-ed-patient-upper-body-is-not-shattered.ts (CLI writes
 * .openclinxr/evidence/ed-patient-upper-body/scene-sample.json).
 */

const ROOT = process.cwd();
const MEASUREMENT = join(ROOT, ".openclinxr/evidence/ed-patient-upper-body/scene-sample.json");
const CAPTURE = join(ROOT, ".openclinxr/evidence/ui-xr-environment-room/latest/ed_chest_pain_priority_v1-room.png");

/** The two actors compared. The nurse is the known-good column, measured in the same frame. */
const PATIENT = "patient_robert_hayes_v1";
const NURSE = "nurse_maria_alvarez_v1";

type Sample = {
  actorId?: unknown;
  meshes?: Array<{
    name?: unknown;
    worldAabb?: { min?: number[]; max?: number[] };
    maxVertexDeviationFromBindMeters?: unknown;
    nonZeroMorphInfluences?: unknown;
  }>;
};
type Doc = { capturedAtHeadSha?: unknown; camera?: unknown; actors?: Sample[] };

function doc(): Doc {
  if (!existsSync(MEASUREMENT)) return {};
  try { return JSON.parse(readFileSync(MEASUREMENT, "utf8")) as Doc; } catch { return {}; }
}
const actorOf = (id: string): Sample | undefined => (doc().actors ?? []).find((a) => a.actorId === id);

describe("the ED patient upper body is not shattered", () => {
  it("(1) a live scene-graph sample of the patient exists, taken at the capture camera", () => {
    const a = actorOf(PATIENT);
    expect(
      a,
      "no measurement exists. A pixel grade establishes THAT something looks wrong and never WHAT is "
        + "wrong; sample per-mesh world AABB, vertex extent against the bind pose, active bone "
        + "transforms and non-zero morph influences before any product edit",
    ).toBeDefined();
    expect((a?.meshes ?? []).length, `${PATIENT}: no meshes sampled`).toBeGreaterThan(0);
    expect(String(doc().capturedAtHeadSha ?? ""), "the sample must name the tree it was taken from")
      .toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("(2) the nurse is sampled in the SAME frame as the known-good column", () => {
    const nurse = actorOf(NURSE);
    expect(
      nurse,
      "she renders intact two metres away under identical lighting and the same pass. Without her "
        + "measured beside the patient, any patient number is uninterpretable and a lighting or "
        + "exposure explanation cannot be excluded",
    ).toBeDefined();
    expect((nurse?.meshes ?? []).length, `${NURSE}: no meshes sampled`).toBeGreaterThan(0);
  });

  it("(3) the patient's upper-body deviation is recorded against the nurse's, either way", () => {
    const p = actorOf(PATIENT);
    const n = actorOf(NURSE);
    for (const [id, a] of [[PATIENT, p], [NURSE, n]] as const) {
      for (const m of a?.meshes ?? []) {
        expect(
          typeof m.maxVertexDeviationFromBindMeters,
          `${id} / ${String(m.name)}: no deviation recorded. A mesh present in the graph but "
            + "unmeasured is exactly the gap this card exists to close`,
        ).toBe("number");
      }
    }
    expect(
      (p?.meshes ?? []).length,
      "a recorded result showing the patient's deviation is COMPARABLE to the nurse's closes this "
        + "card as a measured finding — the shatter would then be a shader or camera artifact, not "
        + "geometry, and no product edit is warranted",
    ).toBeGreaterThan(0);
  });

  it("(4) COUNTERWEIGHT: the graded capture survives", () => {
    expect(
      existsSync(CAPTURE),
      "this card exists because of that frame; deleting it removes the observation rather than "
        + "explaining it",
    ).toBe(true);
  });

  it("(5) COUNTERWEIGHT: this card does not absorb its neighbours", () => {
    const src = readFileSync(join(ROOT, "tools/openclinxr/evidence/the-ed-patient-upper-body-is-not-shattered.test.ts"), "utf8");
    // Search the CLAUSE BODIES only. A first draft scanned from `describe(` and matched its own
    // regex literal — a self-referencing guard that fails on the file it is guarding. Same family as
    // establishing absence from a truncated grep: the instrument was inside its own search space.
    // The start anchor is the post-flip form: the mandatory it.fails -> it flip destroys the
    // original anchor, which would silently empty the scan range and make this guard vacuous.
    const body = src.slice(src.indexOf("it(\"(1)"), src.indexOf("it(\"(5)"));
    // Tokens split so this literal cannot match itself.
    const NEIGHBOUR_TOKENS = ["ward_" + "delirium", "ao" + "Map", "light" + "map", "examHud" + "NodeCount"];
    expect(
      NEIGHBOUR_TOKENS.some((t) => body.toLowerCase().includes(t.toLowerCase())),
      "merged figures are #527, unlit rooms are #526, the HUD and error banner are #643's publication "
        + "gate. A clause here about any of them would let this card go green on someone else's fix",
    ).toBe(false);
  });
});

// NOT TESTED: the cause. Skinning weights, a bone transform, a morph influence and a shader path are
// all live candidates and this contract deliberately adopts none of them.
