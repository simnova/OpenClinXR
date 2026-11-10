"""Premise probe P1-P3 for groom-r1 (Blender headless). Prints PREM lines."""
import sys
import bpy

ASSETS = bpy.utils.resource_path("LOCAL") + "/datafiles/assets/nodes/procedural_hair_node_assets.blend"
NEED = ["Generate Hair Curves", "Interpolate Hair Curves", "Clump Hair Curves", "Frizz Hair Curves",
        "Trim Hair Curves", "Shrinkwrap Hair Curves", "Attach Hair Curves to Surface"]


def main():
    glb = sys.argv[sys.argv.index("--") + 1]
    with bpy.data.libraries.load(ASSETS, link=False) as (src, dst):
        dst.node_groups = list(src.node_groups)
    names = sorted(n.name for n in bpy.data.node_groups)
    print("ALLGROUPS", names)
    for n in NEED:
        g = bpy.data.node_groups.get(n)
        print("P1", n, g is not None, [(s.name, s.socket_type) for s in g.interface.items_tree if getattr(s, "in_out", None) == "INPUT"] if g else None)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    for o in sorted(bpy.data.objects, key=lambda o: o.name):
        if o.type == "MESH":
            me = o.data
            print("P2OBJ", o.name, len(me.vertices), [u.name for u in me.uv_layers], o.parent.name if o.parent else None,
                  [m.name for m in o.modifiers], tuple(round(x, 3) for x in o.dimensions))
        else:
            print("P2OTHER", o.name, o.type)
    mat = bpy.data.materials.new("h"); mat.use_nodes = True
    n = mat.node_tree.nodes.new("ShaderNodeBsdfHairPrincipled")
    print("P3", [i.identifier for i in n.bl_rna.properties["model"].enum_items], [i.name for i in n.inputs])
    print("P3b parametrization", [i.identifier for i in n.bl_rna.properties["parametrization"].enum_items])


main()
