from __future__ import annotations

try:
    import bpy
    from mathutils import Vector
except ImportError:
    bpy = None
    Vector = None
import numpy as np

import re
import traceback
from pathlib import Path

from paths import garment_coverage as _gc


def transfer_weights_body_to_garment(
    basemesh: bpy.types.Object,
    garment: bpy.types.Object,
    arm: bpy.types.Object,
) -> dict:
    """Project body vertex groups onto the garment by nearest body vertex (world space).

    Auto-weights on a separate shirt shell often under-weight the sleeves. Copying the
    already-bound body's groups by nearest-vertex is standard weight projection — not
    hand-authored weight tables (D1).
    """
    status: dict = {"ok": False, "method": "nearest_body_vertex_group_projection", "error": None}
    try:
        # Ensure ARMATURE parent type (not OBJECT) + modifier — OBJECT parent was
        # silently killing envelope/k-NN skinning on the garment.
        garment.parent = arm
        garment.parent_type = "ARMATURE"
        garment.parent_bone = ""
        has_arm_mod = any(m.type == "ARMATURE" for m in garment.modifiers)
        if not has_arm_mod:
            mod = garment.modifiers.new(name="Armature", type="ARMATURE")
            mod.object = arm
            mod.use_vertex_groups = True
        for mod in garment.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
                mod.use_vertex_groups = True
                mod.use_bone_envelopes = False

        # Only bone-named groups participate in skinning. Transferring MPFB helper
        # groups (100+) and normalize_all dilutes arm weights to near-zero.
        bone_names = {b.name for b in arm.data.bones}
        body_mw = basemesh.matrix_world
        body_pts: list[tuple[float, float, float]] = []
        body_weights: list[list[tuple[str, float]]] = []
        body_group_names = {g.index: g.name for g in basemesh.vertex_groups}
        for v in basemesh.data.vertices:
            co = body_mw @ v.co
            body_pts.append((co.x, co.y, co.z))
            wlist: list[tuple[str, float]] = []
            for ge in v.groups:
                name = body_group_names.get(ge.group)
                if name and name in bone_names and ge.weight > 1e-6:
                    wlist.append((name, float(ge.weight)))
            body_weights.append(wlist)

        if not body_pts:
            status["error"] = "body has no vertices"
            return status

        # Simple spatial hash for nearest (grid cell ~ 2 cm)
        cell = 0.02
        grid: dict[tuple[int, int, int], list[int]] = {}
        for i, p in enumerate(body_pts):
            key = (int(p[0] / cell), int(p[1] / cell), int(p[2] / cell))
            grid.setdefault(key, []).append(i)

        def knn(px: float, py: float, pz: float, k: int = 12) -> list[tuple[int, float]]:
            """k nearest body verts with squared distances (grid-local then expand)."""
            cx, cy, cz = int(px / cell), int(py / cell), int(pz / cell)
            candidates: list[tuple[float, int]] = []
            radius = 1
            while len(candidates) < k * 3 and radius <= 8:
                for dx in range(-radius, radius + 1):
                    for dy in range(-radius, radius + 1):
                        for dz in range(-radius, radius + 1):
                            for i in grid.get((cx + dx, cy + dy, cz + dz), ()):
                                bx, by, bz = body_pts[i]
                                d = (bx - px) ** 2 + (by - py) ** 2 + (bz - pz) ** 2
                                candidates.append((d, i))
                radius += 1
            if not candidates:
                for i, (bx, by, bz) in enumerate(body_pts):
                    d = (bx - px) ** 2 + (by - py) ** 2 + (bz - pz) ** 2
                    candidates.append((d, i))
            candidates.sort(key=lambda t: t[0])
            return [(i, d) for d, i in candidates[:k]]

        # Recreate garment groups for armature bones only
        garment.vertex_groups.clear()
        gmap: dict[str, bpy.types.VertexGroup] = {}
        for name in sorted(bone_names):
            gmap[name] = garment.vertex_groups.new(name=name)
        status["boneGroupCount"] = len(bone_names)
        status["method"] = "knn12_inverse_distance_body_bone_groups"

        garment_mw = garment.matrix_world
        assigned = 0
        for v in garment.data.vertices:
            co = garment_mw @ v.co
            neighbours = knn(co.x, co.y, co.z, k=12)
            if not neighbours:
                continue
            # inverse-distance blend of bone weights from k nearest body verts
            accum: dict[str, float] = {}
            w_sum = 0.0
            for ni, d2 in neighbours:
                wlist = body_weights[ni]
                if not wlist:
                    continue
                # idw weight; floor distance so co-located verts don't explode
                inv = 1.0 / max(d2, 1e-8)
                for name, bw in wlist:
                    accum[name] = accum.get(name, 0.0) + bw * inv
                w_sum += inv
            if w_sum < 1e-12 or not accum:
                continue
            # renormalize to sum 1
            total = sum(accum.values()) or 1.0
            for name, w in accum.items():
                vg = gmap.get(name)
                if vg is None:
                    continue
                vg.add([v.index], w / total, "REPLACE")
            assigned += 1

        # Envelope pass: verts near arm bone segments get bone-proximity weights so
        # sleeves follow the limb (k-NN from torso surface under-weights arms).
        # issue-307: mixamorig arm chain (the AABB canonical names no longer exist).
        arm_bone_names = [
            n
            for n in (
                "mixamorig:LeftShoulder",
                "mixamorig:LeftArm",
                "mixamorig:LeftForeArm",
                "mixamorig:LeftHand",
                "mixamorig:RightShoulder",
                "mixamorig:RightArm",
                "mixamorig:RightForeArm",
                "mixamorig:RightHand",
            )
            if n in bone_names
        ]
        segments: list[tuple[str, tuple[float, float, float], tuple[float, float, float]]] = []
        for bn in arm_bone_names:
            eb = arm.data.bones.get(bn)
            if eb is None:
                continue
            # bone head/tail in armature local → world
            h = arm.matrix_world @ eb.head_local
            t = arm.matrix_world @ eb.tail_local
            segments.append((bn, (h.x, h.y, h.z), (t.x, t.y, t.z)))

        def seg_dist(
            p: tuple[float, float, float],
            a: tuple[float, float, float],
            b: tuple[float, float, float],
        ) -> float:
            ax, ay, az = a
            bx, by, bz = b
            px, py, pz = p
            abx, aby, abz = bx - ax, by - ay, bz - az
            apx, apy, apz = px - ax, py - ay, pz - az
            ab2 = abx * abx + aby * aby + abz * abz
            if ab2 < 1e-12:
                return math.sqrt(apx * apx + apy * apy + apz * apz)
            u = max(0.0, min(1.0, (apx * abx + apy * aby + apz * abz) / ab2))
            qx, qy, qz = ax + u * abx, ay + u * aby, az + u * abz
            return math.sqrt((px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2)

        # Wider envelope so short-sleeve scrub cuffs follow upper_arm under LBS (#221 A3).
        envelope_radius = 0.28
        envelope_hits = 0
        if segments:
            for v in garment.data.vertices:
                co = garment_mw @ v.co
                p = (co.x, co.y, co.z)
                env: dict[str, float] = {}
                for bn, a, b in segments:
                    d = seg_dist(p, a, b)
                    if d >= envelope_radius:
                        continue
                    # smooth falloff
                    w = (1.0 - d / envelope_radius) ** 2
                    env[bn] = max(env.get(bn, 0.0), w)
                if not env:
                    continue
                # Blend 85% envelope + 15% existing k-NN so sleeves track the arm chain.
                existing: dict[str, float] = {}
                for ge in v.groups:
                    g = garment.vertex_groups[ge.group]
                    if g.name in bone_names and ge.weight > 1e-6:
                        existing[g.name] = ge.weight
                blended: dict[str, float] = {}
                for name, w in env.items():
                    blended[name] = 0.85 * w
                for name, w in existing.items():
                    blended[name] = blended.get(name, 0.0) + 0.15 * w
                total = sum(blended.values()) or 1.0
                # Clear and rewrite this vert's groups
                for g in garment.vertex_groups:
                    try:
                        g.remove([v.index])
                    except RuntimeError:
                        pass
                for name, w in blended.items():
                    vg = gmap.get(name)
                    if vg is None:
                        continue
                    vg.add([v.index], w / total, "REPLACE")
                envelope_hits += 1
        status["envelopeHits"] = envelope_hits
        status["envelopeRadius"] = envelope_radius

        # Normalize all
        bpy.ops.object.select_all(action="DESELECT")
        garment.select_set(True)
        bpy.context.view_layer.objects.active = garment
        bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
        try:
            bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        except Exception:
            pass
        bpy.ops.object.mode_set(mode="OBJECT")

        groups = list(garment.vertex_groups)
        weighted = 0
        for g in groups:
            for v in garment.data.vertices:
                for ge in v.groups:
                    if ge.group == g.index and ge.weight > 1e-6:
                        weighted += 1
                        break
                else:
                    continue
                break
        status["groupCount"] = len(groups)
        status["weightedGroups"] = weighted
        status["assignedVertices"] = assigned
        status["garmentVertexCount"] = len(garment.data.vertices)
        status["ok"] = assigned > 100 and weighted >= 5
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-1500:]
    return status


