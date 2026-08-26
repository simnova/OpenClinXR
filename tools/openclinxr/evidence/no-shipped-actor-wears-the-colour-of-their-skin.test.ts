/**
 * #508 — #506 fixed ONE asset. Four more patients still wear skin-coloured clothes.
 *
 * MEASURED 2026-08-21 (orchestrator), every shipped actor enumerated live from
 * resolveScenarioActorCast. IMMUTABLE — flip the assertion and append a `## FIXED (#508)` block
 * below; do not rewrite this table.
 *
 *   asset                              garment        garment rgb    skin rgb       distance
 *   mpfb-street-adult-male.glb         cargo_pants    184,173,140    198,172,156      21.0  <- NUDE
 *   mpfb-street-adult-male.glb         toigo_t_shirt  184,173,140    198,172,156      21.0  <- NUDE
 *   mpfb-gown-adult-patient.glb        toigo_t_shirt  184,173,140    201,177,163      28.7  <- OCCLUDED, see below
 *   mpfb-peds-patient-child.glb        cargo_pants    140,173,204    222,203,189      88.7  <- tightest CLEAN
 *   mpfb-clinical-physician-adult.glb  lab_coat       235,235,229    186,162,149     119.0
 *   mpfb-ob-patient-aisha.glb          both           87,112,87      201,177,163     151.9  <- #506 fixed
 *   mpfb-family-partner-adult.glb      both           107,92,102     215,191,176     163.9
 *   mpfb-peds-nurse-kevin.glb          scrubs         13,122,133     185,162,149     177.7
 *   mpfb-clinical-nurse-adult.glb      scrubs         13,122,133     186,162,149     178.1
 *
 * THRESHOLD 60 IS DERIVED, NOT FITTED: the two offenders sit at 21.0 and 28.7, the tightest clean
 * asset at 88.7. 60 falls in a 60-point empty gap. Nothing is tuned to clear an observation (§9s).
 *
 * BLAST RADIUS — mpfb-street-adult-male.glb is worn by FOUR patients:
 *   telehealth_diabetes_health_literacy_v1 · clinic_abdominal_pain_interpreter_v1
 *   oncology_bad_news_family_v1 · primary_care_dyslipidemia_joint_pain_v1
 *
 * THE ONE EXCEPTION, recorded rather than silently skipped: mpfb-gown-adult-patient's cream
 * t-shirt sits BENEATH openclinxr_real_garment_peds_upper_v1_mesh (3009v, rgb 38,140,209 cyan) and
 * is not the visible layer — my own graded render of that asset shows a gowned figure, not a nude
 * one. The exception list is pinned to exactly this one entry so nothing can be added to it.
 *
 * ROOT CAUSE IS ALREADY FIXED AT SOURCE (#506): automate_blender.py's `closed_casual` moved from
 * (0.72,0.68,0.55) to (0.34,0.44,0.34). This asset was simply never re-baked — the #506 worktree
 * lacked the gitignored viseme/hair cache. `patch_glb_base_color_factors` is the proven post-export
 * tool it used on aisha (D1: wire it, do not hand-author a new one).
 *
 * NEVER set OPENCLINXR_RUN_GARMENT_BAKES=1 — hard constraint.
 *
 * claimScope: whether any shipped actor's visible garments are the colour of their own skin.
 * notEvidenceFor: wardrobe policy, clinical appropriateness, or garment fit.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const DIR = "apps/ui-xr/public/generated-humanoids/";
const MIN_CONTRAST = 60;
const GARMENT = /cargo_pants|t_shirt|scrub_shirt|scrub_pants|lab_coat|polo|sweater/;
/** Beneath an opaque outer shell, so its colour is never seen. Exactly one entry, pinned. */
const OCCLUDED: ReadonlyArray<readonly [string, string]> = [
  ["mpfb-gown-adult-patient.glb", "toigo_t_shirt"],
];
/** Measured skin means, so a re-tint of a PATIENT cannot manufacture contrast. */
const SKIN: Record<string, [number, number, number]> = {
  "mpfb-street-adult-male.glb": [198, 172, 156],
  "mpfb-ob-patient-aisha.glb": [201, 177, 163],
  "mpfb-family-partner-adult.glb": [215, 191, 176],
  "mpfb-peds-patient-child.glb": [222, 203, 189],
  // #588: measured 2026-08-26 from mpfb-peds-parent-aisha.skin-baked.png (texture mean
  // (0.361, 0.318, 0.292), independent python decode agrees to 4dp). The parent was the
  // population gap this contract exists to close: her muted-rose garments were dE 11.6
  // from this skin (33.7 RGB — below MIN_CONTRAST 60) and she was skipped because SKIN
  // had no row. The motion-bind GLB is the cast runtime path (candidates/, not
  // generated-humanoids/).
  "mpfb-peds-parent-aisha.motion-bind.glb": [92, 81, 74],
};

