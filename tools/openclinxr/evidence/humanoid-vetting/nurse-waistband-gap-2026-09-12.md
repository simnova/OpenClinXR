# Adult-nurse waistband gap (2026-09-12)

Subject: `apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`
(8,396,376 B, 38,958 triangles — same mesh as the collar/sleeve hole-guard known-good).

Isolated renderer: tracked `docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_lit.png`
+ `front_structure.png` (HB-04 three.js 4096², PerspectiveCamera 35° + frameCameraForBounds).
No Blender opened. Hide-mask work is out of scope and already closed on this body
(collar/sleeve `hiddenSubject` = 0, see-through = 0).

## Instruments

1. `measureWaistFit` (`garments-meet-at-the-waist-measure.ts`) — 36 angular buckets,
   upper hem min-Y vs pants waistband max-Y in the 12% rim band. Positive = overlap.
2. Camera-ray first-hit in box `[1880, 1980, 2220, 2180]` (collar-test header waist box),
   slot-safe classify (`scrub_pants` is pants, not shirt). Same isolated-grade camera
   as HB-07 (`see-through-pixels.ts`).

## Live geometry (instrument 1)

| field | live |
|---|---|
| upper | `mat_makeclothes_library_scrub_shirt` (9,384 tris, Y 0.974–1.525 m) |
| lower | `mat_makeclothes_library_scrub_pants` (2,704 tris, Y 0.080–1.034 m) |
| buckets | 36 |
| gapped | 2 |
| minMm | -2.6 |
| medianMm | 41.7 |
| maxMm | 52.1 |

The two gapped buckets are indices 26 and 27 (≈ +Z, camera-front): −2.6 mm and −2.5 mm.
All other buckets overlap (0.4–52.1 mm). Bound-Y of the two meshes overlaps 60 mm;
the gap is a **front hem** that sits 2.6 mm above the front waistband, not a missing garment.

`tools/openclinxr/evidence/waist-fit-coverage.json` still records this actor as
`overlapMm: 2.6`, `gapped: 0` — stale relative to these live bytes. Not rewritten here.

## Live first-hit (instrument 2)

Box `[1880, 1980, 2220, 2180]`, structure luma > 40:

| class | count |
|---|---:|
| shirt | 29904 |
| pants | 12843 |
| skin | 308 |
| hidden | 27 |
| subject | 43082 |
| skinRowCount | 9 |

Skin first-hits are `mpfb_skin_ed_chest_pain_nurse_adult` on
`mpfb_ed_chest_pain_nurse_adult_body#0` (visible skin, not MASK). They occupy
rows y=2114–2122 only (9 px). Hidden first-hits (27) are not the band.

Collar-test header on the pre-decimate bake: shirt 30057 / pants 12672 / skin 314 /
hidden 39 in the same box — same defect class, same order of magnitude.

## Why this slice cannot close the gap

The proven hem-to-waistband push (`body_param_stage.py`, #320) lives on the
**library / hm08** rail. The live nurse is produced by
`materialize_mpfb_humanoid_candidate.py`, which has the hole guard used for the
collar/sleeve known-good and **no hem-to-waistband step**. Both factory files sit
under `tools/openclinxr/asset-pipeline/**`, which this card's write-roots omit
(and the role PATH SCOPE forbids). Re-fitting `.mhclo` onto the exported GLB is
refused: glTF re-indexes verts (MakeClothes skill). Hand-pushing hem verts in the
shipped GLB would be D1 (bespoke geometry, not a factory station).

## claimScope / notEvidenceFor

- **claimScope:** live GLB + tracked isolated captures as of 2026-09-12; two
  instruments above; write-root blocker on the materializer hem-push.
- **notEvidenceFor:** visual realism, Quest/WebXR readiness, clinical claims,
  that other bodies share this front gap, that mhclo offsets would close it.

CLAIM: adult-nurse front shirt hem sits 2.6 mm above the pants waistband in 2/36
buckets; 308 visible-skin first-hits in the waist box; hide-mask is not the class.
NOT TESTED: the other eight bodies; mhclo fit-parameter clipping.
