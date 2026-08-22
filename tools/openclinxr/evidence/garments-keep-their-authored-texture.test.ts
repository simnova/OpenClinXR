import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { listUniqueLiveCastMpfbAssetPaths } from "./live-scenario-actor-cast.js";
import { pngLuminanceSd } from "./mpfb-eyes-inspection.js";

/**
 * #372 — a garment the pipeline fits must arrive with the material it was authored with.
 *
 * `95c2b623` (#371) fixed garment faceting and, in the same rebake, lost the
 * `toigo_t_shirt` baseColorTexture on aisha and the child. Caught by pixel grade; every
 * contract in that slice was green.
 *
 * ## MEASURED 2026-08-13 on the shipped bytes — do not re-derive this
 *
 * | actor | material | baseColorFactor | baseColorTexture before | after |
 * |---|---|---|---|---|
 * | aisha | `mat_makeclothes_library_toigo_t_shirt` | `[0.720, 0.680, 0.550, 1.0]` | present | **NONE** |
 * | aisha | `mat_makeclothes_library_cargo_pants.001` | `[0.720, 0.680, 0.550, 1.0]` | none | none |
 * | child | `mat_makeclothes_library_toigo_t_shirt` | `[0.720, 0.680, 0.550, 1.0]` | present | **NONE** |
 * | child | `mat_makeclothes_library_cargo_pants.001` | `[0.720, 0.680, 0.550, 1.0]` | none | none |
 * | kevin | `mat_makeclothes_library_scrub_shirt` | `[0.050, 0.480, 0.520, 1.0]` | none | none (unchanged) |
 *
 * Footwear textures survived on all three (7.77 MB / 461 KB / 1.42 MB, distinct SHAs).
 *
 * ## WHY THE AUTHORED STATE IS THE REFERENCE — the .mhclo -> .mhmat -> diffuseTexture chain
 *
 * Each garment's OWN declared material is what must ship (D1: wiring the author's asset, not
 * recolouring). Measured in the staged provider cache (`makehuman-*.mhclo` `material <rel>`
 * line -> `<rel>.mhmat` `diffuseTexture <png>`):
 *
 * | garment .mhclo | declared .mhmat staged? | diffuseTexture | shipped texture required |
 * |---|---|---|---|
 * | toigo t-shirt | yes | `T-shirt_basic.png` (861,166 B) | **yes** |
 * | toigo flats | yes | `Shoe.png` (7,769,810 B) | **yes** |
 * | toigo mj shoes | yes | `MJ-shoes3.png` (1,418,657 B) | **yes** |
 * | culturalibre boots | yes | `boot.png` (461,286 B) | **yes** |
 * | cargo pants | **no** (`cargo_pants.mhmat` not staged) | — | no — flat |
 * | scrub shirt | **no** (`Scrub_Shirt.mhmat` not staged) | — | no — flat |
 *
 * Kevin is the known-good column. CORRECTION to the issue's wording, measured on the bytes:
 * kevin's scrub and cargo factors are IDENTICAL (`[0.050, 0.480, 0.520]` teal) before AND after
 * #371 — he is NOT factor-separated from his trousers. His non-regression is because his shirt
 * was never textured and nothing changed for him; the contract therefore keys on the AUTHORED
 * state (a flat garment whose .mhmat is not staged passes), never on factor distinctness.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                           | (1) texture | (2a) substance | (2b) role factor | result
 *   ----------------------------------------------------|-------------|----------------|------------------|--------
 *   a) today — t-shirt flat, factor only                |  **FAIL**   |     n/a        |      pass        | REFUSED
 *   b) give the shirt a DIFFERENT flat factor (onesie)  |  **FAIL**   |     n/a        |   **FAIL**       | REFUSED
 *   c) attach a stub/1x1 texture to satisfy (1)         |    pass     |   **FAIL**     |      pass        | REFUSED
 *   d) consume the declared .mhmat -> baseColorTexture  |    pass     |     pass       |      pass        | ALL PASS
 *
 * (b) is the issue's named counterweight: separating the garments by factor would pass "the
 * cast is visually separable" without restoring the authored material, so clause (1) requires
 * the TEXTURE and clause (2b) pins the factor to the #180 role colour. A factor-only change can
 * never green.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 2/2 t-shirt slots today
 * (aisha + child). (2a), (2b) and (3) pass today and are counterweights / the known-good column.
 * The enumeration guard refuses a fix that deletes the t-shirt material or adds an unclassified
 * garment.
 *
 * NOT TESTED:
 *   - **How the shirt LOOKS.** This bounds the material binding in the file. Whether the shirt
 *     reads as a shirt at encounter distance is the orchestrator's pixel grade.
 *   - **The lower channel.** The cargo-pants cover shell has no UV layer and its .mhmat is not
 *     staged; wiring a lower-garment texture is a fitting-pipeline slice, not this material
 *     contract (the #360 record already says so).
 *   - **The eyes.** #340/#354 contracts already pin the iris texture.
 *   - **Kevin's silhouette.** His scrub and trousers share one teal factor (measured, pre-existing
 *     before #371); that is a staging/coverage question, not a texture-loss regression, and it is
 *     not this contract's subject.
 *   - **Texture luminance variation.** Measured 2026-08-13: the shipped T-shirt_basic.png has
 *     luminance sd 9.5 (2048²) — a plain pale fabric is legitimately low-contrast, so an eye-iris
 *     sd floor would fail the known-good texture. Stub/1x1 textures are refused by the byte and
 *     dimension floors alone; how detailed a fabric map must be is a pixel-grade question, not a
 *     file-side one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#528) — appended; the planted header above is immutable
 *
 * Population was a hand-typed three-actor literal (`ACTORS = [aisha, kevin, child]`) that clause
 * (3) compared cargo-pants wearers against (`expected 2 to be 3`). Cast is now live-enumerated
 * from `resolveScenarioActorCast` over `listShippedCastScenarioIds` via
 * `live-scenario-actor-cast.ts`. Cargo-pants known-good asserts wearers found are flat and
 * non-empty — never `===` a typed cast size. `lab_coat` classified FLAT (measured on physician:
 * tex=NONE, factor ~[0.92,0.92,0.90]). Clause (2b) only pins actors with an authored factor row.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#372) — appended; the planted header above is immutable
 *
 * Root cause, measured: the #371 rebake ran in a worktree whose `.openclinxr-local/provider-cache`
 * lacked the toigo t-shirt's declared `t_shirt_basic_tucked.mhmat` (and `T-shirt_basic.png`), so
 * `garment_material_from_declared` took its recorded-skip path and the bake shipped the flat role
 * colour alone — the footwear slots, whose .mhmat WAS staged in that worktree, kept their textures,
 * which is why only the t-shirt regressed. `apply_garment_auto_smooth_normals` is exonerated: it
 * copies the JSON chunk verbatim and only rewrites NORMAL accessor bytes, and the shoe texture
 * survived the same smoothing pass byte-identically (hash 35dbec27 before and after).
 *
 * Fix, 2026-08-13: re-baked aisha and the child with the full staged cache. The t-shirt consumes
 * `T-shirt_basic.png` (861,166 B, byte-identical to the pre-#371 embedded texture) as
 * baseColorTexture; the #180 role colour stays the exported baseColorFactor; the #371 auto-smooth
 * pass is unchanged (`garments-are-flat-shaded-and-the-body-is-not` still green). The materializer
 * now also fails the bake loudly when a consumed garment texture is absent from the exported bytes
 * (`verify_garment_textures_in_glb`), so the next silent drop is a bake error, not a pixel grade.
 * kevin is untouched (his GLB is not part of the fix; his scrub was flat by authored state before
 * and after #371).
 *
 * Measured post-fix on the shipped bytes (NodeIO): aisha + child t-shirt materials carry
 * `baseColorTexture` (T-shirt_basic, 861,166 B, 2048²), factor [0.72, 0.68, 0.55, 1.0]; kevin
 * scrub unchanged (no texture, teal factor — flat by authored state, the known-good column).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## FIXED (#400) — appended; the planted header above is immutable
 *
 * (2b) pins the toigo t-shirt's baseColorFactor to the #180 role colour per actor. #400 makes
 * the child's factor case-driven: `soft_blue_and_warm_white` resolves to (0.55, 0.68, 0.80)
 * instead of the patient role-fallback tan (0.72, 0.68, 0.55). The counterweight's function —
 * refuse a factor-only recolour that separates the shirt from the trousers while the authored
 * texture is missing — survives per-actor: aisha keeps the tan (no reference -> role fallback),
 * the child keeps her declared palette. A factor matching neither the declared palette NOR the
 * role fallback still fails. Measured post-fix: aisha t-shirt factor (0.72, 0.68, 0.55), child
 * t-shirt factor (0.55, 0.68, 0.80), both with the authored T-shirt_basic.png texture (861,166 B).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## FIXED (#553) — appended; the planted header above is immutable
 *
 * `mat_makeclothes_library_footwear_toigo_flats` moved from AUTHORED_TEXTURE to
 * FLAT_BY_AUTHORED_STATE: Shoe.png is a leopard-print atlas; #553 drops it for every wearer
 * (plain bcf 0.10,0.09,0.08). The .mhmat still declares the PNG; the bake intentionally skips it.
 * t-shirt / mj_cloth_shoes / male_boots authored-texture rows unchanged.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * MEASURED 2026-08-13 from the staged provider cache (see the header table). Material BASE name
 * (the `.NNN` export suffix is stripped) -> the authored diffuse texture that must ship as
 * baseColorTexture. A garment absent from this table AND absent from FLAT_BY_AUTHORED_STATE is a
 * NEW garment and fails the enumeration guard rather than passing silently (§7t).
 */
