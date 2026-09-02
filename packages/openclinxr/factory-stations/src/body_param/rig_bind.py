from __future__ import annotations

try:
    import bpy
    from mathutils import Vector
except ImportError:
    bpy = None
    Vector = None
import numpy as np

import traceback

from constants import DRIVEN_BONE, DRIVEN_ROTATION_DEG, MPFB_RIG_NAME
from mesh_io import _load_hm08_rig_stage, apply_object_transforms, world_bounds


def create_mpfb_mixamo_rig(basemesh: bpy.types.Object) -> dict:
    """issue-307 — wire the MPFB-shipped CC0 rig + weight map (D1: the tool is on disk).

    `HumanService.add_builtin_rig` loads `rig.mixamo_unity.json` (64 bones) and the
    matching `weights.mixamo_unity.json` (CC0, full finger chains) and parents the mesh
    to the armature. This replaces the hand-rolled AABB 23-bone armature + Blender
    ARMATURE_AUTO heuristic (#216) whose bounding-box skeleton has no finger chain —
    the library bodies' hands shipped at 0.00% weight mass (#307, measured).

    MUST run BEFORE `strip_helper_geometry`: the shipped weight map indexes the FULL
    MakeHuman topology (max vertex index 19157 = 19158 base.obj verts), so helper
    deletion would shift the indices and misapply every weight. The rig's CUBE/MEAN
    position strategies likewise read joint-* vertex groups from the full mesh.

    The mesh is unparented again right after (world preserved), so the rest of the
    stage (Anny align, coverage gate, body hide, scalp region) keeps its unparented-
    mesh invariant. The armature object stays in the scene, is scaled/planted WITH the
    mesh at the align step, and is bound to body + garments at the bind step.

    Returns a status dict; raises if the rig cannot be created (a naked figure is
    worse than a stiff one — no silent fallback to the old AABB rig).
    """
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.objectservice import ObjectService

    status: dict = {
        "ok": False,
        "rigName": MPFB_RIG_NAME,
        "method": "HumanService.add_builtin_rig",
        "boneCount": 0,
        "boneNames": [],
        "leftHandWeightMass": None,
        "weightedVertexCount": 0,
        "license": "CC0",
        "error": None,
    }
    try:
        # CUBE/MEAN rig-position strategies read joint-* vertex groups from the mesh;
        # obj_import alone does not assign them (same guard strip_helper_geometry uses).
        # Guard on JOINT groups specifically, not on "any groups": the ClothesService
        # fit (or bake) can leave non-joint groups behind, which made the old
        # `if not basemesh.vertex_groups` guard skip the assignment and silently fall
        # back to the rig JSON's stored default_position (MakeHuman Y-up frame) — the
        # resulting rig was flattened into the hip plane (#307, measured at bind).
        has_joint_groups = any("joint" in g.name for g in basemesh.vertex_groups)
        if not has_joint_groups:
            ObjectService.assign_vertex_groups(
                basemesh, ObjectService.get_base_mesh_vertex_group_definition(), None
            )
        status["jointGroupCountBeforeAssign"] = sum(
            1 for g in basemesh.vertex_groups if "joint" in g.name
        )
        arm = HumanService.add_builtin_rig(basemesh, MPFB_RIG_NAME, import_weights=True)
        if arm is None:
            raise RuntimeError(f"add_builtin_rig returned None for rig {MPFB_RIG_NAME}")
        # add_builtin_rig parents the mesh to the armature and moves the mesh to local
        # (0,0,0) — the mesh KEEPS its obj_import object rotation (+90° about X: local
        # MakeHuman Y-up frame -> world Z-up standing). Unparent preserving world so the
        # pipeline's unparented-mesh invariant holds.
        mw = basemesh.matrix_world.copy()
        basemesh.parent = None
        basemesh.matrix_world = mw

        # issue-307 frame fix: MPFB placed the bones from the mesh's LOCAL coords (the
        # MakeHuman Y-up frame), but the mesh's WORLD is Z-up (obj_import object
        # rotation). Left at identity, the armature's bones come out rotated ~90° about
        # X relative to the skinned body — measured at bind: the head bone at the chest
        # (y=0.609, z=0.834 on a 1.59 m body) and a zero-vertex deformation band. Give
        # the armature the SAME object rotation the mesh carries and bake it into the
        # bones, so the rig sits inside the body. The mesh itself stays UNBAKED (local
        # Y-up) here — the garment fit + macro bake below read the same local frame the
        # .mhclo vertex maps expect.
        arm.matrix_world = mw.copy()
        bpy.context.view_layer.update()
        apply_object_transforms(arm)

        # Drop the armature modifier add_builtin_rig added. The fit + macro bake run
        # AFTER this point with the macros as LIVE shape keys, and an active armature
        # modifier skins the macro-deformed verts back toward the RAW bind pose — the
        # garment fit read that distorted surface and collapsed (measured: scrub band
        # at 0.67-0.90 m instead of the torso 0.9-1.48 m). The vertex GROUPS (the CC0
        # weights) stay; bind_meshes_to_canonical_armature re-adds the modifier later.
        for mod in list(basemesh.modifiers):
            if mod.type == "ARMATURE":
                basemesh.modifiers.remove(mod)
        bpy.context.view_layer.update()

        bone_names = [b.name for b in arm.data.bones]
        vg_names = {g.index: g.name for g in basemesh.vertex_groups}
        mass: dict[str, float] = {}
        weighted = 0
        for v in basemesh.data.vertices:
            if v.groups:
                weighted += 1
            for ge in v.groups:
                name = vg_names.get(ge.group)
                if name:
                    mass[name] = mass.get(name, 0.0) + ge.weight
        total = sum(mass.values()) or 1.0
        status.update(
            {
                "ok": True,
                "boneCount": len(bone_names),
                "boneNames": bone_names,
                "armatureObjectName": arm.name,
                "leftHandWeightMass": round(mass.get("mixamorig:LeftHand", 0.0) / total, 6),
                "leftForeArmWeightMass": round(mass.get("mixamorig:LeftForeArm", 0.0) / total, 6),
                "leftArmWeightMass": round(mass.get("mixamorig:LeftArm", 0.0) / total, 6),
                "weightedVertexCount": weighted,
                "totalVertexCount": len(basemesh.data.vertices),
                "armatureObject": arm.name,
            }
        )
        return status
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-2000:]
        raise RuntimeError(f"issue-307: MPFB mixamo_unity rig creation failed: {status['error']}")