# #387 — the bounds-derived scalp paint is a self-declared PLACEHOLDER. Its own docstring
# (automate_blender.py:4245) says it exists "before a real groom/hair-card source stage
# exists"; #381 landed the real thing (4,976 tris of fitted MakeClothes library hair on
# aisha) and nobody retired the paint underneath — she ships both, and the 2.8%-luminance
# paint under fitted hair is the hard 4096-grade boundary this issue closes.
#
# RULE (2026-08-14 medical wardrobe), not a longer id list: wherever a fitted hair
# mesh exists (or will exist on this bake), do not emit
# `openclinxr_mesh_native_scalp_hair_surface`. A retirement keyed per shipped GLB
# id is four manual exceptions — every NEW bake with hair (#403 adults) re-introduced
# the shell. figure_id is accepted for call-site compatibility / logging only.
# Default fitted_hair_present=False preserves the hm08 library rail, which still
# paints the placeholder and embeds hair later as a finish step.


def scalp_placeholder_retired_for(figure_id: str, *, fitted_hair_present: bool = False) -> bool:
    """RULE: suppress the placeholder scalp shell whenever a fitted hair mesh exists.

    figure_id is not consulted. A new bake that fits hair is clean without
    appending an id. Default False leaves library-rail bodies unchanged.
    """
    del figure_id
    return bool(fitted_hair_present)


