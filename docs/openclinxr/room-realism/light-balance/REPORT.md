# Light balance: clinic_day rig toward neutral (2026-09-29)

## Contract confirmation (read before tuning)

`room_chain/run.ts:410`: "Stage 3: lighting rig (JSON only; the GLB is untouched)."
`room_chain/run.ts:17-18`: stage 3 "writes the rig JSON the runtime/bake consume.
Does not touch the GLB." The runtime consumes the JSON through
`apps/ui-xr/src/lighting-rig-runtime.ts` (`applyStationInteriorLightingForEnvironment`
over the `raised_hemisphere_ground` base). The JSON itself comes from the pure
function `designLightingRig` (no Blender for the computation; the `runLightingDesign`
wrapper additionally spawns Blender for a placement report that neither the runtime
nor this task consumes). This job ran zero Blender processes: rig JSONs were
regenerated with `designLightingRig` and measured with three.js runtime captures.

## Result

- Wall bar: PASS. Tile R/G bars: PASS. Tile B bar: FAIL (rig-insensitive, see below).
- Code change: `clinic_day` preset in `lighting_design/run.ts` only. Rig keeps its
  7 lights, same positions/types/roles, troffer still key. No GLB change, no bake.

## Boxes (fixed for the whole job, defined on the v2 reference)

- Wall: `imagine-multiview-v2/02-toward-bed-wall.jpg` pixels (500,280,780,420).
  Reference mean (203.6, 202.7, 197.1). Reference spread (max-min) 6.5, R-B +6.5.
  Spread method: max channel mean minus min channel mean within the box.
- Tile: `imagine-multiview-v2/03-ceiling-corner.jpg` pixels (970,315,1100,385).
  Reference mean (166.7, 166.2, 159.8). Chosen as the most uniform clean-tile
  region (std 3.4-3.6; acoustic speckle floor).
- Captures are 1280x720 runtime PNGs at the hand-placed poses; same pixel boxes.

## RED (un-tuned rig: key 4000K, fill/wash 4200K, exposure 0.9)

- Wall `captures-red/runtime-02-toward-bed-wall.png`: (203.3, 197.7, 188.8),
  R-B +14.5. Deltas vs ref: R -0.3, G -5.0, B -8.3 (B outside +/-8). Spread FAIL.
- Tile `captures-red/runtime-03-ceiling-corner.png`: (169.0, 171.7, 175.7).
  Deltas: R +2.3, G +5.5, B +15.9 (B outside +/-8).

## Iterations (each: regen rig, stage to public path, capture all six, measure)

- iter1 key 4000->5000K: wall R-B 14.5->14.0, tile unchanged. Key is not the lever.
- iter2 fill 4200->5000K: wall R-B 14.0->9.0 (wall means enter +/-8 on all
  channels); tile B 175.7->176.2 (wrong direction). Single shared temperature
  cannot satisfy both surfaces.
- iter3 (throwaway): washes 5500K + fill point 3500K: wall 7.8, tile B 175.2.
- iter4 (throwaway): washes 6000K + fill point 3000K at 1.4x energy: wall 6.8,
  tile B stuck at 175.2. Tile blue is rig-insensitive.
- iter5 (throwaway): washes 6500K: wall (202.8, 202.3, 198.0), R-B +4.8, deltas
  (-0.8, -0.4, +0.9). WALL PASSES ALL. Tile still (170.2, 171.6, 175.2).

## GREEN (committed preset, code-generated rig, reproduces iter5 exactly)

`clinic_day`: keyTempK 5000, fillTempK 3000 (fill point only), washTempK 6500
(new preset field; the four washes use it, everything else keeps its field),
fillEnergy 0.9->1.26, exposure unchanged 0.9. evening_calm and ed_exam_bright
gain washTempK equal to their fillTempK (behavior unchanged for those moods).

- Wall `captures-green/runtime-02-toward-bed-wall.png`: (202.8, 202.3, 198.0),
  R-B +4.8 within the reference's own spread 6.5. PASS all four checks.
- Tile `captures-green/runtime-03-ceiling-corner.png`: (170.2, 171.6, 175.2).
  R +3.5 PASS, G +5.4 PASS, B +15.4 FAIL.
- Tile B read 175.7 / 176.2 / 175.2 / 175.2 / 175.2 across five rigs spanning
  3000-6500K: the blue is not movable from `lighting_design`. It comes from the
  `raised_hemisphere_ground` base (hemisphere ground 0xc8d0dc lights the
  down-facing tiles; that variant lives in `xr-station`, not this station) plus
  the baked tile albedo. Both are outside this task's scope and were not touched.
- Side effect, disclosed: the 3000K fill point leaves a warm glow on the ceiling
  around the troffer (visible in green-02/green-03 sheets). The graded tile box,
  away from the hotspot, still reads cool-blue per the numbers above.

## Specular streak (secondary item)

Checked. Wall material in the wired GLB is `openclinxr_finish_wall` roughness
0.85, metalness 0.0: matte painted drywall, correct against the reference; no
material defect. Vertical luminance profile down the GREEN bed-wall center strip
(x 600-680, y 260-560) spans 200.7-202.4 (1.7 units, no localized bump); the RED
profile spanned 195.2-198.6 (smooth gradient, no sharp streak either). The
reported streak reads as the warm top-to-bottom gradient the retune flattened.
No material was changed (GLB untouched per the stage contract).

## Files

- `ward.rig.json`: final code-generated rig (also staged to
  `apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json`).
- `iter*/ward.rig.json`: per-iteration rigs (iter3-5 are throwaway hand-edits).
- `captures-red/`, `captures-green/`: six runtime PNGs each + manifests.
- `red|green-NN-<name>-v2-side-by-side.png`: twelve sheets vs v2 reference.
- `measurements.json`: machine-readable numbers. `side_by_side.py`: sheet builder.
- Registry: `REPORT.md` hand-added to doc-authority as `evidence` (HEAD
  convention for measurement reports, cf. ao-overlap-fix REPORT.md), true
  evidence count 139; 33 light-balance paths hand-added to
  generated-artifact-registry, true keep-evidence count 582. The worktree
  carried a large uncommitted doc-authority rewrite from another job (mass
  reclassification, ~1000 dropped lines); only this job's single entry was
  committed-staged on a HEAD-restored copy, and the other job's worktree
  content was left in place untouched.
- Regen note: the committed public rig's light-position jitter is not
  byte-reproducible from current code (tried bbox key order and roomGlbPath
  variants; energies/temps/exposure/bbox all reproduce, positions differ by
  cm-scale seeded jitter from an older generation input). The tuned rig in this
  job is deterministic from current code. Jitter magnitude is +/-8cm on light
  positions; it does not move the box means (GREEN reproduces iter5 exactly).

## Gates

- `lighting_design` suite: 7/7 pass. `pnpm architecture`: see commit message.
  Pre-push hook: see commit message.