const AUTHORED_TEXTURE: Record<string, { texture: string }> = {
  mat_makeclothes_library_toigo_t_shirt: { texture: "T-shirt_basic.png" },
  // #553: toigo_flats Shoe.png is a leopard-print atlas — moved to FLAT_BY_AUTHORED_STATE.
  mat_makeclothes_library_footwear_toigo_mj_cloth_shoes: { texture: "MJ-shoes3.png" },
  mat_makeclothes_library_footwear_culturalibre_male_boots: { texture: "boot.png" },
  // #199: the nurse's upper is now the CC0 long-sleeve sweater; its declared
  // sweater_fisherman.mhmat -> shirt-knit.png (2,316,765 B) is staged and consumed by the #360
  // path, so it must ship as baseColorTexture exactly like the t-shirt.
  mat_makeclothes_library_fisherman_sweater: { texture: "shirt-knit.png" },
};

/**
 * Garments that ship a FLAT role colour because their authored texture never reaches the bake —
 * the flat colour IS the authored state (kevin's scrub shirt is the known-good column: flat,
 * unregressed).
 *
 * TWO DISTINCT SKIP REASONS land here, and the original wording ("declared .mhmat is NOT staged")
 * only covered the first. Widened 2026-08-21 after `scrub_pants` was measured:
 *
 *   1. the declared `.mhmat` itself is absent from the provider cache
 *   2. the `.mhmat` IS staged but the PNG it declares is not — `scrub_pants` stages
 *      `Scrub_Pants.mhmat` (which names `diffuseTexture "ScrubsMain_Pants_BaseColor_Utility -
 *      sRGB - Texture.png"`) and that PNG is absent, so the bake takes `GARMENT_MATERIAL_SKIP`
 *      (`materialize_mpfb_humanoid_candidate.py`) and falls back to the flat factor.
 *
 * Same shipped outcome, different reason. Measured on all three wearers: `tex=NONE`,
 * `factor=[0.05, 0.48, 0.52]`.
 *
 * **This Set is a REGISTRY, not a cache of what happens to ship.** The enumeration guard below
 * fails closed on any garment in neither table precisely so a new one cannot pass silently (§7t).
 * Do NOT replace it with an enumeration of shipped materials — that converts a working
 * fail-closed guard into a vacuous pass, which is the defect it exists to prevent. Adding a
 * measured row here IS the designed workflow.
 *
 * `scrub_pants` is classified flat on the evidence above; whether it SHOULD be textured is a
 * separate acquisition question (the PNG is nameable and unstaged) and is tracked on #521.
 */
