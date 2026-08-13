import { dirname, resolve as pathResolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The MPFB2 patient a learner meets in the OB triage station has no face.
 *
 *   mpfb-ob-patient-aisha.glb    137 joints, 10 morph targets, ZERO mouth or expression targets
 *
 * Her 10 targets are macro-detail body dials leaked in as shape keys (`$md-$as-$fe-$yn`,
 * `$md-universal-$ma-$yn-$av$mu-$av$wg`, ...). She is wired in at `humanoid-runtime-asset-url.ts:67`
 * and loaded at `main.ts:7072`. `mpfb-ob-patient-aisha-rigged-candidate.glb` is the SAME FILE (both
 * 4,994,172 bytes, verified) — there is no second, better Aisha.
 *
 * THE MECHANISM IS ONE LINE, and it is a D1 violation of the kind that cannot fail loudly.
 * `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py:70` calls
 * `bpy.ops.mpfb.load_face_shape_keys()` — the MPFB **UI operator**. It reads `FACEOPS_PROPERTIES`
 * from the panel, finds nothing set in a headless run, warns, and returns `FINISHED`. The bake has
 * looked green since it shipped.
 *
 * THE PROVEN TOOL IS ALREADY IN THIS REPO AND ALREADY WORKS. `body_param_stage.py:1206`
 * `load_mpfb_face_shape_keys(basemesh)` walks the MPFB extension target tree and calls
 * `TargetService.filename_to_shapekey_name(...)` + `TargetService.load_target(basemesh, path,
 * weight=0.0, name=...)` directly. That is the path that gave the two hm08 library bodies their 13
 * working mouth targets and 27 face targets total. D11 states plainly that face shape keys and
 * phonemes are MPFB's job; this is that job, undone by a call to the wrong entry point.
 *
 * CALIBRATION — measured 2026-08-11, largest morph-carrying primitive per file (§8o, §9h):
 *
 *   rail                          | verts  | face | empty | whole-body | usable mouth | verdict
 *   ------------------------------|--------|------|-------|------------|--------------|--------
 *   body-param-adult_lean_female  | 34,112 |  27  |   0   |     0      |      13      | GOOD
 *   body-param-adult_heavy_male   | 39,262 |  27  |   0   |     0      |      13      | GOOD
 *   mpfb-ob-patient-aisha         | 18,948 | **0**|   0   |     0      |    **0**     | BAD
 *
 * "usable" = the target displaces at least one vertex AND displaces fewer than half of them. Both
 * halves are load-bearing: an empty shape key is not a face, and neither is a whole-body offset.
 *
 * A THIRD MEASUREMENT ERROR OF MINE, caught by clause (4) firing on the first run. Aisha's ten
 * macro-detail dials include six that displace >50% of the body and two that displace nothing, so a
 * blanket "no whole-body targets" rule reds on her TODAY — but a macro-detail dial is a body-shape
 * control and moving the whole body is exactly its job. That was my instrument being wrong, not the
 * asset. Every empty / whole-body clause below is therefore scoped to FACE-NAMED targets, which the
 * `$md-...` dials are not.
 *
 * WHY THE ANNY RAIL IS NOT ASSERTED ON HERE. All seven Anny-rail actors ship 15 whole-body "face"
 * morphs and the peds child ships 8 empty visemes — measured, filed as **#316**, and NOT in scope
 * here because its fix direction is genuinely undecided (region-bound the placeholder arithmetic, or
 * migrate the rail to MPFB). Asserting on it now would be a contract nobody is sanctioned to satisfy.
 * The population inspect this slice lands is what #316 needs to size its own harm.
 *
 * TWO MEASUREMENT ERRORS OF MINE, both caught before planting, both the same class — a heuristic
 * picked the wrong mesh and answered confidently:
 *
 *   1. Reading only the FIRST primitive of each mesh measured four of Anny's visemes at 0.00 mm and
 *      I concluded they were empty stubs. Wrong — those were GARMENT meshes, which correctly carry
 *      zero-delta targets to keep the morph index aligned.
 *   2. Selecting "the body" as the LARGEST primitive returned
 *      `makeclothes_library_civilian_shirt_adult` at 34,568 verts — which outweighs the 34,112-vert
 *      body and has no morphs — so the library rail measured as having ZERO mouth targets.
 *
 * The selector below is therefore the largest primitive THAT CARRIES MORPH TARGETS. Both qualifiers
 * are load-bearing; a clothed humanoid can out-vertex its own body. If you change it, re-check every
 * rail.
 *
 * WHERE THE THRESHOLDS COME FROM — both external, neither fitted to an observation (§9s):
 *
 *   >= 8 usable mouth targets.  Rhubarb ships 9 English mouth shapes (A-I); Preston Blair uses 10.
 *                               Eight is a floor below any usable lip-sync inventory. The good
 *                               column is 13, so it is not reverse-engineered from the observation.
 *   <  50% displaced.           Anatomical: a mouth is not half a body. The good column tops out at
 *                               13.4%. No value between 14% and 97% changes any verdict in the
 *                               measured population, so the exact number is not load-bearing.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                            | (1) | (2) | (3) | (4) | result
 *   -----------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today                                             |FAIL |FAIL | pass| pass| REFUSED
 *   b) rename Aisha's 10 macro-detail body dials         |FAIL |FAIL | pass| pass| REFUSED
 *   c) add 8 empty zero-delta targets named viseme_*     |FAIL |FAIL | pass| pass| REFUSED
 *   d) copy the Anny per-vertex arithmetic onto Aisha    |FAIL*|FAIL | pass| pass| REFUSED
 *   e) load MPFB targets via TargetService.load_target   | pass| pass| pass| pass| ALL PASS
 *
 * (b) and (c) are refused because (1) counts only targets that DISPLACE and are LOCALISED — a
 * renamed body dial and an empty key each fail one half. (d) is the important one: the Anny rail's
 * approach produces whole-body deltas (that is #316), so importing it here fails the same clause.
 * There is no way to satisfy (1) except with real, localised face geometry.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today. (3) is the
 * known-good column and passes today on real data — the MPFB library rail already works and a fix
 * must not trade one rail's face for another's.
 *
 * (4) IS DELIBERATELY VACUOUS TODAY AND I AM SAYING SO RATHER THAN LETTING IT READ AS A GREEN (§7t).
 * Aisha has zero face-named targets, so "every face-named target is non-empty and localised" is true
 * of an empty set. It is a constraint on the FIX, not a description of the present: it becomes
 * load-bearing the instant the fix adds a single face target, and it is what refuses treatments (c)
 * and (d) above. A counterweight that only bites after the change is still a counterweight; a
 * counterweight nobody declares as vacuous is a lie by omission.
 *
 * NOT TESTED: nothing is rendered and no face is animated. This measures morph-target geometry in the
 * shipped file. Whether a driven target reads as expression or speech, and whether the MPFB FACS unit
 * names map onto a phoneme set (they do NOT ship as `viseme_*` — that mapping is a separate slice)
 * are both out of scope. The <50% bound is applied to the largest morph-carrying primitive only: a
 * small mesh that genuinely IS a mouth or teeth could legitimately move 100% of itself, so applying
 * it everywhere would be wrong (D4). Nothing here claims Aisha's face is well modelled — only that
 * she has one.
 *
 * ## FIXED (#317)
 *
 * `materialize_mpfb_humanoid_candidate.py` replaced `bpy.ops.mpfb.load_face_shape_keys()` (the MPFB
 * UI operator — reads `FACEOPS_PROPERTIES` from the panel, finds nothing in a headless run, warns,
 * returns `FINISHED`) with the proven `TargetService.load_target` path:
 * `body_param_stage.load_mpfb_face_shape_keys(human)` (body_param_stage.py:1206), which walks the
 * MPFB extension target tree and loads 32 FACS targets (13 mouth, 6 eye, 8 eyebrow, 4 nose, 1 neck)
 * at weight 0.0. The `it.fails` markers on (1) and (2) were flipped to `it`.
 *
 * A SECOND DEFECT SURFACED BY THE CENSUS and fixed in the same generator: the #222 scalp-region
 * Z-flip was wrong. Its comment assumed MPFB `create_human` faces +Y; measured, the nose tip is at
 * y=-0.168 (face at -Y) — exactly what `apply_mesh_native_scalp_hair_material_region`'s Z-height
 * branch expects. The flip pushed the face to +Y, the face-band exclusion never fired
 * (`skippedFaceFrontFaceCount: 0`), and the scalp paint covered the eyes/brows. On export the
 * eye/brow/neck/nose-compression deltas were stranded on the scalp-material primitive, so the
 * largest-morph-carrying-primitive selector read them as empty (15 empty face targets) even though
 * the file carried them. Removing the flip yields a crown-only scalp and all 32 FACS targets
 * non-empty and localised on the body primitive.
 *
 * Measured after the fix (largest morph-carrying primitive):
 *
 *   rail                      | verts  | face | empty | whole-body | usable mouth | verdict
 *   --------------------------|--------|------|-------|------------|--------------|--------
 *   mpfb-ob-patient-aisha     | 20,052 |  31  |   0   |     0      |      13      | GOOD
 *
 * The census artifact (`.openclinxr/evidence/face-morph-census/face-morph-census.json`, written by
 * `tools/openclinxr/evidence/face-morph-census.ts`) covers all ten runtime rails for #316.
 *
 * ## FIXED (#359)
 *
 * The vacuity guard's `bodyVerts > 10,000` floor was calibrated to the pre-#359 aisha body, whose
 * morph targets rode on ONE merged skin primitive (13,380 verts after the #318 strip; 13,025 in the
 * census's measurement). #359 reinstates the scalp region as a SEPARATE primitive on the body mesh
 * (the Anny mechanism; the #341 texture route that merged the scalp into the skin primitive is
 * removed), so the skin primitive — the largest morph-carrying primitive — now has 9,822 verts
 * (morph targets intact: 32 targets, 11,426 moved deltas, 13 usable mouth targets; the scalp prim
 * carries the same 32 targets with 104 moved deltas on its 1,285 verts). The floor moves to 5,000 —
 * still far above the next-largest primitive (the 2,164-vert hidden-foot prim) so the vacuity guard
 * keeps its job — and the mouth-target clauses are unchanged.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;

/** The census artifact this slice must land, so #316 can size its own harm from data. */
const CENSUS = `${REPO_ROOT}/.openclinxr/evidence/face-morph-census/face-morph-census.json`;

const MOUTH_NAME = /mouth|lip|jaw|viseme/i;
/**
 * Face-named targets only. MPFB macro-detail dials (`$md-$as-$fe-$yn`, `$md-universal-...`) are
 * BODY-SHAPE controls and legitimately displace the whole mesh — see the header's third measurement
 * error. Excluding them is why the empty / whole-body clauses measure faces rather than anatomy.
 */
const FACE_NAME = /mouth|lip|jaw|viseme|brow|eye|smile|frown|cheek|squint|blink|nose|chin|forehead/i;
const MOVED_EPSILON_M = 1e-5;
const MIN_USABLE_MOUTH_TARGETS = 8;
const MAX_MOVED_FRACTION = 0.5;

const SUBJECT = "generated-humanoids/mpfb-ob-patient-aisha.glb";
const KNOWN_GOOD = [
  "xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
  "xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb",
] as const;

type Census = {
  bodyVerts: number;
  usableMouth: string[];
  emptyTargets: string[];
  wholeBodyTargets: string[];
};

const io = new NodeIO();

/**
 * Measures the largest primitive that CARRIES MORPH TARGETS — the body. See the header for the two
 * wrong readings that "first primitive" and "largest primitive" each produced.
 */
async function census(rel: string): Promise<Census> {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  let bodyVerts = 0;
  let out: Census = { bodyVerts: 0, usableMouth: [], emptyTargets: [], wholeBodyTargets: [] };

  for (const mesh of doc.getRoot().listMeshes()) {
    const targetNames = ((mesh.getExtras() as Record<string, unknown>)?.targetNames as string[]) ?? [];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos || prim.listTargets().length === 0 || pos.getCount() <= bodyVerts) continue;

      bodyVerts = pos.getCount();
      const next: Census = { bodyVerts, usableMouth: [], emptyTargets: [], wholeBodyTargets: [] };
      const el: [number, number, number] = [0, 0, 0];

      prim.listTargets().forEach((target, index) => {
        const name = targetNames[index] ?? `#${index}`;
        const delta = target.getAttribute("POSITION");
        let moved = 0;
        if (delta) {
          for (let i = 0; i < delta.getCount(); i += 1) {
            const [dx, dy, dz] = delta.getElement(i, el);
            if (Math.hypot(dx!, dy!, dz!) > MOVED_EPSILON_M) moved += 1;
          }
        }
        const isFace = FACE_NAME.test(name);
        if (moved === 0) {
          if (isFace) next.emptyTargets.push(name);
          return;
        }
        if (moved / bodyVerts >= MAX_MOVED_FRACTION) {
          if (isFace) next.wholeBodyTargets.push(name);
          return;
        }
        if (MOUTH_NAME.test(name)) next.usableMouth.push(name);
      });
      out = next;
    }
  }
  return out;
}