def apply_scalp_hair_material_region(basemesh: bpy.types.Object) -> dict:
    """#279 — paint the proven bounds-derived scalp/hair material region on the hm08 body.

    Imports `apply_mesh_native_scalp_hair_material_region` from the Anny rail
    (tools/openclinxr/asset-pipeline/anny/automate_blender.py:4201), the same proven
    function #222 wired for MPFB — wire it, do not re-author it (D1). The region is
    derived from mesh BOUNDS and auto-detects the dominant height axis, so it transfers
    to hm08 topology unchanged (no vertex indices).

    ORIENTATION (MEASURED, issue-279 — determined, not assumed): the raw base.obj is
    MakeHuman Y-up with the face at +Z; the stage's import path (`wm.obj_import`,
    force_z=False) maps OBJ Y -> Blender Z and OBJ Z -> Blender -Y, so the Blender-scene
    body is Z-up standing with the face at **-Y** — exactly what the function's Z-height
    branch expects. The exported GLB (export_yup=True maps Blender -Y -> GLB +Z) confirms
    face-at-+Z end-to-end, matching the two known-good rails. NO 180-deg Z flip is needed
    (unlike the MPFB create_human rail, which faces +Y — #222's cross-rail lesson).

    Paints polygon material indices only; geometry, rig, and shape keys are untouched.
    """
    anny_dir = _TOOLS_OPENCLINXR / "asset-pipeline" / "anny"
    if str(anny_dir) not in sys.path:
        sys.path.insert(0, str(anny_dir))
    from automate_blender import apply_mesh_native_scalp_hair_material_region  # noqa: E402

    return apply_mesh_native_scalp_hair_material_region(
        basemesh, {"hair_color": "black", "hair_density": 0.65}
    )