const FLAT_BY_AUTHORED_STATE = new Set<string>([
  "mat_makeclothes_library_cargo_pants",
  "mat_makeclothes_library_scrub_shirt",
  // #521 — .mhmat staged, declared PNG absent -> GARMENT_MATERIAL_SKIP -> flat teal factor.
  "mat_makeclothes_library_scrub_pants",
  // #528 — physician lab coat: measured tex=NONE, factor ~[0.92,0.92,0.90] (flat by authored state).
  "mat_makeclothes_library_lab_coat",
  // #553 — .mhmat declares Shoe.png (leopard atlas); bake intentionally skips it for clinical
  // plausibility (#502 clinicians, #553 all cast wearers). Plain bcf (0.10,0.09,0.08) ships.
  "mat_makeclothes_library_footwear_toigo_flats",
]);

/** #506: the patients' closed_casual upper role colour — no longer the skin-adjacent
 * cream [0.72, 0.68, 0.55] (28.7 RGB from aisha's skin texture mean). Muted olive-green. */
const TOIGO_ROLE_COLOUR = [0.34, 0.44, 0.34] as const;
/**
 * #400 (2026-08-14): the child's t-shirt factor is now case-driven like the rest of the cast —
 * `soft_blue_and_warm_white` resolves through `garment_shell_color` to (0.55, 0.68, 0.80)
 * instead of the patient role fallback tan. The counterweight's job (refuse a factor-only
 * recolour that separates the shirt from the trousers while the authored texture is missing)
 * survives per-actor: aisha keeps the role-fallback tan, the child keeps her declared palette.
 * A factor matching neither the declared palette NOR the role fallback still fails.
 */
