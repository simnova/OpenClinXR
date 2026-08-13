import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * A learner walking into the peds asthma station sees a child, a parent and a NURSE wearing
 * byte-identical clothes. Role identification is part of the encounter, so this is a clinical-realism
 * defect, not a polish item.
 *
 * MEASURED 2026-08-12 on the shipped bytes, for the cast `humanoid-runtime-asset-url.ts:146` resolves:
 *
 *   role                              t-shirt base colour        trousers base colour       texture
 *   -------------------------------   ------------------------   ------------------------   -------
 *   patient_maya_johnson_v1 (child)   (0.300, 0.450, 0.620)      (0.320, 0.360, 0.420)      0 KB
 *   parent_tara_johnson_v1 (aisha)    (0.300, 0.450, 0.620)      (0.320, 0.360, 0.420)      0 KB
 *   nurse_kevin_lee_v1 (Kevin)        (0.300, 0.450, 0.620)      (0.320, 0.360, 0.420)      0 KB
 *
 * Identical to three decimal places on both garments, all three actors. Only the footwear assets
 * differ, and all three are the same near-black (0.100, 0.090, 0.080).
 *
 * ## TWO PROVEN THINGS EXIST AND NEITHER IS CONSUMED ON THIS RAIL
 *
 * **1. The palette function was written for this exact issue.**
 * `tools/openclinxr/asset-pipeline/anny/automate_blender.py:1748` defines
 * `garment_shell_color(kind, actor_role, phenotype)` whose docstring says, verbatim:
 *
 *   > "#180a: break the kind→colour monopoly so co-present actors do not share a primary garment
 *   > material by construction. Gown and scrub_top colours are locked (counterweight for #180b
 *   > encounter-distance legibility)."
 *
 * It is called at `:3561` — on the **Anny rail only**. `materialize_mpfb_humanoid_candidate.py`
 * contains **zero** references to it or to `actor_role`, and hardcodes the colour instead at `:2019`:
 * `make_material("mat_makeclothes_library_toigo_t_shirt", (0.30, 0.45, 0.62, 1.0))`.
 *
 * **2. A real scrub shirt is cached and unused.**
 * `.openclinxr-local/provider-cache/garments/sources/makehuman-community-scrub-shirt/Scrub_Shirt.mhclo`
 * exists, and its **max vertex reference is 11,018 — below the 13,380 basemesh limit**, so it fits the
 * helper-stripped body. That check matters here: 20 of the 23 CC0 shoes in `makehuman-shoes01` are
 * unusable precisely because their refs exceed 13,380 (#318), so "in the cache" and "usable on this
 * rail" have already proved to be different questions. This one is usable.
 *
 * So the nurse can wear an actual scrub rather than a recoloured t-shirt, and the colours can diverge
 * through a function that already encodes the clinical locks. Both are wiring jobs (D1).
 *
 * ## THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting
 *
 *   treatment                                     | (1) colours differ | (2) nurse not in a tee | (3) footwear kept | (4) coverage kept | result
 *   ----------------------------------------------|--------------------|------------------------|-------------------|-------------------|--------
 *   a) today                                      |     **FAIL**       |       **FAIL**         |       pass        |       pass        | REFUSED
 *   b) recolour the same t-shirt per actor        |       pass         |       **FAIL**         |       pass        |       pass        | REFUSED
 *   c) give the nurse a scrub, leave colours alone|     **FAIL**       |         pass           |       pass        |       pass        | REFUSED
 *   d) wire the palette AND the scrub asset       |       pass         |         pass           |       pass        |       pass        | ALL PASS
 *
 * (b) is the one to worry about — a one-line colour change satisfies the obvious clause and leaves a
 * nurse in a differently-coloured t-shirt, which is not a nurse. Clause (2) requires the upper garment
 * ASSET to differ between the clinician and the patients, which a recolour cannot satisfy.
 * (c) is the mirror: a correct asset with a shared palette still leaves the two patients identical.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and both fail today. (3) and (4) pass
 * today and are regression nets — footwear is ALREADY per-actor distinct, which is the known-good
 * proving this pipeline can vary a garment per actor, and coverage is what #341 round 17 and #351 each
 * spent a slice establishing.
 *
 * NOT TESTED:
 *   - **Colour DISTANCE, not appearance.** Two colours can differ numerically and still read the same
 *     across a room; this contract cannot see encounter distance, which is the #180b half the palette
 *     function's own docstring names. Only a staged capture settles that.
 *   - **Whether the scrub is the clinically right garment.** A scrub top for a peds nurse is a
 *     "close enough" staging judgement (§8u), not a clinician's sign-off.
 *   - **Garment TEXTURE is out of scope and still zero on every actor.** Distinct colours fix
 *     identification; they do not make cloth look like cloth. Deliberately a separate slice.
 *   - **The peds cast only.** It is the one station whose three actors are all MPFB today.
 *
 * ## FIXED (#180)
 *
 * WIRING, 2026-08-12, measured pre-fix in `.openclinxr/evidence/mpfb-cast-separability/pre-fix.json`:
 * (a) `automate_blender.garment_shell_color` is importable from the MPFB rail (the same lazy
 * import the materializer already uses for the scalp-hair region) and returns, with an empty
 * phenotype: `kind="scrub"` -> locked (0.05, 0.48, 0.52) for every role; `kind="closed_casual"` ->
 * patient (0.72, 0.68, 0.55) vs parent/family (0.42, 0.36, 0.40). (b) `ClothesService` accepts
 * `Scrub_Shirt.mhclo` against the #318 stripped basemesh (max ref 11,018 < 13,380; smoke fit ok,
 * 9,384 tris, torso span).
 *
 * FIX: `materialize_mpfb_humanoid_candidate.py` now takes `--actor-role` and consumes the palette
 * function as-is (no copied table): the nurse's upper is the real CC-BY `Scrub_Shirt.mhclo` asset
 * with the locked scrub colour, the patients keep the CC0 toigo t-shirt with the closed_casual role
 * fallback; the lower follows the same palette call so both slots are pairwise distinct. The
 * clinician is a nurse by wearing a scrub, not by recolouring a t-shirt (probed, refused).
 * Re-baked all three cast actors. Post-fix measured on the shipped bytes (NodeIO):
 *
 *   role                              upper kind        upper base colour   lower base colour   footwear asset
 *   -------------------------------   ----------------  -----------------   -----------------   ----------------
 *   patient_maya_johnson_v1 (child)   toigo_t_shirt     (0.720, 0.680, 0.55) (0.720, 0.680, 0.55) toigo_mj_cloth_shoes
 *   parent_tara_johnson_v1 (aisha)    toigo_t_shirt     (0.420, 0.360, 0.40) (0.420, 0.360, 0.40) toigo_flats
 *   nurse_kevin_lee_v1 (Kevin)        scrub_shirt       (0.050, 0.480, 0.52) (0.050, 0.480, 0.52) culturalibre_male_boots
 *
 * Upper colours pairwise distinct (>=0.30 in a channel), lower colours pairwise distinct, nurse
 * upper asset != patients' t-shirt. Clauses (1) and (2) flipped; (3)/(4) hold (footwear still
 * per-actor distinct; shirt/trouser overlap re-measured in the sibling contracts).
 *
 * NOT TESTED (unchanged residual): colour DISTANCE is not appearance — the staged lit capture
 * (group-front + per-actor, EEVEE) is the orchestrator's grade. The scrub is a "close enough"
 * staging judgement, not a clinician's sign-off. Garment TEXTURE stays zero on every actor.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** The peds asthma cast, per `humanoid-runtime-asset-url.ts:146`. */
