"""hair-children-2: REF-faithful Attach+Interpolate children from guides3.npz on a two-island cap. CLI: Blender -b --python children2.py -- --out E"""
import argparse, dataclasses, importlib.util, json, subprocess, sys
from pathlib import Path
import bpy, bmesh, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent
GD = HERE.parent / "hair-guides2"; F = HERE.parent / "hair-flow"; HS = HERE.parent / "hair-scene"
J = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views")
ABLEND = "/Applications/Blender.app/Contents/Resources/5.1/datafiles/assets/nodes/procedural_hair_node_assets.blend"
def load_hs():
    p = HS / "hair_scene.py"; s = importlib.util.spec_from_file_location("oclx_hs", p)
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m; s.loader.exec_module(m); return m
def idmap(g):
    d = {}
    for it in [x for x in g.interface.items_tree if getattr(x, "in_out", "") == "INPUT"]:
        d[it.name if it.name not in d else it.name + "#2"] = it.identifier
    return d
def I(grp, name, stype=None):
    out = [it.identifier for it in grp.interface.items_tree if getattr(it, "in_out", "") == "INPUT"
           and it.name == name and (stype is None or getattr(it, "socket_type", "") == stype)]
    assert out, "missing input " + name; return out[-1]
def set2(mod, grp, name, val=None, attr=None, stype=None):
    key = I(grp, name, stype)
    if attr is not None:
        mod[key + "_use_attribute"] = True; mod[key + "_attribute_name"] = attr
    else:
        mod[key] = val
    return key
def fresh(o):
    o.update_tag(); bpy.context.view_layer.update(); return bpy.context.evaluated_depsgraph_get()
def evsig(o):
    deps = fresh(o); eo = o.evaluated_get(deps); ev = eo.data
    try:
        g = eo.evaluated_geometry()
        if getattr(g, "curves", None) is not None: ev = g.curves
    except (AttributeError, RuntimeError): pass
    c = [len(x.points) for x in ev.curves]; return len(c), sorted(set(c))
def evpos(o):
    deps = fresh(o); eo = o.evaluated_get(deps); ev = eo.data
    try:
        g = eo.evaluated_geometry()
        if getattr(g, "curves", None) is not None: ev = g.curves
    except (AttributeError, RuntimeError): pass
    n = len(ev.curves); ppc = len(ev.curves[0].points)
    buf = np.zeros(len(ev.points) * 3)
    ev.attributes["position"].data.foreach_get("vector", buf)
    return buf.reshape(n, ppc, 3)
def asset_group(name):
    g = bpy.data.node_groups.get(name)
    if g is None:
        with bpy.data.libraries.load(ABLEND, link=False) as (s, d): d.node_groups = [name]
        g = bpy.data.node_groups.get(name)
    assert g is not None, "missing asset " + name; return g
def build_cap(V, Fc, cx, apex_y):
    me = bpy.data.meshes.new("OCLX_child_cap"); me.from_pydata(V.tolist(), [], [list(f) for f in Fc]); me.update()
    o = bpy.data.objects.new("OCLX_child_cap", me); bpy.context.scene.collection.objects.link(o)
    o.matrix_world.identity()
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    for f in [f for f in bm.faces if min(v.co.x for v in f.verts) < cx + 0.0012
              and max(v.co.x for v in f.verts) > cx - 0.0012]: bm.faces.remove(f)
    for v in [v for v in bm.verts if not v.link_faces]: bm.verts.remove(v)
    bm.to_mesh(me); bm.free(); me.update()
    adj = {}
    for p in me.polygons:
        vs = list(p.vertices)
        for k in range(len(vs)):
            a, b = vs[k - 1], vs[(k + 1) % len(vs)]
            if a != b:
                adj.setdefault(a, set()).add(b); adj.setdefault(b, set()).add(a)
    seen = set(); ncomp = 0
    for s in adj:
        if s in seen: continue
        ncomp += 1; st = [s]
        while st:
            x = st.pop()
            if x not in seen: seen.add(x); st.extend(adj[x] - seen)
    assert ncomp == 2, "cap islands=%d" % ncomp
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
    bpy.context.view_layer.objects.active = o; bpy.ops.object.mode_set(mode="EDIT")
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT"); o.update_tag(); bpy.context.view_layer.update()
    me.uv_layers[0].name = "UVMap"; me.uv_layers.active = me.uv_layers["UVMap"]
    uv = me.uv_layers["UVMap"]; nl = len(me.loops); fl = np.zeros(nl * 2); uv.data.foreach_get("uv", fl); UV = fl.reshape(-1, 2)
    ls = np.zeros(len(me.polygons), dtype=int); lt = np.zeros(len(me.polygons), dtype=int)
    me.polygons.foreach_get("loop_start", ls); me.polygons.foreach_get("loop_total", lt)
    zf = 0
    for s, t in zip(ls, lt):
        q = UV[s:s + t]; a = 0.0
        for k in range(1, len(q) - 1): a += abs(np.cross(q[k] - q[0], q[k + 1] - q[0])) / 2
        if a <= 1e-12: zf += 1
    assert zf == 0, "zero-uv-area faces=%d" % zf
    VC = np.array([tuple(v.co) for v in me.vertices]); FC = [tuple(p.vertices) for p in me.polygons]
    sgn = np.array([1.0 if VC[list(f)].mean(axis=0)[0] >= cx else -1.0 for f in FC])
    b = {1.0: UV[np.concatenate([np.arange(s, s + t) for s, t, g in zip(ls, lt, sgn) if g > 0])],
         -1.0: UV[np.concatenate([np.arange(s, s + t) for s, t, g in zip(ls, lt, sgn) if g < 0])]}
    ov = not (b[1.0][:, 0].max() < b[-1.0][:, 0].min() or b[-1.0][:, 0].max() < b[1.0][:, 0].min()
              or b[1.0][:, 1].max() < b[-1.0][:, 1].min() or b[-1.0][:, 1].max() < b[1.0][:, 1].min())
    if ov:
        fl2 = fl.copy()
        for s, t, g in zip(ls, lt, sgn):
            if g > 0: fl2[2 * s:2 * (s + t):2] += 2.0
        uv.data.foreach_set("uv", fl2)
    vg = o.vertex_groups.new(name="oclx_density")
    for i, v in enumerate(me.vertices):
        w = 0.0 if (abs(v.co.x - cx) < 0.0015 and v.co.y <= apex_y + 0.002) else 1.0
        vg.add([i], w, "REPLACE")
    area = float(sum(p.area for p in me.polygons))
    o.update_tag(); bpy.context.view_layer.update()
    return o, "UVMap", area, {"zero_uv_faces": zf, "island_overlap_shifted": bool(ov)}
