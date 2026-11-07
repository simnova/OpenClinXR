"""ctl-bisect: control-only Part/mask matrix for hair-children-2 G1 MISS (mixed pcs [1,12]).
CLI: Blender -b --python ctl-bisect.py -- --out E ; writes E/ctl-bisect.json"""
import argparse, json, sys
from pathlib import Path
import bpy, numpy as np
ABLEND = "/Applications/Blender.app/Contents/Resources/5.1/datafiles/assets/nodes/procedural_hair_node_assets.blend"
def I(grp, name, stype=None):
    out = [it.identifier for it in grp.interface.items_tree if getattr(it, "in_out", "") == "INPUT"
           and it.name == name and (stype is None or getattr(it, "socket_type", "") == stype)]
    assert out, "missing " + name; return out[-1]
def set2(mod, grp, name, val=None, attr=None, stype=None):
    key = I(grp, name, stype)
    if attr is not None: mod[key + "_use_attribute"] = True; mod[key + "_attribute_name"] = attr
    else: mod[key] = val
def fresh(o):
    o.update_tag(); bpy.context.view_layer.update(); return bpy.context.evaluated_depsgraph_get()
def evsig(o):
    deps = fresh(o); eo = o.evaluated_get(deps); ev = eo.data
    try:
        g = eo.evaluated_geometry()
        if getattr(g, "curves", None) is not None: ev = g.curves
    except (AttributeError, RuntimeError): pass
    c = [len(x.points) for x in ev.curves]; return len(c), sorted(set(c))
def evroots(o):
    deps = fresh(o); eo = o.evaluated_get(deps); ev = eo.data
    try:
        g = eo.evaluated_geometry()
        if getattr(g, "curves", None) is not None: ev = g.curves
    except (AttributeError, RuntimeError): pass
    n = len(ev.curves); ppc = [len(x.points) for x in ev.curves]
    buf = np.zeros(len(ev.points) * 3); ev.attributes["position"].data.foreach_get("vector", buf)
    return buf.reshape(-1, 3), ppc
def grp(name):
    g = bpy.data.node_groups.get(name)
    if g is None:
        with bpy.data.libraries.load(ABLEND, link=False) as (s, d): d.node_groups = [name]
        g = bpy.data.node_groups.get(name)
    return g
def run(tag, gn, part, mask):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.09, location=(10.0, 10.0, 10.0)); ball = bpy.context.active_object
    un = ball.data.uv_layers.active.name
    C = np.zeros((8, 12, 3)); ctr = np.array([10.0, 10.0, 10.0])
    for gi in range(8):
        th = 2 * np.pi * gi / 8; rad = np.array([np.cos(th), np.sin(th), 0.0])
        rt = ctr + rad * 0.093 + np.array([0.0, 0.0, 0.002]); out = (rad * 0.3 + np.array([0.0, 0.0, 1.0])); out /= np.linalg.norm(out)
        for k in range(12): C[gi, k] = rt + out * (0.02 * k)
    hc = bpy.data.hair_curves.new("OCLX_cb"); o = bpy.data.objects.new("OCLX_cb", hc)
    bpy.context.scene.collection.objects.link(o); o.matrix_world.identity()
    hc.surface = ball; hc.surface_uv_map = un; hc.add_curves([12] * 8)
    hc.attributes["position"].data.foreach_set("vector", np.asarray(C, dtype=np.float32).ravel())
    gA, gI = grp("Attach Hair Curves to Surface"), grp("Interpolate Hair Curves")
    m = o.modifiers.new("OCLX_attach", "NODES"); m.node_group = gA
    set2(m, gA, "Surface Input Type", 0, stype="NodeSocketMenu"); set2(m, gA, "Surface", ball, stype="NodeSocketObject")
    set2(m, gA, "Surface UV Map", attr=un, stype="NodeSocketVector"); set2(m, gA, "Surface Rest Position", False)
    set2(m, gA, "Sample Attachment UV", True); set2(m, gA, "Snap to Surface", True)
    set2(m, gA, "Align to Surface Normal", False); set2(m, gA, "Blend along Curve", 0.0)
    if mask == "attr":
        vg = ball.vertex_groups.new(name="oclx_cb_mask")
        for i in range(len(ball.data.vertices)): vg.add([i], 1.0, "REPLACE")
    m2 = o.modifiers.new("OCLX_interp", "NODES"); m2.node_group = gI
    set2(m2, gI, "Surface Input Type", 0, stype="NodeSocketMenu"); set2(m2, gI, "Surface", ball, stype="NodeSocketObject")
    set2(m2, gI, "Surface UV Map", attr=un, stype="NodeSocketVector"); set2(m2, gI, "Surface Rest Position", False)
    set2(m2, gI, "Follow Surface Normal", False); set2(m2, gI, "Part by Mesh Islands", part)
    set2(m2, gI, "Interpolation Guides", gn); set2(m2, gI, "Distance to Guides", 1.0)
    set2(m2, gI, "Distribution Method", 1, stype="NodeSocketMenu"); set2(m2, gI, "Density", 500.0 / (4 * np.pi * 0.09 ** 2))
    if mask == "attr": set2(m2, gI, "Density Mask", attr="oclx_cb_mask")
    else: set2(m2, gI, "Density Mask", 1.0)
    set2(m2, gI, "Viewport Amount", 1.0); set2(m2, gI, "Seed", 0)
    o.update_tag(); bpy.context.view_layer.update()
    n, pcs = evsig(o); pos, ppc = evroots(o)
    import collections
    hist = dict(collections.Counter(ppc))
    one = [list(pos[i]) for i, c in enumerate(ppc) if c == 1][:5]
    print("BISECT %s gn=%d part=%s mask=%s -> n=%d pcs=%s hist=%s" % (tag, gn, part, mask, n, pcs, hist))
    bpy.data.objects.remove(o, do_unlink=True); bpy.data.objects.remove(ball, do_unlink=True)
    bpy.context.view_layer.update()
    return {"tag": tag, "gn": gn, "part": part, "mask": mask, "curves": n, "pcs": pcs, "hist": hist, "one_pt_roots_sample": one}
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    out = Path(ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).out); out.mkdir(parents=True, exist_ok=True)
    runs = [run("partOff-attr", 3, False, "attr"), run("partOn-lit", 3, True, "lit"), run("partOff-lit", 3, False, "lit")]
    (out / "ctl-bisect.json").write_text(json.dumps({"blender": bpy.app.version_string, "runs": runs}, indent=1, default=str))
main()
