import pathlib

import bpy


OUTPUT = pathlib.Path(".openclinxr-local/provider-cache/charmorph/generated/charmorph-antonia-ob-patient-candidate.glb")


def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.82
    if len(color) == 4 and color[3] < 1:
        material.blend_method = "BLEND"
        material.use_screen_refraction = False
        material.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = color[3]
    return material


def add_box(name, material, location, scale, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    bevel = obj.modifiers.new(f"{name}_softened_edges", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    obj.modifiers.new(f"{name}_weighted_normals", "WEIGHTED_NORMAL")
    if parent is not None:
        obj.parent = parent
    return obj


def add_sphere(name, material, location, scale, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location, scale=scale)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    try:
        bpy.ops.object.shade_smooth()
    except Exception:
        pass
    if parent is not None:
        obj.parent = parent
    return obj


def add_morphing_expression_box(name, material, location, scale, parent=None):
    obj = add_box(name, material, location, scale, parent)
    basis = obj.shape_key_add(name="Basis")
    viseme = obj.shape_key_add(name="viseme_open_or_concern")
    for vertex in viseme.data:
        vertex.co.z *= 1.55
        vertex.co.y -= 0.01
    brow = obj.shape_key_add(name="brow_raise_or_worry")
    for vertex in brow.data:
        vertex.co.z += 0.018
    for frame, value in [(1, 0.0), (24, 0.2), (48, 0.55), (72, 0.15), (96, 0.0)]:
        bpy.context.scene.frame_set(frame)
        viseme.value = value
        brow.value = value * 0.6
        viseme.keyframe_insert(data_path="value", frame=frame)
        brow.keyframe_insert(data_path="value", frame=frame)
    return obj


def add_patient_clinical_wardrobe_and_hair(parent):
    gown = make_material("charmorph_antonia_ob_patient_clinical_gown", (0.36, 0.62, 0.70, 1))
    blanket = make_material("charmorph_antonia_ob_patient_bed_blanket", (0.88, 0.92, 0.94, 1))
    hair = make_material("charmorph_antonia_ob_patient_dark_hair", (0.05, 0.035, 0.025, 1))
    eye = make_material("charmorph_antonia_ob_patient_visible_eye_focus", (0.015, 0.018, 0.02, 0.10))
    lip = make_material("charmorph_antonia_ob_patient_lip_expression_target", (0.38, 0.11, 0.10, 0.10))
    badge = make_material("charmorph_antonia_ob_patient_id_band", (0.95, 0.95, 0.88, 1))

    add_sphere("charmorph_antonia_patient_gown_torso", gown, (0.0, -0.02, 1.22), (0.245, 0.105, 0.34), parent)
    add_sphere("charmorph_antonia_patient_gown_left_sleeve", gown, (-0.245, -0.025, 1.30), (0.075, 0.07, 0.20), parent)
    add_sphere("charmorph_antonia_patient_gown_right_sleeve", gown, (0.245, -0.025, 1.30), (0.075, 0.07, 0.20), parent)
    add_box("charmorph_antonia_patient_lap_blanket", blanket, (0.0, -0.02, 0.83), (0.34, 0.13, 0.11), parent)
    add_box("charmorph_antonia_patient_wrist_band", badge, (0.265, -0.075, 1.08), (0.045, 0.014, 0.018), parent)
    add_sphere("charmorph_antonia_patient_hair_cap", hair, (0.0, -0.035, 1.68), (0.115, 0.095, 0.06), parent)
    for plane, y in [("front", -0.118), ("rear_orientation_safety", 0.118)]:
        add_sphere(f"charmorph_antonia_patient_{plane}_left_eye_focus", eye, (-0.035, y, 1.59), (0.005, 0.003, 0.004), parent)
        add_sphere(f"charmorph_antonia_patient_{plane}_right_eye_focus", eye, (0.035, y, 1.59), (0.005, 0.003, 0.004), parent)
        add_morphing_expression_box(
            f"charmorph_antonia_patient_{plane}_visible_lip_viseme_morph_target",
            lip,
            (0.0, y, 1.555),
            (0.018, 0.004, 0.004),
            parent,
        )


def first_matching_pose_bone(armature, names):
    lower_to_name = {bone.name.lower(): bone.name for bone in armature.pose.bones}
    for name in names:
        match = lower_to_name.get(name.lower())
        if match:
            return armature.pose.bones[match]
    for bone in armature.pose.bones:
        lower = bone.name.lower()
        if any(name.lower() in lower for name in names):
            return bone
    return None


def add_clinical_idle_animation(armature):
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 96
    armature.animation_data_create()
    action = bpy.data.actions.new("ClinicalIdleSpeakingWithBreathConcern")
    armature.animation_data.action = action

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")

    animated_bones = [
        (first_matching_pose_bone(armature, ["head", "neck", "head.x"]), "Z", [0.0, 0.05, -0.035, 0.0]),
        (first_matching_pose_bone(armature, ["spine", "spine1", "chest", "torso"]), "X", [0.0, 0.018, -0.012, 0.0]),
        (first_matching_pose_bone(armature, ["upper_arm.L", "upperarm.l", "arm.L", "shoulder.L"]), "Z", [0.0, -0.10, 0.04, 0.0]),
        (first_matching_pose_bone(armature, ["upper_arm.R", "upperarm.r", "arm.R", "shoulder.R"]), "Z", [0.0, 0.08, -0.06, 0.0]),
    ]

    for frame_index, frame in enumerate([1, 32, 64, 96]):
        bpy.context.scene.frame_set(frame)
        for pose_bone, axis, values in animated_bones:
            if pose_bone is None:
                continue
            pose_bone.rotation_mode = "XYZ"
            if axis == "X":
                pose_bone.rotation_euler.x = values[frame_index]
            if axis == "Y":
                pose_bone.rotation_euler.y = values[frame_index]
            if axis == "Z":
                pose_bone.rotation_euler.z = values[frame_index]
            pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame)

    bpy.ops.object.mode_set(mode="OBJECT")


def add_expression_animation(meshes):
    action = bpy.data.actions.new("ClinicalExpressionBreathConcernTransition")
    for mesh in meshes:
        shape_keys = mesh.data.shape_keys
        if not shape_keys:
            continue
        shape_keys.animation_data_create()
        shape_keys.animation_data.action = action
        animated_keys = [key for key in shape_keys.key_blocks[1:7] if not key.name.lower().startswith("basis")]
        for frame, value in [(1, 0.0), (24, 0.12), (48, 0.22), (72, 0.08), (96, 0.0)]:
            bpy.context.scene.frame_set(frame)
            for key in animated_keys:
                key.value = value
                key.keyframe_insert(data_path="value", frame=frame)


def main():
    bpy.ops.preferences.addon_enable(module="rigify")
    bpy.ops.preferences.addon_enable(module="CharMorph")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.charmorph.reload_library()

    ui = bpy.context.window_manager.charmorph_ui
    ui.base_model = "Antonia"
    result = bpy.ops.charmorph.import_char()
    if result != {"FINISHED"}:
        raise RuntimeError(f"CharMorph Antonia import failed: {result}")

    skin = make_material("charmorph_antonia_skin_simplified_for_export", (0.70, 0.54, 0.44, 1))
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            if obj.name.lower() in {"bra", "panties"}:
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            obj.data.materials.clear()
            obj.data.materials.append(skin)
            obj.name = f"charmorph_antonia_{obj.name}"
    body = next((obj for obj in bpy.context.scene.objects if obj.type == "MESH"), None)

    try:
        bpy.ops.object.select_all(action="DESELECT")
        if body is not None:
            bpy.context.view_layer.objects.active = body
            body.select_set(True)
        bpy.ops.charmorph.rig()
    except Exception as exc:
        print(f"RIGIFY_BLOCKED {type(exc).__name__}: {exc}")

    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is not None:
        armature.name = "charmorph_antonia_clinical_rig"
        add_clinical_idle_animation(armature)
    add_expression_animation([obj for obj in bpy.context.scene.objects if obj.type == "MESH"])
    add_patient_clinical_wardrobe_and_hair(body)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format="GLB", export_animations=True)
    print(f"EXPORTED {OUTPUT}")


if __name__ == "__main__":
    main()
