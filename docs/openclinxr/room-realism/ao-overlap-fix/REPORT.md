# AO overlap fix (ward walls): geometric UV separation

## Status: LANDED — coarse double-wall overlap fixed; a finer, separate residual disclosed below

## 1. Question (a) vs (b): measured answer

Method: real `box_project_group` from `room-occlusion-bake.py` on the real ward
wall mesh (`bedroom_0/0.wall`), bake-equivalent wall-only grouping, 512px
footprint raster, 1px erosion (same convention as the diagnosis), per-texel
painter visibility = `(roomCenter - faceCenter) . normal > 0`.

- Tagging mechanism read first: `roomInteriorAndHull`
  (`packages/openclinxr/xr-scene/src/interior-preview-camera.ts`) splits
  interior vs hull purely by `/exterior/i` mesh-name match (finish-dressing
  `openclinxr_*` meshes excluded by userData flag). The wall object is
  interior; `bedroom_0/0.exterior` is hull.
- The runtime measured the hull question already: from inside, the hull is
  back-face culled and contributes nothing
  (`infinigen-station-environment.ts`, MEASURED AND REJECTED note). The
  extract drops exterior-mesh faces intruding into the interior by default
  (`--drop-interior-hull-faces`), so the surviving exterior is the outer
  shell only.
- At AO-bake time the exterior wears `shell_bake_other` (residue image) while
  the wall wears `shell_bake_wall`: separate UV images, so hull geometry
  cannot reach the wall's painters. Confirmed: 0 overlapping wall texels
  involve an exterior painter; all overlapping painters come from the wall
  object itself.
- Same-wall front/back skin pairs (coincident plane, opposite normal,
  0.1-0.35 m apart) inside the wall object: 0. 48/51 wall faces point
  inward; the 3 room-center-backfacing faces are door-reveal jamb slivers
  visible at grazing angles from inside, not hull.
- Opposite-wall parallel pairs >1 m apart inside the wall object: 235.

Split (fresh seed-205 shell bake, `red-overlap.json`): of 122,880 eroded
overlapping wall texels, 121,417 (98.8%) have ALL painters interior-visible
(opposite walls across the room + reveal slivers); 1,463 (1.2%) involve a
reveal sliver. Zero involve hull/exterior.

Verdict: (b) applies to ~100% of the overlap; (a) applies to ~0%. The fix is
geometric UV separation (each co-planar group -- dominant axis + sign + 5 cm
plane quantum -- packs into its own disjoint atlas cell after projection;
the per-texel `min()` reducer is retained). No faces are excluded from the
bake (the reveal slivers are legitimately rendered at grazing angles, so
packing -- not exclusion -- is also their correct treatment). Stripping the
exterior from the extract is refused: the runtime derives camera
wall-clearance (`wallThicknessMeters = hull.max.z - room.max.z`) and inner
wall planes (`measureRoomInteriorPlanes`) from the hull.

## 2. RED (pre-fix, reproduced)

- Fresh seed-205 shell bake via the stage-1 driver (`runRoomGenerate`,
  same footprint/door/seed as the ward chain): albedoExit 0, occlusionExit 0,
  5 shell materials, 5 AO images wired (wall sd matches the diagnosis).
- Overlap on the fresh wall mesh (51 tris post-simplify, `shell_bake_wall`
  grouping): 122,880/123,420 eroded painted texels covered by 2+ non-adjacent
  faces = 0.9956 (diagnosis: 0.974 on the 102-tri pre-simplify mesh; same
  conclusion -- overlap is the norm). Figure: `red-wall-uv-overlap.png`;
  numbers: `red-overlap.json`. In-repo RED: the new separation test fails
  pre-fix (`frac=0.9956`, no separator).
- Pose-02 capture through the real ui-xr runtime against the RED shell GLB
  (container-only meshopt transcode, geometry/maps bit-identical):
  `captures-red/runtime-02-toward-bed-wall.png` shows the dense dotted-diamond
  lattice across the bed wall. Bed-wall crop metric (diagnosis convention):
  wallMean 129.8, sd 44.0, dotFrac 0.0865, dot depth 28.7 -- reproducing the
  diagnosis H3 baseline exactly (deterministic seed-205 pipeline).
