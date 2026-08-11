import { dirname, resolve as pathResolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OPERATOR DIRECTION 2026-08-11 — the program is now transitioning off Anny-only assets, using Anny as
 * the REFERENCE for MPFB2-generated humanoids. This is the first slice of that transition, and it is the
 * one thing that blocks all of it.
 *
 * THE BLOCKER, measured. `materialize_mpfb_humanoid_candidate.py` accepts **only `--output`** and calls
 * `bpy.ops.mpfb.create_human()` — the UI operator — with no macros, no phenotype, no reference. Every
 * body it produces is the same default human. **Migrating the seven Anny actors today would yield seven
 * identical Aishas.**
 *
 * This is the THIRD instance of the same defect in that one file, and the other two are already fixed
 * within twenty lines of it:
 *
 *   bpy.ops.mpfb.load_face_shape_keys()          -> body_param_stage.load_mpfb_face_shape_keys  (#317)
 *   (no strip at all)                            -> ExportService.bake_modifiers_remove_helpers (#318)
 *   bpy.ops.mpfb.create_human()                  -> **this slice**
 *
 * The documented service is `HumanService.create_human(mask_helpers=True, detailed_helpers=True,
 * extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=None)`
 * (`humanservice.py:1377`). MPFB drives it from `human_info["phenotype"]` itself
 * (`humanservice.py:997-998`), and falls back to `TargetService.get_default_macro_info_dict()` when the
 * dict is None — which is exactly what we are getting today.
 *
 * WHY THE ANNY REFERENCE IS THE INPUT AND NOT A NEW SET OF LITERALS. D11: *"create a humanoid with anny
 * then use that as a reference for creating a humanoid with MPFB… so that anny becomes the reference but
 * you can leverage the clothing options from makeclothes."* Twelve hand-authored body-class floats are
 * exactly what #305 records as the `body_param` station's D9 gap; this slice must not add a second set.
 * The reference measurements already exist — `anny-mpfb-landmark-compare.ts` reads the tracked
 * `.anny_base.obj` references and `inspectAnnyReferenceMpfbMatch` reports the deltas. That module
 * INSPECTS only; nothing consumes it to drive a bake. Wiring it is the point.
 *
 * KNOWN-GOOD COLUMN, real and non-vacuous: `body_param_stage.py` already produces two measurably
 * different people from two different macro sets on the hm08 rail —
 *
 *   body-param-adult_lean_female   stature 1.732 m
 *   body-param-adult_heavy_male    stature 1.697 m   (and different girths, not a uniform scale)
 *
 * So macro-driven distinctness is proven in this repo on the sibling rail. This slice brings the MPFB2
 * materializer up to it.
 *
 * WHERE THE THRESHOLDS COME FROM:
 *
 *   >= 2 distinct bodies.   One body cannot demonstrate distinctness. Not tuned.
 *   stature spread > 20 mm. The hm08 rail's measured spread is 35 mm (1.732 vs 1.697) and #304 records
 *                           that spread surviving as the fix. Twenty is comfortably under the proven
 *                           value and far above export float noise.
 *   girth ratio differs.    THE IMPORTANT ONE. #151's closed headline is *"the humanoid base is chosen
 *                           by height alone… bmi never reaches a vertex"*, and #304 is *"two library
 *                           bodies with opposite phenotypes ship at identical stature"*. A uniform scale
 *                           satisfies a stature bound while producing the same person bigger. Requiring
 *                           the chest:waist ratio to differ refuses that by construction.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                          | (1) | (2) | (3) | result
 *   ---------------------------------------------------|-----|-----|-----|--------
 *   a) today — one default body                        |FAIL |FAIL |pass | REFUSED
 *   b) bake two bodies at different uniform scales     |pass |**FAIL**|pass| REFUSED
 *   c) hand-author a second set of macro literals      |pass |pass |**FAIL**| REFUSED
 *   d) HumanService.create_human(macro_detail_dict=    |     |     |     |
 *      <derived from the Anny reference>)              |pass |pass |pass | ALL PASS
 *
 * (b) is #151 and #304 recurring — a taller copy of the same person clears a stature bound. (c) is the
 * #305 trap: it would work and it would add twelve more hand-authored floats to the station whose D9 gap
 * is hand-authored floats. Clause (3) requires the macro source to be traceable to a tracked Anny
 * reference, which a literal cannot satisfy.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs — only one MPFB2 body exists, so there
 * is nothing to be distinct from. (3) PASSES today vacuously (no macro source at all, so none is a
 * literal) and I am saying so rather than letting it read green (§7t); it becomes load-bearing the
 * moment a second body is produced.
 *
 * NOT TESTED: nothing is rendered and no actor is re-cast. This proves the materializer can make
 * DIFFERENT PEOPLE from Anny references; it does not migrate any station, does not claim the MPFB body
 * matches its Anny reference within any band (that is MADR 0051 §5 and `anny-mpfb-landmark-compare`'s
 * job), and does not touch `humanoid-runtime-asset-url`. Face, garments, hide mask and footwear all
 * already work on this rail (#317/#318/#321/#323) and are expected to keep working per the regression
 * nets in the brief — but no clause here asserts they survive a macro-driven bake.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;
const MATERIALIZER = `${REPO_ROOT}/tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py`;

/** Bodies the MPFB2 materializer has produced. Today: one. */
const MPFB2_GLOB = /^mpfb-.*\.glb$/;

const MIN_DISTINCT_BODIES = 2;
const MIN_STATURE_SPREAD_M = 0.02;

type Body = { id: string; stature: number; chest: number; waist: number };

const io = new NodeIO();

/** Girth proxy: lateral span of the widest band in a height window, on the largest primitive. */
async function measureBody(id: string, rel: string): Promise<Body> {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  let best = 0;
  let verts: [number, number, number][] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos || pos.getCount() <= best) continue;
      if (/hidden|makeclothes|garment|toigo|boot|shoe|scalp|hair/i.test(prim.getMaterial()?.getName() ?? "")) continue;
      best = pos.getCount();
      const el: [number, number, number] = [0, 0, 0];
      verts = [];
      for (let i = 0; i < pos.getCount(); i += 1) {
        const [x, y, z] = pos.getElement(i, el);
        verts.push([x!, y!, z!]);
      }
    }
  }
  const ys = verts.map((v) => v[1]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const H = maxY - minY;
  const span = (lo: number, hi: number): number => {
    const band = verts.filter((v) => {
      const f = (v[1] - minY) / H;
      return f >= lo && f <= hi;
    });
    return band.length ? Math.max(...band.map((v) => Math.abs(v[0]))) * 2 : 0;
  };
  return { id, stature: H, chest: span(0.68, 0.76), waist: span(0.55, 0.62) };
}

