#!/usr/bin/env python3
"""#219 — embed #188 footwear shells into body-param library GLBs.

Reuses the parametric foot-AABB shoe primitive from automate_blender.embed_role_footwear_shells
(directive D1: do not hand-author a second AABB shoe). Library export never called that path
(pre-fix ambientFailureClass: library_barefoot_because_body_param_export_never_called_…).

glTF import into Blender is Z-up; #188's original measured Y-up Anny body. This script detects
the dominant vertical axis of the body AABB and maps the #188 builder accordingly without
duplicating the shell topology.

Usage:
  blender --background --python embed_library_footwear.py -- \\
    --glb apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb \\
    --role family \\
    --out apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb

claimScope: procedural footwear on library body-param GLBs, weighted to foot.L/R.
notEvidenceFor: lower-body garment channel, clinical costume realism, production readiness.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import bpy
from mathutils import Matrix, Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="#219 embed #188 footwear into library GLB")
    p.add_argument("--glb", required=True, help="Input library GLB path")
    p.add_argument("--out", required=True, help="Output GLB path (may overwrite input)")
    p.add_argument(
        "--role",
        default="family",
        help="Actor role for footwear kind/color (family→casual_shoe, nurse→clinical, …)",
    )
    p.add_argument("--report", default="", help="Optional JSON report path")
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images):
        for b in list(block):
            block.remove(b)


def import_glb(path: str) -> None:
    bpy.ops.import_scene.gltf(filepath=path)


def find_body_and_armature() -> Tuple[bpy.types.Object, Optional[bpy.types.Object]]:
    body = None
    arm = None
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            arm = obj
        if obj.type == "MESH":
            name = (obj.name or "").lower()
            if "footwear" in name or "shoe" in name or "slipper" in name:
                continue
            if "garment" in name or "scrub" in name or "makeclothes" in name:
                continue
            # Prefer basemesh / hm08 body
            if body is None or "basemesh" in name or "hm08" in name or "body" in name:
                if body is None or "basemesh" in name or "hm08" in name:
                    body = obj
    if body is None:
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        if not meshes:
            raise RuntimeError("no mesh in imported GLB")
        body = max(meshes, key=lambda m: len(m.data.vertices))
    return body, arm


def create_material(name: str, color: Tuple[float, float, float, float]) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.55
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    # Workbench viewport colour (grade safety)
    mat.diffuse_color = color
    return mat


def world_verts(obj: bpy.types.Object) -> List[Vector]:
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def detect_vertical_axis(pts: List[Vector]) -> str:
    """Return 'Y' or 'Z' for the axis with the largest extent (body height)."""
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    ex = max(xs) - min(xs)
    ey = max(ys) - min(ys)
    ez = max(zs) - min(zs)
    if ez >= ey and ez >= ex:
        return "Z"
    if ey >= ez and ey >= ex:
        return "Y"
    return "Z"


def footwear_kind_and_color(actor_role: str) -> Tuple[str, Tuple[float, float, float, float]]:
    role = (actor_role or "").lower()
    if "nurse" in role or "clinical" in role:
        return "clinical_shoe", (0.08, 0.09, 0.10, 1.0)
    if "patient" in role and "family" not in role and "spouse" not in role:
        return "hospital_slipper", (0.18, 0.42, 0.78, 1.0)
    if any(k in role for k in ("parent", "family", "guardian", "spouse")):
        return "casual_shoe", (0.12, 0.08, 0.05, 1.0)
    return "casual_shoe", (0.10, 0.09, 0.08, 1.0)


def embed_footwear_z_up(
    mesh_obj: bpy.types.Object,
    actor_role: str,
    arm_obj: Optional[bpy.types.Object],
) -> Dict[str, Any]:
    """#188 parametric shoe adapted for Z-up library glTF imports.

    Same ring topology / foot-AABB derivation as automate_blender.embed_role_footwear_shells;
    vertical axis is Z (post-import Blender), forward is −Y (typical glTF), lateral X.
    """
    kind, shoe_color = footwear_kind_and_color(actor_role)
    wpts = world_verts(mesh_obj)
    if len(wpts) < 32:
        raise RuntimeError("#219 footwear: body mesh has too few verts")

    inv = mesh_obj.matrix_world.inverted()
    # Work in mesh local space for shell construction; body already planted.
    local = [inv @ p for p in wpts]
    zs = [p.z for p in local]
    body_min_z = min(zs)
    body_max_z = max(zs)
    body_height = max(body_max_z - body_min_z, 0.001)
    foot_cut = body_min_z + body_height * 0.08

    left_pts: List[Vector] = []
    right_pts: List[Vector] = []
    for p in local:
        if p.z > foot_cut:
            continue
        # glTF Y-up → Blender Z-up: lateral is still X; left is +X on hm08 (matches #188).
        if p.x >= 0.0:
            left_pts.append(p.copy())
        else:
            right_pts.append(p.copy())
    if len(left_pts) < 8 or len(right_pts) < 8:
        raise RuntimeError(
            f"#219 footwear: insufficient foot verts L={len(left_pts)} R={len(right_pts)}"
        )

    shells: List[Dict[str, Any]] = []

    def _aabb(pts: List[Vector]) -> Dict[str, float]:
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        zs_ = [p.z for p in pts]
        return {
            "min_x": min(xs),
            "max_x": max(xs),
            "min_y": min(ys),
            "max_y": max(ys),
            "min_z": min(zs_),
            "max_z": max(zs_),
            "cx": (min(xs) + max(xs)) * 0.5,
            "cy": (min(ys) + max(ys)) * 0.5,
            "cz": (min(zs_) + max(zs_)) * 0.5,
            "sx": max(max(xs) - min(xs), 0.02),
            "sy": max(max(ys) - min(ys), 0.04),
            "sz": max(max(zs_) - min(zs_), 0.02),
        }

    def _build_one(side: str, pts: List[Vector]) -> Dict[str, Any]:
        aabb = _aabb(pts)
        pad_x = aabb["sx"] * 0.18 + 0.006
        pad_y = aabb["sy"] * 0.12 + 0.008  # forward extent
        sole_drop = 0.004
        if kind == "hospital_slipper":
            top_extra = aabb["sz"] * 0.18 + 0.008
        else:
            top_extra = aabb["sz"] * 0.35 + 0.012
        hx = aabb["sx"] * 0.5 + pad_x
        hy = aabb["sy"] * 0.5 + pad_y
        z0 = body_min_z - sole_drop
        z1 = aabb["max_z"] + top_extra
        z1 = min(z1, body_min_z + body_height * 0.12)
        if z1 <= z0 + 0.02:
            z1 = z0 + max(aabb["sz"] + 0.02, 0.04)
        cx, cy = aabb["cx"], aabb["cy"]

        # Parametric shoe: 5 long rings (heel→toe along +Y or −Y) × 8 circumference.
        # Foot tip at larger |Y| from ankle; use AABB min→max Y as long axis.
        n_long = 5
        n_circ = 8
        verts = []
        for i in range(n_long):
            t = i / float(n_long - 1)
            width_scale = 0.78 + 0.28 * math.sin(t * math.pi)
            height_scale = 0.55 + 0.45 * (1.0 - abs(t - 0.35))
            if kind == "hospital_slipper":
                height_scale *= 0.72
            y = (aabb["min_y"] - pad_y * 0.5) + t * (aabb["sy"] + pad_y)
            for j in range(n_circ):
                ang = (j / n_circ) * 2.0 * math.pi
                rx = hx * width_scale
                rz = (z1 - z0) * 0.5 * height_scale
                cz_ring = z0 + (z1 - z0) * 0.45
                x = cx + rx * math.cos(ang)
                z = cz_ring + rz * math.sin(ang)
                if z < z0 + 0.006:
                    z = z0 + 0.002 + 0.004 * max(0.0, math.sin(ang))
                verts.append((x, y, z))
        faces = []
        for i in range(n_long - 1):
            for j in range(n_circ):
                a = i * n_circ + j
                b = i * n_circ + ((j + 1) % n_circ)
                c = (i + 1) * n_circ + ((j + 1) % n_circ)
                d = (i + 1) * n_circ + j
                faces.append((a, b, c, d))
        heel_c = len(verts)
        verts.append((cx, aabb["min_y"] - pad_y * 0.55, z0 + (z1 - z0) * 0.35))
        toe_c = len(verts)
        verts.append((cx, aabb["max_y"] + pad_y * 0.55, z0 + (z1 - z0) * 0.30))
        for j in range(n_circ):
            a = j
            b = (j + 1) % n_circ
            faces.append((heel_c, b, a))
            a2 = (n_long - 1) * n_circ + j
            b2 = (n_long - 1) * n_circ + ((j + 1) % n_circ)
            faces.append((toe_c, a2, b2))

        mesh_name = f"openclinxr_footwear_{kind}_{side}_mesh"
        obj_name = f"openclinxr_footwear_{kind}_{side}"
        for old in list(bpy.data.objects):
            if old.name.startswith(obj_name):
                bpy.data.objects.remove(old, do_unlink=True)
        mesh = bpy.data.meshes.new(mesh_name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        shoe = bpy.data.objects.new(obj_name, mesh)
        bpy.context.collection.objects.link(shoe)
        mat = create_material(f"openclinxr_footwear_{kind}_{side}_mat", shoe_color)
        shoe.data.materials.append(mat)
        for poly in shoe.data.polygons:
            poly.use_smooth = True

        bone_name = f"foot.{side}"
        weighted_bones: List[str] = []
        if arm_obj is not None:
            arm_mod = shoe.modifiers.new("openclinxr_footwear_armature", "ARMATURE")
            arm_mod.object = arm_obj
            arm_mod.use_vertex_groups = True
            bone_names = [b.name for b in arm_obj.data.bones]
            if bone_name in bone_names:
                vg = shoe.vertex_groups.new(name=bone_name)
                vg.add(list(range(len(shoe.data.vertices))), 1.0, "REPLACE")
                weighted_bones = [bone_name]
            else:
                # Also try undotted
                alt = f"foot{side}"
                if alt in bone_names:
                    vg = shoe.vertex_groups.new(name=alt)
                    vg.add(list(range(len(shoe.data.vertices))), 1.0, "REPLACE")
                    weighted_bones = [alt]
                else:
                    raise RuntimeError(f"#219 footwear: armature missing bone {bone_name}")
        shoe.parent = mesh_obj
        shoe.matrix_parent_inverse = Matrix.Identity(4)
        shoe.location = (0.0, 0.0, 0.0)
        shoe.rotation_euler = (0.0, 0.0, 0.0)
        shoe.scale = (1.0, 1.0, 1.0)
        shoe["openClinXrFootwear"] = kind
        shoe["openClinXrFootwearSide"] = side
        shoe["openClinXrFootwearRevision"] = "issue_219_library_z_up_reuse_188_topology"
        face_count = len(faces)
        zs_shoe = [v.co.z for v in shoe.data.vertices]
        meta = {
            "side": side,
            "kind": kind,
            "objectName": shoe.name,
            "meshName": mesh_name,
            "faceCount": face_count,
            "vertexCount": len(shoe.data.vertices),
            "weightedBones": weighted_bones,
            "minZ": round(min(zs_shoe), 6),
            "maxZ": round(max(zs_shoe), 6),
            "footVertCount": len(pts),
        }
        print(
            f"[blender] #219 library footwear {side} kind={kind} faces={face_count} "
            f"z=[{meta['minZ']},{meta['maxZ']}] bone={bone_name}"
        )
        return meta

    shells.append(_build_one("L", left_pts))
    shells.append(_build_one("R", right_pts))
    total_faces = sum(s["faceCount"] for s in shells)
    return {
        "mode": "parametric_foot_aabb_shell_v1_library_z_up",
        "revision": "issue_219_library_footwear_reuses_188_topology",
        "kind": kind,
        "shells": shells,
        "totalFaceCount": total_faces,
        "bodyHeight": round(body_height, 6),
        "bodyMinZ": round(body_min_z, 6),
        "bodyMaxZ": round(body_max_z, 6),
        "role": (actor_role or "").lower(),
        "claimScope": "procedural_footwear_on_library_body_param_glb",
        "notEvidenceFor": [
            "lower_body_garment_channel",
            "clinical_costume_realism",
            "production_asset_readiness",
        ],
    }


def export_glb(path: str) -> None:
    # Select armature + all meshes
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type in ("MESH", "ARMATURE"):
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_skins=True,
        export_animations=False,
        # #226: preserve #221 face morph targets when re-exporting after footwear embed.
        # export_morph=False was erasing 32 morph targets on every footwear pass.
        export_morph=True,
    )


def main() -> None:
    args = parse_args()
    glb = Path(args.glb).resolve()
    out = Path(args.out).resolve()
    if not glb.is_file():
        raise SystemExit(f"missing glb: {glb}")

    clear_scene()
    import_glb(str(glb))
    body, arm = find_body_and_armature()
    print(f"[blender] #219 body={body.name} arm={arm.name if arm else None} role={args.role}")

    # Strip any prior footwear shells so re-bake is idempotent.
    for obj in list(bpy.data.objects):
        n = (obj.name or "").lower()
        if obj.type == "MESH" and ("footwear" in n or "shoe" in n or "slipper" in n):
            bpy.data.objects.remove(obj, do_unlink=True)

    meta = embed_footwear_z_up(body, actor_role=args.role, arm_obj=arm)
    out.parent.mkdir(parents=True, exist_ok=True)
    export_glb(str(out))
    print(f"[blender] #219 wrote {out} totalFaces={meta['totalFaceCount']}")

    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps({
            "schemaVersion": "openclinxr.library-footwear-embed.v1",
            "input": str(glb),
            "output": str(out),
            "role": args.role,
            "footwearRegion": meta,
        }, indent=2) + "\n")
        print(f"[blender] #219 report {report_path}")


if __name__ == "__main__":
    main()
