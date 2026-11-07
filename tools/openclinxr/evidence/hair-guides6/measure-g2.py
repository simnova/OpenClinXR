"""hair-guides-6 helper: G2 vs R5 colliders (head + 3 garments, never basemesh)."""
import importlib.util
import json
import sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
E = HERE


def load_hs():
    p = HERE.parent / "hair-scene" / "hair_scene.py"
    s = importlib.util.spec_from_file_location("oclx_hs", p)
    m = importlib.util.module_from_spec(s)
    sys.modules[s.name] = m
    s.loader.exec_module(m)
    return m


def main():
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    HS = load_hs()
    h = HS.build_scene()
    head = bpy.data.objects.get("OCLX_Aisha_head")
    assert head is not None, "OCLX_Aisha_head missing"
    subs = ("toigo_t_shirt", "tight_jeans", "cloth_shoes")
    garments = []
    for s in subs:
        hit = [o for o in bpy.data.objects
               if o.type == "MESH" and s in o.name]
        assert len(hit) == 1, (s, [o.name for o in hit])
        garments.append(hit[0])
    r5 = [head] + garments
    print("R5 " + json.dumps([o.name for o in r5]))
    assert bpy.data.objects.get("OCLX_collision_basemesh") not in r5
    deps = bpy.context.evaluated_depsgraph_get()

    def bvh_of(obj):
        obj.update_tag()
        bpy.context.view_layer.update()
        return BVHTree.FromObject(obj, deps, deform=True, cage=False)

    bvhs = {o.name: bvh_of(o) for o in r5}
    # fresh evaluated depsgraph after ANY modifier-input change (R3)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    bvhs = {o.name: bvh_of(o) for o in r5}

    g = np.load(str(E / "guides6.npz"))
    P = np.array(g["points"]).reshape(-1, 3)
    inside = 0
    gmin = 1e9
    per = {}
    for p in P:
        s0 = 1e9
        hit_name = None
        for o in r5:
            hit, n, _, _ = bvhs[o.name].find_nearest(Vector(tuple(p)))
            if hit is None:
                continue
            d = np.asarray(p) - np.array(tuple(hit))
            s = float(np.sign(d @ np.array(tuple(n)) + 1e-12)
                      * np.linalg.norm(d))
            if abs(s) < abs(s0):
                s0 = s
                hit_name = o.name
        gmin = min(gmin, abs(s0))
        if s0 < 0:
            inside += 1
            per[hit_name] = per.get(hit_name, 0) + 1
    print("G2R5 inside=%d min=%.2fmm by=%s" % (inside, gmin * 1000.0, per))


main()
