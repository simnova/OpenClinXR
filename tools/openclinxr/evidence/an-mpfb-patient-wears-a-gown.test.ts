import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Campaign #478 lane L4. Superagent ruled the gate 2026-08-20 as option (a): a BAKED MPFB PATIENT GLB
 * that carries a gown mesh, pixel-graded by the orchestrator — NOT a class-sheet row.
 *
 * ## WHY NOT THE CLASS SHEET — measured, and it is why this contract exists at all
 *
 * `garment-class-sheet.ts:111-126` enumerates `InvRow` from `garment-class-inventory.json` and renders
 * each garment from its own `.obj` in the provider cache. It is a sheet of CACHED MakeClothes SOURCE
 * garments. A procedural gown is bake-time geometry built from the body surface — never a `.mhclo`
 * in that cache — so the sheet STRUCTURALLY CANNOT SHOW IT. Gating L4 on a sheet row would have been
 * a proof that could not pass.
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE
 *
 * Exactly ONE shipped body carries a gown mesh, and it is the Anny rail:
 *
 *   ed_chest_pain_adult_cast.glb   openclinxr_declared_upper_layers__hospital_gown_mesh   23 joints
 *
 * ZERO MPFB bodies carry one. `mpfb-ob-patient-aisha`, `mpfb-peds-parent-aisha` and
 * `mpfb-viseme-inspect` all wear `toigo_t_shirt` + `cargo_pants`. That is why seven gowned patients
 * are still cast on a 23-joint body with no jaw, no FACS mouth or eye targets, and NO EYE MESH.
 *
 * ## THE TOOL EXISTS — D1, wire it, do not author geometry
 *
 * `automate_blender.py:1862 _build_body_surface_derived_garment` — body-surface offset along outward
 * normals, planar-bisect hem, landmark-aligned neck and arm cuts. Called live at `:3670`.
 * `kind == "gown"` ALREADY HAS A SWEPT PARAMETER SET at `:3527`:
 *
 *   sleeve_along = arm_len * 0.42   # #200 DECIDED from gown-sleeve-sweep-sheet; 0.42 = upper_arm,
 *                                   # exam-access gown. Cardigan stays 0.92. Scrub stays 0.22.
 *                                   # "Gown does NOT share the cardigan coefficient."
 *
 * And `:2982` already treats `hospital_gown` as a recognised `phenotype.garmentLayers` token, so the
 * garment is BLUEPRINT-DRIVEN (Q1). **Do not invent millimetres. Do not author a new gown shape.**
 *
 * ## THE RAIL TRAP
 *
 * The builder lives under `anny/automate_blender.py` but takes `mesh_obj`. An Anny-space gown
 * transferred onto MPFB is the wrong rail. Invoke the gown kind ON AN MPFB MESH. Clause (2) refuses
 * a bake that lands on a 23-joint body.
 *
 * ## THE REGENERATION TRAP (SS6r) — this cost a previous slice more than its product edits
 *
 * Full `orchestrate_character` WITHOUT the `anny` package silently produces ~0.8 MB STUB GLBs that
 * pass file-existence checks. Clause (3) bounds bytes and mesh count so a stub cannot satisfy this.
 *
 * ## KNOWN-GOOD COLUMN (SS9h)
 *
 * `mpfb-viseme-inspect.glb` — the tracked isolated-subject precedent (D3/D4), same MPFB rail, baked
 * and shipped. `apps/ui-xr/public/generated-humanoids/` is TRACKED (74 GLBs), so a bake there lands.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (1)(2)(3) read the not-yet-existing bake: **REDS**, planted `it.fails`. (4)(5) read the tree and
 * pass today: **TRUE NETS**.
 *
 * NOT TESTED:
 *   - That the gown LOOKS like a hospital gown. The orchestrator grades native pixels per land; the
 *     S0/S1/S2 lesson is that presence, placement and provenance are three questions and none is CLASS.
 *   - Recasting the seven patients — that is L6, and P1 stays parked until this lands.
 *   - Quest, clinical validity, exam equivalence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(HERE, "../../../apps/ui-xr/public/generated-humanoids");
