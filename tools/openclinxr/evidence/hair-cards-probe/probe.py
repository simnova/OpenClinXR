"""Hair probe arm C v3: ribbon cards along 252 guides + Aisha head render (Blender 5.1).

Setup (headless): MPFB addon, default macro dict, setup/apply hair operators.
Cards: own GeometryNodeTree OCLX_ribbon: resample Count SEG+1, store u, line
profile width W, store v, Curve to Mesh, store UVMap. Guides only (252).
After exporting cards: import shipped textured Aisha GLB for head render.
"""
import argparse, hashlib, json, os, tempfile, traceback

R = "tools/openclinxr/evidence/hair-cards-probe"
SEG = 10
W = 0.02
STAGES = ("setup", "apply", "cards", "export", "count")
stage = "setup"

def cur_stage():
    return stage

def fail(out_dir, err, extra=None):
    ex = extra or {}
    rep = {"arms": {"C": {"ok": False, "error": err,
        "strandCountBefore": ex.get("strandCountBefore", 0),
        "strandCountAfter": ex.get("strandCountAfter", 0),
        "hairTriangleCount": ex.get("hairTriangleCount", 0),
        "glbPath": R + "/arm-c.glb", "glbSha256": "0" * 64,
        "bodySha256": ex.get("bodySha256", "0" * 64),
        "headPng": R + "/arm-c-head.png",
        "guideCount": ex.get("guideCount", 0),
        "segments": SEG,
        "cardCount": ex.get("cardCount", 0),
        "bytes": 0,
        "uvAttributeStored": False,
        "read": ex.get("read", "Negative result: ribbon cards could not be generated headless. This PNG is not lab evidence.")}},
        "bodySha256": ex.get("bodySha256", "0" * 64),
        "stage": cur_stage(),
        "blenderVersion": ex.get("blenderVersion", "unknown"),
        "cardCount": ex.get("cardCount", 0), "trisPerCard": ex.get("trisPerCard", 0),
        "cardBboxM": ex.get("cardBboxM", [0, 0, 0]), "headBboxM": ex.get("headBboxM", [0, 0, 0]),
        "withDuplicate": ex.get("withDuplicate", {"cardCount": 0, "trisPerCard": 0}),
        "render": {"engine": "EEVEE"}}
    try:
        import bpy
        rep["blenderVersion"] = bpy.app.version_string
    except Exception:
        pass
    with open(os.path.join(out_dir, "arm-c.json"), "w") as h:
        json.dump(rep, h, indent=1)
    print(err[:2000])