const CAST = [
  { role: "patient", clinician: false, file: "mpfb-peds-patient-child.glb" },
  { role: "family", clinician: false, file: "mpfb-ob-patient-aisha.glb" },
  { role: "nurse", clinician: true, file: "mpfb-peds-nurse-kevin.glb" },
] as const;

/** Base-colour channels differing by less than this read as the same material. */
const MIN_CHANNEL_DELTA = 0.05;

/** Ambient shirt/trouser overlap is 13.4-19.6 mm (#341 round 17, #351). */
const MIN_OVERLAP_MM = 8;

type Garment = { kind: string; rgb: [number, number, number] };
type Row = { file: string; role: string; clinician: boolean; upper?: Garment; lower?: Garment; footwear?: Garment; overlapMm: number };

const io = new NodeIO();

async function measure(entry: (typeof CAST)[number]): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, GENERATED, entry.file));
  const row: Row = { file: entry.file, role: entry.role, clinician: entry.clinician, overlapMm: 0 };
  let pantsTop = -Infinity;
  let shirtBot = Infinity;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) continue;
      if (mat.getAlphaMode() === "MASK" && (mat.getBaseColorFactor()?.[3] ?? 1) === 0) continue;
      const name = mesh.getName();
      const c = mat.getBaseColorFactor() ?? [0, 0, 0, 1];
      const rgb: [number, number, number] = [c[0]!, c[1]!, c[2]!];
      // Garment ASSET id, stripped of the per-actor suffix: `..._library_<asset>_mpfb_<actor>_mesh`.
      const kind = name.replace(/^.*?library_/, "").replace(/_mpfb[_-].*$/, "");
      const pos = prim.getAttribute("POSITION");
      if (/t_shirt|scrub|shirt|gown|top/i.test(name)) {
        row.upper = { kind, rgb };
        if (pos) for (let i = 0; i < pos.getCount(); i++) {
          const y = (pos.getElement(i, [0, 0, 0]) as number[])[1]!;
          if (y < shirtBot) shirtBot = y;
        }
      } else if (/pants|trouser/i.test(name)) {
        row.lower = { kind, rgb };
        if (pos) for (let i = 0; i < pos.getCount(); i++) {
          const y = (pos.getElement(i, [0, 0, 0]) as number[])[1]!;
          if (y > pantsTop) pantsTop = y;
        }
      } else if (/footwear|shoe|boot/i.test(name)) {
        row.footwear = { kind, rgb };
      }
    }
  }
  if (!row.upper || !row.lower) return null;
  row.overlapMm = Number.isFinite(pantsTop) && Number.isFinite(shirtBot) ? (pantsTop - shirtBot) * 1000 : 0;
  return row;
}

