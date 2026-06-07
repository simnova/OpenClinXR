import argparse
import os
import sys

import bpy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ratio", type=float, default=0.65)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.input)

    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        modifier = obj.modifiers.new("openclinxr_benchmark_decimate", "DECIMATE")
        modifier.ratio = args.ratio
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except Exception:
            obj.modifiers.remove(modifier)
        obj.select_set(False)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.output,
        export_format="GLB",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_skins=True,
        export_morph=True,
        export_animations=True,
        export_apply=False,
    )


if __name__ == "__main__":
    main()
