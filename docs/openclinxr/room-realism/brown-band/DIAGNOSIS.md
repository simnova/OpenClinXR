# Brown band at painted-ceiling wall junction — stage-isolation diagnosis

Rooms: `behavioral_health_private_room_v1`, `telehealth_home_visit_v1`
(only fleet rooms with `finish.ceiling.kind == "painted"`).
Runtime: ui-xr scene-closure route, shipped GLBs, derived pose 03
(`runtime-03-ceiling-corner`) from each room's `stage2-multiview.json`.
Captures: 1280x720, `diag-behavioral/` + `diag-telehealth/` (full frames per
toggle), zoom crops beside this file. Method: brute-force Moller-Trumbore
raycast in-page (no THREE.Raycaster handle), texture sampling via 2d canvas
at the hit UV, one toggle at a time with restore + re-capture.

## (a) Band measurement (native res, shipped GLB)

Behavioral band, full junction width, h = 27-32 px:

| x | band rows | mid RGB | wall +30px below |
|---|---|---|---|
| 200 | 505-535 | (91, 63, 45) | (180, 170, 163) |
| 300 | 511-542 | (91, 62, 44) | (178, 169, 162) |
| 400 | 518-547 | (92, 63, 45) | (179, 170, 163) |
| 900 | 550-576 | (91, 63, 46) | (179, 170, 163) |
| 1100 | 546-574 | (71, 37, 14) | (161, 149, 139) |

Crop box: (150, 490)-(1100, 620). (x=640 spans include the wood door below
the band and are excluded from the verdict.)

Telehealth: 1-2 px junction line RGB ~(133-145, 117-130, 106-119), R-B ~28,
plus a corner stub h = 22 px: x=1150 rows 576-597 (88, 63, 48), x=1200 rows
581-602 (90, 66, 51). Crop boxes: line (100, 460)-(900, 560),
stub (1050, 520)-(1280, 650).

## (b) Raycast at band pixels (in-page, shipped GLB)

| pixel | object | material | worldY | baseColor @UV | occlusion @own channel | emissive |
|---|---|---|---|---|---|---|
| behav (900,560) | bedroom_00wall | shell_bake_wall | 2.608 | (227,227,227) | ch2 (255,255,255) | none |
| behav (300,522) | bedroom_00wall | shell_bake_wall | 2.609 | (231,231,231) | ch2 (254,254,254) | none |
| behav (640,548) | bedroom_00wall | shell_bake_wall | 2.590 | (231,231,231) | ch2 (0,0,0) | none |
| behav (900,590 wall) | bedroom_00wall | shell_bake_wall | 2.480 | (228,228,228) | ch2 (255,255,255) | none |
| tele (1150,587 stub) | bedroom_00wall | shell_bake_wall | 2.593 | (247,247,247) | ch2 (255,255,255) | none |
| tele (1200,592 stub) | bedroom_00wall | shell_bake_wall | 2.591 | (255,255,255) | ch2 (213,213,213) | none |
| tele (300,493 line) | bedroom_00wall | shell_bake_wall | 2.648 | (255,255,255) | ch2 (236,236,236) | none |
| tele (640,526 line) | openclinxr_ceiling_painted | openclinxr_finish_painted_ceiling | 2.650 | flat (0.90,0.89,0.86), no maps | no aoMap | none |

Normals are flat wall. BaseColor at every wall hit is neutral light grey:
zero brown in albedo (full-atlas count confirms: 0 brown texels in wall,
floor, other, trim albedo images). Rig present: warm evening rig
(PointLight 0xffb16e 0.6-0.77, DirectionalLight 0xffb16e/0xffa757) plus
neutral staging hemi 0xf4f0e8 2.5 + white key 1.0.

## (c) Toggle table (band RGB after each single toggle)

Behavioral x=900 (clean wall, no door):

| toggle | band pixels | verdict |
|---|---|---|
| base | (91, 63, 46), h=27 | brown reference |
| occlusion texture off (aoMap=null, 32 mats) | (193, 186, 180), no brown anywhere | BROWN REMOVED |
| rig lights whitened (all 9 to 0xffffff, same intensity) | (94, 94, 94) neutral grey gradient, R-B <= 3 | HUE REMOVED, neutral contact gradient stays |
| baseColor replaced by flat white (map=null, 74 mats) | (107, 75, 55), h=26, persists | albedo content EXONERATED |
| tone mapping off | n/a: renderer unexposed (only `__openClinXrDebugScene`) | see note |
| restore | (91, 63, 46) identical to base | rig valid |

Telehealth x=1150 stub:

| toggle | stub pixels | verdict |
|---|---|---|
| base | (88, 63, 48), h=22 | brown reference |
| occlusion off | (202, 197, 193), no brown | BROWN REMOVED |
| lights white | (91, 91, 91) neutral, no hue | HUE REMOVED |
| albedo flat | (88, 63, 48) unchanged | albedo content EXONERATED |
| restore | (88, 63, 48) identical | rig valid |

Tone-mapping note: the white-light control leaves the junction neutral grey
(94,94,94 / 91,91,91) with AO on, so the global ACES curve injects no hue;
the brown hue arrives with the warm 2700-3000K rig only.

## (d) GLB inspection (hit mesh)

Both GLBs contain exactly 13 nodes: signage EMPTY, floor field, painted
slab, 5 cove runs, wall, floor, exterior, door casing, door leaf. No
skirting_ceiling / wall_angle / cap / shell strip exists at the junction:
there is no thin-strip geometry. The band is shading on the flat wall mesh.

Wall-top faces' occlusion UVs land on dark atlas regions (top-strip face
centroids sample AO 0/0/0/254; 33/38 wall faces sample dark at centroid;
overlay `ao-topstrip-overlay.png` in scratch), while the wall below samples
open white. The wall-top contact shadow is baked, not geometric.

## Mechanism

Phantom contact shadow from the room_generate occlusion bake
(`room-occlusion-bake.py`, EMIT+AO, 0.5 m reach, whole visible scene as
occluders): at bake time the shell still carries the decorative cornice and
the shell ceiling plane within reach of the wall top, so the wall-top AO
islands bake dark. room_clinic_finish then deletes both occluders for
painted ceilings (shell ceiling removed, `removedShellCornice` recorded,
slab emitted at the same plane) with no replacement protrusion, but the
baked darkening stays. The evening rig's warm lights render the resulting
direct-only strip dark brown ((91,63,45): warm dim direct + zero indirect).
Only the two painted-ceiling rooms can show it: every acoustic-tbar room
keeps its shell ceiling and gets a wall-angle at the junction, so its
baked contact shadow still matches standing geometry.

## Fix direction

Make the occlusion bake finish-aware at the named stage: when the finish
recipe uses a painted ceiling, exclude the finish-removed shell (cornice +
ceiling plane) as bake occluders. Gate strictly on
`finish.ceiling.kind == "painted"` so the other 12 rooms keep identical
stage-1 keys and byte-identical outputs.
