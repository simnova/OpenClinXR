"""Normalize Sketchfab equipment GLB to metre scale + ground + optional deck fit.

Uses world-space mesh transforms (not stacked object.scale) so non-uniform deck Z
fit does not fight glTF parent chains. Optional mesh name filter excludes props
(e.g. bedside stand) from the support-surface AABB.

Usage:
  blender --background --python tools/openclinxr/factory/equipment-lane/normalize-equipment-glb.py -- \\
    --glb path/in.glb --out path/out.glb --report path/report.json \\
    --target-length 2.15 --target-deck 0.58 \\
    --keep-name-regex 'Mattress|BedFrame|Bedframe' \\
    --drop-name-regex 'Bedside|Stand'

claimScope: unit-scale + deck Z fit for bank promotion gate.
notEvidenceFor: clinical accuracy, Quest readiness.
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def argv_map() -> dict[str, str]:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out: dict[str, str] = {}
    i = 0
    while i < len(raw):
        if raw[i].startswith("--") and i + 1 < len(raw):
            out[raw[i][2:]] = raw[i + 1]
            i += 2
        else:
            i += 1
    return out


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def mesh_objects() -> list:
    return [o for o in bpy.data.objects if o.type == "MESH"]


def name_allowed(name: str, keep: re.Pattern | None, drop: re.Pattern | None) -> bool:
    if drop is not None and drop.search(name):
        return False
    if keep is not None and not keep.search(name):
        return False
    return True


def active_meshes(keep: re.Pattern | None, drop: re.Pattern | None) -> list:
    return [o for o in mesh_objects() if name_allowed(o.name, keep, drop)]


def delete_filtered(keep: re.Pattern | None, drop: re.Pattern | None) -> list[str]:
    removed: list[str] = []
    for obj in list(mesh_objects()):
        if not name_allowed(obj.name, keep, drop):
            removed.append(obj.name)
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh and mesh.users == 0:
                bpy.data.meshes.remove(mesh)
    return removed


def world_bounds(objs: list | None = None) -> tuple[Vector, Vector]:
    targets = objs if objs is not None else mesh_objects()
    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    n = 0
    for obj in targets:
        mw = obj.matrix_world
        # Use evaluated vertex extremes, not only bound_box, for accuracy.
        mesh = obj.data
        if not mesh.vertices:
            continue
        for v in mesh.vertices:
            w = mw @ v.co
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])
            n += 1
    if n == 0:
        raise RuntimeError("no mesh vertices after import/filter")
    return mins, maxs


def apply_world_matrix(matrix: Matrix) -> None:
    """Bake a world transform into mesh data; leave objects at identity."""
    for obj in mesh_objects():
        mesh = obj.data
        mesh.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
        mesh.transform(matrix)
        mesh.update()
    bpy.context.view_layer.update()


def ground_min_z_zero() -> None:
    mins, _ = world_bounds()
    if abs(mins.z) < 1e-9:
        return
    t = Matrix.Translation(Vector((0.0, 0.0, -mins.z)))
    apply_world_matrix(t)


def largest_horizontal_deck(
    bin_size: float = 0.01,
    prefer: str = "upper",
    target_deck: float | None = None,
    min_area_frac: float = 0.25,
) -> dict:
    """prefer: upper | absolute | closest_target.

    closest_target picks among bands with area ≥ min_area_frac * max_area the
    one nearest target_deck (avoids headrest/arm boards winning after upper cut).
    """
    bins: dict[int, float] = {}
    for obj in mesh_objects():
        mesh = obj.data
        mesh.calc_loop_triangles()
        mw = obj.matrix_world
        for tri in mesh.loop_triangles:
            verts = [mw @ mesh.vertices[i].co for i in tri.vertices]
            n = (verts[1] - verts[0]).cross(verts[2] - verts[0])
            area = n.length * 0.5
            if area < 1e-10:
                continue
            n.normalize()
            if abs(n.z) < 0.85:
                continue
            z = (verts[0].z + verts[1].z + verts[2].z) / 3.0
            key = int(math.floor(z / bin_size))
            bins[key] = bins.get(key, 0.0) + area
    if not bins:
        return {"deckTopM": None, "deckAreaM2": 0.0, "bins": []}

    mins, maxs = world_bounds()
    height = maxs.z - mins.z
    ranked = sorted(
        [{"z": (k + 0.5) * bin_size, "area": a, "key": k} for k, a in bins.items()],
        key=lambda r: -r["area"],
    )
    if prefer == "upper" and height > 1e-6:
        z_cut = mins.z + height * 0.28
        candidates = [r for r in ranked if r["z"] >= z_cut] or ranked
        best = max(candidates, key=lambda r: r["area"])
    elif prefer == "closest_target" and target_deck is not None:
        max_a = ranked[0]["area"]
        floor_a = max_a * min_area_frac
        # Prefer mid-height bands near the mattress plane, not floor or top rails.
        z_lo = mins.z + height * 0.2
        z_hi = mins.z + height * 0.85
        pool = [r for r in ranked if r["area"] >= floor_a and z_lo <= r["z"] <= z_hi]
        if not pool:
            pool = [r for r in ranked if r["area"] >= floor_a] or ranked
        best = min(pool, key=lambda r: abs(r["z"] - float(target_deck)))
    else:
        best = ranked[0]
    return {
        "deckTopM": best["z"],
        "deckAreaM2": best["area"],
        "bins": [{k: r[k] for k in ("z", "area")} for r in ranked[:10]],
    }


def main() -> None:
    args = argv_map()
    glb_in = args.get("glb")
    glb_out = args.get("out")
    report_path = args.get("report")
    if not glb_in or not glb_out or not report_path:
        raise SystemExit("need --glb --out --report")

    target_len = float(args.get("target-length", "2.15"))
    target_deck = float(args.get("target-deck", "0.58"))
    target_width = args.get("target-width")
    target_width_f = float(target_width) if target_width else None
    mode = args.get("mode", "length_and_deck")  # length_and_deck | length_only | height_fit
    target_height = float(args.get("target-height", "2.2"))
    keep = re.compile(args["keep-name-regex"]) if args.get("keep-name-regex") else None
    drop = re.compile(args["drop-name-regex"]) if args.get("drop-name-regex") else None
    deck_prefer = args.get("deck-prefer", "upper")  # upper | absolute | closest_target

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=glb_in)
    bpy.context.view_layer.update()

    # Flatten object transforms into mesh data first.
    apply_world_matrix(Matrix.Identity(4))
    removed = delete_filtered(keep, drop)
    if not mesh_objects():
        raise RuntimeError(f"no meshes left after filter (removed={removed})")

    ground_min_z_zero()
    mins0, maxs0 = world_bounds()
    size0 = maxs0 - mins0
    raw_length = max(size0.x, size0.y)
    raw_width = min(size0.x, size0.y)
    raw_height = size0.z
    raw_band = largest_horizontal_deck(prefer=deck_prefer, target_deck=target_deck)

    if mode == "height_fit":
        if raw_height > 1e-6:
            s = target_height / raw_height
            apply_world_matrix(Matrix.Diagonal((s, s, s, 1.0)))
        ground_min_z_zero()
    else:
        if raw_length > 1e-6:
            s = target_len / raw_length
            apply_world_matrix(Matrix.Diagonal((s, s, s, 1.0)))
        ground_min_z_zero()
        if mode == "length_and_deck":
            band_mid = largest_horizontal_deck(prefer=deck_prefer, target_deck=target_deck)
            deck0 = band_mid.get("deckTopM")
            if deck0 is not None and float(deck0) > 0.05:
                zs = target_deck / float(deck0)
                apply_world_matrix(Matrix.Diagonal((1.0, 1.0, zs, 1.0)))
                ground_min_z_zero()
        # Optional non-uniform width fit (after length): squash only horizontal minor axis.
        if target_width_f is not None:
            mins_w, maxs_w = world_bounds()
            size_w = maxs_w - mins_w
            if size_w.x >= size_w.y and size_w.y > 1e-6:
                wy = target_width_f / size_w.y
                apply_world_matrix(Matrix.Diagonal((1.0, wy, 1.0, 1.0)))
            elif size_w.x > 1e-6:
                wx = target_width_f / size_w.x
                apply_world_matrix(Matrix.Diagonal((wx, 1.0, 1.0, 1.0)))
            ground_min_z_zero()

    # Center XY on origin for predictable footprint fit.
    mins, maxs = world_bounds()
    cx = 0.5 * (mins.x + maxs.x)
    cy = 0.5 * (mins.y + maxs.y)
    apply_world_matrix(Matrix.Translation(Vector((-cx, -cy, 0.0))))
    ground_min_z_zero()

    mins, maxs = world_bounds()
    size = maxs - mins
    length = max(size.x, size.y)
    width = min(size.x, size.y)
    height = size.z
    band = largest_horizontal_deck(prefer=deck_prefer, target_deck=target_deck)
    deck = band.get("deckTopM")

    Path(glb_out).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=glb_out, export_format="GLB")

    def rel_ok(got: float | None, want: float, tol: float) -> bool:
        if got is None:
            return False
        return abs(float(got) - want) / max(want, 1e-6) < tol

    report = {
        "glbIn": glb_in,
        "glbOut": glb_out,
        "mode": mode,
        "removedMeshes": removed,
        "keepNameRegex": args.get("keep-name-regex"),
        "dropNameRegex": args.get("drop-name-regex"),
        "targetLengthM": target_len,
        "targetDeckM": target_deck,
        "targetWidthM": target_width_f,
        "targetHeightM": target_height if mode == "height_fit" else None,
        "raw": {
            "lengthM": raw_length,
            "widthM": raw_width,
            "heightM": raw_height,
            "deckTopM": raw_band.get("deckTopM"),
            "deckAreaM2": raw_band.get("deckAreaM2"),
        },
        "lengthM": length,
        "widthM": width,
        "heightM": height,
        "deckTopM": deck,
        "deckAreaM2": band.get("deckAreaM2"),
        "topHorizontalBands": band.get("bins"),
        "passHospitalBed": rel_ok(length, 2.15, 0.12)
        and rel_ok(deck, 0.58, 0.15)
        and width <= 1.25,
        "passStretcher": rel_ok(length, 2.0, 0.15)
        and deck is not None
        and 0.55 <= float(deck) <= 0.95
        and width <= 1.05,
        "passExamTable": rel_ok(length, 1.9, 0.2)
        and deck is not None
        and 0.50 <= float(deck) <= 0.95
        and width <= 1.15,
        "passPrivacyCurtain": mode == "height_fit"
        and 1.6 <= height <= 2.8
        and length <= 3.5,
        "claimScope": "unit_scale_and_deck_fit_for_bank_promotion_gate",
        "notEvidenceFor": [
            "clinical_accuracy",
            "quest_readiness",
            "exam_equivalence",
        ],
    }
    Path(report_path).parent.mkdir(parents=True, exist_ok=True)
    Path(report_path).write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "ok": True,
                "mode": mode,
                "removed": removed,
                "lengthM": length,
                "widthM": width,
                "heightM": height,
                "deckTopM": deck,
                "passHospitalBed": report["passHospitalBed"],
                "passStretcher": report["passStretcher"],
                "passExamTable": report["passExamTable"],
                "passPrivacyCurtain": report["passPrivacyCurtain"],
            }
        )
    )


if __name__ == "__main__":
    main()
