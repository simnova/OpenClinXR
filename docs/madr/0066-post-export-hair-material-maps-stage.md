# 0066 — post-export hair material-maps stage (MAPS-TOIGO)

- Status: **accepted**
- Date: 2026-11-18
- Deciders: super-ceo-cap42 (RULING FU11, 2026-11-18)
- Known-good inputs: `tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py`; `tools/openclinxr/asset-pipeline/makeclothes/embed_library_hair.py` (`source_hair_shininess`, `recolour_to_token_chroma_linear`); shipped `mpfb-peds-parent-aisha.glb` as the MASK reference
- Source: `JOB/RULING-cap41-maps-toigo-grade1.txt`, `JOB/RULING-cap41-maps-toigo-fu5.txt`, `JOB/RULING-cap41-maps-toigo-fu6.txt`; worker handbacks RESULT-fu4 through RESULT-fu8 in the same job directory (local lane record, not in the repo)

## Context

The MPFB-fitted Toigo scalp hair ships without usable glTF material maps: the Blender bake leaves the hair untextured (baseColorFactor only), while the authored asset carries a diffuse texture and a `BakedHairNORMAL` normal map plus an `.mhmat` `shininess` scalar. Re-baking the bodies in Blender to wire these maps was rejected (geometry, rig, and animation must stay byte-identical), so FU4–FU8 built a post-export byte stage that splices the authored maps into the shipped GLB binaries.

## Decision

1. **Roughness = 1 − shininess.** The stage sets `roughnessFactor` to `1.0 - shininess` read from the hair asset's own `.mhmat` (`source_hair_shininess`), following the MPFB materializer rule (MPFB `abstractmaterialwrapper.py:44-54`: Principled roughness is `1.0 - shininess` when no explicit roughness is declared). Measured values: 0.98039 on all three bodies (child, robert, family-partner). When the asset declares no parseable shininess the stage STOPS instead of inventing a number.
2. **Specular map UNMAPPED.** No specular extension is written. There is no committed Phong `specularColor` → glTF `specularColorFactor` reference for these assets, so inventing specular parameters would be fabrication; the decision is recorded here rather than in JSON.
3. **The grade rig is the product rig.** The studio candidate-capture rig (`apps/arena/model-vetting-studio/src/candidate-capture.ts:234-240`: fixed clear color, ambient + key + fill lights, optional grid) is uncalibrated for hair — it has no hair-specific lighting or capture calibration. Product acceptance is the 1:1 grade rig per `JOB/RULING-cap41-maps-toigo-grade1.txt` and `JOB/RULING-cap41-maps-toigo-fu6.txt`, not the studio capture.
4. **Alpha MASK 0.2 is copied, not sourced.** The stage writes `alphaMode` MASK + `alphaCutoff` 0.2 copied from the shipped `mpfb-peds-parent-aisha.glb` (the vetting known-good; `mpfb-hair-materials-carry-their-authored-maps.test.ts` treats aisha as `KNOWN_GOOD` with cutoff 0.2). No committed source for the 0.2 value exists; it is a carried-over constant, recorded here rather than in JSON.
5. **Post-export chroma recolour, not bake mean-scale.** The diffuse is recoloured in linear space with `recolour_to_token_chroma_linear` (per-texel luminance toward the case token chroma, alpha-weighted mean) instead of the bake's `recolour_to_mean_linear` per-channel mean scale, because a per-channel scale keeps the source channel spreads and shifts hue on saturated tails. Tint is baked into texels; `baseColorFactor` is cleared to white.

## Verification (2026-11-18)

- FU7 A1 accessor equality: every mesh but the hair material is byte-equal to the 30083bee8 pre-image bytes.
- `the-shipped-mpfb-garments-record-source-mhclo.test.ts` (7 tests) green, including the robert gown resolving C5 through the maps level (2 peels to the `--python` bake).
- `mpfb-hair-materials-carry-their-authored-maps.test.ts` green on all three bodies.

## Consequences

- Sidecar `notes` arrays carry no MAPS-TOIGO lines; the byteLineage `why` cites this MADR instead of JSON-embedded decisions.
- If MPFB changes the shininess→roughness mapping, or a Phong→glTF specular reference is committed, this MADR must be superseded before the stage changes.
- The 0.2 cutoff remains unsourced: any re-derivation must either find its source or supersede this MADR with a measured value.