const rows = (await Promise.all(CAST.map((c) => measure(c).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `peds cast actors with upper+lower garments (of ${CAST.length})`).toBe(CAST.length);
}

const sameColour = (a: Garment, b: Garment): boolean =>
  a.rgb.every((v, i) => Math.abs(v - b.rgb[i]!) < MIN_CHANNEL_DELTA);

describe("a station cast is visually separable", () => {
  it("(1) RED (FIXED #180): no two actors share a primary garment colour", () => {
    requireRows();
    const clashes: string[] = [];
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++)
        for (const slot of ["upper", "lower"] as const) {
          const a = rows[i]![slot];
          const b = rows[j]![slot];
          if (a && b && sameColour(a, b))
            clashes.push(`${rows[i]!.role}/${rows[j]!.role} ${slot}: both (${a.rgb.map((v) => v.toFixed(3)).join(", ")})`);
        }
    expect(clashes, "co-present actors sharing a garment colour").toEqual([]);
  });

  it("(2) RED (FIXED #180): the clinician's upper garment is not the patients' t-shirt", () => {
    // Refuses a recolour: a differently-coloured t-shirt is not a nurse. `Scrub_Shirt.mhclo` is
    // cached and its max vertex ref is 11,018 (< 13,380), so it fits the helper-stripped body.
    requireRows();
    const clinician = rows.find((r) => r.clinician);
    const patients = rows.filter((r) => !r.clinician);
    expect(clinician, "a clinician in the cast").toBeDefined();
    const shared = patients
      .filter((p) => p.upper && clinician!.upper && p.upper.kind === clinician!.upper.kind)
      .map((p) => `${clinician!.role} wears the same asset as ${p.role}: ${clinician!.upper!.kind}`);
    expect(shared, "clinician wearing a patient's garment asset").toEqual([]);
  });

  it("(3) NET known-good: footwear stays per-actor distinct", () => {
    // Footwear ALREADY differs per actor — the proof this pipeline can vary a garment by actor.
    requireRows();
    const kinds = rows.map((r) => r.footwear?.kind).filter(Boolean);
    expect(new Set(kinds).size, `distinct footwear assets across ${rows.length} actors`).toBe(kinds.length);
  });

  it("(4) NET known-good: garment coverage survives", () => {
    requireRows();
    const bare = rows
      .filter((r) => r.overlapMm < MIN_OVERLAP_MM)
      .map((r) => `${r.role}: overlap=${r.overlapMm.toFixed(1)}mm`);
    expect(bare, `shirt/trouser overlap below ${MIN_OVERLAP_MM} mm`).toEqual([]);
  });
});
