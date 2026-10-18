"""GLB inventory probe for the eye-realism bisect (factor 5 + factor 2 setup).

Lists meshes, materials, images and occlusion-shell markers without
rendering. Usage:
  blender --background --python <this> -- --glb <abs.glb> --out <json>
"""
import json
import sys
from pathlib import Path


def argv_map():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {}
    i = 0
    while i < len(raw):
        if raw[i].startswith("--") and i + 1 < len(raw):
            out[raw[i][2:]] = raw[i + 1]
            i += 2
        else:
            i += 1
    return out


ARGS = argv_map()
GLB = ARGS["glb"]
OUT = Path(ARGS["out"])

import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

bpy.ops.import_scene.gltf(filepath=GLB)
bpy.context.view_layer.update()

meshes = []
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    mats = []
    for m in o.data.materials:
        if m is None:
            mats.append(None)
            continue
        imgs = []
        if m.use_nodes and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image is not None:
                    imgs.append({"name": n.image.name, "size": list(n.image.size)})
        mats.append({"name": m.name, "images": imgs})
    meshes.append({
        "object": o.name,
        "verts": len(o.data.vertices),
        "materials": mats,
        "hide_render": bool(o.hide_render),
        "visible": bool(o.visible_get()),
    })

images = [{"name": i.name, "size": list(i.size)} for i in bpy.data.images]

shell_markers = [
    m["object"] for m in meshes
    if any(k in m["object"].lower() for k in ("shell", "occlu", "shadowcatch", "sclera-shell"))
]

rec = {
    "glb": GLB,
    "meshes": sorted(meshes, key=lambda m: m["object"]),
    "imageCount": len(images),
    "images": sorted(images, key=lambda i: i["name"]),
    "shellMarkers": shell_markers,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(rec, indent=1) + "\n")
print("INVENTORY_DONE " + str(OUT) + f" meshes={len(meshes)} shellMarkers={shell_markers}")