def apply_body_hide_material_region(
    basemesh: bpy.types.Object,
    tri_mask,
    *,
    slot: str = "",
) -> dict:
    """issue-285 — body-part hiding: paint an invisible material on the poking faces.

    The §6s research answer for "the body renders in front of / z-fights the garment":
    hide the body under the garment (alpha mask) rather than push the garment out.
    A body-derived cover shell offset along vertex normals self-intersects at the
    concave hip/waist crease, and NO outward offset fixes a concave fold (measured —
    see garment_coverage.body_hide_mask). The mask is per-TRIANGLE from
    `body_hide_mask` (the same fan-triangulated `_numpy_mesh` frame the coverage gate
    uses); this maps it to the mesh's polygons (fan order) and assigns an alpha-0
    material so the hidden faces never render. Geometry is untouched — the coverage
    gate and the sparse-trouser refusal are unaffected (counterweight).

    Paints polygon material indices only; geometry, rig, and shape keys are untouched.
    """
    hidden_mat = bpy.data.materials.new(f"openclinxr_hidden_{slot}_{basemesh.name}")
    hidden_mat.use_nodes = True
    prin = hidden_mat.node_tree.nodes.get("Principled BSDF")
    if prin is None:
        prin = hidden_mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    prin.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 0.0)
    prin.inputs["Alpha"].default_value = 0.0
    try:
        hidden_mat.blend_method = "BLEND"
    except Exception:
        pass
    hidden_mat.diffuse_color = (0.0, 0.0, 0.0, 0.0)
    try:
        hidden_mat.viewport_display.color = (0.0, 0.0, 0.0)
    except Exception:
        pass
    hidden_index = len(basemesh.data.materials)
    basemesh.data.materials.append(hidden_mat)

    mask = np.asarray(tri_mask, dtype=bool)
    applied = 0
    tri_i = 0
    for poly in basemesh.data.polygons:
        iv = list(poly.vertices)
        n_tri = max(len(iv) - 2, 1)
        if bool(mask[tri_i : tri_i + n_tri].any()):
            poly.material_index = hidden_index
            applied += 1
        tri_i += n_tri
    return {
        "slot": slot,
        "hiddenMaterialName": hidden_mat.name,
        "hiddenMaterialIndex": hidden_index,
        "appliedPolygonCount": applied,
        "alpha": 0.0,
    }


# #295 — hand/finger joint names across the mixamo_unity rig. Same vocabulary as the
# evidence contract `garment-shells-stop-at-the-wrist.test.ts` HAND_JOINT regex
# (`hand|wrist|finger|thumb`); the mixamo_unity rig has no `wrist` bone, so `hand`
# carries the wrist region.
_HAND_BONE_RE = re.compile(r"hand|finger|thumb", re.IGNORECASE)
# #295 — the arm chain (arm/forearm/hand/fingers, NOT the shoulder). The cover-shell
# band selection includes the hanging arms down to the hands; a torso top does not
# claim them, so the shell is built from torso + shoulder faces only. `wrist` and
# `metacarpal` are the MPFB2 standard rig's wrist/palm bones (issue-351: the peds
# bodies' palms are metacarpal-dominant, the regex missed them, and the lower cover
# shell wrapped the T/A-posed hands — trouser shards on the fingers). No-op on the
# mixamo_unity rig, which has neither bone.
_LIMB_BONE_RE = re.compile(r"arm|forearm|hand|wrist|finger|thumb|metacarpal", re.IGNORECASE)


def _bone_dominant_vertex_indices(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    bone_re,
) -> set[int]:
    """Vertex indices of `obj` whose dominant bone matches `bone_re`.

    #295 — the garment's OWN vertex-to-bone attribution is the derived sleeve terminus
    (D1: never authored per-body coordinates). Dominant = the bone-named vertex group
    with the highest weight, matching how the evidence contract attributes exported
    JOINTS_0/WEIGHTS_0. Non-bone groups (MPFB helper/joint markers) are ignored.
    """
    bone_names = {b.name for b in armature.data.bones}
    matched = {n for n in bone_names if bone_re.search(n)}
    if not matched:
        return set()
    group_names = {g.index: g.name for g in obj.vertex_groups}
    out: set[int] = set()
    for v in obj.data.vertices:
        best_name = None
        best_w = 0.0
        for ge in v.groups:
            name = group_names.get(ge.group)
            if name in bone_names and ge.weight > best_w:
                best_w = ge.weight
                best_name = name
        if best_name in matched:
            out.add(v.index)
    return out