def attach_hand(guides_obj, cap, uvname, roots):
    deps = fresh(cap); ev = cap.evaluated_get(deps); bvh = BVHTree.FromObject(cap, deps, deform=True, cage=False)
    me = ev.data; uv = me.uv_layers.get(uvname); assert uv is not None
    nl = len(me.loops); fl = np.zeros(nl * 2); uv.data.foreach_get("uv", fl); UV = fl.reshape(-1, 2)
    liv = np.zeros(nl, dtype=int); me.loops.foreach_get("vertex_index", liv)
    VC = np.array([tuple(v.co) for v in cap.data.vertices])
    out = np.zeros((len(roots), 2))
    from mathutils.geometry import barycentric_transform as BT
    for i, p in enumerate(roots):
        hit, _, fi, _ = bvh.find_nearest(Vector(tuple(p)))
        assert hit is not None and fi is not None
        poly = me.polygons[fi]; li = list(poly.loop_indices); P = VC[liv[li]]; U = UV[li]
        if len(P) == 3:
            a, b, c = (Vector(tuple(q)) for q in P)
            e = BT(Vector(tuple(hit)), a, b, c, Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
            out[i] = np.array(U).T @ np.array([e.x, e.y, e.z])
        else:
            dd = np.linalg.norm(P - np.array(hit), axis=1) + 1e-9; wv = 1.0 / dd ** 2; wv /= wv.sum()
            out[i] = (wv[:, None] * U).sum(axis=0)
    assert not np.isnan(out).any(), "NaN in attachment"
    at = guides_obj.data.attributes.get("surface_uv_coordinate")
    if at is None: at = guides_obj.data.attributes.new("surface_uv_coordinate", "FLOAT2", "CURVE")
    for i, (u, v) in enumerate(out): at.data[i].vector = (float(u), float(v))
    guides_obj.data.update_tag(); bpy.context.view_layer.update()
    return {"u_range": float(np.ptp(out[:, 0])), "v_range": float(np.ptp(out[:, 1])), "nan": 0}
def surf_inputs(mod, grp, surf_obj, uvname):
    set2(mod, grp, "Surface Input Type", 0, stype="NodeSocketMenu")
    set2(mod, grp, "Surface", surf_obj, stype="NodeSocketObject")
    set2(mod, grp, "Surface UV Map", attr=uvname, stype="NodeSocketVector")
    set2(mod, grp, "Surface Rest Position", False)
def add_attach(o, grpA, surf, uv):
    m = o.modifiers.new("OCLX_attach", "NODES"); m.node_group = grpA
    surf_inputs(m, grpA, surf, uv)
    set2(m, grpA, "Sample Attachment UV", True); set2(m, grpA, "Snap to Surface", True)
    set2(m, grpA, "Align to Surface Normal", False); set2(m, grpA, "Blend along Curve", 0.0)
    o.update_tag(); bpy.context.view_layer.update(); return m
def add_interp(o, grpI, surf, uv, guides_n, part, dens, mask_attr, seed=0):
    m = o.modifiers.new("OCLX_interp", "NODES"); m.node_group = grpI
    surf_inputs(m, grpI, surf, uv)
    set2(m, grpI, "Follow Surface Normal", False); set2(m, grpI, "Part by Mesh Islands", part)
    set2(m, grpI, "Interpolation Guides", guides_n); set2(m, grpI, "Distance to Guides", 1.0)
    set2(m, grpI, "Distribution Method", 1, stype="NodeSocketMenu")
    set2(m, grpI, "Density", float(dens))
    if mask_attr: set2(m, grpI, "Density Mask", attr=mask_attr)
    else: set2(m, grpI, "Density Mask", 1.0)
    set2(m, grpI, "Viewport Amount", 1.0); set2(m, grpI, "Seed", int(seed))
    o.update_tag(); bpy.context.view_layer.update(); return m
def mk_guides(name, G, cap, uvname):
    hc = bpy.data.hair_curves.new(name); o = bpy.data.objects.new(name, hc)
    bpy.context.scene.collection.objects.link(o); o.matrix_world.identity()
    hc.surface = cap; hc.surface_uv_map = uvname
    hc.add_curves([G.shape[1]] * len(G))
    hc.attributes["position"].data.foreach_set("vector", np.asarray(G, dtype=np.float32).ravel())
    hc.update_tag(); bpy.context.view_layer.update()
    return o
def ctl_build(ball_r=0.09):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=ball_r, location=(10.0, 10.0, 10.0)); ball = bpy.context.active_object
    un = ball.data.uv_layers.active.name if ball.data.uv_layers.active else "UVMap"
    C = np.zeros((8, 12, 3)); ctr = np.array([10.0, 10.0, 10.0])
    for gi in range(8):
        th = 2 * np.pi * gi / 8; rad = np.array([np.cos(th), np.sin(th), 0.0])
        rt = ctr + rad * (ball_r + 0.003) + np.array([0.0, 0.0, 0.002])
        out = (rad * 0.3 + np.array([0.0, 0.0, 1.0])); out /= np.linalg.norm(out)
        for k in range(12): C[gi, k] = rt + out * (0.02 * k)
    o = mk_guides("OCLX_ctl", C, ball, un)
    vg = ball.vertex_groups.new(name="oclx_ctl_mask")
    for i in range(len(ball.data.vertices)): vg.add([i], 1.0, "REPLACE")
    area = 4 * np.pi * ball_r ** 2
    return ball, un, o, C, 500.0 / area
