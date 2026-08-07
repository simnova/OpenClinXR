#!/usr/bin/env python3
"""#134 hm08 rig-carry stage — evidence path only (no promotion).

Hard freeze (in scope):
  - load MakeHuman hm08 base.obj
  - name the 23 canonical OpenClinXR joints (file-side dotted names)
  - auto-weight
  - export GLB

OUT of scope: morphs, garments, bind-pose correction beyond auto-weight,
promotion to generated-humanoids/, making hm08 the default.

MPFB2 is used only as out-of-repo authoring (path to base.obj); meshes are not
derivative of the addon. GPL-3 licence is deferred, not resolved.

Stop rule is enforced by the TS driver (max two export attempts).
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


CANONICAL_BONE_NAMES = [
    "pelvis",
    "spine",
    "chest",
    "neck",
    "head",
    "eye.L",
    "eye.R",
    "clavicle.L",
    "clavicle.R",
    "upper_arm.L",
    "forearm.L",
    "hand.L",
    "index_finger_base.L",
    "upper_arm.R",
    "forearm.R",
    "hand.R",
    "index_finger_base.R",
    "thigh.L",
    "shin.L",
    "foot.L",
    "thigh.R",
    "shin.R",
    "foot.R",
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mh-base-obj", required=True, help="MPFB data/3dobjs/base.obj (hm08)")
    p.add_argument("--output-glb", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--attempt", type=int, default=1)
    p.add_argument(
        "--weight-mode",
        choices=("auto", "envelope"),
        default="auto",
        help="auto = ARMATURE_AUTO heat; envelope = ENVELOPE (second attempt fallback)",
    )
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_hm08(path: str) -> bpy.types.Object:
    bpy.ops.wm.obj_import(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no mesh imported from {path}")
    mesh = meshes[0]
    mesh.name = "hm08_body"
    mesh.data.name = "hm08_body"
    # MakeHuman assets are in decimetres; scale to metres so stature ~1.7 m.
    mesh.scale = (0.1, 0.1, 0.1)
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Tag basemesh for any MPFB tooling that checks object type (optional).
    mesh["object_type"] = "Basemesh"
    return mesh


def mesh_bounds(obj: bpy.types.Object) -> dict:
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    xs = [c.x for c in coords]
    ys = [c.y for c in coords]
    zs = [c.z for c in coords]
    return {
        "min": (min(xs), min(ys), min(zs)),
        "max": (max(xs), max(ys), max(zs)),
        "center": ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2),
        "size": (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)),
    }


def create_canonical_armature(mesh_obj: bpy.types.Object) -> bpy.types.Object:
    """Bounds-driven 23-bone armature; file-side dotted names (three.js strips dots).

    hm08 after metre scale is Y-up height (same convention as Anny armature).
    """
    b = mesh_bounds(mesh_obj)
    min_x, min_y, min_z = b["min"]
    max_x, max_y, max_z = b["max"]
    center_x, _, center_z = b["center"]
    width, height, depth = b["size"]
    height = max(height, 0.001)
    width = max(width, 0.001)
    depth = max(depth, 0.001)

    def p(x_factor: float, y_factor: float, z_factor: float = 0.0) -> Vector:
        return Vector(
            (
                center_x + width * x_factor,
                min_y + height * y_factor,
                center_z + depth * z_factor,
            )
        )

    arm_data = bpy.data.armatures.new("openclinxr_canonical_humanoid_armature_data")
    arm_obj = bpy.data.objects.new("openclinxr_canonical_humanoid_armature", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = arm_data.edit_bones
    bones: dict = {}

    bones["pelvis"] = edit_bones.new("pelvis")
    bones["pelvis"].head = p(0.0, 0.46)
    bones["pelvis"].tail = p(0.0, 0.52)

    bones["spine"] = edit_bones.new("spine")
    bones["spine"].head = bones["pelvis"].tail
    bones["spine"].tail = p(0.0, 0.64)
    bones["spine"].parent = bones["pelvis"]

    bones["chest"] = edit_bones.new("chest")
    bones["chest"].head = bones["spine"].tail
    bones["chest"].tail = p(0.0, 0.76)
    bones["chest"].parent = bones["spine"]

    bones["neck"] = edit_bones.new("neck")
    bones["neck"].head = bones["chest"].tail
    bones["neck"].tail = p(0.0, 0.82)
    bones["neck"].parent = bones["chest"]

    bones["head"] = edit_bones.new("head")
    bones["head"].head = bones["neck"].tail
    bones["head"].tail = p(0.0, 0.96)
    bones["head"].parent = bones["neck"]

    eye_l = edit_bones.new("eye.L")
    eye_l.head = p(0.022, 0.905, 0.012)
    eye_l.tail = p(0.022, 0.905, 0.020)
    eye_l.parent = bones["head"]
    bones["eye.L"] = eye_l
    eye_r = edit_bones.new("eye.R")
    eye_r.head = p(-0.022, 0.905, 0.012)
    eye_r.tail = p(-0.022, 0.905, 0.020)
    eye_r.parent = bones["head"]
    bones["eye.R"] = eye_r

    clav_l = edit_bones.new("clavicle.L")
    clav_l.head = p(0.08, 0.77, 0.01)
    clav_l.tail = p(0.18, 0.74, 0.0)
    clav_l.parent = bones["chest"]
    bones["clavicle.L"] = clav_l
    clav_r = edit_bones.new("clavicle.R")
    clav_r.head = p(-0.08, 0.77, 0.01)
    clav_r.tail = p(-0.18, 0.74, 0.0)
    clav_r.parent = bones["chest"]
    bones["clavicle.R"] = clav_r

    half_span = max(width * 0.44, height * 0.32)
    shoulder_off = max(width * 0.18, half_span * 0.40)
    elbow_off = max(width * 0.34, half_span * 0.75)
    hand_off = half_span

    def limb_at(x_off: float, y_factor: float, z_factor: float = 0.0) -> Vector:
        return Vector((center_x + x_off, min_y + height * y_factor, center_z + depth * z_factor))

    def make_limb(side: str, shoulder_pos: Vector, elbow_pos: Vector, hand_pos: Vector) -> None:
        shoulder = edit_bones.new(f"upper_arm.{side}")
        shoulder.head = shoulder_pos
        shoulder.tail = elbow_pos
        shoulder.parent = bones[f"clavicle.{side}"]
        elbow = edit_bones.new(f"forearm.{side}")
        elbow.head = elbow_pos
        elbow.tail = hand_pos
        elbow.parent = shoulder
        hand = edit_bones.new(f"hand.{side}")
        hand.head = hand_pos
        hand.tail = Vector(
            (hand_pos.x, hand_pos.y + 0.08 * (1 if side == "L" else -1), hand_pos.z)
        )
        hand.parent = elbow
        idx = edit_bones.new(f"index_finger_base.{side}")
        dx = 0.03 if side == "L" else -0.03
        dy = 0.07 if side == "L" else -0.07
        idx.head = hand_pos
        idx.tail = Vector((hand_pos.x + dx, hand_pos.y + dy, hand_pos.z + 0.005))
        idx.parent = hand
        bones[f"index_finger_base.{side}"] = idx

    make_limb("L", limb_at(shoulder_off, 0.74), limb_at(elbow_off, 0.58), limb_at(hand_off, 0.42))
    make_limb("R", limb_at(-shoulder_off, 0.74), limb_at(-elbow_off, 0.58), limb_at(-hand_off, 0.42))

    def make_leg(side: str, hip: Vector, knee: Vector, foot: Vector) -> None:
        thigh = edit_bones.new(f"thigh.{side}")
        thigh.head = hip
        thigh.tail = knee
        thigh.parent = bones["pelvis"]
        shin = edit_bones.new(f"shin.{side}")
        shin.head = knee
        shin.tail = foot
        shin.parent = thigh
        foot_b = edit_bones.new(f"foot.{side}")
        foot_b.head = foot
        foot_b.tail = Vector((foot.x, foot.y, foot.z + depth * 0.10))
        foot_b.parent = shin

    make_leg("L", p(0.10, 0.47), p(0.12, 0.25), p(0.12, 0.02, 0.04))
    make_leg("R", p(-0.10, 0.47), p(-0.12, 0.25), p(-0.12, 0.02, 0.04))

    bpy.ops.object.mode_set(mode="OBJECT")
    arm_obj.matrix_world = Matrix.Identity(4)
    return arm_obj


def bind_auto_weight(mesh_obj: bpy.types.Object, arm_obj: bpy.types.Object, mode: str) -> dict:
    """Attempt Blender auto-weight. Returns status dict."""
    status = {"mode": mode, "ok": False, "error": None, "groupCount": 0, "weightedGroups": 0}
    try:
        bpy.ops.object.select_all(action="DESELECT")
        mesh_obj.select_set(True)
        arm_obj.select_set(True)
        bpy.context.view_layer.objects.active = arm_obj
        if mode == "auto":
            bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        else:
            bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
            # Convert envelope to weights for export if possible
            bpy.context.view_layer.objects.active = mesh_obj
            bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
            try:
                bpy.ops.object.vertex_group_normalize_all(lock_active=False)
            except Exception:
                pass
            bpy.ops.object.mode_set(mode="OBJECT")

        # Ensure armature modifier points at arm
        for mod in mesh_obj.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm_obj
        groups = list(mesh_obj.vertex_groups)
        status["groupCount"] = len(groups)
        weighted = 0
        for g in groups:
            # sample: any vertex with weight > 0
            for v in mesh_obj.data.vertices:
                for ge in v.groups:
                    if ge.group == g.index and ge.weight > 1e-6:
                        weighted += 1
                        break
                else:
                    continue
                break
        status["weightedGroups"] = weighted
        status["ok"] = status["groupCount"] >= 20 and status["weightedGroups"] >= 10
        status["boneNames"] = [b.name for b in arm_obj.data.bones]
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-1500:]
    return status


def export_glb(path: str) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Y-height content; keep export_yup=False so height stays on Y (#67 working pattern).
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_yup=False,
        export_apply=True,
        export_animations=False,
        export_skins=True,
        export_morph=False,
    )


def main() -> int:
    args = parse_args()
    report: dict = {
        "attempt": args.attempt,
        "weightMode": args.weight_mode,
        "ok": False,
        "error": None,
        "mhBaseObj": args.mh_base_obj,
        "outputGlb": args.output_glb,
        "boneNames": [],
        "bind": None,
        "mesh": None,
    }
    try:
        clear_scene()
        if not Path(args.mh_base_obj).is_file():
            raise FileNotFoundError(args.mh_base_obj)
        mesh = import_hm08(args.mh_base_obj)
        bounds = mesh_bounds(mesh)
        report["mesh"] = {
            "verts": len(mesh.data.vertices),
            "faces": len(mesh.data.polygons),
            "tris": sum(len(p.vertices) - 2 for p in mesh.data.polygons),
            "heightY": bounds["size"][1],
            "bounds": {
                "min": list(bounds["min"]),
                "max": list(bounds["max"]),
                "size": list(bounds["size"]),
            },
        }
        arm = create_canonical_armature(mesh)
        report["boneNames"] = [b.name for b in arm.data.bones]
        missing = [n for n in CANONICAL_BONE_NAMES if n not in report["boneNames"]]
        if missing:
            raise RuntimeError(f"armature missing bones: {missing}")
        bind = bind_auto_weight(mesh, arm, args.weight_mode)
        report["bind"] = bind
        if not bind.get("ok"):
            raise RuntimeError(
                f"auto-weight failed mode={args.weight_mode}: {bind.get('error') or bind}"
            )
        export_glb(args.output_glb)
        report["ok"] = True
        report["outputExists"] = Path(args.output_glb).is_file()
        report["outputBytes"] = Path(args.output_glb).stat().st_size if report["outputExists"] else 0
    except Exception as exc:  # noqa: BLE001
        report["ok"] = False
        report["error"] = f"{type(exc).__name__}: {exc}"
        report["traceback"] = traceback.format_exc()[-2000:]

    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": report["ok"], "attempt": args.attempt, "error": report.get("error")}))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