const ANNY_GOWNED = join(GENERATED, "ed_chest_pain_adult_cast.glb");
/** The bake this slice must produce. Isolated subject, mirroring mpfb-viseme-inspect (D3/D4). */
const TARGET = join(GENERATED, "mpfb-gown-inspect.glb");
/** A stub from a no-anny orchestrate run is ~0.8 MB; real MPFB bodies are multi-MB (SS6r). */
const MIN_REAL_BAKE_BYTES = 2_000_000;
const MPFB_JOINT_FLOOR = 100;

type Body = { meshes: string[]; joints: string[]; bytes: number };

async function read(p: string): Promise<Body | null> {
  if (!existsSync(p)) return null;
  const doc = await new NodeIO().read(p);
  return {
    meshes: doc.getRoot().listMeshes().map((m) => m.getName() ?? ""),
    joints: (doc.getRoot().listSkins()[0]?.listJoints() ?? []).map((j) => j.getName() ?? ""),
    bytes: statSync(p).size,
  };
}

const isGownMesh = (n: string): boolean => /gown/i.test(n);

describe("an MPFB patient body wears a gown", () => {
  it.fails("(1) RED: a shipped MPFB body carries a gown mesh", async () => {
    const b = await read(TARGET);
    expect(b, `${TARGET} must exist — no MPFB body carries a gown today`).not.toBeNull();
    expect(b!.meshes.some(isGownMesh), `meshes were: ${b!.meshes.join(", ")}`).toBe(true);
  });

  it.fails("(2) RED: the gown is on the MPFB rail, not Anny", async () => {
    // Refuses the rail trap. The Anny gowned body has 23 joints and no jaw; transferring its gown
    // rather than invoking the gown kind on an MPFB mesh would satisfy (1) and defeat the campaign.
    const b = await read(TARGET);
    expect(b, "the bake must exist").not.toBeNull();
    expect(b!.joints.length, `${b!.joints.length} joints — MPFB carries 137, Anny 23`).toBeGreaterThan(MPFB_JOINT_FLOOR);
    expect(b!.joints.includes("jaw"), "an MPFB body carries a jaw joint; the Anny rail does not").toBe(true);
  });

  it.fails("(3) RED: the bake is real, not an orchestrate stub", async () => {
    // Refuses SS6r. Full orchestrate without the anny package emits ~0.8 MB stubs that pass an
    // exists: check. Bytes AND mesh count, because either alone is satisfiable by a stub.
    const b = await read(TARGET);
    expect(b, "the bake must exist").not.toBeNull();
    expect(b!.bytes, `${b!.bytes} bytes — a no-anny stub is ~0.8 MB`).toBeGreaterThan(MIN_REAL_BAKE_BYTES);
    expect(b!.meshes.length, "a stub carries a bare body; a real bake carries body + garments + eyes").toBeGreaterThan(3);
  });

  it("(4) NET: the Anny gowned body keeps its gown", async () => {
    // This slice ADDS a gown to the MPFB rail. It does not move, strip or re-bake the Anny body the
    // seven patients are still cast on — that is L6 and P1 stays parked until L5 lands.
    const b = await read(ANNY_GOWNED);
    expect(b, "the Anny gowned body must still ship").not.toBeNull();
    expect(b!.meshes.some(isGownMesh), "its hospital_gown mesh must survive this slice").toBe(true);
  });

  it("(5) VACUITY GUARD: the gown kind and its swept parameters still exist", () => {
    // Reads the tree, passes today. If someone deletes the gown kind, clauses (1)-(3) become
    // unachievable rather than merely red, and this says which.
    const src = readFileSync(join(HERE, "../asset-pipeline/anny/automate_blender.py"), "utf8");
    expect(src.includes('if kind == "gown":'), "the gown kind must still exist in the builder").toBe(true);
    expect(/sleeve_along\s*=\s*arm_len\s*\*\s*0\.42/.test(src), "#200's swept 0.42 coefficient must survive").toBe(true);
    expect(src.includes("hospital_gown"), "hospital_gown must stay a recognised garmentLayers token").toBe(true);
  });
});