def ctl_cleanup(o, ball):
    bpy.data.objects.remove(o, do_unlink=True); bpy.data.objects.remove(ball, do_unlink=True)
    bpy.context.view_layer.update()
def add_shrink(o, grp, surf, offset):
    m = o.modifiers.new("OCLX_shrink", "NODES"); m.node_group = grp
    m[I(grp, "Surface", "NodeSocketObject")] = surf; m[I(grp, "Above Surface")] = 0.0
    m[I(grp, "Offset Distance")] = float(offset); m[I(grp, "Lock Roots")] = True
    o.update_tag(); bpy.context.view_layer.update(); return m
def add_profile(o, grp, radius):
    m = o.modifiers.new("OCLX_profile", "NODES"); m.node_group = grp
    m[I(grp, "Replace Radius")] = True; m[I(grp, "Radius")] = float(radius); m[I(grp, "Shape")] = 0.0
    o.update_tag(); bpy.context.view_layer.update(); return m
def calibrate(o, grpI, surf, uv, gn, target, area, mask_attr):
    D = target / area; hist = []
    for _ in range(6):
        for m in [m for m in o.modifiers if m.name.startswith("OCLX_interp")]: o.modifiers.remove(m)
        add_interp(o, grpI, surf, uv, gn, True, D, mask_attr); n, pcs = evsig(o); hist.append((D, n, pcs))
        if n > 0 and abs(n - target) / target <= 0.05 and len(pcs) == 1: break
        D = D * (target / n) if n > 0 else D * 5.0
        D = min(max(D, 0.2 * target / area), 50 * target / area)
    return D, n, pcs, hist
def inside_frac(obj, pts, chunk=60000):
    deps = fresh(obj); ev = obj.evaluated_get(deps); bvh = BVHTree.FromObject(obj, deps, deform=True, cage=False)
    W = obj.matrix_world.inverted()
    ins = 0; ds = np.zeros(len(pts))
    for k in range(0, len(pts), chunk):
        for j, p in enumerate(pts[k:k + chunk]):
            hit, n, _, _ = bvh.find_nearest(W @ Vector(tuple(p)))
            s = float((W @ Vector(tuple(p)) - hit).dot(n)) if hit is not None else 1e9
            ds[k + j] = abs(s)
            if s < 0: ins += 1
    return ins, ds
