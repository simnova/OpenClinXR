import argparse
import pathlib
import sys

import bpy


def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.88
    return material


def create_curved_scrub_top():
    material = make_material("openclinxr_local_authored_clinical_teal_cloth", (0.42, 0.68, 0.72, 1.0))
    vertices = []
    rows = [
        (1.38, 0.18, 0.095),
        (1.26, 0.225, 0.125),
        (1.12, 0.255, 0.145),
        (0.98, 0.245, 0.13),
        (0.88, 0.215, 0.10),
    ]
    columns = [-1.0, -0.5, 0.0, 0.5, 1.0]
    for y, half_width, bulge in rows:
        for column in columns:
            x = column * half_width
            z = 0.012 + bulge * (1.0 - abs(column) ** 1.7)
            vertices.append((x, y, z))

    faces = []
    width = len(columns)
    for row in range(len(rows) - 1):
        for col in range(width - 1):
            faces.append((row * width + col, row * width + col + 1, (row + 1) * width + col + 1, (row + 1) * width + col))

    mesh = bpy.data.meshes.new("openclinxr_local_authored_curved_scrub_top_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    garment = bpy.data.objects.new("openclinxr_local_authored_curved_scrub_top", mesh)
    bpy.context.collection.objects.link(garment)
    garment.data.materials.append(material)
    garment.modifiers.new("openclinxr_local_cloth_subdivision", "SUBSURF").levels = 1
    solidify = garment.modifiers.new("openclinxr_local_cloth_thickness", "SOLIDIFY")
    solidify.thickness = 0.014
    garment.modifiers.new("openclinxr_local_cloth_weighted_normals", "WEIGHTED_NORMAL")
    garment["openClinXrGarmentSource"] = "local_authored_no_external_license_dependency"
    garment["openClinXrGarmentSemanticKey"] = "garment:local-authored-curved-clinical-top:adult:teal:v1"
    return garment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    create_curved_scrub_top()
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_yup=True, export_apply=True)


if __name__ == "__main__":
    main()
