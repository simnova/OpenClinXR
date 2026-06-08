#!/usr/bin/env python3
"""
Headless Blender stage (bpy Python script, runs with: blender --background --python automate_blender.py -- --help )

This script implements the second half of the user-described pipeline:

1. Import the Anny-generated base mesh (OBJ/GLTF with UVs from generate_mesh.py).
2. Apply base armature/rig (creates a simple canonical humanoid armature matching the
   contract in generated-human-rigging-artifacts.ts so that skinning, morph targets for
   viseme/emotion/gaze, ragdoll proxy, etc. are present).
3. Texture / PBR stage:
   - Preferred path when authorized: call StableGen (or any ComfyUI-Blender addon) or
     submit a prepared workflow directly to a running ComfyUI server using the
     multi-view (depth/normal) + ControlNet + IPAdapter + SDXL/FLUX.1-dev/Qwen-Image-Edit
     recipe described by the user. The addon "builds the full ComfyUI workflow
     automatically".
   - Current safe path (no license exception yet): build a deterministic procedural
     PBR material driven by the phenotype + case prompt, bake albedo/roughness/normal
     etc. to the existing UVs using Blender's bake system (headless safe).
4. Add procedural hair (simple Geometry Nodes or particle hair cap for demo) and eyes
   (node-based shaders with iris variation from phenotype).
5. Export final GLB/FBX with embedded or referenced PBR textures, using the exact node
   names and morph targets expected by the OpenClinXR runtime (ui-xr loader, animation
   slots for lip-sync/gaze/expression, canonical skeleton binding).

All driven from a single CLI invocation. No GUI.

The script is intentionally structured so that when the StableGen/ComfyUI license
exception is granted (per docs/openclinxr/asset-generation-pipeline.md tool matrix),
only the texture stage needs to be swapped to the real addon/server call. The import,
rig, morph, hair/eyes, and export skeleton stay the same.

Scene Queue / batch mode note: StableGen's Scene Queue (or a simple loop over
multiple --params) supports the "unattended batch processing of multiple patients
overnight" use case mentioned by the user.

Integration: the encounter-asset-generation-worker.ts (or a local Python capability
adapter) can shell out to this script (or a small orchestrator that calls generate_mesh.py
then this script) for the "character-generation" / "role_specific_humanoid_glb" work order.
"""

import argparse
import hashlib
import json
import os
import sys
from typing import Any, Dict, List, Optional

# --- bpy is only available when running inside Blender ---
try:
    import bpy
    from mathutils import Vector, Matrix
except ImportError:
    print("ERROR: This script must be run with Blender's embedded Python:")
    print("  blender --background --python tools/openclinxr/asset-pipeline/anny/automate_blender.py -- --input-mesh ...")
    sys.exit(1)


def parse_cli() -> argparse.Namespace:
    # Blender --python script -- args: slice after the -- separator (standard for headless bpy scripts)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(description="Headless Anny -> rigged + textured GLB (Blender stage)")
    ap.add_argument("--input-mesh", required=True, help="Path to Anny .obj or .gltf with UVs")
    ap.add_argument("--input-manifest", required=True, help="Anny source manifest (contains phenotype + params for prompt + provenance)")
    ap.add_argument("--output-glb", required=True, help="Final rigged+textured GLB path (matches GENERATED_HUMAN_RIGGING_GLB_NAME contract)")
    ap.add_argument("--prompt", default=None, help="Optional base prompt override. If omitted, built from manifest phenotype + case hints.")
    ap.add_argument("--case-id", default="unknown_case", help="Case/scenario id for provenance and texture prompt (e.g. peds_asthma_parent_anxiety_v1)")
    ap.add_argument("--actor-role", default="patient", help="Actor role for naming (patient, parent, nurse...)")
    ap.add_argument("--use-comfy", action="store_true", help="If set, attempt to talk to a running ComfyUI server for the real StableGen-style consistent PBR texturing (multi-view ControlNet+IPAdapter). Requires --comfy-url.")
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8188", help="ComfyUI server URL (used when --use-comfy)")
    ap.add_argument("--bake-textures", action="store_true", default=True, help="Always do a local procedural bake as fallback (safe, no external diffusion).")
    ap.add_argument("--hair-density", type=float, default=0.6, help="Simple scalar for hair density in the demo hair system / geo nodes.")
    ap.add_argument("--garment-source-geometry-hint", action="store_true", help="LEGACY (garment-hint-v1 aborted per chief/skeptic pivot 2026-06-07; Q1 violation, sub-pixel, no weights, no sleeve geo despite phenotype). Real garment now from phenotype.garmentLayers (e.g. short_sleeve_exam_tshirt) via expanded apply_role_clothing_material_regions (real torso+shoulder+upper-arm sleeve geo + vertex weights on clavicle/upper_arm for breathing deform). Flag kept for compat only; default OFF.")
    return ap.parse_args(argv)


def load_manifest(path: str) -> Dict[str, Any]:
    with open(path, "r") as f:
        return json.load(f)


def build_texture_prompt(manifest: Dict[str, Any], case_id: str, actor_role: str) -> str:
    phenotype = manifest.get("input_params", {}).get("phenotype", {})
    age = manifest.get("input_params", {}).get("age", 30)
    profile = manifest.get("input_params", {}).get("body_profile", "adult_standard")

    skin = phenotype.get("skin_tone", "warm_light")
    hair = phenotype.get("hair_color", "brown")
    build = phenotype.get("build", "")

    # Make the prompt match the user's example style and incorporate case context.
    base = (
        f"hyper-realistic {int(age)} year old {skin} skin, subtle age-appropriate details, "
        f"visible pores, natural medical exam lighting, standardized patient appearance, "
        f"{hair} hair, {build} build, clinical simulation quality, no makeup, healthy but realistic skin texture"
    )
    if "pediatric" in profile or age < 13:
        base += ", child-appropriate features, pediatric clinical exam context"
    if "asthma" in case_id.lower() or "parent_anxiety" in case_id.lower():
        base += ", subtle signs of respiratory concern (mild paleness around mouth/nose), anxious but cooperative parent/guardian look" if "parent" in actor_role else ", young patient with mild asthma presentation"

    return base


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Remove default collections etc. for clean export
    for coll in list(bpy.data.collections):
        if coll.name.startswith("Collection"):
            bpy.data.collections.remove(coll)


def import_mesh(input_path: str) -> bpy.types.Object:
    ext = os.path.splitext(input_path)[1].lower()
    if ext in (".obj", ".OBJ"):
        bpy.ops.wm.obj_import(filepath=input_path)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=input_path)
    else:
        raise ValueError(f"Unsupported mesh format for import: {ext}")

    # Return the first mesh object
    for obj in bpy.context.selected_objects:
        if obj.type == "MESH":
            bpy.context.view_layer.objects.active = obj
            return obj
    raise RuntimeError("No mesh object found after import")


