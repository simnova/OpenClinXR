"""Probe collider normal signs + cap/inside geography (fast, no growth)."""
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

def bvh_of(obj, deps):
    obj.update_tag(); bpy.context.view_layer.update()
    return BVHTree.FromObject(obj, deps, deform=True, cage=False)

def main():
    HS = load_hs(); h = HS.build_scene(); body = h.head
    deps = bpy.context.evaluated_depsgraph_get()
    body.update_tag(); bpy.context.view_layer.update()
    W = wpts(body)
    crown = float(W[:, 2].max()); cx = float(np.median(W[W[:, 2] > crown - 0.26][:, 0]))
    medy = float(np.median(W[:, 1]))
    bad = ("eye", "mouth", "teeth", "tooth", "tongue", "lash", "brow", "nail", "hair", "mask", "helper", "glasses", "hat", "cap_")
    cols = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()
            and o is not body and not any(b in o.name.lower() for b in bad)]
    colliders = [body] + cols
    bvhs = {o.name: bvh_of(o, deps) for o in colliders}
    def sdist(p, q, n):
        d = np.asarray(p) - q
        return float(np.sign(d @ n + 1e-12) * np.linalg.norm(d))
    # known-outside far point + known-inside head centre
    far = np.array([cx, medy, crown + 0.5])
    deep = np.array([cx, medy - 0.02, crown - 0.10])
    for p, tag in ((far, "FAR"), (deep, "DEEP")):
        row = []
        for o in colliders:
            hit, n, _, _ = bvhs[o.name].find_nearest(Vector(tuple(p)))
            q = np.array(tuple(hit)); n = np.array(tuple(n))
            row.append("%s:%.1f" % (o.name[:22], sdist(p, q, n) * 1000))
        print("PROBE %s %s" % (tag, " | ".join(row)))
    # cap verts inside each collider?
    F = HERE.parent / "hair-flow"
    cap = np.load(F / "cap-v4.npz")
    V = np.array(cap["verts"])
    for o in colliders:
        bvh = bvhs[o.name]
        inside = 0
        for i in range(0, len(V), 20):
            hit, n, _, _ = bvh.find_nearest(Vector(tuple(V[i])))
            q = np.array(tuple(hit)); n = np.array(tuple(n))
            if sdist(V[i], q, n) < 0: inside += 1
        print("PROBE cap-inside-%s %d/%d" % (o.name[:30], inside, (len(V) + 19) // 20))
    # guides4 inside points: where? (load npz, test vs union with same sdist)
    d = np.load(str(HERE / "guides4.npz"))
    G = np.array(d["points"]); P = np.array(d["phases"])
    n_in = 0; zb = []
    for gi in range(len(G)):
        for k in range(32):
            p = G[gi, k]
            ss = []
            for o in colliders:
                hit, n, _, _ = bvhs[o.name].find_nearest(Vector(tuple(p)))
                q = np.array(tuple(hit)); n = np.array(tuple(n))
                ss.append(sdist(p, q, n))
            if min(ss) < 0:
                n_in += 1; zb.append(float(p[2]))
    zb = np.array(zb)
    print("PROBE guides4-inside=%d zmin=%.3f zmax=%.3f zmean=%.3f" % (
        n_in, float(zb.min()) if len(zb) else -1, float(zb.max()) if len(zb) else -1,
        float(zb.mean()) if len(zb) else -1))
main()