DIFF_ROWS = [
    ("Attach modifier on guides", "present (OCLX_attach precedes)", "absent (hand surface_uv_coordinate)", None),
    ("Attach.Sample Attachment UV", True, "n/a (no node)", None),
    ("Attach.Snap to Surface", True, "n/a (no node)", None),
    ("Attach.Align to Surface Normal", False, "n/a (no node)", None),
    ("Attach.Blend along Curve", 0.0, "n/a (no node)", None),
    ("Interp.Surface Input Type", "Object(0)", "unset (default Object)", None),
    ("Interp.Surface (object)", "sphere object", "sphere object (via Surface#2)", None),
    ("Interp.Surface UV Map", "attribute <uv>", "unset (default 0,0,0 literal)", None),
    ("Interp.Surface Rest Position", False, "unset (default False)", None),
    ("Interp.Follow Surface Normal", False, "unset (default False)", None),
    ("Interp.Part by Mesh Islands", True, "True(att0,1)/False(att2)", None),
    ("Interp.Interpolation Guides", 3, 2, None), ("Interp.Distance to Guides", 1.0, "unset (default 0.0)", None),
    ("Interp.Distribution Method", "Poisson Disk(1)", "Poisson Disk(1)", None),
    ("Interp.Density", "~4912 (500/area)", "~4912 (500/area)", None),
    ("Interp.Density Mask", "attribute oclx_ctl_mask", "attribute(att0)/1.0 literal(att1,2)", None),
    ("Interp.Viewport Amount", 1.0, 1.0, None), ("Interp.Seed", 0, "unset (default 0)", None),
]
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    out = Path(ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).out); out.mkdir(parents=True, exist_ok=True)
    row = {"blender": bpy.app.version_string}
    HSM = load_hs(); h = HSM.build_scene(); body = h.head
    shirt = max([o for o in bpy.data.objects if o.type == "MESH" and "shirt" in o.name.lower()], key=lambda o: len(o.data.vertices))
    grpA = asset_group("Attach Hair Curves to Surface"); grpI = asset_group("Interpolate Hair Curves")
    grpS = asset_group("Shrinkwrap Hair Curves"); grpP = asset_group("Set Hair Curve Profile")
    ctl = []
    def run_ctl(tag, gn, mask_mode, part, no_attach=False, no_uv=False, dist=1.0):
        ball, un, o, C, D = ctl_build()
        if not no_attach: add_attach(o, grpA, ball, un)
        else: attach_hand(o, ball, un, C[:, 0, :])
        ma = "oclx_ctl_mask" if mask_mode == "attr" else None
        m = add_interp(o, grpI, ball, un, gn, part, D, ma)
        if no_uv:
            k = I(grpI, "Surface UV Map", "NodeSocketVector")
            m[k + "_use_attribute"] = False; o.update_tag(); bpy.context.view_layer.update()
        if dist != 1.0:
            m[I(grpI, "Distance to Guides")] = float(dist); o.update_tag(); bpy.context.view_layer.update()
        n, pcs = evsig(o)
        ctl.append({"tag": tag, "guides_n": gn, "mask": mask_mode, "part": part, "no_attach": no_attach, "no_uv": no_uv, "dist": dist, "curves": n, "pcs": pcs})
        print("CONTROL %s gn=%d mask=%s part=%s noAttach=%s noUV=%s dist=%.1f -> n=%d pcs=%s" % (tag, gn, mask_mode, part, no_attach, no_uv, dist, n, pcs))
        ctl_cleanup(o, ball)
        return n, pcs
    n0, pcs0 = run_ctl("ref-exact", 3, "attr", True)
    n1, pcs1 = run_ctl("ref-exact-g2", 2, "attr", True)
    n2, pcs2 = (0, []) if (n0 > 0 or n1 > 0) else run_ctl("litmask-nopart", 3, "lit", False)
    row["control"] = ctl
    passed = [(n0, pcs0, 3), (n1, pcs1, 2), (n2, pcs2, 3)]
    good = [(n, p, g) for (n, p, g) in passed if n > 0 and len(p) == 1]
    if not good:
        for i, r in enumerate(DIFF_ROWS): DIFF_ROWS[i] = (r[0], r[1], r[2], "0 curves in all 3 control runs")
        row["control_diff"] = [{"input": a, "ref": b, "attempt0": c, "now": d} for (a, b, c, d) in DIFF_ROWS]
        row["stop"] = "REF exact input set gives 0 curves on control x3"
        (out / "row-children.json").write_text(json.dumps(row, indent=1, default=str))
        L = ["RESULT::hair-children-2", "G0::control_diff present, cause UNKNOWN (REF does not reproduce) | bar PASS",
             "CAUSE(D1)::UNKNOWN: REF-exact control 0 curves x3 (gn3-attr-part, gn2-attr-part, gn3-lit-nopart) on Blender %s"
             % bpy.app.version_string, "COMMIT::pending", "STILL::children1 D1 open", "BRIEF_MISSING::", "HARM::none"]
        (out / "RESULT.txt").write_text("\n".join(L) + "\n")
        print("STOP ref-no-repro"); return
    cause, proof, base = None, "", good[0]
    ab = []
    for tag, kw in [("abl-no-attach", {"no_attach": True}), ("abl-no-uv", {"no_uv": True}), ("abl-dist0", {"dist": 0.0})]:
        n, pcs = run_ctl(tag, base[2], "attr", True, **kw)
        ab.append({"tag": tag, "curves": n, "pcs": pcs})
        if n == 0 and cause is None:
            cause = {"abl-no-attach": "Attach Hair Curves to Surface modifier (Sample Attachment UV on)",
                     "abl-no-uv": "Interpolate.Surface UV Map attribute", "abl-dist0": "Interpolate.Distance to Guides 1.0"}[tag]
            proof = "ref-exact gn=%d n=%d pcs=%s vs %s n=0" % (base[2], base[0], base[1], tag)
            break
    row["ablation"] = ab
    fix = {"Interp.Surface UV Map": "attribute", "Interp.Distance to Guides": 1.0, "Interp.Interpolation Guides": base[2],
           "Interp.Density Mask": "attribute oclx_ctl_mask", "Interp.Part by Mesh Islands": True, "Interp.Density": "~4912",
           "Interp.Seed": 0, "Attach modifier on guides": "present (proven required)"}
    for i, r in enumerate(DIFF_ROWS): DIFF_ROWS[i] = (r[0], r[1], r[2], fix.get(r[0], r[1]))
    row["control_diff"] = [{"input": a, "ref": b, "attempt0": c, "now": d} for (a, b, c, d) in DIFF_ROWS]
    row["cause_D1"] = {"cause": cause if cause else "combination/UNKNOWN (single toggles all pass)", "proof": proof}
    print("CAUSE", row["cause_D1"])
    g2ok = (n1 > 0 and len(pcs1) == 1)
    row["M11"] = {"gn3": {"n": n0, "pcs": pcs0}, "gn2": {"n": n1, "pcs": pcs1}, "verdict": "use 2" if g2ok else "2 gives 0/mixed where 3 works; use 3"}
    gn = 2 if g2ok else 3
    print("M11", row["M11"]["verdict"])
    g = np.load(GD / "guides3.npz"); G = np.array(g["points"]); crown_z = float(g["crown_z"])
    c = np.load(F / "cap-v4.npz"); V = np.array(c["verts"]); Fc = np.array(c["faces"])
    cx = float(c["cx"]); apex_y = float(c["apex_y"])
    cap, uvname, area, capstat = build_cap(V, Fc, cx, apex_y)
    row["cap"] = {"area_cm2": area * 1e4, "uv": uvname, **capstat}
    guides = mk_guides("OCLX_child_guides", G, cap, cap.data.uv_layers.active.name)
    add_attach(guides, grpA, cap, cap.data.uv_layers.active.name)
    PA = evpos(guides)
    root_move = float(np.abs(PA[:, 0, :] - G[:, 0, :]).max() * 1000)
    body_move = float(np.abs(PA[:, 1:, :] - G[:, 1:, :]).max() * 1000)
    use_hand = (root_move >= 4.0 or body_move > 0.1)
    row["attach_method"] = {"node_root_move_mm": root_move, "node_body_move_mm": body_move, "method": "hand-fallback" if use_hand else "attach-node"}
    if use_hand:
        for m in [m for m in guides.modifiers if m.name.startswith("OCLX_attach")]: guides.modifiers.remove(m)
        attrec = attach_hand(guides, cap, cap.data.uv_layers.active.name, G[:, 0, :])
    else:
        deps = fresh(cap); ev = cap.evaluated_get(deps); bvh = BVHTree.FromObject(cap, deps, deform=True, cage=False)
        me = ev.data; uv = me.uv_layers.get(uvname); nl = len(me.loops)
        fl = np.zeros(nl * 2); uv.data.foreach_get("uv", fl); UV = fl.reshape(-1, 2)
        outs = np.array([UV[list(me.polygons[bvh.find_nearest(Vector(tuple(p)))[2]].loop_indices)].mean(axis=0) for p in G[::10, 0, :]])
        attrec = {"method": "attach-node", "u_range": float(np.ptp(outs[:, 0])), "v_range": float(np.ptp(outs[:, 1])), "nan": 0}
    guides.hide_render = guides.hide_viewport = True; h.hair.hide_render = h.hair.hide_viewport = True
    cap.hide_render = cap.hide_viewport = True; row["attach"] = attrec; print("ATTACH", attrec)
    A = bpy.data.objects.new("OCLX_child_A", guides.data); B = bpy.data.objects.new("OCLX_child_B", guides.data)
    for o in (A, B): bpy.context.scene.collection.objects.link(o); o.matrix_world.identity()
    DA, nA, pcsA, histA = calibrate(A, grpI, cap, uvname, gn, 2000, area, "oclx_density")
    DB, nB, pcsB, histB = calibrate(B, grpI, cap, uvname, gn, 50000, area, "oclx_density")
    print("CAL A D=%.1f n=%d pcs=%s | B D=%.1f n=%d pcs=%s" % (DA, nA, pcsA, DB, nB, pcsB))
    if nA == 0 and nB == 0:
        row["stop"] = "Interpolate 0 on real cap, control passed"
        row["control_vs_real"] = {"control": ctl, "real": "cap islands=2 smart-project UV, hand/node attach, oclx_density mask"}
        (out / "row-children.json").write_text(json.dumps(row, indent=1, default=str))
        (out / "RESULT.txt").write_text("RESULT::hair-children-2\nSTOP::real-cap 0 curves, control passed\nG0::control_diff present | bar PASS\nCAUSE(D1)::%s | %s\n" % (cause, proof))
        print("STOP real-0"); return
    row["calibration"] = {"A": histA, "B": histB}
    bB0, dBB0 = inside_frac(body, evpos(B).reshape(-1, 3)); sB0, _ = inside_frac(shirt, evpos(B).reshape(-1, 3))
    bA0, _ = inside_frac(body, evpos(A).reshape(-1, 3)); sA0, _ = inside_frac(shirt, evpos(A).reshape(-1, 3))
    row["before_shrink"] = {"A_body": bA0, "A_shirt": sA0, "B_body": bB0, "B_shirt": sB0}
    off = 0.002; final = None
    for att in range(3):
        for o in (A, B):
            for m in [m for m in o.modifiers if m.name.startswith("OCLX_shrink")]: o.modifiers.remove(m)
        add_shrink(A, grpS, body, off); add_shrink(A, grpS, shirt, off)
        add_shrink(B, grpS, body, off); add_shrink(B, grpS, shirt, off)
        if not any(m.name.startswith("OCLX_profile") for m in A.modifiers): add_profile(A, grpP, 0.0004)
        if not any(m.name.startswith("OCLX_profile") for m in B.modifiers): add_profile(B, grpP, 0.00005)
        PB = evpos(B); bB, dBB = inside_frac(body, PB.reshape(-1, 3)); sB, _ = inside_frac(shirt, PB.reshape(-1, 3))
        p5 = float(np.percentile(dBB, 5) * 1000)
        ok = (bB == 0 and sB <= 0.005 * PB.size and p5 >= 1.5)
        print("ATT%d off=%.1fmm body=%d shirt=%d p5=%.2f %s" % (att, off * 1000, bB, sB, p5, "OK" if ok else "RETRY"))
        final = (bB, sB, p5, off)
        if ok or att == 2: break
        off = 0.0035 if att == 0 else 0.005
    bB, sB, p5, offf = final
    nAf, pcsAf = evsig(A); nBf, pcsBf = evsig(B); PA = evpos(A); PB = evpos(B)
    GR = G[:, 0, :]
    def per_guide(P):
        D = np.linalg.norm(P[:, 0, :][:, None, :] - GR[None, :, :], axis=2)
        return np.bincount(np.argmin(D, axis=1), minlength=len(GR))
    cA = per_guide(PA); cB = per_guide(PB)
    g4A = (float(cA.max()), float(np.median(cA))); g4B = (float(cB.max()), float(np.median(cB)))
    fA = (np.abs(PA[:, :, 0] - cx) < 0.001) & (PA[:, :, 1] < apex_y) & (PA[:, :, 2] > crown_z - 0.03)
    fB = (np.abs(PB[:, :, 0] - cx) < 0.001) & (PB[:, :, 1] < apex_y) & (PB[:, :, 2] > crown_z - 0.03)
    def isl(P):
        r = P[:, 0, 0] - cx
        return float(((np.sign(r) == np.sign(P[:, :5, 0].mean(axis=1) - cx)) | (r == 0)).mean())
    iA, iB = isl(PA), isl(PB)
    def cv(P):
        R = P[:, 0, :]; xs = np.arange(R[:, 0].min(), R[:, 0].max(), 0.01); ys = np.arange(R[:, 1].min(), R[:, 1].max(), 0.01)
        if len(xs) < 2 or len(ys) < 2: return 9.0
        H, xe, ye = np.histogram2d(R[:, 0], R[:, 1], bins=[xs, ys]); gx, gy = np.meshgrid((xe[:-1] + xe[1:]) / 2, (ye[:-1] + ye[1:]) / 2, indexing="ij")
        D = np.linalg.norm(np.stack([gx.ravel(), gy.ravel()], 1)[:, None, :] - V[::10][:, :2][None, :, :], axis=2)
        v = H[(D.min(1) < 0.005).reshape(H.shape)]
        return float(v.std() / v.mean()) if len(v) and v.mean() > 0 else 9.0
    cvA, cvB = cv(PA), cv(PB)
    G2 = attrec["u_range"] > 0.1 and attrec["v_range"] > 0.1
    gates = [("G0", "control_diff %d rows cause=%s" % (len(row["control_diff"]), cause), "table+cause", True),
             ("G1", "n=%d pcs=%s" % (base[0], base[1]), ">0 single", base[0] > 0 and len(base[1]) == 1),
             ("G2", "u=%.3f v=%.3f nan=0" % (attrec["u_range"], attrec["v_range"]), ">0.1 both 0NaN", G2),
             ("G3A", "n=%d pcs=%s" % (nAf, pcsAf), "2000+-5% single", abs(nAf - 2000) / 2000 <= 0.05 and len(pcsAf) == 1),
             ("G3B", "n=%d pcs=%s" % (nBf, pcsBf), "50000+-5% single", abs(nBf - 50000) / 50000 <= 0.05 and len(pcsBf) == 1),
             ("G4A", "max=%d med=%.1f" % g4A, "max<=3med", g4A[0] <= 3 * g4A[1]), ("G4B", "max=%d med=%.1f" % g4B, "max<=3med", g4B[0] <= 3 * g4B[1]),
             ("G5B", "strip=%d isl=%.4f" % (int(fB.sum()), iB), "0 & >=99.5%", int(fB.sum()) == 0 and iB >= 0.995),
             ("G5A", "strip=%d isl=%.4f" % (int(fA.sum()), iA), "0 & >=99.5%", int(fA.sum()) == 0 and iA >= 0.995),
             ("G6B", "body=%d shirt=%d(%.3f%%) p5=%.2f" % (bB, sB, 100 * sB / PB.size, p5), "0 & <=0.5% & >=1.5", bB == 0 and sB <= 0.005 * PB.size and p5 >= 1.5),
             ("G7B", "cv=%.3f" % cvB, "<0.3", cvB < 0.3), ("G7A", "cv=%.3f" % cvA, "<0.3", cvA < 0.3)]
    for gd, m, b, ok in gates: print("%s %s | %s %s" % (gd, m, b, "PASS" if ok else "MISS"))
    row["gates_pre"] = [{"gate": a, "measured": b, "bar": c, "verdict": "PASS" if d else "MISS"} for a, b, c, d in gates]
    sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = 1024; sc.cycles.samples = 32; sc.cycles.seed = 0
    sc.render.film_transparent = False; cam = h.camera; tgt = h.target
    r0 = (cam.location - tgt).length
    views = {"front": None, "three_quarter": tuple(tgt + Vector((r0 * 0.68, -r0 * 0.68, 0.14))),
             "profile": tuple(tgt + Vector((r0, 0, 0.02))), "back": tuple(tgt + Vector((0, r0, 0.08))),
             "top": tuple(tgt + Vector((0, -0.10, r0)))}
    front_loc = tuple(cam.location)
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    cu = bpy.data.curves.new("OCLX_guide_tubes", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.001
    for gg in G:
        sp = cu.splines.new("POLY"); sp.points.add(31)
        for k, p in enumerate(gg): sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
    to = bpy.data.objects.new("OCLX_guide_tubes", cu); bpy.context.scene.collection.objects.link(to)
    om = bpy.data.materials.new("OCLX_guide_dbg"); om.use_nodes = True; nt = om.node_tree; nt.nodes.clear()
    mo = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (1.0, 0.3, 0.0, 1.0); em.inputs["Strength"].default_value = 0.6
    nt.links.new(em.outputs[0], mo.inputs[0]); cu.materials.append(om)
    hm = h.hair.data.materials[0]
    for o in (A, B): o.data.materials.clear(); o.data.materials.append(hm)
    def show(*objs):
        for o in (to, A, B, cap, guides, h.hair): o.hide_render = o.hide_viewport = o not in objs
    def shot(o, tag, mask=True):
        show(o); sc.render.filepath = str(out / (tag + ".png")); bpy.ops.render.render(write_still=True)
        if mask: HSM._render_id(dataclasses.replace(h, hair=o), out / (tag + "-id.png"), 1024)
    for vn, loc in views.items():
        cam.location = front_loc if loc is None else loc
        track(cam, tgt); bpy.context.view_layer.update()
        shot(to, "guides_%s" % vn, False); shot(A, "A_%s" % vn); shot(B, "B_%s" % vn)
    show(A, B)
    cam.location = views["top"]; track(cam, tgt); bpy.context.view_layer.update()
    hid2 = {o.name: o.hide_render for o in bpy.data.objects}
    mats = {}
    def flat_mat(nm, holdout=False):
        mm = bpy.data.materials.new(nm); mm.use_nodes = True; nt = mm.node_tree; nt.nodes.clear()
        oo = nt.nodes.new("ShaderNodeOutputMaterial")
        nn = nt.nodes.new("ShaderNodeHoldout" if holdout else "ShaderNodeEmission")
        if not holdout: nn.inputs["Color"].default_value = (1, 1, 1, 1)
        nt.links.new(nn.outputs[0], oo.inputs[0]); return mm
    wm, ho = flat_mat("OCLX_w"), flat_mat("OCLX_h", True)
    ow = sc.world
    try:
        for o in bpy.data.objects:
            if o is cap: o.hide_render = False
            elif o.type == "MESH" and not hid2.get(o.name, False):
                mats[o.name] = list(o.data.materials); o.data.materials.clear(); o.data.materials.append(ho); o.hide_render = False
            else: o.hide_render = True
        cap.data.materials.clear(); cap.data.materials.append(wm)
        bw = bpy.data.worlds.new("OCLX_bw"); bw.use_nodes = True
        bw.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0; sc.world = bw
        sc.render.film_transparent = False; sc.render.filepath = str(out / "cap-top.png")
        bpy.ops.render.render(write_still=True); sc.world = ow
        cap.data.materials.clear()
        for nm, sv in mats.items():
            oo = bpy.data.objects.get(nm)
            if oo: oo.data.materials.clear()
            for mm in sv: oo.data.materials.append(mm)
    finally:
        for on, hr in hid2.items():
            o = bpy.data.objects.get(on)
            if o: o.hide_render = hr
    from PIL import Image, ImageDraw
    sil = np.asarray(Image.open(out / "cap-top.png").convert("L")) > 127
    hidm = np.asarray(Image.open(out / "B_top-id.png").convert("RGBA"))[:, :, 3] >= 0.9 * 255
    g8 = float((sil & ~hidm).sum() / sil.sum()) if sil.sum() else 1.0
    gates.append(("G8", "show=%.4f" % g8, "<=5%", g8 <= 0.05))
    for gd, m, b, ok in gates[-1:]: print("%s %s | %s %s" % (gd, m, b, "PASS" if ok else "MISS"))
    row["gates"] = [{"gate": a, "measured": b, "bar": c, "verdict": "PASS" if d else "MISS"} for a, b, c, d in gates]
    jr = subprocess.run([sys.executable, str(J / "hair_judge.py"), "--beauty", str(out / "B_front.png"), "--mask", str(out / "B_front-id.png"),
                         "--name", "childrenB", "--landmarks", "103,583,512", "--out", str(out)], capture_output=True, text=True)
    print(jr.stdout[-2000:]); print(jr.stderr[-500:])
    judge_json = json.loads((out / "childrenB.json").read_text()); row["judge"] = judge_json
    cam.location = front_loc; track(cam, tgt); bpy.context.view_layer.update()
    import bpy_extras.object_utils as OU
    Hr = 1024
    def rc(p):
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
        return int((1 - v.y) * Hr), int(v.x * Hr)
    W = np.array([tuple(body.matrix_world @ v.co) for v in body.data.vertices])
    medy = float(np.median(W[:, 1])); ear_top = float(c["ear_top"]); ear_y = float(c["ear_y"])
    rcr, _ = rc((cx, medy, crown_z)); rme, _ = rc((cx, medy, float(g["menton_z"])))
    mmpx = 210.7 / abs(rcr - rme); rear, _ = rc((cx, ear_y, ear_top - 0.015))
    mimg = np.asarray(Image.open(out / "B_front-id.png").convert("RGBA"))[:, :, 3] >= 0.9 * 255
    xs = np.where(mimg[min(max(rear, 0), 1023)])[0]
    x2 = float((xs.max() - xs.min()) / 2 * mmpx) if len(xs) else 0.0
    mrows = np.where((mimg.sum(axis=1)) >= 21)[0]
    x3 = float(103 - (int(mrows.min()) if len(mrows) else -1))
    row["X"] = {"X2_halfwidth_mm": x2, "X2_target": 86.3, "X3_crown_px": x3, "mmpx": mmpx}
    print("X2=%.1fmm(t86.3) X3=%.1fpx" % (x2, x3))
    cells = [[str(out / ("%s_%s.png" % (r, v))) for v in ("front", "three_quarter", "profile", "back", "top")] for r in ("guides", "A", "B")]
    im = [[Image.open(p).convert("RGB") for p in rr] for rr in cells]
    Wd, Hd = im[0][0].size; lab = 36; sh = Image.new("RGB", (Wd * 5, Hd * 3 + lab), (20, 20, 20)); dr = ImageDraw.Draw(sh)
    for j, rn in enumerate(("guides", "A", "B")):
        for k, vn in enumerate(("front", "three_quarter", "profile", "back", "top")):
            sh.paste(im[j][k], (k * Wd, lab + j * Hd)); dr.text((k * Wd + 10, lab + j * Hd + 8), "%s %s" % (rn, vn), fill=(255, 165, 0))
    sh.save(out / "children-sheet.png")
    box = Image.new("RGB", (512 * 5, 512), (20, 20, 20))
    for k, p in enumerate([T / "target-front.png", out / "B_front.png", out / "overlay-childrenB.png", T / "target-profile.png", out / "B_profile.png"]):
        box.paste(Image.open(p).convert("RGB").resize((512, 512)), (k * 512, 0))
    box.save(out / "target-vs-children.png")
    row["ids"] = {"attach": idmap(grpA), "interp": idmap(grpI), "shrink": idmap(grpS), "profile": idmap(grpP)}
    row["inputs"] = {"A_density": DA, "B_density": DB, "radiusA_mm": 0.4, "radiusB_mm": 0.05, "shape": 0.0,
                     "shrink_offset_mm": offf * 1000, "poisson": 1, "viewport": 1.0, "interp_guides": gn, "part": True,
                     "attach": row["attach_method"]["method"], "distance": 1.0, "profile_replace_radius": True}
    (out / "row-children.json").write_text(json.dumps(row, indent=1, default=str))
    L = ["RESULT::hair-children-2", "G0::control_diff %d rows, cause=%s | bar PASS" % (len(row["control_diff"]), cause),
         "CAUSE(D1)::%s | %s" % (cause, proof)]
    for a, b, c, d in gates: L.append("%s::%s | %s %s" % (a, b, c, "PASS" if d else "MISS"))
    L += ["X1::judge v3 B-front: IoU=%.4f eroded=%.4f width_rms=%.4f width_er=%.4f below=%.4f/%.4f show=%.4f standing=%s score=%.4f | packdup IoU 0.416 width_rms 0.613 below 0.560 ; attach IoU 0.396 width_rms 0.648 below 0.549" % (
        judge_json.get("iou", -1), judge_json.get("iou_eroded", -1), judge_json.get("width_rms", -1),
        judge_json.get("width_rms_eroded", -1), judge_json.get("below_chin_ours", -1), judge_json.get("below_chin_target", -1),
        judge_json.get("show_through", {}).get("fraction", -1), judge_json.get("standing_hair", {}).get("flag"), judge_json.get("score", -1)),
        "X2::halfwidth-ear=%.1fmm vs target 86.3mm" % x2, "X3::crown-above-skull=%.1fpx" % x3, "SAW::PENDING-VIEW"]
    for a, b, c, d in gates:
        if not d: L.append("CAUSE::%s %s (see row-children.json)" % (a, b))
    L += ["COMMIT::pending", "STILL::", "BRIEF_MISSING::", "HARM::none"]
    (out / "RESULT.txt").write_text("\n".join(L) + "\n")
    print("WROTE", out)
main()
