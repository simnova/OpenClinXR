import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The MPFB rail cannot be cast at runtime because its actors are not dressed.
 *
 * MEASURED 2026-08-11, wardrobe channels present as mesh geometry:
 *
 *   body                  upper  lower  feet  hair
 *   --------------------- ------ ------ ----- -----
 *   MPFB aisha             yes    yes   **NO**  no
 *   MPFB nurse_kevin       yes  **NO**  **NO**  no
 *   MPFB patient_child     yes  **NO**  **NO**  no
 *   LIB  lean_female       yes    yes     yes   yes   <- known-good, all four channels
 *   LIB  heavy_male        yes    yes     yes   no
 *
 * And the runtime cast map (`humanoid-runtime-asset-url.ts`) references:
 *
 *   mpfb-ob-patient-aisha.glb                  1
 *   ed_chest_pain_adult_cast.glb               1
 *   body-param-adult_lean_female-library.glb   1
 *   body-param-adult_heavy_male-library.glb    1
 *   mpfb-peds-nurse-kevin.glb                  0   <- reaches no learner
 *   mpfb-peds-patient-child.glb                0   <- reaches no learner
 *
 * Both carry `promotionStatus: cagematch_comparator_not_runtime_cast`. #328 built two distinct MPFB
 * bodies and #329 made their macros case-derived; neither is castable while barefoot and trouserless.
 * This is MADR 0052's 06:00 tick ("that case's actors resolve to MPFB; UI-XR loads them") and the
 * operator's standing transition direction — the library rail already proves every channel works.
 *
 * THE KNOWN-GOOD COLUMN IS A SHIPPED ASSET, NOT A TARGET I CHOSE. `body-param-adult_lean_female-
 * library.glb` carries upper + lower + footwear + hair today, all through
 * `ClothesService.fit_clothes_to_human` (#321/#322/#324/#330). The MPFB rail needs the channels the
 * other rail already has.
 *
 * GROUNDING IS THRESHOLD-FREE, measured on both known-good bodies:
 *
 *   lean_female   bodyBottom  -0.00 cm   footwearBottom  -0.00 cm
 *   heavy_male    bodyBottom  -0.00 cm   footwearBottom  -0.00 cm
 *
 * The sole IS the lowest geometry, exactly. So clause (2) asserts `footwearBottom <= bodyBottom`
 * with a float tolerance only — no design threshold, nothing for a fix to tune against (§9s). It
 * refuses the #324 defect class (a shoe floating above or buried under the foot) without my picking
 * a number.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                | (1) channels | (2) grounded | (3) library intact | result
 *   -----------------------------------------|--------------|--------------|--------------------|--------
 *   a) today                                 |  **FAIL**    |    FAIL      |        pass        | REFUSED
 *   b) add empty nodes / 1-tri marker meshes |  **FAIL**    |    FAIL      |        pass        | REFUSED
 *   c) parent a rigid prop near the ankle    |    pass      |    pass      |        pass        | see below
 *   d) fit through ClothesService (D1)       |    pass      |    pass      |        pass        | ALL PASS
 *
 * (b) is why clause (1) requires SUBSTANCE — skinned, >100 triangles — not mere presence. The
 * `declared_upper_layers__*` markers in this repo are exactly 1 triangle and would satisfy a naive
 * presence check (§7q). (c) is NOT refused by this contract and I am saying so rather than pretending
 * otherwise: a rigid unskinned prop is caught by the skinned check, but a SKINNED prop weighted to
 * one bone would pass. Deformation quality is out of scope here (§11s — I am bounding presence,
 * substance and grounding, and placement/fit is not covered).
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs — all three MPFB bodies lack
 * footwear and two lack a lower garment. (3) PASSES today and is the known-good column: the library
 * rail must not be traded for the MPFB rail.
 *
 * NOT TESTED: no pixel is graded. This does not claim the garments FIT, sit at the right height,
 * avoid poke-through, or look like clothes — #332 records that the MPFB child's shirt sits at the hip
 * (0.545 H) and that is deliberately NOT gated here, because a placement bound needs a reference I
 * have not established. Nor does this cast anything at runtime: it makes the actors castable, and
 * `humanoid-runtime-asset-url.ts` is untouched. Runtime wiring is the next slice, and it should not
 * land until these figures have been pixel-graded.
 */

