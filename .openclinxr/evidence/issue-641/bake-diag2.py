#!/usr/bin/env python3
"""#641 diag 2: dump the floor material's FULL node tree (links + group internals)
and sample the baked image in the UV region."""
import sys
import os
import importlib.util

args = sys.argv[sys.argv.index("--") + 1:]
REPO = args[0]
INPUT = args[1]
_SPEC = importlib.util.spec_from_file_location(
    "room_albedo_ao_bake",
    os.path.join(REPO, "tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py"),
)
rb = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = rb
assert _SPEC.loader is not None
_SPEC.loader.exec_module(rb)
import bpy  # noqa: E402

rb.clear_scene()
bpy.ops.import_scene.gltf(filepath=INPUT)
bbox = rb.scene_bbox()
rb.setup_scene(bbox, "distributed")

floor_mat = next(m for m in bpy.data.materials if "marble" in m.name and "tile" in m.name)


def dump_tree(nt, indent="  "):
    for node in nt.nodes:
        ins = ", ".join(
            f"{i.name}:{'LINKED' if i.is_linked else str(list(i.default_value) if hasattr(i.default_value, '__len__') else i.default_value)}"
            for i in node.inputs
            if i.name in ("Base Color", "Color", "Fac", "Alpha", "Image", "UV", "Vector", "Emission", "Emission Strength", "Value")
        )
        outs = ", ".join(
            f"{o.name}{'->' + str([l.to_node.name + '.' + l.to_socket.name for l in o.links]) if o.is_linked else ''}"
            for o in node.outputs
            if o.is_linked or o.name in ("Color", "BSDF", "Alpha")
        )
        print(f"{indent}{node.type} {node.name!r}  in({ins})  out({outs})")
        if node.type == "GROUP":
            dump_tree(node.node_tree, indent + "    ")


print("[diag2] floor material tree:")
dump_tree(floor_mat.node_tree)

# Bake ONLY the floor object; then sample the baked image in the UV region.
results = rb.bake_materials(1024, True)
row = results[floor_mat.name]
print("[diag2] bake row:", {k: v for k, v in row.items() if k != "meshNames"})
img = bpy.data.images[row["image"]]
w, h = img.size
pix = list(img.pixels)
# sample the UV region u:[0,0.375] v:[0,0.639] -> image x:[0,384] y:[0,654]
samples = []
for y in range(0, h, 64):
    for x in range(0, w, 64):
        i = (y * w + x) * 4
        r, g, b = pix[i], pix[i + 1], pix[i + 2]
        samples.append((x, y, round(r * 255), round(g * 255), round(b * 255)))
print("[diag2] baked image samples (x,y,r,g,b):")
for s in samples:
    print("  ", s)
