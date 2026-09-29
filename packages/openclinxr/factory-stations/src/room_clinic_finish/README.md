# room_clinic_finish

Composes a clinic finish pass onto a `room_generate` shell GLB in place
(ceiling, floor, door, corridor cues, geometry modules — see `recipe.ts`
for the module list and `compose.py` for the Blender-side implementation).

## Dark-factory rule: Infinigen's bake is the base, finish only ADDS

Operator direction, 2026-09 (ward-finish-chain room-realism work): *"Infinigen's
baked materials are the base, and the finish only ADDS what Infinigen cannot
make."* Concretely: `room_clinic_finish` must not replace a surface Infinigen
already baked with a flat colour or a stand-in photo merely because a photo is
available — the S2 shell bake (`room_generate`) is the source of truth for
anything Infinigen can represent (wall plaster, floor materials, structural
trim). The finish pass exists to add what the shell bake structurally cannot:
fixtures with no Infinigen asset class, ceiling systems Infinigen doesn't
model as a distinct assembly (T-bar grid, acoustic tile, troffer), and similar
gaps.

## Documented exception: the door leaf photo

`_texture_kept_door_leaf()` assigns a maple-veneer photo (`door-maple.jpg`,
`openclinxr_finish_door_photo`) to Infinigen's own kept `*.door_leaf` mesh
(S5: the door leaf/casing/skirting geometry itself is Infinigen's, not a
hand-built replacement — only the leaf's surface material is a photo). This
is a deliberate exception to the rule above, not a violation of it: Infinigen
has no maple-veneer material class, so there is nothing in the shell bake to
preserve for the leaf's face — the photo adds a finish Infinigen structurally
cannot produce, the same class of addition as the ceiling T-bar/troffer work.
The casing and skirting are NOT photo-textured; they keep the flat trim paint
assigned earlier in the same compose pass (no trim photo exists in the
licensed set), which is itself downstream of whatever role `room_generate`'s
shell bake classified them into (see `bake_shell_materials.py`'s
`role_for_object`, the "trim" role).

Recorded 2026-09-28 after a product-owner grade (v2 reference poses 03/05)
confirmed the door leaf now reads correctly (maple leaf, narrow vision lite,
casing) and asked for this to be documented as a deliberate exception rather
than left implicit in the code comments.

## Documented exception: the ward door furniture (vision lite + hinges + casing)

Under `ward_photo` the finish furnishes Infinigen's kept leaf and casing
(`_furnish_ward_door` in `compose.py`, recipe `options.door` carrying the
hinge side plus the lite fallback fractions, both threaded from the chain's
`WARD_CHAIN_DOOR` single source). Deliberate exception, recorded 2026-09-29
after a coordinator pixel grade of the seed-205 chain (v2 references 01/04):
the ward door rendered as a residential door (recessed panel moulding,
round knob, no visible casing band, maple-filled vision area).

Infinigen-first was investigated per part and recorded in
`run_fixed_footprint.py` (ward audit comment on the door-pin flags):
- Flush leaf, satin lever, narrow vision-lite opening, 55 mm casing face:
  TAKEN in Infinigen via deterministic driver pins (`--door-handle lever`,
  `--door-lite-rect`, `--door-bevel-mm 2.5`, `--door-casing-margin-m 0.055`
  over the pinned `lite` factory). Upstream draws the handle from
  `choice(["knob","lever","pull"])` (`doors/base.py:56`), the lite dims
  from uniform branches (`doors/lite.py`), the panel recess depth from
  `bevel_width` (`doors/base.py:46`), and the casing face from a fixed
  `margin = 0.11` (`doors/casing.py:32`) -- none gin-configurable, so the
  driver pins them as post-draw constants (seeded, recorded in the
  generate report, in the stage cache key via the driver hash + params).
- Vision glass: NOT FOUND in Infinigen-through-our-bake. `LiteDoorFactory`
  cuts a real through-opening (verified seed-205 via the glass-attribute
  bbox: x 0.029..0.154, z 1.309..1.858) and tags a glass selection, but
  `bake_shell_materials.assign_role_material` clears every slot into one
  `shell_bake_trim` material, so the lite bakes and reads as wood; and
  simplify shreds the opening rim (770 micro-boundary loops, no clean
  rim), so the opening cannot be measured post-simplify either. The finish
  glazes the opening with a dark partly-transparent
  pane (`openclinxr_door_glass`: near-black blue-grey albedo, roughness
  0.06, alpha blend 0.9 -- not transmission, which the envmap-less
  runtime renders as an opaque beige slab) plus a steel lite frame; maple
  stays on the leaf. The opening rect comes from
  the deterministic recipe fractions mapped exactly like the factory
  (leaf-local +x runs toward world -x, over (span - 2*margin) + margin
  with the pinned panel_margin, all single-sourced from the chain's
  `WARD_CHAIN_DOOR`); a sane measured rim loop only cross-checks
  (recorded as `rimCheck`, never placed).
- Hinges: NOT FOUND in Infinigen (no hinge symbol anywhere under
  `assets/objects/elements/doors/`). The finish adds three steel hinge
  plates on the jamb opposite the detected handle: the extracted leaf can
  mirror leaf-local axes, so the recipe hinge side is not trusted for
  placement (recorded as `hingeSideUsed: handle-detect`). The recipe
  mapping is only a fallback for handle-less input, guarded to the leaf
  width axis (fail closed on mismatch).
- Lever faces + lock cylinder: the pinned Infinigen lever merges into the
  leaf mesh and would inherit the maple photo material. The finish assigns
  a steel slot to faces protruding past either slab face + 8 mm
  (area-weighted slab planes over thin-axis faces: a vert-count histogram
  fails because the big flat slab faces carry few verts while dense
  handle/spin geometry wins the bins; pockets only recess inward, so they
  are untouched) and adds a steel lock cylinder 60 mm above the lever top on
  the room-side face (`openclinxr_door_lock`). Reported as `handle`
  (u/v bbox + steel face count). Steel is full satin (metallic 1.0,
  roughness 0.35, light grey) per coordinator grade; the handle geometry
  itself is a plain straight bar because the driver pins
  `level_type = "cylinder"` (it draws wave/cylinder/bent, and cylinder
  skips both offset branches in `make_levers`).
- Casing paint: the casing geometry is Infinigen's (placed at
  `casing_chance = 1.0` by the chain's gin config) but its surface draws
  random metal/wood; Infinigen has no white-painted casing class, so the
  finish repaints the kept casing to the palette trim (`openclinxr_finish_casing`).

## Documented exception: the ward vinyl-tile floor field

Under `ward_photo` the finish emits a procedural vinyl-tile floor field
(`openclinxr_floor_field`, material `openclinxr_finish_floor_tile_photo`)
that covers the shell `shell_bake_floor`, instead of passing the shell
floor through. This is a deliberate exception to the dark-factory rule,
not a violation of it, recorded 2026-09-29 after a coordinator pixel
grade of the seed-205 chain (v2 references 02/06): the shell floor
(`BumpyRubberFloor` procedural rubber, the S4 realism pin) renders as a
blotchy low-frequency cloud with no seams, while the reference shows
light grey-beige vinyl tile on a 600 mm module with fine seams and fine
speckle.

Infinigen-first was investigated and refused (NOT FOUND is the research
answer here): Infinigen ships no vinyl/linoleum material class
(`assets/materials/` holds plastic, ceramic, wood, fabric, and others --
no vinyl), and the closest tile family (`ceramic.Tile.generate` in
`assets/materials/ceramic/tile.py`) draws a random shader, random shape,
and random scale per seed (`log_uniform(1.0, 2.0)` in shader space, not
metre modules), so a 600 mm speckled vinyl module is not selectable or
parameterizable in `room_generate`. Deterministic and cache-keyed: the
tile face is generated by the seeded
`textures/generate-floor-tile-face.py` (one repeat spans exactly one
0.6 m module, seam borders plus matching normal-map grooves, zero
low-frequency energy by construction), baked into UV0 in metres exactly
like the ceiling tile face, and every byte under `textures/` joins the
`room_clinic_finish` stage cache key (see `room_chain/cache.ts`
`resolveStageKeyFiles`). Other presets keep the legacy 1.2 m
sheet-vinyl photo field (their tests pin it).

## Documented exception: the ward thin cove base

Under `ward_photo` the finish removes Infinigen's shell floor skirting
and emits a thin vinyl cove base (`openclinxr_cove_*` runs, material
`openclinxr_finish_cove`) instead. Deliberate exception, recorded
2026-09-29 after a coordinator pixel grade of the seed-205 chain (v2
reference 06): the shell skirting renders as a thick translucent-looking
band with a double edge line, while the reference shows a thin coved
vinyl base, 100 mm tall, mid grey, one clean top edge, almost flush.

Infinigen-first was investigated and refused: `apply_skirtingboard()` in
`assets/objects/wall_decorations/skirting_board.py` takes no
height/profile parameters (height draws `uniform(0.08, 0.15)`, thickness
`uniform(0.02, 0.05)`, profile control points draw random peaks inside
`FixedSeed` -- nothing threads through `make_skirting_board()` or any
gin-configurable), so the specced cove is not parameterizable in
`room_generate`. Deterministic and cache-keyed: the cove runs derive
wall inner-face planes from the shell wall meshes and the door gap from
the kept leaf bbox at compose time (seed-independent geometry, no
randomness; `compose.py` joins the finish stage cache key). Profile is
a draft triangle leaning back into the wall (no flat shelf: a box top
and a chamfer cap both glared into bright bands at the pose-06
glancing angle); field and cove anchor to the measured shell floor
plane (fail-closed when absent). The 100 mm
height and matte vinyl grey land inside the existing
`room-albedo-ao-bake.py` `openclinxr_finish_cove` flat-skip entry and
the shell `SKIRTING_BASE_COLOR_LINEAR` calibration. Ceiling skirting
stays untouched; other presets keep the legacy trim-paint path.

## ward_photo preservation: the shell bake passes through

Under the `ward_photo` preset only (the ward finish chain), `compose.py`
does not repaint wall/trim and does not emit the vinyl floor field: the
`shell_bake_wall/floor/ceiling/trim` materials pass through untouched with
their baked normal/roughness maps. Rationale: the shell bake is the source
of truth for anything Infinigen can represent, and the finish previously
rebuilt every material from scratch, discarding the neutral-plaster palette,
the BumpyRubberFloor calibration, the trim-role bake, the box-projection UV
work, and the baked maps (measured: every `openclinxr_finish_*` material
shipped null normal/roughness textures). Scoped to `ward_photo`:
`peds_calm`/`clinic_day`/`evening_calm` keep the legacy repaint (their tests
pin it; no real-chain calibration depends on changing them).

Finish-added surfaces keep full PBR under every preset: the ceiling tile
face (procedural `ceiling-tile-face.png` plus derived normal/roughness) and
the door leaf (leaf-aspect `door-maple-leaf.jpg` plus derived
normal/roughness under `ward_photo`; legacy square maple, albedo-only,
elsewhere) link Normal Map and roughness textures with the same node pattern
as the shell bake's `build_role_material`. T-bar strips and the troffer lens
stay flat/emissive geometry additions, untouched.
