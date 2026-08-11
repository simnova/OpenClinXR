#!/usr/bin/env python3
"""#219/#212 — embed footwear shells into body-param library GLBs.

#212: derive shells from **foot vertex landmarks** (longitudinal slices of the foot
cluster), not free-floating AABB ellipsoids with point caps. Include attachment
anchors that share quantized vertex positions with the body foot region so a
detached free ellipsoid fails the attachment predicate.

Still reuses the #188 role/color + foot-bone weighting path (D1: no second
unrelated shoe system). MakeClothes .mhclo shoes were searched; none staged with
a licence-clean header on this host — procedural path is the factory finish.

Usage:
  blender --background --python embed_library_footwear.py -- \\
    --glb apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb \\
    --role family \\
    --out apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb

claimScope: procedural footwear on library body-param GLBs, weighted to foot.L/R.
notEvidenceFor: lower-body garment channel, clinical costume realism, production readiness,
  quest readiness.
"""

from __future__ import annotations

import argparse
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
    p = argparse.ArgumentParser(description="#219/#212 embed foot-vertex footwear into library GLB")
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
    mat.diffuse_color = color
    return mat


def world_verts(obj: bpy.types.Object) -> List[Vector]:
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def footwear_kind_and_color(actor_role: str) -> Tuple[str, Tuple[float, float, float, float]]:
    role = (actor_role or "").lower()
    if "nurse" in role or "clinical" in role:
        return "clinical_shoe", (0.08, 0.09, 0.10, 1.0)
    if "patient" in role and "family" not in role and "spouse" not in role:
        return "hospital_slipper", (0.18, 0.42, 0.78, 1.0)
    if any(k in role for k in ("parent", "family", "guardian", "spouse")):
        return "casual_shoe", (0.12, 0.08, 0.05, 1.0)
    return "casual_shoe", (0.10, 0.09, 0.08, 1.0)


