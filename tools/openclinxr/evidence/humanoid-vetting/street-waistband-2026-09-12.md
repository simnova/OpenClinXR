# Street-adult waistband hem-fit (2026-09-12)

Subject: `apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb`
(15,720,228 B, 115,552 triangles — HB-03 exception, not the nurse #695/#737
postopt ladder). Shipped lower is
`mat_makeclothes_library_straight_leg_jeans_pants` (pants02 CC-BY Elvaerwyn
`elvs_jeans_straight_leg`, e59925fc), not the cargo_pants the waist-fit record
used to name.

Factory step: `clothing_consume`. Closed by withdrawing the street skip on
`fit_upper_hem_to_waistband` in `materialize_mpfb_humanoid_candidate.py` (D1,
same function as the nurse 2026-09-12 hem-fit and `garment_ops.py` / #320).
Applied on the shipped Y-up GLB via
`tools/openclinxr/asset-pipeline/makeclothes/apply-waist-meet-glb.ts` (same
constants: 36 buckets, rim 0.12, 5 mm overlap margin). Not a sculpted vertex
edit. Cover-shell `band_hi` not raised (forbidden, measured 43.3 mm on the
cargo-era skip).

## Bake log

`WAIST_MEET_UPPER {'enabled': True, 'pushedVertexCount': 38, 'maxDeficitMeters': 0.02183, 'marginMeters': 0.005}`
— 16.8 mm live gap + 5 mm #320 overlap target.

## Post-promote instruments (live bytes)

1. `measureWaistFit` (36 buckets, rim 0.12; 31 comparable):

| field | pre-fix (HEAD jeans) | after |
|---|---|---|
| lower | straight_leg_jeans_pants | **straight_leg_jeans_pants** |
| gapped | 4 | **0** |
| minMm | -16.8 | **+5.0** |

2. Isolated-grade recapture: `pnpm asset:model-vetting:glb-grade -- --glb …`
   selfCheck agrees, relErr 0.00025. Tracked copies under
   `docs/openclinxr/humanoid-vetting-captures/mpfb-street-adult-male-*.png`.

## claimScope / notEvidenceFor

- **claimScope:** this body's factory hem-push on the shipped mhclo jeans +
  isolated first-hit-free angular-bucket instrument as of 2026-09-12.
- **notEvidenceFor:** visual realism, Quest/WebXR readiness, clinical claims,
  that raising cover-shell band_hi is a valid treatment, any other actor,
  that the jeans waistband vs shirt hem is the larger contributor in isolation.

CLAIM: street front shirt hem meets the jeans waistband (0/31 gapped, min
+5.0 mm); shipped lower remains makeclothes/mhclo straight-leg jeans.
NOT TESTED: whether the jeans waistband or the shirt hem is the larger
contributor; other eight bodies; mhclo fit-parameter clipping.
