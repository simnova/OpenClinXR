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
 *
 * ## FIXED (#550) — appended; the planted header above is immutable
 *
 * `ece7f143` / #485 stripped `cargo_pants` from this body (poke-through). Clause (1d) still asserted
 * `cargo_pants` as a must-be-present known-good lower control. NodeIO inventory
 * (`named-control-inventory.json`): no mesh matching `cargo_pants|_pants|trouser` remains — there is
 * **no** surviving lower-body garment of the right kind on `mpfb-gown-inspect.glb` (unlike kevin,
 * which still has `scrub_pants`). Choice: **inverted guard** recording that absence. Do not restore
 * `cargo_pants`. (1b)/(1c)/`_body` controls still present and unchanged.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(HERE, "../../../apps/ui-xr/public/generated-humanoids");
const ANNY_GOWNED = join(GENERATED, "ed_chest_pain_adult_cast.glb");
/** The bake this slice must produce. Isolated subject, mirroring mpfb-viseme-inspect (D3/D4). */
const TARGET = join(GENERATED, "mpfb-gown-inspect.glb");
/** A stub from a no-anny orchestrate run is ~0.8 MB; real MPFB bodies are multi-MB (SS6r). */
const MIN_REAL_BAKE_BYTES = 2_000_000;
const MPFB_JOINT_FLOOR = 100;

/** One mesh as measured off the file: name, vertex count, and world-Y span. */
type MeshGeom = { name: string; verts: number; y0: number; y1: number };
type Body = { meshes: string[]; geoms: MeshGeom[]; joints: string[]; bytes: number };

async function read(p: string): Promise<Body | null> {
  if (!existsSync(p)) return null;
  const doc = await new NodeIO().read(p);
  const geoms: MeshGeom[] = doc.getRoot().listMeshes().map((m) => {
    let y0 = Infinity;
    let y1 = -Infinity;
    let verts = 0;
    for (const prim of m.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      verts += pos.getCount();
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, el);
        if (el[1]! < y0) y0 = el[1]!;
        if (el[1]! > y1) y1 = el[1]!;
      }
    }
    return { name: m.getName() ?? "", verts, y0, y1 };
  });
  return {
    meshes: geoms.map((g) => g.name),
    geoms,
    joints: (doc.getRoot().listSkins()[0]?.listJoints() ?? []).map((j) => j.getName() ?? ""),
    bytes: statSync(p).size,
  };
}

const isGownMesh = (n: string): boolean => /gown/i.test(n);

