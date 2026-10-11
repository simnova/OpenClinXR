"""Hair Editor apply branch. --check validates without bpy; missing pack exits 2."""
import json
import os
import sys

RANGES = {
    "length": (0.0, 10.0),
    "density": (0.0, 1.0),
    "thickness": (0.0, 0.003),
    "frizz": (0.0, 1.0),
    "roll": (0.0, 1.0),
    "roll_radius": (0.001, 0.005),
    "roll_length": (0.001, 0.1),
    "clump": (0.0, 1.0),
    "clump_distance": (0.003, 0.05),
    "clump_shape": (-1.0, 1.0),
    "clump_tip_spread": (0.0, 0.02),
    "noise": (0.0, 1.0),
    "noise_distance": (0.0, 0.01),
    "noise_scale": (0.0, 20.0),
    "noise_shape": (0.0, 1.0),
    "curl": (0.0, 1.0),
    "curl_guide_distance": (0.0, 0.1),
    "curl_radius": (0.0, 0.1),
    "curl_frequency": (0.0, 20.0),
    "color_noise_scale": (0.0, 500.0),
    "darken_root": (0.0, 1.0),
    "root_color_length": (0.0, 1.0),
}

SOCKETS = {
    "length": ("Set Hair Curve Profile", "Socket_1"),
    "density": ("Set Hair Curve Profile", "Socket_0"),
    "thickness": ("Set Hair Curve Profile", "Input_3"),
    "frizz": ("Frizz Hair Curves", "Input_3"),
    "roll": ("Roll Hair Curves", "Input_10"),
    "roll_radius": ("Roll Hair Curves", "Input_3"),
    "roll_length": ("Roll Hair Curves", "Input_2"),
    "clump": ("Clump Hair Curves", "Input_7"),
    "clump_distance": ("Clump Hair Curves", "Input_9"),
    "clump_shape": ("Clump Hair Curves", "Input_6"),
    "clump_tip_spread": ("Clump Hair Curves", "Input_10"),
    "noise": ("Hair Curves Noise", "Input_3"),
    "noise_distance": ("Hair Curves Noise", "Input_14"),
    "noise_scale": ("Hair Curves Noise", "Input_11"),
    "noise_shape": ("Hair Curves Noise", "Input_2"),
    "curl": ("Curl Hair Curves", "Input_2"),
    "curl_guide_distance": ("Curl Hair Curves", "Input_4"),
    "curl_radius": ("Curl Hair Curves", "Input_7"),
    "curl_frequency": ("Curl Hair Curves", "Input_11"),
}

ALLOWED_OPERATORS = (
    "mpfb.setup_hair_operator",
    "mpfb.apply_hair_operator",
    "mpfb.apply_fur_operator",
    "mpfb.apply_material_operator",
    "mpfb.delete_hair_operator",
)

SCALP_PREFIX = "DHAI_"
FUR_PREFIX = "DFAI_"

PRIMARY_ASSET = "straight_hair_to_shoulder"
FALLBACK_ASSET = "basic_short_hair"

# Body macros and scale arrive via --macros; no baked-in actor constants.

DEFAULT_SLIDERS = {"length": 3.5, "density": 0.85, "curl": 0.06}

HAIR_NAME_HINTS = ("blunt_bob", "scalp_hair", "scalp-hair")


def clamp_plan_params(plan):
    params = dict(plan.get("params", {}))
    for key, value in list(params.items()):
        if key in ("color1", "color2"):
            if not isinstance(value, list) or len(value) != 4:
                raise ValueError("%s must be RGBA length 4" % key)
            clamped = [min(1.0, max(0.0, float(c))) for c in value]
            clamped[3] = 1.0
            params[key] = clamped
            continue
        if key not in RANGES:
            raise ValueError("unknown slider %s" % key)
        lo, hi = RANGES[key]
        params[key] = min(hi, max(lo, float(value)))
    out = dict(plan)
    out["params"] = params
    return out


def prefix_for(family, asset):
    prefix = FUR_PREFIX if family == "fur" else SCALP_PREFIX
    return "%s%s_%s" % (prefix, asset, "prop")


def _flag_value(argv, flag):
    if flag in argv and argv.index(flag) + 1 < len(argv):
        return argv[argv.index(flag) + 1]
    return None


def _load_plan_values(plan_file):
    values = dict(DEFAULT_SLIDERS)
    if plan_file and os.path.exists(plan_file):
        with open(plan_file, "r", encoding="utf-8") as handle:
            plan = clamp_plan_params(json.load(handle))
        for key in DEFAULT_SLIDERS:
            if key in plan.get("params", {}):
                values[key] = plan["params"][key]
    for key in values:
        lo, hi = RANGES[key]
        values[key] = min(hi, max(lo, float(values[key])))
    return values


