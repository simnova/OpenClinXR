"""ctl-probe2: distinguish read-artifact vs attach-fail vs interp-fail for mixed pcs.
Reads evaluated hist via evaluated_geometry() AND via evaluated.data; checks attach-only
guide roots; locates 1-pt roots vs sphere. Writes E/ctl-probe2.json"""
import argparse, collections, json, sys
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
def grp(name):
    g = bpy.data.node_groups.get(name)
    if g is None:
        with bpy.data.libraries.load(ABLEND, link=False) as (s, d): d.node_groups = [name]
        g = bpy.data.node_groups.get(name)
    return g
def hist_of(curves_id):
    c = [len(x.points) for x in curves_id]
    npts = sum(c)
    return {"n": len(c), "pcs": sorted(set(c)), "hist": dict(collections.Counter(c)), "pts": npts}
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    out = Path(ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).out); out.mkdir(parents=True, exist_ok=True)
    rep = {"blender": bpy.app.version_string}
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.09, location=(10.0, 10.0, 10.0)); ball = bpy.context.active_object
    un = ball.data.uv_layers.active.name
    C = np.zeros((8, 12, 3)); ctr = np.array([10.0, 10.0, 10.0])
    for gi in range(8):
        th = 2 * np.pi * gi / 8; rad = np.array([np.cos(th), np.sin(th), 0.0])
        rt = ctr + rad * 0.093 + np.array([0.0, 0.0, 0.002]); out3 = (rad * 0.3 + np.array([0.0, 0.0, 1.0])); out3 /= np.linalg.norm(out3)
        for k in range(12): C[gi, k] = rt + out3 * (0.02 * k)
    hc = bpy.data.hair_curves.new("OCLX_cp"); o = bpy.data.objects.new("OCLX_cp", hc)
    bpy.context.scene.collection.objects.link(o); o.matrix_world.identity()
    hc.surface = ball; hc.surface_uv_map = un; hc.add_curves([12] * 8)
    hc.attributes["position"].data.foreach_set("vector", np.asarray(C, dtype=np.float32).ravel())
    vg = ball.vertex_groups.new(name="oclx_cp_mask")
    for i in range(len(ball.data.vertices)): vg.add([i], 1.0, "REPLACE")
    o.update_tag(); bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get(); eo = o.evaluated_get(deps)
    rep["no_mods_geomethod"] = hist_of(eo.evaluated_geometry().curves)
    rep["no_mods_data"] = hist_of(eo.data.curves)
    gA, gI = grp("Attach Hair Curves to Surface"), grp("Interpolate Hair Curves")
    m = o.modifiers.new("OCLX_attach", "NODES"); m.node_group = gA
    set2(m, gA, "Surface Input Type", 0, stype="NodeSocketMenu"); set2(m, gA, "Surface", ball, stype="NodeSocketObject")
    set2(m, gA, "Surface UV Map", attr=un, stype="NodeSocketVector"); set2(m, gA, "Surface Rest Position", False)
    set2(m, gA, "Sample Attachment UV", True); set2(m, gA, "Snap to Surface", True)
    set2(m, gA, "Align to Surface Normal", False); set2(m, gA, "Blend along Curve", 0.0)
    o.update_tag(); bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get(); eo = o.evaluated_get(deps)
    gdata = eo.evaluated_geometry()
    rep["attach_only_geomethod"] = hist_of(gdata.curves)
    rep["attach_only_data"] = hist_of(eo.data.curves)
    buf = np.zeros(len(eo.data.points) * 3); eo.data.attributes["position"].data.foreach_get("vector", buf)
    P = buf.reshape(-1, 3)
    rep["attach_only_root_move_mm"] = float(np.abs(P.reshape(8, 12, 3)[:, 0, :] - C[:, 0, :]).max() * 1000)
    rep["attach_only_bodymove_mm"] = float(np.abs(P.reshape(8, 12, 3)[:, 1:, :] - C[:, 1:, :]).max() * 1000)
    try:
        at = eo.data.attributes.get("surface_uv_coordinate")
        ub = np.zeros(len(eo.data.curves) * 2)
        if at is not None: at.data.foreach_get("vector", ub)
        rep["attach_uv_sample"] = ub.reshape(-1, 2)[:8].tolist()
    except (AttributeError, RuntimeError) as e: rep["attach_uv_sample"] = "ERR %s" % e
    m2 = o.modifiers.new("OCLX_interp", "NODES"); m2.node_group = gI
    set2(m2, gI, "Surface Input Type", 0, stype="NodeSocketMenu"); set2(m2, gI, "Surface", ball, stype="NodeSocketObject")
    set2(m2, gI, "Surface UV Map", attr=un, stype="NodeSocketVector"); set2(m2, gI, "Surface Rest Position", False)
    set2(m2, gI, "Follow Surface Normal", False); set2(m2, gI, "Part by Mesh Islands", True)
    set2(m2, gI, "Interpolation Guides", 3); set2(m2, gI, "Distance to Guides", 1.0)
    set2(m2, gI, "Distribution Method", 1, stype="NodeSocketMenu"); set2(m2, gI, "Density", 500.0 / (4 * np.pi * 0.09 ** 2))
    set2(m2, gI, "Density Mask", attr="oclx_cp_mask")
    set2(m2, gI, "Viewport Amount", 1.0); set2(m2, gI, "Seed", 0)
    o.update_tag(); bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get(); eo = o.evaluated_get(deps)
    rep["both_geomethod"] = hist_of(eo.evaluated_geometry().curves)
    rep["both_data"] = hist_of(eo.data.curves)
    buf = np.zeros(len(eo.data.points) * 3); eo.data.attributes["position"].data.foreach_get("vector", buf)
    Pall = buf.reshape(-1, 3)
    d = np.linalg.norm(Pall - ctr, axis=1)
    rep["both_data_radial_mm"] = {"min": float(d.min() * 1000), "p50": float(np.percentile(d, 50) * 1000), "max": float(d.max() * 1000)}
    rep["both_data_zrange"] = [float(Pall[:, 2].min()), float(Pall[:, 2].max())]
    print("PROBE2 " + json.dumps({k: v for k, v in rep.items() if k != "attach_uv_sample"}, default=str))
    print("PROBE2UV " + json.dumps(rep.get("attach_uv_sample"), default=str))
    (out / "ctl-probe2.json").write_text(json.dumps(rep, indent=1, default=str))
    bpy.data.objects.remove(o, do_unlink=True); bpy.data.objects.remove(ball, do_unlink=True)
main()
