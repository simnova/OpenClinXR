import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Campaign #478, the residual #485 named. A gowned body still wears its cargo pants.
 *
 * ## THE MECHANISM, NAMED BY #485 — IMMUTABLE
 *
 * `gown-see-through-cause.json` (`mechanism_named`): the pale patches inside the gown's silhouette
 * are the TROUSERS, not skin. Signed distance along the skirt's own outward normal, full 3D:
 *
 *   mesh                                     max signed distance   % of thigh-band verts outside
 *   -----------------------------------------|--------------------|-----------------------------
 *   mpfb_ob_patient_aisha_body (skin)         |      +0.2 mm       |            0%
 *   makeclothes_library_cargo_pants_...       |     +16.6 mm       |           56%
 *
 * The bake dresses a body that is ALREADY wearing `cargo_pants` and adds the gown as a new object
 * without stripping the lower garment. Baggy trousers are wider than a skirt that drapes tight to
 * the legs, so the shell cannot contain them.
 *
 * ## THE POPULATION, ENUMERATED FROM WHAT SHIPS — 1 OFFENDER, 8 CONTROLS
 *
 * Every GLB under `generated-humanoids/`, classified by whether it carries a `hospital_gown`
 * declaration mesh and whether it carries a real (>100 vert) lower garment:
 *
 *   gown  lower                                    file
 *   ----|----------------------------------------|--------------------------------
 *    Y  | cargo_pants (8,268 v)                   | mpfb-gown-inspect.glb        <- THE OFFENDER
 *    Y  | —                                       | ed_chest_pain_adult_cast.glb <- THE TARGET SHAPE
 *    n  | scrub_pants (5,400 v)                   | mpfb-clinical-nurse-adult.glb
 *    n  | scrub_pants (5,400 v)                   | mpfb-clinical-physician-adult.glb
 *    n  | cargo_pants (8,297 v)                   | mpfb-family-partner-adult.glb
 *    n  | cargo_pants (8,262 v)                   | mpfb-ob-patient-aisha.glb
 *    n  | scrub_pants (5,404 v)                   | mpfb-peds-nurse-kevin.glb
 *    n  | cargo_pants (8,262 v)                   | mpfb-peds-parent-aisha.glb
 *    n  | cargo_pants (7,892 v)                   | mpfb-peds-patient-child.glb
 *    n  | cargo_pants (8,322 v)                   | mpfb-street-adult-male.glb
 *    n  | cargo_pants (8,262 v)                   | mpfb-viseme-inspect.glb
 *
 * **`ed_chest_pain_adult_cast.glb` is the KNOWN-GOOD (SS9h)**: a gown declared and NO lower garment.
 * It is also the body all seven gowned patients are cast on today, so the target shape is not
 * hypothetical — it is what learners already see.
 *
 * ## A NOTE ON HOW THIS POPULATION WAS FIRST MIS-COUNTED
 *
 * My first enumeration matched lower garments with `/pants|trouser|cargo|short|skirt_lib/i` and
 * reported `peds_patient_child.glb` as an offender. It is not: the match was
 * `..._short_sleeve_exam_tshirt`, on the substring `short`. A name match tells you what something
 * is CALLED. This contract classifies on a name AND a vertex floor, so a 3-vertex declaration
 * marker can never be counted as a garment — the same trap that cost #480 a defective clause.
 *
 * ## CLINICAL STAGING IS NOT AN IMPLEMENTER DECISION (SS8d / SS8y)
 *
 * A patient in a hospital gown does not wear cargo pants underneath. That is stated here, not left
 * for a worker to decide mid-slice. **The MECHANISM is the implementer's** — strip the lower garment
 * when `hospital_gown` is in `phenotype.garmentLayers`, or never fit one on a body destined for a
 * gown. Either satisfies this contract.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) no conflict | (2) others keep | (3) gown kept | result
 *   ------------------------------------------------|-----------------|-----------------|---------------|--------
 *   a) today — gown stacked over cargo pants         |   **FAIL**      |      pass       |     pass      | REFUSED
 *   b) strip lower garments from every body          |     pass        |    **FAIL**     |     pass      | REFUSED
 *   c) drop the gown declaration from the offender   |     pass        |      pass       |   **FAIL**    | REFUSED
 *   d) strip the lower garment WHERE a gown is declared | pass         |      pass       |     pass      | ALL PASS
 *
 * **(b) is the one to watch.** "No body wears trousers under anything" is the one-line fix and it
 * undresses eight figures who are correctly wearing them — two nurses, a physician, a family
 * partner, a child, a street adult and two inspect subjects. Clause (2) requires all eight to keep
 * a lower garment of at least their measured size.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2) and (3) pass today and
 * exist so (1) cannot be satisfied by undressing everyone or by removing the gown. (4) is a NET on
 * the enumeration itself.
 *
 * NOT TESTED:
 *   - Whether the gown should also widen. #485's stop rule made that a decision, not a measurement,
 *     and it is not this contract's subject: a gowned patient in cargo pants is wrong even if the
 *     skirt could contain them.
 *   - The TORSO above the hip, which grades as tracing the bust and navel. I have no valid
 *     instrument for it — three radial attempts were defeated by arms, and the `toigo_t_shirt`
 *     control shows the identical -61 mm signature, so that reading is an arm and not a defect.
 *     Deliberately NOT filed from an unlocated pixel grade.
 *   - Any body outside `generated-humanoids/`.
 *
 * ## FIXED (#487)
 *
 * `bake_mpfb_gown_inspect.py` now strips the pre-existing real lower garment from the imported
 * source before the gown builder runs. The source `mpfb-viseme-inspect.glb` already carries
 * `makeclothes_library_cargo_pants` (8,262 v) as a separate mesh object the #480 keep-list
 * never touched, so it passed through to export and stacked under the skirt (#485: +16.6 mm on
 * 56% of thigh-band vertices). `_strip_lower_garments` removes any >100-vert mesh whose name
 * matches `cargo_pants|_pants|trouser` — name AND a vertex floor, never name alone — excluding
 * the body itself. Only this bake path changes; the eight trousered controls are untouched.
 *
 * Clause (1) flipped `it.fails` -> `it`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = pathResolve(HERE, "../../../apps/ui-xr/public/generated-humanoids");

