"""
Render isolated front_lit captures of tightjeans texture candidates.
Creates a flat UV plane with the texture applied, lit from front,
rendered at 512x512 for comparison.

After each render, reads pixel extrema and RAISEs if the frame is
effectively black (max channel < 10/255). A capture that shows nothing
must fail where it is produced, not reach a grader.

Usage: blender --background --python render-tex-candidates.py
"""
import bpy
import os
import sys
from struct import unpack
from zlib import decompress

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "captures")
os.makedirs(OUTPUT_DIR, exist_ok=True)

CANDIDATES = [
    ("tightjeans-original.png", "original"),
    ("tightjeans-1024.png", "1024"),
    ("tightjeans-512.png", "512"),
    ("tightjeans-2048-q85.jpg", "jpeg-q85"),
]


def read_png_pixel_extrema(png_path: str) -> tuple[int, int]:
    """Read a PNG file and return (min_channel, max_channel) across all
    RGBA pixels.  Handles 8-bit RGBA only (the renders we produce).

    Returns (0, 0) if the file cannot be parsed as a sanity guard.
    """
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

            # Collect IDAT data
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
            stride = 1 + width * channels  # filter byte + pixel data

            mn, mx = 255, 0
            for row_idx in range(height):
                start = row_idx * stride + 1  # skip filter byte
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


def setup_scene():
    """Clear scene and set up a flat plane with front camera + light.

    Fixes applied 2026-09-12 after the original produced all-black frames:
    - Plane rotated 90 deg around X so its normal faces -Y (toward the camera)
      instead of +Z (perpendicular to the camera line of sight).
    - World given a neutral grey background so ambient light is present.
    """
    # Clear everything
    bpy.ops.wm.read_factory_settings(use_empty=True)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    # World with neutral background (fix: scene.world = None removed all light)
    world = bpy.data.worlds.new("TexWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.3, 0.3, 0.3, 1.0)
        bg.inputs["Strength"].default_value = 0.8
    scene.world = world

    # Create a plane — primitive_plane_add puts it in XY with normal +Z.
    # Rotate 90 deg around X so the normal faces -Y (toward camera at -3 on Y).
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "TexPlane"
    plane.rotation_euler = (1.5708, 0, 0)  # 90 deg around X

    # Add camera (front view, looking along +Y toward origin)
    cam_data = bpy.data.cameras.new("FrontCam")
    cam_data.lens = 50
    cam_obj = bpy.data.objects.new("FrontCam", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (0, -3, 0)
    cam_obj.rotation_euler = (1.5708, 0, 0)  # looking along +Y
    scene.camera = cam_obj

    # Add sun light from front
    light_data = bpy.data.lights.new("FrontLight", "SUN")
    light_data.energy = 3.0
    light_obj = bpy.data.objects.new("FrontLight", light_data)
    scene.collection.objects.link(light_obj)
    light_obj.location = (0, -2, 2)
    light_obj.rotation_euler = (1.0, 0, 0)

    return plane


def apply_texture(plane, tex_path):
    """Apply an image texture to the plane's material."""
    mat = bpy.data.materials.new("TexMat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Clear default nodes
    for node in nodes:
        nodes.remove(node)

    # Output node
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (400, 0)

    # Principled BSDF
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    # Image texture
    img_node = nodes.new("ShaderNodeTexImage")
    img_node.location = (-200, 0)
    img = bpy.data.images.load(tex_path)
    img_node.image = img
    links.new(img_node.outputs["Color"], bsdf.inputs["Base Color"])

    # Assign material
    plane.data.materials.clear()
    plane.data.materials.append(mat)


def render_candidate(tex_filename, label):
    """Set up scene and render one texture candidate, then verify the
    frame is not black."""
    plane = setup_scene()
    tex_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), tex_filename)
    apply_texture(plane, tex_path)

    out_path = os.path.join(OUTPUT_DIR, f"tightjeans-{label}.png")
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED: {out_path}")

    # Black-frame guard: read pixel extrema of the written PNG.
    # A capture that shows nothing must fail here, not at grading time.
    mn, mx = read_png_pixel_extrema(out_path)
    BLACK_MAX_THRESHOLD = 10
    if mx < BLACK_MAX_THRESHOLD:
        raise RuntimeError(
            f"BLACK FRAME: {out_path} has max channel value {mx} "
            f"(threshold {BLACK_MAX_THRESHOLD}). The texture did not "
            f"render. Check plane orientation and lighting."
        )
    print(f"  pixel extrema: min={mn} max={mx} (OK)")

    return out_path


if __name__ == "__main__":
    for tex_file, label in CANDIDATES:
        tex_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), tex_file)
        if os.path.exists(tex_path):
            render_candidate(tex_file, label)
        else:
            print(f"SKIP: {tex_path} not found")