/**
 * ## SS11s REPAIR, 2026-08-20 — clause (1) BOUNDED A NAME AND THE MARKER SATISFIED IT
 *
 * As dispatched, clause (1) was `meshes.some(n => /gown/i.test(n))`. The bake returned green and the
 * mesh inventory showed why: `openclinxr_declared_upper_layers__hospital_gown_mesh` has **3 vertices**
 * and **zero height**. It is the declared-layer SSOT marker consumed by `garment-layer-coverage.ts:35`
 * `DECLARED_NAME_RE` — and it exists on the ANNY body too, so it was never evidence of THIS bake.
 * The worker flipped exactly the three clauses it was asked to and touched no assertion; the contract
 * was the defect, and it is the orchestrator's. Standing lesson, landing on its own author:
 * **presence, placement and provenance are three questions and none of them is CLASS.**
 *
 * The measured record from the landed bake (`mpfb-gown-inspect.glb`, body 0.001 -> 1.667 m):
 *
 *   mesh                                          verts     y0      y1   hemFrac  topFrac
 *   openclinxr_real_garment_peds_upper_v1_mesh     2677   0.534   1.439    0.320    0.863  <- gown shell
 *   makeclothes_library_toigo_t_shirt_..._mesh     5400   0.955   1.406    0.573    0.843  <- upper control
 *   makeclothes_library_cargo_pants_..._mesh       8268   0.101   0.986    0.060    0.591  <- lower control
 *   openclinxr_declared_upper_layers__..._mesh        3   0.917   0.917    0.550    0.550  <- the marker
 *
 * ## THE FIRST REPAIR WAS ALSO DEFECTIVE — the destructive probe caught it, not review
 *
 * The repair originally bounded the HEM alone at 0.45h. The probe — exclude `real_garment` and the
 * clause must red — **passed**, because `cargo_pants` hems at 0.060h and cleared it. A trouser leg
 * satisfies "hems below mid-thigh" trivially. SS11s again, one layer in: a hem is an EXTREME, and a
 * gown is a SPAN. Two garments differ from it in opposite directions and neither bound alone sees it.
 *
 * KNOWN-GOOD COLUMNS (SS9h), both on THIS body, independently authored, pulling opposite ways:
 *   - `toigo_t_shirt`   covers the torso and stops at the hip  -> fails the HEM bound  (0.573 > 0.45)
 *   - `cargo_pants`     reaches the ankle but starts at the hip -> fails the TOP bound  (0.591 < 0.70)
 * Only a single shell spanning shoulder to below mid-thigh clears both. Each boundary is the midpoint
 * of the pair that straddles it — hem 0.45 between 0.320 and 0.573; top 0.70 between 0.591 and 0.843
 * — so both are derived from garments nobody baked for this contract, never fitted as a fraction of
 * the gown's own measurement (SS9s).
 *
 * The shell is also NOT named `gown` — the builder names procedural garments by `gname`
 * (`peds_upper_v1`), not by `kind`. That is precisely why a name match could never have found it.
 */
const MIN_SHELL_VERTS = 500;
const GOWN_HEM_FRAC_MAX = 0.45;
const GOWN_TOP_FRAC_MIN = 0.7;

/** Hem height as a fraction of body height — 0 is the floor, 1 the crown. */
function hemFraction(g: MeshGeom, body: MeshGeom): number {
  return (g.y0 - body.y0) / (body.y1 - body.y0);
}

/** Highest point of the mesh as a fraction of body height. */
function topFraction(g: MeshGeom, body: MeshGeom): number {
  return (g.y1 - body.y0) / (body.y1 - body.y0);
}

function bodyMesh(b: Body): MeshGeom {
  const body = b.geoms.find((g) => /_body$/.test(g.name));
  expect(body, `no *_body mesh in: ${b.meshes.join(", ")}`).toBeDefined();
  return body!;
}

/**
 * A gown-CLASS shell: real geometry (not the 3-vertex marker) forming ONE span from the shoulder to
 * below mid-thigh. Both bounds are required — see the header for the two controls that defeat each
 * one alone.
 */
function gownClassShells(b: Body): MeshGeom[] {
  const body = bodyMesh(b);
  return b.geoms.filter(
    (g) =>
      g !== body
      && g.verts >= MIN_SHELL_VERTS
      && hemFraction(g, body) <= GOWN_HEM_FRAC_MAX
      && topFraction(g, body) >= GOWN_TOP_FRAC_MIN,
  );
}

