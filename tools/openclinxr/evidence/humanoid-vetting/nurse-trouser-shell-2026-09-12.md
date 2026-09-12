# Nurse scrub-trouser shell measurement (2026-09-12)

Subject: `apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`
(live bytes 8,396,376 B / 38,958 tris — same postopt ladder as the collar/sleeve
and waistband known-goods). No Blender opened. No geometry changed, rebaked,
promoted, or refit here — this card measures only (factory_step:
clothing_consume, unblocks staging).

## Instrument

Exact vertex-to-body-surface standoff: every garment vertex against every body
(`mpfb_ed_chest_pain_nurse_adult_body`) triangle via point-triangle distance,
body triangles in a 0.05 m spatial hash. Node transforms are identity, so GLB
local coordinates compare directly. Comparison column is the known-good
`mat_makeclothes_library_scrub_shirt` on the same body (9,384 tris — reads as
cloth in the same capture).

## Live mesh inventory

| mesh | tris | verts | material |
|---|---|---:|---|
| `makeclothes_library_scrub_shirt_…_mesh` | 9384 | 18768 | `mat_makeclothes_library_scrub_shirt` |
| `makeclothes_library_scrub_pants_…_mesh` | 2704 | 5404 | `mat_makeclothes_library_scrub_pants` |
| `mpfb_ed_chest_pain_nurse_adult_body` | 12833 | 8437 | `mpfb_skin_…` + `openclinxr_hidden_*` (MASK) |

Verbatim-copy check (quantized 1e-6): 0 / 5404 pants verts and 0 / 18768 shirt
verts coincide with a body vertex. Neither garment is a verbatim body copy.

## Vertex-to-surface standoff (mm, full populations)

| garment | n | min | p5 | p25 | med | p75 | p95 | max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| shirt | 18768 | 0 | 2.87 | 5.11 | 6.5 | 7.89 | 11.08 | 18.7 |
| pants | 5404 | 0.175 | 14.56 | 14.97 | 15 | 15 | 15.28 | 15.6 |

Share of verts at or under a standoff:

| garment | ≤1 mm | ≤2 mm | ≤5 mm |
|---|---:|---:|---:|
| shirt | 0.0091 | 0.0249 | 0.2345 |
| pants | 0.003 | 0.0044 | 0.0096 |

## Live materials

Both scrub materials are OPAQUE with flat `baseColorFactor [0.05, 0.48, 0.52]`
and **no bound baseColor texture** (GLB carries 4 textures: `MJ-shoes3`,
`skin-normal`, `skin-baked`, `blue_eye` — none on scrubs). The skin material
has a baked texture. `garment-material-consistency.json` records the shirt at
`textureBytes 2716138` and the pants at `textureBytes 0` across the cast.

## Reading

The shirt's standoff spreads like drape (p5–p95 spans 8.2 mm, 23% of verts
within 5 mm of skin). The trousers ride at a near-uniform ~15 mm shell (90% of
verts inside a 0.72 mm band, 14.56–15.28 mm; under 1% within 5 mm of skin).
That variance signature — uniform offset vs draped spread — is the
body-derived cover-shell class against the fitted-garment column, on the same
body, in the same bytes. Both meshes still carry the `makeclothes_library_`
name prefix, so the name alone does not settle it; the standoff does. Any
refit, rebake, or threshold is a later slice.

## claimScope / notEvidenceFor

- **claimScope:** live nurse GLB bytes + the exact point-triangle instrument
  above as of 2026-09-12; shirt as the same-body comparison column.
- **notEvidenceFor:** visual realism, Quest/WebXR readiness, clinical claims,
  the other eight bodies, whether an mhclo refit would clip, any treatment.

CLAIM: nurse scrub trousers stand off the body at a near-uniform ~15 mm (p5 14.56 / med 15 / p95 15.28, <1% within 5 mm) against the shirt's draped 2.87–11.08 mm spread; neither garment copies body verts verbatim; both scrub materials are flat untextured colour in the live GLB.
NOT TESTED: the other eight bodies; whether an mhclo refit would clip; any treatment at all — this card measures only.
