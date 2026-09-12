# Remaining cover-shell lowers (2026-09-12)

Factory step: clothing_consume. Discriminator: fitted lower tris == source .obj faces × 2
(exact). A shell does not. Shipped GLB bytes measured in this worktree; no Blender opened
for the three in-scope actors.

## Shipped lower tris (live bytes)

| actor | lower mesh | tris | cargo faces × 2 | verdict |
|---|---|---:|---:|---|
| mpfb-ob-patient-aisha | makeclothes_library_cargo_pants_…aisha_mesh.001 | 1075 | 392 | shell |
| mpfb-peds-parent-aisha | makeclothes_library_cargo_pants_…parent_mesh.001 | 1126 | 392 | shell |
| mpfb-viseme-inspect | makeclothes_library_cargo_pants_…aisha_mesh.001 | 1112 | 392 | shell |
| mpfb-peds-patient-child (OUT OF SCOPE, HB-07) | …child_mesh.001 | 2726 | 392 | shell, unchanged |

Card said two of three in-scope actors are female. Measured: all three are adult-female
default-macro bodies (`EYE_DIAMETER_TARGET_MM` 24.0 mm; viseme-inspect comment
"NEW default-macro adult-female body (the aisha path)"; parent "same adult-female body
as aisha").

## Staged covering library lowers

pants01 page CC0; pants02 CC-BY. Face counts from the .obj in
`.openclinxr-local/provider-cache/garments/sources/` (main worktree cache).

| garment | obj faces | faces × 2 | mhclo tag | covering? | female-appropriate? |
|---|---:|---:|---|---|---|
| cortu_cargo_pants | 196 | 392 | (none) | no — cannot cover a leg | n/a |
| toigo_wool_pants | 1337 | 2674 | `tag male` | yes (street treatment f) | no — male |
| elvs_jeans_straight_leg | 2854 | 5708 | `tag menswear` | yes (street ships 5708) | no — menswear |
| elvs_jeans_bootcut | 2854 | 5708 | `tag menswear` | yes (family-partner 5708, raycast 0.9362) | no — menswear |
| elvs_male_trouser | 1770 | 3540 | male filename | unproven | no — male |
| punkduck_male_classic_jeans | 2295 | 4590 | `tag male` | covered on street, balloon thighs | no — male |
| mindfront_male_trousers_1 | 1618 | 3236 | male | unproven | no — male |
| mindfront_male_trousers_2 | 7292 | 14584 | male | over 40k share | no — male |
| Scrub_Pants | 1352 | 2704 | `tag unisex` `profession` `medical` | yes (nurse 2704) | no — clinician wardrobe; street test refused this on a civilian |

Unstaged pants01: `cortu_jeans_shorts` (shorts, rejected when cargo exists);
`toigo_harem_pants` (street measured every interpolation ref ≥ 13380 helper — cannot
fit the #318 stripped 13,380-vert basemesh). No female covering mhclo is staged.

## Per-actor choice

| actor | candidate | appropriate? | action |
|---|---|---|---|
| mpfb-ob-patient-aisha | none | — | STOP. Missing female covering lower. |
| mpfb-peds-parent-aisha | none | — | STOP. Missing female covering lower. |
| mpfb-viseme-inspect | none | — | STOP. Missing female covering lower. |

Do not key these stems to elvs jeans (menswear). Do not put Scrub_Pants on a patient,
parent, or inspect body. Do not fall back to `build_cover_shell` to close the card.
Shipped shells stay until a covering female mhclo is staged.

Fail-closed: `LOWER_GARMENT_BY_OUTPUT_STEM` maps the three stems to
`missing_female_covering_lower`. A rebake raises instead of defaulting to
`elvs_jeans_straight_leg` (`materialize_mpfb_humanoid_candidate.py` else branch).
These actors omit `--reference` (default-macro path), so `LOWER_GARMENT_BY_REFERENCE`
cannot key them.

## Child (out of scope)

`peds_patient_child` stays `cortu_cargo_pants` in `LOWER_GARMENT_BY_REFERENCE` (HB-07).
Shipped lower 2,726 tris ≠ 392. Not rebaked.

## Counterweight (unchanged this slice)

| check | measured |
|---|---|
| nurse | 2,704 tris = Scrub_Pants 1,352 × 2 |
| street | 5,708 tris = straight-leg 2,854 × 2 |
| family-partner | 5,708 tris = bootcut 2,854 × 2 |
| waist meet | not rebaked; nurse/street stay 0 gapped at +5.0 mm |
| ladder / freeze / triangle budgets | untouched |
| front_lit captures | none — no actor changed |

## Landed test

`the-shipped-lower-is-fitted-asset-geometry-not-a-shell.test.ts`:
family-partner PASSES (5708 == 2854 × 2). aisha / parent / viseme still FAIL cargo
equality (1075 / 1126 / 1112 ≠ 392). Child still FAIL (2726 ≠ 392). Nurse/street
counterweights PASS.

claimScope: inventory of staged covering lowers; per-actor STOP; fail-closed stem
map; child unmoved; nurse/street/family-partner tris unchanged.

notEvidenceFor: visual realism; Quest/WebXR; clinical wardrobe; clipping; gown rail;
that a female covering mhclo does not exist upstream of this cache.

CLAIM: no staged covering female lower; three adult-female actors remain cargo-named
shells (1075 / 1126 / 1112 tris); child 2726 HB-07; menswear/scrubs refused; rebake
raises on those stems.

NOT TESTED: acquiring a female covering mhclo; whether any candidate clips; the gown
rail; pixel grade (no new capture).