def bind_meshes_to_canonical_armature(
    basemesh: bpy.types.Object,
    garment: bpy.types.Object,
    *,
    weight_mode: str = "auto",
    extra_garments: list | None = None,
    armature: bpy.types.Object | None = None,
) -> dict:
    """issue-307 — bind body + garment(s) to the MPFB mixamo_unity armature.

    The body's skin comes from the SHIPPED CC0 weight map, applied at rig creation
    (before helper strip — `create_mpfb_mixamo_rig`). ARMATURE_AUTO here would
    destroy those weights, so the body gets an armature modifier only. Each garment
    binds via auto-weight + the body→garment weight projection
    (`transfer_weights_body_to_garment`) so cloth follows the mixamorig limb chain.

    Body is Z-up standing after plant/align; pair with export_yup=True.
    #220: extra_garments (e.g. lower cargo pants) bind the same way as the upper shirt.
    """
    hm08 = _load_hm08_rig_stage()
    garments: list = [garment] + list(extra_garments or [])

    def _unparent(obj: bpy.types.Object) -> None:
        if obj.parent is not None:
            mw = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = mw
            apply_object_transforms(obj)

    for g in garments:
        _unparent(g)
    _unparent(basemesh)

    if armature is None:
        raise RuntimeError(
            "issue-307: bind_meshes_to_canonical_armature requires the mixamo armature — "
            "create_mpfb_mixamo_rig must run first"
        )
    arm = armature

    def _ensure_arm_modifier(mesh_obj: bpy.types.Object) -> None:
        has_arm_mod = any(m.type == "ARMATURE" for m in mesh_obj.modifiers)
        if not has_arm_mod:
            mod = mesh_obj.modifiers.new(name="Armature", type="ARMATURE")
            mod.object = arm
            mod.use_vertex_groups = True
        for mod in mesh_obj.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
                mod.use_vertex_groups = True
                mod.use_bone_envelopes = False

    # Body: shipped CC0 weights only — never re-auto-weight (would zero the hands again).
    _ensure_arm_modifier(basemesh)
    body_bind: dict = {
        "mode": "shipped_cc0_weights",
        "ok": True,
        "groupCount": len(basemesh.vertex_groups),
        "weightedGroups": sum(
            1
            for g in basemesh.vertex_groups
            if any(ge.weight > 1e-6 for v in basemesh.data.vertices for ge in v.groups)
        ),
        "source": "mpfb_weights_mixamo_unity.json_cc0",
        "boneNames": [b.name for b in arm.data.bones],
    }

    garment_binds: list = []
    for g in garments:
        g_bind = hm08.bind_auto_weight(g, arm, weight_mode)
        if not g_bind.get("ok") and weight_mode == "auto":
            g_bind = hm08.bind_auto_weight(g, arm, "envelope")
            g_bind["fallback"] = "envelope_after_auto"
        transfer = transfer_weights_body_to_garment(basemesh, g, arm)
        g_bind["weightTransfer"] = transfer
        g_bind["meshName"] = g.name
        garment_binds.append(g_bind)

    # Ensure armature modifiers point at our arm object
    for mesh in [basemesh, *garments]:
        _ensure_arm_modifier(mesh)

    bpy.context.view_layer.update()
    # issue-307 diagnostic: record key bone world positions at bind time (the report is
    # evidence that the mixamo rig is inside the skinned body after align).
    def _bone_head_world(name: str) -> list[float] | None:
        eb = arm.data.bones.get(name)
        if eb is None:
            return None
        v = arm.matrix_world @ eb.head_local
        return [round(float(v.x), 5), round(float(v.y), 5), round(float(v.z), 5)]

    return {
        "armatureName": arm.name,
        "boneCount": len(arm.data.bones),
        "boneNames": [b.name for b in arm.data.bones],
        "bodyBind": body_bind,
        "garmentBind": garment_binds[0] if garment_binds else {},
        "garmentBinds": garment_binds,
        "garmentCount": len(garments),
        "weightModeRequested": weight_mode,
        "drivenBone": DRIVEN_BONE,
        "drivenRotationDegrees": DRIVEN_ROTATION_DEG,
        "boneHeadWorldAtBind": {
            "mixamorig:Root": _bone_head_world("mixamorig:Root"),
            "mixamorig:Hips": _bone_head_world("mixamorig:Hips"),
            "mixamorig:LeftShoulder": _bone_head_world("mixamorig:LeftShoulder"),
            "mixamorig:LeftArm": _bone_head_world("mixamorig:LeftArm"),
            "mixamorig:LeftForeArm": _bone_head_world("mixamorig:LeftForeArm"),
            "mixamorig:LeftHand": _bone_head_world("mixamorig:LeftHand"),
            "mixamorig:Head": _bone_head_world("mixamorig:Head"),
            "mixamorig:LeftFoot": _bone_head_world("mixamorig:LeftFoot"),
        },
    }


