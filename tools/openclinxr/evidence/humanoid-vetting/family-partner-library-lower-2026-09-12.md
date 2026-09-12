# Family-partner library lower (2026-09-12)

Subject: `apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb`
(live bytes 10,414,636 B / 38,657 tris). Factory step: clothing_consume.

## Candidate chosen

`elvs_jeans_bootcut` (pants02, author Elvaerwyn, `# license CC_by` / pack page CC-BY).

Why: unconsumed covering sibling of the street actor's proven `elvs_jeans_straight_leg`
(same author, same 2,854-face / 3,109-vert OBJ class, max mhclo ref 13,351 < 13,380
helper-strip). Street already ships that straight-leg asset at 5,708 tris; this actor
gets the bootcut cut so the street lower is untouched. Punkduck classic jeans covered
on the street body (raycast 0.9785) but read as balloon/jodhpur thighs. mindfront_2
is 7,292 faces / 14,584 tris — over this body's 40,000 share. Cargo (196 faces) cannot
cover a leg.

Source: `.openclinxr-local/provider-cache/garments/sources/makehuman-pants02/clothes/elvs_jeans_bootcut/mens_elv_jeans1f.obj`
— 2,854 faces. Shipped lower: 5,708 triangles = 2,854 × 2, exact.

## Discriminator (tris == faces × 2)

RED (pre-fix, planted test pointed at the live cargo shell):

```
AssertionError: family-partner lower is a shell if tris !== faces*2: expected 2789 to be 5708
```

Bite (same arithmetic on a cover-shell actor; test asserts `.not.toBe`):

| actor | lower tris | source faces | faces × 2 |
|---|---:|---:|---:|
| mpfb-ob-patient-aisha | 1075 | 196 (cortu_cargo_pants) | 392 — FAILS equality |
| mpfb-family-partner-adult (pre) | 2789 | 196 (cargo name on a shell) | 392 |
| mpfb-family-partner-adult (post) | 5708 | 2854 (elvs_jeans_bootcut) | 5708 — PASSES |
| mpfb-street-adult-male | 5708 | 2854 (straight-leg) | 5708 |
| mpfb-clinical-nurse-adult | 2704 | 1352 (Scrub_Pants) | 2704 |

## Fit

`ClothesService.fit_clothes_to_human(garment, human, mhclo=mhclo, set_parent=True)`
against the live MPFB hm08 basemesh while macros are live (`ed_chest_pain_spouse_adult`,
`--actor-role family`). Mhclo loaded first. PANTS_FIT verts 3109 → 3109, tris 5708.
LOWER_GATE verdict `covers` (outwardRaycastCoverage 0.9362, adherence 0.9637).
Cover-shell fallback refused for this reference. LOWER_RIM_REGULARIZE skipped
(covering library mesh keeps ClothesService topology).

## Standoff (landed instrument: vertex-to-body point-triangle, 0.05 m hash)

| garment | n | min | p5 | p25 | med | p75 | p95 | max | ≤1 mm | ≤5 mm |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| shirt | 5400 | 0.007 | 1.659 | 4.308 | 5.527 | 7.13 | 11.019 | 17.075 | 0.0267 | 0.3867 |
| pants | 7685 | 0.478 | 14.464 | 14.983 | 15 | 15 | 15.027 | 15.983 | 0.0016 | 0.0195 |

The covering-library branch still applies `cloth_offset` at `CLOTH_STANDOFF_M` = 15 mm
after the mhclo fit (same path as street jeans). Topology is the source asset (5,708
tris), not `build_cover_shell` body faces. Shirt on the same body is draped (p5–p95
9.36 mm). Pants are not a 2,789-tri body shell wearing the cargo material name.

## Counterweight

| check | result |
|---|---|
| nurse lower | 2,704 tris fitted Scrub_Pants |
| street lower | 5,708 tris fitted straight-leg jeans |
| waist meet family | gapped 0 / min +5.0 mm / 31 buckets / bootcut_jeans_pants |
| waist meet nurse | gapped 0 / min +5.0 mm |
| waist meet street | gapped 0 / min +5.0 mm |
| budgets.propShare | 40000 unchanged; live 38657 |
| capture | `docs/openclinxr/humanoid-vetting-captures/mpfb-family-partner-adult-front_lit.png` (2,444,739 B; orchestrator grades pixels) |

## claimScope / notEvidenceFor

- **claimScope:** this actor's shipped lower is the bootcut mhclo topology (tris = faces × 2);
  fit call; LOWER_GATE covers; waist +5.0 mm / 0 gapped; nurse and street lowers unchanged.
- **notEvidenceFor:** visual realism, Quest/WebXR readiness, clinical claims, clipping of
  this cut on this body, the other four cover-shell actors, the gown rail.

CLAIM: family-partner lower is 5,708 tris of fitted elvs_jeans_bootcut (2,854 faces × 2); aisha cargo shell 1,075 ≠ 392; nurse 2,704 and street 5,708 unchanged; waist 0 gapped / +5.0 mm.
NOT TESTED: whether the bootcut covers without clipping; mpfb-ob-patient-aisha, mpfb-peds-parent-aisha, mpfb-peds-patient-child, mpfb-viseme-inspect; the gown rail.
