#!/usr/bin/env python3
"""Transfer body FACS shape keys onto a MakeClothes-fitted asset (D1 — reuse the
proven fitter, do not hand-author brow/lash/hair morph geometry).

THE DEFECT THIS FIXES: shipped MPFB bodies carry FACS shape keys (e.g.
`eyebrows-left-inner-up`) on the BODY mesh only. A fitted accessory such as the
eyebrow (`openclinxr_fitted_eyebrow_*`, a SEPARATE object per the #542 hair/eyebrow
rail) has none, so when an emotion drives a brow action unit the skin under the
eyebrow deforms while the eyebrow mesh itself stays rigid — the brow appears to float
in place. This module gives the fitted mesh the SAME-NAMED shape keys so
`applyVisemeWeights` (the runtime's per-mesh, per-name morph applier — see
`packages/openclinxr/xr-dialogue/src/viseme-morph-apply.ts`) drives it identically to
the body.

MECHANISM (VERIFIED by reading MPFB's own source,
`services/clothesservice.py:162` `ClothesService.fit_clothes_to_human`): the fitter
does not compute a fresh nearest-surface correspondence. It reads the `.mhclo`'s
FIXED per-vertex correspondence (three body-vertex indices + barycentric weights,
authored once when the accessory was made) against
`basemesh.shape_key_add(name=..., from_mix=True)` — the body's CURRENT MIXED SHAPE.
So isolating one body shape key at 1.0 and re-running the same fit yields exactly
this accessory's deformed geometry for that expression, through the same proven path
that produced its neutral pose, and with zero hand-authored geometry.

WHY A SCRATCH DUPLICATE, NOT THE ASSET ITSELF: `fit_clothes_to_human` special-cases a
target mesh that already carries shape keys — it enters edit mode with
`active_shape_key_index = 0` and edits `edit_bmesh.verts`, i.e. it overwrites the
BASIS key in place (clothesservice.py:200-214). Calling it again on the real fitted
object once its Basis key exists would silently destroy the neutral pose instead of
producing a new one. A shape-key-free scratch copy of the same mesh data takes the
object-mode `mesh.vertices` branch instead, so each pass is a clean, independent
transform of the ORIGINAL neutral vertex positions and the real object's shape keys
are only written once, at the end, from the captured results.

Considered and rejected: Blender's Surface Deform modifier + "Apply Modifier as
Shape Key" (`object.modifier_apply_as_shapekey`). It would compute a NEW nearest-
surface binding rather than reuse the correspondence this exact accessory was
authored against, is not exercised anywhere else in this pipeline, and its bind step
can silently drop vertices that fall outside its target-face search radius with no
mechanical signal. The re-fit above reuses a path already proven (by every other
fitted accessory in this file) end to end, so it is the deterministic choice — D9
explicitly does not price the extra fit calls (execution duration is not a
constraint).

claimScope: shape-key transfer onto a single fitted accessory mesh via the SAME
  ClothesService.fit_clothes_to_human correspondence used for its neutral fit.
notEvidenceFor: that the transferred pose is anatomically ideal (it is exactly as
  good as the body's own key for the same region, no better, no worse), lip-sync,
  clinical realism, or any body other than the one it was measured against.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import bpy
from mathutils import Vector


def transfer_body_shape_keys_to_fitted_mesh(
    mhclo_path: str,
    fitted_obj: bpy.types.Object,
    reference: bpy.types.Object,
    unit_names: List[str],
    kept_vertex_indices: Optional[List[int]] = None,
) -> Dict[str, float]:
    """Give `fitted_obj` a same-named shape key for each of `unit_names` present on
    `reference` (the MPFB body), driving each body key to 1.0 in isolation and
    re-running `reference`'s own `.mhclo` correspondence for `fitted_obj`.

    Returns {unit_name: max per-vertex displacement in metres from `fitted_obj`'s
    neutral (Basis) pose} — the measurement the caller reports as evidence that the
    added target actually moves geometry rather than existing with all-zero deltas.

    Preconditions: `fitted_obj` has no shape keys yet (its neutral pose is the fit
    already on `fitted_obj.data.vertices`); `reference` is the SAME body object
    `fitted_obj` was originally fit against, at the SAME topology (called before any
    helper-vertex strip the caller performs later).

    If `kept_vertex_indices` is provided, it maps new mesh vertex order (after
    reduction) to original .obj vertex order. The function remaps `mhclo.verts`
    after loading so the per-vertex correspondence remains correct. This is
    required when the fitted mesh has been reduced (e.g. eyebrow strand reduction)
    because `mhclo.verts` is a dict keyed by original .obj vertex index (0..N-1).
    """
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

    if fitted_obj.data.shape_keys is not None:
        raise RuntimeError(
            "facs transfer: fitted_obj already carries shape keys; the scratch-copy "
            "precondition (neutral pose lives only in raw vertex data) is violated"
        )

    body_key_blocks = reference.data.shape_keys.key_blocks if reference.data.shape_keys else None
    if body_key_blocks is None:
        raise RuntimeError("facs transfer: reference body has no shape keys to isolate")

    present = [n for n in unit_names if n in body_key_blocks]
    missing = [n for n in unit_names if n not in body_key_blocks]
    if missing:
        raise RuntimeError(f"facs transfer: body is missing requested units: {missing}")
    if not present:
        raise RuntimeError("facs transfer: no requested units present on the body")

    mhclo = Mhclo()
    mhclo.load(mhclo_path)

    # Remap mhclo.verts if kept_vertex_indices is provided
    # This is critical: after reduction, the mesh has M < N vertices in a different
    # order than the original .obj. The mhclo.verts dict is keyed by original .obj
    # index (0..N-1). If we don't remap, the loop will look up mhclo.verts[0..M-1]
    # and get WRONG correspondences for every kept vertex whose original index
    # was not its new enumerate position.
    if kept_vertex_indices is not None:
        old_verts = mhclo.verts
        mhclo.verts = {new_i: old_verts[old_i] for new_i, old_i in enumerate(kept_vertex_indices)}
        print(f"[facs_transfer] Remapped mhclo.verts: {len(old_verts)} -> {len(mhclo.verts)} entries")

    base_co = [v.co.copy() for v in fitted_obj.data.vertices]
    saved_values = {kb.name: kb.value for kb in body_key_blocks if kb.name != "Basis"}

    captured: Dict[str, List[Vector]] = {}
    displacements: Dict[str, float] = {}
    try:
        for unit_name in present:
            for kb in body_key_blocks:
                if kb.name != "Basis":
                    kb.value = 1.0 if kb.name == unit_name else 0.0
            bpy.context.view_layer.update()

            scratch_mesh = fitted_obj.data.copy()
            scratch_mesh.name = f"{fitted_obj.data.name}__facs_scratch"
            scratch_obj = bpy.data.objects.new(scratch_mesh.name, scratch_mesh)
            try:
                mhclo.clothes = scratch_obj
                ClothesService.fit_clothes_to_human(
                    scratch_obj, reference, mhclo=mhclo, set_parent=False
                )
                co = [v.co.copy() for v in scratch_obj.data.vertices]
            finally:
                bpy.data.objects.remove(scratch_obj, do_unlink=True)
                bpy.data.meshes.remove(scratch_mesh)

            if len(co) != len(base_co):
                raise RuntimeError(
                    f"facs transfer: vertex count changed fitting {unit_name} "
                    f"({len(co)} vs {len(base_co)} at Basis)"
                )
            displacements[unit_name] = max((c - b).length for c, b in zip(co, base_co))
            captured[unit_name] = co
    finally:
        for kb in body_key_blocks:
            if kb.name != "Basis":
                kb.value = saved_values.get(kb.name, 0.0)
        bpy.context.view_layer.update()

    fitted_obj.shape_key_add(name="Basis", from_mix=False)
    for unit_name in present:
        key_block = fitted_obj.shape_key_add(name=unit_name, from_mix=False)
        flat = [component for vertex in captured[unit_name] for component in vertex]
        key_block.data.foreach_set("co", flat)
        key_block.value = 0.0

    fitted_obj.data.update()
    return displacements