def _hand_dominant_vertex_indices(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
) -> set[int]:
    """Vertex indices of `obj` whose dominant bone is a hand/finger joint.

    See `_bone_dominant_vertex_indices` — this is the hand-only vocabulary the
    evidence contract attributes exported JOINTS_0/WEIGHTS_0 with.
    """
    return _bone_dominant_vertex_indices(obj, armature, _HAND_BONE_RE)


def trim_garment_hand_region(
    garment: bpy.types.Object | None,
    armature: bpy.types.Object,
    *,
    slot: str = "",
) -> dict:
    """#295 — terminate a garment at the wrist by its own vertex-to-bone attribution.

    The fitted .mhclo shell AND the body-derived cover shell both place garment
    geometry over the hand (measured 2026-08-11: 17,345 hand-dominant verts on the
    lean-female upper shell — the "blue mitten" #295 graded from the pixels). This
    deletes every garment vertex whose dominant bone is a hand/finger joint, so the
    shell stops exactly where the hand bones' influence ends. The coverage gate and
    the body-hide mask below then see the trimmed garment, so a bare hand is neither
    covered by cloth nor discarded by the mask — both sides of the #295 surface.

    MUST run after the garment's vertex groups carry the bind weights
    (`transfer_weights_body_to_garment`). Deleting vertices removes their faces;
    Blender reindexes the remaining vertex groups. Geometry only — rig, shape keys
    and materials are untouched.
    """
    if garment is None:
        return {"slot": slot, "enabled": True, "removedVertices": 0, "note": "no garment"}
    hand_verts = _hand_dominant_vertex_indices(garment, armature)
    if not hand_verts:
        return {
            "slot": slot,
            "enabled": True,
            "removedVertices": 0,
            "note": "no hand-dominant garment vertices",
        }
    import bmesh

    mesh = garment.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    # bmesh verts are created in mesh order, so v.index == mesh vertex index here.
    to_delete = [v for v in bm.verts if v.index in hand_verts]
    removed = len(to_delete)
    if to_delete:
        bmesh.ops.delete(bm, geom=to_delete, context="VERTS")
        bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return {
        "slot": slot,
        "enabled": True,
        "removedVertices": removed,
        "handDominantVertices": len(hand_verts),
        "note": "hand-dominant garment vertices deleted (garment terminates at the wrist)",
    }


def scope_hide_mask_away_from_hands(
    basemesh: bpy.types.Object,
    tri_mask,
    armature: bpy.types.Object,
) -> tuple[np.ndarray, int]:
    """#295 — never discard a bare hand: scope the body-hide mask to the covered region.

    Zero the per-triangle hide mask for body faces whose vertices are dominated by a
    hand/finger joint. The garments now terminate at the wrist
    (`trim_garment_hand_region`), so a hand under the mask is a BARE hand being
    removed by alpha-MASK — the "stump" half of the mitten (deleting the sleeve while
    the body underneath stays discarded). Derived from the body's own vertex-to-bone
    attribution (the shipped CC0 mixamo_unity weights), never authored coordinates.

    `tri_mask` is aligned to the fan-triangulated `_numpy_mesh` body faces, exactly as
    `apply_body_hide_material_region` consumes it (polygon fan order).
    """
    hand_verts = _hand_dominant_vertex_indices(basemesh, armature)
    mask = np.asarray(tri_mask, dtype=bool).copy()
    if not hand_verts or not mask.any():
        return mask, 0
    excluded = 0
    tri_i = 0
    for poly in basemesh.data.polygons:
        n_tri = max(len(poly.vertices) - 2, 1)
        if any(vi in hand_verts for vi in poly.vertices):
            if mask[tri_i : tri_i + n_tri].any():
                excluded += 1
            mask[tri_i : tri_i + n_tri] = False
        tri_i += n_tri
    return mask, excluded


