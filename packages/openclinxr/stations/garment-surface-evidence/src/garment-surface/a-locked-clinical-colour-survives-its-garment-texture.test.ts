import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";
import {
  effectiveBaseColorFactor,
  textureDecodedStats,
} from "../../../../../../tools/openclinxr/evidence/lib/effective-garment-colour.js";
import { makeclothesGarmentSlug } from "../../../../../../tools/openclinxr/evidence/lib/garment-mesh-class.js";

/**
 * **A garment can carry a locked clinical colour, or it can carry its own authored texture. It cannot
 * carry both, because glTF multiplies them.**
 *
 * Measured 2026-08-14 on `mpfb-peds-nurse-kevin.glb`, read with NodeIO. The control is already inside
 * the file — two garments with a byte-identical colour factor, one textured and one not:
 *
 *   garment            | baseColorFactor        | baseColorTexture      | effective brightness
 *   -------------------|------------------------|-----------------------|---------------------
 *   cargo_pants        | [0.05, 0.48, 0.52]     | none                  | **100%**
 *   fisherman_sweater  | [0.05, 0.48, 0.52]     | shirt-knit, mean 0.205| **21%**
 *
 * `0.48 x 0.205 = 0.098`. The scrub hue survives as a HUE and loses 90% of its BRIGHTNESS, so the
 * nurse's newly-fitted long sleeve (#199) renders near-black where the data says scrub teal.
 *
 * ## BOTH MECHANISMS ARE INDIVIDUALLY CORRECT — THIS IS A COMPOSITION DEFECT
 *
 *   - the locked clinical colour IS applied; `materialize_mpfb_humanoid_candidate.py` sets the scrub
 *     factor and #199's ledger entry says so truthfully
 *   - the #360 path consumes the garment's own declared `.mhmat` -> `shirt-knit.png` as
 *     `baseColorTexture`, which is why the knit reads as knit rather than as flat vinyl
 *
 * Neither is a bug. Their product is. A fix that deletes either one loses something real, which is why
 * clauses (2) and (3) exist.
 *
 * ## WHY THIS IS NOT ONE GARMENT'S PROBLEM
 *
 * Any cached garment that declares its own `.mhmat` does this the moment a clinical colour is locked
 * onto it. `garments-keep-their-authored-texture.test.ts` requires authored textures to survive and
 * `a-station-cast-is-visually-separable.test.ts` requires role colours to stay distinguishable — today
 * those two are jointly satisfiable **only by garments with no texture**, which is why the defect
 * appeared on the first textured clinical garment the pipeline ever produced.
 *
 * ## THE THRESHOLD IS A MIDPOINT, NOT A FIT (SS9s)
 *
 * 50% is not calibrated from the observation. It is the point at which a rendered garment stops being
 * nearer its intended colour than it is to black. It does not reference the treatment: a texture
 * normalised to its own mean lands near 100% whether or not anyone tuned it, and today's 21% misses by
 * 2.4x. Compare a fitted threshold — "half the observed 21%" — which any nonzero value would clear.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) colour | (2) weave kept | (3) known-good | result
 *   -------------------------------------------------|------------|----------------|----------------|--------
 *   a) today                                         | **FAIL**   |      pass      |      pass      | REFUSED
 *   b) drop the texture, keep the factor             |    pass    |    **FAIL**    |      pass      | REFUSED
 *   c) darken the PANTS too, so both "match"         |    pass    |      pass      |    **FAIL**    | REFUSED
 *   d) normalise the texture by its own mean, or     |    pass    |      pass      |      pass      | ALL PASS
 *      bake the factor into the texture              |            |                |                |
 *
 * **(b) is the one to watch and it is why clause (2) exists.** Deleting `shirt-knit` makes the sweater
 * render at the full locked colour and instantly satisfies (1) — while throwing away the weave that
 * #360 was built to deliver. It is the cheapest possible green.
 *
 * **(c) is why clause (3) exists.** Consistency is achievable by degrading the garment that works.
 * Clause (3) pins the untextured pants at their authored factor AND at full brightness, so "make them
 * match" cannot be reached downward.
 *
 * **This contract does NOT prescribe the method.** Normalising the texture by its mean and baking the
 * factor into the texture both pass, and so would anything else that lands the same numbers. Which one
 * is the implementer's call — record it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the sole RED and fails today at 21%. (2) and (3)
 * pass today and are counterweights. They are independent of what (1) measures — fixing a colour
 * composition cannot delete a texture or rewrite the pants' authored factor unless done by (b) or (c).
 *
 * NOT TESTED:
 *   - **The runtime's own material path.** This reads the glTF, not three.js (SS6v says those can
 *     disagree). The lit capture agrees with the arithmetic, which is evidence, not proof of the code path.
 *   - **Whether normalising crushes the weave.** Never run. It may flatten contrast or shift hue.
 *   - **The other cached garments.** Only this asset's four materials were read; the pack's six
 *     unextracted garments were not checked for declared `.mhmat`s.
 *   - **Any clinical claim about what colour a nurse should wear.** This says the shipped colour does
 *     not match the locked one, never that the locked one is right.
 */

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#386) — appended; the planted header above is immutable
 *
 * Root cause, measured: two individually-correct stages multiply. The locked scrub colour IS
 * applied (`materialize_mpfb_humanoid_candidate.py` sets the factor and #199's ledger entry says
 * so), and the #360 path consumes the sweater's OWN declared `sweater_fisherman.mhmat` ->
 * `shirt-knit.png` as baseColorTexture. glTF multiplies baseColorFactor x baseColorTexture, and
 * shirt-knit's mean luminance is 0.206 — the locked teal rendered at ~10% brightness
 * (0.48 x 0.206) while the untextured cargo pants beside it (byte-identical factor) rendered at
 * the full colour. Neither stage was a bug; their product was.
 *
 * Fix, 2026-08-14: `garment_material_from_declared` now luminance-normalises every
 * patch_factor=True (role-coloured) garment texture by its own mean before export — dividing
 * the authored texels by the mean re-centres the texture so the factor sets the hue and
 * brightness and the weave survives as relative contrast (authoredMean 0.2057, scale 4.861,
 * clamped to [0,1]). The re-centred bytes are persisted to a per-bake temp PNG and rebound
 * before export: the glTF exporter reads a FILE-sourced, non-dirty image straight from disk,
 * and the first bake shipped the AUTHORED texture byte-identically despite the in-memory edit
 * (dirty-flag loss mechanism not determined; the file-based persist makes it moot — same
 * persist-then-export shape as the skin bakes). patch_factor=False slots (footwear) are
 * untouched: there the texture IS the author's look and no clinical colour is locked onto it.
 *
 * Measured post-fix on the shipped bytes (the reader above): sweater texture mean luminance
 * 0.602 (was 0.206; RED floor 0.5), weave sd 0.434 (floor 0.05); factor still
 * [0.05, 0.48, 0.52]; cargo pants factor and flatness unchanged. The nurse's knit now renders
 * near the locked scrub teal instead of near-black. This generalises to every future
 * role-coloured garment that declares a .mhmat.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## FIXED (#550) — appended; the planted header above is immutable
 *
 * Separate from the gown `cargo_pants` strip. NodeIO on `mpfb-peds-nurse-kevin.glb`: materials
 * `sweater` and `cargo_pants` are ABSENT; surviving MakeClothes clinical pair is `scrub_shirt` +
 * `scrub_pants` (both locked `[0.05,0.48,0.52]`, both **untextured**, brightness 1.0). Choices:
 *   - (1) **replacement** → pin `scrub_shirt` as the locked clinical subject
 *   - (2) **inverted guard** → no locked clinical garment on this asset carries a baseColorTexture
 *     (the weave subject left with the sweater; scrub_shirt has no weave to keep)
 *   - (3) **replacement** → `scrub_pants` is the untextured full-brightness known-good
 * Do not restore `cargo_pants` / `sweater`. Do not re-bake.
 *
 * ## FIXED (#740) — appended; the #550 inverted guard above is superseded
 *
 * #740 re-materialized the fleet with every garment's declared .mhmat texture, including the
 * scrub shirt (WojackOWL Scrub_Shirt.mhmat, CC-BY — the pack's declared diffuse was never
 * staged; the #683-era bake skipped it and shipped flat). The scrub shirt is now a textured
 * locked garment, which is exactly the event the #550 block said would require restoring the
 * #360 weave counterweight. Clause (2) now asserts the restored shape with one correction: the
 * #550 note's MIN_TEXTURE_SD 0.05 was calibrated against the sweater's shirt-knit (sd 0.156),
 * and the scrub fabric is authored-flat at sd 0.010 on the shipped bytes — the floor would
 * refuse a real texture. The discriminator is sd > 0 (a synthetic flat fill measures exactly 0)
 * plus texMean >= MIN_EFFECTIVE_BRIGHTNESS (the (1) RED floor, which refuses the
 * delete-the-texture cheat).
 */

const REPO_ROOT = repoRoot();
/** Overridable so a destructive probe can point the same logic at a doctored asset. */
const PROBE_GLB = process.env["OPENCLINXR_COLOUR_PROBE_GLB"];
// st-palette round 2: the same assertions run as one row per shipped clinical
// asset — kevin (the planted subject) plus the physician. A probe run
// points at a single doctored file instead. Both rows carry the untextured-pants
// control for clause (3); only rows that declare a control run it.
// Kevin's assertions and bounds are byte-identical to the planted file.
const ASSETS: readonly { path: string; control: boolean }[] = PROBE_GLB
  ? [{ path: PROBE_GLB, control: true }]
  : [
      {
        path: join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb"),
        control: true,
      },
      // st-palette landing 2026-11-04: the adult nurse is back at its origin bytes (untextured
      // factor-only scrubs, the R5 hem cut opened her waist), so her row moves to the physician:
      // same library scrub_shirt, sRGB-folded weave texture, factor-only pants control.
      {
        path: join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb"),
        control: true,
      },
    ];

/** The locked scrub colour the materializer applies to clinical roles. */
const CLINICAL_RGB = [0.05, 0.48, 0.52] as const;
const LOCK_TOLERANCE = 0.02;
/** Nearer its own colour than to black. Not derived from the observed 21%. */
const MIN_EFFECTIVE_BRIGHTNESS = 0.5;

type Garment = {
  name: string;
  factor: number[];
  /** HB-02 (22ec335a5): the fold moved the locked colour into the texture, so the lock reads
   * as the EFFECTIVE colour — bare factor when untextured, factor x per-channel texture
   * mean when textured — never the bare factor alone. */
  effective: [number, number, number];
  locked: boolean;
  hasTexture: boolean;
  texMean: number;
  texSD: number;
  /** Rendered-over-locked luminance ratio. Pre-fold this was the texture mean (the factor
   * was the full locked colour); post-fold the texture IS the colour, so the ratio keeps
   * the floor's original meaning — nearer the locked colour (1.0) than black (0.0) —
   * and reproduces the planted 21% on the pre-fix bytes. Floor untouched. */
  effectiveBrightness: number;
};

/** Mean and sd of a PNG's decoded-linear luminance over opaque texels, plus
 * per-channel decoded means for the effective-colour read. Round 4: one
 * implementation — delegates to the shared effective-garment-colour reader,
 * which sRGB-decodes each texel before averaging. Bounds below unchanged. */
function textureStats(bytes: Uint8Array): { mean: number; sd: number; r: number; g: number; b: number } | null {
  return textureDecodedStats(bytes);
}

/** Luminance as the mean channel — the same averaging the texture sampler uses. */
const luminance = (rgb: readonly number[]): number => (rgb[0]! + rgb[1]! + rgb[2]!) / 3;

async function readGarments(assetPath: string): Promise<Garment[]> {
  if (!existsSync(assetPath)) throw new Error("missing artifact");
  const doc = await new NodeIO().readBinary(readFileSync(assetPath));
  const out: Garment[] = [];
  for (const m of doc.getRoot().listMaterials()) {
    const name = m.getName();
    if (!/makeclothes_library/u.test(name)) continue;
    const factor = Array.from(m.getBaseColorFactor()).slice(0, 3);
    const img = m.getBaseColorTexture()?.getImage();
    const stats = img ? textureStats(img) : null;
    // HB-02 (22ec335a5): the fold moved the locked colour into the texture.
    // Round 4: texels are sRGB-encoded, so the lock read follows the RENDERED
    // colour via the shared factor x srgb_to_linear(texel)-mean reader — the
    // bare factor alone would read "unlocked" on correct bytes.
    const effective: [number, number, number] = [...effectiveBaseColorFactor(factor, img ?? null)];
    const locked = CLINICAL_RGB.every((c, i) => Math.abs((effective[i] ?? -9) - c) < LOCK_TOLERANCE);
    out.push({
      name: name.replace(/^mat_/u, ""),
      factor, effective, locked,
      hasTexture: Boolean(img),
      texMean: stats?.mean ?? 1,
      texSD: stats?.sd ?? 0,
      effectiveBrightness: luminance(effective) / luminance(CLINICAL_RGB),
    });
  }
  return out;
}

type Subject = {
  asset: string;
  /** Only rows that declare an untextured control run clause (3). Kevin
   * declares it; the adult nurse ships both scrubs textured under the
   * HB-02 fold, so its row runs clauses (1)+(2). */
  control: boolean;
  garments: Garment[];
  locked: Garment[];
  scrubShirt: Garment | undefined;
  scrubPants: Garment | undefined;
};

const subjects: Subject[] = [];
for (const asset of ASSETS) {
  const garments = await readGarments(asset.path);
  subjects.push({
    asset: asset.path,
    control: asset.control,
    garments,
    locked: garments.filter((g) => g.locked),
    /** #550: wardrobe retarget — sweater/cargo_pants gone; scrub_shirt + scrub_pants ship. */
    scrubShirt: garments.find((g) => makeclothesGarmentSlug(g.name) === "scrub_shirt"),
    scrubPants: garments.find((g) => makeclothesGarmentSlug(g.name) === "scrub_pants"),
  });
}

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(s: Subject): void {
  const { asset, garments, scrubShirt, scrubPants } = s;
  expect(existsSync(asset), `${asset} exists`).toBe(true);
  expect(garments.length, `MakeClothes garment materials found in ${asset}`).toBeGreaterThanOrEqual(2);
  // Presence BY NAME, not by lock state. A destructive probe that darkened the pants first tripped a
  // `locked.length >= 2` guard here, so the contract went red for the right reason with the WRONG
  // diagnostic — "only 1 locked garment found" reads as a broken enumeration, not as "you rewrote the
  // control". Each clause now owns the lock assertion for its own subject.
  expect(scrubShirt, `the scrub_shirt material is present in ${asset}`).toBeDefined();
  expect(scrubPants, `the scrub_pants material is present in ${asset}`).toBeDefined();
}

describe("a locked clinical colour survives its garment texture", () => {
  // st-palette round 2: one row per shipped clinical asset under the same
  // assertions — kevin (planted subject) plus the rebaked adult nurse.
  for (const s of subjects) {
    const tag = s.asset.split("/").pop() ?? s.asset;
    describe(`asset ${tag}`, () => {
  it("(1) RED: every clinical-coloured garment renders at its locked brightness", () => {
    requireMeasured(s);
    // Unlocking the scrub shirt would empty `locked` and make this clause vacuous. Pin it.
    expect(
      s.scrubShirt!.locked,
      `${s.scrubShirt!.name} must still carry the locked clinical colour [${CLINICAL_RGB.join(", ")}] — unlocking it would empty this clause rather than satisfy it`,
    ).toBe(true);
    const dim = s.locked
      .filter((g) => g.effectiveBrightness < MIN_EFFECTIVE_BRIGHTNESS)
      .map(
        (g) =>
          `${g.name}: factor [${g.factor.map((v) => v.toFixed(2)).join(", ")}] x texture mean ${g.texMean.toFixed(3)} = ${(g.effectiveBrightness * 100).toFixed(0)}% brightness — renders nearer black than its locked colour`,
      );
    expect(dim, "clinical garments whose texture swallows the locked colour").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the authored weave is not deleted to reach the colour", () => {
    // FIXED (#740): the #550 inverted guard fired exactly as its FIXED block documented — a
    // textured locked garment has arrived. The scrub shirt now consumes its OWN declared
    // Scrub_Shirt.mhmat diffuse (WojackOWL Medical Scrubs Kit, CC-BY) via the #360 path and is
    // luminance-normalised per #386, so the locked scrub teal renders at its brightness and the
    // authored fabric survives as contrast. The #550 restoration note's MIN_TEXTURE_SD 0.05 was
    // calibrated against the sweater's shirt-knit (measured sd 0.156); the scrub fabric is
    // authored-flat (measured sd 0.010 on the shipped bytes), so that floor would refuse a real
    // texture. The discriminator that refuses the cheapest cheat (b) — delete the texture, keep
    // the factor — is: the texture is PRESENT, carries authored variation (sd > 0; a synthetic
    // flat fill measures exactly 0), and the locked colour still renders at its brightness
    // (texMean >= MIN_EFFECTIVE_BRIGHTNESS, the (1) RED floor).
    requireMeasured(s);
    const texturedLocked = s.locked.filter((g) => g.hasTexture);
    expect(texturedLocked.length, "a textured locked garment exists (the scrub shirt weave)").toBeGreaterThanOrEqual(1);
    for (const g of texturedLocked) {
      expect(g.texSD, `${g.name} weave must not be a synthetic flat fill (sd > 0)`).toBeGreaterThan(0);
      expect(
        g.effectiveBrightness,
        `${g.name} must still render at its locked brightness — deleting the texture to reach the colour is the refused cheat`,
      ).toBeGreaterThanOrEqual(MIN_EFFECTIVE_BRIGHTNESS);
    }
  });

  // Clause (3) runs only on rows that declare the untextured control
  // (kevin). The nurse row runs clauses (1)+(2): both its scrubs ship
  // textured under the HB-02 fold, so there is no untextured garment to pin.
  if (s.control) {
  it("(3) COUNTERWEIGHT known-good: the untextured garment keeps its authored colour and full brightness", () => {
    // Refuses (c): "make them match" is reachable downward by darkening the pants. scrub_pants is the
    // surviving untextured known-good (#550 replacement for cargo_pants) and must not be moved to fit.
    requireMeasured(s);
    expect(
      s.scrubPants!.hasTexture,
      `${s.scrubPants!.name} must stay untextured — it is the full-brightness known-good column`,
    ).toBe(false);
    const drift = CLINICAL_RGB.map((c, i) =>
      Math.abs((s.scrubPants!.factor[i] ?? -9) - c) < LOCK_TOLERANCE
        ? null
        : `channel ${i}: ${s.scrubPants!.factor[i]} vs authored ${c}`,
    ).filter(Boolean);
    expect(drift, `${s.scrubPants!.name} authored clinical factor rewritten`).toEqual([]);
    expect(
      s.scrubPants!.effectiveBrightness,
      `${s.scrubPants!.name} must stay at full brightness — darkening the working garment to match a broken one is not consistency`,
    ).toBeGreaterThanOrEqual(MIN_EFFECTIVE_BRIGHTNESS);
  });
  }
    });
  }
});

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (HB-02, 22ec335a5) — appended; the planted header above is immutable
 *
 * HB-02 folded every baseColorFactor into its baseColorTexture fleet-wide and reset factors
 * to white. The scrub shirt now renders the locked teal as factor x texture =
 * (1,1,1) x (0.034,0.478,0.522) instead of factor (0.05,0.48,0.52) x normalised weave,
 * so the bare-factor lock read red on correct bytes: no locked garment existed, clause (1)'s
 * scrubShirt pin failed, and clause (2) found no textured locked garment.
 *
 * ADAPT, not loosening: the lock now reads the EFFECTIVE colour (per-channel factor x
 * texture mean; bare factor when untextured), and the brightness is the rendered-over-locked
 * luminance ratio. The ratio reproduces the planted numbers exactly — 21% on the pre-fix
 * bytes (0.206 texture mean), 60% post-#386, 98.5% now — so MIN_EFFECTIVE_BRIGHTNESS (0.5)
 * keeps its header meaning ("nearer its own colour than to black") with the same numeric
 * bar. LOCK_TOLERANCE (0.02), the weave sd>0 discriminator, and clause (3)'s untextured
 * pants control (still flat teal, ratio 1.0) are untouched.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (st-palette round 2) — appended; the planted header above is immutable
 *
 * Round 1 attached the weave texture but kept the locked factor, so every textured
 * garment rendered at colour^2 (nurse chest (120,177,181) -> (36,103,115) in the
 * runtime light rig). No test caught it: this file read only kevin, whose bytes were
 * already folded fleet-wide. Round 2 adds mpfb-clinical-nurse-adult.glb as a second
 * asset row under the same three assertions (same bounds, same floors), and the weave
 * stage now folds (factor -> [1,1,1,a]; effective = palette within 0.01). A destructive
 * probe at the round-1 nurse bytes fails clause (1) at 48% brightness; current bytes
 * pass clauses (1)+(2). Clause (3)'s untextured-pants control lives on kevin: the adult
 * nurse ships both scrub garments textured under the fold (the base-colour contract
 * requires a texture on every garment), so the nurse row runs clauses (1)+(2) only
 * and clause (3) is registered for control-declaring rows (kevin) — a row red by
 * design would red the push gate, so the design carries the scope instead.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
