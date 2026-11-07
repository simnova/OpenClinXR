"""Probe which body the cap matches + visible head identity."""
import importlib.util, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent

def load_hs():
    p = HERE.parent / "hair-scene" / "hair_scene.py"
    s = importlib.util.spec_from_file_location("oclx_hs", p)
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m); return m

def wpts(obj):
    M = obj.matrix_world
    return np.array([tuple(M @ v.co) for v in obj.data.vertices])

def main():
    HS = load_hs(); h = HS.build_scene(); body = h.head
    print("PROBE h.head=%s h.hair=%s target=%s" % (
        body.name, h.hair.name, list(h.target) if hasattr(h, "target") else None))
    for o in bpy.data.objects:
        if o.type == "MESH" and "head" in o.name.lower():
            W = wpts(o)
            print("PROBE headobj=%s verts=%d z=[%.3f,%.3f] render=%s" % (
                o.name, len(W), float(W[:, 2].min()), float(W[:, 2].max()), not o.hide_render))
    deps = bpy.context.evaluated_depsgraph_get()
    F = HERE.parent / "hair-flow"
    cap = np.load(F / "cap-v4.npz")
    V = np.array(cap["verts"])
    for name in ("OCLX_Aisha_head", "mpfb_parent_tara_johnson_v1_body_mesh.low-poly",
                 "OCLX_collision_basemesh"):
        o = bpy.data.objects.get(name)
        if o is None:
            print("PROBE missing %s" % name); continue
        o.update_tag(); bpy.context.view_layer.update()
        bvh = BVHTree.FromObject(o, deps, deform=True, cage=False)
        ds = []
        for i in range(0, len(V), 10):
            hit, n, _, _ = bvh.find_nearest(Vector(tuple(V[i])))
            q = np.array(tuple(hit)); n = np.array(tuple(n))
            d = V[i] - q
            ds.append(float(np.sign(d @ n + 1e-12) * np.linalg.norm(d)))
        ds = np.array(ds)
        print("PROBE cap-vs-%s mean=%+.1fmm abs=%.1fmm inside=%d/%d" % (
            name[:25], float(ds.mean() * 1000), float(np.abs(ds).mean() * 1000),
            int((ds < 0).sum()), len(ds)))
main()
