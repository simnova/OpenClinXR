# Skirting vinyl-cove fix — runtime evidence (seed 205, shell-only)

Spec: 100mm grey vinyl cove, matte, not metal.
Reference: `imagine-multiview-v2/06-floor-base.jpg` (branch
`wt/ward-reference-v2`, 1280x720). Strip boxes: A `(400,220,700,340)` mean
`(139.7,140.7,139.0)` (primary target — strip center), B `(50,220,300,320)`
mean `(155.0,155.2,151.2)`, C `(900,240,1200,350)` mean `(127.2,127.2,125.1)`.
Near-neutral (|R-G|,|R-B| < 4); the high in-box stddev is photographic shading
along the curved strip, not material texture. Target: flat matte ~140.

Captures: hand-placed v2 poses (`hand-placed-poses.json`), ui-xr three.js
runtime, 1280x720. GLBs are meshopt-compressed; captures used a decompressed
copy (same bytes otherwise — this runtime path has no meshopt decoder).

## Diagnosis (real bake evidence, not assumed)

Infinigen's `decorate.py` has no skirting path (zero "skirt" references; only
`room_walls`/`room_ceilings`/`room_floors`/doors/windows/stairs/pillars).
Skirting material comes from Infinigen's own
`wall_decorations/skirting_board.py`: a geometry-nodes `SetMaterial` with
dielectric white `plastic_rough` (roughness input 0.5–1.0 mapped to a
0.05–0.25 glossy output). The defect is this repo's classifier:
`bake_shell_materials.py` `role_for_object()` grouped every skirting name
(post-strip `bedroom_0/0.skirting_floor|skirting_ceiling`, raw
`skirtingboard_*`) into `trim` with the metal door frame, so the cove got
trim's metal-aware GLOSSY screen plus the shared low-roughness atlas.

## RED (unfixed code)

`red-workblend-roles.txt` (real seed-205 baked `work.blend` probe):
`skirting_floor` + `skirting_ceiling` carry `shell_bake_trim`, same material
as metal `door_casing` (trim albedo 52–71) and `door_leaf` (52). Skirting
texels bake bright (233, white plastic) yet render near-black: the glossy
screen + low-roughness atlas + lit downstream rebake crush it.

- `red/runtime-06-floor-base.png`: cove strip boxes mean RGB (25.6,22.1,18.4)
  center / (23.6,20.5,17.2) left / (31.1,27.4,23.0) right, std 15–26
  (streaked), warm metal tint. Reference ~140 neutral.
- `red/runtime-01-toward-door.png`: cove line core (89,84,78) / (86,83,77) /
  (41,35,29); dark lines on every wall base + ceiling cornice.
- `red/06-floor-base-v2-side-by-side.png`,
  `red/01-toward-door-v2-side-by-side.png`

## GREEN (fixed code)

New `skirting` role in `role_for_object()` (checked before trim):
`SKIRTING_BASE_COLOR_LINEAR = (0.313, 0.323, 0.352, 1.0)` flat (no albedo
bake), roughness scalar 0.9 (no roughness texture), metallic 0, normal relief
still from the shared atlas; downstream albedo rebake skips it by name
(`SHELL_FLAT_SKIP_MATERIALS`), and occlusion wiring skips it by name too
(the smart_project AO_UV islands on the dense contour are 99.4% gutter
slivers sampling near-black: with the map the cove lower half rendered ~70,
without it ~160). First-iteration flat (0.42,0.42,0.415) rendered (160,157,
150) in a no-map isolation render, giving per-channel scene gains
(0.838,0.810,0.733); the capture scene light runs warm, so the flat runs
slightly cool (sRGB ~152,155,161) to render neutral.

- `green/runtime-06-floor-base.png`: cove strip boxes mean RGB
  (130.8,129.2,126.9) center / (128.1,127.0,125.6) left /
  (135.2,132.9,129.3) right, std 6–10 (smooth matte, no streaks).
  |R-G| <= 2.3, |R-B| <= 5.9. Inside the reference strip's own 127–155
  envelope (matches box C 127.2; box A 139.7 sits 9 above). Pose-01 reads
  bracket the target from above, so no further global brightening: view
  spread already exceeds the residual.
- `green/runtime-01-toward-door.png`: back-wall cove rows ~(176–184),
  right-wall lower rows ~(138–146); neutral thin lines on every wall base +
  ceiling cornice, no dark metallic edges.
- `green/06-floor-base-v2-side-by-side.png`,
  `green/01-toward-door-v2-side-by-side.png`
- `green/green-glb-audit.txt`: 6 materials, 7.0 MB; `shell_bake_skirting`
  baseFactor (0.313,0.323,0.352), metallic 0, roughness 0.9, no
  baseColorTexture, no occlusionTexture, normal map kept.