# #326 — the body-hide mask's BOUNDS must stay inside the garment's bounds. The mask
# is built from a signed-clearance test (`body_hide_mask`, < HIDE_EPSILON_M against the
# garment surface), so body faces just OUTSIDE the garment silhouette — below the hem,
# above the collar, past the cuffs — can sit within the epsilon of the rim surface and
# enter the mask even though the cloth does not cover them. Measured on the shipped
# GLBs: aisha 23.7 mm below the hem, lean_female 11.7 mm above the collar, heavy_male
# 14.7 mm; every rail carries it, and the discarded body renders as black slivers at
# shoulders, cuffs, collar and hem (#323's landing grade). A face beyond the silhouette
# is not under cloth at all, so it must not be discarded. The CLIP slack is 1.5 mm —
# below the contract's 2 mm allowance (`mpfb2-lower-garment-and-mask-footprint`
# MAX_OVERREACH_M) so the exported mask AABB clears the gate with float room (measured
# worst 1.96 mm at a 2 mm clip; the extra half-millimetre buys a stable margin and
# removes the same 7-24 mm over-reaches by >4.6x).
HIDE_MASK_FOOTPRINT_SLACK_M = 0.0015


def clip_hide_mask_to_garment_footprint(
    tri_mask: np.ndarray,
    basemesh: bpy.types.Object,
    garment_bounds: dict,
    *,
    slack_m: float = HIDE_MASK_FOOTPRINT_SLACK_M,
) -> tuple[np.ndarray, int]:
    """#326 — never hide body the garment does not cover: clip the mask to the garment footprint.

    Zero every mask triangle that belongs to a body POLYGON with a vertex outside the
    garment's world AABB + slack. The clip is polygon-level, not triangle-level, because
    `apply_body_hide_material_region` hides whole polygons (a quad with any masked fan
    triangle gets the hidden material on ALL its vertices) — a triangle-level clip lets
    a polygon whose fourth vertex pokes past the garment silhouette keep its hidden
    material, and the exported hidden primitive's AABB over-reaches (measured 5.6 mm on
    the first clip pass). The masked body surface then sits inside the garment's
    silhouette, so no discarded body face renders as a black sliver through the cloth
    (issue #326: aisha 23.7 mm below the hem, lean_female 11.7 mm above the collar,
    heavy_male 14.7 mm before this clip).

    `tri_mask` is aligned to the fan-triangulated body faces (the same order
    `apply_body_hide_material_region` consumes — polygon fan order); `basemesh` is the
    body mesh whose polygons carry the fan triangles, in the SAME world frame as
    `garment_bounds` (the stage applies object transforms before the gate; the MPFB2
    materializer triangulates in world space).

    Bounds containment is NECESSARY, not SUFFICIENT — a mask can sit inside the garment's
    bounds and still hide a face the garment does not cover. Per-face containment against
    the garment SURFACE is the honest next instrument if the slivers survive; this closes
    the measured 7-24 mm over-reach class (issue #326).
    """
    mask = np.asarray(tri_mask, dtype=bool).copy()
    if not mask.any():
        return mask, 0
    gmin = np.asarray(garment_bounds["min"], dtype=float)
    gmax = np.asarray(garment_bounds["max"], dtype=float)
    removed = 0
    tri_i = 0
    for poly in basemesh.data.polygons:
        n_tri = max(len(poly.vertices) - 2, 1)
        if not mask[tri_i : tri_i + n_tri].any():
            tri_i += n_tri
            continue
        inside = True
        for vi in poly.vertices:
            v = basemesh.data.vertices[vi].co
            for a in range(3):
                if v[a] < gmin[a] - slack_m or v[a] > gmax[a] + slack_m:
                    inside = False
                    break
            if not inside:
                break
        if not inside:
            mask[tri_i : tri_i + n_tri] = False
            removed += 1
        tri_i += n_tri
    return mask, removed


