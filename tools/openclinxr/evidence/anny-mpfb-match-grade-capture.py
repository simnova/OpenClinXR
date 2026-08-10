#!/usr/bin/env python3
"""#221 grade capture — lit EEVEE side-by-side Anny reference vs MPFB library body.

Fails closed if the PNG is near-uniform (the blank-grey failure class).
Does not invent materials; uses imported glTF materials + key/fill lights.

#222: parameterised so a single proven renderer serves both the issue-221 two-pair
comparison (defaults) and the issue-222 single-pair known-good-vs-subject capture.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / ".openclinxr/evidence/issue-221/anny-mpfb-match-grade.png"

# One pair per row: Anny (left) | MPFB library (right). Two pairs stacked horizontally.
PAIRS = [
    (
        REPO / "apps/ui-xr/public/generated-humanoids/ed_chest_pain_nurse_adult.glb",
        REPO / "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
        "nurse_anny",
        "mpfb_lean_female",
    ),
    (
        REPO / "apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.glb",
        REPO / "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb",
        "cast_anny",
        "mpfb_heavy_male",
    ),
]


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def parse_args() -> argparse.Namespace:
    # Blender consumes its own flags and passes script args after `--`; sys.argv still holds
    # Blender's tokens, so slice at the first `--` (same pattern as the MPFB materializer).
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    parser = argparse.ArgumentParser(description="Grade render: lit EEVEE side-by-side Anny reference vs MPFB body.")
    parser.add_argument("--out", default=str(OUT), help="Output PNG path (default: issue-221 path)")
    parser.add_argument("--anny-glb", default=None, help="Anny reference GLB for a single pair (default: issue-221 pairs)")
    parser.add_argument("--mpfb-glb", default=None, help="MPFB subject GLB for a single pair (default: issue-221 pairs)")
    parser.add_argument("--anny-name", default="anny_reference")
    parser.add_argument("--mpfb-name", default="mpfb_subject")
    return parser.parse_args(argv)


def choose_engine() -> str:
    scene = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = eng
            return eng
        except Exception:
            continue
    scene.render.engine = "BLENDER_WORKBENCH"
    return "BLENDER_WORKBENCH"


def mesh_world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector] | None:
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    any_mesh = False
    deps = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != "MESH":
            continue
        any_mesh = True
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        try:
            for v in mesh.vertices:
                w = ev.matrix_world @ v.co
                mins.x = min(mins.x, w.x)
                mins.y = min(mins.y, w.y)
                mins.z = min(mins.z, w.z)
                maxs.x = max(maxs.x, w.x)
                maxs.y = max(maxs.y, w.y)
                maxs.z = max(maxs.z, w.z)
        finally:
            ev.to_mesh_clear()
    if not any_mesh:
        return None
    return mins, maxs


def import_glb(path: Path, root_name: str, offset_x: float) -> list[bpy.types.Object]:
    if not path.is_file():
        raise FileNotFoundError(path)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    created = [o for o in bpy.data.objects if o not in before]
    if not created:
        raise RuntimeError(f"gltf import produced nothing: {path}")
    root = bpy.data.objects.new(root_name, None)
    bpy.context.collection.objects.link(root)
    for o in created:
        if o.parent is None:
            o.parent = root
    root.location.x = offset_x
    bpy.context.view_layer.update()
    return [root] + created


def frame_camera(all_objects: list[bpy.types.Object]) -> dict:
    bounds = mesh_world_bounds([o for o in all_objects if o.type == "MESH" or True])
    # Recompute from meshes only
    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    b = mesh_world_bounds(mesh_objs)
    if b is None:
        raise RuntimeError("no mesh bounds after import — subjects missing from scene")
    mins, maxs = b
    center = (mins + maxs) * 0.5
    size = maxs - mins
    height = max(size.z, 0.5)
    width = max(size.x, 0.5)
    depth = max(size.y, 0.5)
    # glTF Y-up import in Blender 4+/5 often leaves content with height on Z or Y depending
    # on importer. Prefer the longest vertical-ish axis as "up" for framing.
    up_axis = "Z" if size.z >= size.y * 0.85 else "Y"
    if up_axis == "Z":
        cam_height = center.z
        span = max(height, width * 0.55)
        # Look along -Y (front)
        cam_dist = max(4.5, span * 2.6)
        cam_loc = (center.x, center.y - cam_dist, cam_height + span * 0.05)
        # Point camera at center: track-to
        track_up = (0, 0, 1)
    else:
        cam_height = center.y
        span = max(size.y, width * 0.55)
        cam_dist = max(4.5, span * 2.6)
        cam_loc = (center.x, cam_height + span * 0.05, center.z + cam_dist)
        track_up = (0, 1, 0)

    cam_data = bpy.data.cameras.new("anny_mpfb_grade_cam")
    cam = bpy.data.objects.new("anny_mpfb_grade_cam", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = cam_loc
    cam_data.lens = 35

    # Aim with track-to constraint (stable across axis conventions)
    empty = bpy.data.objects.new("look_at", None)
    bpy.context.collection.objects.link(empty)
    empty.location = center
    con = cam.constraints.new(type="TRACK_TO")
    con.target = empty
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"

    # Lights
    key = bpy.data.lights.new("key", "AREA")
    key.energy = 800
    key.size = 5
    key_o = bpy.data.objects.new("key", key)
    bpy.context.collection.objects.link(key_o)
    key_o.location = (center.x + 2.0, center.y - 3.0, center.z + 3.5)

    fill = bpy.data.lights.new("fill", "AREA")
    fill.energy = 250
    fill.size = 6
    fill_o = bpy.data.objects.new("fill", fill)
    bpy.context.collection.objects.link(fill_o)
    fill_o.location = (center.x - 2.5, center.y - 1.5, center.z + 2.0)

    rim = bpy.data.lights.new("rim", "AREA")
    rim.energy = 180
    rim.size = 4
    rim_o = bpy.data.objects.new("rim", rim)
    bpy.context.collection.objects.link(rim_o)
    rim_o.location = (center.x, center.y + 2.5, center.z + 2.5)

    world = bpy.data.worlds.new("grade_world")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.18, 0.19, 0.21, 1.0)
    bg.inputs[1].default_value = 0.85

    bpy.context.view_layer.update()
    return {
        "center": list(center),
        "size": list(size),
        "upAxis": up_axis,
        "camLoc": list(cam.location),
        "span": span,
        "meshCount": len(mesh_objs),
    }


def assert_png_not_blank(
    path: Path,
    *,
    min_std: float = 8.0,
    min_unique: int = 40,
    min_content_frac: float = 0.012,
) -> dict:
    """Refuse uniform / near-uniform PNGs (the blank-grey failure class).

    Also requires a minimum fraction of pixels far from the median background colour so a
    pure grey plate with tiny encoder noise cannot pass on std alone.
    """
    # Prefer Pillow; fall back to pure stdlib PNG via bpy image load.
    try:
        from PIL import Image  # type: ignore
        import statistics

        im = Image.open(path).convert("RGB")
        w, h = im.size
        samples: list[tuple[int, int, int]] = []
        step = max(1, min(w, h) // 80)
        for y in range(0, h, step):
            for x in range(0, w, step):
                samples.append(im.getpixel((x, y)))  # type: ignore[arg-type]
        lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in samples]
        std = statistics.pstdev(lum) if len(lum) > 1 else 0.0
        unique = len(set(samples))
        # Content fraction: distance from median RGB
        med_r = statistics.median(s[0] for s in samples)
        med_g = statistics.median(s[1] for s in samples)
        med_b = statistics.median(s[2] for s in samples)
        content = sum(
            1
            for r, g, b in samples
            if ((r - med_r) ** 2 + (g - med_g) ** 2 + (b - med_b) ** 2) ** 0.5 > 25
        )
        content_frac = content / max(1, len(samples))
        info = {
            "width": w,
            "height": h,
            "sampleCount": len(samples),
            "luminanceStd": round(std, 3),
            "uniqueColorsSampled": unique,
            "meanLum": round(sum(lum) / max(1, len(lum)), 2),
            "contentFrac": round(content_frac, 4),
        }
        if std < min_std or unique < min_unique or content_frac < min_content_frac:
            raise RuntimeError(
                f"grade PNG looks blank/uniform: std={std:.2f} unique={unique} "
                f"contentFrac={content_frac:.4f} "
                f"(need std>={min_std} unique>={min_unique} contentFrac>={min_content_frac}) "
                f"path={path}"
            )
        return info
    except ImportError:
        pass

    # bpy image path
    img = bpy.data.images.load(str(path))
    pixels = list(img.pixels)  # RGBA float 0..1, huge — subsample
    n = img.size[0] * img.size[1]
    step = max(1, n // 5000)
    lums = []
    colors = set()
    for i in range(0, n, step):
        r = pixels[i * 4]
        g = pixels[i * 4 + 1]
        b = pixels[i * 4 + 2]
        lums.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
        colors.add((round(r, 2), round(g, 2), round(b, 2)))
    mean = sum(lums) / max(1, len(lums))
    var = sum((x - mean) ** 2 for x in lums) / max(1, len(lums))
    std = math.sqrt(var) * 255.0  # scale to 0..255-ish
    info = {
        "width": img.size[0],
        "height": img.size[1],
        "sampleCount": len(lums),
        "luminanceStd": round(std, 3),
        "uniqueColorsSampled": len(colors),
        "meanLum": round(mean * 255, 2),
    }
    if std < min_std or len(colors) < min_unique:
        raise RuntimeError(
            f"grade PNG looks blank/uniform: std={std:.2f} unique={len(colors)} path={path}"
        )
    return info


def main() -> int:
    args = parse_args()
    out_path = Path(args.out)
    clear_scene()
    engine = choose_engine()
    if "WORKBENCH" in engine:
        print("WARN: falling back to WORKBENCH — materials may be washed out", file=sys.stderr)

    if args.anny_glb and args.mpfb_glb:
        # Single subject pair (e.g. issue-222: Anny known-good | MPFB promoted subject)
        pairs = [(Path(args.anny_glb), Path(args.mpfb_glb), args.anny_name, args.mpfb_name)]
        offsets = [-1.5, 1.5]
        expected_meshes = 2
    else:
        pairs = PAIRS
        offsets = [-3.0, -1.0, 1.0, 3.0]
        expected_meshes = 4

    all_roots: list[bpy.types.Object] = []
    idx = 0
    for anny_path, mpfb_path, anny_name, mpfb_name in pairs:
        all_roots.extend(import_glb(anny_path, anny_name, offsets[idx]))
        idx += 1
        all_roots.extend(import_glb(mpfb_path, mpfb_name, offsets[idx]))
        idx += 1

    mesh_count = sum(1 for o in bpy.data.objects if o.type == "MESH")
    if mesh_count < expected_meshes:
        raise RuntimeError(f"expected ≥{expected_meshes} meshes after import, got {mesh_count}")

    frame = frame_camera(all_roots)
    print("FRAME", frame, "engine", engine)

    scene = bpy.context.scene
    try:
        scene.eevee.taa_render_samples = 32
    except Exception:
        pass
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.filepath = str(out_path)
    scene.render.image_settings.file_format = "PNG"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.render.render(write_still=True)
    if not out_path.is_file() or out_path.stat().st_size < 20_000:
        raise RuntimeError(f"render did not write a usable PNG: {out_path}")

    pix = assert_png_not_blank(out_path)
    print(
        "OK",
        {
            "path": str(out_path.resolve().relative_to(REPO)),
            "bytes": out_path.stat().st_size,
            "engine": engine,
            "pixels": pix,
            "frame": frame,
        },
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
