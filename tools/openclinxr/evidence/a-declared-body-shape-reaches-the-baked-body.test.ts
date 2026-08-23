import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { buildActorPhenotypeExport } from "../../../packages/openclinxr/scenario-fixtures/src/actor-phenotype-export.js";

/**
 * **OBSERVABLE: an actor who authors a numeric body identity gets a body shaped by it.**
 *
 * ## MEASURED ON HEAD 81d06dd6, 2026-08-23 — do not re-derive
 *
 * `parent_tara_johnson_v1` authors the most complete numeric identity in the whole shipped bank:
 * `height_cm 166`, `bmi 24`, `build "average_parent"`, `body_profile "adult_standard_parent"`,
 * `gender_presentation "adult_female_parent"`, `age 34`.
 *
 * `patient_aisha_khan_v1` authors NOTHING — it has no entry at all in
 * `buildActorPhenotypeExport()` (the whole 39-row cast produces exactly **4** phenotype entries:
 * maya, tara, kevin, noah).
 *
 * Measured on the bodies those two actors actually cast to, via `resolveScenarioActorCast`:
 *
 *     actor                      body mesh                     verts    stature (m)
 *     parent_tara_johnson_v1     mpfb_ob_patient_aisha_body     10871    1.6658859994495288
 *     patient_aisha_khan_v1      mpfb_ob_patient_aisha_body     10803    1.6658903360366821
 *
 *     max |stature-normalized lateral-profile delta| over 20 height bands  =  0.0000016225330834
 *     |stature delta|                                                      =  0.0000043365871534
 *
 * **The same body, to six decimal places.** A complete authored numeric identity and a total
 * absence of one produce geometry that is indistinguishable. Whatever shaped that mesh, `bmi 24`
 * was not part of it.
 *
 * ## THE SEAM, TRACED — this part IS measured, do not re-derive it
 *
 * `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py`:
 *   - `derive_macro_dict(reference)` at `:1862` takes ONE argument, the measured Anny reference.
 *     It hard-codes `"gender": 0.5` (`:1870`), `"weight": 0.5` (`:1873`), `"proportions": 0.5`
 *     (`:1874`), and muscle/cupsize/firmness alongside them. Only `age` varies, and it varies as a
 *     function of the reference's measured head-height fraction — never of authored `age`.
 *   - `height` is solved separately by `solve_height_macro` (`:1971`) against the REFERENCE's
 *     measured stature, not against `height_cm`.
 *   - `grep -c authoredPhenotype` over that file returns **0**. The only reader of the numeric
 *     block in the whole tree is `tools/openclinxr/asset-pipeline/makeclothes/body_param_stage.py:2148`,
 *     and the cast dropped that rail at #479 — no learner reaches a body it produced.
 *   - What materialize DOES read from `phenotype` is three cosmetic tokens: `skin_tone` (`:170`),
 *     `fabricPalette` (`:191`), `eye_color` (`:213`). Colour, colour, colour.
 *
 * So `height_cm`, `bmi`, `build` and `gender_presentation` reach no MPFB macro. Every adult comes
 * out of the androgynous 0.5 default with a solved height.
 *
 * ## WHY A STATURE TEST WOULD BE VACUOUS — the trap this contract sidesteps
 *
 * All four declaring actors ship at close to their declared height (maya 125 -> 124.10 cm,
 * tara 166 -> 166.59, kevin 176 -> 176.01, noah 125 -> 124.10). A "declared height reaches the
 * mesh" assertion is **green today** and proves nothing, because the Anny reference each body was
 * measured from was itself built to that height by an earlier rail. Height arrives by coincidence
 * of provenance, not by the case definition. Clause (2) keeps that guarantee as the KNOWN-GOOD
 * column; the RED is on the axis where no such coincidence exists.
 *
 * ## WHERE THE FLOOR COMES FROM — borrowed, not chosen
 *
 * `PROFILE_DELTA_FLOOR = 0.01 m / stature`. The 0.01 is `solve_height_macro(..., tol=0.01)` at
 * `materialize_mpfb_humanoid_candidate.py:1971` — the smallest length this pipeline treats as
 * converged rather than noise. It is a **floor**, not a target: it says "a body shaped by bmi 24
 * must differ from the default by at least the pipeline's own resolution", and it is borrowed from
 * a stature tolerance rather than derived from a girth one. Stated plainly so nobody mistakes it
 * for an anatomical bound. The measured delta is 0.0000016, roughly 3,700x under it, so no
 * plausible re-derivation of the floor changes the verdict.
 *
 * ## WHAT A FIX MUST NOT BE — per the card, and clause (4) enforces two of the three
 *
 *   - **Not another cosmetic token.** A fourth colour beside skin_tone/fabricPalette/eye_color
 *     satisfies nothing; the claim is that a NUMBER reaches a macro. This file never asserts that a
 *     phenotype key exists — every assertion is on measured geometry.
 *   - **Not hand-authored per-actor body literals in Python.** D1: wire the proven tool.
 *     `HumanService.create_human(..., macro_detail_dict=...)` is already the call site
 *     (`:1960`, `:2679`); the macro dict is what must stop being a constant.
 *   - **Not a resolver swap that makes two actors share a third body.** Clause (4) pins the
 *     distinct-body-mesh count so the collapse cannot get worse while the RED goes green.
 *
 * ## UNLOCKED DECISIONS — name them in the report
 *
 * Which numeric fields map to which MPFB macros, and what happens when a phenotype declares a value
 * MPFB cannot build. The factory's posture is to REFUSE unbuildable values
 * (`iris_palette.py:73-76` raises on `hazel`) so the adapter above must resolve them (D13:
 * seeded and recorded). Do not silently clamp.
 *
 * ## IF THE PREMISE IS FALSE, SAY SO AND STOP
 *
 * Named falsifier: if `bmi 24` and `gender_presentation "adult_female_parent"` legitimately map to
 * MPFB `weight 0.5` / `gender 0.5` — i.e. the default macros ARE the correct answer for tara — then
 * clause (1) demands a difference that should not exist and **the contract is wrong, not the
 * product**. Stop and say so, with the mapping that shows it.
 *
 * claimScope: whether the body geometry cast for an actor with a complete authored numeric
 *   phenotype differs from the body cast for an actor with none.
 * notEvidenceFor: whether any particular macro mapping is anatomically correct; whether the shipped
 *   bodies look right (that is a pixel grade); clothing, rig, face or texture; the 35 of 39 cast
 *   rows that author no phenotype at all.
 * NOT TESTED: no bake was run. This measures the SHIPPED bytes only, and says nothing about whether
 *   routing the numeric block through `macro_detail_dict` produces an anatomically sane body.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");

/** The two actors compared: one authors a full numeric identity, one authors nothing. */
const DECLARING_SCENARIO = "peds_asthma_parent_anxiety_v1";
const DECLARING_ACTOR = "parent_tara_johnson_v1";
const UNDECLARED_SCENARIO = "ob_headache_preeclampsia_triage_v1";
const UNDECLARED_ACTOR = "patient_aisha_khan_v1";

