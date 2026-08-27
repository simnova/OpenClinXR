#!/usr/bin/env python3
"""#641 diag 3: dump EVERY link in the floor material tree (all sockets), group
internals in full, and the baked image's UV-region rows."""
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
nt = floor_mat.node_tree


def dump_tree(tree, indent="  "):
    print(f"{indent}== tree {tree.name!r} ==")
    for node in tree.nodes:
        print(f"{indent}{node.type} {node.name!r}")
        for i in node.inputs:
            if i.is_linked:
                for l in i.links:
                    print(f"{indent}    in  {i.name} <- {l.from_node.name}.{l.from_socket.name}")
        for o in node.outputs:
            if o.is_linked:
                for l in o.links:
                    print(f"{indent}    out {o.name} -> {l.to_node.name}.{l.to_socket.name}")
        if node.type == "GROUP" and node.node_tree:
            dump_tree(node.node_tree, indent + "    ")


print("[diag3] floor material FULL tree:")
dump_tree(nt)

results = rb.bake_materials(1024, True)
row = results[floor_mat.name]
img = bpy.data.images[row["image"]]
w, h = img.size
pix = list(img.pixels)
print("[diag3] baked image rows y=640..1023 (covers UV v 0.0..0.375 region), x every 64:")
for y in range(640, h, 64):
    row_vals = []
    for x in range(0, w, 64):
        i = (y * w + x) * 4
        row_vals.append(f"{round(pix[i] * 255)},{round(pix[i + 1] * 255)},{round(pix[i + 2] * 255)}")
    print(f"  y={y}: " + " ".join(row_vals))
