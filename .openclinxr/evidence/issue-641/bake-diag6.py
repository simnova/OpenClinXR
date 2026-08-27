#!/usr/bin/env python3
"""#641 TREATMENT: same bake path, one variable changed — for floor-surface
objects, make the first non-degenerate UV layer active before the bake. Keeps
the distributed light rig. Exports the GLB for post-measurement."""
import sys
import os
import importlib.util

args = sys.argv[sys.argv.index("--") + 1:]
REPO = args[0]
INPUT = args[1]
OUTPUT = args[2]
RESOLUTION = int(args[3]) if len(args) > 3 else 1024
_SPEC = importlib.util.spec_from_file_location(
    "room_albedo_ao_bake",
    os.path.join(REPO, "tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py"),
)
rb = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = rb
assert _SPEC.loader is not None
_SPEC.loader.exec_module(rb)
import bpy  # noqa: E402


def non_degenerate_fraction(mesh):
    """Fraction of triangles with non-zero UV area on the ACTIVE layer."""
    layer = mesh.uv_layers.active
    if layer is None:
        return 0.0
    mesh.calc_loop_triangles()
    total = 0
    ok = 0
    for tri in mesh.loop_triangles:
        uvs = [layer.data[l].uv for l in tri.loops]
        area = abs(
            (uvs[1][0] - uvs[0][0]) * (uvs[2][1] - uvs[0][1])
            - (uvs[1][1] - uvs[0][1]) * (uvs[2][0] - uvs[0][0])
        )
        total += 1
        if area > 1e-6:
            ok += 1
    return ok / total if total else 0.0


rb.clear_scene()
bpy.ops.import_scene.gltf(filepath=INPUT)
bbox = rb.scene_bbox()
rb.setup_scene(bbox, "distributed")

floor_mat = next(m for m in bpy.data.materials if "marble" in m.name and "tile" in m.name)
floor_objs = [
    o for o in bpy.context.scene.objects
    if o.type == "MESH" and o.data.materials and o.data.materials[0] == floor_mat
]

print("[diag6] active UV degeneracy BEFORE treatment:")
for o in floor_objs:
    frac = non_degenerate_fraction(o.data)
    layers = [(u.name, u.active_render) for u in o.data.uv_layers]
    print(f"  {o.name}: non-degenerate frac={frac:.3f} layers={layers}")

# TREATMENT: switch active UV to the first non-degenerate layer AND remove
# degenerate layers so the glTF export writes the good layer as TEXCOORD_0.
for o in floor_objs:
    mesh = o.data
    if non_degenerate_fraction(mesh) < 0.5:
        best = None
        for layer in mesh.uv_layers:
            mesh.uv_layers.active = layer
            if non_degenerate_fraction(mesh) >= 0.5:
                best = layer
                break
        if best is None:
            print(f"  {o.name}: NO non-degenerate layer found — smart-projecting")
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project()
            bpy.ops.object.mode_set(mode="OBJECT")
        else:
            mesh.uv_layers.active = best
            print(f"  {o.name}: active UV -> {best.name}")
    # remove degenerate layers (the export writes layer ORDER, not active-first)
    for layer in list(mesh.uv_layers):
        mesh.uv_layers.active = layer
        if non_degenerate_fraction(mesh) < 0.5:
            mesh.uv_layers.remove(layer)
    # ensure active is the first non-degenerate layer
    for layer in mesh.uv_layers:
        mesh.uv_layers.active = layer
        break

print("[diag6] active UV degeneracy AFTER treatment:")
for o in floor_objs:
    print(f"  {o.name}: non-degenerate frac={non_degenerate_fraction(o.data):.3f} active={o.data.uv_layers.active.name}")

results = rb.bake_materials(RESOLUTION, True)
row = results[floor_mat.name]
print(f"[diag6] treatment floor bake meanL={row['meanL']:.2f}")

rb.wire_textures_to_base_color()
rb.remove_probe_lights()
os.makedirs(os.path.dirname(os.path.abspath(OUTPUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT, export_format="GLB", export_animations=False)
print(f"[diag6] exported {OUTPUT}")