describe("an MPFB patient body wears a gown", () => {
  it("(1) RED: a shipped MPFB body carries gown-CLASS geometry, not a gown-shaped NAME", async () => {
    const b = await read(TARGET);
    expect(b, `${TARGET} must exist — no MPFB body carries a gown today`).not.toBeNull();
    const shells = gownClassShells(b!);
    const body = bodyMesh(b!);
    const inventory = b!.geoms
      .map(
        (g) =>
          `${g.name} verts=${g.verts} hemFrac=${hemFraction(g, body).toFixed(3)} topFrac=${topFraction(g, body).toFixed(3)}`,
      )
      .join("\n  ");
    expect(
      shells.length,
      `no shell with >=${MIN_SHELL_VERTS} verts spans top>=${GOWN_TOP_FRAC_MIN}h down to hem<=${GOWN_HEM_FRAC_MAX}h:\n  ${inventory}`,
    ).toBeGreaterThan(0);
  });

  it("(1b) COUNTERWEIGHT: the 3-vertex declared-layer marker cannot satisfy (1)", async () => {
    // This is the clause the ORIGINAL (1) was missing, and the reason it went green on a marker.
    // The marker is an SSOT row carrying the declared-layer count — it must keep shipping (nothing
    // here asks for its removal) and it must never be mistaken for the garment it declares.
    const b = await read(TARGET);
    expect(b, "the bake must exist").not.toBeNull();
    const marker = b!.geoms.find((g) => /declared_upper_layers/.test(g.name));
    expect(marker, "the declared-layer marker must still ship — it is consumed by garment-layer-coverage").toBeDefined();
    expect(marker!.verts, `the marker carries ${marker!.verts} verts; a garment carries hundreds`).toBeLessThan(MIN_SHELL_VERTS);
    expect(gownClassShells(b!).map((g) => g.name), "the marker must not be counted as a gown shell").not.toContain(marker!.name);
  });

  it("(1c) COUNTERWEIGHT: an upper-body garment on the same body fails the hem bound", async () => {
    // Refuses "rename or re-tag the t-shirt". KNOWN-GOOD column (SS9h): toigo_t_shirt is a real,
    // independently-authored 5,400-vert garment on THIS body and it hems at 0.573h. If the bound
    // ever admits it, the bound has stopped discriminating class and is measuring only presence.
    const b = await read(TARGET);
    expect(b, "the bake must exist").not.toBeNull();
    const shirt = b!.geoms.find((g) => /t_shirt/.test(g.name));
    expect(shirt, "the t-shirt is the known-good NOT-a-gown control on this body").toBeDefined();
    expect(hemFraction(shirt!, bodyMesh(b!)), "a torso garment hems near mid-hip, well above a gown")
      .toBeGreaterThan(GOWN_HEM_FRAC_MAX);
    expect(gownClassShells(b!).map((g) => g.name), "the t-shirt must not be counted as a gown shell").not.toContain(
      shirt!.name,
    );
  });

  it("(1d) COUNTERWEIGHT: a lower-body garment fails the top bound", async () => {
    // FIXED (#550): inverted guard. The planted counterweight required cargo_pants as a live
    // known-good that fails GOWN_TOP_FRAC_MIN. #485 stripped that mesh; NodeIO shows no
    // cargo_pants|_pants|trouser remnant on this body — no replacement lower control of the right
    // kind exists (footwear is not a trouser-class defeat of the top bound). Assert ABSENCE instead
    // of retargeting. Re-introducing trousers would red here and is refused by #487 as well.
    const b = await read(TARGET);
    expect(b, "the bake must exist").not.toBeNull();
    const lower = b!.geoms.filter(
      (g) => g.verts >= 100 && /(cargo_pants|_pants|trouser)/i.test(g.name),
    );
    expect(
      lower.map((g) => g.name),
      "no lower-body garment may remain on mpfb-gown-inspect (#485 stripped cargo_pants; do not restore)",
    ).toEqual([]);
  });

  it("(2) RED: the gown is on the MPFB rail, not Anny", async () => {
    // Refuses the rail trap. The Anny gowned body has 23 joints and no jaw; transferring its gown
    // rather than invoking the gown kind on an MPFB mesh would satisfy (1) and defeat the campaign.
    const b = await read(TARGET);
    expect(b, "the bake must exist").not.toBeNull();
    expect(b!.joints.length, `${b!.joints.length} joints — MPFB carries 137, Anny 23`).toBeGreaterThan(MPFB_JOINT_FLOOR);
    expect(b!.joints.includes("jaw"), "an MPFB body carries a jaw joint; the Anny rail does not").toBe(true);
  });

  it("(3) RED: the bake is real, not an orchestrate stub", async () => {
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
