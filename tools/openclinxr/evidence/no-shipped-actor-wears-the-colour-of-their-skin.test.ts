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

async function rows(glb: string): Promise<Row[]> {
  const d = await new NodeIO().read(DIR + glb);
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

  it.fails("(1) every VISIBLE garment contrasts with its own actor's skin", async () => {
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