const TOIGO_ROLE_COLOUR_BY_ACTOR: Readonly<Record<string, readonly [number, number, number]>> = {
  "mpfb-ob-patient-aisha": TOIGO_ROLE_COLOUR,
  "mpfb-peds-patient-child": [0.55, 0.68, 0.8],
};
const FACTOR_EPS = 0.005;

/** Texture substance floors — measured: T-shirt_basic.png 861,166 B / 2048²; the footwear
 * maps are larger. A 1x1 stub or a tiny placeholder cannot clear them. No luminance floor:
 * a plain pale fabric (the known-good T-shirt_basic.png, sd 9.5) is legitimately flat. */
const MIN_TEXTURE_BYTES = 50_000;
const MIN_TEXTURE_DIMENSION_PX = 256;

type Row = {
  actor: string;
  material: string;
  base: string;
  hasTexture: boolean;
  textureBytes: number;
  png: { width: number; height: number; sd: number } | null;
  baseColorFactor: number[];
};

const io = new NodeIO();

function stripSuffix(name: string): string {
  return name.replace(/\.\d{3}$/, "");
}

async function measure(assetPath: string): Promise<Row[]> {
  const actor = (assetPath.split("/").pop() ?? "").replace(/\.glb$/i, "");
  const doc = await io.read(join(REPO_ROOT, assetPath));
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const material of doc.getRoot().listMaterials()) {
    const name = material.getName() ?? "";
    if (!/makeclothes_library/i.test(name) || /eyes/i.test(name)) continue;
    const base = stripSuffix(name);
    if (seen.has(base)) continue;
    seen.add(base);
    const tex = material.getBaseColorTexture();
    const img = tex?.getImage() ?? null;
    out.push({
      actor,
      material: name,
      base,
      hasTexture: tex !== null,
      textureBytes: img?.byteLength ?? 0,
      png: img && img.byteLength > 0 ? pngLuminanceSd(img) : null,
      baseColorFactor: [...(material.getBaseColorFactor() ?? [])],
    });
  }
  return out;
}

/** Live cast MPFB paths — never a hand-typed three-actor literal (#528). */
const CAST_MPFB_PATHS = listUniqueLiveCastMpfbAssetPaths();
const rows = (await Promise.all(CAST_MPFB_PATHS.map((p) => measure(p)))).flat();

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(
    CAST_MPFB_PATHS.length,
    "live cast must enumerate more than the historical three-actor literal",
  ).toBeGreaterThanOrEqual(3);
  expect(
    rows.length,
    `garment materials measured across ${CAST_MPFB_PATHS.length} live-cast MPFB assets`,
  ).toBeGreaterThanOrEqual(CAST_MPFB_PATHS.length * 2);
  // Every garment material must be classified by the authored state, or the enumeration is blind.
  const unclassified = rows.filter(
    (r) => !(r.base in AUTHORED_TEXTURE) && !FLAT_BY_AUTHORED_STATE.has(r.base),
  );
  expect(unclassified.map((r) => `${r.actor}::${r.material}`), "unclassified garment material").toEqual([]);
}