def clip_hide_mask_below_joint(
    tri_mask,
    basemesh: bpy.types.Object,
    joint_world_z: float,
) -> tuple[np.ndarray, int]:
    """#334 — never discard the head/face: zero the mask for any body polygon with a
    vertex ABOVE the body's own head-joint world height.

    The hide mask is built from a signed-clearance test against the garment surface
    (`body_hide_mask`), so a garment whose collar rides high on a body — the same
    fitted t-shirt lands differently on bodies with different proportions (measured
    2026-08-11: nurse_kevin's collar at 0.920 H against his OWN head joint at
    0.914 H, aisha 0.851 vs 0.909, child 0.546 vs 0.894) — puts the jaw under the
    mask and the alpha-MASK discards it, rendering a black band across the face.
    A mask that hides the head is worse than the poke-through it prevents: the head
    region is not "under cloth". The bound is the body's OWN skeleton (per-body
    anatomy, scales across a 124 cm child and a 176 cm adult), never a stature
    fraction or a fitted constant — the reference cannot be moved by the garment
    change being measured. Polygon-level, exactly like the footprint clip:
    `apply_body_hide_material_region` hides whole polygons, so a triangle-level clip
    lets a polygon whose fourth vertex pokes above the joint keep its hidden material.
    """
    mask = np.asarray(tri_mask, dtype=bool).copy()
    if not mask.any():
        return mask, 0
    removed = 0
    tri_i = 0
    for poly in basemesh.data.polygons:
        n_tri = max(len(poly.vertices) - 2, 1)
        if not mask[tri_i : tri_i + n_tri].any():
            tri_i += n_tri
            continue
        # Same frame convention as the footprint clip (basemesh at identity in the
        # stage/materializer, so local coords ARE world coords).
        if any(basemesh.data.vertices[vi].co.z > joint_world_z for vi in poly.vertices):
            mask[tri_i : tri_i + n_tri] = False
            removed += 1
        tri_i += n_tri
    return mask, removed



def _fit_one_garment(
    *,
    mhclo_path: str,
    garment_obj_path: str,
    garment_mesh_name: str,
    basemesh: bpy.types.Object,
    color: tuple[float, float, float, float],
    ClothesService,
    Mhclo,
) -> tuple[bpy.types.Object, float]:
    """Import + ClothesService.fit_clothes_to_human while basemesh macros are LIVE."""
    garment = import_obj(garment_obj_path, garment_mesh_name, force_z=False)
    garment.data.materials.clear()
    garment.data.materials.append(make_material(f"mat_{garment_mesh_name}", color))
    mhclo = Mhclo()
    mhclo.load(mhclo_path)
    try:
        mhclo.clothes = garment
    except Exception:
        pass
    t_fit = time.perf_counter()
    ClothesService.fit_clothes_to_human(garment, basemesh, mhclo=mhclo, set_parent=True)
    fit_s = time.perf_counter() - t_fit
    bpy.context.view_layer.update()
    return garment, fit_s


# ── issue-320: the upper garment's hem must MEET the lower garment's waistband ────
# The #295-grade ragged band of bare skin at the waist is a GAP BETWEEN TWO GARMENT
# EDGES, not poke-through — no face pokes through anything, and the coverage gate is
# structurally blind to it (§6t: gates that measure proximity/extremes miss defects
# that live in continuity). The hem terminus is DERIVED from the lower garment's own
# waistband rim (D1), never an authored per-body coordinate (`1.55`-style constants
# are the #316 class). Constants mirror the evidence contract
# (`garments-meet-at-the-waist.test.ts`) so the factory and the gate measure the same
# edges at the same resolution.
WAIST_OVERLAP_MARGIN_M = 0.005  # positive overlap target: "several millimetres" (#320)
WAIST_RIM_FRACTION = 0.12  # same rim band the evidence contract measures
WAIST_BUCKETS = 36