async function mpfb2Bodies(): Promise<Body[]> {
  const { readdirSync } = await import("node:fs");
  const dir = `${PUBLIC}/generated-humanoids`;
  const files = readdirSync(dir).filter((f) => MPFB2_GLOB.test(f) && !f.includes("rigged-candidate"));
  return Promise.all(files.map((f) => measureBody(f.replace(/\.glb$/, ""), `generated-humanoids/${f}`)));
}

const bodies = await mpfb2Bodies();
const source = readFileSync(MATERIALIZER, "utf8");

describe("the MPFB2 materializer makes distinct people from Anny references", () => {
  it.fails(
    `(1) RED: the materializer has produced >= ${MIN_DISTINCT_BODIES} bodies with a stature spread > ${MIN_STATURE_SPREAD_M * 1000}mm`,
    () => {
      expect(bodies.length, `MPFB2 bodies found: ${bodies.map((b) => b.id).join(", ")}`).toBeGreaterThanOrEqual(
        MIN_DISTINCT_BODIES,
      );
      const statures = bodies.map((b) => b.stature).sort((a, b) => a - b);
      const spread = statures[statures.length - 1]! - statures[0]!;
      expect(spread, `stature spread (hm08 rail achieves 0.035 m)`).toBeGreaterThan(MIN_STATURE_SPREAD_M);
    },
  );

  it.fails(
    "(2) RED COUNTERWEIGHT: the bodies differ in chest:waist ratio — a uniform scale is refused (#151/#304)",
    () => {
      expect(bodies.length, "MPFB2 bodies").toBeGreaterThanOrEqual(MIN_DISTINCT_BODIES);
      const ratios = bodies.map((b) => (b.waist > 0 ? b.chest / b.waist : 0));
      const spread = Math.max(...ratios) - Math.min(...ratios);
      expect(
        spread,
        `chest:waist ratio spread across ${bodies.map((b) => `${b.id}=${(b.chest / b.waist).toFixed(3)}`).join(", ")}`,
      ).toBeGreaterThan(0.01);
    },
  );

  it(
    "(3) COUNTERWEIGHT (vacuous today, see header): the macro source is a tracked Anny reference, not new literals",
    () => {
      // #305: twelve hand-authored floats are the body_param station's D9 gap. Do not add a second set.
      const hasHardcodedMacroBlock = /macro_detail_dict\s*=\s*\{[^}]*["'](gender|age|muscle|weight)["']\s*:\s*[0-9]/s.test(
        source,
      );
      expect(hasHardcodedMacroBlock, "materializer must not carry an inline macro literal block").toBe(false);
    },
  );
});