const subject = await census(SUBJECT);
const knownGood = await Promise.all(KNOWN_GOOD.map(async (g) => ({ id: g, ...(await census(g)) })));

/** An unmeasured subject must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  // #359: the skin primitive (the largest morph-carrying primitive) is 9,822 verts since the
  // scalp region became a separate primitive; 5,000 still sits above the next-largest prim
  // (2,164) so the vacuity guard is intact.
  expect(subject.bodyVerts, "aisha body mesh measured").toBeGreaterThan(5_000);
  for (const g of knownGood) {
    expect(g.bodyVerts, `${g.id} body mesh measured`).toBeGreaterThan(30_000);
  }
}

describe("the MPFB2 actor a learner meets has a face, loaded from real MPFB targets", () => {
  it(
    `(1) RED: aisha carries >= ${MIN_USABLE_MOUTH_TARGETS} mouth targets that displace vertices AND stay localised`,
    () => {
      requireMeasured();
      expect(
        subject.usableMouth.length,
        `aisha usable mouth targets (empty=${subject.emptyTargets.length}, whole-body=${subject.wholeBodyTargets.length})`,
      ).toBeGreaterThanOrEqual(MIN_USABLE_MOUTH_TARGETS);
    },
  );

  it(
    "(2) RED: a face-morph census over every runtime humanoid is written to disk, so #316 can size its harm from data",
    () => {
      expect(existsSync(CENSUS), `census artifact at ${CENSUS}`).toBe(true);
      const parsed = JSON.parse(readFileSync(CENSUS, "utf8")) as {
        rails?: Array<{ assetPath?: string; bodyVerts?: number; usableMouth?: number }>;
      };
      const rails = parsed.rails ?? [];
      // The runtime resolves ten distinct humanoid GLBs; a census of one is not a census.
      expect(rails.length, "rails in the census").toBeGreaterThanOrEqual(9);
      const thin = rails.filter((r) => !r.assetPath || typeof r.bodyVerts !== "number" || typeof r.usableMouth !== "number");
      expect(thin, "census rows missing assetPath / bodyVerts / usableMouth").toEqual([]);
      const named = rails.map((r) => r.assetPath ?? "");
      for (const required of ["mpfb-ob-patient-aisha", "peds_patient_child", "body-param-adult_lean_female"]) {
        expect(named.some((n) => n.includes(required)), `census covers ${required}`).toBe(true);
      }
    },
  );

  it("(3) NET known-good: the MPFB library rail keeps its 13 localised mouth targets", () => {
    requireMeasured();
    for (const g of knownGood) {
      expect(g.usableMouth.length, `${g.id} usable mouth targets`).toBeGreaterThanOrEqual(13);
      expect(g.wholeBodyTargets, `${g.id} whole-body morphs`).toEqual([]);
      expect(g.emptyTargets, `${g.id} empty shape keys`).toEqual([]);
    }
  });

  it(
    "(4) COUNTERWEIGHT ON THE FIX (vacuous today, see header): every FACE-NAMED target on aisha is non-empty and localised",
    () => {
      requireMeasured();
      expect(subject.emptyTargets, "aisha empty face shape keys").toEqual([]);
      expect(
        subject.wholeBodyTargets,
        "aisha whole-body face morphs — the Anny rail's approach (#316) is refused here",
      ).toEqual([]);
    },
  );
});
