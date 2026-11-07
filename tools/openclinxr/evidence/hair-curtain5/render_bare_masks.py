"""Render bare-head and body silhouettes through the children front camera."""
from pathlib import Path
import importlib.util
import sys

import bpy

HERE = Path(__file__).resolve().parent
SIZE = 1024


def load_station():
    spec = importlib.util.spec_from_file_location("hair_curtain3_station_masks", HERE / "children_station.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def make_white():
    mat = bpy.data.materials.new("OCLX_bare_mask_white")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    em = mat.node_tree.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1, 1, 1, 1)
    mat.node_tree.links.new(em.outputs[0], out.inputs["Surface"])
    return mat


def render(scene, keep, path, white):
    saved_hide = {o.name: o.hide_render for o in scene.objects}
    saved_mats = {}
    try:
        for obj in scene.objects:
            if obj.type == "MESH":
                obj.hide_render = obj not in keep
                if obj in keep:
                    saved_mats[obj.name] = list(obj.data.materials)
                    obj.data.materials.clear()
                    obj.data.materials.append(white)
            elif obj.type not in ("CAMERA",):
                obj.hide_render = True
        scene.render.film_transparent = True
        scene.render.resolution_x = scene.render.resolution_y = SIZE
        scene.render.resolution_percentage = 100
        scene.cycles.samples = 8
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
    finally:
        for name, mats in saved_mats.items():
            obj = bpy.data.objects.get(name)
            if obj:
                obj.data.materials.clear()
                for mat in mats:
                    obj.data.materials.append(mat)
        for name, hidden in saved_hide.items():
            obj = bpy.data.objects.get(name)
            if obj:
                obj.hide_render = hidden


def main():
    station = load_station()
    c3 = station.import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    station.apply_r4_visibility(handle, None)
    c3.set_final_view(handle, "front")
    bpy.context.view_layer.update()
    scene = bpy.context.scene
    white = make_white()
    render(scene, {handle.head}, HERE / "bare-head-mask.png", white)
    keep = {o for o in scene.objects if o.type == "MESH" and not o.hide_render}
    render(scene, keep, HERE / "bare-body-mask.png", white)
    print("BARE_MASKS", len(keep), flush=True)


if __name__ == "__main__":
    main()