async function shippedAssets(): Promise<string[]> {
  const c = await import("../../../packages/openclinxr/asset-registry/src/actor-casting.ts");
  const out = new Set<string>();
  for (const s of c.listShippedCastScenarioIds() as string[])
    for (const a of c.resolveScenarioActorCast(s) as Record<string, string>[])
      out.add(String(a.assetPath).split("/").pop()!);
  return [...out].sort();
}

type Row = { glb: string; garment: string; rgb: [number, number, number]; skinSha: string };

/** Cast GLBs live in generated-humanoids/; the peds parent's runtime path is candidates/. */
const CANDIDATES_DIR = "apps/ui-xr/public/xr-assets/humanoids/candidates/";

async function rows(glb: string): Promise<Row[]> {
  const path = existsSync(DIR + glb) ? DIR + glb : CANDIDATES_DIR + glb;
  const d = await new NodeIO().read(path);
  let skinSha = "";
  const out: Row[] = [];
  for (const m of d.getRoot().listMeshes()) {
    const p = m.listPrimitives()[0];
    const img = p?.getMaterial()?.getBaseColorTexture()?.getImage();
    if (/_body$|^mpfb$/.test(m.getName()) && img)
      skinSha = createHash("sha256").update(Buffer.from(img)).digest("hex").slice(0, 16);
  }
  for (const m of d.getRoot().listMeshes()) {
    const n = m.getName();
    if (!GARMENT.test(n)) continue;
    const f = m.listPrimitives()[0]?.getMaterial()?.getBaseColorFactor();
    if (f) out.push({ glb, garment: n.replace(/_mpfb.*$/, "").replace("makeclothes_library_", ""),
      rgb: [f[0]! * 255, f[1]! * 255, f[2]! * 255], skinSha });
  }
  return out;
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const isOccluded = (r: Row) => OCCLUDED.some(([g, n]) => r.glb === g && r.garment.includes(n));

describe("#508 no shipped actor wears the colour of their own skin", () => {
  it("the population is real — several assets ship and carry garments", async () => {
    const assets = await shippedAssets();
    expect(assets.length).toBeGreaterThanOrEqual(5);
    expect(assets).toContain("mpfb-street-adult-male.glb");
  });

  it("(1) every VISIBLE garment contrasts with its own actor's skin", async () => {
    for (const glb of await shippedAssets()) {
      const skin = SKIN[glb];
      if (!skin) continue; // only actors whose skin mean is pinned above
      for (const r of await rows(glb)) {
        if (isOccluded(r)) continue;
        expect(dist(r.rgb, skin), `${glb} ${r.garment} is ${dist(r.rgb, skin).toFixed(1)} from skin`)
          .toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    }
  });

  it("(2) COUNTERWEIGHT: the occlusion exception stays at exactly one entry", () => {
    expect(OCCLUDED.length, "an exception list is how this contract gets neutered").toBe(1);
    expect(OCCLUDED[0]![0]).toBe("mpfb-gown-adult-patient.glb");
  });

  it("(3) COUNTERWEIGHT: recolour the CLOTHES, never the actor — skin textures are unchanged", async () => {
    const pinned: Record<string, string> = {};
    for (const glb of Object.keys(SKIN)) {
      const r = (await rows(glb))[0];
      if (r) pinned[glb] = r.skinSha;
    }
    // Every pinned actor must still HAVE a skin texture; a stripped texture is the cheap escape.
    for (const [glb, sha] of Object.entries(pinned))
      expect(sha.length, `${glb} lost its skin texture`).toBeGreaterThan(0);
  });

  it("(4) COUNTERWEIGHT: the already-clean actors stay clean", async () => {
    for (const glb of ["mpfb-family-partner-adult.glb", "mpfb-peds-patient-child.glb", "mpfb-ob-patient-aisha.glb"]) {
      for (const r of await rows(glb))
        expect(dist(r.rgb, SKIN[glb]!), `${glb} ${r.garment} regressed`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });
});

/**
 * ## FIXED (#508) — appended; the planted header above is immutable
 *
 * CAUSE, measured: `mpfb-street-adult-male.glb` was the last shipped actor still carrying the
 * pre-#506 `closed_casual` cream baseColorFactor (0.72, 0.68, 0.55) on both garments. #506 fixed
 * the root cause in `automate_blender.py` (`_FABRIC_PALETTE_KIND_COLORS` `closed_casual` ->
 * muted olive) but could not re-bake this asset — its worktree lacked the gitignored viseme/hair
 * provider cache — so this GLB kept cream and read nude against its own skin (21.0 RGB).
 *
 * FIX = wire the SAME proven post-export tool #506 used on aisha,
 * `patch_glb_base_color_factors` (materialize_mpfb_humanoid_candidate.py:697), verbatim, to set
 * the two garment materials on the shipped GLB to the #506 olive (0.34, 0.44, 0.34). No full
 * re-bake; only the JSON chunk's baseColorFactor entries change, so geometry/BIN/skin bytes are
 * copied verbatim. The OCCLUDED exception (mpfb-gown-adult-patient's under-gown cream t-shirt)
 * is untouched and stays exactly one entry.
 *
 * Post-fix measured (NodeIO): cargo_pants + toigo_t_shirt baseColorFactor (0.34, 0.44, 0.34) —
 * 144.1 RGB from this actor's skin (198,172,156), clearing MIN_CONTRAST 60. Skin texture sha
 * b6fed13037774c6a and garment vertex counts 8322/5400 unchanged. Family/child/aisha counterweight
 * (clause 4) holds — none were touched.
 */

/**
 * ## FIXED (#588) — appended; the planted header above is immutable
 *
 * #588 closed the parent's population gap. `mpfb-peds-parent-aisha.motion-bind.glb` was already
 * enumerated by this contract (she is a shipped cast asset) and SKIPPED — SKIN had no row for
 * her, so clause (1) never measured her. Measured 2026-08-26 (seated-parent-placement.json +
 * independent python decode of mpfb-peds-parent-aisha.skin-baked.png): her skin texture mean is
 * (92, 81, 74) and her muted-rose garments (107, 92, 102) sat 33.7 RGB / dE 11.6 from it —
 * the exact defect class this contract exists to catch, below MIN_CONTRAST 60. The #506
 * hardcoded light-skin constant measured her garments ~136 RGB away (green), which is why she
 * slipped both contracts.
 *
 * FIX: her garments moved to the muted-rose palette's cardigan rose (0.62, 0.28, 0.38) — 70.4
 * RGB / dE 36.2 from her own skin, the same perceptual distance as the nurse teal that reads
 * clothed (dE 36.0). Root cause in `automate_blender.py` `_FABRIC_PALETTE_KIND_COLORS`
 * `muted_rose_and_neutral.closed_casual`; shipped bytes patched in BOTH parent GLBs (base +
 * motion-bind runtime) via `patch-glb-base-color-factors.ts` (JSON-chunk patch, geometry/BIN
 * verbatim). This contract now asserts her: SKIN["mpfb-peds-parent-aisha.motion-bind.glb"] =
 * [92, 81, 74], and `rows()` resolves the candidates/ path for the runtime GLB. Skin textures
 * and garment vertex counts unchanged; family/child/aisha counterweight (clause 4) holds.
 */