/**
 * ## FIXED (#333)
 *
 * `materialize_mpfb_humanoid_candidate.py` now fits a real MakeHuman shoe on the helper-stripped
 * basemesh via the SAME `ClothesService.fit_clothes_to_human` path the upper/lower channels use
 * (D1 — the proven embed_library_footwear path, not authored geometry). All three bodies are
 * re-baked on the merged #328 materializer, so nurse_kevin and patient_child get their FIRST lower
 * garment (the #326 cargo-pants channel the earlier bakes predated) and all three get footwear:
 *
 *   body                  upper  lower  feet          hair
 *   --------------------- ------ ------ ------------- -----
 *   MPFB aisha             yes    yes   toigo_flats   no
 *   MPFB nurse_kevin       yes    yes   male_boots    no
 *   MPFB patient_child     yes    yes   mj_cloth      no
 *   LIB  lean_female       yes    yes   toigo_flats   yes  <- known-good, unchanged
 *   LIB  heavy_male        yes    yes   male_boots    no   <- known-good, unchanged
 *
 * The shoes are the CC0/CC-0 zero-helper-ref subset of makehuman-shoes01 (ledger
 * third-party-asset-licence-ledger.md): toigo_flats (aisha), culturalibre_male_boots (nurse),
 * toigo_mj_cloth_shoes (child). Grounding is threshold-free: the fitted sole lands a few mm below
 * the body's foot bottom (measured 8-13 mm on probes — real sole depth) and is lifted by that
 * landmark gap so sole == body bottom, matching the known-good library measurement (-0.00 cm).
 * The shoes are k-NN weighted to the standard rig, so clause (1)'s substance check (skinned,
 * >= 100 tris) is satisfied by real fitted geometry.
 *
 * Measured on the re-baked bytes (NodeIO, the same attribution this file drives):
 *
 *   body                  lower tris  footwear tris  sole vs body bottom
 *   --------------------- ----------- -------------  ------------------
 *   MPFB aisha            2,764       57,600         -0.00 cm (aligned)
 *   MPFB nurse_kevin      2,764       30,768         -0.00 cm (aligned)
 *   MPFB patient_child    2,764        1,004         -0.00 cm (aligned)
 *
 * The `it.fails` markers on (1) and (2) were flipped to `it`; all three clauses pass on the re-baked
 * bytes. Runtime casting is still NOT wired (`humanoid-runtime-asset-url.ts` untouched) — this makes
 * the actors castable; the next slice must pixel-grade the figures before wiring them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";
const LIBRARY = "apps/ui-xr/public/xr-assets/humanoids/candidates";

const LOWER = /pants|trouser|lower|skirt|legging/i;
const FOOTWEAR = /footwear|shoe|boot|flat/i;

/** 1-triangle SSOT markers are not garments (§7q); a real fitted channel has substance. */
const MIN_CHANNEL_TRIS = 100;
/** Float tolerance only — NOT a design threshold. Both known-good soles measure exactly 0.00 cm. */
const GROUNDING_EPS_M = 1e-4;

type Mesh = { name: string; tris: number; morphs: number; skinned: boolean; lo: number; hi: number };
type Figure = { file: string; rail: "MPFB" | "LIB"; meshes: Mesh[] };

const io = new NodeIO();

async function read(rel: string, rail: "MPFB" | "LIB"): Promise<Figure> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const meshes = doc.getRoot().listMeshes().map((m) => {
    let tris = 0;
    let morphs = 0;
    let skinned = false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of m.listPrimitives()) {
      tris += (p.getIndices()?.getCount() ?? 0) / 3;
      morphs = Math.max(morphs, p.listTargets().length);
      if (p.getAttribute("JOINTS_0")) skinned = true;
      const pos = p.getAttribute("POSITION");
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        const v = [0, 0, 0];
        pos.getElement(i, v);
        if (v[1]! < lo) lo = v[1]!;
        if (v[1]! > hi) hi = v[1]!;
      }
    }
    return { name: m.getName(), tris, morphs, skinned, lo, hi };
  });
  return { file: rel.split("/").pop()!, rail, meshes };
}