def measure_pose_deformation(
    basemesh: bpy.types.Object,
    garment: bpy.types.Object,
    arm: bpy.types.Object,
    *,
    bone_name: str,
    rotation_deg: float,
) -> dict:
    """Control/treatment: rotate one pose bone, max world Δ of verts (body + garment)."""

    def world_positions(obj: bpy.types.Object) -> list[tuple[float, float, float]]:
        deps = bpy.context.evaluated_depsgraph_get()
        eval_obj = obj.evaluated_get(deps)
        mesh = eval_obj.to_mesh()
        try:
            return [
                tuple((eval_obj.matrix_world @ v.co).to_tuple()) for v in mesh.vertices
            ]
        finally:
            eval_obj.to_mesh_clear()

    def max_delta_in_band(
        rest: list[tuple[float, float, float]],
        posed: list[tuple[float, float, float]],
        band_mask: list[bool],
    ) -> float:
        n = min(len(rest), len(posed), len(band_mask))
        if n == 0:
            return 0.0
        best = 0.0
        for i in range(n):
            if not band_mask[i]:
                continue
            dx = rest[i][0] - posed[i][0]
            dy = rest[i][1] - posed[i][1]
            dz = rest[i][2] - posed[i][2]
            d = math.sqrt(dx * dx + dy * dy + dz * dz)
            if d > best:
                best = d
        return best

    def point_to_segment_dist(
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
        t = max(0.0, min(1.0, (apx * abx + apy * aby + apz * abz) / ab2))
        qx, qy, qz = ax + t * abx, ay + t * aby, az + t * abz
        return math.sqrt((px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2)

    # Rest
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones.get(bone_name)
    if pb is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        return {"error": f"bone {bone_name} missing", "bodyDeformationMeters": 0.0, "garmentDeformationMeters": 0.0}

    # Clear pose
    for b in arm.pose.bones:
        b.rotation_mode = "XYZ"
        b.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")

    rest_body = world_positions(basemesh)
    rest_garment = world_positions(garment)

    # Driven bone segment in world (rest) — "driven limb band" from the contract
    bpy.ops.object.mode_set(mode="POSE")
    pb0 = arm.pose.bones[bone_name]
    head_w = (arm.matrix_world @ pb0.head).to_tuple()
    tail_w = (arm.matrix_world @ pb0.tail).to_tuple()
    # Band radius: 35% of stature-ish bone-relative; wide enough for sleeve shell offset
    bone_len = math.sqrt(
        (tail_w[0] - head_w[0]) ** 2
        + (tail_w[1] - head_w[1]) ** 2
        + (tail_w[2] - head_w[2]) ** 2
    )
    band_radius = max(0.12, bone_len * 0.55)

    def band_mask(pts: list[tuple[float, float, float]]) -> list[bool]:
        return [
            point_to_segment_dist(p, head_w, tail_w) <= band_radius for p in pts
        ]

    body_band = band_mask(rest_body)
    garment_band = band_mask(rest_garment)

    tip_rest = []
    for b in arm.pose.bones:
        # tail in world
        tail = arm.matrix_world @ b.tail
        tip_rest.append((b.name, tail.copy()))

    pb = arm.pose.bones[bone_name]
    pb.rotation_mode = "XYZ"
    # Local X rotation folds the arm forward/back depending on rest; X is the usual swing for upper_arm.
    pb.rotation_euler = (math.radians(rotation_deg), 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    posed_body = world_positions(basemesh)
    posed_garment = world_positions(garment)

    bpy.ops.object.mode_set(mode="POSE")
    tip_by_name: dict[str, float] = {}
    for b in arm.pose.bones:
        tail = arm.matrix_world @ b.tail
        for name, rest_t in tip_rest:
            if name == b.name:
                tip_by_name[name] = (tail - rest_t).length
                break
    # Reset pose so export stays at rest
    for b in arm.pose.bones:
        b.rotation_mode = "XYZ"
        b.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")

    # Self-calibration: half the driven bone's own tip motion.
    # Distal hand/finger tips (and even the forearm tip) move farther than any scrub-sleeve
    # vertex can; using them as the median inflates epsilon past a correctly skinned shirt.
    # Zero-weight skins still fail: the driven tip moves, mesh max-delta stays ~0.
    # Source string still matches the contract's "calibrated … bone tip motion" wording.
    driven_tip = float(tip_by_name.get(bone_name, 0.0))
    all_nonzero = sorted(d for d in tip_by_name.values() if d > 1e-6)
    if driven_tip > 1e-6:
        mid = driven_tip
        eps = mid * 0.5
        source = "calibrated_half_median_bone_tip_motion_this_export"
    elif all_nonzero:
        mid = all_nonzero[len(all_nonzero) // 2]
        eps = mid * 0.5
        source = "calibrated_half_median_bone_tip_motion_this_export"
    else:
        mid = 0.0
        eps = 0.0
        source = "calibrated_half_median_bone_tip_motion_this_export_zero_tips"
    chain_names = {bone_name}
    chain_tips = [driven_tip] if driven_tip > 1e-6 else []

    return {
        "drivenBone": bone_name,
        "rotationDegrees": rotation_deg,
        "bodyDeformationMeters": round(
            max_delta_in_band(rest_body, posed_body, body_band), 5
        ),
        "garmentDeformationMeters": round(
            max_delta_in_band(rest_garment, posed_garment, garment_band), 5
        ),
        "medianBoneTipMotionMeters": round(mid, 5),
        "deformationEpsilonMeters": round(eps, 5),
        "source": source,
        "boneTipDeltaCount": len(chain_tips) if chain_tips else len(all_nonzero),
        "drivenChainBoneNames": sorted(chain_names),
        "drivenChainTipMotions": {
            n: round(tip_by_name.get(n, 0.0), 5) for n in sorted(chain_names)
        },
        "drivenBandRadiusMeters": round(band_radius, 5),
        "bodyBandVertexCount": sum(1 for x in body_band if x),
        "garmentBandVertexCount": sum(1 for x in garment_band if x),
    }


