import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Poke-through is unmeasured, and the obvious way to measure it does not work.**
 *
 * MADR 0052's 07:00 tick is "one `.mhclo` fitted to a solved MPFB body; **poke-through measured**".
 * #199 landed the fit. The measurement does not exist: `overlapping-garments-do-not-interpenetrate`
 * measures **garment-vs-garment** (kevin's trouser cuff against his boot shaft), never body-vs-garment.
 *
 * ## MY FIRST INSTRUMENT WAS INVALID AND ITS NUMBERS ARE WORTHLESS (measured 2026-08-14 07:2x)
 *
 * Bucketing skin and upper-garment vertices by (angle, height) around the body's central axis and
 * counting skin radially outside the garment envelope:
 *
 *   actor   upper garment       "poking" skin verts    worst
 *   ------  ------------------  -------------------  --------
 *   kevin   fisherman_sweater                   148   48.7 mm
 *   aisha   toigo_t_shirt                     1,512  **479.0 mm**
 *   child   toigo_t_shirt                       782   327.3 mm
 *
 * **479 mm is half a metre.** It is catching **bare arms** — they are skin, they hang at torso height,
 * and they sit outside the shirt's radial envelope at the same angle. **Radius alone cannot separate
 * "an arm beside the torso" from "skin through the shirt"**, because both are skin outside the
 * envelope at that (angle, height). This is the third radial/proximity metric in one session to catch
 * limbs; an earlier one scored boots at 56,864 verts "past the forearm midpoint".
 *
 * ## THE DISCRIMINATOR IS ALREADY ON THE MESH, AND THE TOOL IS PROVEN (D1)
 *
 * The skin primitive carries `JOINTS_0` and `WEIGHTS_0`, and the rig has 137 canonically-named joints:
 *
 *   arm    clavicle.L, shoulder01.L, upperarm01.L, upperarm02.L, lowerarm01.L, lowerarm02.L, ...
 *   torso  pelvis.L, pelvis.R, spine05, spine04, spine03, spine02
 *
 * Classify each skin vertex by its **dominant bone**, not by where it sits in space.
 * `_bone_dominant_vertex_indices` (`body_param_stage.py:724`) already does this — **wire it, do not
 * re-author it.** These are RIG-canonical names, stable across garments, unlike the asset-authored
 * material tokens that broke three gates tonight (#389, #391).
 *
 * ## NO THRESHOLD IS ASSERTED HERE, DELIBERATELY
 *
 * I will not write a bound from a metric I have just shown to be invalid — that is inventing a proof.
 * **This contract asserts that the INSTRUMENT exists and classifies; the slice's first deliverable is
 * the calibration.** A result of "zero poke-through on all three actors" is a successful outcome and
 * closes the tick on a measurement rather than a fix. Whoever adds a bound adds it in a later slice,
 * against the numbers this one produces.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) reports | (2) arms found | (3) classified | result
 *   ----------------------------------------------------|-------------|----------------|----------------|--------
 *   a) today — no instrument                           |  **FAIL**   |    **FAIL**    |    **FAIL**    | REFUSED
 *   b) port my radial metric unchanged                 |    pass     |    **FAIL**    |    **FAIL**    | REFUSED
 *   c) classify every skin vertex as torso             |    pass     |    **FAIL**    |    **FAIL**    | REFUSED
 *   d) classify by dominant bone, measure torso only   |    pass     |      pass      |      pass      | ALL PASS
 *
 * **(b) and (c) are the ones to watch.** Both produce a report and a number, and a contract that only
 * checked "a reading exists" would grade either as done. Clause (2) requires the instrument to have
 * FOUND arm-dominant vertices and excluded them — a classifier that excludes nothing cannot pass it.
 * Clause (3) requires torso skin to be a proper subset of all skin, so "everything is torso" fails.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails today because no module exists.
 * (2) and (3) are counterweights that ALSO fail today — unavoidable, since they read the same absent
 * report — and they are what stops (1) being satisfied by a reading that measures the wrong thing.
 *
 * NOT TESTED:
 *   - **Whether poke-through exists at all.** No claim in either direction; my numbers do not support one.
 *   - **Lower garments and footwear.** Upper only.
 *   - **Hide-mask interaction.** `openclinxr_hidden_*` primitives are non-drawing (alphaMode MASK,
 *     alpha 0), so body faces under a garment already do not render. Whether that makes some
 *     poke-through invisible — and therefore not worth gating — is undetermined and matters for the
 *     bound a later slice chooses.
 *   - **Pose.** Bind pose only. Poke-through classically appears under motion.
 *
 * ## FIXED (#392) — 2026-08-14, measured on the shipped bytes
 *
 * `torso-poke-through.ts` implements the bone-classified instrument. Every visible-skin vertex
 * (`^mpfb_skin_` material; `openclinxr_hidden_*` primitives are non-drawing and excluded) is
 * classified by its dominant joint — argmax WEIGHTS_0, first-wins ties, the same rule as
 * `_bone_dominant_vertex_indices` (body_param_stage.py:741) — against the exact `_LIMB_BONE_RE`
 * vocabulary (body_param_stage.py:738: arm|forearm|hand|wrist|finger|thumb|metacarpal). Only
 * torso-dominant skin is compared against the upper garment's per-(angle, height) radial envelope
 * (36 buckets x 16 mm bands, garment XZ centroid, 2 mm surface-noise tolerance). The Python
 * classifier is Blender-bound (no bpy in a TS evidence module), so the exported JOINTS_0/WEIGHTS_0
 * are read with the same algorithm and vocabulary — a port of the proven classifier, not a second
 * one. Arms are excluded by construction: the 479 mm radial reading on aisha was bare arms beside
 * the torso, not fabric failure.
 *
 * Calibration artifact: `.openclinxr/evidence/issue-392/torso-poke-through-calibration.json`.
 *
 *   actor   upper garment      torso skin   arm excluded   poking   worst
 *   ------  -----------------  -----------  -------------  -------  ------
 *   kevin   fisherman_sweater        4,811          4,261        0   0.0 mm
 *   aisha   toigo_t_shirt            6,468          4,412        2   3.9 mm
 *   child   toigo_t_shirt            5,584          4,406        3  10.2 mm
 *
 * Zero mid-fabric poke-through on all three. The 5 residual vertices (aisha 2, child 3) all sit in
 * cells whose garment geometry is a single-height rim — the collar edge and the hem edge — where
 * skin adjacency is expected; no fabric-covered cell shows skin beyond the envelope. Whether
 * sub-centimetre rim adjacency renders (hide-mask interaction) is NOT TESTED and matters for the
 * bound a later slice chooses. No threshold is asserted here, per the issue.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** The module this slice must create. */