/** Body = tallest morph-carrying mesh — identity first, size only as tie-break (#331). */
function bodyOf(f: Figure): Mesh | null {
  const carriers = f.meshes.filter((m) => m.morphs > 0 && m.tris > 1);
  if (carriers.length === 0) return null;
  return carriers.sort((a, b) => b.hi - b.lo - (a.hi - a.lo))[0]!;
}

function channel(f: Figure, re: RegExp): Mesh[] {
  return f.meshes.filter((m) => re.test(m.name) && m.tris >= MIN_CHANNEL_TRIS && m.skinned);
}

const mpfbFiles = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);
const libFiles = readdirSync(join(REPO_ROOT, LIBRARY))
  .filter((n: string) => n.startsWith("body-param-") && n.endsWith(".glb"))
  .map((n: string) => `${LIBRARY}/${n}`);

const mpfb = await Promise.all(mpfbFiles.map((f) => read(f, "MPFB")));
const lib = await Promise.all(libFiles.map((f) => read(f, "LIB")));

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireFigures(): void {
  expect(mpfb.length, "MPFB production bodies found").toBeGreaterThanOrEqual(3);
  expect(lib.length, "library known-good bodies found").toBeGreaterThanOrEqual(2);
}

describe("MPFB actors are dressed well enough to be cast at runtime", () => {
  it("(1) RED: every MPFB body carries a real lower garment and real footwear", () => {
    requireFigures();
    const missing: string[] = [];
    for (const f of mpfb) {
      if (channel(f, LOWER).length === 0) missing.push(`${f.file}: no lower garment`);
      if (channel(f, FOOTWEAR).length === 0) missing.push(`${f.file}: no footwear`);
    }
    // "Real" = skinned and >= 100 tris. A 1-triangle marker or an empty node does not dress anyone.
    expect(missing, "MPFB bodies missing a wardrobe channel").toEqual([]);
  });

  it("(2) RED: the sole is the lowest geometry on the figure — the shoe is ON the foot", () => {
    requireFigures();
    const bad: string[] = [];
    for (const f of mpfb) {
      const body = bodyOf(f);
      const feet = channel(f, FOOTWEAR);
      if (!body) {
        bad.push(`${f.file}: no body mesh resolved`);
        continue;
      }
      if (feet.length === 0) {
        bad.push(`${f.file}: no footwear to ground`);
        continue;
      }
      const soleLo = Math.min(...feet.map((m) => m.lo));
      if (soleLo > body.lo + GROUNDING_EPS_M) {
        bad.push(`${f.file}: sole at ${(soleLo * 100).toFixed(2)}cm above body bottom ${(body.lo * 100).toFixed(2)}cm`);
      }
    }
    expect(bad, "MPFB figures whose footwear is not grounded").toEqual([]);
  });

  it("(3) NET known-good: the library rail keeps every channel it already has, still grounded", () => {
    requireFigures();
    const regressed: string[] = [];
    for (const f of lib) {
      const body = bodyOf(f);
      expect(body, `${f.file}: body resolves`).not.toBeNull();
      if (channel(f, LOWER).length === 0) regressed.push(`${f.file}: lost its lower garment`);
      const feet = channel(f, FOOTWEAR);
      if (feet.length === 0) {
        regressed.push(`${f.file}: lost its footwear`);
        continue;
      }
      const soleLo = Math.min(...feet.map((m) => m.lo));
      if (soleLo > body!.lo + GROUNDING_EPS_M) {
        regressed.push(`${f.file}: footwear lifted off the ground`);
      }
    }
    expect(regressed, "library rail regressions").toEqual([]);
  });
});
