# Rooms defects: factory fixes + evidence

Fleet-regen follow-up. Four rooms re-promoted through the factory
(`room_generate → room_clinic_finish → lighting_design` + `factory:room:promote`
with `--no-cache`); no GLB was hand-edited. The other ten rooms are
byte-identical (`git status` shows only the four GLBs; warm promote of
`oncology_consult_room_v1` reported `changed: []`).

| Environment | Before SHA-256 | After SHA-256 |
|---|---|---|
| `behavioral_health_private_room_v1` | `393d0b0e…4f4d5ed1` | `c44c0ffd…8130318df6` |
| `ed_stroke_bay_v1` | `8466bf6e…8087720823` | `59a3a280…af51bf4580a` |
| `telehealth_home_visit_v1` | `30fbaa47…cf4fc56556d` | `98e48550…a21574e9981` |
| `surgical_ward_room_v1` | `f3e01851…b25805a` | `e8896ed8…fba5bca27` |

(Full hashes in each room's `after-a/stage2-multiview.json`
`poseDerivation.sourceGlbSha256` and the promote outputs under
`.openclinxr/evidence/rooms-defects/<room>/`.)

## D1 painted-ceiling z-fighting (behavioral, home)

Mechanism: the finish emitted the painted-ceiling slab with its underside
exactly at the shell ceiling plane and kept the shell plane, leaving two
coplanar surfaces (GLB nodes `openclinxr_ceiling_painted` +
`bedroom_0/0.ceiling`). Fix (`room_clinic_finish/compose.py`): under a
`ceiling.kind == "painted"` finish the shell ceiling mesh is removed; the
emitted slab is the only surface. T-bar rooms keep the shell (their field
hangs 60 mm below it). Proof: the stay-fixed test asserts exactly one
`openclinxr_ceiling_painted` node and no `*.ceiling` shell node; ceiling-box
(rows 0–30%) sage-patch pixels on `runtime-01-toward-door` went 54,352 →
scattered specks (largest residual component 70 px); after-a/after-b
captures are byte-identical on 21/24 poses (3 poses differ by ≤3 dither
pixels, max Δ41, in textured regions — no flicker).

## D2 behavioral-health crown (behavioral, home)

The diagnosis is refuted: no crown geometry exists. The finish removed the
shell cornice (`removedShellCornice: ["bedroom_0/0.skirting_ceiling"]`), the
recipes pin `cornice: "none"` for both painted rooms, and the final GLBs
carry no `skirting_ceiling`/`wall_angle` node. Raycasts of the brown band
pixels hit the flat white wall mesh (normals uniform, albedo has zero brown
pixels): the read is warm-shade falloff on the flat wall top under the
troffer-less evening rig, not a moulding. Treatment: none, per recipe —
correct for a ligature-resistant room (zero protrusion, provable from the
flat wall mesh + no trim nodes). Home keeps recipe `none` as well: no
residential crown is added, so nothing can render dark brown; the corner
stubs visible in the before captures are gone in the after captures.

## D3 stroke-bay door (stroke)

Mechanism, measured in the generation blend: the opening is a single
(~1.06 m) casing, but Infinigen swings the leaf (−68° here) AND two factory
habits conspire against it: (1) leaves carry hinge-edge origins (mesh spans
`[0, width]` from the origin), so centering the origin hangs half the panel
past the jamb; (2) leaf/casing are children of the yawed `entrance` cutter,
so the extract's local-space centering (`o.location -= center`) shifts them
in the parent frame. Fix: the strip now closes the leaf in the casing plane
and centers the panel bounds (rotation-aware exact placement) on the
casing-bounds centre; the extract centers via `matrix_world`, parent-safe.
A genuine pair would still distribute symmetrically (not collapsed). Proof:
panel `x[-0.225, 0.725]` centered in casing `x[-0.280, 0.780]` (55 mm
margins); test asserts one full-height leaf, width/depth ≥ 3.5, centre offset
≤ 5 mm, panel inside frame; `runtime-04-door-inside` shows a closed lite
door with lever and hinges.

## D4 telehealth-home door (home)

Same mechanism (swing was ~84°). Same fix. Proof: panel `x[-0.200,
0.700]` in casing `x[-0.255, 0.755]`; same test; capture shows a closed
maple door, no void.

## D5 surgical-ward door gap (surgical)

Mechanism: the same offset parked the leaf edge off the reveal, opening a
visible slit. Fix: panel centering (D3/D4) plus the leaf bottom now starts
at the 3 mm floor-field lift (`DOOR_LEAF_BOTTOM_CLEARANCE_M =
FLOOR_FIELD_LIFT_M`) instead of 10 mm, closing the photographed under-leaf
slit. Proof: leaf undercut 0.0 mm (faces start at 3 mm); both 9 mm reveal
strips cover the leaf edges (edge within reveal span ± 0.2 mm
meshopt-quantization tolerance, measured jitter 0.07 mm); capture shows the
closed kick-plate door with no slit.

## D6 low-pose occlusion (all rooms, pose derivation)

Mechanism: the floor-base eye sat 0.30 m off the cove wall at 0.32 m height —
inside the cove's near-field occlusion envelope — and looked slightly down,
so the cove assembly blocked the floor/base subject. Fix
(`derive-room-evidence-poses.ts`): the low eye moved to the room centre
(half-room sightline clearance) and the look target raised to +0.05 m; only
the low pose changes. Proof: `runtime-06-floor-base` clearance 2.48 m
(behavioral; was 0.30 m wall inset); captures show floor tiles, cove and
wall junction unblocked; test pins eye-at-centre and half-depth sightline.

## Evidence layout

Per room: `before/` (HEAD GLB through the frozen derived poses),
`after-a/` + `after-b/` (re-promoted GLB, repeatability pair),
`sheets/<pose>-before-after.png`. Manifests (`stage2-multiview.json`) pin
pose derivation, source GLB hashes and per-pose clearances. Mechanism tests:
`tools/openclinxr/asset-pipeline/environment/the-room-fleet-defects-stay-fixed.test.ts`
(8 tests). No clinical-validity, production-readiness or Quest-readiness
claim is made; captures are desktop-learner-runtime evidence only.