const MODULE_PATH = join(HERE, "torso-poke-through.ts");
/** Computed so TypeScript cannot resolve a not-yet-existing module at compile time (#383/#352). */
const MODULE_SPECIFIER = ["./torso", "poke", "through.js"].join("-");

const MPFB_ACTORS = [
  "mpfb-peds-nurse-kevin",
  "mpfb-ob-patient-aisha",
  "mpfb-peds-patient-child",
] as const;

type PokeRow = {
  actorId: string;
  garment: string;
  totalSkinVerts: number;
  torsoSkinVerts: number;
  armSkinExcluded: number;
  pokingVerts: number;
  worstMm: number;
};

async function loadReport(): Promise<PokeRow[] | null> {
  if (!existsSync(MODULE_PATH)) return null;
  try {
    const mod = (await import(MODULE_SPECIFIER)) as {
      measureTorsoPokeThrough?: () => Promise<PokeRow[]> | PokeRow[];
    };
    if (typeof mod.measureTorsoPokeThrough !== "function") return null;
    return await mod.measureTorsoPokeThrough();
  } catch {
    return null;
  }
}

const rows = await loadReport();

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireReport(): PokeRow[] {
  expect(
    rows,
    `${MODULE_PATH} must export measureTorsoPokeThrough() returning one row per MPFB actor`,
  ).not.toBeNull();
  expect(rows?.length ?? 0, "MPFB actors measured").toBeGreaterThanOrEqual(MPFB_ACTORS.length);
  return rows as PokeRow[];
}

describe("poke-through is measured on torso skin only", () => {
  it("(1) RED: every MPFB actor has a torso poke-through reading", () => {
    const report = requireReport();
    const missing = MPFB_ACTORS.filter((a) => !report.some((r) => r.actorId.includes(a)));
    expect(missing, "MPFB actors with no poke-through row").toEqual([]);
    for (const r of report) {
      expect(r.torsoSkinVerts, `${r.actorId}: torso skin vertices measured`).toBeGreaterThan(0);
      expect(Number.isFinite(r.worstMm), `${r.actorId}: worstMm is a real number`).toBe(true);
    }
  });

  it("(2) COUNTERWEIGHT: the instrument FOUND arm skin and excluded it", () => {
    // Refuses (b) and (c). A radial port or an everything-is-torso classifier both produce a reading;
    // neither can show it located arm-dominant vertices. Arms are ~1/6 of a humanoid's skin, so any
    // real bone classification finds thousands.
    const report = requireReport();
    const noArms = report
      .filter((r) => r.armSkinExcluded <= 0)
      .map((r) => `${r.actorId}: armSkinExcluded=${r.armSkinExcluded} — nothing was classified as arm`);
    expect(noArms, "actors where no arm skin was found to exclude").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: torso skin is a proper subset of all skin", () => {
    // Refuses (c) from the other side: if torsoSkinVerts === totalSkinVerts the classifier did nothing,
    // and the reading is my invalid radial metric wearing a new name.
    const report = requireReport();
    const unclassified = report
      .filter((r) => r.totalSkinVerts <= 0 || r.torsoSkinVerts >= r.totalSkinVerts)
      .map((r) => `${r.actorId}: torso=${r.torsoSkinVerts} of total=${r.totalSkinVerts} — no classification happened`);
    expect(unclassified, "actors whose skin was not actually classified").toEqual([]);
  });
});