def _waistband_rim_per_bucket(obj: bpy.types.Object, *, height_axis: int = 2) -> np.ndarray:
    """Highest vertex per angular bucket in an object's TOP rim band (Z-up stage frame).

    Mirrors the evidence contract's lower-garment edge: the waistband is the highest
    vertex of the lower garment's top rim band at each angle around the vertical axis.
    Returns a per-bucket array in metres; buckets with no rim vertices stay -inf. The
    angle convention matches the exported Y-up GLB the contract reads EXACTLY: the
    export maps stage (x, y, z) to glTF (x, z, -y) (export_yup=True), so the contract's
    atan2(glb_z, glb_x) is atan2(-stage_y, stage_x). Negating stage Y here makes a
    factory bucket the same angular bucket the evidence test measures, so the
    per-bucket guarantee is exact rather than a reflected approximation.
    """
    v = np.array([tuple(vc.co) for vc in obj.data.vertices], dtype=float)
    h = v[:, height_axis]
    hi = float(h.max())
    lo = float(h.min())
    band_lo = hi - (hi - lo) * WAIST_RIM_FRACTION
    sel = h >= band_lo
    angles = np.arctan2(-v[sel, 1], v[sel, 0])
    buckets = (
        np.floor(((angles + np.pi) / (2 * np.pi)) * WAIST_BUCKETS) % WAIST_BUCKETS
    ).astype(np.int64)
    per = np.full(WAIST_BUCKETS, -np.inf)
    np.maximum.at(per, buckets, h[sel])
    return per


def fit_upper_hem_to_waistband(
    garment: bpy.types.Object,
    lower_garment: bpy.types.Object,
    *,
    height_axis: int = 2,
) -> dict:
    """issue-320 — push the upper garment's hem down to the lower waistband.

    Runs AFTER the lower coverage gate so `lower_garment` is the geometry that SHIPS
    (a sparse library fit is replaced by the body-derived cover shell in that gate;
    measuring before it reads a mesh that never reaches the export). The upper
    garment's bottom rim band is pushed down per angular bucket until the bucket's
    lowest vertex clears the lower garment's highest waistband vertex by
    WAIST_OVERLAP_MARGIN_M. The terminus is DERIVED from the lower garment's own
    waistband rim (D1). The push tapers to zero at the top of the rim band so the band
    stays welded to the garment above (no torn seam); a garment that already meets
    (deficit = 0) is untouched — the known-good scrub column is a small improvement to
    ~5 mm of overlap, never a regression.
    """
    waist = _waistband_rim_per_bucket(lower_garment, height_axis=height_axis)
    gv = np.array([tuple(vc.co) for vc in garment.data.vertices], dtype=float)
    h = gv[:, height_axis]
    g_lo, g_hi = float(h.min()), float(h.max())
    band_hi = g_lo + (g_hi - g_lo) * WAIST_RIM_FRACTION
    sel = h <= band_hi
    if not sel.any():
        return {"enabled": True, "pushedVertexCount": 0, "note": "no hem rim band"}
    # Same reflected angle convention as _waistband_rim_per_bucket (and the contract):
    # atan2(-stage_y, stage_x) — see the helper's docstring.
    angles = np.arctan2(-gv[sel, 1], gv[sel, 0])
    buckets = (
        np.floor(((angles + np.pi) / (2 * np.pi)) * WAIST_BUCKETS) % WAIST_BUCKETS
    ).astype(np.int64)
    hem = np.full(WAIST_BUCKETS, np.inf)
    np.minimum.at(hem, buckets, h[sel])
    deficit = np.where(
        np.isfinite(waist) & np.isfinite(hem),
        np.maximum(0.0, hem - (waist - WAIST_OVERLAP_MARGIN_M)),
        0.0,
    )
    max_deficit = float(deficit.max()) if deficit.size else 0.0
    if max_deficit <= 1e-6:
        return {
            "enabled": True,
            "pushedVertexCount": 0,
            "maxDeficitMeters": 0.0,
            "note": "hem already meets waistband at every measured angle",
        }
    span = np.where(np.isfinite(hem), band_hi - hem, 1.0)
    taper = np.clip((band_hi - h[sel]) / np.maximum(span[buckets], 1e-9), 0.0, 1.0)
    push = deficit[buckets] * taper
    idx = np.where(sel)[0]
    moved = 0
    for k, p in enumerate(push):
        if p > 1e-6:
            garment.data.vertices[int(idx[k])].co[height_axis] = float(h[sel][k] - p)
            moved += 1
    return {
        "enabled": True,
        "pushedVertexCount": moved,
        "maxDeficitMeters": round(max_deficit, 5),
        "marginMeters": WAIST_OVERLAP_MARGIN_M,
        "note": "hem pushed down to the lower garment waistband rim (issue-320, derived)",
    }