const idOf = (r: Row): string => `${r.actor}::${r.base}`;
const show = (r: Row): string =>
  `${idOf(r)}: texture=${r.hasTexture} bytes=${r.textureBytes} factor=[${r.baseColorFactor.map((x) => x.toFixed(2)).join(",")}]`;

describe("a fitted garment ships with the material it was authored with (#372)", () => {
  it("(1) RED: every garment with a staged authored texture carries it as baseColorTexture", () => {
    requireRows();
    const missing = rows
      .filter((r) => r.base in AUTHORED_TEXTURE && !r.hasTexture)
      .map(show);
    expect(
      missing,
      `garment materials that lost their authored baseColorTexture:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("(2a) COUNTERWEIGHT: the bound texture is a real map, not a stub or a flat fill", () => {
    requireRows();
    const weak = rows
      .filter((r) => r.base in AUTHORED_TEXTURE && r.hasTexture)
      .filter(
        (r) =>
          r.textureBytes < MIN_TEXTURE_BYTES ||
          !r.png ||
          r.png.width < MIN_TEXTURE_DIMENSION_PX ||
          r.png.height < MIN_TEXTURE_DIMENSION_PX,
      )
      .map(show);
    expect(weak, "authored textures that are stubs, tiny, or single-colour fills").toEqual([]);
  });

  it("(2b) COUNTERWEIGHT: the toigo t-shirt keeps the #180 role colour as baseColorFactor", () => {
    // Refuses the issue's named cheap fix: separating the shirt from the trousers by giving it a
    // different flat factor. The role colour is the authored pairing (factor x texture per the
    // glTF spec) and must not move while the texture is restored. #400: per-actor now — aisha
    // keeps the role-fallback tan; the child's factor follows her declared fabricPalette
    // (soft_blue_and_warm_white -> 0.55, 0.68, 0.80). A factor matching neither still fails.
    requireRows();
    // #528: only actors with a pinned factor row — live cast grew past the three-actor table.
    const recoloured = rows
      .filter((r) => r.base === "mat_makeclothes_library_toigo_t_shirt")
      .filter((r) => r.actor in TOIGO_ROLE_COLOUR_BY_ACTOR)
      .filter((r) => {
        const expected = TOIGO_ROLE_COLOUR_BY_ACTOR[r.actor]!;
        return (
          Math.abs(r.baseColorFactor[0]! - expected[0]) > FACTOR_EPS ||
          Math.abs(r.baseColorFactor[1]! - expected[1]) > FACTOR_EPS ||
          Math.abs(r.baseColorFactor[2]! - expected[2]) > FACTOR_EPS
        );
      })
      .map(show);
    expect(recoloured, "t-shirt baseColorFactor moved off the #180 role colour").toEqual([]);
  });

  it("(3) NET known-good: the authored-flat garment stays flat — the contract keys on authored state", () => {
    // SUBJECT MOVED #199: this clause used to key on kevin's scrub shirt (the original known-good
    // column, flat by authored state because Scrub_Shirt.mhmat is not staged). #199 replaced
    // kevin's upper with the textured CC0 fisherman sweater, so the scrub no longer ships on the
    // cast GLBs; the known-good subject is now the cargo-pants cover shell, whose declared
    // cargo_pants.mhmat is likewise not staged (flat by authored state). #528: wearers are
    // enumerated from the live cast — do not assert wearer count === a typed population size.
    requireRows();
    const cargoPants = rows.filter((r) => r.base === "mat_makeclothes_library_cargo_pants");
    expect(
      cargoPants.length,
      "cargo-pants cover shells measured across the live cast (wearers, not typed population size)",
    ).toBeGreaterThan(0);
    expect(
      cargoPants.filter((r) => r.hasTexture).map(show),
      "cargo-pants shells that gained an invented texture",
    ).toEqual([]);
  });
});
