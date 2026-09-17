"""Probe for the garment normalise fix: runs the REAL normalise_garment_texture_luminance.

Loads the real cache shirt PNG onto a material, calls the materializer's function,
and prints one PROBE_JSON line with per-channel mean/std (0-255) before and after.
"""

import json
import sys
from pathlib import Path


def stats(px):
    import numpy as np

    rgb = px[..., :3]
    opaque = px[..., 3] >= 0.5
    sel = rgb[opaque] if opaque.any() else rgb.reshape(-1, 3)
    out = {}
    for i, c in enumerate("rgb"):
        ch = sel[:, i] * 255.0
        out[c] = {"mean": round(float(ch.mean()), 2), "std": round(float(ch.std()), 2)}
    return out


def main() -> None:
    import bpy
    import numpy as np

    repo = Path(__file__).resolve().parents[6]
    sys.path.insert(0, str(repo / "tools/openclinxr/evidence/blender"))
    from materialize_mpfb_humanoid_candidate import normalise_garment_texture_luminance

    png = (
        repo
        / ".openclinxr-local/provider-cache/garments/sources/makehuman-community-scrub-shirt"
        / "Scrubs_Main_BaseColor_Utility - sRGB - Texture.png"
    )
    mat = bpy.data.materials.new("probe_garment_normalise")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes["Principled BSDF"]
    tex_node = nodes.new("ShaderNodeTexImage")
    tex_node.image = bpy.data.images.load(str(png), check_existing=False)
    mat.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])

    w, h = tex_node.image.size
    before_px = np.array(tex_node.image.pixels[:]).reshape(h, w, 4).astype(np.float32)
    before = stats(before_px)
    authored = normalise_garment_texture_luminance(mat, "probe_shirt")
    after_img = tex_node.image
    aw, ah = after_img.size
    after_px = np.array(after_img.pixels[:]).reshape(ah, aw, 4).astype(np.float32)
    after = stats(after_px)
    print("PROBE_JSON " + json.dumps({"before": before, "after": after, "authoredMean": authored}), flush=True)


if __name__ == "__main__":
    main()