/** materialize_mpfb_humanoid_candidate.py:1971 — solve_height_macro(..., tol=0.01), in metres. */
const PIPELINE_LENGTH_TOLERANCE_METERS = 0.01;

/** Measured on HEAD 81d06dd6 — recorded so a silent shift is visible in the failure text. */
const MEASURED_PROFILE_DELTA = 0.0000016225330834451768;
const MEASURED_STATURE_DELTA = 0.000004336587153375149;
const MEASURED_PHENOTYPE_ENTRY_COUNT = 4;
const MEASURED_DISTINCT_BODY_MESHES = 6;
const MEASURED_CHILD_STATURE_METERS = 1.2410184621810913;

/** Excludes every non-body primitive so the comparison is skin, not wardrobe. */
const NON_BODY = /hidden|makeclothes|garment|toigo|boot|shoe|scalp|hair|eyelash|eyebrow|teeth|tongue|eyes/iu;
const PROFILE_BANDS = 20;

/**
 * ## CORRECTED 2026-08-23 on HEAD `bced6456` — clause (1) had gone GREEN ON A SHOE SWAP
 *
 * The header above is the HEAD `81d06dd6` record and is NOT rewritten. What changed since is not
 * the premise, it is the instrument.
 *
 * `#598` (`99c56fd5`) rebaked `mpfb-ob-patient-aisha.glb` to swap `toigo_flats` for
 * `toigo_mj_cloth_shoes`. A footwear swap moves the body's wardrobe HIDE-REGION carve at the feet —
 * `openclinxr_hidden_foot_...` is 2164 + 305 verts on tara's bake against 1908 + 572 on aisha's —
 * and with it the band-0 lateral extent. Measured per band, tara vs aisha, on this HEAD:
 *
 *     band  0 (feet)   delta 0.012497201028138338   <-- the ONLY band over the 0.006002811 floor
 *     bands 1-19       delta 0.0000016225330834451768 max, ~3,700x UNDER the floor
 *
 * Band 0's delta is 7,700x every other band's. Nineteen of twenty bands are still identical to six
 * decimal places, so THE CARD'S PREMISE IS UNCHANGED: no number reaches a macro. But a
 * max-over-all-bands signature now passes on wardrobe carving, which is a false green — it would
 * certify a slice that wired nothing.
 *
 * Band 0 is therefore excluded. Note that the max over the remaining bands is
 * `0.0000016225330834451768`, EXACTLY the `MEASURED_PROFILE_DELTA` recorded on `81d06dd6` — the
 * exclusion restores the original measurement rather than choosing a new one.
 *
 * NOT TESTED: whether any other band can be reached by a wardrobe hide-carve. Only the foot carve
 * was measured to move.
 */