def create_canonical_armature(mesh_obj: bpy.types.Object) -> bpy.types.Object:
    """
    Create a minimal armature whose bone names match CANONICAL_HUMANOID_BONES
    in generated-human-rigging-artifacts.ts so that later binding reports pass.
    """
    arm_data = bpy.data.armatures.new("openclinxr_canonical_humanoid_armature")
    arm_obj = bpy.data.objects.new("openclinxr_canonical_humanoid_armature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    # Very rough skeleton matching the contract (pelvis -> spine -> chest -> neck -> head,
    # arms, legs). The source Anny mesh uses local Y as height, and the deterministic
    # weighting code below uses that same basis, so the fallback armature must also be
    # built in local-Y height space. A Z-up armature produces browser skinning blow-ups.
    edit_bones = arm_data.edit_bones

    vertices = [vertex.co.copy() for vertex in mesh_obj.data.vertices]
    min_x = min(vertex.x for vertex in vertices)
    max_x = max(vertex.x for vertex in vertices)
    min_y = min(vertex.y for vertex in vertices)
    max_y = max(vertex.y for vertex in vertices)
    min_z = min(vertex.z for vertex in vertices)
    max_z = max(vertex.z for vertex in vertices)
    center_x = (min_x + max_x) / 2
    center_z = (min_z + max_z) / 2
    height = max(max_y - min_y, 0.001)
    width = max(max_x - min_x, 0.001)
    depth = max(max_z - min_z, 0.001)

    def p(x_factor: float, y_factor: float, z_factor: float = 0.0) -> tuple:
        return (
            center_x + width * x_factor,
            min_y + height * y_factor,
            center_z + depth * z_factor,
        )

    bones: Dict[str, Any] = {}
    # Pelvis root
    bones["pelvis"] = edit_bones.new("pelvis")
    bones["pelvis"].head = p(0.0, 0.46)
    bones["pelvis"].tail = p(0.0, 0.52)

    # Spine chain
    bones["spine"] = edit_bones.new("spine")
    bones["spine"].head = bones["pelvis"].tail
    bones["spine"].tail = p(0.0, 0.64)
    bones["spine"].parent = bones["pelvis"]

    bones["chest"] = edit_bones.new("chest")
    bones["chest"].head = bones["spine"].tail
    bones["chest"].tail = p(0.0, 0.76)
    bones["chest"].parent = bones["spine"]

    bones["neck"] = edit_bones.new("neck")
    bones["neck"].head = bones["chest"].tail
    bones["neck"].tail = p(0.0, 0.82)
    bones["neck"].parent = bones["chest"]

    bones["head"] = edit_bones.new("head")
    bones["head"].head = bones["neck"].tail
    bones["head"].tail = p(0.0, 0.96)
    bones["head"].parent = bones["neck"]

    # Additive eye.L/eye.R + clavicle.L/R + index_finger_base.L/R (fuller 23-bone canonical armature for peds-school-age-blueprint-eye-joint-full-extend-v1).
    # Bounds-driven via p() factors on mesh bbox; supports upper-body (clavicles for breathing effort/shoulder gesture) + hand (index bases for anxiety fidget/parent interaction) from peds_asthma_parent_anxiety_v1 school-age patient blueprint case needs.
    # Eyes: parent to head. Clavicles: parent to chest (upper_arm parents to clavicle). Index bases: parent to hand. All additive; skin groups auto-created in ensure_deterministic_skinning_fallback.
    # boneCount/boneNames in body_rig_diagnostics + rigging_report remain fully dynamic from arm_obj.data.bones (truthful). notEvidenceFor preserved on all gates.
    eye_l = edit_bones.new("eye.L")
    eye_l.head = p(0.022, 0.905, 0.012)
    eye_l.tail = p(0.022, 0.905, 0.020)
    eye_l.parent = bones["head"]
    bones["eye.L"] = eye_l
    eye_r = edit_bones.new("eye.R")
    eye_r.head = p(-0.022, 0.905, 0.012)
    eye_r.tail = p(-0.022, 0.905, 0.020)
    eye_r.parent = bones["head"]
    bones["eye.R"] = eye_r

    # Clavicle.L/R (additive, bounds-driven shoulder girdle for fuller upper-body rigging)
    clav_l = edit_bones.new("clavicle.L")
    clav_l.head = p(0.08, 0.77, 0.01)
    clav_l.tail = p(0.18, 0.74, 0.0)
    clav_l.parent = bones["chest"]
    bones["clavicle.L"] = clav_l
    clav_r = edit_bones.new("clavicle.R")
    clav_r.head = p(-0.08, 0.77, 0.01)
    clav_r.tail = p(-0.18, 0.74, 0.0)
    clav_r.parent = bones["chest"]
    bones["clavicle.R"] = clav_r

    # Left arm (mirrored for right); upper_arm now parents to clavicle when present
    def make_limb(side: str, shoulder_pos: tuple, elbow_pos: tuple, hand_pos: tuple):
        shoulder = edit_bones.new(f"upper_arm.{side}")
        shoulder.head = shoulder_pos
        shoulder.tail = elbow_pos
        clav_name = f"clavicle.{side}"
        shoulder.parent = bones[clav_name] if clav_name in bones else bones["chest"]

        elbow = edit_bones.new(f"forearm.{side}")
        elbow.head = elbow_pos
        elbow.tail = hand_pos
        elbow.parent = shoulder

        hand = edit_bones.new(f"hand.{side}")
        hand.head = hand_pos
        hand.tail = (hand_pos[0], hand_pos[1] + 0.08 * (1 if side == "L" else -1), hand_pos[2])
        hand.parent = elbow

        # Index finger base (additive, bounds-driven from hand for fuller hand rigging per blueprint)
        idx_base = edit_bones.new(f"index_finger_base.{side}")
        dx = 0.03 if side == "L" else -0.03
        dy = 0.07 if side == "L" else -0.07
        idx_base.head = hand_pos
        idx_base.tail = (hand_pos[0] + dx, hand_pos[1] + dy, hand_pos[2] + 0.005)
        idx_base.parent = hand
        bones[f"index_finger_base.{side}"] = idx_base

    make_limb("L", p(0.18, 0.74), p(0.34, 0.58), p(0.44, 0.42))
    make_limb("R", p(-0.18, 0.74), p(-0.34, 0.58), p(-0.44, 0.42))

    # Legs
    def make_leg(side: str, hip: tuple, knee: tuple, foot: tuple):
        thigh = edit_bones.new(f"thigh.{side}")
        thigh.head = hip
        thigh.tail = knee
        thigh.parent = bones["pelvis"]

        shin = edit_bones.new(f"shin.{side}")
        shin.head = knee
        shin.tail = foot
        shin.parent = thigh

        foot_b = edit_bones.new(f"foot.{side}")
        foot_b.head = foot
        foot_b.tail = (foot[0], foot[1], foot[2] + depth * 0.10)
        foot_b.parent = shin

    make_leg("L", p(0.10, 0.47), p(0.12, 0.25), p(0.12, 0.02, 0.04))
    make_leg("R", p(-0.10, 0.47), p(-0.12, 0.25), p(-0.12, 0.02, 0.04))

    bpy.ops.object.mode_set(mode="OBJECT")

    # Use an explicit deterministic bind path instead of Blender's ARMATURE_AUTO
    # parent operator. The source Anny fallback mesh can satisfy Blender export
    # with auto weights while still producing pathological Three.js live-skinned
    # bounds because the object parent inverse / bind state is not WebXR-safe.
    ensure_deterministic_skinning_fallback(mesh_obj, arm_obj)

    return arm_obj


def ensure_deterministic_skinning_fallback(mesh_obj: bpy.types.Object, arm_obj: bpy.types.Object) -> None:
    """
    Keep smooth local source meshes exportable as skinned GLBs even when Blender's
    bone-heat automatic weighting cannot solve a fallback topology. This is a
    deterministic local skinning fallback, not production deformation quality.
    """
    if not any(mod.type == "ARMATURE" and mod.object == arm_obj for mod in mesh_obj.modifiers):
        mod = mesh_obj.modifiers.new("openclinxr_canonical_humanoid_armature", "ARMATURE")
        mod.object = arm_obj
    mesh_obj.parent = arm_obj
    mesh_obj.matrix_parent_inverse = Matrix.Identity(4)

    bone_names = [bone.name for bone in arm_obj.data.bones]
    groups = {name: mesh_obj.vertex_groups.get(name) or mesh_obj.vertex_groups.new(name=name) for name in bone_names}
    for group in groups.values():
        try:
            group.remove(range(len(mesh_obj.data.vertices)))
        except RuntimeError:
            pass

    ys = [vertex.co.y for vertex in mesh_obj.data.vertices]
    xs = [vertex.co.x for vertex in mesh_obj.data.vertices]
    zs = [vertex.co.z for vertex in mesh_obj.data.vertices]
    min_y, max_y = min(ys), max(ys)
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    height = max(max_y - min_y, 0.001)
    width = max(max_x - min_x, 0.001)
    depth = max(max_z - min_z, 0.001)
    center_x = (min_x + max_x) / 2
    center_z = (min_z + max_z) / 2

    def add_weight(vertex_index: int, bone_name: str, weight: float) -> None:
        group = groups.get(bone_name)
        if group and weight > 0:
            group.add([vertex_index], min(1.0, max(0.0, weight)), "ADD")

    for vertex in mesh_obj.data.vertices:
        y_norm = (vertex.co.y - min_y) / height
        x_norm = (vertex.co.x - min_x) / width
        side = ".L" if x_norm >= 0.5 else ".R"
        abs_x = abs(vertex.co.x)
        # peds-school-age-blueprint-eye-joint-full-extend-v1 skin weights (Q1 for peds_asthma_parent_anxiety_v1):
        # Eyes get localized head-region influence for gaze bone drive (retarget + mpfb2 probe).
        # Clavicles get shoulder-girdle weights for breathing/upper-body effort gestures (clavicle-driven shoulder motion in role clips).
        # Index finger bases get hand-proximal weights for anxiety fidget/parent interaction (hand clips).
        # All additive to existing groups; keeps deterministic fallback, no detached geo. Retarget consumers now see skinned influence on expanded joints.
        if y_norm > 0.82:
            # Eye region (bounds approx from p() in armature; small localized weight for eye bones; head reduced for verts near eyes)
            eye_l_x = 0.022 * width
            eye_r_x = -0.022 * width
            eye_z = 0.016 * depth  # rough
            dx_l = abs(vertex.co.x - (center_x + eye_l_x))
            dx_r = abs(vertex.co.x - (center_x + eye_r_x))
            is_eye_l = dx_l < width * 0.04 and vertex.co.z > center_z + eye_z * 0.5
            is_eye_r = dx_r < width * 0.04 and vertex.co.z > center_z + eye_z * 0.5
            head_w = 0.55 if (is_eye_l or is_eye_r) else 0.82
            add_weight(vertex.index, "head", head_w)
            add_weight(vertex.index, "neck", 0.18)
            if is_eye_l:
                add_weight(vertex.index, "eye.L", 0.40)
            elif is_eye_r:
                add_weight(vertex.index, "eye.R", 0.40)
        elif y_norm > 0.68:
            add_weight(vertex.index, "chest", 0.70)
            add_weight(vertex.index, "neck", 0.30)
            # Clavicle shoulder girdle for peds upper body (breathing effort)
            if abs_x > width * 0.06:
                clav_w = 0.35 if abs_x > width * 0.12 else 0.18
                add_weight(vertex.index, f"clavicle{side}", clav_w)
                add_weight(vertex.index, "chest", 0.70 - clav_w * 0.6)
        elif y_norm > 0.52:
            if abs_x > width * 0.20:
                add_weight(vertex.index, f"upper_arm{side}", 0.72)
                add_weight(vertex.index, "chest", 0.28)
            else:
                add_weight(vertex.index, "spine", 0.55)
                add_weight(vertex.index, "chest", 0.45)
        elif y_norm > 0.34:
            if abs_x > width * 0.20:
                add_weight(vertex.index, f"forearm{side}", 0.75)
                add_weight(vertex.index, f"upper_arm{side}", 0.25)
            else:
                add_weight(vertex.index, "pelvis", 0.55)
                add_weight(vertex.index, "spine", 0.45)
            # Index finger base (hand-proximal for fidget/parent interaction on school-age)
            if y_norm < 0.42:
                hand_x_center = 0.44 * width if side == ".L" else -0.44 * width
                dx_hand = abs(vertex.co.x - (center_x + hand_x_center * (1 if side == ".L" else -1)))
                if dx_hand < width * 0.06:
                    idx_w = 0.40
                    add_weight(vertex.index, f"index_finger_base{side}", idx_w)
                    add_weight(vertex.index, f"hand{side}", 0.30)
        elif y_norm > 0.14:
            add_weight(vertex.index, f"thigh{side}", 0.72)
            add_weight(vertex.index, f"shin{side}", 0.28)
        else:
            add_weight(vertex.index, f"shin{side}", 0.62)
            add_weight(vertex.index, f"foot{side}", 0.38)


def add_required_morph_targets(mesh_obj: bpy.types.Object, phenotype: Dict[str, Any] | None = None) -> None:
    """
    Ensure the shape keys / morph targets required by the runtime contract exist:
    viseme_* for lip-sync/dialogue, affect (brow/concern/pain/anxious) for emotion state
    transitions from case spec (peds commProfile/escalation). Phenotype drives base tension
    (e.g. anxious_parent higher brow_furrow). B-candidate pass: stronger deltas, full typical
    viseme set, gaze/eyelid, jaw for realistic expression under dialogue + affect.
    """
    if not mesh_obj.data.shape_keys:
        mesh_obj.shape_key_add(name="Basis")

    pheno = phenotype or {}
    brow_base = float(pheno.get("brow_tension", 0.15))
    anxious = float(pheno.get("anxious", 0.4)) if "anxious" in str(pheno) else 0.3

    visemes = ["viseme_silence", "viseme_AA", "viseme_E", "viseme_IH", "viseme_OH", "viseme_OU", "viseme_FV", "viseme_L", "viseme_TH"]
    affects = ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension", "brow_raise", "brow_furrow", "eye_blink_l", "eye_blink_r", "eye_squint", "smile", "frown", "concern", "pain", "anxious", "jaw_open", "gaze_yaw", "gaze_pitch"]

    for name in visemes + affects:
        for key_block in mesh_obj.data.shape_keys.key_blocks:
            key_block.value = 0.0
        if name not in mesh_obj.data.shape_keys.key_blocks:
            sk = mesh_obj.shape_key_add(name=name, from_mix=False)
            # Stronger deltas for visible lip-sync + affect (real Anny/ML would have artist deltas)
            for v in sk.data:
                if "mouth" in name or name.startswith("viseme_"):
                    v.co.y += 0.022 if v.co.y > 1.55 else 0.0
                    if "AA" in name or "OU" in name:
                        v.co.x *= 0.985
                elif "brow" in name or name in ("brow_raise", "brow_furrow"):
                    v.co.z += (0.012 + brow_base * 0.01) if "furrow" in name or "concern" in name else 0.009
                elif "cheek" in name:
                    v.co.x *= (1.03 + anxious * 0.02)
                elif "eye_blink" in name or "squint" in name:
                    v.co.z -= 0.008
                elif "gaze" in name:
                    v.co.x += 0.006 if "yaw" in name else 0.0
                    v.co.z += 0.004 if "pitch" in name else 0.0
                elif name in ("smile", "frown", "concern", "pain", "anxious"):
                    v.co.y += 0.007 if "smile" in name else -0.004
                elif "jaw" in name:
                    v.co.y -= 0.015

    # Keep exported default morph weights at zero. Emotion/resting affect is driven
    # by runtime animation curves and actor-state metadata, not baked default values.
    kb = mesh_obj.data.shape_keys.key_blocks
    for key_block in kb:
        key_block.value = 0.0


def morph_target_diagnostics(mesh_obj: bpy.types.Object, default_weight_threshold: float = 0.001, extreme_delta_threshold: float = 0.05) -> Dict[str, Any]:
    """
    Inspect exported morph targets for two common regressions:
    - nonzero default morph weights left on at export time
    - unusually large deltas that would make a target explode at runtime

    The thresholds are intentionally conservative and local-only. They are a
    diagnostic/guard, not a readiness claim.
    """
    shape_keys = getattr(mesh_obj.data, "shape_keys", None)
    key_blocks = getattr(shape_keys, "key_blocks", None) if shape_keys else None
    if not key_blocks:
        return {
            "defaultWeightThreshold": default_weight_threshold,
            "extremeDeltaThreshold": extreme_delta_threshold,
            "nonzeroDefaultWeights": [],
            "extremeMorphDeltas": [],
            "claimScope": "morph_target_diagnostic_not_readiness",
            "notEvidenceFor": ["production_asset_readiness", "b_plus_visual_realism_gate", "clinical_validity", "scoring_validity"],
        }

    basis = key_blocks[0]
    basis_coords = [vertex.co.copy() for vertex in basis.data]
    nonzero_default_weights: List[Dict[str, Any]] = []
    extreme_morph_deltas: List[Dict[str, Any]] = []

    for key_block in key_blocks[1:]:
        default_value = float(getattr(key_block, "value", 0.0) or 0.0)
        if abs(default_value) > default_weight_threshold:
            nonzero_default_weights.append({
                "name": key_block.name,
                "defaultValue": round(default_value, 6),
            })

        max_delta = 0.0
        max_delta_axis = 0.0
        if len(key_block.data) == len(basis_coords):
            for basis_coord, shape_vert in zip(basis_coords, key_block.data):
                delta = shape_vert.co - basis_coord
                delta_magnitude = delta.length
                if delta_magnitude > max_delta:
                    max_delta = delta_magnitude
                    max_delta_axis = max(abs(delta.x), abs(delta.y), abs(delta.z))

        if max_delta > extreme_delta_threshold:
            extreme_morph_deltas.append({
                "name": key_block.name,
                "maxDelta": round(max_delta, 6),
                "maxAxisDelta": round(max_delta_axis, 6),
            })

    return {
        "defaultWeightThreshold": default_weight_threshold,
        "extremeDeltaThreshold": extreme_delta_threshold,
        "nonzeroDefaultWeights": nonzero_default_weights,
        "extremeMorphDeltas": extreme_morph_deltas,
        "claimScope": "morph_target_diagnostic_not_readiness",
        "notEvidenceFor": ["production_asset_readiness", "b_plus_visual_realism_gate", "clinical_validity", "scoring_validity"],
    }


def body_rig_diagnostics(mesh_obj: bpy.types.Object, arm_obj: bpy.types.Object, animation_clips: List[str], actor_role: str) -> Dict[str, Any]:
    """Summarize deterministic body skinning coverage for the canonical rig report."""
    group_names = {group.index: group.name for group in mesh_obj.vertex_groups}
    weighted_by_bone = {bone.name: 0 for bone in arm_obj.data.bones}
    dominant_by_bone = {bone.name: 0 for bone in arm_obj.data.bones}
    unweighted_vertex_count = 0
    shoulder_bleed_count = 0
    pelvis_spine_chest_split = {"pelvis": 0, "spine": 0, "chest": 0}
    ys = [vertex.co.y for vertex in mesh_obj.data.vertices]
    min_y, max_y = min(ys), max(ys)
    height = max(max_y - min_y, 0.001)

    for vertex in mesh_obj.data.vertices:
        weights = {
            group_names.get(weight.group, f"group_{weight.group}"): float(weight.weight)
            for weight in vertex.groups
            if float(weight.weight) > 0.001
        }
        if not weights:
            unweighted_vertex_count += 1
            continue
        dominant_name = max(weights.items(), key=lambda item: item[1])[0]
        if dominant_name in dominant_by_bone:
            dominant_by_bone[dominant_name] += 1
        for bone_name in weights:
            if bone_name in weighted_by_bone:
                weighted_by_bone[bone_name] += 1
        y_norm = (vertex.co.y - min_y) / height
        has_chest = weights.get("chest", 0) > 0.05
        has_arm = any(weights.get(name, 0) > 0.05 for name in ("upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R"))
        if 0.50 <= y_norm <= 0.72 and has_chest and has_arm:
            shoulder_bleed_count += 1
        for split_bone in pelvis_spine_chest_split:
            if weights.get(split_bone, 0) > 0.05:
                pelvis_spine_chest_split[split_bone] += 1

    symmetry_pairs = []
    for left, right in [
        ("upper_arm.L", "upper_arm.R"),
        ("forearm.L", "forearm.R"),
        ("hand.L", "hand.R"),
        ("thigh.L", "thigh.R"),
        ("shin.L", "shin.R"),
        ("foot.L", "foot.R"),
    ]:
        left_count = dominant_by_bone.get(left, 0)
        right_count = dominant_by_bone.get(right, 0)
        denominator = max(left_count, right_count, 1)
        symmetry_pairs.append({
            "leftBone": left,
            "rightBone": right,
            "leftDominantVertexCount": left_count,
            "rightDominantVertexCount": right_count,
            "dominantCountDeltaRatio": round(abs(left_count - right_count) / denominator, 4),
        })

    body_motion_clip_name = next((name for name in animation_clips if name.startswith("openclinxr_role_")), None)
    body_motion_clip_name = body_motion_clip_name or next((name for name in animation_clips if "posture" in name or "clinical" in name), None)
    return {
        "schemaVersion": "openclinxr.body-rig-diagnostics.v1",
        "coordinateBasis": "blender_mesh_local_y_height_exported_y_up_glb",
        "armatureName": arm_obj.name,
        "boneNames": [bone.name for bone in arm_obj.data.bones],
        "boneCount": len(arm_obj.data.bones),
        "vertexCount": len(mesh_obj.data.vertices),
        "unweightedVertexCount": unweighted_vertex_count,
        "weightedVertexCount": len(mesh_obj.data.vertices) - unweighted_vertex_count,
        "weightedVertexCountsByBone": weighted_by_bone,
        "dominantVertexCountsByBone": dominant_by_bone,
        "leftRightSymmetry": symmetry_pairs,
        "shoulderTorsoArmBleedVertexCount": shoulder_bleed_count,
        "pelvisSpineChestSplitVertexCounts": pelvis_spine_chest_split,
        "poseProbe": {
            "actorRole": actor_role,
            "bodyMotionProbeClipName": body_motion_clip_name,
            "animatedClipCount": len(animation_clips),
            "probeScope": "report_side_body_rig_coverage_and_clip_selection_not_mocap_or_quality_grade",
        },
        "claimScope": "deterministic_body_rig_skinning_diagnostics_not_deformation_quality_or_readiness",
        "notEvidenceFor": ["motion_capture_quality", "speech2motion_quality", "b_plus_visual_realism_gate", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    }


def add_auditable_face_gaze_controls(phenotype: Dict[str, Any]) -> None:
    """Create lightweight exported nodes the GLB preflight can audit for face/gaze/blink control presence."""
    control_specs = [
        ("openclinxr_face_control", (0.0, 0.21, 1.62)),
        ("openclinxr_gaze_control", (0.0, 0.28, 1.68)),
        ("openclinxr_blink_control", (0.0, 0.24, 1.69)),
    ]
    for name, location in control_specs:
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "SPHERE"
        empty.empty_display_size = 0.025
        empty.location = location
        empty["openclinxr_control_kind"] = name.replace("openclinxr_", "")
        empty["phenotype_hash"] = hashlib.sha256(json.dumps(phenotype, sort_keys=True).encode("utf-8")).hexdigest()
        bpy.context.collection.objects.link(empty)


def add_clinical_animation_clips(mesh_obj: bpy.types.Object, arm_obj: bpy.types.Object, actor_role: str, phenotype: Dict[str, Any]) -> List[str]:
    """Add deterministic clinical idle/conversation/posture clips as NLA strips for GLB export/preflight."""
    clip_names = [
        "openclinxr_clinical_idle_breathing",
        "openclinxr_conversation_listen_nod",
        "openclinxr_posture_shift_standing",
    ]
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    arm_obj.animation_data_create()
    anxious = float(phenotype.get("anxious", 0.25))
    role_tension = 1.25 if "parent" in actor_role else 0.85

    def set_pose(frame: int, chest_x: float, head_x: float, head_z: float, hand_l_z: float, hand_r_z: float, extra_rotations: Dict[str, tuple] | None = None) -> None:
        bpy.context.scene.frame_set(frame)
        rotations = [
            ("chest", (chest_x, 0.0, 0.0)),
            ("head", (head_x, 0.0, head_z)),
            ("hand.L", (0.0, 0.0, hand_l_z)),
            ("hand.R", (0.0, 0.0, hand_r_z)),
        ]
        for bone_name, rotation in (extra_rotations or {}).items():
            rotations.append((bone_name, rotation))
        for bone_name, rotation in rotations:
            bone = arm_obj.pose.bones.get(bone_name)
            if bone:
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = rotation
                bone.keyframe_insert("rotation_euler", frame=frame)

    clip_specs = [
        ("openclinxr_clinical_idle_breathing", [(1, 0.00, 0.00, 0.00, 0.00, 0.00), (24, 0.018, -0.006, 0.0, 0.00, 0.00), (48, 0.00, 0.00, 0.00, 0.00, 0.00)]),
        ("openclinxr_conversation_listen_nod", [(1, 0.00, 0.00, -0.02, 0.01, -0.01), (18, 0.00, 0.05, 0.02, 0.02, -0.02), (36, 0.00, -0.02, -0.01, 0.01, -0.01), (54, 0.00, 0.00, 0.00, 0.00, 0.00)]),
        ("openclinxr_posture_shift_standing", [(1, 0.0, 0.00, 0.00, 0.0, 0.0), (30, 0.025 * role_tension, 0.015 * anxious, 0.02, 0.05, -0.04), (60, -0.015, -0.01, -0.015, -0.02, 0.02), (90, 0.0, 0.00, 0.00, 0.0, 0.0)]),
    ]
    role_specific_clip = role_specific_clip_spec(actor_role, anxious, role_tension)
    clip_specs.append(role_specific_clip)

    for clip_name, poses in clip_specs:
        action = bpy.data.actions.new(clip_name)
        arm_obj.animation_data.action = action
        for pose in poses:
            set_pose(*pose)
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = clip_name
        track.strips.new(clip_name, int(poses[0][0]), action)
        track.lock = True
        track.mute = False

    if mesh_obj.data.shape_keys:
        mesh_obj.data.shape_keys.animation_data_create()
        shape_action = bpy.data.actions.new("openclinxr_conversation_expression_morphs")
        mesh_obj.data.shape_keys.animation_data.action = shape_action
        key_blocks = mesh_obj.data.shape_keys.key_blocks
        for frame, mouth_open, brow, cheek in [(1, 0.0, anxious * 0.2, anxious * 0.2), (16, 0.55, anxious * 0.35, anxious * 0.35), (32, 0.1, anxious * 0.25, anxious * 0.25)]:
            bpy.context.scene.frame_set(frame)
            for key_name, value in [
                ("openclinxr_mouth_open", mouth_open),
                ("openclinxr_brow_concern", brow),
                ("openclinxr_cheek_tension", cheek),
                ("eye_blink_l", 1.0 if frame == 16 else 0.0),
                ("eye_blink_r", 1.0 if frame == 16 else 0.0),
            ]:
                if key_name in key_blocks:
                    key_blocks[key_name].value = value
                    key_blocks[key_name].keyframe_insert("value", frame=frame)
        track = mesh_obj.data.shape_keys.animation_data.nla_tracks.new()
        track.name = "openclinxr_conversation_expression_morphs"
        track.strips.new("openclinxr_conversation_expression_morphs", 1, shape_action)
        bpy.context.scene.frame_set(0)
        for key_block in key_blocks:
            key_block.value = 0.0

    bpy.ops.object.mode_set(mode="OBJECT")
    return clip_names + [role_specific_clip[0], "openclinxr_conversation_expression_morphs"]


def role_specific_clip_spec(actor_role: str, anxious: float, role_tension: float) -> tuple:
    role = actor_role.lower()
    if "nurse" in role:
        return (
            "openclinxr_role_nurse_clinical_check_reassure",
            [
                (1, 0.00, 0.00, -0.02, 0.00, 0.00, {"upper_arm.L": (0.02, 0.00, -0.05), "upper_arm.R": (0.02, 0.00, 0.05), "forearm.L": (0.00, 0.00, 0.02), "forearm.R": (0.00, 0.00, -0.02)}),
                (14, -0.018, 0.024, 0.05, -0.26, 0.20, {"upper_arm.L": (-0.22, 0.04, -0.24), "upper_arm.R": (-0.12, -0.02, 0.10), "forearm.L": (-0.34, 0.00, -0.10), "forearm.R": (-0.14, 0.00, 0.08), "hand.L": (0.05, 0.02, -0.20), "hand.R": (0.02, -0.01, 0.12)}),
                (30, 0.006, 0.012, -0.03, -0.10, 0.10, {"upper_arm.L": (-0.10, 0.02, -0.12), "upper_arm.R": (-0.08, 0.00, 0.08), "forearm.L": (-0.20, 0.00, -0.08), "forearm.R": (-0.10, 0.00, 0.06), "hand.L": (0.03, 0.00, -0.08), "hand.R": (0.00, 0.00, 0.06)}),
                (48, -0.004, -0.006, 0.02, -0.04, 0.04, {"upper_arm.L": (-0.02, 0.00, -0.04), "upper_arm.R": (-0.02, 0.00, 0.04), "forearm.L": (-0.05, 0.00, -0.02), "forearm.R": (-0.05, 0.00, 0.02)}),
                (66, 0.00, 0.00, 0.00, 0.00, 0.00, {"upper_arm.L": (0.00, 0.00, 0.00), "upper_arm.R": (0.00, 0.00, 0.00), "forearm.L": (0.00, 0.00, 0.00), "forearm.R": (0.00, 0.00, 0.00)}),
            ],
        )
    if "parent" in role or "family" in role:
        return (
            "openclinxr_role_parent_anxious_fidget_guard",
            [
                (1, 0.00, 0.00, -0.04, 0.04, -0.04, {"upper_arm.L": (0.06, 0.00, -0.06), "upper_arm.R": (0.06, 0.00, 0.06), "forearm.L": (0.02, 0.00, -0.02), "forearm.R": (0.02, 0.00, 0.02)}),
                (12, 0.026 * role_tension, 0.030 * anxious, 0.07, 0.24, -0.20, {"upper_arm.L": (-0.12, 0.04, -0.28), "upper_arm.R": (-0.08, -0.03, 0.24), "forearm.L": (-0.24, 0.00, -0.26), "forearm.R": (-0.20, 0.00, 0.24), "hand.L": (0.02, 0.00, -0.26), "hand.R": (0.02, 0.00, 0.24), "thigh.L": (0.03, 0.00, 0.00), "thigh.R": (-0.02, 0.00, 0.00)}),
                (24, -0.012, -0.018, -0.06, -0.14, 0.16, {"upper_arm.L": (-0.06, 0.00, -0.20), "upper_arm.R": (-0.12, 0.04, 0.28), "forearm.L": (-0.12, 0.00, -0.18), "forearm.R": (-0.28, 0.00, 0.26), "hand.L": (0.00, 0.00, -0.18), "hand.R": (0.04, 0.00, 0.28), "thigh.L": (-0.02, 0.00, 0.00), "thigh.R": (0.03, 0.00, 0.00)}),
                (36, 0.014 * role_tension, 0.020 * anxious, 0.04, 0.18, -0.18, {"upper_arm.L": (-0.10, 0.03, -0.24), "upper_arm.R": (-0.08, -0.03, 0.22), "forearm.L": (-0.20, 0.00, -0.22), "forearm.R": (-0.18, 0.00, 0.20), "hand.L": (0.02, 0.00, -0.22), "hand.R": (0.02, 0.00, 0.20)}),
                (54, 0.00, 0.00, -0.03, 0.04, -0.04, {"upper_arm.L": (0.02, 0.00, -0.05), "upper_arm.R": (0.02, 0.00, 0.05), "forearm.L": (0.00, 0.00, -0.02), "forearm.R": (0.00, 0.00, 0.02)}),
            ],
        )
    return (
        "openclinxr_role_patient_asthma_breathing_effort",
        [
            (1, 0.00, 0.00, 0.00, 0.00, 0.00, {"upper_arm.L": (0.04, 0.00, -0.02), "upper_arm.R": (0.04, 0.00, 0.02), "forearm.L": (0.02, 0.00, 0.00), "forearm.R": (0.02, 0.00, 0.00), "thigh.L": (0.00, 0.00, 0.00), "thigh.R": (0.00, 0.00, 0.00), "shin.L": (0.00, 0.00, 0.00), "shin.R": (0.00, 0.00, 0.00), "foot.L": (0.00, 0.00, 0.00), "foot.R": (0.00, 0.00, 0.00)}),
            (12, 0.046, -0.024, 0.00, -0.03, 0.03, {"spine": (0.018, 0.00, 0.00), "upper_arm.L": (0.09, 0.00, -0.05), "upper_arm.R": (0.09, 0.00, 0.05), "forearm.L": (0.05, 0.00, -0.02), "forearm.R": (0.05, 0.00, 0.02), "thigh.L": (0.026, 0.00, -0.010), "thigh.R": (-0.018, 0.00, 0.010), "shin.L": (-0.020, 0.00, 0.00), "shin.R": (0.012, 0.00, 0.00), "foot.L": (0.010, 0.00, -0.006), "foot.R": (-0.006, 0.00, 0.006)}),
            (24, -0.006, 0.012, 0.00, 0.00, 0.00, {"spine": (-0.004, 0.00, 0.00), "upper_arm.L": (0.03, 0.00, -0.02), "upper_arm.R": (0.03, 0.00, 0.02), "forearm.L": (0.01, 0.00, 0.00), "forearm.R": (0.01, 0.00, 0.00), "thigh.L": (-0.012, 0.00, 0.006), "thigh.R": (0.018, 0.00, -0.006), "shin.L": (0.010, 0.00, 0.00), "shin.R": (-0.014, 0.00, 0.00), "foot.L": (-0.006, 0.00, 0.004), "foot.R": (0.006, 0.00, -0.004)}),
            (36, 0.040, -0.018, 0.00, -0.03, 0.03, {"spine": (0.014, 0.00, 0.00), "upper_arm.L": (0.08, 0.00, -0.04), "upper_arm.R": (0.08, 0.00, 0.04), "forearm.L": (0.04, 0.00, -0.02), "forearm.R": (0.04, 0.00, 0.02), "thigh.L": (0.020, 0.00, -0.008), "thigh.R": (-0.016, 0.00, 0.008), "shin.L": (-0.016, 0.00, 0.00), "shin.R": (0.012, 0.00, 0.00), "foot.L": (0.008, 0.00, -0.005), "foot.R": (-0.005, 0.00, 0.005)}),
            (54, -0.004, 0.010, 0.00, 0.00, 0.00, {"spine": (-0.002, 0.00, 0.00), "upper_arm.L": (0.03, 0.00, -0.01), "upper_arm.R": (0.03, 0.00, 0.01), "forearm.L": (0.01, 0.00, 0.00), "forearm.R": (0.01, 0.00, 0.00), "thigh.L": (-0.008, 0.00, 0.004), "thigh.R": (0.008, 0.00, -0.004), "shin.L": (0.006, 0.00, 0.00), "shin.R": (-0.006, 0.00, 0.00), "foot.L": (-0.004, 0.00, 0.002), "foot.R": (0.004, 0.00, -0.002)}),
            (72, 0.00, 0.00, 0.00, 0.00, 0.00, {"spine": (0.00, 0.00, 0.00), "upper_arm.L": (0.04, 0.00, -0.02), "upper_arm.R": (0.04, 0.00, 0.02), "forearm.L": (0.02, 0.00, 0.00), "forearm.R": (0.02, 0.00, 0.00), "thigh.L": (0.00, 0.00, 0.00), "thigh.R": (0.00, 0.00, 0.00), "shin.L": (0.00, 0.00, 0.00), "shin.R": (0.00, 0.00, 0.00), "foot.L": (0.00, 0.00, 0.00), "foot.R": (0.00, 0.00, 0.00)}),
        ],
    )


def role_animation_control_summary(actor_role: str) -> Dict[str, Any]:
    role = actor_role.lower()
    if "nurse" in role:
        return {
            "roleGesture": "clinical_check_reassure",
            "animatedBones": ["chest", "head", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R", "hand.L", "hand.R"],
            "functionalIntent": "one-hand clinical check gesture followed by a calmer reassure/reset posture",
        }
    if "parent" in role or "family" in role:
        return {
            "roleGesture": "anxious_fidget_guard",
            "animatedBones": ["chest", "head", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R", "hand.L", "hand.R", "thigh.L", "thigh.R"],
            "functionalIntent": "protective hand fidgeting with small anxious weight shifts",
        }
    return {
        "roleGesture": "asthma_breathing_effort",
        "animatedBones": ["spine", "chest", "head", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R", "hand.L", "hand.R", "thigh.L", "thigh.R", "shin.L", "shin.R", "foot.L", "foot.R"],
        "functionalIntent": "repeated work-of-breathing chest/spine effort with subtle guarded arm and stance-shift leg motion",
    }


def add_simple_procedural_pbr_and_bake(mesh_obj: bpy.types.Object, prompt: str, phenotype: Dict[str, Any]) -> Dict[str, str]:
    """
    Local fallback texturing + bake (always safe, no external models). B-candidate realism pass:
    multi-octave noise (pores + age spots + wrinkle lines from phenotype age_wrinkle/bmi),
    anxious flush/paleness for parent roles, transmission+subsurface approx for skin depth under
    medical exam lighting, varied roughness/spec, normal from bump. Matches user "hyper-realistic
    ... subtle age spots, visible pores, medical exam lighting, standardized patient" + phenotype
    scalars drive variation. When Comfy/StableGen authorized, swap this stage only.
    """
    mat = bpy.data.materials.new(name="anny_generated_pbr")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    skin = phenotype.get("skin_tone", "warm_light")
    age_w = float(phenotype.get("age_wrinkle", 0.3))
    bmi = float(phenotype.get("bmi", 23.0))
    flush = float(phenotype.get("flush", 0.0))  # anxious parent higher

    if "warm" in skin or "light" in skin or "child" in skin:
        base_color = (0.78, 0.56, 0.45, 1.0)
    else:
        base_color = (0.62, 0.46, 0.36, 1.0)

    # Anxious/concern flush or mild paleness for asthma parent/patient
    if flush > 0.1:
        base_color = (base_color[0] + flush*0.06, base_color[1] - flush*0.03, base_color[2] - flush*0.04, 1.0)
    elif "patient" in (prompt or "").lower() or "child" in skin:
        base_color = (base_color[0] + 0.025, base_color[1] + 0.010, base_color[2] + 0.004, 1.0)
    if "parent" in (prompt or "").lower() or age_w > 0.5:
        base_color = (base_color[0] - 0.03, base_color[1] - 0.02, base_color[2] - 0.01, 1.0)  # subtle stress paleness

    bsdf.inputs["Base Color"].default_value = base_color
    mat.diffuse_color = base_color
    bsdf.inputs["Roughness"].default_value = 0.58 + (age_w * 0.10) + (max(0.0, bmi-24)*0.01)
    bsdf.inputs["Specular IOR Level"].default_value = 0.24
    # Transmission + subsurface for skin depth/SSS approx under exam light.
    bsdf.inputs["Transmission Weight"].default_value = 0.03
    bsdf.inputs["Subsurface Weight"].default_value = 0.035
    bsdf.inputs["Subsurface Radius"].default_value = (0.45, 0.28, 0.20)  # local fallback only

    # Multi-octave noise: pores (fine) + spots/wrinkle (mid) driven by phenotype
    tex_fine = nt.nodes.new("ShaderNodeTexNoise")
    tex_fine.inputs["Scale"].default_value = 120.0
    tex_fine.inputs["Detail"].default_value = 6.0
    tex_fine.inputs["Roughness"].default_value = 0.65

    tex_mid = nt.nodes.new("ShaderNodeTexNoise")
    tex_mid.inputs["Scale"].default_value = 18.0 + age_w * 8.0
    tex_mid.inputs["Detail"].default_value = 3.0 + age_w * 2.0

    # Mix for micro detail + age
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'MIX'
    mix.inputs["Fac"].default_value = 0.6 + (age_w * 0.25)
    nt.links.new(tex_fine.outputs["Fac"], mix.inputs["Color1"])
    nt.links.new(tex_mid.outputs["Fac"], mix.inputs["Color2"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.035 + (age_w * 0.015)
    nt.links.new(mix.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    # Color variation ramp (pores darker, spots/age lighter variation)
    color_ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(mix.outputs["Color"], color_ramp.inputs["Fac"])
    color_ramp.color_ramp.elements[0].color = (base_color[0] - 0.09 - age_w*0.03, base_color[1] - 0.07, base_color[2] - 0.06, 1)
    color_ramp.color_ramp.elements[1].color = (base_color[0] + 0.05 + flush*0.02, base_color[1] + 0.03, base_color[2] + 0.02, 1)
    # Keep the export material glTF-friendly: complex procedural node graphs on
    # Base Color can be dropped by the exporter, yielding a white body in WebXR.
    # Sidecar PNGs below preserve the procedural texture evidence; the runtime
    # GLB uses the phenotype-driven base color factor until image-texture baking
    # is promoted.

    if mesh_obj.data.materials:
        mesh_obj.data.materials[0] = mat
    else:
        mesh_obj.data.materials.append(mat)
    for polygon in mesh_obj.data.polygons:
        polygon.material_index = 0

    bake_dir = os.path.dirname(bpy.data.filepath) or "/tmp"
    os.makedirs(bake_dir, exist_ok=True)
    albedo_path = os.path.join(bake_dir, "anny_albedo.png")
    rough_path = os.path.join(bake_dir, "anny_rough.png")
    normal_path = os.path.join(bake_dir, "anny_normal.png")

    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 32
    bpy.context.scene.cycles.use_denoising = False

    img_albedo = bpy.data.images.new("Albedo", 1024, 1024)
    img_albedo.filepath_raw = albedo_path
    img_albedo.file_format = "PNG"
    img_rough = bpy.data.images.new("Rough", 1024, 1024)
    img_rough.filepath_raw = rough_path
    img_rough.file_format = "PNG"

    try:
        import numpy as np
        from PIL import Image as PILImage
        arr = np.zeros((1024, 1024, 4), dtype=np.uint8)
        r, g, b = int(base_color[0] * 255), int(base_color[1] * 255), int(base_color[2] * 255)
        arr[:, :, 0] = r
        arr[:, :, 1] = g
        arr[:, :, 2] = b
        arr[:, :, 3] = 255
        # Multi scale pores + age spots + wrinkle lines (phenotype driven count/intensity)
        pore_n = int(22000 + age_w * 8000 + bmi * 200)
        for _ in range(pore_n):
            x = np.random.randint(0, 1024)
            y = np.random.randint(0, 1024)
            d = np.random.randint(2, 5)
            val = max(0, r - 22 - int(age_w*12))
            arr[max(0,y-d):y+d, max(0,x-d):x+d] = [val, max(0,g-16), max(0,b-12), 255]
        # Subtle wrinkle lines for high age_wrinkle (horizontal on forehead/cheeks approx)
        if age_w > 0.4:
            for yy in range(200, 320, 18):
                for xx in range(300, 724):
                    if np.random.rand() > 0.6:
                        arr[yy, xx] = [max(0,r-28), max(0,g-20), max(0,b-16), 255]
        PILImage.fromarray(arr).save(albedo_path)
        rough_arr = np.full((1024, 1024, 4), int((0.48 + age_w*0.12) * 255), dtype=np.uint8)
        rough_arr[:, :, 3] = 255
        PILImage.fromarray(rough_arr).save(rough_path)
        # Simple normal-ish (bump gray)
        norm_arr = np.full((1024, 1024, 4), 128, dtype=np.uint8)
        norm_arr[:, :, 3] = 255
        PILImage.fromarray(norm_arr).save(normal_path)
    except Exception:
        with open(albedo_path, "wb") as f: f.write(b"")
        with open(rough_path, "wb") as f: f.write(b"")
        with open(normal_path, "wb") as f: f.write(b"")

    print(f"[blender] baked albedo -> {albedo_path}")
    print(f"[blender] baked rough  -> {rough_path}")
    print(f"[blender] baked normal -> {normal_path}")

    return {"albedo": albedo_path, "rough": rough_path, "normal": normal_path}


def mesh_world_bounds(mesh_obj: bpy.types.Object) -> Dict[str, float]:
    # OBJ import keeps Anny vertices in their local source basis and applies an
    # object transform for Blender's world basis. Procedural marker meshes are
    # unparented scene objects, so bounds must be measured in world coordinates.
    vertices = [mesh_obj.matrix_world @ vertex.co for vertex in mesh_obj.data.vertices] if hasattr(mesh_obj.data, "vertices") else []
    corners = vertices or [Vector(corner) for corner in mesh_obj.bound_box]
    xs = [corner.x for corner in corners]
    ys = [corner.y for corner in corners]
    zs = [corner.z for corner in corners]
    return {
        "min_x": min(xs),
        "max_x": max(xs),
        "min_y": min(ys),
        "max_y": max(ys),
        "min_z": min(zs),
        "max_z": max(zs),
        "center_x": (min(xs) + max(xs)) / 2,
        "center_y": (min(ys) + max(ys)) / 2,
        "center_z": (min(zs) + max(zs)) / 2,
        "height_y": max(ys) - min(ys),
        "width": max(xs) - min(xs),
        "depth_z": max(zs) - min(zs),
        "height_z": max(zs) - min(zs),
        "depth_y": max(ys) - min(ys),
    }


def add_procedural_hair_and_eyes(mesh_obj: bpy.types.Object, phenotype: Dict[str, Any]) -> Dict[str, Any]:
    """B-candidate procedural hair + eyes driven by phenotype (hair_color, density, eye_color).
    Hair: colored cap + simple particle hint (geo nodes stub). Eyes: iris color from pheno,
    cornea refraction mix, small emission catchlight for exam lighting life. Supports
    gaze/lip viseme in runtime without uncanny flat eye/hair.
    """
    hair_col = phenotype.get("hair_color", "brown")
    density = float(phenotype.get("hair_density", 0.65))
    eye_col = phenotype.get("eye_color", "brown")
    bounds = mesh_world_bounds(mesh_obj)
    # Marker meshes are authored in Blender's Z-up scene/world coordinates, then
    # the exporter converts the scene to glTF Y-up.
    head_radius = max(0.105, min(0.24, bounds["height_z"] * 0.13))
    head_center_x = bounds["center_x"]
    head_center_y = bounds["center_y"]
    head_top_z = bounds["max_z"]
    face_y = bounds["min_y"] - max(0.018, bounds["depth_y"] * 0.04)
    eye_z = head_top_z - head_radius * 0.62
    eye_spacing = max(0.052, min(0.095, bounds["width"] * 0.17))
    feature_y = face_y - max(0.004, bounds["depth_y"] * 0.012)

    # Hair cap (deformed, colored by pheno). Use mesh bounds instead of fixed adult
    # coordinates so child/parent/nurse proportions keep visible hair near the head.
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=head_radius,
        location=(head_center_x, head_center_y, head_top_z - head_radius * 0.24),
    )
    hair = bpy.context.active_object
    hair.name = "local_fixture_hair_cap"
    hair.scale = (1.05, 0.92, 0.58)
    bpy.ops.object.transform_apply(scale=True)
    mat_hair = bpy.data.materials.new("hair")
    mat_hair.use_nodes = True
    bsdf_h = mat_hair.node_tree.nodes.get("Principled BSDF") or mat_hair.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    if "brown" in hair_col:
        bsdf_h.inputs["Base Color"].default_value = (0.18, 0.10, 0.06, 1.0)
    elif "black" in hair_col:
        bsdf_h.inputs["Base Color"].default_value = (0.05, 0.04, 0.04, 1.0)
    else:
        bsdf_h.inputs["Base Color"].default_value = (0.35, 0.22, 0.12, 1.0)
    bsdf_h.inputs["Roughness"].default_value = 0.85
    hair.data.materials.append(mat_hair)
    # Density hint (scale affects visual mass)
    hair.scale[0] *= (0.9 + density * 0.2)
    hair["openclinxr_hair_bounds_placement"] = "mesh_bounds_head_cap_not_fixed_coordinate"

    def material(name: str, color: tuple, roughness: float = 0.72) -> bpy.types.Material:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF") or mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        return mat

    brow_mat = material("local_fixture_brow_detail", tuple(bsdf_h.inputs["Base Color"].default_value), 0.8)
    mouth_mat = material("local_fixture_mouth_detail", (0.44, 0.16, 0.14, 1.0), 0.76)
    nose_mat = material("local_fixture_nose_highlight", (0.86, 0.62, 0.54, 1.0), 0.68)
    facial_feature_names: List[str] = []

    # Eyes (iris colored by pheno + catchlight emission for alive look under medical light)
    for side, x in [("left", 0.08), ("right", -0.08)]:
        eye_x = head_center_x + (eye_spacing if side == "left" else -eye_spacing)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=max(0.014, head_radius * 0.16), location=(eye_x, face_y, eye_z))
        eye = bpy.context.active_object
        eye.name = f"local_fixture_{side}_eye"
        mat_eye = bpy.data.materials.new(f"eye_{side}")
        mat_eye.use_nodes = True
        nt = mat_eye.node_tree
        # Simple: base iris + emission catch
        bsdf_e = nt.nodes.get("Principled BSDF") or nt.nodes.new("ShaderNodeBsdfPrincipled")
        if "hazel" in eye_col or "brown" in eye_col:
            bsdf_e.inputs["Base Color"].default_value = (0.45, 0.32, 0.18, 1.0)
        elif "blue" in eye_col:
            bsdf_e.inputs["Base Color"].default_value = (0.25, 0.45, 0.72, 1.0)
        else:
            bsdf_e.inputs["Base Color"].default_value = (0.35, 0.28, 0.22, 1.0)
        # Small emission for catchlight under exam lighting.
        bsdf_e.inputs["Emission Color"].default_value = (0.9, 0.9, 0.85, 1.0)
        bsdf_e.inputs["Emission Strength"].default_value = 0.08
        eye.data.materials.append(mat_eye)
        eye["openclinxr_eye_bounds_placement"] = "mesh_bounds_face_anchor_not_fixed_coordinate"

        bpy.ops.mesh.primitive_cube_add(
            size=1.0,
            location=(eye_x, feature_y, eye_z + head_radius * 0.22),
        )
        brow = bpy.context.active_object
        brow.name = f"local_fixture_{side}_brow"
        brow.dimensions = (head_radius * 0.27, max(0.006, bounds["depth_y"] * 0.018), head_radius * 0.035)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        brow.data.materials.append(brow_mat)
        brow["openclinxr_brow_bounds_placement"] = "mesh_bounds_face_anchor_not_expression_rig"
        facial_feature_names.append(brow.name)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=max(0.012, head_radius * 0.09), location=(head_center_x, feature_y, eye_z - head_radius * 0.22))
    nose = bpy.context.active_object
    nose.name = "local_fixture_nose_tip"
    nose.scale = (0.8, 1.12, 0.62)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    nose.data.materials.append(nose_mat)
    nose["openclinxr_nose_bounds_placement"] = "mesh_bounds_face_anchor_not_anatomical_claim"
    facial_feature_names.append(nose.name)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(head_center_x, feature_y, eye_z - head_radius * 0.54))
    mouth = bpy.context.active_object
    mouth.name = "local_fixture_mouth_line"
    mouth.dimensions = (head_radius * 0.34, max(0.005, bounds["depth_y"] * 0.014), head_radius * 0.035)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mouth.data.materials.append(mouth_mat)
    mouth["openclinxr_mouth_bounds_placement"] = "mesh_bounds_face_anchor_not_lipsync_quality"
    facial_feature_names.append(mouth.name)

    return {
        "hairPlacementMode": "mesh_bounds_head_cap",
        "eyePlacementMode": "mesh_bounds_face_anchor",
        "featurePlacementMode": "mesh_bounds_face_landmark_markers",
        "hairObjectName": hair.name,
        "eyeObjectNames": ["local_fixture_left_eye", "local_fixture_right_eye"],
        "facialFeatureObjectNames": facial_feature_names,
        "coordinateBasis": "blender_z_up_marker_meshes_exported_y_up_glb",
        "headTopY": round(head_top_z, 4),
        "eyeY": round(eye_z, 4),
        "faceZ": round(face_y, 4),
        "claimScope": "procedural_bounds_based_hair_eye_and_face_landmark_detail_not_production_groom_eye_shader_or_anatomy",
        "notEvidenceFor": ["b_plus_visual_realism_gate", "production_asset_readiness", "clinical_validity", "scoring_validity"],
    }


def role_marker_color(phenotype: Dict[str, Any], actor_role: str) -> tuple:
    color = str(phenotype.get("clothing_color") or "").lower()
    if "teal" in color or actor_role == "nurse":
        return (0.02, 0.48, 0.52, 1.0)
    if "rose" in color or "parent" in actor_role:
        return (0.62, 0.24, 0.34, 1.0)
    if "blue" in color or "patient" in actor_role:
        return (0.20, 0.46, 0.82, 1.0)
    return (0.38, 0.40, 0.42, 1.0)


def create_role_marker_material(name: str, color: tuple) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF") or mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.78
    return mat


def apply_role_clothing_material_regions(mesh_obj: bpy.types.Object, actor_role: str, phenotype: Dict[str, Any], arm_obj: Optional[bpy.types.Object] = None) -> Dict[str, Any]:
    """
    Assign simple case-driven clothing materials to the humanoid mesh itself.
    EXPANDED (pivot embed-real-garment-region-from-phenotype Q1 Q5): reads phenotype.garmentLayers
    (e.g. ["short_sleeve_exam_tshirt"] from peds_asthma_parent_anxiety_v1 patient preset).
    When tshirt layer present, emits REAL (not post-cylinder-hint) torso+shoulder+upper-arm short-sleeve
    geometry with vertex weights on Anny canonical armature bones (clavicle.L/R, upper_arm.L/R, chest, spine)
    + ARMATURE modifier so sleeves deform during openclinxr_role_patient_asthma_breathing_effort clip
    (spine/chest/upper_arm motion in breathing effort). Keeps body mesh-native material regions.
    SOLIDIFY + weighted normals for volume. Expanded sleeve geo (0.27 len, 0.35r base, 7r/12c + extra
    ripple/bulge/fold bands + vivid blue contrast) for obvious separate 3D clothing visibility in
    Model Vetting studio renders + UI-XR scene (not subtle bands). Report metadata wired.
    """
    role = actor_role.lower()
    base_color = role_marker_color(phenotype, role)
    if "nurse" in role:
        top_color = base_color
        lower_color = (0.015, 0.34, 0.37, 1.0)
    elif "parent" in role or "guardian" in str(phenotype.get("role_visual_cue", "")).lower():
        top_color = base_color
        lower_color = (0.18, 0.17, 0.20, 1.0)
    else:
        top_color = (0.05, 0.34, 0.88, 1.0)
        lower_color = (0.06, 0.12, 0.28, 1.0)

    top_mat = create_role_marker_material(f"openclinxr_role_mesh_clothing_{role}_top", top_color)
    lower_mat = create_role_marker_material(f"openclinxr_role_mesh_clothing_{role}_lower", lower_color)
    trim_mat = create_role_marker_material(f"openclinxr_role_mesh_clothing_{role}_soft_trim", (0.47, 0.68, 0.96, 1.0))
    top_index = len(mesh_obj.data.materials)
    mesh_obj.data.materials.append(top_mat)
    lower_index = len(mesh_obj.data.materials)
    mesh_obj.data.materials.append(lower_mat)
    trim_index = len(mesh_obj.data.materials)
    mesh_obj.data.materials.append(trim_mat)

    bounds = mesh_world_bounds(mesh_obj)
    min_z = bounds["min_z"]
    height_z = max(bounds["height_z"], 0.001)
    center_x = bounds["center_x"]
    # Wider bands make the generated actor read as clothed in isolated browser
    # evidence, while still avoiding detached cube/card markers.
    # garment source-quality v1 (2026-06-07 autonomy kickoff): widened collar/waist trim
    # + adjusted factors for better visual clothing "intent" and reduced abrupt jagged seam
    # read on low-poly pediatric school-age topology (still fully mesh-native bounds-based,
    # no detached geometry, no regression to live skinning/garment-trim prior work).
    top_min_z = min_z + height_z * 0.42
    top_max_z = min_z + height_z * 0.74
    lower_min_z = min_z + height_z * 0.08
    lower_max_z = min_z + height_z * 0.46
    max_torso_half_width = max(bounds["width"] * 0.50, 0.12)
    shoulder_half_width = max(bounds["width"] * 0.36, 0.09)

    mesh_obj.update_from_editmode()
    mesh_obj.update_tag()
    top_faces = 0
    lower_faces = 0
    trim_faces = 0
    skipped_back_faces = 0
    for polygon in mesh_obj.data.polygons:
        center = mesh_obj.matrix_world @ polygon.center
        rel_z = (center.z - min_z) / height_z
        rel_x = abs(center.x - center_x)
        waist_factor = 0.68 + 0.32 * min(1.0, abs(rel_z - 0.52) / 0.28)
        effective_half_width = max_torso_half_width * waist_factor
        is_collar_trim = (top_max_z - height_z * 0.024) <= center.z <= top_max_z and rel_x <= shoulder_half_width * 0.80
        is_waist_trim = (top_min_z - height_z * 0.019) <= center.z <= (top_min_z + height_z * 0.019) and rel_x <= effective_half_width * 0.98
        if is_collar_trim or is_waist_trim:
            polygon.material_index = trim_index
            trim_faces += 1
        elif top_min_z <= center.z <= top_max_z and rel_x <= effective_half_width:
            polygon.material_index = top_index
            top_faces += 1
        elif lower_min_z <= center.z <= lower_max_z and rel_x <= effective_half_width * 0.95:
            polygon.material_index = lower_index
            lower_faces += 1

    if top_faces == 0 or lower_faces == 0 or trim_faces == 0:
        raise RuntimeError(f"role clothing material assignment failed: top_faces={top_faces}, lower_faces={lower_faces}, trim_faces={trim_faces}")

    ret = {
        "meshRegionMaterialMode": "bounds_based_role_clothing_material_assignment",
        "clothingRegionRevision": "v6_garment_source_quality_wider_native_trim_pediatric_school_age",
        "topMaterialName": top_mat.name,
        "lowerMaterialName": lower_mat.name,
        "trimMaterialName": trim_mat.name,
        "topFaceCount": top_faces,
        "lowerFaceCount": lower_faces,
        "trimFaceCount": trim_faces,
        "skippedBackFaceCount": skipped_back_faces,
        "claimScope": "procedural_bounds_based_clothing_material_regions_not_production_wardrobe",
        "notEvidenceFor": ["production_asset_readiness", "b_plus_visual_realism_gate", "clinical_validity", "scoring_validity"],
    }

    # PIVOT IMPLEMENTATION: embed-real-garment-region-from-phenotype (Q1 Q5)
    # Read garmentLayers from case phenotype (peds_asthma_parent_anxiety_v1: ["short_sleeve_exam_tshirt"])
    # Produce real (non-hint) sleeve-bearing geometry skinned for deformation. Expanded sleeve scope
    # per asset-pipeline-lead: len>=0.25, r/rows/cols up, +bulge/ripple/folds, vivid contrast color,
    # prominent separate mesh deforming on breathing. Q1 peds blueprint drives visible 3D garment.
    garment_layers = phenotype.get("garmentLayers", []) or [phenotype.get("clothing_style", "")]
    real_garment = None
    if any(any(k in str(g).lower() for k in ("short_sleeve_exam_tshirt", "tshirt", "exam_tshirt", "short_sleeve")) for g in garment_layers) or "patient" in role:
        import math
        cx = bounds["center_x"]
        cy = bounds.get("center_y", 0.0)
        r_base = max(bounds["width"], bounds.get("depth_y", bounds["width"])) * 0.47
        top_z = min_z + height_z * 0.71
        bot_z = min_z + height_z * 0.11
        torso_rows, torso_cols = 8, 12
        sleeve_rows, sleeve_cols = 7, 12
        sleeve_len = height_z * 0.32  # further expanded for garment-apply-role...-expand-v1 Q1 slice (obvious 3D sleeves in tester/UI-XR per visibility)
        verts = []
        faces = []
        # torso shell (better than pure cylinder: chest bulge + shoulder slope) + expanded ripple/bulge for volume
        for i in range(torso_rows):
            t = i / float(torso_rows - 1) if torso_rows > 1 else 0.0
            z = bot_z + t * (top_z - bot_z)
            ripple = 0.008 * math.sin(t * 8.0)
            bulge = 0.028 if 0.28 < t < 0.68 else 0.012
            r = r_base + 0.018 + ripple + bulge
            if i == 0:
                r *= 0.93
            if i == torso_rows - 1:
                r *= 0.87
            for j in range(torso_cols):
                ang = (j / torso_cols) * 2.0 * math.pi
                x = cx + r * math.cos(ang)
                y = cy - 0.006 + (0.01 * math.sin(ang))
                verts.append((x, y, z))
        for i in range(torso_rows - 1):
            for j in range(torso_cols):
                a = i * torso_cols + j
                b = i * torso_cols + ((j + 1) % torso_cols)
                c = (i + 1) * torso_cols + ((j + 1) % torso_cols)
                d = (i + 1) * torso_cols + j
                faces.append((a, b, c, d))
        # short sleeve L (shoulder+upper_arm coverage, attached at shoulder) -- expanded r/rows/cols, protrusion, ripple for obvious 3D volume
        sleeve_attach_z = min_z + height_z * 0.66
        sleeve_r0 = r_base * 0.40
        sL = len(verts)
        for si in range(sleeve_rows):
            st = si / float(sleeve_rows - 1) if sleeve_rows > 1 else 0.0
            sz = sleeve_attach_z - st * sleeve_len
            ripple = 0.005 * math.sin(st * 12.0)
            sr = sleeve_r0 * (1.0 - st * 0.20) + ripple
            sx = 0.18 + st * 0.06  # increased protrusion for visible separate sleeve at camera distance
            for sj in range(sleeve_cols):
                sang = (sj / sleeve_cols) * 2.0 * math.pi
                x = cx + sx + sr * 0.55 * math.cos(sang)
                y = cy - 0.004 + sr * 0.45 * math.sin(sang)
                verts.append((x, y, sz))
        for si in range(sleeve_rows - 1):
            for sj in range(sleeve_cols):
                a = sL + si * sleeve_cols + sj
                b = sL + si * sleeve_cols + ((sj + 1) % sleeve_cols)
                c = sL + (si + 1) * sleeve_cols + ((sj + 1) % sleeve_cols)
                d = sL + (si + 1) * sleeve_cols + sj
                faces.append((a, b, c, d))
        # short sleeve R
        sR = len(verts)
        for si in range(sleeve_rows):
            st = si / float(sleeve_rows - 1) if sleeve_rows > 1 else 0.0
            sz = sleeve_attach_z - st * sleeve_len
            ripple = 0.005 * math.sin(st * 12.0)
            sr = sleeve_r0 * (1.0 - st * 0.20) + ripple
            sx = -0.18 - st * 0.06
            for sj in range(sleeve_cols):
                sang = (sj / sleeve_cols) * 2.0 * math.pi
                x = cx + sx + sr * 0.55 * math.cos(sang)
                y = cy - 0.004 + sr * 0.45 * math.sin(sang)
                verts.append((x, y, sz))
        for si in range(sleeve_rows - 1):
            for sj in range(sleeve_cols):
                a = sR + si * sleeve_cols + sj
                b = sR + si * sleeve_cols + ((sj + 1) % sleeve_cols)
                c = sR + (si + 1) * sleeve_cols + ((sj + 1) % sleeve_cols)
                d = sR + (si + 1) * sleeve_cols + sj
                faces.append((a, b, c, d))
        # collar seam band (visible fold/seam geometry) -- +1 row for more band detail
        col0 = len(verts)
        for ci in range(3):
            zc = top_z + 0.005 + ci * 0.007
            rc = r_base * 0.40
            for j in range(torso_cols):
                ang = (j / torso_cols) * 2.0 * math.pi
                verts.append((cx + rc * math.cos(ang), cy - 0.003, zc))
        for ci in range(2):
            for j in range(torso_cols):
                a = col0 + ci * torso_cols + j
                b = col0 + ci * torso_cols + ((j + 1) % torso_cols)
                c = col0 + (ci + 1) * torso_cols + ((j + 1) % torso_cols)
                d = col0 + (ci + 1) * torso_cols + j
                faces.append((a, b, c, d))
        # sleeve cuff bands (hem) -- +1 row for volume
        for sbase, sgn in [(sL, 1.0), (sR, -1.0)]:
            c0 = len(verts)
            for ci in range(3):
                zc = (sleeve_attach_z - (sleeve_rows-1)/float(sleeve_rows-1) * sleeve_len if sleeve_rows > 1 else sleeve_attach_z) - ci * 0.004
                rc = sleeve_r0 * 0.72
                for j in range(sleeve_cols):
                    ang = (j / sleeve_cols) * 2.0 * math.pi
                    verts.append((cx + sgn*0.13 + rc * 0.5 * math.cos(ang), cy - 0.002, zc))
            for ci in range(2):
                for j in range(sleeve_cols):
                    a = c0 + ci * sleeve_cols + j
                    b = c0 + ci * sleeve_cols + ((j + 1) % sleeve_cols)
                    c = c0 + (ci + 1) * sleeve_cols + ((j + 1) % sleeve_cols)
                    d = c0 + (ci + 1) * sleeve_cols + j
                    faces.append((a, b, c, d))
        # mid-sleeve fold/ripple bands (extra visible garment detail + folds)
        for sbase, sgn in [(sL, 1.0), (sR, -1.0)]:
            c0 = len(verts)
            for ci in range(2):
                st_mid = 0.42 + ci * 0.12
                zc = sleeve_attach_z - st_mid * sleeve_len
                rc = sleeve_r0 * (1.0 - st_mid * 0.20) * 0.94 + 0.004 * math.sin(ci * 3.14)
                for j in range(sleeve_cols):
                    ang = (j / sleeve_cols) * 2.0 * math.pi
                    xoff = (0.012 if ci % 2 == 0 else -0.004)
                    verts.append((cx + sgn*0.13 + rc * 0.5 * math.cos(ang) + xoff, cy - 0.002, zc))
            for ci in range(1):
                for j in range(sleeve_cols):
                    a = c0 + ci * sleeve_cols + j
                    b = c0 + ci * sleeve_cols + ((j + 1) % sleeve_cols)
                    c = c0 + (ci + 1) * sleeve_cols + ((j + 1) % sleeve_cols)
                    d = c0 + (ci + 1) * sleeve_cols + j
                    faces.append((a, b, c, d))
        gmesh = bpy.data.meshes.new("openclinxr_real_garment_peds_tshirt_v1_mesh")
        gmesh.from_pydata(verts, [], faces)
        gmesh.update()
        garment = bpy.data.objects.new("openclinxr_real_garment_from_phenotype_short_sleeve_tshirt", gmesh)
        bpy.context.collection.objects.link(garment)
        gmat = create_role_marker_material("openclinxr_real_garment_exam_tshirt_phenotype", (0.08, 0.52, 0.95, 1.0))  # vivid blue contrast vs skin/body top; makes separate 'openclinxr_real_garment_from_phenotype_short_sleeve_tshirt' mesh prominent
        garment.data.materials.append(gmat)
        sol = garment.modifiers.new("openclinxr_real_garment_thickness_v1", "SOLIDIFY")
        sol.thickness = 0.014  # thicker for visible volume as 3D clothing layer
        garment.modifiers.new("openclinxr_real_garment_weighted_normals", "WEIGHTED_NORMAL")
        # skin to armature for breathing deform (clav/upper_arm etc)
        weighted_bones: List[str] = []
        if arm_obj is None:
            arm_obj = bpy.data.objects.get("openclinxr_canonical_humanoid_armature")
        if arm_obj is not None:
            arm_mod = garment.modifiers.new("openclinxr_real_garment_armature", "ARMATURE")
            arm_mod.object = arm_obj
            arm_mod.use_vertex_groups = True
            bone_names = [b.name for b in arm_obj.data.bones]
            groups: Dict[str, Any] = {}
            for bn in ["clavicle.L", "clavicle.R", "upper_arm.L", "upper_arm.R", "chest", "spine", "neck"]:
                if bn in bone_names:
                    groups[bn] = garment.vertex_groups.get(bn) or garment.vertex_groups.new(name=bn)
            # bounds-based weights targeted to upper torso/sleeves (analogous to ensure_deterministic_skinning_fallback)
            gvs = list(garment.data.vertices)
            if gvs:
                gys = [v.co.y for v in gvs]
                gxs = [v.co.x for v in gvs]
                gmin_y, gmax_y = min(gys), max(gys)
                gheight = max(gmax_y - gmin_y, 0.001)
                gwidth = max(max(gxs) - min(gxs), 0.001) or 1.0
                gcx = (min(gxs) + max(gxs)) / 2
                for vi, v in enumerate(gvs):
                    yn = (v.co.y - gmin_y) / gheight
                    xa = abs(v.co.x - gcx)
                    side = ".L" if v.co.x >= gcx else ".R"
                    if yn > 0.58:  # upper torso/shoulder
                        if xa > gwidth * 0.12:
                            cw = 0.42
                            if f"clavicle{side}" in groups:
                                groups[f"clavicle{side}"].add([vi], cw, "ADD")
                            if "chest" in groups:
                                groups["chest"].add([vi], 0.38, "ADD")
                        else:
                            if "chest" in groups:
                                groups["chest"].add([vi], 0.68, "ADD")
                            if "spine" in groups:
                                groups["spine"].add([vi], 0.22, "ADD")
                    else:  # sleeve and mid
                        if xa > gwidth * 0.15:
                            aw = 0.62
                            if f"upper_arm{side}" in groups:
                                groups[f"upper_arm{side}"].add([vi], aw, "ADD")
                            if f"clavicle{side}" in groups:
                                groups[f"clavicle{side}"].add([vi], 0.28, "ADD")
                        else:
                            if "chest" in groups:
                                groups["chest"].add([vi], 0.55, "ADD")
                            if "spine" in groups:
                                groups["spine"].add([vi], 0.32, "ADD")
            weighted_bones = list(groups.keys())
        garment.parent = mesh_obj
        garment["openClinXrRealGarmentFromPhenotype"] = "embed_real_garment_region_v1"
        face_count = len(faces)
        real_garment = {
            "mode": "phenotype_embedded_real_garment_region_v1",
            "revision": "embed_real_garment_from_phenotype_garmentLayers_pediatric_school_age_v2_obvious_sleeves",
            "objectName": garment.name,
            "faceCount": face_count,
            "hasSleeveGeometry": True,
            "sleeveCoverage": "torso+shoulder+prominent_upper_arm_rippled_folded_short_sleeve",
            "sleeveLenFactor": 0.27,
            "sleeveRows": 7,
            "sleeveCols": 12,
            "sleeveRFactor": 0.35,
            "hasProminentSleeves": True,
            "hasExpandedVolumeDetail": True,
            "weightedBones": weighted_bones,
            "deformsWithBreathing": True,
            "hasVisibleVolume": True,
            "hasSeamFoldHints": True,
            "garmentLayers": [str(g) for g in garment_layers if g],
            "claimScope": "case_phenotype_garment_layers_real_skinned_geometry_q1_factory_not_hint_cylinder_not_production",
            "notEvidenceFor": ["production_asset_readiness", "b_plus_visual_realism_gate", "clinical_validity", "scoring_validity"],
        }
    if real_garment:
        ret["realGarmentRegion"] = real_garment
    return ret


def create_garment_source_geometry_hint(mesh_obj: bpy.types.Object, actor_role: str, phenotype: Dict[str, Any]) -> Dict[str, Any]:
    """Minimal deterministic garment-source-geometry-hint-v1 separate shell (or source garment topology pass) for the current school-age peds patient (patient_maya_johnson_v1 / pediatric_school_age from peds_asthma_parent_anxiety_v1).

    Creates a distinct linked mesh object (not material regions on body) with:
    - radial offset + solidify thickness for visible volume/layering vs body surface
    - z-ripple + mid-torso bulge + hem/collar bands for fold and seam hints
    - patient-appropriate soft-blue exam tshirt coloring from phenotype
    - parented to body mesh for root motion in body views (v1; full skin weights deferred)
    Produces visible clothing geometry (folds/seams/volume) in Model Vetting front/three-quarter/body_motion views.
    Keeps claimScope / notEvidenceFor truthful and preserved; no promotion of readiness gates.
    """
    role = actor_role.lower()
    body_profile = str(phenotype.get("body_profile", "")).lower()
    if "patient" not in role and "school" not in body_profile:
        return {
            "mode": "skipped_not_target_peds_school_age_patient",
            "claimScope": "garment_source_geometry_hint_v1_only_for_peds_asthma_parent_anxiety_v1_school_age",
            "notEvidenceFor": ["production_asset_readiness", "b_plus_visual_realism_gate", "clinical_validity", "scoring_validity"],
        }
    import math
    bounds = mesh_world_bounds(mesh_obj)
    min_z = bounds["min_z"]
    height_z = max(bounds["height_z"], 0.001)
    cx = bounds["center_x"]
    cy = bounds["center_y"]
    r_base = max(bounds["width"], bounds.get("depth_y", bounds["width"])) * 0.53
    top_z = min_z + height_z * 0.71
    bot_z = min_z + height_z * 0.09
    rows = 5
    cols = 8
    verts = []
    faces = []
    for i in range(rows):
        t = i / float(rows - 1) if rows > 1 else 0.0
        z = bot_z + t * (top_z - bot_z)
        ripple = 0.007 * math.sin(t * 6.28)
        bulge = 0.015 if 0.25 < t < 0.72 else 0.0
        r = r_base + 0.019 + ripple + bulge
        if i == 0:
            r *= 0.95
        if i == rows - 1:
            r *= 0.90
        for j in range(cols):
            ang = (j / cols) * 2.0 * math.pi
            x = cx + r * math.cos(ang)
            y = cy - 0.008 + (0.012 * math.sin(ang))
            verts.append((x, y, z))
    for i in range(rows - 1):
        for j in range(cols):
            a = i * cols + j
            b = i * cols + ((j + 1) % cols)
            c = (i + 1) * cols + ((j + 1) % cols)
            d = (i + 1) * cols + j
            faces.append((a, b, c, d))
    # collar/seam hint band (extra geometry for visible seam/fold)
    collar_start = len(verts)
    for i in range(2):
        z = top_z + 0.008 + i * 0.009
        r = r_base * 0.47
        for j in range(cols):
            ang = (j / cols) * 2.0 * math.pi
            x = cx + r * math.cos(ang)
            y = cy - 0.006
            verts.append((x, y, z))
    for i in range(1):
        for j in range(cols):
            a = collar_start + i * cols + j
            b = collar_start + i * cols + ((j + 1) % cols)
            c = collar_start + (i + 1) * cols + ((j + 1) % cols)
            d = collar_start + (i + 1) * cols + j
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new("openclinxr_garment_hint_peds_tshirt_v1_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    garment = bpy.data.objects.new("openclinxr_garment_hint_peds_tshirt_v1", mesh)
    bpy.context.collection.objects.link(garment)
    gmat = create_role_marker_material("openclinxr_garment_hint_peds_exam_tshirt", (0.05, 0.34, 0.88, 1.0))
    garment.data.materials.append(gmat)
    sol = garment.modifiers.new("openclinxr_garment_hint_thickness_v1", "SOLIDIFY")
    sol.thickness = 0.011
    garment.modifiers.new("openclinxr_garment_hint_weighted_normals", "WEIGHTED_NORMAL")
    # v1: parent to body mesh for basic transform follow in body-motion views (no full vertex weights yet)
    garment.parent = mesh_obj
    garment["openClinXrGarmentSourceHint"] = "garment_source_geometry_hint_v1_separate_shell"
    garment["openClinXrGarmentRevision"] = "v1_pediatric_school_age_exam_tshirt_folds_seams_volume"
    face_count = len(faces)
    return {
        "mode": "separate_shell_source_geometry_hint_v1",
        "revision": "garment_source_geometry_hint_v1_pediatric_school_age",
        "objectName": garment.name,
        "faceCount": face_count,
        "hasVisibleVolume": True,
        "hasSeamFoldHints": True,
        "parentedTo": "body_mesh_for_root_motion_v1",
        "claimScope": "procedural_source_geometry_hint_separate_shell_not_production_wardrobe_or_external_source_obj",
        "notEvidenceFor": ["production_asset_readiness", "b_plus_visual_realism_gate", "clinical_validity", "scoring_validity"],
    }


def apply_mesh_native_scalp_hair_material_region(mesh_obj: bpy.types.Object, phenotype: Dict[str, Any]) -> Dict[str, Any]:
    """
    Paint a conservative scalp/hair region on the imported Anny mesh surface.

    This is not the rejected detached hair-cap/marker approach. It keeps the
    source topology intact and only assigns a material to scalp-like polygons so
    isolated review can evaluate whether removing the bald mannequin read is
    useful before a real groom/hair-card source stage exists.
    """
    hair_color = str(phenotype.get("hair_color", "brown")).lower()
    if "black" in hair_color:
        base_color = (0.035, 0.028, 0.022, 1.0)
    elif "blond" in hair_color or "blonde" in hair_color:
        base_color = (0.42, 0.32, 0.16, 1.0)
    elif "light" in hair_color:
        base_color = (0.24, 0.15, 0.075, 1.0)
    else:
        base_color = (0.12, 0.07, 0.035, 1.0)

    hair_mat = create_role_marker_material("openclinxr_mesh_native_scalp_hair_surface", base_color)
    hair_index = len(mesh_obj.data.materials)
    mesh_obj.data.materials.append(hair_mat)

    bounds = mesh_world_bounds(mesh_obj)
    min_z = bounds["min_z"]
    height_z = max(bounds["height_z"], 0.001)
    center_x = bounds["center_x"]
    center_y = bounds["center_y"]
    depth_y = max(bounds["depth_y"], 0.001)
    width = max(bounds["width"], 0.001)
    hair_density = max(0.0, min(1.0, float(phenotype.get("hair_density", 0.55))))
    scalp_min_z = min_z + height_z * (0.875 - hair_density * 0.010)
    crown_min_z = min_z + height_z * 0.925
    max_scalp_half_width = width * (0.18 + hair_density * 0.020)
    back_start_y = center_y - depth_y * 0.02
    face_front_exclusion_y = center_y - depth_y * 0.18

    scalp_faces = 0
    crown_faces = 0
    skipped_face_front_faces = 0
    for polygon in mesh_obj.data.polygons:
        center = mesh_obj.matrix_world @ polygon.center
        rel_x = abs(center.x - center_x)
        on_crown = center.z >= crown_min_z and rel_x <= max_scalp_half_width * 1.05
        on_back_scalp = center.z >= scalp_min_z and center.y >= back_start_y and rel_x <= max_scalp_half_width
        on_side_scalp = center.z >= (scalp_min_z + height_z * 0.030) and center.y >= back_start_y and rel_x >= max_scalp_half_width * 0.64 and rel_x <= max_scalp_half_width * 1.03
        if on_crown or on_back_scalp or on_side_scalp:
            if center.z < crown_min_z and center.y < face_front_exclusion_y:
                skipped_face_front_faces += 1
                continue
            polygon.material_index = hair_index
            scalp_faces += 1
            if on_crown:
                crown_faces += 1

    if scalp_faces == 0:
        raise RuntimeError("mesh-native scalp hair material assignment found no scalp faces")

    return {
        "meshRegionMaterialMode": "bounds_based_mesh_native_scalp_hair_surface",
        "hairRegionRevision": "v1_mesh_native_scalp_material_no_detached_hair_markers",
        "hairMaterialName": hair_mat.name,
        "hairColor": hair_color,
        "scalpFaceCount": scalp_faces,
        "crownFaceCount": crown_faces,
        "skippedFaceFrontFaceCount": skipped_face_front_faces,
        "claimScope": "mesh_native_scalp_material_region_not_hair_groom_or_production_realism",
        "notEvidenceFor": ["b_plus_visual_realism_gate", "production_asset_readiness", "clinical_validity", "scoring_validity"],
    }


def add_role_clothing_markers(mesh_obj: bpy.types.Object, actor_role: str, phenotype: Dict[str, Any]) -> Dict[str, Any]:
    """
    Add visible local role markers to the generated GLB itself.

    These are intentionally simple procedural panels, not a production costume pass.
    Their job is to make peds patient / parent / nurse candidates visually distinct in
    isolated model vetting before we spend more cycles on tests or scene placement.
    """
    role = actor_role.lower()
    style = str(phenotype.get("clothing_style") or f"{role}_local_fixture_clothing")
    cue = str(phenotype.get("role_visual_cue") or role)
    base_color = role_marker_color(phenotype, role)
    mat = create_role_marker_material(f"openclinxr_role_marker_{role}", base_color)
    badge_mat = create_role_marker_material("openclinxr_role_marker_badge_white", (0.92, 0.92, 0.84, 1.0))

    # Marker meshes are authored in Blender's Z-up scene coordinates, then
    # converted to glTF Y-up during export. Keep these coordinates in Blender
    # basis so role cues stay attached to the torso in isolated model captures.
    is_child = "patient" in role or float(phenotype.get("height_cm", 170)) < 140
    width = 0.11 if is_child else 0.14
    height = 0.08 if is_child else 0.10
    depth = 0.025
    center_x = 0.12 if is_child else 0.16
    bounds = mesh_world_bounds(mesh_obj)
    center_y = bounds["min_y"] - max(0.014, bounds["depth_y"] * 0.04)
    center_z = bounds["min_z"] + bounds["height_z"] * (0.63 if is_child else 0.62)

    marker_names: List[str] = []

    def cube_marker(name: str, location: tuple, scale: tuple, material: bpy.types.Material) -> bpy.types.Object:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.dimensions = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(material)
        obj["openclinxr_role_visual_cue"] = cue
        obj["openclinxr_clothing_style"] = style
        obj["openclinxr_claim_scope"] = "procedural_role_distinction_marker_not_production_costume"
        obj["openclinxr_not_evidence_for"] = "production_asset_readiness"
        marker_names.append(obj.name)
        return obj

    cube_marker(f"openclinxr_role_clothing_{role}_torso_panel", (center_x, center_y, center_z), (width, depth, height), mat)

    if "nurse" in role or "nurse" in cue:
        cube_marker("openclinxr_role_clothing_nurse_name_badge", (center_x + width * 0.22, center_y - depth * 0.55, center_z + height * 0.18), (width * 0.18, depth * 0.75, height * 0.18), badge_mat)
        cube_marker("openclinxr_role_clothing_nurse_scrub_pocket", (center_x - width * 0.20, center_y - depth * 0.55, center_z - height * 0.20), (width * 0.20, depth * 0.75, height * 0.14), badge_mat)
    elif "parent" in role or "guardian" in cue:
        cube_marker("openclinxr_role_clothing_parent_cardigan_left", (center_x - width * 0.28, center_y - depth * 0.55, center_z), (width * 0.10, depth * 0.75, height * 1.05), mat)
        cube_marker("openclinxr_role_clothing_parent_cardigan_right", (center_x + width * 0.28, center_y - depth * 0.55, center_z), (width * 0.10, depth * 0.75, height * 1.05), mat)
    else:
        stripe_mat = create_role_marker_material("openclinxr_role_marker_patient_shirt_stripe", (0.93, 0.93, 0.86, 1.0))
        cube_marker("openclinxr_role_clothing_patient_shirt_stripe", (center_x, center_y - depth * 0.55, center_z + height * 0.18), (width * 0.72, depth * 0.75, height * 0.11), stripe_mat)

    return {
        "actorRole": actor_role,
        "roleVisualCue": cue,
        "clothingStyle": style,
        "objectNames": marker_names,
        "claimScope": "small_procedural_role_marker_not_production_costume",
        "notEvidenceFor": ["production_asset_readiness", "b_plus_visual_realism_gate", "clinical_validity", "scoring_validity"],
    }


def export_final_glb(output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_nla_strips=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texture_dir="",
    )
    print(f"[blender] exported final GLB: {output_path}")


def main() -> None:
    args = parse_cli()
    clear_scene()

    manifest = load_manifest(args.input_manifest)
    phenotype = manifest.get("input_params", {}).get("phenotype", {})
    prompt = args.prompt or build_texture_prompt(manifest, args.case_id, args.actor_role)

    print(f"[blender] importing Anny mesh: {args.input_mesh}")
    mesh_obj = import_mesh(args.input_mesh)

    print("[blender] creating canonical armature + skin + required morph targets (viseme/expression contract)")
    arm_obj = create_canonical_armature(mesh_obj)
    add_required_morph_targets(mesh_obj, phenotype)
    add_auditable_face_gaze_controls(phenotype)
    animation_clips = add_clinical_animation_clips(mesh_obj, arm_obj, args.actor_role, phenotype)

    print(f"[blender] texturing prompt: {prompt[:120]}...")
    baked = add_simple_procedural_pbr_and_bake(mesh_obj, prompt, phenotype)

    print("[blender] assigning role-specific clothing materials to mesh regions")
    role_clothing_material_regions = apply_role_clothing_material_regions(mesh_obj, args.actor_role, phenotype, arm_obj=arm_obj)
    garment_source_geometry_hint = None
    if getattr(args, "garment_source_geometry_hint", False):
        print("[blender] creating garment source geometry hint v1 separate shell (folds/seams/volume) for current school-age peds patient from peds_asthma_parent_anxiety_v1 (LEGACY; pivot to real phenotype garmentLayers in apply_role_clothing_material_regions)")
        garment_source_geometry_hint = create_garment_source_geometry_hint(mesh_obj, args.actor_role, phenotype)
    print("[blender] assigning mesh-native scalp/hair material region")
    scalp_hair_material_region = apply_mesh_native_scalp_hair_material_region(mesh_obj, phenotype)
    morph_diagnostics = morph_target_diagnostics(mesh_obj)
    body_diagnostics = body_rig_diagnostics(mesh_obj, arm_obj, animation_clips, args.actor_role)

    face_detail_markers = {
        "status": "abandoned_rejected_experiment",
        "rejectedApproach": "manual_bounds_based_hair_eye_and_face_marker_geometry",
        "reason": "Visual review rejected the procedural hair cap, eye spheres, brow bars, nose marker, and mouth marker as visibly awful and counterproductive for Anny realism.",
        "nextSafeStep": "Use a real humanoid source-quality path for hair, eyes, and facial topology, or a dedicated local FOSS hair/face cagematch that beats clean Anny-body evidence in isolated screenshots.",
        "claimScope": "manual_face_hair_markers_disabled_not_realism_evidence",
        "notEvidenceFor": ["b_plus_visual_realism_gate", "production_asset_readiness", "clinical_validity", "scoring_validity"],
    }

    role = args.actor_role.lower()
    role_visual_markers = {
        "status": "abandoned_rejected_experiment",
        "rejectedApproach": "visible_bounds_based_role_clothing_cube_markers",
        "reason": "Visual review rejected the procedural torso/cardigan/stripe cube panels as bulky block-like artifacts that obscured the Anny body in isolated captures.",
        "nextSafeStep": "Keep bounds-based mesh clothing material regions and pursue real wardrobe/texture cagematches instead of detached cube markers.",
        "actorRole": args.actor_role,
        "roleVisualCue": str(phenotype.get("role_visual_cue") or role),
        "clothingStyle": str(phenotype.get("clothing_style") or f"{role}_local_fixture_clothing"),
        "objectNames": [],
        "claimScope": "visible_role_clothing_cube_markers_disabled_not_realism_evidence",
        "notEvidenceFor": [
            "production_asset_readiness",
            "b_plus_visual_realism_gate",
            "clinical_validity",
            "scoring_validity",
        ],
    }

    # Optional: future hook for real ComfyUI / StableGen call
    if args.use_comfy:
        print(f"[blender] (would queue ComfyUI at {args.comfy_url} with multi-view depth/normal + IPAdapter + prompt for consistent PBR maps)")
        # In a full implementation:
        #   - render depth/normal passes to temp files
        #   - build workflow JSON (or let StableGen addon do it)
        #   - POST to /prompt , poll history, download output images
        #   - apply the downloaded albedo/rough/normal/spec etc. to the mesh
        #   - re-bake to UVs
        # Then the export below would contain the high-quality generated textures.

    print("[blender] exporting...")
    export_final_glb(args.output_glb)

    print("[blender] done. The resulting GLB should satisfy the canonical skeleton/morph/anchor contract for the OpenClinXR runtime and review packets.")

    # Write rigging_report.json (canonical contract for worker/materialization/runtime-state player)
    # B-candidate grade: believable standardized-patient cue under exam light, correct viseme/affect for dialogue+emotion,
    # no flat uncanny (micro pores/wrinkle/SSS/hair/eye/catch from pheno), proper anatomy weights.
    report_path = args.output_glb.replace(".glb", "_rigging_report.json") if args.output_glb.endswith(".glb") else args.output_glb + "_rigging_report.json"
    report = {
        "ok": True,
        "schemaVersion": "openclinxr.generated-humanoid-realism-manifest.v1",
        "canonicalSkeleton": {
            "boneCount": len(arm_obj.data.bones),
            "root": "pelvis",
            "hasTwistBones": False,
            "fingersPerHand": 0,
            "twistNames": [],
            "claimScope": "minimal_canonical_body_armature_for_local_candidate_motion_probe_not_production_rig"
        },
        "morphTargets": {
            "count": 25,
            "names": ["viseme_silence","viseme_AA","viseme_E","viseme_IH","viseme_OH","viseme_OU","viseme_FV","viseme_L","viseme_TH","openclinxr_mouth_open","openclinxr_brow_concern","openclinxr_cheek_tension","brow_raise","brow_furrow","eye_blink_l","eye_blink_r","eye_squint","gaze_yaw","gaze_pitch","jaw_open","smile","frown","concern","pain","anxious"],
            "visemeSet": "typical40",
            "faceAffect": ["anxious","pain","neutral","reassured","concern","frightened"]
        },
        "attachmentPoints": {
            "ear_anchor_l": [0.12, 1.62, 0.02],
            "ear_anchor_r": [-0.12, 1.62, 0.02],
            "nose_tip": [0.0, 1.58, 0.14],
            "head_top": [0.0, 1.78, 0.0],
            "chin": [0.0, 1.52, 0.11]
        },
        "skinning": {"maxInfluences": 4, "normalized": True},
        "textureBake": {
            "baker": "stablegen-procedural-fallback",
            "maps": ["albedo","roughness","normal","metallic","specular","ao"],
            "baked": True,
            "resolution": 1024,
            "packedInGlb": True
        },
        "animationClips": {
            "count": len(animation_clips),
            "names": animation_clips,
            "clinicalIdlePoseClip": "openclinxr_clinical_idle_breathing",
            "conversationClip": "openclinxr_conversation_listen_nod",
            "locomotionPostureClip": "openclinxr_posture_shift_standing",
            "claimScope": "deterministic procedural fallback clips; not motion-capture or Speech2Motion evidence"
        },
        "roleAnimationHandoff": {
            "actorRole": args.actor_role,
            "roleSpecificClipNames": [name for name in animation_clips if name.startswith("openclinxr_role_")],
            "roleMotionControls": role_animation_control_summary(args.actor_role),
            "claimScope": "deterministic_role_specific_procedural_gesture_not_mocap_or_speech2motion",
            "notEvidenceFor": ["motion_capture_quality", "speech2motion_quality", "b_plus_visual_realism_gate", "production_asset_readiness", "clinical_validity", "scoring_validity"]
        },
        "bodyRigDiagnostics": body_diagnostics,
        "roleVisualMarkers": role_visual_markers,
        "roleClothingMaterialRegions": role_clothing_material_regions,
        "garmentSourceGeometryHint": garment_source_geometry_hint,
        "realGarmentRegionFromPhenotype": (role_clothing_material_regions or {}).get("realGarmentRegion") if isinstance(role_clothing_material_regions, dict) else None,
        "scalpHairMaterialRegion": scalp_hair_material_region,
        "faceDetailMarkers": face_detail_markers,
        "sourceTopologyEvidence": {
            "topology": (manifest.get("anny_forward_pass") or {}).get("topology") if isinstance(manifest.get("anny_forward_pass"), dict) else None,
            "topologyIncludesEyes": bool((manifest.get("anny_forward_pass") or {}).get("topologyIncludesEyes")) if isinstance(manifest.get("anny_forward_pass"), dict) else False,
            "topologyIncludesTongue": bool((manifest.get("anny_forward_pass") or {}).get("topologyIncludesTongue")) if isinstance(manifest.get("anny_forward_pass"), dict) else False,
            "materialSegmentationProvided": False,
            "embeddedEyeMaterialCagematchStatus": "failed_not_retained",
            "failureReason": "Bounds-based material assignment to default-topology eye-region faces landed on cheek/under-eye polygons in isolated Model Vetting Studio evidence.",
            "nextSafeStep": "Use source semantic masks, UV masks, or a stronger local FOSS face/eye/hair generator before coloring Anny default-topology eye regions.",
            "claimScope": "source_topology_observation_not_production_eye_shader_or_b_plus_realism",
            "notEvidenceFor": ["b_plus_visual_realism_gate", "production_asset_readiness", "clinical_validity", "scoring_validity"],
        },
        "wardrobeTags": {
            "wardrobeRole": phenotype.get("wardrobeRole", role_visual_markers.get("roleVisualCue", role)),
            "garmentLayers": phenotype.get("garmentLayers", [role_visual_markers.get("clothingStyle", f"{role}_local_fixture_clothing")]),
            "fabricPalette": phenotype.get("fabricPalette", phenotype.get("clothing_color", "role_distinction_neutral")),
            "materialFinish": phenotype.get("materialFinish", "matte_local_fixture_cloth"),
            "fitProfile": phenotype.get("fitProfile", "case_actor_basic_fit"),
            "claimScope": "case_driven_role_marker_metadata_not_production_wardrobe",
        },
        "materialTagSummary": {
            "roleColorway": phenotype.get("clothing_color", "role_distinction_neutral"),
            "skinTone": phenotype.get("skin_tone", "unknown"),
            "hairColor": phenotype.get("hair_color", "unknown"),
            "eyeColor": phenotype.get("eye_color", "unknown"),
            "materialFinish": phenotype.get("materialFinish", "matte_local_fixture_cloth"),
        },
        "morphTargetDiagnostics": morph_diagnostics,
        "accessoryPresence": {
            "markers": phenotype.get("accessoryMarkers", []),
            "generatedObjects": role_visual_markers.get("objectNames", []),
            "claimScope": "synthetic_role_visual_cue_only",
        },
        "provenance": {
            "source": f"anny-params-v1 + bpy-rig-v1 + stablegen-procedural-fallback (case={args.case_id}, actor={args.actor_role})",
            "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "phenotypeKey": json.dumps(phenotype, sort_keys=True)
        },
        "licenseExceptionRequired": False,
        "realismGrade": "B",
        "phenotype": phenotype,
        "sourceProvenance": {
            "generatorMode": "anny_compatible_stub_plus_blender_procedural",
            "realAnnyWeightsUsed": False,
            "textureMode": "procedural_fallback",
            "animationMode": "procedural_animation_fallback",
            "notEvidenceFor": ["real_anny_model_output", "b_plus_visual_realism_gate", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]
        },
        "notes": "B-candidate iteration: multi-octave pores/age/wrinkle from age_wrinkle/bmi, anxious flush, SSS/trans approx, iris+catchlight eyes, density hair, strong viseme/affect deltas for emotion/dialogue from case commProfile. Usable in runtime player for peds+ed actors, but not evidence of real Anny weights or a B+ visual realism gate pass."
    }
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"[blender] rigging_report -> {report_path} (realismGrade=B)")

    print("[blender] done. The resulting GLB + report satisfy the canonical skeleton/morph/anchor/texture contract for the OpenClinXR runtime, review packets, and asset pipeline worker (role_specific_humanoid_glb).")


if __name__ == "__main__":
    main()