def _resolve_inputs(argv):
    plan_file = _flag_value(argv, "--plan")
    macros_file = _flag_value(argv, "--macros")
    out_dir = _flag_value(argv, "--out")
    if not macros_file or not os.path.exists(macros_file):
        print("macros required", file=sys.stderr)
        return 2
    values = _load_plan_values(plan_file)
    with open(macros_file, "r", encoding="utf-8") as handle:
        macros = json.load(handle)
    if not isinstance(macros, dict):
        print("macros required", file=sys.stderr)
        return 2
    scale = macros.get("scale", None)
    if scale is None:
        scale = 0.1
    try:
        scale = float(scale)
    except (TypeError, ValueError):
        print("macros required", file=sys.stderr)
        return 2
    body_macros = {key: value for key, value in macros.items() if key != "scale"}
    print(json.dumps({"values": values, "macros": macros, "scale": scale, "evidenceDir": out_dir}))
    return 0


def _run_apply(argv):
    import bpy

    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    bpy.ops.preferences.addon_enable(module="io_scene_gltf2")

    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    plan_file = _flag_value(argv, "--plan")
    macros_file = _flag_value(argv, "--macros")
    out_dir = _flag_value(argv, "--out")
    if not macros_file or not os.path.exists(macros_file):
        print("macros required")
        return 2
    values = _load_plan_values(plan_file)
    with open(macros_file, "r", encoding="utf-8") as handle:
        macros = json.load(handle)
    if not isinstance(macros, dict):
        print("macros required")
        return 2
    scale = macros.get("scale", None)
    if scale is None:
        scale = 0.1
    try:
        scale = float(scale)
    except (TypeError, ValueError):
        print("macros required")
        return 2
    body_macros = {key: value for key, value in macros.items() if key != "scale"}
    if not out_dir:
        print("macros required")
        return 2

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    basemesh = HumanService.create_human(
        mask_helpers=True, detailed_helpers=True,
        extra_vertex_groups=True, feet_on_ground=True,
        scale=scale, macro_detail_dict=body_macros,
    )
    TargetService.bake_targets(basemesh)
    bpy.context.view_layer.update()
    basemesh.name = "HairEditorBody"
    try:
        from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties
        GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=basemesh)
    except Exception as exc:
        print("object_type set fallback: %s" % exc)
        basemesh["object_type"] = "Basemesh"
        basemesh["MhObjectType"] = "Basemesh"
    bpy.ops.object.select_all(action="DESELECT")
    basemesh.select_set(True)
    bpy.context.view_layer.objects.active = basemesh

    setup_ok = True
    try:
        bpy.ops.mpfb.setup_hair_operator()
    except Exception as exc:
        print("setup failed: %s" % exc)
        setup_ok = False

    hair_asset = PRIMARY_ASSET
    apply_ok = True
    try:
        bpy.ops.mpfb.apply_hair_operator(hair_asset=hair_asset)
    except Exception as exc:
        print("primary asset failed: %s" % exc)
        apply_ok = False
    curves_obj = bpy.context.view_layer.objects.active
    if curves_obj is None or curves_obj.type != "CURVES":
        found = bpy.data.objects.get(hair_asset)
        if found is not None:
            curves_obj = found
    surface_ok = False
    parent_ok = False
    if curves_obj is not None and curves_obj.type == "CURVES":
        try:
            surface_ok = curves_obj.data.surface == basemesh
        except Exception as exc:
            print("surface read failed: %s" % exc)
        parent_ok = curves_obj.parent == basemesh
    print("curves surface is basemesh: %s parented to basemesh: %s" % (surface_ok, parent_ok))

    written = {}
    if curves_obj is not None and curves_obj.type == "CURVES":
        bpy.context.view_layer.objects.active = curves_obj
        for key, val in values.items():
            mod_name, attr = SOCKETS[key]
            modifier = curves_obj.modifiers.get(mod_name)
            if modifier is None:
                continue
            try:
                modifier[attr] = val
                written[key] = val
            except Exception as exc:
                print("socket write failed %s %s: %s" % (mod_name, attr, exc))

    placement = {"checked": False, "surfaceIsBasemesh": surface_ok, "parentedToBasemesh": parent_ok}
    try:
        import mathutils

        world = basemesh.matrix_world
        corners = [world @ mathutils.Vector(c) for c in basemesh.bound_box]
        head_top = max(c.z for c in corners)
        deps = bpy.context.evaluated_depsgraph_get()
        eval_obj = deps.objects.get(curves_obj.name) if curves_obj is not None else None
        pts = []
        if eval_obj is not None:
            for spline in eval_obj.data.curves:
                for p in spline.points:
                    pts.append(eval_obj.matrix_world @ p.position)
        if pts:
            top = max(p.z for p in pts)
            bottom = min(p.z for p in pts)
            placement.update({
                "checked": True,
                "headTopZ": round(head_top, 4),
                "strandTopZ": round(top, 4),
                "strandBottomZ": round(bottom, 4),
                "ignoresSkull": bool(top < head_top - 0.15 or bottom < head_top - 0.6),
            })
    except Exception as exc:
        print("placement check failed: %s" % exc)
        placement["error"] = str(exc)[:300]
    print("strand placement: %s" % placement)

    os.makedirs(out_dir, exist_ok=True)

    tube_ng = bpy.data.node_groups.new("OCLX_hair_tube", "GeometryNodeTree")
    tube_ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tube_ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    tube_in = tube_ng.nodes.new("NodeGroupInput")
    tube_out = tube_ng.nodes.new("NodeGroupOutput")
    resample = tube_ng.nodes.new("GeometryNodeResampleCurve")
    resample.inputs["Mode"].default_value = "Count"
    resample.inputs["Count"].default_value = 8
    ctm = tube_ng.nodes.new("GeometryNodeCurveToMesh")
    profile = tube_ng.nodes.new("GeometryNodeCurvePrimitiveCircle")
    profile.inputs["Resolution"].default_value = 3
    profile.inputs["Radius"].default_value = 0.0022
    tube_ng.links.new(tube_in.outputs[0], resample.inputs["Curve"])
    tube_ng.links.new(resample.outputs[0], ctm.inputs["Curve"])
    tube_ng.links.new(profile.outputs[0], ctm.inputs["Profile Curve"])
    tube_ng.links.new(ctm.outputs[0], tube_out.inputs[0])

    converted = []
    for obj in list(bpy.data.objects):
        if obj.type != "CURVES" or hair_asset not in obj.name:
            continue
        try:
            if obj.name not in bpy.context.view_layer.objects:
                bpy.context.collection.objects.link(obj)
        except Exception as exc:
            print("curves link skipped %s: %s" % (obj.name, exc))
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            tube_mod = obj.modifiers.new("OCLX_hair_tube", "NODES")
            tube_mod.node_group = tube_ng
        except Exception as exc:
            print("tube modifier failed %s: %s" % (obj.name, exc))
            continue
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass
        try:
            bpy.ops.object.convert(target="MESH")
            converted.append(obj.name)
        except Exception as exc:
            print("curves convert failed %s: %s" % (obj.name, exc))
    print("converted curves to mesh: %s" % converted)

    hair_mat = bpy.data.materials.get("OCLX_hair_brown")
    if hair_mat is None:
        hair_mat = bpy.data.materials.new("OCLX_hair_brown")
        hair_mat.use_nodes = True
    hair_mat.use_nodes = True
    nodes = hair_mat.node_tree.nodes
    nodes.clear()
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.117, 0.093, 0.047, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.6
    out = nodes.new("ShaderNodeOutputMaterial")
    hair_mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for obj in list(bpy.data.objects):
        if obj.type != "MESH" or hair_asset not in obj.name:
            continue
        try:
            obj.data.materials.clear()
            obj.data.materials.append(hair_mat)
        except Exception as exc:
            print("hair material assign failed %s: %s" % (obj.name, exc))
    print("hair material: single Principled BSDF (0.117,0.093,0.047) roughness 0.6")

    sibling = os.path.join(out_dir, "hair-editor.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in list(bpy.context.view_layer.objects):
        if obj.type in ("MESH", "CURVES", "ARMATURE"):
            obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=sibling, export_format="GLB", use_selection=True)

    report = {
        "hair_asset": hair_asset,
        "setup_ok": setup_ok,
        "apply_ok": apply_ok,
        "sliders": written,
        "sourceBody": "HumanService.create_human",
        "macros": dict(macros),
        "scale": scale,
        "surfaceIsBasemesh": surface_ok,
        "parentedToBasemesh": parent_ok,
        "strandPlacement": placement,
        "hairMaterial": {"baseColor": [0.117, 0.093, 0.047], "roughness": 0.6},
        "siblingGlb": os.path.join(out_dir, "hair-editor.glb"),
    }
    with open(os.path.join(out_dir, "apply-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps(report))
    return 0 if (setup_ok and apply_ok and surface_ok and parent_ok) else 1


def main(argv):
    if "--resolve-inputs" in argv:
        return _resolve_inputs(argv)
    if "--check" in argv:
        idx = argv.index("--check")
        raw = argv[idx + 1] if idx + 1 < len(argv) else "{}"
        try:
            plan = json.loads(raw)
        except json.JSONDecodeError as exc:
            print("invalid JSON: %s" % exc)
            return 1
        try:
            clamped = clamp_plan_params(plan)
        except ValueError as exc:
            print("invalid: %s" % exc)
            return 1
        print(json.dumps(clamped))
        return 0
    if "--apply" in argv and "bpy" not in sys.modules:
        print("must run under blender")
        return 2
    blend = os.environ.get("OPENCLINXR_HAIR_EDITOR_BLEND", "")
    if not blend or not os.path.exists(blend):
        print("install Hair editor pack")
        return 2
    if "--apply" in argv:
        return _run_apply(argv)
    _ = (ALLOWED_OPERATORS, prefix_for)
    print("hair editor plan only: pass --apply under Blender to render")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
