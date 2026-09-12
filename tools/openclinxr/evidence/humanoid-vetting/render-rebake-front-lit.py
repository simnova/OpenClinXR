"""
Render isolated front_lit captures of the re-baked aisha bodies.

Conventions inherited from render-tex-candidates.py:
- Black-frame pixel-extrema guard (RAISEs if max channel < 10/255)
- Output to captures/ subdirectory
- Front-lit, front-camera setup

Usage: blender --background --python render-rebake-front-lit.py -- <glb_path> <label>
"""
import bpy
import os
import sys
from struct import unpack
from zlib import decompress

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "captures")
os.makedirs(OUTPUT_DIR, exist_ok=True)


def read_png_pixel_extrema(png_path):
    """Read pixel extrema from a rendered PNG (same guard as render-tex-candidates.py)."""
    try:
        with open(png_path, "rb") as f:
            sig = f.read(8)
            if sig != b"\x89PNG\r\n\x1a\n":
                return (0, 0)
            chunks = []
            while True:
                raw = f.read(8)
                if len(raw) < 8:
                    break
                length = int.from_bytes(raw[:4], "big")
                ctype = raw[4:8]
                data = f.read(length)
                _crc = f.read(4)
                if ctype == b"IEND":
                    break
                chunks.append((ctype, data))
            idat = b""
            width = height = 0
            bit_depth = color_type = 0
            for ctype, data in chunks:
                if ctype == b"IHDR":
                    width = int.from_bytes(data[0:4], "big")
                    height = int.from_bytes(data[4:8], "big")
                    bit_depth = data[8]
                    color_type = data[9]
                elif ctype == b"IDAT":
                    idat += data
            if not idat or bit_depth != 8 or color_type not in (2, 6):
                return (0, 0)
            raw_pixels = decompress(idat)
            channels = 4 if color_type == 6 else 3
            stride = 1 + width * channels
            mn, mx = 255, 0
            for row_idx in range(height):
                start = row_idx * stride + 1
                for px in range(width):
                    off = start + px * channels
                    for c in range(channels):
                        v = raw_pixels[off + c]
                        if v < mn:
                            mn = v
                        if v > mx:
                            mx = v
            return (mn, mx)
    except Exception:
        return (0, 0)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        print("Usage: blender --background --python render-rebake-front-lit.py -- <glb_path> <label>")
        sys.exit(1)
    glb_path = argv[0]
    label = argv[1]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    # Neutral background
    world = bpy.data.worlds.new("CaptureWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.18, 0.18, 0.18, 1.0)
        bg.inputs["Strength"].default_value = 1.0
    scene.world = world

    # Import the GLB
    bpy.ops.import_scene.gltf(filepath=glb_path)
    imported = bpy.context.selected_objects
    if not imported:
        print(f"ERROR: no objects imported from {glb_path}")
        sys.exit(1)

    # Find the main mesh object (largest by vertex count)
    meshes = [o for o in imported if o.type == 'MESH']
    if not meshes:
        print(f"ERROR: no mesh objects in {glb_path}")
        sys.exit(1)

    # Compute bounding box for camera framing
    import math
    bbox_min = [float('inf')] * 3
    bbox_max = [float('-inf')] * 3
    for obj in meshes:
        for v in obj.data.vertices:
            world_v = obj.matrix_world @ v.co
            for i in range(3):
                bbox_min[i] = min(bbox_min[i], world_v[i])
                bbox_max[i] = max(bbox_max[i], world_v[i])

    center = [(bbox_min[i] + bbox_max[i]) / 2 for i in range(3)]
    size = max(bbox_max[i] - bbox_min[i] for i in range(3))

    # Camera: front view, framing the subject
    cam_data = bpy.data.cameras.new("FrontCam")
    cam_data.lens = 50
    cam_obj = bpy.data.objects.new("FrontCam", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (center[0], center[1] - size * 2.0, center[2])
    cam_obj.rotation_euler = (math.radians(90), 0, 0)  # looking along +Y
    scene.camera = cam_obj

    # Three-point lighting
    for name, loc, energy, color in [
        ("KeyLight", (center[0] - 1, center[1] - 2, center[2] + 2), 300, (1, 0.95, 0.9)),
        ("FillLight", (center[0] + 2, center[1] - 1, center[2] + 1), 150, (0.8, 0.85, 1.0)),
        ("RimLight", (center[0], center[1] + 2, center[2] + 1.5), 200, (1, 1, 1)),
    ]:
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.color = color[:3]
        light_data.size = 2.0
        light_obj = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light_obj)
        light_obj.location = loc

    out_path = os.path.join(OUTPUT_DIR, f"{label}-front_lit.png")
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED: {out_path}")

    # Black-frame guard
    mn, mx = read_png_pixel_extrema(out_path)
    BLACK_MAX_THRESHOLD = 10
    if mx < BLACK_MAX_THRESHOLD:
        raise RuntimeError(
            f"BLACK FRAME: {out_path} has max channel {mx} (threshold {BLACK_MAX_THRESHOLD})"
        )
    print(f"  pixel extrema: min={mn} max={mx} (OK)")

    # Report file size
    sz = os.path.getsize(out_path)
    print(f"  file size: {sz} bytes")


if __name__ == "__main__":
    main()