/** A declaration marker is ~3 vertices; a real garment is thousands. Never classify on name alone. */
const MIN_REAL_GARMENT_VERTS = 100;
const LOWER_GARMENT_RE = /(cargo_pants|_pants|trouser)/i;
const GOWN_DECL_RE = /declared_upper_layers__.*gown/i;

type Body = { file: string; gownDeclared: boolean; lower: { name: string; verts: number }[] };

async function classifyAll(): Promise<Body[]> {
  const io = new NodeIO();
  const out: Body[] = [];
  for (const file of readdirSync(GENERATED).filter((n) => n.endsWith(".glb")).sort()) {
    const doc = await io.read(join(GENERATED, file));
    const rows = doc.getRoot().listMeshes().map((m) => {
      let verts = 0;
      for (const prim of m.listPrimitives()) verts += prim.getAttribute("POSITION")?.getCount() ?? 0;
      return { name: m.getName() ?? "", verts };
    });
    out.push({
      file,
      gownDeclared: rows.some((r) => GOWN_DECL_RE.test(r.name)),
      lower: rows.filter((r) => r.verts >= MIN_REAL_GARMENT_VERTS && LOWER_GARMENT_RE.test(r.name)),
    });
  }
  return out;
}

const bodies = await classifyAll();
const describeRow = (b: Body): string =>
  `${b.file} gown=${b.gownDeclared ? "Y" : "n"} lower=[${b.lower.map((l) => `${l.name}(${l.verts}v)`).join(",") || "-"}]`;

describe("a body declaring a hospital gown does not also wear trousers", () => {
  it("(1) RED: no shipped body carries both a gown declaration and a lower garment", () => {
    const conflicted = bodies.filter((b) => b.gownDeclared && b.lower.length > 0);
    expect(
      conflicted.map(describeRow),
      `#485 measured the trousers poking +16.6mm through the skirt on 56% of thigh-band vertices`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: every body WITHOUT a gown keeps its lower garment", () => {
    // Refuses (b). Eight figures are correctly wearing trousers — two nurses, a physician, a family
    // partner, a child, a street adult and two inspect subjects. Undressing them clears (1) and
    // makes the product much worse.
    const dressed = bodies.filter((b) => !b.gownDeclared && b.lower.length > 0);
    expect(dressed.length, `bodies legitimately in trousers:\n  ${bodies.map(describeRow).join("\n  ")}`)
      .toBeGreaterThanOrEqual(8);
    for (const b of dressed) {
      expect(b.lower[0]!.verts, `${b.file} must keep a real lower garment, not a stub`).toBeGreaterThanOrEqual(
        MIN_REAL_GARMENT_VERTS,
      );
    }
  });

  it("(3) COUNTERWEIGHT: the gown declarations survive", () => {
    // Refuses (c). Dropping the declaration from the offender clears (1) by removing the gown —
    // and `ed_chest_pain_adult_cast` is the body all seven gowned patients are cast on today.
    const gowned = bodies.filter((b) => b.gownDeclared).map((b) => b.file);
    expect(gowned, "both gowned bodies must still declare a gown").toContain("ed_chest_pain_adult_cast.glb");
    expect(gowned.length, `gowned bodies: ${gowned.join(", ")}`).toBeGreaterThanOrEqual(2);
  });

  it("(4) VACUITY GUARD: the enumeration sees both classes", () => {
    // Reads what ships, passes today. If the directory were empty or the classifier blind, (1)-(3)
    // would be green about nothing.
    expect(bodies.length, "generated-humanoids must enumerate").toBeGreaterThanOrEqual(15);
    expect(bodies.filter((b) => b.gownDeclared).length, "at least one gowned body").toBeGreaterThan(0);
    expect(bodies.filter((b) => b.lower.length > 0).length, "at least one trousered body").toBeGreaterThan(0);
  });
});
