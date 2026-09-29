# Hemisphere retune: ceiling tile-box blue fix (2026-09-29)

Follow-on to the lighting-design rig retune (REPORT.md in this dir) in the same
job dir. Runtime-only, zero Blender processes. One source file touched:
`packages/openclinxr/xr-station/src/station-interior-lighting.ts`,
`raised_hemisphere_ground` branch only.

## Diagnosis (code-confirmed)

The ceiling tiles face downward, so their visible surface is lit predominantly
by the GROUND term of the `raised_hemisphere_ground` hemisphere light. That
ground color was 0xc8d0dc (R200 G208 B220, blue the highest channel), consistent
with the measured tile-box blue overshoot (+15.4) that five rig spanning
3000-6500K could not move. The wall box is lit by a mix of this hemisphere
ambient plus the rig's directional/point lights, so every hemisphere change was
re-measured on BOTH boxes.

## Active-variant scope

`apps/ui-xr/src/lighting-rig-runtime.ts:153` forces the base to
`raised_hemisphere_ground` whenever a valid rig exists, then overlays the rig.
The ward room ships a rig, so this is the active variant. The other branches
were left untouched: `control` and `room_environment_ibl` use a near-black
ground (0x223042) by design as alternate candidates, and `lab_ambient_fill`
uses an AmbientLight with no hemisphere terms.

## Hemisphere-RED (just-landed baseline, re-captured this job)

- Wall `captures-hemisphere-red/runtime-02-toward-bed-wall.png`:
  (202.9, 202.4, 198.0), deltas (-0.7, -0.3, +0.9), R-B 4.9. PASS.
  (Tile sha bit-identical to the prior job's captures-green; wall within 0.1.)
- Tile `captures-hemisphere-red/runtime-03-ceiling-corner.png`:
  (170.2, 171.6, 175.2), deltas (+3.5, +5.4, +15.4). B FAIL.

## Iterations (each: edit src, rebuild xr-station dist, capture 02+03 to /tmp, measure)

- Ground 0xc8d0dc -> 0xc0c0c0 (neutral grey, sky unchanged): tile
  (163.9, 159.7, 155.2) all-PASS; wall (201.9, 200.0, 193.8) channels PASS but
  |R-B| 8.1 exceeds the reference spread 6.5. REJECT on the spread bar.
- Sky 0xf4f0dc -> 0xf4f0e8 (B 220->232, R/G unchanged): wall B +2.2 to 196.0,
  R/G bit-identical, tiles bit-identical (down-facing surfaces ignore the sky
  term). Wall |R-B| 5.9 PASS. Sky is the wall-spread lever.
- Ground 0xc0c0c0 -> 0xc0c4c0 (G +4): tile G -6.5 -> -3.5, everything else
  within 0.4. FINAL.

First iteration captured no visible change (png shas identical to baseline)
because ui-xr consumes the built `dist/`, not `src/`; the rebuild step
(`pnpm build` in `packages/openclinxr/xr-station`) was added to the loop after
that. No behavior change from the final comment-only edit (hex identical).

## Hemisphere-GREEN (final: sky 0xf4f0e8, ground 0xc0c4c0, intensity 2.2)

- Wall `captures-hemisphere-green/runtime-02-toward-bed-wall.png`:
  (201.9, 200.9, 196.0), deltas (-1.7, -1.8, -1.1), R-B 5.9 within the
  reference's own spread 6.5. PASS all four checks, no regression.
- Tile `captures-hemisphere-green/runtime-03-ceiling-corner.png`:
  (164.1, 162.7, 155.5), deltas (-2.6, -3.5, -4.3). PASS all three, margins
  2.6-4.3.
- The graded GREEN sheets were inspected visually: the tile region reads
  neutral grey against the v2 reference; the wall reads neutral; the warm glow
  around the troffer is the prior job's disclosed 3000K fill-point side effect,
  outside the graded boxes and untouched by this change.

## Files

- `captures-hemisphere-red/`, `captures-hemisphere-green/`: six runtime PNGs
  each + manifests. Prefixes are distinct from the prior job's
  captures-red/captures-green; nothing overwritten.
- `hemisphere-red|hemisphere-green-NN-<name>-v2-side-by-side.png`: twelve
  sheets vs the v2 reference.
- `hemisphere-measurements.json`: machine-readable numbers.
