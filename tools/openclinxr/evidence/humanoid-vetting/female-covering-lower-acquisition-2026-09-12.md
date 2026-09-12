# Female covering lower acquisition (2026-09-12)

Factory step: clothing_consume. Discriminator: fitted lower tris == source .obj
faces × 2 (exact). A shell does not.

## Clause 1 — search table

Pack pages: pants01 CC0, pants02 CC-BY, pants03 shorts/swim (not covering).
Archives: `pants01_cc0.zip` (files2), `pants02_ccby.zip` (already in provider cache).
Licence token quoted from the `.mhclo` header AND the pack page. Absent header
token is REFUSAL unless the 2026-08-24 pants01 index-override applies.

| garment | pack page | mhclo license token | pack page license | obj faces | max mhclo interp ref | covers a leg? | female civilian? |
|---|---|---|---|---:|---:|---|---|
| cortu_cargo_pants | [pants01](https://static.makehumancommunity.org/assets/assetpacks/pants01.html) | ABSENT (`# Cortu Johnstone - CC0`) | CC0 | 196 | 13351 | no (392 tris cannot cover) | n/a |
| cortu_jeans_shorts | pants01 | ABSENT (`# Cortu Johnstone - CC0`) | CC0 | 250 | 12990 | no — shorts | shorts, not a covering lower |
| toigo_wool_pants | pants01 | `# license CC0` | CC0 | 1337 | 13351 | yes (street treatment) | no — `tag male` |
| toigo_harem_pants | pants01 | `# license CC0` | CC0 | 5456 | **17973** | unproven | unisex/harem; **refuses #318 strip** |
| elvs_jeans_bootcut | [pants02](https://static.makehumancommunity.org/assets/assetpacks/pants02.html) | `# license CC_by` | CC-BY | 2854 | 13351 | yes (family 0.9362) | no — `tag menswear` |
| elvs_jeans_straight_leg | pants02 | `# license CC_by` | CC-BY | 2854 | 13351 | yes (street 5708) | no — `tag menswear` |
| elvs_male_trouser | pants02 | `# license CC_by` | CC-BY | 1770 | 13351 | unproven | no — male filename / menswear |
| elvs_male_trouser_with_chain | pants02 | `# license CC_by` | CC-BY | 7242 | 13351 | unproven | no — menswear |
| mindfront_male_trousers_1 | pants02 | `# license CC BY 4.0` | CC-BY | 1618 | 13351 | unproven | no — `tag Male` |
| mindfront_male_trousers_2 | pants02 | `# license CC BY 4.0` | CC-BY | 7292 | 13351 | unproven | no — `tag Male`; over 40k share |
| punkduck_male_classic_jeans | pants02 | `# license CC-BY 4.0` | CC-BY | 2295 | 13351 | yes on street, balloon thighs | no — `tag male` |
| mindfront_female_trousers_1 | pants02 | `# license CC BY 4.0` | CC-BY | 1696 | **18288** | unproven | yes tags; **refuses #318 strip** |
| elvs_disco_pants_skinny | pants02 | `# license: CC-BY` | CC-BY | 6460 | 13351 | unproven | no — `tag festive/disco/vintage` not exam-civilian |
| elvs_disco_pants_single_ruffles | pants02 | `# license: CC-BY` | CC-BY | 10290 | 13351 | unproven | no — disco/festive |
| elvs_disco_pants_double_ruffles | pants02 | `# license: CC-BY` | CC-BY | 14756 | 13351 | unproven | no — disco/festive |
| elvs_gored_elephant_pants | pants02 | `# license: CC-BY` | CC-BY | 13604 | 13351 | unproven | no — `tag fantasy/disco` |
| Scrub_Pants | community kit | `# license: CC-BY` | CC-BY | 1352 | 13351 | yes (nurse 2704) | no — clinician; street test refused on civilian |
| **punkduck_female_tight_jeans** | pants02 | **`# license CC BY 3.0`** | **CC-BY** | **2108** | **13351** | **yes** (see LOWER_GATE) | **yes — female jeans, civilian trousers** |

pants03 (elvs_retro_girly_shorts1, punkduck_female_short_jeans, swim trunks) is
short-legged; not a covering lower. Not extracted.

## Clause 2 — accepted candidate

`punkduck_female_tight_jeans` (author punkduck, uuid `2eb68cfa-7624-481c-a3e4-ba0695fd1dd2`).

1. Licence: mhclo `# license CC BY 3.0`; pack page column CC-BY. Both CC-BY class.
2. max interp ref 13351 < 13380 (fits helper-stripped hm08).
3. LOWER_GATE `covers` on the three production bakes (shirt-hem band, height_axis=2):
   aisha raycast 0.9875 / parent 0.9775 / viseme 0.9800. Adherence 1.0.
4. Civilian: tagged `Female` `Pants` `Jeans` — long jeans on an adult-female
   patient/parent/inspect body, not menswear and not medical scrubs.

Staged at
`.openclinxr-local/provider-cache/garments/sources/makehuman-pants02/clothes/punkduck_female_tight_jeans/`
(`tightjeans.obj` 2108 faces, `punkduck_female_tight_jeans.mhclo`,
`tightjeans.mhmat`, `tightjeans.png`).

## Fit (ClothesService, hm08 live macros)

`LOWER_GARMENT_BY_OUTPUT_STEM` keys the three default-macro stems to
`punkduck_female_tight_jeans`. `MISSING_FEMALE_COVERING_LOWER` remains the
fail-closed token. Cover-shell fallback raises on those stems.

| actor | PANTS_FIT tris | faces × 2 | LOWER_GATE |
|---|---:|---:|---|
| mpfb-ob-patient-aisha | 4216 | 4216 | covers 0.9875 |
| mpfb-peds-parent-aisha | 4216 | 4216 | covers 0.9775 |
| mpfb-viseme-inspect | 4216 | 4216 | covers 0.9800 |

Shipped (albedo + chest-anchor 0.085 m; face-preserving 0.4 **skipped** because
it simplified jeans 4216 → ~1900 and broke faces×2):

| actor | old sha256 / bytes | new sha256 / bytes | lower tris | total tris |
|---|---|---|---:|---:|
| mpfb-ob-patient-aisha | d987587239ee2e2b… / 8512436 | cfdcd5a3c2828daa… / 17002120 | 4216 | 92430 |
| mpfb-peds-parent-aisha | cef1e21b12c55437… / 8620932 | 57fa9d91409408e0… / 17181156 | 4216 | 92430 |
| mpfb-viseme-inspect | 98c8ec0bbc494890… / 8560664 | 7abbbac74220bba7… / 17035784 | 4216 | 92430 |

`LOWER_FIT_STANDOFF kept ClothesService positions` on all three.

## Standoff (vertex-to-body point-triangle, 0.05 m hash — same instrument as
lower-garment-cloth-offset-2026-09-12.md)

| actor | garment | n | p5 | med | p95 | p95−p5 mm |
|---|---|---:|---:|---:|---:|---:|
| aisha | shirt | 5400 | 2.270 | 5.781 | 11.047 | 8.777 |
| aisha | pants | 8432 | 1.580 | 5.933 | 11.809 | **10.229** |
| parent | shirt | 5400 | 2.143 | 5.598 | 11.024 | 8.881 |
| parent | pants | 8432 | 1.564 | 5.869 | 12.216 | **10.652** |
| viseme | shirt | 5400 | 2.104 | 5.751 | 11.127 | 9.023 |
| viseme | pants | 8432 | 1.554 | 5.930 | 12.120 | **10.566** |

Pants spread is 10 mm-class next to the same-body shirt, not a sub-millimetre
15 mm snap band.

## Counterweight (unchanged)

| check | measured |
|---|---|
| nurse | 2704 tris = Scrub_Pants 1352 × 2 |
| street | 5708 tris = straight-leg 2854 × 2 |
| family-partner | 5708 tris = bootcut 2854 × 2 |
| child HB-07 | 2726-tri cargo-named shell, not rebaked |
| budgets.propShare | 40000 unchanged (no freeze/ladder threshold raised) |

Captures (orchestrator grades pixels):
`docs/openclinxr/humanoid-vetting-captures/mpfb-ob-patient-aisha-front_lit.png`,
`mpfb-peds-parent-aisha-front_lit.png`,
`mpfb-viseme-inspect-front_lit.png`.

claimScope: pants02/pants01 search table; punkduck_female_tight_jeans staged and
keyed; three actors 4216 = 2108×2; LOWER_GATE covers; standoff spread vs shirt;
nurse/street/family/child unchanged.

notEvidenceFor: visual realism; Quest/WebXR; clinical wardrobe; clipping of this
cut; the gown rail; pants03 as covering; mindfront_female pre-strip fit.

CLAIM: three adult-female actors ship fitted punkduck_female_tight_jeans at 4216
tris (2108 faces × 2); LOWER_GATE covers 0.9775–0.9875; pants p95−p5 10.2–10.7 mm
vs shirt 8.8–9.0 mm; nurse 2704 / street 5708 / family 5708 / child 2726 unchanged.

NOT TESTED: whether the jeans clip in a renderer; pixel grade (orchestrator);
mindfront_female_trousers_1 on a helper-present body; pants03 shorts as a
deliberate short lower; Quest/WebXR.