def build_ribbon_tree():
    import bpy
    ng = bpy.data.node_groups.new("OCLX_ribbon", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N = lambda t: ng.nodes.new(t)
    gi = N("NodeGroupInput"); go = N("NodeGroupOutput")
    rs = N("GeometryNodeResampleCurve")
    sp = N("GeometryNodeSplineParameter")
    su = N("GeometryNodeStoreNamedAttribute")
    ln = N("GeometryNodeCurvePrimitiveLine")
    spv = N("GeometryNodeSplineParameter")
    sv = N("GeometryNodeStoreNamedAttribute")
    c2m = N("GeometryNodeCurveToMesh")
    nu = N("GeometryNodeInputNamedAttribute")
    nv = N("GeometryNodeInputNamedAttribute")
    cx = N("ShaderNodeCombineXYZ")
    uv = N("GeometryNodeStoreNamedAttribute")
    for n in ng.nodes:
        print("NODE %s inputs=%s outputs=%s" % (
            n.bl_idname,
            [s.name for s in n.inputs] if hasattr(n, "inputs") else [],
            [s.name for s in n.outputs] if hasattr(n, "outputs") else []))
    try:
        rs.inputs["Mode"].default_value = "Count"
    except Exception as e:
        print("resample-mode-socket-fallback: %s" % e)
    rs.inputs["Count"].default_value = SEG + 1
    su.data_type = "FLOAT"; su.domain = "POINT"
    try:
        su.inputs["Name"].default_value = "u"
    except Exception as e:
        print("store-u-name-fallback: %s" % e)
    ln.mode = "POINTS"
    try:
        ln.inputs["Start"].default_value = (-W / 2, 0, 0)
        ln.inputs["End"].default_value = (W / 2, 0, 0)
    except Exception as e:
        print("line-endpoints-fallback: %s" % e)
    sv.data_type = "FLOAT"; sv.domain = "POINT"
    try:
        sv.inputs["Name"].default_value = "v"
    except Exception as e:
        print("store-v-name-fallback: %s" % e)
    nu.data_type = "FLOAT"
    try:
        nu.inputs["Name"].default_value = "u"
    except Exception as e:
        print("named-u-fallback: %s" % e)
    nv.data_type = "FLOAT"
    try:
        nv.inputs["Name"].default_value = "v"
    except Exception as e:
        print("named-v-fallback: %s" % e)
    uv.data_type = "FLOAT2"; uv.domain = "CORNER"
    try:
        uv.inputs["Name"].default_value = "UVMap"
    except Exception as e:
        print("store-uv-name-fallback: %s" % e)
    L = ng.links.new
    def sock(node, names, io):
        coll = node.inputs if io == "in" else node.outputs
        for nm in names:
            if nm in coll:
                return coll[nm]
        raise RuntimeError("socket none of %s on %s (have %s)" % (
            names, node.bl_idname, [s.name for s in coll]))
    L(sock(gi, ["Geometry"], "out"), sock(rs, ["Curve"], "in"))
    L(sock(rs, ["Curve"], "out"), sock(su, ["Geometry"], "in"))
    L(sock(sp, ["Factor"], "out"), sock(su, ["Value"], "in"))
    L(sock(ln, ["Curve"], "out"), sock(sv, ["Geometry"], "in"))
    L(sock(spv, ["Factor"], "out"), sock(sv, ["Value"], "in"))
    L(sock(su, ["Geometry"], "out"), sock(c2m, ["Curve"], "in"))
    prof = None
    for nm in ["Profile Curve", "Profile", "profile"]:
        if nm in c2m.inputs:
            prof = c2m.inputs[nm]
            break
    if prof is None:
        raise RuntimeError("no profile input on CurveToMesh (have %s)" % [s.name for s in c2m.inputs])
    L(sock(sv, ["Geometry"], "out"), prof)
    L(sock(c2m, ["Mesh"], "out"), sock(uv, ["Geometry"], "in"))
    L(sock(nu, ["Attribute"], "out"), sock(cx, ["X"], "in"))
    L(sock(nv, ["Attribute"], "out"), sock(cx, ["Y"], "in"))
    L(sock(cx, ["Vector"], "out"), sock(uv, ["Value"], "in"))
    L(sock(uv, ["Geometry"], "out"), sock(go, ["Geometry"], "in"))
    return ng

def cards_from_curves(curves_obj, ng):
    import bpy
    bpy.ops.object.select_all(action="DESELECT")
    curves_obj.select_set(True)
    bpy.context.view_layer.objects.active = curves_obj
    bpy.ops.object.duplicate()
    dup = bpy.context.view_layer.objects.active
    mod = dup.modifiers.new("OCLX_ribbon_mod", "NODES")
    mod.node_group = ng
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    dup.select_set(True)
    bpy.context.view_layer.objects.active = dup
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active

def mesh_stats(o):
    me = o.data
    tris = sum(2 if len(p.vertices) == 4 else 1 for p in me.polygons if len(p.vertices) >= 3)
    n = len(me.polygons)
    return tris, n, tris / max(n, 1), [o.dimensions.x, o.dimensions.y, o.dimensions.z]

def main(argv):
    global stage
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=R)
    args = ap.parse_args(argv)
    out_dir = args.out_dir
    extra = {}
    try:
        import bpy
        stage = "setup"
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
        from bl_ext.user_default.mpfb.services.humanservice import HumanService
        from bl_ext.user_default.mpfb.services.targetservice import TargetService
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        macros = TargetService.get_default_macro_info_dict()
        macros.update({"gender": 0.0, "age": 0.6191, "weight": 0.5024, "muscle": 0.5})
        basemesh = HumanService.create_human(mask_helpers=True, detailed_helpers=True,
            extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macros)
        TargetService.bake_targets(basemesh)
        bpy.context.view_layer.update()
        basemesh.name = "Human"
        stage = "apply"
        bpy.ops.object.select_all(action="DESELECT")
        basemesh.select_set(True)
        bpy.context.view_layer.objects.active = basemesh
        bpy.ops.mpfb.setup_hair_operator()
        bpy.ops.mpfb.apply_hair_operator(hair_asset="straight_hair_to_shoulder")
        curves = bpy.context.view_layer.objects.active
        if curves is None or curves.type != "CURVES":
            curves = bpy.data.objects.get("straight_hair_to_shoulder")
        if curves is None or curves.type != "CURVES":
            raise RuntimeError("no curves object after apply_hair_operator")
        bpy.ops.object.select_all(action="DESELECT")
        curves.select_set(True)
        bpy.context.view_layer.objects.active = curves
        bpy.ops.object.duplicate()
        dup_keep = bpy.context.view_layer.objects.active
        for m in list(curves.modifiers):
            print("MOD %s type=%s ng=%s" % (
                m.name, getattr(m, "type", "?"),
                getattr(getattr(m, "node_group", None), "name", "")))
            if getattr(m, "type", "") == "NODES":
                curves.modifiers.remove(m)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        eo = deps.objects.get(curves.name)
        guides = len(eo.data.curves) if eo and eo.data else 0
        extra["strandCountBefore"] = guides
        extra["strandCountAfter"] = guides
        extra["guideCount"] = guides
        stage = "cards"
        ng = build_ribbon_tree()
        cards = cards_from_curves(curves, ng)
        tris, n, tper, bb = mesh_stats(cards)
        uv_stored = "UVMap" in (cards.data.attributes.keys() if hasattr(cards.data, "attributes") else [])
        extra.update({"hairTriangleCount": tris, "cardCount": n,
                      "trisPerCard": tper, "cardBboxM": list(bb),
                      "uvAttributeStored": uv_stored})
        extra["headBboxM"] = [basemesh.dimensions.x, basemesh.dimensions.y, basemesh.dimensions.z]
        try:
            dcards = cards_from_curves(dup_keep, ng)
            dtris, dn, dtper, _ = mesh_stats(dcards)
            extra["withDuplicate"] = {"cardCount": dn, "trisPerCard": dtper}
            bpy.data.objects.remove(dcards, do_unlink=True)
        except Exception as e:
            print("withDuplicate-fallback: %s" % e)
            extra["withDuplicate"] = {"cardCount": 0, "trisPerCard": 0}
        tmp = tempfile.mkdtemp()
        objp = os.path.join(tmp, "body.obj")
        bpy.ops.object.select_all(action="DESELECT")
        basemesh.select_set(True)
        bpy.context.view_layer.objects.active = basemesh
        bpy.ops.wm.obj_export(filepath=objp, export_selected_objects=True)
        body_sha = hashlib.sha256(open(objp, "rb").read()).hexdigest()
        extra["bodySha256"] = body_sha
        stage = "export"
        try:
            hair_mat = bpy.data.materials.new("HairRibbonMat")
            hair_mat.use_nodes = True
            hair_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.12, 0.07, 0.04, 1.0)
            if cards.data.materials:
                cards.data.materials[0] = hair_mat
            else:
                cards.data.materials.append(hair_mat)
        except Exception as e:
            print("material set fallback: %s" % e)
        glb_path = os.path.join(out_dir, "arm-c.glb")
        bpy.ops.object.select_all(action="DESELECT")
        cards.select_set(True)
        bpy.context.view_layer.objects.active = cards
        bpy.ops.export_scene.gltf(filepath=os.path.abspath(glb_path),
                                  export_format="GLB", use_selection=True)
        glb_bytes = os.path.getsize(glb_path)
        if glb_bytes > 500 * 1024:
            raise RuntimeError("arm-c.glb over 500KB: %d bytes" % glb_bytes)
        glb_sha = hashlib.sha256(open(glb_path, "rb").read()).hexdigest()
        stage = "count"
        bpy.ops.object.select_all(action="DESELECT")
        basemesh.select_set(True)
        bpy.context.view_layer.objects.active = basemesh
        bpy.data.objects.remove(basemesh, do_unlink=True)
        bpy.context.view_layer.update()
        aisha = os.path.join(os.getcwd(), "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb")
        bpy.ops.import_scene.gltf(filepath=aisha)
        bpy.context.view_layer.update()
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_EEVEE"
        sc.render.filepath = os.path.abspath(os.path.join(out_dir, "arm-c-head.png"))
        sc.render.resolution_x, sc.render.resolution_y = 1024, 1024
        sc.render.film_transparent = False
        try:
            sc.eevee.taa_render_samples = 32
        except Exception:
            pass
        try:
            sc.world.use_nodes = True
            sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.4
        except Exception as e:
            print("world-strength-fallback: %s" % e)
        sun_d = bpy.data.lights.new("HeadSun", type="SUN")
        sun_d.energy = 3.0
        sun_o = bpy.data.objects.new("HeadSun", sun_d)
        sc.collection.objects.link(sun_o)
        sun_o.location = (-2, -3, 4)
        aisha_objs = [o for o in sc.objects if o.type == "MESH"]
        head_z = 1.45
        try:
            import mathutils
            zs = []
            for o in aisha_objs:
                try:
                    for c in o.bound_box:
                        zs.append((o.matrix_world @ mathutils.Vector(c)).z)
                except Exception:
                    pass
            if zs:
                head_z = max(zs)
        except Exception as e:
            print("head-z-fallback: %s" % e)
        cam_d = bpy.data.cameras.new("HeadCam")
        cam_d.lens = 50
        cam_o = bpy.data.objects.new("HeadCam", cam_d)
        sc.collection.objects.link(cam_o)
        cam_o.location = (0, -0.7, head_z - 0.10)
        dx, dy, dz = 0 - 0, 0 - (-0.7), (head_z - 0.12) - (head_z - 0.10)
        import math
        from mathutils import Vector
        d = Vector((dx, dy, dz))
        q = d.to_track_quat("-Z", "Y")
        cam_o.rotation_euler = q.to_euler()
        sc.camera = cam_o
        bpy.ops.render.render(write_still=True)
        rep = {"arms": {"C": {"ok": True, "error": "",
            "strandCountBefore": guides, "strandCountAfter": guides,
            "hairTriangleCount": tris, "glbPath": R + "/arm-c.glb", "glbSha256": glb_sha,
            "bodySha256": body_sha, "headPng": R + "/arm-c-head.png",
            "guideCount": guides, "segments": SEG,
            "cardCount": n, "bytes": glb_bytes,
            "uvAttributeStored": uv_stored,
            "read": "Ribbon cards along %d guides (segments %d) on shipped Aisha; EEVEE head render. Not lab evidence." % (guides, SEG)}},
            "bodySha256": body_sha, "stage": "count",
            "blenderVersion": bpy.app.version_string,
            "cardCount": n, "trisPerCard": tper,
            "cardBboxM": list(bb), "headBboxM": extra["headBboxM"],
            "withDuplicate": extra["withDuplicate"],
            "render": {"engine": "EEVEE"}}
        with open(os.path.join(out_dir, "arm-c.json"), "w") as h:
            json.dump(rep, h, indent=1)
        print("OK ribbons=%d guides=%d tris=%d stage=count" % (n, guides, tris))
        return 0
    except Exception:
        tb = traceback.format_exc()
        try:
            fail(out_dir, tb, extra)
        except Exception:
            print(tb)
        return 1

if __name__ == "__main__":
    import sys as _s
    _s.exit(main(_s.argv[_s.argv.index("--") + 1:] if "--" in _s.argv else []))
