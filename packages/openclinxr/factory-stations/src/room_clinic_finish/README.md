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