const WARDROBE_CARVED_BANDS = 1;

type Attr = { getCount(): number; getElement(i: number, target: number[]): number[] };
type Body = { meshName: string; vertexCount: number; statureMeters: number; profile: number[] };

const bodyCache = new Map<string, Promise<Body>>();

/**
 * Stature-normalized lateral extent (2 x max |x|) in 20 equal height bands of the largest
 * non-wardrobe primitive. Arms are included — both sides are measured identically, so the
 * comparison is a like-for-like shape signature, not an anthropometric girth.
 */
function measureBody(assetPath: string): Promise<Body> {
  const cached = bodyCache.get(assetPath);
  if (cached) return cached;
  const p = (async (): Promise<Body> => {
    const doc = await new NodeIO().read(join(REPO, assetPath));
    let best: Attr | null = null;
    let bestCount = 0;
    let meshName = "";
    for (const mesh of doc.getRoot().listMeshes()) {
      const mn = mesh.getName() ?? "";
      for (const prim of mesh.listPrimitives()) {
        const matName = prim.getMaterial()?.getName() ?? "";
        if (NON_BODY.test(mn) || NON_BODY.test(matName)) continue;
        // CORRECTED 2026-08-23: #576's worker shipped a stray `base.002` at 14517 verts with NO
        // material, larger than the real 11166-vert body, and it cleared NON_BODY. Both clause (1)
        // and clause (4) then measured the leak: profileDelta 0.4008 with band 10 at 0.6099 vs
        // 0.2091, and a stature of 1.6472 read as tara's. A shipped body primitive always carries a
        // material; an unmaterialed mesh is a leaked base, never the subject. Refuse it.
        if (!prim.getMaterial()) continue;
        const pos = prim.getAttribute("POSITION") as Attr | null;
        if (pos && pos.getCount() > bestCount) { bestCount = pos.getCount(); best = pos; meshName = mn; }
      }
    }
    if (!best) throw new Error(`no body primitive in ${assetPath}`);
    const pts: number[][] = [];
    for (let i = 0; i < best.getCount(); i += 1) pts.push(best.getElement(i, [0, 0, 0]));
    const ys = pts.map((v) => v[1]!);
    const lo = Math.min(...ys);
    const stature = Math.max(...ys) - lo;
    const profile: number[] = [];
    for (let k = 0; k < PROFILE_BANDS; k += 1) {
      const band = pts
        .filter((v) => { const f = (v[1]! - lo) / stature; return f >= k / PROFILE_BANDS && f < (k + 1) / PROFILE_BANDS; })
        .map((v) => Math.abs(v[0]!));
      profile.push(band.length ? (2 * Math.max(...band)) / stature : 0);
    }
    return { meshName, vertexCount: bestCount, statureMeters: stature, profile };
  })();
  bodyCache.set(assetPath, p);
  return p;
}