- Side-by-sides vs v2 references: `red-01-toward-door-v2-side-by-side.png`,
  `red-02-toward-bed-wall-v2-side-by-side.png`,
  `red-06-floor-base-v2-side-by-side.png`.

## 3. GREEN (post-fix)

- Applied fix: `room-occlusion-bake.py`'s `box_project_group` now packs each
  co-planar group (dominant axis + sign + 5 cm plane quantum) into its own
  disjoint atlas cell after projection, so opposite-wall pairs and reveal
  slivers no longer share UV space. The per-texel `min()` reducer is
  unchanged (retained per the verdict above).
- Same wall mesh, same measurement method as RED: `overlapEroded` 0 of
  49,075 painted texels (46,713 interior-visible) -- `overlapFrac = 0.0`,
  down from RED's 0.9956. Figure: `green-wall-uv-overlap.png`; numbers:
  `green-overlap.json`. In-repo GREEN: the coplanar-separation test passes
  post-fix.
- Pose-02 capture through the real ui-xr runtime against the GREEN shell
  GLB: `captures-green/runtime-02-toward-bed-wall.png`. The dense
  dotted-diamond LATTICE from RED is gone -- confirmed by direct visual
  inspection, not just the overlap metric.
- **Residual, disclosed and NOT fixed here**: a fainter, different-mechanism
  artifact remains visible on the bed wall -- diagonal chains of dark dots
  plus soft diamond-shaped tonal blotches. This job's own extensive
  investigation (many hours, ruled out in order: material/UV-layer
  mismatch, mip-bleed/dilation, degenerate-UV barycentric fallback,
  exterior-hull contamination, node-scale/BVH mismatch between bake-time
  and imported geometry, AO-weight normalization drift) traced it to
  within-plane triangulation-diagonal `min()` arbitration at co-planar quad
  boundaries -- a SEPARATE mechanism from the double-wall overlap this job
  targeted. A texel-hashed deterministic jitter was implemented and tested
  as a candidate fix; it measurably had NO EFFECT on the dot metric,
  falsifying that hypothesis. Root cause not isolated further; flagged as a
  distinct follow-up job, not chased further here given the scope of this
  one (double-wall UV overlap, now fixed) and the cost already spent
  investigating it.
  - Supplementary cross-check (own measurement, not the diagnosis's exact
    dot-metric convention): a wall-region crop (35-75% height, 15-85% width)
    of `captures-green/runtime-02-toward-bed-wall.png` gives mean 149.4,
    std 32.0 -- visibly less noisy than the RED figure's dense lattice, but
    the residual diagonal dot chains and blotches are still present on
    direct visual inspection.
- Side-by-sides vs v2 references: `red-*-v2-side-by-side.png` (pre-fix,
  already committed) show the same three poses (01, 02, 06) for comparison;
  GREEN-vs-v2 side-by-sides were not separately regenerated in this round
  (captures-green/ holds the raw GREEN frames; a follow-up can build
  GREEN-vs-v2 sheets from them without a new bake).

## 4. Trim/casing gap

Confirmed still open, unchanged from the original diagnosis: casing
(`door_casing`/`doorcasingfactory` name matches in
`bake_shell_materials.py`'s trim role, lines ~155-164) still bakes under the
shared "trim" role alongside door leaf and window, the same near-black
metal-aware GLOSSY screen the skirting fix (landed on main) moved skirting
OUT of. Skirting has its own matte role; casing does not. Named here as a
real, unaddressed follow-up -- not fixed in this job (out of scope, per the
original brief).

## 5. Gates and commit

- `pnpm architecture`: to be run before commit.
- `pnpm hooks:pre-push`: to be run before commit.
- Commit lands the geometric UV-separation fix, the new coplanar-separation
  test, and this report with RED+GREEN evidence. Does not land a fix for
  the triangulation-diagonal residual or the casing gap -- both are
  disclosed, real, open follow-ups.
