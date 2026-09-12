# Adult-nurse waistband hem-fit (2026-09-12)

Subject: `apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`
(8,396,376 B, 38,958 triangles — same postopt ladder as the collar/sleeve known-good:
#695 meshopt `--simplify-ratio 0.4 --simplify-error 0.001 --simplify-only`, then
#737 lash LOD `--ratio 0.12 --error 0.005`).

Factory step: `clothing_consume`. Closed in `materialize_mpfb_humanoid_candidate.py`
by withdrawing the scrub skip on `fit_upper_hem_to_waistband` (D1, same function as
`body_param_stage.py` / #320). Not a shipped-mesh vertex edit. Hide-mask out of scope
and already closed on this body.

## Bake log

`WAIST_MEET_UPPER {'enabled': True, 'pushedVertexCount': 36, 'maxDeficitMeters': 0.00765, 'marginMeters': 0.005}`
— 2.65 mm front gap + 5 mm #320 overlap target.

## Post-promote instruments (live bytes + fresh isolated-grade captures)

1. `measureWaistFit` (36 buckets, rim 0.12):

| field | pre-fix (20c575c8) | after |
|---|---|---|
| gapped | 2 | **0** |
| minMm | -2.6 | **+5.0** |
| medianMm | 41.7 | 41.7 |
| maxMm | 52.1 | 52.1 |

2. Camera-ray first-hit in box `[1880, 1980, 2220, 2180]`:

| class | pre-fix | after |
|---|---:|---:|
| shirt | 29904 | 30522 |
| pants | 12843 | 12700 |
| skin | 308 | **0** |
| hidden | 27 | **0** |
| subject | 43082 | 43222 |
| skinRowCount | 9 | **0** |

Isolated renderer: `pnpm asset:model-vetting:glb-grade -- --glb …` three.js 4096²,
PerspectiveCamera 35° + frameCameraForBounds. Gallery selfCheck agrees, relErr 0.00043.

## claimScope / notEvidenceFor

- **claimScope:** this body's factory hem-push + postopt ladder + isolated first-hit
  and angular-bucket instruments as of 2026-09-12.
- **notEvidenceFor:** visual realism, Quest/WebXR readiness, clinical claims,
  that the other eight bodies share this front gap, that mhclo offsets would clip.

CLAIM: nurse front shirt hem meets the pants waistband (0/36 gapped, min +5.0 mm);
waist-box visible-skin first-hits 0.
NOT TESTED: the other eight bodies; mhclo fit-parameter clipping.
