# Brown band fix — painted-ceiling phantom contact shadow

Mechanism (see DIAGNOSIS.md): the room_generate occlusion bake counted the
shell cornice + shell ceiling plane as occluders, but room_clinic_finish
deletes both under a painted ceiling (`removedShellCornice`,
`removedShellCeiling`, slab emitted at the same plane). The baked wall-top
darkening survived against geometry that never ships; the warm evening rig
renders the direct-only strip dark brown. Only the two painted-ceiling
rooms could show it (every acoustic-tbar room keeps its ceiling and gains a
wall angle, so its baked contact shadow still matches standing geometry).

## Factory changes (no hand-edited GLBs)

1. `room_generate/room-occlusion-bake.py`: `--exclude-shell-cornice` /
   `--exclude-shell-ceiling` hide the finish-removed shell from bake rays
   (matchers mirror compose.py); excluded-only material groups skip wiring.
2. `room_generate/run.ts`: optional `occlusionExcludes` input (validated) ->
   bake flags via `occlusionExcludeFlags` (catalog-mod.ts carries the field).
3. `room_chain/run.ts`: `paintedCeilingOcclusionExcludes` sets both
   excludes in stage-1 params when `finish.ceiling.kind == "painted"`, and
   only then — the other 12 rooms keep identical stage-1 keys.
4. `room_clinic_finish/compose.py` (painted slab only): span
   wall-inner-face to wall-inner-face with 1 mm burial (was pooled bounds,
   ~11 cm soffit ring) and ride 1 mm below the wall top (was exactly
   coplanar with the dark top cap, tie broken dark at glancing angles).

## Proof (derived pose 03, native 1280x720, sheets/ + after-*/)

| room | before | after |
|---|---|---|
| behavioral band x=900 | (91, 63, 46), h=27, R-B 45 | no brown rows; wall (176,166,159)-(184,176,170); edge AA dR -7..-9, R-B <= ref+3 |
| telehealth stub x=1150 | (88, 63, 48), h=22, R-B 40 | no brown rows; old-stub rows (187,180,174)-(191,185,180) ~= wall |
| telehealth line x=640 | (133,117,106), h=2 | single edge row (144,129,120), R-B 24 vs wall 11 |

The 22-32 px phantom band/stub is eliminated in both rooms. What remains
is a single-pixel geometric-edge hairline where slab meets wall (real
standing geometry + raster coverage; AO-off control renders it flat, so no
baked component is left). Gate read: every former band row sits within ±8
of the wall below with R-B within +6; the single edge row is reported
as-is above.

## Promotion (no-op for the other 12)

- `infinigen-behavioral-health-private.glb` d2c13bf0…272506 (rig unchanged)
- `infinigen-telehealth-home-visit.glb` 858d0064…b171b (rig unchanged)
- `git status apps/` shows only these two GLBs; all other shipped GLBs and
  all rig JSONs are byte-identical.

## Tests pinning the mechanism

- `room_chain/the-room-chain-painted-ceiling-excludes-removed-shell.test.ts`:
  both painted recipes wire both excludes, acoustic recipes wire none,
  flags translate, plan refuses bad fields.
- `the-room-fleet-defects-stay-fixed.test.ts`: painted slab edges at the
  wall faces (<=10 mm; pooled span was ~110 mm off), underside 0.5-2 mm
  below the wall top, wall-top AO median-mean >= 150 (was ~0).