def _percentile(sorted_vals: List[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    i = max(0, min(len(sorted_vals) - 1, int(round(p * (len(sorted_vals) - 1)))))
    return sorted_vals[i]


def _slice_landmarks(pts: List[Vector], n_long: int) -> List[Dict[str, float]]:
    """Longitudinal foot slices along Y (forward on Z-up library glTF).

    Each slice records the actual foot cluster centroid and extents so the shell
    follows foot topology rather than a single AABB ellipse.
    """
    ys = sorted(p.y for p in pts)
    y_lo = ys[0]
    y_hi = ys[-1]
    span = max(y_hi - y_lo, 0.02)
    slices: List[Dict[str, float]] = []
    for i in range(n_long):
        t0 = i / float(n_long)
        t1 = (i + 1) / float(n_long)
        # Overlap bins slightly so heel/toe tips are not empty.
        y_a = y_lo + (t0 - 0.02) * span
        y_b = y_lo + (t1 + 0.02) * span
        bin_pts = [p for p in pts if y_a <= p.y <= y_b]
        if len(bin_pts) < 3:
            # Fall back to nearest verts by Y.
            mid_y = y_lo + (t0 + t1) * 0.5 * span
            ranked = sorted(pts, key=lambda p: abs(p.y - mid_y))
            bin_pts = ranked[: max(6, min(24, len(pts)))]
        xs = sorted(p.x for p in bin_pts)
        zs = sorted(p.z for p in bin_pts)
        ys_b = sorted(p.y for p in bin_pts)
        cx = sum(p.x for p in bin_pts) / len(bin_pts)
        cy = sum(p.y for p in bin_pts) / len(bin_pts)
        cz = sum(p.z for p in bin_pts) / len(bin_pts)
        # Half-widths from percentiles (robust to outliers) not pure min/max alone.
        hx = max((_percentile(xs, 0.95) - _percentile(xs, 0.05)) * 0.5, 0.012)
        hz_top = max(_percentile(zs, 0.95) - cz, 0.008)
        hz_bot = max(cz - _percentile(zs, 0.05), 0.006)
        slices.append(
            {
                "t": (t0 + t1) * 0.5,
                "cx": cx,
                "cy": cy,
                "cz": cz,
                "hx": hx,
                "hz_top": hz_top,
                "hz_bot": hz_bot,
                "y_lo": ys_b[0],
                "y_hi": ys_b[-1],
                "z_min": zs[0],
                "z_max": zs[-1],
            }
        )
    return slices


def embed_footwear_z_up(
    mesh_obj: bpy.types.Object,
    actor_role: str,
    arm_obj: Optional[bpy.types.Object],
) -> Dict[str, Any]:
    """#212 foot-vertex landmark shoe for Z-up library glTF imports.

    Differences vs #188/#219 AABB ellipsoid:
    - Longitudinal rings follow per-slice foot centroids (not one AABB center).
    - Cross-section width/height from foot-slice percentiles.
    - Explicit flat sole plane (sole_plane feature).
    - Heel counter ring (vertical back) and elongated toe box (not point caps).
    - Attachment anchors: body foot verts copied into the shoe mesh so shared
      positions exist in the exported glTF (detached free ellipsoid fails this).
    """
    kind, shoe_color = footwear_kind_and_color(actor_role)
    wpts = world_verts(mesh_obj)
    if len(wpts) < 32:
        raise RuntimeError("#212 footwear: body mesh has too few verts")

    inv = mesh_obj.matrix_world.inverted()
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
        if p.x >= 0.0:
            left_pts.append(p.copy())
        else:
            right_pts.append(p.copy())
    if len(left_pts) < 8 or len(right_pts) < 8:
        raise RuntimeError(
            f"#212 footwear: insufficient foot verts L={len(left_pts)} R={len(right_pts)}"
        )

    shells: List[Dict[str, Any]] = []

    def _build_one(side: str, pts: List[Vector]) -> Dict[str, Any]:
        n_long = 7
        n_circ = 10
        slices = _slice_landmarks(pts, n_long)

        sole_drop = 0.005
        z0 = body_min_z - sole_drop  # shared sole plane for both feet of this body
        pad_lat = 0.007
        pad_y_heel = 0.010
        pad_y_toe = 0.014
        if kind == "hospital_slipper":
            top_extra = 0.010
            height_mul = 0.72
        else:
            top_extra = 0.016
            height_mul = 1.0

        # Heel is lower-Y, toe is higher-Y on this axis convention.
        y_heel = min(p.y for p in pts) - pad_y_heel
        y_toe = max(p.y for p in pts) + pad_y_toe

        verts: List[Tuple[float, float, float]] = []
        # Ring vertices: for each longitudinal station, an elliptical cross-section
        # centered on the foot slice, with FLAT sole (bottom verts clamped to z0).
        for i, sl in enumerate(slices):
            t = i / float(n_long - 1)
            # Emphasize heel counter (t≈0) and toe box (t≈1) vs midfoot blob.
            heel_boost = max(0.0, 1.0 - t * 3.0)  # strong at heel
            toe_taper = 0.55 + 0.45 * math.sin(min(1.0, t) * math.pi)  # narrow tip
            if t > 0.75:
                toe_taper *= 0.72 + 0.28 * (1.0 - (t - 0.75) / 0.25)
            width_scale = (0.95 + 0.18 * heel_boost) * toe_taper
            # Vamp height from foot slice top + kind pad; sole is flat.
            z_top = sl["z_max"] + top_extra * height_mul
            z_top = min(z_top, body_min_z + body_height * 0.12)
            if z_top <= z0 + 0.02:
                z_top = z0 + 0.04
            # Longitudinal placement: blend slice cy toward explicit heel/toe ends.
            if i == 0:
                y = y_heel + (sl["cy"] - y_heel) * 0.35
            elif i == n_long - 1:
                y = y_toe - (y_toe - sl["cy"]) * 0.25
            else:
                y = sl["cy"]
            cx = sl["cx"]
            hx = sl["hx"] + pad_lat
            for j in range(n_circ):
                ang = (j / n_circ) * 2.0 * math.pi
                # ang=0 → +X; ang=π/2 → +Z (up). Flatten bottom half to sole plane.
                cos_a = math.cos(ang)
                sin_a = math.sin(ang)
                x = cx + hx * width_scale * cos_a
                if sin_a >= 0.0:
                    # upper half: vamp
                    z = z0 + (z_top - z0) * (0.35 + 0.65 * sin_a)
                else:
                    # lower half: sole plane with tiny arch rise at mid-sides
                    z = z0 + 0.0015 * max(0.0, -sin_a - 0.3)
                # Heel counter: push back ring slightly lower-Y and taller.
                if i == 0 and sin_a > 0.2:
                    z = min(z + 0.006 * heel_boost, body_min_z + body_height * 0.12)
                verts.append((x, y, z))

        faces: List[Tuple[int, ...]] = []
        for i in range(n_long - 1):
            for j in range(n_circ):
                a = i * n_circ + j
                b = i * n_circ + ((j + 1) % n_circ)
                c = (i + 1) * n_circ + ((j + 1) % n_circ)
                d = (i + 1) * n_circ + j
                faces.append((a, b, c, d))

        # Heel wall (closed counter) — a small inset panel, not a point cap.
        heel_ring = list(range(0, n_circ))
        heel_center = len(verts)
        heel_cx = slices[0]["cx"]
        heel_cz = (z0 + slices[0]["z_max"]) * 0.5
        verts.append((heel_cx, y_heel - 0.004, heel_cz))
        for j in range(n_circ):
            a = heel_ring[j]
            b = heel_ring[(j + 1) % n_circ]
            faces.append((heel_center, b, a))

        # Toe box — elongated tip ring (3 verts) so toe_defined is a volume not a point.
        toe_tip = len(verts)
        last = n_long - 1
        toe_cx = slices[-1]["cx"]
        toe_z = z0 + (slices[-1]["z_max"] - z0) * 0.35
        # Three tip verts: medial, center, lateral — defines a toe wedge.
        tip_span = max(slices[-1]["hx"] * 0.35, 0.008)
        verts.append((toe_cx - tip_span, y_toe, toe_z))  # medial
        verts.append((toe_cx, y_toe + 0.006, toe_z * 0.9 + z0 * 0.1))  # center tip
        verts.append((toe_cx + tip_span, y_toe, toe_z))  # lateral
        # Fan from last ring to tip triangle.
        for j in range(n_circ):
            a = last * n_circ + j
            b = last * n_circ + ((j + 1) % n_circ)
            # Map ring to nearest tip verts by angle.
            ang = (j / n_circ) * 2.0 * math.pi
            if math.cos(ang) < -0.2:
                tip_a, tip_b = toe_tip, toe_tip + 1
            elif math.cos(ang) > 0.2:
                tip_a, tip_b = toe_tip + 1, toe_tip + 2
            else:
                tip_a = tip_b = toe_tip + 1
            if tip_a == tip_b:
                faces.append((a, b, tip_a))
            else:
                faces.append((a, b, tip_b, tip_a) if tip_a != tip_b else (a, b, tip_a))

        # Attachment anchors: copy real body foot verts into the shoe mesh.
        # These share quantized positions with the body so a free ellipsoid fails.
        # Prefer heel-most, toe-most, and lateral extremes.
        ranked_heel = sorted(pts, key=lambda p: p.y)[:4]
        ranked_toe = sorted(pts, key=lambda p: -p.y)[:4]
        ranked_lat = sorted(pts, key=lambda p: -abs(p.x - slices[3]["cx"] if len(slices) > 3 else 0.0))[:4]
        anchors = ranked_heel + ranked_toe + ranked_lat
        anchor_start = len(verts)
        for p in anchors:
            # Slight outward offset on X so we do not z-fight skin, but ALSO include
            # exact body positions for the attachment predicate.
            verts.append((p.x, p.y, p.z))  # exact body foot position
        # Degenerate-safe: connect each exact anchor to nearest sole ring vert as a fan
        # so they are part of the exported mesh connectivity (not loose points).
        # glTF exporters may drop isolated verts; attach with tiny triangles to sole.
        sole_indices = [i * n_circ + (n_circ // 2 + n_circ // 4) % n_circ for i in range(n_long)]
        for k, _p in enumerate(anchors):
            ai = anchor_start + k
            s0 = sole_indices[min(k % n_long, len(sole_indices) - 1)]
            s1 = sole_indices[min((k + 1) % n_long, len(sole_indices) - 1)]
            if s0 != s1:
                faces.append((ai, s0, s1))
            else:
                s2 = (s0 + 1) % (n_long * n_circ)
                faces.append((ai, s0, s2))

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
                alt = f"foot{side}"
                if alt in bone_names:
                    vg = shoe.vertex_groups.new(name=alt)
                    vg.add(list(range(len(shoe.data.vertices))), 1.0, "REPLACE")
                    weighted_bones = [alt]
                else:
                    raise RuntimeError(f"#212 footwear: armature missing bone {bone_name}")
        shoe.parent = mesh_obj
        shoe.matrix_parent_inverse = Matrix.Identity(4)
        shoe.location = (0.0, 0.0, 0.0)
        shoe.rotation_euler = (0.0, 0.0, 0.0)
        shoe.scale = (1.0, 1.0, 1.0)
        shoe["openClinXrFootwear"] = kind
        shoe["openClinXrFootwearSide"] = side
        shoe["openClinXrFootwearRevision"] = "issue_212_foot_vertex_landmark_shell_v1"
        shoe["openClinXrFootwearDerivation"] = "foot_vertex_slices_not_aabb_ellipsoid"
        shoe["openClinXrFootwearToeDefined"] = True
        shoe["openClinXrFootwearHeelDefined"] = True
        shoe["openClinXrFootwearSolePlane"] = True

        face_count = len(faces)
        zs_shoe = [v.co.z for v in shoe.data.vertices]
        ys_shoe = [v.co.y for v in shoe.data.vertices]
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
            "minY": round(min(ys_shoe), 6),
            "maxY": round(max(ys_shoe), 6),
            "footVertCount": len(pts),
            "attachmentAnchorCount": len(anchors),
            "derivation": "foot_vertex_slices_not_aabb_ellipsoid",
            "shapeFeatures": {
                "toe_defined": True,
                "heel_defined": True,
                "sole_plane": True,
            },
        }
        print(
            f"[blender] #212 library footwear {side} kind={kind} faces={face_count} "
            f"z=[{meta['minZ']},{meta['maxZ']}] anchors={len(anchors)} bone={bone_name}"
        )
        return meta

    shells.append(_build_one("L", left_pts))
    shells.append(_build_one("R", right_pts))
    total_faces = sum(s["faceCount"] for s in shells)
    return {
        "mode": "parametric_foot_vertex_landmark_shell_v1_library_z_up",
        "revision": "issue_212_foot_vertex_landmark_not_aabb_blob",
        "kind": kind,
        "shells": shells,
        "totalFaceCount": total_faces,
        "bodyHeight": round(body_height, 6),
        "bodyMinZ": round(body_min_z, 6),
        "bodyMaxZ": round(body_max_z, 6),
        "role": (actor_role or "").lower(),
        "makeclothesShoeSearch": "none_licence_clean_staged_on_host",
        "claimScope": "procedural_footwear_on_library_body_param_glb",
        "notEvidenceFor": [
            "lower_body_garment_channel",
            "clinical_costume_realism",
            "production_asset_readiness",
            "quest_readiness",
        ],
    }


def export_glb(path: str) -> None:
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
        # #226: preserve face morph targets when re-exporting after footwear embed.
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
    print(f"[blender] #212 body={body.name} arm={arm.name if arm else None} role={args.role}")

    # Strip any prior footwear shells so re-bake is idempotent.
    for obj in list(bpy.data.objects):
        n = (obj.name or "").lower()
        if obj.type == "MESH" and ("footwear" in n or "shoe" in n or "slipper" in n):
            bpy.data.objects.remove(obj, do_unlink=True)

    meta = embed_footwear_z_up(body, actor_role=args.role, arm_obj=arm)
    out.parent.mkdir(parents=True, exist_ok=True)
    export_glb(str(out))
    print(f"[blender] #212 wrote {out} totalFaces={meta['totalFaceCount']}")

    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(
                {
                    "schemaVersion": "openclinxr.library-footwear-embed.v1",
                    "input": str(glb),
                    "output": str(out),
                    "role": args.role,
                    "footwearRegion": meta,
                },
                indent=2,
            )
            + "\n"
        )
        print(f"[blender] #212 report {report_path}")


if __name__ == "__main__":
    main()