function castAssetPath(scenarioId: string, actorId: string): string {
  const row = resolveScenarioActorCast(scenarioId).find((c) => c.actorId === actorId);
  if (!row) throw new Error(`${actorId} is not cast in ${scenarioId}`);
  return row.assetPath;
}

function phenotypeOf(scenarioId: string, actorId: string): Record<string, unknown> | undefined {
  return buildActorPhenotypeExport().entries[scenarioId]?.[actorId]?.phenotype;
}

describe("a declared body shape reaches the baked body", () => {
  it.fails(
    "(1) RED: the actor who authors bmi/build/gender gets a different body from the actor who authors nothing",
    async () => {
      // Fails today at 0.0000016 against a floor of ~0.0060 because both actors cast to the same
      // mpfb_ob_patient_aisha_body bake. derive_macro_dict:1862 never sees a phenotype, so
      // weight/gender/proportions are the literal 0.5 for every adult in the bank.
      const declared = phenotypeOf(DECLARING_SCENARIO, DECLARING_ACTOR);
      expect(declared?.["bmi"], `${DECLARING_ACTOR} must still author bmi — this is the input under test`).toBe(24);
      expect(
        phenotypeOf(UNDECLARED_SCENARIO, UNDECLARED_ACTOR),
        `${UNDECLARED_ACTOR} is the no-phenotype control and must stay undeclared`,
      ).toBeUndefined();

      const a = await measureBody(castAssetPath(DECLARING_SCENARIO, DECLARING_ACTOR));
      const b = await measureBody(castAssetPath(UNDECLARED_SCENARIO, UNDECLARED_ACTOR));
      const floor = PIPELINE_LENGTH_TOLERANCE_METERS / a.statureMeters;
      // Band 0 excluded: a footwear swap moves the foot hide-carve and nothing else (see
      // WARDROBE_CARVED_BANDS above). bmi/build/gender must show in the body, not in the shoe cut.
      const delta = Math.max(
        ...a.profile
          .slice(WARDROBE_CARVED_BANDS)
          .map((v, i) => Math.abs(v - b.profile[i + WARDROBE_CARVED_BANDS]!)),
      );
      expect(
        delta,
        `${DECLARING_ACTOR} (bmi ${String(declared?.["bmi"])}, build ${String(declared?.["build"])}, `
          + `${String(declared?.["gender_presentation"])}) and ${UNDECLARED_ACTOR} (no phenotype) ship `
          + `bodies whose stature-normalized profiles differ by ${delta} — under the pipeline's own `
          + `${PIPELINE_LENGTH_TOLERANCE_METERS} m resolution, normalized to ${floor}. `
          + `Measured on HEAD 81d06dd6: profile ${MEASURED_PROFILE_DELTA}, stature ${MEASURED_STATURE_DELTA}, `
          + `both meshes named ${a.meshName}/${b.meshName}.`,
      ).toBeGreaterThan(floor);
    },
  );

  it("(2) KNOWN-GOOD COLUMN: declared height still reaches the child body", async () => {
    // Green today: the child declares 125 cm and ships at 124.10 cm, inside the pipeline's own
    // 0.01 m solve tolerance. This is the ONE numeric field that already survives the trip, via the
    // reference-measurement path. A fix for clause (1) that rewrites the macro dict must not lose it.
    const declared = phenotypeOf(DECLARING_SCENARIO, "patient_maya_johnson_v1");
    expect(declared?.["height_cm"], "the peds child must still author height_cm").toBe(125);
    const child = await measureBody(castAssetPath(DECLARING_SCENARIO, "patient_maya_johnson_v1"));
    const declaredMeters = (declared!["height_cm"] as number) / 100;
    expect(
      Math.abs(child.statureMeters - declaredMeters),
      `child body stature ${child.statureMeters} m must stay within ${PIPELINE_LENGTH_TOLERANCE_METERS} m of the `
        + `declared ${declaredMeters} m (measured on HEAD 81d06dd6: ${MEASURED_CHILD_STATURE_METERS})`,
    ).toBeLessThanOrEqual(PIPELINE_LENGTH_TOLERANCE_METERS);
  });

  it("(3) KNOWN-GOOD COLUMN: the authored numeric identity is not deleted to make the question moot", () => {
    // Green today. Deleting tara's phenotype, or the export itself, would make clause (1)
    // unreachable rather than satisfied. Four entries is the shipped bank's real total.
    const ex = buildActorPhenotypeExport();
    const count = Object.values(ex.entries).reduce((n, actors) => n + Object.keys(actors).length, 0);
    expect(count, "the shipped phenotype export must not shrink").toBeGreaterThanOrEqual(MEASURED_PHENOTYPE_ENTRY_COUNT);
    const tara = phenotypeOf(DECLARING_SCENARIO, DECLARING_ACTOR);
    expect(tara?.["height_cm"], "tara height_cm").toBe(166);
    expect(tara?.["bmi"], "tara bmi").toBe(24);
    expect(tara?.["build"], "tara build").toBe("average_parent");
    expect(tara?.["gender_presentation"], "tara gender_presentation").toBe("adult_female_parent");
  });

  it("(4) COUNTERWEIGHT: the fix does not collapse two actors onto a third existing body", async () => {
    // Refuses the cheap green on (1): repoint tara at an existing body that happens to differ from
    // aisha's. That satisfies the delta and makes identity collapse WORSE. Two guards:
    //   - the number of distinct body meshes reachable from the cast may not fall below today's 6;
    //   - tara's body must still stand at her declared height, so she cannot be handed kevin's
    //     176 cm body to manufacture a profile difference.
    const paths = new Set<string>();
    for (const scenarioId of listShippedCastScenarioIds()) {
      for (const row of resolveScenarioActorCast(scenarioId)) {
        if (/\/mpfb-/u.test(row.assetPath)) paths.add(row.assetPath);
      }
    }
    expect(paths.size, "the cast must still reach the MPFB rail").toBeGreaterThanOrEqual(1);
    const meshNames = new Set<string>();
    for (const p of paths) meshNames.add((await measureBody(p)).meshName);
    expect(
      meshNames.size,
      `distinct body meshes across ${paths.size} cast-reachable MPFB assets fell to ${meshNames.size} `
        + `(HEAD 81d06dd6: ${MEASURED_DISTINCT_BODY_MESHES}) — sharing a third body is not a fix`,
    ).toBeGreaterThanOrEqual(MEASURED_DISTINCT_BODY_MESHES);

    const tara = await measureBody(castAssetPath(DECLARING_SCENARIO, DECLARING_ACTOR));
    const declaredMeters = (phenotypeOf(DECLARING_SCENARIO, DECLARING_ACTOR)!["height_cm"] as number) / 100;
    expect(
      Math.abs(tara.statureMeters - declaredMeters),
      `tara's body stature ${tara.statureMeters} m drifted from her declared ${declaredMeters} m — `
        + `clause (1) must be satisfied by SHAPE, not by handing her someone else's height`,
    ).toBeLessThanOrEqual(PIPELINE_LENGTH_TOLERANCE_METERS);
  }, 120000);
});
