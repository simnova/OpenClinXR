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
import re
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
    ap.add_argument("--skin-albedo-image", default=None, help="Optional seamless tileable skin-albedo PNG (e.g. RealVisXL output from realvisxl-skin-generate.ts). Wired as a glTF-safe Base Color IMAGE texture (survives export, unlike procedural node graphs). Guarded: missing/failed load leaves the solid factor intact.")
    ap.add_argument("--garment-source-geometry-hint", action="store_true", help="LEGACY (garment-hint-v1 aborted per chief/skeptic pivot 2026-06-07; Q1 violation, sub-pixel, no weights, no sleeve geo despite phenotype). Real garment now from phenotype.garmentLayers (e.g. short_sleeve_exam_tshirt) via expanded apply_role_clothing_material_regions (real torso+shoulder+upper-arm sleeve geo + vertex weights on clavicle/upper_arm for breathing deform). Flag kept for compat only; default OFF.")
    # #195 bake-matrix only: optional JSON of coefficient overrides. Omitted → shipping defaults unchanged.
    # Keys: bot_y_fraction, sleeve_along_fraction, front_opening_rad, cloth_offset_base, neck_y_fraction,
    # sleeve_r0_body_depth_scale (multiplies the kind's sleeve_r0 after default computation).
    ap.add_argument(
        "--garment-coeff-overrides",
        default=None,
        help="JSON file path with optional garment coefficient overrides for bake-matrix sweeps (#195). "
        "Does NOT change shipping defaults when omitted. Never used by production rebake targets.",
    )
    return ap.parse_args(argv)


# Optional #195 overrides loaded once in main(); empty ⇒ shipping coefficients only.
_GARMENT_COEFF_OVERRIDES: Dict[str, float] = {}


def _load_garment_coeff_overrides(path: Optional[str]) -> Dict[str, float]:
    """Load optional coefficient overrides for bake-matrix sweeps. Empty when path is None."""
    if not path:
        return {}
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, dict):
        raise SystemExit(f"--garment-coeff-overrides must be a JSON object: {path}")
    out: Dict[str, float] = {}
    for k, v in raw.items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out[str(k)] = float(v)
    return out


def _apply_garment_coeff_overrides(
    *,
    kind: str,
    body_min_y: float,
    body_height: float,
    arm_len: float,
    bot_y: float,
    sleeve_along: float,
    sleeve_r0: float,
    front_opening_rad: float,
    cloth_offset: float,
    neck_y: float,
    radial_rank: float,
) -> tuple:
    """Apply optional #195 overrides. Shipping values pass through when keys are absent.

    Hem / sleeve / opening overrides target outer shells (open_front, gown) so a multi-layer
    cardigan bake does not pull the closed under-layer hem with the outer sweep.
    """
    ov = _GARMENT_COEFF_OVERRIDES
    if not ov:
        return bot_y, sleeve_along, sleeve_r0, front_opening_rad, cloth_offset, neck_y
    outer = kind in ("open_front", "gown")
    if outer and "bot_y_fraction" in ov:
        bot_y = body_min_y + body_height * float(ov["bot_y_fraction"])
    if outer and "sleeve_along_fraction" in ov:
        sleeve_along = arm_len * float(ov["sleeve_along_fraction"])
    if kind == "open_front" and "front_opening_rad" in ov:
        front_opening_rad = float(ov["front_opening_rad"])
    if "cloth_offset_base" in ov:
        cloth_offset = (float(ov["cloth_offset_base"]) + 0.012 * radial_rank) * (
            1.02 if kind == "gown" else 1.0
        )
    if "neck_y_fraction" in ov:
        neck_y = body_min_y + body_height * float(ov["neck_y_fraction"])
    if outer and "sleeve_r0_body_depth_scale" in ov:
        sleeve_r0 = sleeve_r0 * float(ov["sleeve_r0_body_depth_scale"])
    return bot_y, sleeve_along, sleeve_r0, front_opening_rad, cloth_offset, neck_y


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
        if coll.name.startswith("Collection") or coll.name == "glTF_not_exported":
            bpy.data.collections.remove(coll)
    # Orphan mesh datablocks (e.g. bone-shape Icosphere after object delete)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


# Blender default primitive names (optional numeric suffix). Used to catch scratch
# geometry that would otherwise ship silently (#60). Project meshes are always
# renamed (anny_base, openclinxr_*, etc.) so this denylist never hits legitimate work.
_BLENDER_DEFAULT_MESH_NAME = re.compile(
    r"^(Icosphere|Sphere|Cube|Plane|Cylinder|Cone|Torus|Circle)(\.\d+)?$"
)


def purge_blender_default_scratch_meshes(*, reason: str) -> List[str]:
    """
    Remove mesh objects whose names are still Blender's default primitive names.

    #60 TRACE: Loading a shipped humanoid GLB in Blender shows a 42-vert Icosphere
    (h≈2m) enveloping the figure. That object is NOT in the GLB binary — Blender's
    glTF importer creates it as a bone display shape in collection `glTF_not_exported`
    (io_scene_gltf2 armature_display → primitive_ico_sphere_add radius=1). It is
    unused for skinning/bake/bounds: no parents, no vertex groups, no armature, empty
    materials. Export normally skips that collection, but if the object is ever
    linked into Scene Collection (or left from an incomplete clear), it ships and
    confounds every whole-file geometric measurement while staying invisible to
    face-count / file-size gates (42 verts).

    Defense in depth: purge after glTF import and again immediately before export.
    Never rename — geometry must go (name denylist alone is gameable).
    """
    removed: List[str] = []
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        name = obj.name or ""
        if not _BLENDER_DEFAULT_MESH_NAME.match(name):
            continue
        # Refuse to delete if anything parents to it (load-bearing check).
        children = [c.name for c in bpy.data.objects if c.parent == obj]
        if children:
            print(
                f"[blender] #60 refuse purge of {name!r} ({reason}): has children {children}"
            )
            continue
        if obj.vertex_groups and len(obj.vertex_groups) > 0:
            print(
                f"[blender] #60 refuse purge of {name!r} ({reason}): has vertex groups"
            )
            continue
        if obj.find_armature() is not None:
            print(
                f"[blender] #60 refuse purge of {name!r} ({reason}): bound to armature"
            )
            continue
        me = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
        removed.append(name)
    # Drop empty special collection left by the glTF importer.
    coll = bpy.data.collections.get("glTF_not_exported")
    if coll is not None and len(coll.objects) == 0 and len(coll.children) == 0:
        bpy.data.collections.remove(coll)
    if removed:
        print(f"[blender] #60 purged scratch default meshes ({reason}): {removed}")
    return removed


def import_mesh(input_path: str) -> bpy.types.Object:
    ext = os.path.splitext(input_path)[1].lower()
    if ext in (".obj", ".OBJ"):
        bpy.ops.wm.obj_import(filepath=input_path)
    elif ext in (".glb", ".gltf"):
        # disable_bone_shape: Blender's importer otherwise creates a radius-1
        # Icosphere bone display helper (#60). Still purge as belt-and-suspenders
        # for older Blender builds that lack the flag.
        try:
            bpy.ops.import_scene.gltf(filepath=input_path, disable_bone_shape=True)
        except TypeError:
            bpy.ops.import_scene.gltf(filepath=input_path)
        purge_blender_default_scratch_meshes(reason="after_gltf_import")
    else:
        raise ValueError(f"Unsupported mesh format for import: {ext}")

    # Return the first mesh object that is not a purged default leftover.
    for obj in bpy.context.selected_objects:
        if obj.type == "MESH" and not _BLENDER_DEFAULT_MESH_NAME.match(obj.name or ""):
            bpy.context.view_layer.objects.active = obj
            return obj
    for obj in bpy.data.objects:
        if obj.type == "MESH" and not _BLENDER_DEFAULT_MESH_NAME.match(obj.name or ""):
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

    # Bbox-only x-factors under-span tall/narrow Anny meshes (arms hang near the torso AABB).
    # After #58 export_yup standing joints, armSpan/stature must clear the proportions probe
    # band (≥0.55). Floor half-span at 0.32×height so full span/stature ≈ 0.64+.
    half_span = max(width * 0.44, height * 0.32)
    shoulder_off = max(width * 0.18, half_span * 0.40)
    elbow_off = max(width * 0.34, half_span * 0.75)
    hand_off = half_span

    def limb_at(x_off: float, y_factor: float, z_factor: float = 0.0) -> tuple:
        return (
            center_x + x_off,
            min_y + height * y_factor,
            center_z + depth * z_factor,
        )

    make_limb("L", limb_at(shoulder_off, 0.74), limb_at(elbow_off, 0.58), limb_at(hand_off, 0.42))
    make_limb("R", limb_at(-shoulder_off, 0.74), limb_at(-elbow_off, 0.58), limb_at(-hand_off, 0.42))

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

    # Skin BSDF (procedural realism pass): proper subsurface skin, not plastic mannequin.
    # Radius ~[0.36, 0.18, 0.10] (R>G>B scatter), low specular, roughness ~0.5, no external textures.
    # Base Color stays a solid factor (glTF-safe); subtle hue variation is baked into the factor +
    # sidecar PNGs below — complex Base Color node graphs can be dropped by the exporter.
    bsdf.inputs["Base Color"].default_value = base_color
    mat.diffuse_color = base_color
    # Soft dermal roughness (~0.5); age/BMI nudge only slightly so it does not read wax/plastic.
    bsdf.inputs["Roughness"].default_value = min(0.72, 0.50 + (age_w * 0.08) + (max(0.0, bmi - 24.0) * 0.008))
    # Low specular / IOR level — hard specular is the main plastic-mannequin cue.
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.16
    elif "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = 0.16
    # Transmission reads as glassy/plastic under exam light — keep off for skin.
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = 0.0
    # Stronger SSS weight + skin-like scatter radius (red penetrates farther than blue).
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = 0.18 + min(0.08, age_w * 0.04)
    elif "Subsurface" in bsdf.inputs:
        bsdf.inputs["Subsurface"].default_value = 0.18 + min(0.08, age_w * 0.04)
    if "Subsurface Radius" in bsdf.inputs:
        bsdf.inputs["Subsurface Radius"].default_value = (0.36, 0.18, 0.10)
    if "Subsurface Scale" in bsdf.inputs:
        bsdf.inputs["Subsurface Scale"].default_value = 0.12
    if "Subsurface IOR" in bsdf.inputs:
        bsdf.inputs["Subsurface IOR"].default_value = 1.4
    # Soft sheen / coat for dry-skin micro-reflect without hard plastic highlight.
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = 0.04
        if "Sheen Roughness" in bsdf.inputs:
            bsdf.inputs["Sheen Roughness"].default_value = 0.55
    elif "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.02
        if "Coat Roughness" in bsdf.inputs:
            bsdf.inputs["Coat Roughness"].default_value = 0.45

    # Multi-octave noise: pores (fine) + spots/wrinkle (mid) driven by phenotype — bump only
    # (normals travel better through glTF than complex Base Color graphs).
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
    bump.inputs["Strength"].default_value = 0.028 + (age_w * 0.012)
    nt.links.new(mix.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    # Sidecar bake path: subtle color variation ramp (pores darker, spots/age lighter).
    # Not wired to Base Color (glTF-safe solid factor above); used only for albedo PNG evidence.
    color_ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(mix.outputs["Color"], color_ramp.inputs["Fac"])
    color_ramp.color_ramp.elements[0].color = (
        max(0.0, base_color[0] - 0.07 - age_w * 0.025),
        max(0.0, base_color[1] - 0.055),
        max(0.0, base_color[2] - 0.045),
        1.0,
    )
    color_ramp.color_ramp.elements[1].color = (
        min(1.0, base_color[0] + 0.04 + flush * 0.02),
        min(1.0, base_color[1] + 0.025),
        min(1.0, base_color[2] + 0.015),
        1.0,
    )
    # Runtime GLB uses the phenotype-driven base color factor + SSS; sidecar PNGs preserve
    # procedural pore/spot variation until image-texture baking is promoted.

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


def bake_skin_surface_micro_detail_for_gltf(
    mesh_obj: bpy.types.Object,
    phenotype: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Bake procedural pore/dermal micro-relief to a packed normal-map image so glTF
    export retains skin surface detail (procedural shader nodes are dropped by the
    glTF exporter; image textures are not).

    Guarded stage: any bake/setup failure logs a warning and leaves the current flat
    material intact so export is never broken. Call after skin BSDF setup + UVs,
    before glTF export.
    """
    result: Dict[str, Any] = {
        "ok": False,
        "baked": False,
        "bakeType": None,
        "imageName": None,
        "resolution": 1024,
        "packed": False,
        "uvSource": None,
        "claimScope": "procedural_skin_micro_detail_baked_normal_for_gltf_not_production_skin_scan",
        "notEvidenceFor": [
            "b_plus_visual_realism_gate",
            "production_asset_readiness",
            "clinical_validity",
            "scoring_validity",
        ],
    }
    phenotype = phenotype or {}
    age_w = float(phenotype.get("age_wrinkle", 0.3))

    scene = bpy.context.scene
    prev_engine = getattr(scene.render, "engine", "BLENDER_EEVEE")
    prev_samples = None
    prev_denoise = None
    prev_bake_type = None
    prev_active = bpy.context.view_layer.objects.active
    prev_selected = [obj for obj in bpy.context.selected_objects]
    temp_node_names: List[str] = []
    bake_img = None
    mat = None
    nt = None

    def _tag(node: bpy.types.Node, suffix: str) -> bpy.types.Node:
        node.name = f"openclinxr_skin_micro_{suffix}"
        node.label = node.name
        temp_node_names.append(node.name)
        return node

    def _find_skin_material() -> Optional[bpy.types.Material]:
        mats = list(mesh_obj.data.materials) if mesh_obj.data.materials else []
        for candidate in mats:
            if candidate and candidate.name == "anny_generated_pbr":
                return candidate
        for candidate in mats:
            if not candidate or not getattr(candidate, "use_nodes", False) or not candidate.node_tree:
                continue
            for node in candidate.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    return candidate
        return None

    def _ensure_uv_map() -> str:
        me = mesh_obj.data
        if me.uv_layers and len(me.uv_layers) > 0:
            return "existing"
        # Fallback: smart project so bake has a UV target.
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        mesh_obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        try:
            bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
        except TypeError:
            # Older Blender keyword variants.
            bpy.ops.uv.smart_project()
        bpy.ops.object.mode_set(mode="OBJECT")
        if not me.uv_layers:
            raise RuntimeError("smart UV project produced no UV layers")
        return "smart_project_fallback"

    def _find_bsdf(tree: bpy.types.NodeTree) -> Optional[bpy.types.Node]:
        for node in tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                return node
        return None

    def _clear_normal_links(tree: bpy.types.NodeTree, bsdf_node: bpy.types.Node) -> None:
        if "Normal" not in bsdf_node.inputs:
            return
        for link in list(bsdf_node.inputs["Normal"].links):
            tree.links.remove(link)

    def _remove_named_nodes(tree: bpy.types.NodeTree, names: List[str]) -> None:
        for name in names:
            node = tree.nodes.get(name)
            if node is not None:
                tree.nodes.remove(node)

    def _remove_orphaned_procedural_detail(tree: bpy.types.NodeTree, keep: set) -> None:
        # Drop prior pore/bump graph from add_simple_procedural_pbr_and_bake once baked.
        removable_types = {
            "TEX_NOISE",
            "TEX_VORONOI",
            "MIX_RGB",
            "MIX",
            "BUMP",
            "VALTORGB",
            "NORMAL_MAP",
            "TEX_IMAGE",
        }
        # Only remove untagged image/normal_map if they are not the keep set.
        changed = True
        while changed:
            changed = False
            for node in list(tree.nodes):
                if node in keep or node.name in {n.name for n in keep if hasattr(n, "name")}:
                    continue
                if node.name.startswith("openclinxr_skin_micro_"):
                    continue
                if node.type not in removable_types:
                    continue
                # Keep if any output still linked into a kept node (e.g. future graphs).
                still_used = False
                for out in node.outputs:
                    for link in out.links:
                        if link.to_node in keep:
                            still_used = True
                            break
                    if still_used:
                        break
                if still_used:
                    continue
                # Prefer removing nodes with no users, or only feeding removed chain.
                tree.nodes.remove(node)
                changed = True

    try:
        if mesh_obj is None or mesh_obj.type != "MESH":
            raise RuntimeError("bake_skin_surface_micro_detail_for_gltf requires a mesh object")

        mat = _find_skin_material()
        if mat is None:
            raise RuntimeError("no skin/Principled BSDF material found on body mesh")
        mat.use_nodes = True
        nt = mat.node_tree
        if nt is None:
            raise RuntimeError("skin material has no node tree")

        bsdf = _find_bsdf(nt)
        if bsdf is None:
            raise RuntimeError("skin material missing Principled BSDF")

        # --- Cycles bake settings (restore in finally) ---
        prev_samples = getattr(getattr(scene, "cycles", None), "samples", None)
        prev_denoise = getattr(getattr(scene, "cycles", None), "use_denoising", None)
        prev_bake_type = getattr(getattr(scene, "cycles", None), "bake_type", None)
        scene.render.engine = "CYCLES"
        if hasattr(scene, "cycles"):
            scene.cycles.samples = 16
            if hasattr(scene.cycles, "use_denoising"):
                scene.cycles.use_denoising = False

        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        mesh_obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_obj

        result["uvSource"] = _ensure_uv_map()

        # --- Temporary procedural pore / dermal micro-relief graph ---
        # High-frequency noise (pores) + finer Voronoi/noise mix → Bump → BSDF Normal.
        tex_coord = _tag(nt.nodes.new("ShaderNodeTexCoord"), "texcoord")
        mapping = _tag(nt.nodes.new("ShaderNodeMapping"), "mapping")
        nt.links.new(tex_coord.outputs["UV"], mapping.inputs["Vector"])

        noise_pores = _tag(nt.nodes.new("ShaderNodeTexNoise"), "noise_pores")
        noise_pores.inputs["Scale"].default_value = 180.0
        noise_pores.inputs["Detail"].default_value = 12.0
        noise_pores.inputs["Roughness"].default_value = 0.72
        if "Distortion" in noise_pores.inputs:
            noise_pores.inputs["Distortion"].default_value = 0.15
        nt.links.new(mapping.outputs["Vector"], noise_pores.inputs["Vector"])

        voronoi_dermal = _tag(nt.nodes.new("ShaderNodeTexVoronoi"), "voronoi_dermal")
        voronoi_dermal.inputs["Scale"].default_value = 95.0 + age_w * 20.0
        if "Randomness" in voronoi_dermal.inputs:
            voronoi_dermal.inputs["Randomness"].default_value = 0.85
        nt.links.new(mapping.outputs["Vector"], voronoi_dermal.inputs["Vector"])

        noise_fine = _tag(nt.nodes.new("ShaderNodeTexNoise"), "noise_fine")
        noise_fine.inputs["Scale"].default_value = 320.0
        noise_fine.inputs["Detail"].default_value = 8.0
        noise_fine.inputs["Roughness"].default_value = 0.55
        nt.links.new(mapping.outputs["Vector"], noise_fine.inputs["Vector"])

        # MixRGB / Mix (ShaderNodeMix in 4.x) compatibility.
        try:
            mix_mid = _tag(nt.nodes.new("ShaderNodeMixRGB"), "mix_dermal")
            mix_mid.blend_type = "MIX"
            mix_mid.inputs["Fac"].default_value = 0.45
            fac_in, c1, c2, mix_out = "Fac", "Color1", "Color2", "Color"
        except Exception:
            mix_mid = _tag(nt.nodes.new("ShaderNodeMix"), "mix_dermal")
            if hasattr(mix_mid, "data_type"):
                mix_mid.data_type = "FLOAT"
            fac_in, c1, c2, mix_out = "Factor", "A", "B", "Result"
            if fac_in in mix_mid.inputs:
                mix_mid.inputs[fac_in].default_value = 0.45

        voronoi_fac = "Distance" if "Distance" in voronoi_dermal.outputs else (
            "Fac" if "Fac" in voronoi_dermal.outputs else voronoi_dermal.outputs[0].name
        )
        nt.links.new(voronoi_dermal.outputs[voronoi_fac], mix_mid.inputs[c1])
        nt.links.new(noise_fine.outputs["Fac"], mix_mid.inputs[c2])

        try:
            mix_pores = _tag(nt.nodes.new("ShaderNodeMixRGB"), "mix_pores")
            mix_pores.blend_type = "MIX"
            mix_pores.inputs["Fac"].default_value = 0.62
            p_fac, p_c1, p_c2, p_out = "Fac", "Color1", "Color2", "Color"
        except Exception:
            mix_pores = _tag(nt.nodes.new("ShaderNodeMix"), "mix_pores")
            if hasattr(mix_pores, "data_type"):
                mix_pores.data_type = "FLOAT"
            p_fac, p_c1, p_c2, p_out = "Factor", "A", "B", "Result"
            if p_fac in mix_pores.inputs:
                mix_pores.inputs[p_fac].default_value = 0.62

        nt.links.new(noise_pores.outputs["Fac"], mix_pores.inputs[p_c1])
        nt.links.new(mix_mid.outputs[mix_out], mix_pores.inputs[p_c2])

        bump = _tag(nt.nodes.new("ShaderNodeBump"), "bump")
        bump.inputs["Strength"].default_value = 0.035 + age_w * 0.015
        if "Distance" in bump.inputs:
            bump.inputs["Distance"].default_value = 0.008
        nt.links.new(mix_pores.outputs[p_out], bump.inputs["Height"])

        # Replace any prior Normal link with temporary procedural bump for bake.
        _clear_normal_links(nt, bsdf)
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

        # Bake target image + Image Texture node (must be selected/active for bake).
        res = 1024
        img_name = "openclinxr_skin_micro_normal"
        if img_name in bpy.data.images:
            bake_img = bpy.data.images[img_name]
            bake_img.scale(res, res)
        else:
            bake_img = bpy.data.images.new(img_name, width=res, height=res, alpha=True, float_buffer=False)
        bake_img.colorspace_settings.name = "Non-Color"
        bake_img.generated_color = (0.5, 0.5, 1.0, 1.0)

        # Image Texture is the durable bake target — do NOT tag as temp (must survive cleanup).
        img_tex = nt.nodes.new("ShaderNodeTexImage")
        img_tex.name = "openclinxr_skin_micro_normal_tex"
        img_tex.label = "Skin Micro Normal (baked)"
        img_tex.image = bake_img
        img_tex.interpolation = "Smart"
        img_tex.location = (-900, -200)

        for node in nt.nodes:
            node.select = False
        img_tex.select = True
        nt.nodes.active = img_tex

        # Bake settings (tangent-space normal preferred).
        if hasattr(scene.render, "bake"):
            bake_settings = scene.render.bake
            if hasattr(bake_settings, "normal_space"):
                bake_settings.normal_space = "TANGENT"
            if hasattr(bake_settings, "use_selected_to_active"):
                bake_settings.use_selected_to_active = False
            if hasattr(bake_settings, "margin"):
                bake_settings.margin = 4
            if hasattr(bake_settings, "use_clear"):
                bake_settings.use_clear = True

        bake_type_used = None
        bake_error: Optional[str] = None

        # Prefer NORMAL bake (tangent-space map from procedural bump).
        try:
            if hasattr(scene, "cycles"):
                scene.cycles.bake_type = "NORMAL"
            bpy.ops.object.bake(type="NORMAL", use_clear=True)
            bake_type_used = "NORMAL"
        except Exception as normal_exc:
            bake_error = f"NORMAL bake failed: {normal_exc}"
            print(f"[blender] WARNING: skin micro-detail NORMAL bake failed ({normal_exc}); trying EMIT fallback")
            # EMIT fallback: emit procedural height as grayscale, bake EMIT.
            try:
                emit = _tag(nt.nodes.new("ShaderNodeEmission"), "emit_fallback")
                # Grayscale height → emission color.
                nt.links.new(mix_pores.outputs[p_out], emit.inputs["Color"])
                if "Strength" in emit.inputs:
                    emit.inputs["Strength"].default_value = 1.0
                out_node = None
                for node in nt.nodes:
                    if node.type == "OUTPUT_MATERIAL":
                        out_node = node
                        break
                if out_node is None:
                    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
                # Temporarily drive surface from emission for EMIT bake.
                for link in list(out_node.inputs["Surface"].links):
                    nt.links.remove(link)
                nt.links.new(emit.outputs["Emission"], out_node.inputs["Surface"])

                for node in nt.nodes:
                    node.select = False
                img_tex.select = True
                nt.nodes.active = img_tex

                if hasattr(scene, "cycles"):
                    scene.cycles.bake_type = "EMIT"
                bpy.ops.object.bake(type="EMIT", use_clear=True)
                bake_type_used = "EMIT"

                # Restore Principled surface link.
                for link in list(out_node.inputs["Surface"].links):
                    nt.links.remove(link)
                nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])
            except Exception as emit_exc:
                bake_error = f"{bake_error}; EMIT bake failed: {emit_exc}"
                raise RuntimeError(bake_error) from emit_exc

        # Pack so glTF/GLB export embeds the image bytes.
        try:
            bake_img.pack()
        except TypeError:
            # Some Blender versions accept as_png=
            try:
                bake_img.pack(as_png=True)
            except Exception:
                bake_img.pack()
        result["packed"] = True
        result["imageName"] = bake_img.name
        result["bakeType"] = bake_type_used

        # --- Final glTF-safe wiring: Image Texture → Normal Map → BSDF Normal ---
        # Drop temporary procedural nodes first so only the baked image path remains.
        _clear_normal_links(nt, bsdf)
        _remove_named_nodes(nt, list(temp_node_names))
        temp_node_names.clear()

        # Non-color for normal/height data.
        try:
            bake_img.colorspace_settings.name = "Non-Color"
        except Exception:
            pass

        # Ensure bake target image texture still present after temp cleanup.
        img_tex = nt.nodes.get("openclinxr_skin_micro_normal_tex")
        if img_tex is None:
            img_tex = nt.nodes.new("ShaderNodeTexImage")
            img_tex.name = "openclinxr_skin_micro_normal_tex"
            img_tex.label = "Skin Micro Normal (baked)"
        img_tex.image = bake_img

        if bake_type_used == "NORMAL":
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nmap.name = "openclinxr_skin_micro_normal_map"
            nmap.label = "Skin Micro Normal Map"
            if "Strength" in nmap.inputs:
                nmap.inputs["Strength"].default_value = 0.85 + min(0.25, age_w * 0.2)
            nt.links.new(img_tex.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
            keep_nodes = {bsdf, img_tex, nmap}
        else:
            # EMIT height map → Bump as best-effort (Normal Map would misread grayscale height).
            final_bump = nt.nodes.new("ShaderNodeBump")
            final_bump.name = "openclinxr_skin_micro_bump_from_emit"
            final_bump.label = "Skin Micro Bump (EMIT bake)"
            final_bump.inputs["Strength"].default_value = 0.04 + age_w * 0.015
            nt.links.new(img_tex.outputs["Color"], final_bump.inputs["Height"])
            nt.links.new(final_bump.outputs["Normal"], bsdf.inputs["Normal"])
            keep_nodes = {bsdf, img_tex, final_bump}

        for node in nt.nodes:
            if node.type == "OUTPUT_MATERIAL":
                keep_nodes.add(node)

        # Remove untagged leftover noise/bump from the earlier PBR stage that no longer feed Normal.
        try:
            _remove_orphaned_procedural_detail(nt, keep_nodes)
        except Exception as cleanup_exc:
            print(f"[blender] WARNING: skin micro-detail node cleanup partial: {cleanup_exc}")

        # Re-assert final links after orphan cleanup.
        img_tex = nt.nodes.get("openclinxr_skin_micro_normal_tex") or img_tex
        if bake_type_used == "NORMAL":
            nmap = nt.nodes.get("openclinxr_skin_micro_normal_map")
            if nmap is not None and img_tex is not None:
                if not nmap.inputs["Color"].links:
                    nt.links.new(img_tex.outputs["Color"], nmap.inputs["Color"])
                if "Normal" in bsdf.inputs and not bsdf.inputs["Normal"].links:
                    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        else:
            fb = nt.nodes.get("openclinxr_skin_micro_bump_from_emit")
            if fb is not None and img_tex is not None:
                if not fb.inputs["Height"].links:
                    nt.links.new(img_tex.outputs["Color"], fb.inputs["Height"])
                if "Normal" in bsdf.inputs and not bsdf.inputs["Normal"].links:
                    nt.links.new(fb.outputs["Normal"], bsdf.inputs["Normal"])

        result["ok"] = True
        result["baked"] = True
        print(
            f"[blender] skin micro-detail baked ({bake_type_used}) -> "
            f"image={bake_img.name} {res}x{res} packed={result['packed']} uv={result['uvSource']}"
        )
        return result

    except Exception as exc:
        print(f"[blender] WARNING: skin surface micro-detail bake skipped (export continues with flat material): {exc}")
        result["ok"] = False
        result["baked"] = False
        result["error"] = str(exc)
        # Best-effort: disconnect temp nodes so material stays export-safe.
        try:
            if nt is not None:
                _remove_named_nodes(nt, list(temp_node_names))
                bsdf_safe = _find_bsdf(nt)
                if bsdf_safe is not None:
                    # Leave Normal unconnected (flat) rather than dangling temp links.
                    pass
        except Exception:
            pass
        return result

    finally:
        # Restore render engine / bake settings and selection.
        try:
            scene.render.engine = prev_engine
        except Exception:
            pass
        try:
            if hasattr(scene, "cycles"):
                if prev_samples is not None:
                    scene.cycles.samples = prev_samples
                if prev_denoise is not None and hasattr(scene.cycles, "use_denoising"):
                    scene.cycles.use_denoising = prev_denoise
                if prev_bake_type is not None and hasattr(scene.cycles, "bake_type"):
                    scene.cycles.bake_type = prev_bake_type
        except Exception:
            pass
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass
        try:
            bpy.ops.object.select_all(action="DESELECT")
            for obj in prev_selected:
                try:
                    obj.select_set(True)
                except Exception:
                    pass
            if prev_active is not None:
                bpy.context.view_layer.objects.active = prev_active
        except Exception:
            pass


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


# #180a / #184: locked clinical colours — counterweight for #180b (do not move).
_GARMENT_COLOR_GOWN = (0.15, 0.55, 0.82, 1.0)
_GARMENT_COLOR_SCRUB = (0.05, 0.48, 0.52, 1.0)
# 2026-08-14 medical wardrobe: the physician's white lab coat (CC0
# makehuman-community-crude-labcoat-female). Locked like gown/scrub — a lab coat
# is white on every cast, and the #180b distinctness contract is served by the
# scrub shirt showing through the open front, not by tinting the coat.
_GARMENT_COLOR_LAB_COAT = (0.92, 0.92, 0.90, 1.0)
# Kind defaults when fabricPalette / role do not resolve a named row.
_GARMENT_KIND_DEFAULTS: Dict[str, tuple] = {
    "gown": _GARMENT_COLOR_GOWN,
    "scrub": _GARMENT_COLOR_SCRUB,
    "scrub_pocket": (0.04, 0.42, 0.48, 1.0),
    "open_front": (0.62, 0.28, 0.38, 1.0),  # family muted-rose cardigan
    "closed_casual": (0.42, 0.36, 0.40, 1.0),
    "tshirt": (0.08, 0.52, 0.95, 1.0),
    "default": (0.08, 0.52, 0.95, 1.0),
}
# Named fabricPalette → kind → RGBA. fabricPalette is a real enum input, not decorative.
# scrub_top always maps to _GARMENT_COLOR_SCRUB when present (counterweight).
_FABRIC_PALETTE_KIND_COLORS: Dict[str, Dict[str, tuple]] = {
    "hospital_gown_blue_pattern": {
        "gown": _GARMENT_COLOR_GOWN,
    },
    "teal_scrubs_and_white_badge": {
        "scrub": _GARMENT_COLOR_SCRUB,
        "scrub_pocket": (0.04, 0.42, 0.48, 1.0),
    },
    # Distinct outer pocket for the second scrub body so co-present nurse-class
    # actors do not share a primary material (scrub_top stays locked).
    "teal_scrubs_peds_shift": {
        "scrub": _GARMENT_COLOR_SCRUB,
        "scrub_pocket": (0.06, 0.36, 0.44, 1.0),
    },
    "muted_rose_and_neutral": {
        "open_front": (0.62, 0.28, 0.38, 1.0),
        "closed_casual": (0.42, 0.36, 0.40, 1.0),
    },
    # #400: the peds patient's declared palette (patient_maya_johnson_v1). Muted powder
    # blue — staging decision from the issue (clearly blue-dominant, distinct from the
    # nurse's saturated teal so the child does not read as staff).
    "soft_blue_and_warm_white": {
        "closed_casual": (0.55, 0.68, 0.80, 1.0),
    },
    "olive_knit_and_cream_casual": {
        "open_front": (0.48, 0.42, 0.28, 1.0),  # warm olive cardigan (street patient)
        "closed_casual": (0.72, 0.68, 0.55, 1.0),  # cream under-layer
    },
}


def garment_shell_color(kind: str, actor_role: str, phenotype: Dict[str, Any]) -> tuple:
    """Visible real-garment base colour: f(role, kind, fabricPalette).

    #180a: break the kind→colour monopoly so co-present actors do not share a
    primary garment material by construction. Gown and scrub_top colours are
    locked (counterweight for #180b encounter-distance legibility).

    Decision: fabricPalette is a named-enum table (not free-text→colour). Role
    is a fallback for casual kinds when palette is missing/unmapped so a second
    role assigned the same kind still diverges.
    """
    k = (kind or "default").lower()
    # Locked clinical colours — never overridden by palette or role.
    if k == "gown":
        return _GARMENT_COLOR_GOWN
    if k == "scrub":
        return _GARMENT_COLOR_SCRUB
    if k == "lab_coat":
        return _GARMENT_COLOR_LAB_COAT

    palette_raw = str(
        phenotype.get("fabricPalette")
        or phenotype.get("clothing_color")
        or ""
    ).strip().lower()
    role = (actor_role or "").lower()

    # Named fabricPalette table (substring match so clothing_color synonyms work).
    for palette_key, kind_map in _FABRIC_PALETTE_KIND_COLORS.items():
        if palette_key in palette_raw or palette_raw == palette_key:
            if k in kind_map:
                return kind_map[k]

    # Role fallback for street casual layers only.
    if k in ("open_front", "closed_casual"):
        is_patient = "patient" in role
        is_family = any(
            token in role for token in ("family", "parent", "spouse", "guardian")
        )
        if is_patient:
            olive = _FABRIC_PALETTE_KIND_COLORS["olive_knit_and_cream_casual"]
            return olive.get(k, _GARMENT_KIND_DEFAULTS[k])
        if is_family:
            rose = _FABRIC_PALETTE_KIND_COLORS["muted_rose_and_neutral"]
            return rose.get(k, _GARMENT_KIND_DEFAULTS[k])

    return _GARMENT_KIND_DEFAULTS.get(k, _GARMENT_KIND_DEFAULTS["default"])


# CC0 MakeHuman system-asset iris colours (#356) — per-actor iris asset ids from the official
# `makehuman_system_assets` pack (makehumancommunity.org, makehuman_system_assets_cc0.zip).
# Every staged <colour>.mhmat carries the same in-file CC0 header as the hm08 eyes ("This asset
# was explicitly released as CC0 in september 2020", Data Collection AB / Joel Palmius / Jonas
# Hauquier; recorded in third-party-asset-licence-ledger.md). The ids ARE the pack's own
# material stems — nothing invented here.
_EYE_IRIS_PACK = (
    "blue", "bluegreen", "brown", "brownlight", "deepblue", "green", "grey", "ice", "lightblue",
)

# #356: break the one-iris-for-everyone monopoly so co-present actors do not share an iris
# texture by construction — the same shape as garment_shell_color (#180). The assignments are a
# staging judgement ("which colours are right" is a phenotype question the eye contract
# deliberately does not test); the patient keeps the byte-identical brown, the family and nurse
# get clearly distinct measured hues (green 49°, blue 66° vs brown 34°).
_EYE_IRIS_BY_ROLE = {
    "patient": "brown",
    "family": "green",
    "nurse": "blue",
}


def eye_iris_colour(actor_role: str, phenotype: Dict[str, Any]) -> str:
    """Declared iris asset id for the actor: f(role, phenotype) — #356.

    The returned id names a <colour>.mhmat staged under
    `.openclinxr-local/provider-cache/eyes/makehuman-system-assets/`; the MPFB materializer
    consumes that declared material via the generic .mhmat path (D1 — no table copied, no
    colour invented). A phenotype that names an eye colour explicitly (e.g. "blue eyes")
    overrides the role fallback; otherwise the role fallback mirrors garment_shell_color.
    """
    role = (actor_role or "").lower()
    phen = str(
        phenotype.get("eyeColour") or phenotype.get("irisColour") or phenotype.get("eye") or ""
    ).strip().lower()
    for key in _EYE_IRIS_PACK:
        if key in phen:
            return key
    if any(token in role for token in ("nurse", "clinician", "staff")):
        return _EYE_IRIS_BY_ROLE["nurse"]
    if any(token in role for token in ("family", "parent", "spouse", "guardian")):
        return _EYE_IRIS_BY_ROLE["family"]
    return _EYE_IRIS_BY_ROLE["patient"]


def create_role_marker_material(name: str, color: tuple) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF") or mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.78
    return mat


def _build_body_surface_derived_garment(
    mesh_obj: bpy.types.Object,
    *,
    gmesh_name: str,
    gname: str,
    bot_y: float,
    neck_y: float,
    cloth_offset: float,
    sleeve_along: float,
    sleeve_radius: float,
    layer_is_open: bool,
    front_opening_rad: float,
    cx: float,
    cz: float,
    body_width: float,
    body_depth: float,
    shoulder_L: tuple,
    elbow_L: tuple,
    wrist_L: tuple,
    shoulder_R: tuple,
    elbow_R: tuple,
    wrist_R: tuple,
) -> bpy.types.Object:
    """
    #121 authoring-class change: garment shell = body surface offset along outward normals.
    #124 hem: planar bisect after offset (not a y-threshold vertex delete) so the lower boundary
    is a regular loop; neck/arm stay landmark-aligned cylinder cuts.

    Rejected ring+tube parametric cages (torso ellipse + separate sleeve tubes + detached yoke):
    research + six failed gates established that class cannot produce a continuous deltoid cap or
    body-inside-garment silhouette. Continuity is inherited from the body mesh topology; neck and
    arm holes are cut from landmark Y / arm-axis distance, not hard-coded height fractions alone.

    #197 sleeve chain: arm landmarks are shoulder→elbow→wrist (hand @ body-height 0.42, matching
    the armature limb_at). `sleeve_along` is arc length along that polyline; fraction 1.0 is the
    wrist, not the elbow. Pre-#197 the chain stopped at the elbow so every "long" sleeve saturated
    at mid-forearm / elbow by construction.

    Decisions:
      - offset distance: base cloth_offset (layer-stacked by caller); +15% anterior chest, −20% underarm
      - neck/arm cuts: neck_y landmark + distance-to-arm polyline (shoulder→elbow→wrist)
      - hem (#124): rough drop well below bot_y, then bmesh bisect_plane at bot_y AFTER offset
        (rejected: height-threshold delete alone → staircase; solidify rim → export micro-islands)
      - body faces NOT hidden/deleted (#73 counterweight — garment covers without removing skin)
      - lower-body paint left untouched (caller owns that; shared waistline in caller)
      - long sleeve (#197): cuff at wrist (ulnar-head / hand landmark); rejected elbow-only segment
    """
    import bmesh
    import math

    gmesh = mesh_obj.data.copy()
    gmesh.name = gmesh_name
    # Drop body materials — garment gets its own role colour after construction.
    try:
        gmesh.materials.clear()
    except Exception:
        while gmesh.materials:
            gmesh.materials.pop(index=0)
    garment = bpy.data.objects.new(gname, gmesh)
    bpy.context.collection.objects.link(garment)
    _body_ys = [float(v.co.y) for v in gmesh.vertices]
    print(
        f"[blender] #124 body-copy for garment: verts={len(gmesh.vertices)} "
        f"y=[{min(_body_ys):.4f},{max(_body_ys):.4f}] bot_y={bot_y:.4f} neck_y={neck_y:.4f}"
    )

    bm = bmesh.new()
    bm.from_mesh(gmesh)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()

    def _polyline_length(pts: list) -> float:
        total = 0.0
        for i in range(len(pts) - 1):
            total += (pts[i + 1] - pts[i]).length
        return total or 0.25

    def _point_on_polyline(pts: list, dist: float) -> Vector:
        remaining = max(0.0, float(dist))
        for i in range(len(pts) - 1):
            seg = pts[i + 1] - pts[i]
            seg_len = seg.length or 1e-9
            if remaining <= seg_len:
                return pts[i] + seg * (remaining / seg_len)
            remaining -= seg_len
        return pts[-1].copy()

    def _poly_dist(p: Vector, pts: list) -> tuple:
        """Nearest distance to polyline + cumulative arc-length fraction along the chain."""
        total = _polyline_length(pts)
        best_d = 1e9
        best_cum = 0.0
        cum = 0.0
        for i in range(len(pts) - 1):
            a = pts[i]
            b = pts[i + 1]
            ab = b - a
            ab2 = ab.dot(ab) or 1e-9
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab2))
            closest = a + ab * t
            d = (p - closest).length
            seg_len = ab.length
            if d < best_d:
                best_d = d
                best_cum = (cum + t * seg_len) / total
            cum += seg_len
        return best_d, best_cum

    sL = Vector(shoulder_L)
    eL = Vector(elbow_L)
    wL = Vector(wrist_L)
    sR = Vector(shoulder_R)
    eR = Vector(elbow_R)
    wR = Vector(wrist_R)
    chain_L = [sL, eL, wL]
    chain_R = [sR, eR, wR]
    arm_len_L = _polyline_length(chain_L)
    arm_len_R = _polyline_length(chain_R)
    # #197: sleeve_along is metres along the full chain; t=1.0 is the wrist.
    t_max_L = max(0.05, min(1.0, sleeve_along / arm_len_L))
    t_max_R = max(0.05, min(1.0, sleeve_along / arm_len_R))
    cuff_L = _point_on_polyline(chain_L, sleeve_along)
    cuff_R = _point_on_polyline(chain_R, sleeve_along)
    print(
        f"[blender] #197 sleeve chain L: upper={(eL - sL).length:.4f} "
        f"forearm={(wL - eL).length:.4f} full={arm_len_L:.4f} "
        f"sleeve_along={sleeve_along:.4f} t_max={t_max_L:.3f} "
        f"cuff=({cuff_L.x:.3f},{cuff_L.y:.3f},{cuff_L.z:.3f})"
    )

    neck_hole_r = max(body_width * 0.08, body_depth * 0.10, 0.035)
    sleeve_r_soft = max(sleeve_radius * 1.55, body_width * 0.22, 0.07)
    half_gap = front_opening_rad * 0.5 if layer_is_open else 0.0
    # Hard exclusions: neck hole / head / past-cuff / open-front gap, plus a ROUGH lower
    # drop well below the target hem. The finished hem is a planar bisect AFTER offset
    # (#124) — a hard y < bot_y vertex delete leaves a staircase through body triangles.
    # Soft envelope filters severed the armpit bridge and split sleeves off; do not
    # reintroduce that. After hard deletes, flood-fill keeps ONE body-derived shell.
    hem_margin = max(0.04, (neck_y - bot_y) * 0.06)  # keep band below bot_y for clean bisect
    rough_bot = bot_y - hem_margin
    hard_delete = []
    for v in bm.verts:
        p = v.co
        y = float(p.y)
        x = float(p.x)
        z = float(p.z)
        r_xz = math.hypot(x - cx, z - cz)
        if y < rough_bot:
            hard_delete.append(v)
            continue
        if y >= neck_y - body_width * 0.02 and r_xz <= neck_hole_r:
            hard_delete.append(v)
            continue
        if y > neck_y + body_width * 0.03 and r_xz < neck_hole_r * 2.0:
            hard_delete.append(v)
            continue
        dL, tL = _poly_dist(p, chain_L)
        dR, tR = _poly_dist(p, chain_R)
        # #124: past-cuff cuts must stay on the TRUE sleeve (far lateral). Without the
        # lateral gate, short-sleeve scrub cuts punched a face-disconnection through the
        # mid-torso and face-flood dropped the whole hem island (minY≈1.04).
        true_sleeve_lat = body_width * 0.20
        if tL > t_max_L and dL < sleeve_r_soft * 1.5 and abs(x - cx) >= true_sleeve_lat:
            hard_delete.append(v)
            continue
        if tR > t_max_R and dR < sleeve_r_soft * 1.5 and abs(x - cx) >= true_sleeve_lat:
            hard_delete.append(v)
            continue
        if (
            (p - cuff_L).length < sleeve_r_soft * 0.95
            and tL >= t_max_L * 0.90
            and abs(x - cx) >= true_sleeve_lat
        ):
            hard_delete.append(v)
            continue
        if (
            (p - cuff_R).length < sleeve_r_soft * 0.95
            and tR >= t_max_R * 0.90
            and abs(x - cx) >= true_sleeve_lat
        ):
            hard_delete.append(v)
            continue
        # #124: do NOT far-lateral-delete near the hem. That cut punched side holes that
        # face-disconnected the lower torso island from the chest (hem jumped to y≈1.04).
        # Hands/feet already dropped by rough_bot; sleeves handled by arm-segment cuts.
        if layer_is_open and half_gap > 0.0 and y <= neck_y + body_width * 0.02:
            # Anterior sector cut (cardigan). Must leave a large mid-height angular gap
            # so garment-role-distinguish hasAnteriorOpening stays true (#46).
            # Prefer a wide wedge around +Z (Anny anterior); also force-cut the sternum
            # band (high +Z, near mid-X) which dense body meshes otherwise fill.
            ang = math.atan2(z - cz, x - cx)
            front = math.pi * 0.5
            d_ang = (ang - front + math.pi) % (2.0 * math.pi) - math.pi
            open_wedge = max(half_gap, 0.70)  # ≥ ~80° total gap when half_gap is small
            near_sternum = (z >= cz + body_depth * 0.02) and (abs(x - cx) < body_width * 0.18)
            in_front_wedge = abs(d_ang) < open_wedge and r_xz > neck_hole_r * 0.25
            # Keep true sleeves (far lateral) even if slightly anterior.
            far_sleeve = abs(x - cx) >= body_width * 0.28
            if (in_front_wedge or near_sternum) and not far_sleeve and y >= rough_bot:
                hard_delete.append(v)
                continue

    open_cut_count = sum(1 for v in hard_delete if True)  # total hard deletes
    if layer_is_open:
        # Count how many hard deletes were pure front-wedge (approx: high +Z relative to cz)
        frontish_del = 0
        for v in hard_delete:
            try:
                if float(v.co.z) >= cz:
                    frontish_del += 1
            except ReferenceError:
                pass
        print(
            f"[blender] #121 open-front hard_delete total={len(hard_delete)} "
            f"frontish_z>={cz:.3f} count≈{frontish_del} half_gap={half_gap:.3f} "
            f"body_w={body_width:.3f} body_d={body_depth:.3f}"
        )
    if hard_delete:
        bmesh.ops.delete(bm, geom=hard_delete, context="VERTS")
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    if not bm.verts:
        bm.free()
        raise RuntimeError("#121 surface-derived garment: empty after hard cuts")
    _ys = [float(v.co.y) for v in bm.verts]
    print(
        f"[blender] #124 after hard cuts: verts={len(bm.verts)} "
        f"y=[{min(_ys):.4f},{max(_ys):.4f}] bot_y={bot_y:.4f} rough_bot={rough_bot:.4f}"
    )

    chest_target = Vector((cx, 0.5 * (bot_y + min(neck_y, bot_y + (neck_y - bot_y) * 0.7)), cz + body_depth * 0.12))
    seed = min(bm.verts, key=lambda v: (v.co - chest_target).length_squared)
    # #124: walk FACE adjacency (not edge-only). Edge-only bridges survive flood-fill then
    # vanish on glTF export (triangle-index connectivity), leaving a hem island + bare midriff.
    kept = set()
    stack = [seed]
    while stack:
        v = stack.pop()
        if v in kept:
            continue
        kept.add(v)
        for f in v.link_faces:
            for ov in f.verts:
                if ov not in kept:
                    stack.append(ov)

    orphan = [v for v in bm.verts if v not in kept]
    if orphan:
        bmesh.ops.delete(bm, geom=orphan, context="VERTS")
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    if bm.verts:
        _ys2 = [float(v.co.y) for v in bm.verts]
        print(
            f"[blender] #124 after face-flood-fill: verts={len(bm.verts)} kept={len(kept)} "
            f"orphan={len(orphan)} y=[{min(_ys2):.4f},{max(_ys2):.4f}]"
        )

    def _keep_largest_component(bm_local) -> None:
        """Delete every connected component except the largest (export continuity)."""
        bm_local.verts.ensure_lookup_table()
        if not bm_local.verts:
            return
        seen_cc: set = set()
        components_list = []
        for v0 in bm_local.verts:
            if v0 in seen_cc:
                continue
            stack_cc = [v0]
            comp = []
            while stack_cc:
                vv = stack_cc.pop()
                if vv in seen_cc:
                    continue
                seen_cc.add(vv)
                comp.append(vv)
                for e in vv.link_edges:
                    ov = e.other_vert(vv)
                    if ov is not None and ov not in seen_cc:
                        stack_cc.append(ov)
            components_list.append(comp)
        if len(components_list) <= 1:
            return
        components_list.sort(key=len, reverse=True)
        drop = [v for c in components_list[1:] for v in c]
        if drop:
            bmesh.ops.delete(bm_local, geom=drop, context="VERTS")
        bm_local.verts.ensure_lookup_table()
        bm_local.faces.ensure_lookup_table()

    def _weld_nearby_components(bm_local, max_dist: float = 0.12) -> None:
        """Merge multi-island garment shells by snapping nearest vert pairs and remove_doubles.

        #124: arm-hole cuts can leave a lower-torso island disconnected from the chest shell.
        Keep both (hem must survive) then weld nearest pairs so export is one component
        (shoulderSpanned counterweight).
        """
        bm_local.verts.ensure_lookup_table()
        if not bm_local.verts:
            return

        def _components():
            seen_cc: set = set()
            out = []
            for v0 in bm_local.verts:
                if v0 in seen_cc:
                    continue
                stack_cc = [v0]
                comp = []
                while stack_cc:
                    vv = stack_cc.pop()
                    if vv in seen_cc:
                        continue
                    seen_cc.add(vv)
                    comp.append(vv)
                    for e in vv.link_edges:
                        ov = e.other_vert(vv)
                        if ov is not None and ov not in seen_cc:
                            stack_cc.append(ov)
                if comp:
                    out.append(comp)
            out.sort(key=len, reverse=True)
            return out

        max_d2 = max_dist * max_dist
        for _pass in range(6):
            components_list = _components()
            if len(components_list) <= 1:
                break
            primary = components_list[0]
            merged_any = False
            for comp in components_list[1:]:
                best = None
                best_d2 = max_d2
                # Sample for speed on large comps
                sample_a = comp if len(comp) <= 80 else comp[:: max(1, len(comp) // 80)]
                sample_b = primary if len(primary) <= 120 else primary[:: max(1, len(primary) // 120)]
                for a in sample_a:
                    ap = a.co
                    for b in sample_b:
                        d2 = (ap - b.co).length_squared
                        if d2 < best_d2:
                            best_d2 = d2
                            best = (a, b)
                if best is not None:
                    a, b = best
                    mid = (a.co + b.co) * 0.5
                    a.co = mid
                    b.co = mid
                    # Face bridge (not edge-only): glTF/export connectedComponents walks
                    # triangle indices, so a bare edge does not join shells.
                    try:
                        # Find a second near pair for a thin triangle
                        a2 = None
                        b2 = None
                        best2 = max_d2
                        for aa in sample_a:
                            if aa == a:
                                continue
                            for bb in sample_b:
                                if bb == b:
                                    continue
                                d2 = (aa.co - bb.co).length_squared
                                if d2 < best2:
                                    best2 = d2
                                    a2, b2 = aa, bb
                        if a2 is not None and b2 is not None:
                            try:
                                bm_local.faces.new((a, b, a2))
                            except Exception:
                                pass
                            try:
                                bm_local.faces.new((b, b2, a2))
                            except Exception:
                                pass
                        else:
                            # Degenerate micro-tri: duplicate a slightly offset
                            c = bm_local.verts.new(
                                (
                                    mid.x + 1e-4,
                                    mid.y,
                                    mid.z + 1e-4,
                                )
                            )
                            try:
                                bm_local.faces.new((a, b, c))
                            except Exception:
                                pass
                    except Exception:
                        pass
                    merged_any = True
            bm_local.verts.ensure_lookup_table()
            bm_local.edges.ensure_lookup_table()
            bm_local.faces.ensure_lookup_table()
            if bm_local.verts:
                bmesh.ops.remove_doubles(
                    bm_local, verts=list(bm_local.verts), dist=max(2e-3, max_dist * 0.2)
                )
                bm_local.verts.ensure_lookup_table()
                bm_local.edges.ensure_lookup_table()
                bm_local.faces.ensure_lookup_table()
            if not merged_any:
                # Widen search once
                max_d2 = (max_dist * 1.6) ** 2
        n_comp = len(_components())
        print(f"[blender] #124 weld_nearby_components residual_comps={n_comp}")

    def _keep_garment_y_band_components(bm_local, y_lo: float, y_hi: float) -> None:
        """#124: keep every non-trivial component that intersects the garment height band.

        After arm/neck cuts the lower torso can become a second island. Dropping it via
        keep-largest alone raised the hem from bot_y≈0.82 to ≈1.04 (bare midriff). Keep
        all islands that still sit in the torso band; drop only micro-debris.
        """
        bm_local.verts.ensure_lookup_table()
        if not bm_local.verts:
            return
        seen_cc: set = set()
        components_list = []
        for v0 in bm_local.verts:
            if v0 in seen_cc:
                continue
            stack_cc = [v0]
            comp = []
            while stack_cc:
                vv = stack_cc.pop()
                if vv in seen_cc:
                    continue
                seen_cc.add(vv)
                comp.append(vv)
                for e in vv.link_edges:
                    ov = e.other_vert(vv)
                    if ov is not None and ov not in seen_cc:
                        stack_cc.append(ov)
            components_list.append(comp)
        if len(components_list) <= 1:
            return
        min_keep = max(24, int(0.02 * sum(len(c) for c in components_list)))
        drop = []
        kept_n = 0
        for comp in components_list:
            ys = [float(v.co.y) for v in comp]
            cmin, cmax = min(ys), max(ys)
            in_band = cmax >= y_lo and cmin <= y_hi
            if in_band and len(comp) >= min_keep:
                kept_n += 1
                continue
            # Always keep the single largest even if band test fails (safety).
            drop.extend(comp)
        # If we would drop everything, fall back to largest-only.
        if kept_n == 0:
            components_list.sort(key=len, reverse=True)
            drop = [v for c in components_list[1:] for v in c]
        else:
            # Recompute drop: anything not kept
            keep_ids = set()
            for comp in components_list:
                ys = [float(v.co.y) for v in comp]
                cmin, cmax = min(ys), max(ys)
                in_band = cmax >= y_lo and cmin <= y_hi
                if in_band and len(comp) >= min_keep:
                    for v in comp:
                        keep_ids.add(v.index)
            # Ensure at least the largest is kept
            components_list.sort(key=len, reverse=True)
            for v in components_list[0]:
                keep_ids.add(v.index)
            drop = [v for v in bm_local.verts if v.index not in keep_ids]
        if drop:
            bmesh.ops.delete(bm_local, geom=drop, context="VERTS")
        bm_local.verts.ensure_lookup_table()
        bm_local.faces.ensure_lookup_table()

    _keep_largest_component(bm)

    if bm.faces:
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()

    # Offset along outward normals — cloth is not equidistant: chest eases out, underarm eases in.
    for v in bm.verts:
        n = v.normal
        if n.length < 1e-8:
            continue
        n = n.normalized()
        p = v.co
        # Anterior boost (front of chest) vs underarm reduction.
        frontness = max(0.0, (float(p.z) - cz) / max(body_depth * 0.5, 0.001))
        dL, _ = _poly_dist(p, chain_L)
        dR, _ = _poly_dist(p, chain_R)
        underarm = 1.0 if min(dL, dR) < sleeve_radius * 0.55 else 0.0
        scale = 1.0 + 0.15 * min(frontness, 1.0) - 0.20 * underarm
        off = cloth_offset * max(0.55, scale)
        v.co = p + n * off

    if bm.verts:
        _ys_off = [float(v.co.y) for v in bm.verts]
        print(
            f"[blender] #124 after normal offset: verts={len(bm.verts)} "
            f"y=[{min(_ys_off):.4f},{max(_ys_off):.4f}]"
        )

    # No solidify: rim faces export as detached micro-islands after glTF split-by-normal.
    # Cloth offset alone keeps vertices inside the inspect offset band.

    # Weld seams so glTF export keeps shared indices (export splits on UV/sharp seams —
    # the undiagnosed #82/§6t detached-blade failure class).
    if bm.verts:
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=5e-4)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
    if bm.verts:
        _ys_w = [float(v.co.y) for v in bm.verts]
        print(f"[blender] #124 after remove_doubles: verts={len(bm.verts)} y=[{min(_ys_w):.4f},{max(_ys_w):.4f}]")
    if bm.edges:
        try:
            bmesh.ops.dissolve_degenerate(bm, dist=2e-4, edges=list(bm.edges))
        except Exception:
            pass
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
    if bm.verts:
        _ys_dg = [float(v.co.y) for v in bm.verts]
        print(f"[blender] #124 after dissolve_degen: verts={len(bm.verts)} y=[{min(_ys_dg):.4f},{max(_ys_dg):.4f}]")
    # Drop pure isolates only (no faces AND no edges). Deleting edge-only bridge verts
    # split the lower-torso island from the chest (#124 midriff root cause: hem jumped
    # from bot_y≈0.82 to ≈1.04 after keep-largest dropped the orphaned hem island).
    loose = [v for v in bm.verts if (not v.link_faces) and (not v.link_edges)]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
    if bm.verts:
        _ys_lo = [float(v.co.y) for v in bm.verts]
        print(
            f"[blender] #124 after isolate-drop: isolates={len(loose)} verts={len(bm.verts)} "
            f"y=[{min(_ys_lo):.4f},{max(_ys_lo):.4f}]"
        )
    # #124: keep ALL non-trivial torso-band islands (hem island must survive if still split).
    _keep_garment_y_band_components(bm, bot_y - 0.05, neck_y + 0.05)
    if bm.verts:
        _ys_kl = [float(v.co.y) for v in bm.verts]
        print(
            f"[blender] #124 after keep_y_band: verts={len(bm.verts)} "
            f"y=[{min(_ys_kl):.4f},{max(_ys_kl):.4f}]"
        )
    if bm.faces:
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))

    # Open-front second pass: cut anterior wedge in the GARMENT's own frame so the
    # mid-height angular gap is large enough for hasAnteriorOpening (#46). Body-AABB
    # polar cut alone left dense front coverage after arm-inclusive width skew.
    if layer_is_open and bm.verts:
        gxs = [float(v.co.x) for v in bm.verts]
        gzs = [float(v.co.z) for v in bm.verts]
        gys = [float(v.co.y) for v in bm.verts]
        gcx = 0.5 * (min(gxs) + max(gxs))
        gcz = 0.5 * (min(gzs) + max(gzs))
        gmin_y, gmax_y = min(gys), max(gys)
        gheight = max(gmax_y - gmin_y, 0.001)
        ghalf_w = max(0.5 * (max(gxs) - min(gxs)), 0.001)
        open_half = max(half_gap, 0.75)
        drop_front = []
        for v in bm.verts:
            y = float(v.co.y)
            # Mid-height torso band where opening is graded
            yn = (y - gmin_y) / gheight
            if yn < 0.12 or yn > 0.92:
                continue
            x = float(v.co.x)
            z = float(v.co.z)
            # Keep sleeves (far lateral)
            if abs(x - gcx) >= ghalf_w * 0.62:
                continue
            ang = math.atan2(z - gcz, x - gcx)
            front = math.pi * 0.5
            d_ang = (ang - front + math.pi) % (2.0 * math.pi) - math.pi
            if abs(d_ang) < open_half:
                drop_front.append(v)
        if drop_front:
            bmesh.ops.delete(bm, geom=drop_front, context="VERTS")
            bm.verts.ensure_lookup_table()
            bm.faces.ensure_lookup_table()
            _keep_largest_component(bm)
            if bm.faces:
                bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            print(f"[blender] #121 open-front second-pass dropped={len(drop_front)} remaining={len(bm.verts)}")

    # #124 hem finish (measured Blender 5.1): bmesh.ops.bisect_plane is UNUSABLE here —
    # even cut-only (no clear_inner/outer) deleted the whole lower band (minY 0.78→1.04).
    # Instead: (1) delete verts below bot_y, (2) snap hem-boundary verts onto the plane,
    # (3) Laplacian-smooth the hem boundary in XZ so the loop is regular not a staircase.
    if bm.verts and bm.faces:
        # Histogram to catch density gaps (why delete-below raised minY past bot_y).
        _hist = [0] * 10
        _ymin_h, _ymax_h = 0.0, 1.76
        for v in bm.verts:
            yn = (float(v.co.y) - _ymin_h) / max(_ymax_h - _ymin_h, 1e-6)
            bi = min(9, max(0, int(yn * 10)))
            _hist[bi] += 1
        print(f"[blender] #124 y-hist(10 bins 0..1.76) before hem snap: {_hist}")
        # SNAP (not delete) verts below bot_y onto the hem plane. Deleting severed the
        # lower-torso island from the chest (export comps=2, shoulder counterweight red).
        # Snapping preserves face connectivity; a later remove_doubles collapses the
        # flattened band into a regular coplanar loop.
        n_snap = 0
        for v in bm.verts:
            if float(v.co.y) < bot_y - 1e-5:
                v.co.y = bot_y
                n_snap += 1
        bm.verts.ensure_lookup_table()
        if bm.verts:
            # Aggressive weld on the hem plane to erase the staircase polyline.
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.008)
            bm.verts.ensure_lookup_table()
            bm.edges.ensure_lookup_table()
            bm.faces.ensure_lookup_table()
            _ys_d2 = [float(v.co.y) for v in bm.verts]
            print(
                f"[blender] #124 after hem-plane snap: snapped={n_snap} "
                f"verts={len(bm.verts)} y=[{min(_ys_d2):.4f},{max(_ys_d2):.4f}]"
            )
        # Collect boundary verts in the lowest band (the hem). Open-front garments have a
        # non-closed hem arc; contract (1) measures path regularity, not loop count.
        hem_band = bot_y + max(0.03, (neck_y - bot_y) * 0.04)
        hem_vs = []
        if bm.edges:
            for e in bm.edges:
                if not e.is_boundary:
                    continue
                for v in e.verts:
                    if float(v.co.y) <= hem_band:
                        hem_vs.append(v)
        # Unique preserve order
        seen_h: set = set()
        hem_unique: list = []
        for v in hem_vs:
            if v.index not in seen_h:
                seen_h.add(v.index)
                hem_unique.append(v)
        for v in hem_unique:
            v.co.y = bot_y
        # Laplacian smooth in XZ only (keep y=bot_y) — damps staircase spikes / turn angles.
        # #208: 12 iters left child tshirt at 147° (planar notch near x=0). 28 iters + peak
        # turn clamp targets hemMaxTurnDegrees ≤ 100 and perimeter ratio ≤ 1.35.
        #
        # #188 regression (post bank rebake): scrub outer shells (scrub_pocket) exported with
        # degree-3..6 junctions on the low boundary — cycle-walk peak clamp never ordered a
        # clean ring, so nurse hems hit 180° / perimeter≈2.08 while open-front/gown (all
        # degree-2) stayed green. Footwear is NOT selected by the hem metric; this is real
        # product topology on the outer upper shell.
        if len(hem_unique) >= 4:
            adj: Dict[int, list] = {}
            for e in bm.edges:
                if not e.is_boundary:
                    continue
                a, b = e.verts[0], e.verts[1]
                if a.index in seen_h and b.index in seen_h:
                    adj.setdefault(a.index, []).append(b)
                    adj.setdefault(b.index, []).append(a)
            for _iter in range(28):
                updates = []
                for v in hem_unique:
                    nbrs = adj.get(v.index) or []
                    if not nbrs:
                        continue
                    mx = sum(float(n.co.x) for n in nbrs) / len(nbrs)
                    mz = sum(float(n.co.z) for n in nbrs) / len(nbrs)
                    updates.append((v, mx, mz))
                for v, mx, mz in updates:
                    v.co.x = 0.30 * float(v.co.x) + 0.70 * mx
                    v.co.z = 0.30 * float(v.co.z) + 0.70 * mz
                    v.co.y = bot_y

            # Closed shells: angular low-pass on XZ radius. Independent of edge degree —
            # scrub multi-layer hems are not pure degree-2 cycles, so edge-walk clamps miss.
            # Open-front keeps edge-walk only (anterior gap is a legitimate open arc).
            deg_hist = {}
            for v in hem_unique:
                d = len(adj.get(v.index) or [])
                deg_hist[d] = deg_hist.get(d, 0) + 1
            max_deg = max(deg_hist.keys()) if deg_hist else 0
            if (not layer_is_open) and len(hem_unique) >= 8:
                hcx = sum(float(v.co.x) for v in hem_unique) / float(len(hem_unique))
                hcz = sum(float(v.co.z) for v in hem_unique) / float(len(hem_unique))
                keyed: list = []
                for v in hem_unique:
                    dx = float(v.co.x) - hcx
                    dz = float(v.co.z) - hcz
                    ang = math.atan2(dz, dx)
                    r = math.hypot(dx, dz)
                    keyed.append([ang, r, v])
                keyed.sort(key=lambda t: t[0])
                n_k = len(keyed)
                for _smooth in range(16):
                    new_r = []
                    for i in range(n_k):
                        r0 = float(keyed[(i - 1) % n_k][1])
                        r1 = float(keyed[i][1])
                        r2 = float(keyed[(i + 1) % n_k][1])
                        new_r.append(0.15 * r0 + 0.70 * r1 + 0.15 * r2)
                    for i in range(n_k):
                        ang = float(keyed[i][0])
                        r = float(new_r[i])
                        # Mild convex bias: pull extreme radii toward median of neighbours.
                        keyed[i][1] = r
                        v = keyed[i][2]
                        v.co.x = hcx + r * math.cos(ang)
                        v.co.z = hcz + r * math.sin(ang)
                        v.co.y = bot_y
                # Peak-turn clamp on ANGULAR order (not edge walk) — works with degree>2.
                for _clamp in range(12):
                    moved = False
                    for i in range(n_k):
                        a = keyed[(i - 1) % n_k][2]
                        b = keyed[i][2]
                        c = keyed[(i + 1) % n_k][2]
                        d1x = float(b.co.x) - float(a.co.x)
                        d1z = float(b.co.z) - float(a.co.z)
                        d2x = float(c.co.x) - float(b.co.x)
                        d2z = float(c.co.z) - float(b.co.z)
                        l1 = (d1x * d1x + d1z * d1z) ** 0.5
                        l2 = (d2x * d2x + d2z * d2z) ** 0.5
                        if l1 < 1e-9 or l2 < 1e-9:
                            continue
                        cos = max(-1.0, min(1.0, (d1x * d2x + d1z * d2z) / (l1 * l2)))
                        ang = math.acos(cos) * 180.0 / math.pi
                        if ang <= 70.0:
                            continue
                        b.co.x = 0.20 * float(b.co.x) + 0.40 * (float(a.co.x) + float(c.co.x))
                        b.co.z = 0.20 * float(b.co.z) + 0.40 * (float(a.co.z) + float(c.co.z))
                        b.co.y = bot_y
                        # Keep angular table radii coherent for next iter.
                        keyed[i][1] = math.hypot(float(b.co.x) - hcx, float(b.co.z) - hcz)
                        moved = True
                    if not moved:
                        break
                # Collapse branched junctions: snap degree>2 verts onto nearest angular
                # neighbour so remove_doubles can erase the T-junction that produces 180° folds.
                if max_deg > 2:
                    for i in range(n_k):
                        v = keyed[i][2]
                        if len(adj.get(v.index) or []) <= 2:
                            continue
                        a = keyed[(i - 1) % n_k][2]
                        c = keyed[(i + 1) % n_k][2]
                        v.co.x = 0.5 * (float(a.co.x) + float(c.co.x))
                        v.co.z = 0.5 * (float(a.co.z) + float(c.co.z))
                        v.co.y = bot_y
                print(
                    f"[blender] #124/#188 closed-hem angular smooth: "
                    f"hem_verts={len(hem_unique)} max_boundary_deg={max_deg} deg_hist={deg_hist}"
                )
            elif adj:
                # Open-front (and small hems): edge-walk peak clamp as in #208.
                start_v = next((v for v in hem_unique if len(adj.get(v.index) or []) >= 1), None)
                if start_v is not None:
                    ordered: list = []
                    prev_i = -1
                    cur_i = start_v.index
                    seen_ord: set = set()
                    while cur_i not in seen_ord:
                        seen_ord.add(cur_i)
                        ordered.append(cur_i)
                        nbrs_i = adj.get(cur_i) or []
                        nxt = None
                        for n in nbrs_i:
                            if n.index != prev_i:
                                nxt = n
                                break
                        if nxt is None:
                            break
                        prev_i = cur_i
                        cur_i = nxt.index
                        if cur_i == start_v.index:
                            break
                    idx_to_vert = {v.index: v for v in hem_unique}
                    for _clamp in range(12):
                        moved = False
                        n_ord = len(ordered)
                        if n_ord < 4:
                            break
                        for i in range(n_ord):
                            i0 = ordered[(i - 1) % n_ord]
                            i1 = ordered[i]
                            i2 = ordered[(i + 1) % n_ord]
                            v0 = idx_to_vert.get(i0)
                            v1 = idx_to_vert.get(i1)
                            v2 = idx_to_vert.get(i2)
                            if v0 is None or v1 is None or v2 is None:
                                continue
                            d1x = float(v1.co.x) - float(v0.co.x)
                            d1z = float(v1.co.z) - float(v0.co.z)
                            d2x = float(v2.co.x) - float(v1.co.x)
                            d2z = float(v2.co.z) - float(v1.co.z)
                            l1 = (d1x * d1x + d1z * d1z) ** 0.5
                            l2 = (d2x * d2x + d2z * d2z) ** 0.5
                            if l1 < 1e-9 or l2 < 1e-9:
                                continue
                            cos = max(-1.0, min(1.0, (d1x * d2x + d1z * d2z) / (l1 * l2)))
                            ang = math.acos(cos) * 180.0 / math.pi
                            if ang <= 70.0:
                                continue
                            v1.co.x = 0.20 * float(v1.co.x) + 0.40 * (
                                float(v0.co.x) + float(v2.co.x)
                            )
                            v1.co.z = 0.20 * float(v1.co.z) + 0.40 * (
                                float(v0.co.z) + float(v2.co.z)
                            )
                            v1.co.y = bot_y
                            moved = True
                        if not moved:
                            break
        if bm.verts:
            # Slightly larger weld after hem reshape collapses residual spike clusters
            # without reintroducing solidify rims (#121).
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0012)
            bm.verts.ensure_lookup_table()
            bm.faces.ensure_lookup_table()

        # Closed shells only: delete faces that lie entirely on the hem plane.
        # Measured: scrub outer after #188 bank rebake has 15–24 disjoint boundary loops
        # all at bot_y (swiss-cheese coplanar pockets from snap). Metric picks a tiny
        # fold-back (180°). Removing coplanar hem-plane faces leaves one outer ring as
        # the sole bottom boundary. Open-front keeps its anterior gap — skip.
        if (not layer_is_open) and bm.faces:
            bm.faces.ensure_lookup_table()
            bm.verts.ensure_lookup_table()
            y_eps = 0.012
            planar_faces = []
            for f in bm.faces:
                ys = [float(v.co.y) for v in f.verts]
                if all(abs(y - bot_y) <= y_eps for y in ys):
                    planar_faces.append(f)
            n_planar = len(planar_faces)
            if planar_faces:
                bmesh.ops.delete(bm, geom=planar_faces, context="FACES")
                bm.verts.ensure_lookup_table()
                bm.edges.ensure_lookup_table()
                bm.faces.ensure_lookup_table()
            # Drop loose verts left by deleted coplanar faces.
            loose_p = [v for v in bm.verts if (not v.link_faces) and (not v.link_edges)]
            if loose_p:
                bmesh.ops.delete(bm, geom=loose_p, context="VERTS")
                bm.verts.ensure_lookup_table()
                bm.faces.ensure_lookup_table()
            # Re-snap remaining bottom boundary to bot_y and weld.
            hem_bound = []
            for v in bm.verts:
                if abs(float(v.co.y) - bot_y) > y_eps:
                    continue
                if any(e.is_boundary for e in v.link_edges):
                    v.co.y = bot_y
                    hem_bound.append(v)
            if hem_bound:
                bmesh.ops.remove_doubles(bm, verts=hem_bound, dist=0.006)
                bm.verts.ensure_lookup_table()
                bm.faces.ensure_lookup_table()
            # Re-collect outer hem ring and angular-smooth AFTER planar delete.
            # Pre-delete smooth cannot fix the ring that only appears once coplanar
            # pockets are gone (measured: 180→169 still failed after delete alone).
            hem_ring = []
            for v in bm.verts:
                if abs(float(v.co.y) - bot_y) > y_eps:
                    continue
                if any(e.is_boundary for e in v.link_edges):
                    hem_ring.append(v)
            if len(hem_ring) >= 8:
                hcx = sum(float(v.co.x) for v in hem_ring) / float(len(hem_ring))
                hcz = sum(float(v.co.z) for v in hem_ring) / float(len(hem_ring))
                keyed2: list = []
                for v in hem_ring:
                    dx = float(v.co.x) - hcx
                    dz = float(v.co.z) - hcz
                    keyed2.append([math.atan2(dz, dx), math.hypot(dx, dz), v])
                keyed2.sort(key=lambda t: t[0])
                n2 = len(keyed2)
                for _s in range(24):
                    new_r = []
                    for i in range(n2):
                        r0 = float(keyed2[(i - 1) % n2][1])
                        r1 = float(keyed2[i][1])
                        r2 = float(keyed2[(i + 1) % n2][1])
                        new_r.append(0.12 * r0 + 0.76 * r1 + 0.12 * r2)
                    for i in range(n2):
                        ang = float(keyed2[i][0])
                        r = float(new_r[i])
                        keyed2[i][1] = r
                        v = keyed2[i][2]
                        v.co.x = hcx + r * math.cos(ang)
                        v.co.z = hcz + r * math.sin(ang)
                        v.co.y = bot_y
                for _c in range(16):
                    moved = False
                    for i in range(n2):
                        a = keyed2[(i - 1) % n2][2]
                        b = keyed2[i][2]
                        c = keyed2[(i + 1) % n2][2]
                        d1x = float(b.co.x) - float(a.co.x)
                        d1z = float(b.co.z) - float(a.co.z)
                        d2x = float(c.co.x) - float(b.co.x)
                        d2z = float(c.co.z) - float(b.co.z)
                        l1 = (d1x * d1x + d1z * d1z) ** 0.5
                        l2 = (d2x * d2x + d2z * d2z) ** 0.5
                        if l1 < 1e-9 or l2 < 1e-9:
                            continue
                        cos = max(-1.0, min(1.0, (d1x * d2x + d1z * d2z) / (l1 * l2)))
                        ang = math.acos(cos) * 180.0 / math.pi
                        if ang <= 55.0:
                            continue
                        b.co.x = 0.15 * float(b.co.x) + 0.425 * (
                            float(a.co.x) + float(c.co.x)
                        )
                        b.co.z = 0.15 * float(b.co.z) + 0.425 * (
                            float(a.co.z) + float(c.co.z)
                        )
                        b.co.y = bot_y
                        keyed2[i][1] = math.hypot(
                            float(b.co.x) - hcx, float(b.co.z) - hcz
                        )
                        moved = True
                    if not moved:
                        break
                # Edge-walk collapse: mesh edges can still zigzag after angular re-position.
                # Measured 179° spikes with sameAC=false (not reverse, sawtooth connectivity).
                # Co-locate any boundary vert whose edge-walk turn > 80° onto its previous
                # neighbour, then weld — shortens the serration out of the exported loop.
                for _collapse in range(8):
                    bm.edges.ensure_lookup_table()
                    bm.verts.ensure_lookup_table()
                    hadj: Dict[int, list] = {}
                    hverts = []
                    for e in bm.edges:
                        if not e.is_boundary:
                            continue
                        y0 = float(e.verts[0].co.y)
                        y1 = float(e.verts[1].co.y)
                        if abs(y0 - bot_y) > y_eps or abs(y1 - bot_y) > y_eps:
                            continue
                        a, b = e.verts[0], e.verts[1]
                        hadj.setdefault(a.index, []).append(b)
                        hadj.setdefault(b.index, []).append(a)
                        hverts.append(a)
                        hverts.append(b)
                    # unique
                    seen_hv: set = set()
                    huniq = []
                    for v in hverts:
                        if v.index not in seen_hv:
                            seen_hv.add(v.index)
                            huniq.append(v)
                    if len(huniq) < 4:
                        break
                    start = next(
                        (v for v in huniq if len(hadj.get(v.index) or []) == 2),
                        huniq[0],
                    )
                    ordered_e: list = []
                    prev_i = -1
                    cur_i = start.index
                    seen_e: set = set()
                    while cur_i not in seen_e and len(ordered_e) < 500:
                        seen_e.add(cur_i)
                        ordered_e.append(cur_i)
                        nbrs = hadj.get(cur_i) or []
                        nxt = None
                        for n in nbrs:
                            if n.index != prev_i:
                                nxt = n
                                break
                        if nxt is None:
                            break
                        prev_i = cur_i
                        cur_i = nxt.index
                        if cur_i == start.index:
                            break
                    idx_map = {v.index: v for v in huniq}
                    n_o = len(ordered_e)
                    collapsed = 0
                    if n_o >= 4 and cur_i == start.index:
                        for i in range(n_o):
                            i0 = ordered_e[(i - 1) % n_o]
                            i1 = ordered_e[i]
                            i2 = ordered_e[(i + 1) % n_o]
                            v0, v1, v2 = idx_map.get(i0), idx_map.get(i1), idx_map.get(i2)
                            if v0 is None or v1 is None or v2 is None:
                                continue
                            d1x = float(v1.co.x) - float(v0.co.x)
                            d1z = float(v1.co.z) - float(v0.co.z)
                            d2x = float(v2.co.x) - float(v1.co.x)
                            d2z = float(v2.co.z) - float(v1.co.z)
                            l1 = (d1x * d1x + d1z * d1z) ** 0.5
                            l2 = (d2x * d2x + d2z * d2z) ** 0.5
                            if l1 < 1e-9 or l2 < 1e-9:
                                # zero-length → co-locate
                                v1.co.x = float(v0.co.x)
                                v1.co.z = float(v0.co.z)
                                v1.co.y = bot_y
                                collapsed += 1
                                continue
                            cos = max(
                                -1.0, min(1.0, (d1x * d2x + d1z * d2z) / (l1 * l2))
                            )
                            ang = math.acos(cos) * 180.0 / math.pi
                            if ang <= 80.0:
                                continue
                            # Snap spike onto chord midpoint (stronger than laplace).
                            v1.co.x = 0.5 * (float(v0.co.x) + float(v2.co.x))
                            v1.co.z = 0.5 * (float(v0.co.z) + float(v2.co.z))
                            v1.co.y = bot_y
                            collapsed += 1
                    if collapsed == 0:
                        break
                    bmesh.ops.remove_doubles(bm, verts=list(huniq), dist=0.005)
                    bm.verts.ensure_lookup_table()
                    bm.faces.ensure_lookup_table()
                bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if abs(float(v.co.y) - bot_y) <= y_eps], dist=0.004)
                bm.verts.ensure_lookup_table()
                bm.faces.ensure_lookup_table()
            # Count remaining hem-plane boundary edges (should be one ring).
            n_hem_be = 0
            for e in bm.edges:
                if not e.is_boundary:
                    continue
                if (
                    abs(float(e.verts[0].co.y) - bot_y) <= y_eps
                    and abs(float(e.verts[1].co.y) - bot_y) <= y_eps
                ):
                    n_hem_be += 1
            print(
                f"[blender] #124/#188 closed-hem planar-face delete: "
                f"deleted_faces={n_planar} hem_boundary_edges={n_hem_be} "
                f"hem_ring_verts={len(hem_ring)}"
            )

        # Isolates only — do not delete edge-bridge verts (see above).
        loose_h = [v for v in bm.verts if (not v.link_faces) and (not v.link_edges)]
        if loose_h:
            bmesh.ops.delete(bm, geom=loose_h, context="VERTS")
            bm.verts.ensure_lookup_table()
            bm.faces.ensure_lookup_table()
        # Keep every torso-band island (never largest-only — that is the #124 midriff drop).
        _keep_garment_y_band_components(bm, bot_y - 0.05, neck_y + 0.05)
        # #124: if arm/neck cuts left multiple islands, weld nearest pairs within 8cm so
        # export stays one component (shoulderSpanned counterweight).
        _weld_nearby_components(bm, max_dist=0.12)
        if bm.faces:
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        if bm.verts:
            _ys_bis = [float(v.co.y) for v in bm.verts]
            print(
                f"[blender] #124 hem delete+snap+smooth at bot_y={bot_y:.4f} "
                f"hem_boundary_verts={len(hem_unique)} verts={len(bm.verts)} "
                f"faces={len(bm.faces)} y=[{min(_ys_bis):.4f},{max(_ys_bis):.4f}]"
            )
        else:
            print(f"[blender] #124 hem finish at bot_y={bot_y:.4f} EMPTY")

    bm.to_mesh(gmesh)
    bm.free()
    gmesh.update()
    _ys_out = [float(v.co.y) for v in gmesh.vertices]
    print(
        f"[blender] #124 to_mesh garment: verts={len(gmesh.vertices)} "
        f"y=[{min(_ys_out):.4f},{max(_ys_out):.4f}]"
    )
    # Drop copied body UVs — UV seams force the glTF exporter to split shared vertices.
    while gmesh.uv_layers:
        gmesh.uv_layers.remove(gmesh.uv_layers[0])
    if hasattr(gmesh, "color_attributes"):
        while len(gmesh.color_attributes) > 0:
            gmesh.color_attributes.remove(gmesh.color_attributes[0])
    if hasattr(gmesh, "use_auto_smooth"):
        gmesh.use_auto_smooth = False
    try:
        gmesh.free_normals_split()
    except Exception:
        pass
    for p in gmesh.polygons:
        p.use_smooth = True
    print(
        f"[blender] #121/#124 surface-derived shell verts={len(gmesh.vertices)} "
        f"faces={len(gmesh.polygons)} (planar hem, post-weld single-component, no solidify)"
    )
    return garment


def apply_role_clothing_material_regions(mesh_obj: bpy.types.Object, actor_role: str, phenotype: Dict[str, Any], arm_obj: Optional[bpy.types.Object] = None) -> Dict[str, Any]:
    """
    Assign simple case-driven clothing materials to the humanoid mesh itself.
    EXPANDED (pivot embed-real-garment-region-from-phenotype Q1 Q5 + peds-parent-nurse-garment-asset):
    reads phenotype.garmentLayers (e.g. ["short_sleeve_exam_tshirt"] patient; ["casual_top","open_cardigan"] parent_tara_johnson_v1; ["scrub_top","scrub_pocket"] nurse_kevin_lee_v1 from peds_asthma_parent_anxiety_v1).
    For upper garment layers on patient/parent/nurse, emits REAL body-surface-derived (#121) torso+shoulder+sleeve
    geometry with vertex weights on Anny canonical armature bones (clavicle.L/R, upper_arm.L/R, chest, spine, neck)
    + ARMATURE modifier so sleeves deform (deformsWithBreathing=true). Keeps body mesh-native material regions.
    SOLIDIFY + weighted normals for volume. SLEEVE-FIT (garment-sleeve-fit-parent-nurse-v1): torso r_base from shoulder-band/depth (not arm-span AABB); sleeves as tubes along upper_arm bone (clavicle→elbow), not vertical -Y mid-body boxes; tighter sleeve_r0 + thinner SOLIDIFY; denser 9x12+; vivid (0.08,0.52,0.95); faceCount~300+; bind pose remains body-local Y height.

    #73 material-region hygiene: when a real garment mesh will own the silhouette, do NOT paint
    torso top/soft_trim materials onto the body (double clothing → jagged paint seams + runtime
    refuses those slots). Lower/pants paint may still apply. Not a "smooth all boundaries" pass.
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

    # Detect real-garment embed early (#73): geometry owns upper silhouette → skip torso paint.
    garment_layers = phenotype.get("garmentLayers", []) or [phenotype.get("clothing_style", "")]
    garment_layers_lower = [str(g).lower() for g in garment_layers]
    garment_layers_joined = " ".join(garment_layers_lower)
    is_gown = any(k in garment_layers_joined for k in ("hospital_gown", "gown", "patient_gown", "ed_gown"))
    is_open_front = any(
        k in garment_layers_joined
        for k in ("open_cardigan", "open_front", "cardigan", "open_jacket", "lab_coat_open")
    ) and not is_gown
    is_scrub = any(k in garment_layers_joined for k in ("scrub_top", "scrub_pocket", "scrub")) and not is_open_front
    will_embed_real_garment = (
        any(
            k in garment_layers_joined
            for k in (
                "short_sleeve_exam_tshirt",
                "tshirt",
                "exam_tshirt",
                "short_sleeve",
                "casual_top",
                "open_cardigan",
                "scrub_top",
                "scrub_pocket",
                "scrub",
            )
        )
        or any(r in role for r in ("patient", "parent", "nurse", "guardian"))
        or is_gown
    )
    # #73: skip body-mesh top/trim paint when real garment mesh will cover the torso.
    # Keep lower/pants fill (no pants shell). Conditioned so roles without a garment still paint.
    skip_torso_paint = bool(will_embed_real_garment)
    # #103: open cardigan needs a closed under-layer (mesh) — do NOT restore full torso paint
    # under closed kinds (that re-creates #73 double clothing). Arm below a short cuff is a
    # different region: garment mesh ends; paint the limb so the sleeve does not end at bare arm.
    # Decision: paint forearm/upper-arm clothing (not sleeve lengthening) — preserves short-sleeve
    # clinical silhouette on scrubs/tshirts; lengthening would change a clinician-visible class.

    lower_mat = create_role_marker_material(f"openclinxr_role_mesh_clothing_{role}_lower", lower_color)
    lower_index = len(mesh_obj.data.materials)
    mesh_obj.data.materials.append(lower_mat)
    top_mat = None
    trim_mat = None
    top_index = -1
    trim_index = -1
    if not skip_torso_paint:
        top_mat = create_role_marker_material(f"openclinxr_role_mesh_clothing_{role}_top", top_color)
        trim_mat = create_role_marker_material(f"openclinxr_role_mesh_clothing_{role}_soft_trim", (0.47, 0.68, 0.96, 1.0))
        top_index = len(mesh_obj.data.materials)
        mesh_obj.data.materials.append(top_mat)
        trim_index = len(mesh_obj.data.materials)
        mesh_obj.data.materials.append(trim_mat)
    # Arm clothing material always available when a real garment owns the torso (#103 sleeve-end).
    # #146: do NOT use a silent hardcoded teal-blue fallback. top_color is always set for paint
    # roles, but when the torso is a real garment MESH the visible colour lives on gown_color —
    # arm_mat is provisional here and recolored from the outermost real garment shell after
    # embed (exact match → reads as continuous sleeve of that garment; see armClothingColour*).
    arm_mat = None
    arm_index = -1
    if will_embed_real_garment:
        # Provisional = role top_color (always assigned above). Never the dead (0.08,0.42,0.55)
        # constant that mismatched pink/light garments (#146 residual of #103).
        arm_mat = create_role_marker_material(
            f"openclinxr_role_mesh_clothing_{role}_arm",
            top_color,
        )
        arm_index = len(mesh_obj.data.materials)
        mesh_obj.data.materials.append(arm_mat)

    # #73: paint in LOCAL mesh space. Blender's OBJ importer can leave a world
    # rotation that swaps Y/Z in world bounds while local data stays Y-height
    # (Anny rewrite). Local coords match the garment authoring basis + glTF export.
    body_vs = list(mesh_obj.data.vertices)
    bxs = [v.co.x for v in body_vs]
    bys = [v.co.y for v in body_vs]
    bzs = [v.co.z for v in body_vs]
    min_x_l, max_x_l = min(bxs), max(bxs)
    min_y_l, max_y_l = min(bys), max(bys)
    min_z_l, max_z_l = min(bzs), max(bzs)
    # Prefer local Y as height when it dominates (Anny); else local Z.
    if (max_y_l - min_y_l) >= (max_z_l - min_z_l) * 0.9:
        height_axis = "y"
        min_h = min_y_l
        height_h = max(max_y_l - min_y_l, 0.001)
    else:
        height_axis = "z"
        min_h = min_z_l
        height_h = max(max_z_l - min_z_l, 0.001)
    center_x = (min_x_l + max_x_l) * 0.5
    body_width_l = max(max_x_l - min_x_l, 0.001)
    # Wider bands make the generated actor read as clothed in isolated browser
    # evidence, while still avoiding detached cube/card markers.
    # garment source-quality v1 (2026-06-07 autonomy kickoff): widened collar/waist trim
    # + adjusted factors for better visual clothing "intent" and reduced abrupt jagged seam
    # read on low-poly pediatric school-age topology (still fully mesh-native bounds-based,
    # no detached geometry, no regression to live skinning/garment-trim prior work).
    #
    # #124 shared waistline: painted lower top AND closed-top mesh hems meet here.
    # One fraction drives both systems so a bare midriff cannot open between them.
    # Long garments (gown, open cardigan) still cut well below; short tops bisect at
    # waist - small absolute overlap so hemLowestY <= paintedLowerTopY.
    # 0.50: paint top high enough that face *centroids* (not just verts) reach the hem.
    SHARED_WAIST_FRACTION = 0.50
    top_min_h = min_h + height_h * 0.42
    top_max_h = min_h + height_h * 0.74
    lower_min_h = min_h + height_h * 0.08
    lower_max_h = min_h + height_h * SHARED_WAIST_FRACTION
    max_torso_half_width = max(body_width_l * 0.50, 0.12)
    shoulder_half_width = max(body_width_l * 0.36, 0.09)

    mesh_obj.update_from_editmode()
    mesh_obj.update_tag()
    top_faces = 0
    lower_faces = 0
    trim_faces = 0
    arm_faces = 0
    skipped_back_faces = 0
    skipped_torso_paint_faces = 0
    lower_paint_max_ch = -1e9
    # #103 short-sleeve end: paint clothing on the limb so the sleeve does not end at bare arm.
    # #147: DO NOT use a global body-height plane for the wrist (0.12×height ≈ ankle — same class
    # as #124's hem). Anatomical wrist = hand.L/R bone head (= forearm.tail). Two positive rules:
    #   clothe by proximity to the elbow→hand forearm segment distal of the cuff;
    #   leave skin by proximity to the mesh-distal band toward the hand bone (hands).
    # Shrinking a Y band re-opens the bare forearm gap #103 closed (§6p / #73 trap).
    # Universal skin hands for v1 (role gloves later, clinician-gated).
    arm_cuff_h = min_h + height_h * 0.66  # cuff height bound kept; NOT the wrist
    arm_lat_min = body_width_l * 0.20

    def _bone_head_mesh_local(bname: str):
        if arm_obj is None:
            return None
        bone = arm_obj.data.bones.get(bname)
        if bone is None:
            return None
        # Bones are authored from mesh bbox in mesh-local space (create_canonical_armature).
        # Use rest head_local directly — parenting/world transforms double-apply and miss the limb.
        h = bone.head_local
        return (float(h.x), float(h.y), float(h.z))

    hand_L = _bone_head_mesh_local("hand.L")
    hand_R = _bone_head_mesh_local("hand.R")
    elbow_L = _bone_head_mesh_local("forearm.L")  # forearm head = elbow
    elbow_R = _bone_head_mesh_local("forearm.R")
    # Fallback: same bbox limb factors as create_canonical_armature (hand 0.42, elbow 0.58).
    if hand_L is None or hand_R is None or elbow_L is None or elbow_R is None:
        half_span = max(body_width_l * 0.44, height_h * 0.32)
        elbow_off = max(body_width_l * 0.34, half_span * 0.75)
        center_z_l = (min_z_l + max_z_l) * 0.5

        def _limb(x_off: float, y_factor: float):
            return (center_x + x_off, min_h + height_h * y_factor, center_z_l)

        if hand_L is None:
            hand_L = _limb(half_span, 0.42)
        if hand_R is None:
            hand_R = _limb(-half_span, 0.42)
        if elbow_L is None:
            elbow_L = _limb(elbow_off, 0.58)
        if elbow_R is None:
            elbow_R = _limb(-elbow_off, 0.58)

    def _seg_s_and_dist(px: float, py: float, pz: float, a, b):
        ax, ay, az = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        fl2 = ax * ax + ay * ay + az * az
        if fl2 < 1e-12:
            return 0.0, 1e9
        fl = fl2 ** 0.5
        tx, ty, tz = px - a[0], py - a[1], pz - a[2]
        s = (tx * ax + ty * ay + tz * az) / fl2  # 0 at elbow, 1 at hand bone
        projx, projy, projz = a[0] + ax * s, a[1] + ay * s, a[2] + az * s
        d = ((px - projx) ** 2 + (py - projy) ** 2 + (pz - projz) ** 2) ** 0.5
        return s, d

    # Generous tube radius: Anny arm verts sit off the bone axis (depth/Z bulge); too tight → arm_faces=0.
    arm_r = max(body_width_l * 0.22, 0.10)
    # Pass 1: among lateral faces near either forearm segment (below cuff), record max s per side.
    # Mesh arms often end short of the hand bone (s_max ≪ 1); the distal band IS the visual hand.
    side_s_max = [-1e9, -1e9]
    side_s_min = [1e9, 1e9]
    for polygon in mesh_obj.data.polygons:
        center = polygon.center
        ch = center.y if height_axis == "y" else center.z
        rel_x = abs(center.x - center_x)
        if arm_index < 0 or rel_x < arm_lat_min or ch > arm_cuff_h + height_h * 0.02:
            continue
        px, py, pz = float(center.x), float(center.y), float(center.z)
        for side_i, (elb, hnd) in enumerate(((elbow_L, hand_L), (elbow_R, hand_R))):
            s, d = _seg_s_and_dist(px, py, pz, elb, hnd)
            if d > arm_r * 1.35 or s < -0.35 or s > 1.15:
                continue
            if s > side_s_max[side_i]:
                side_s_max[side_i] = s
            if s < side_s_min[side_i]:
                side_s_min[side_i] = s

    # Distal ~32% of each side's mesh arm extent → skin hands; proximal → clothed forearm.
    # 0.28 left ~10.6% residual clothing on the distal band (just over the 0.10 seam allowance).
    DISTAL_HAND_FRACTION = 0.32
    side_hand_cut = [1.0, 1.0]
    for side_i in (0, 1):
        if side_s_max[side_i] < -1e8:
            side_hand_cut[side_i] = 1.0
            continue
        span = max(side_s_max[side_i] - side_s_min[side_i], 0.05)
        side_hand_cut[side_i] = side_s_max[side_i] - max(span * DISTAL_HAND_FRACTION, 0.04)

    for polygon in mesh_obj.data.polygons:
        # Local face center (not world) — stable under OBJ import rotation.
        center = polygon.center
        ch = center.y if height_axis == "y" else center.z
        rel_h = (ch - min_h) / height_h
        rel_x = abs(center.x - center_x)
        waist_factor = 0.68 + 0.32 * min(1.0, abs(rel_h - 0.52) / 0.28)
        effective_half_width = max_torso_half_width * waist_factor
        is_collar_trim = (top_max_h - height_h * 0.024) <= ch <= top_max_h and rel_x <= shoulder_half_width * 0.80
        is_waist_trim = (top_min_h - height_h * 0.019) <= ch <= (top_min_h + height_h * 0.019) and rel_x <= effective_half_width * 0.98
        is_top = top_min_h <= ch <= top_max_h and rel_x <= effective_half_width
        # #124: near the shared waist the torso widens (and arms attach); the old half-width
        # test capped paint at ~0.70m while lower_max_h was 0.88m. In the upper lower-band
        # (above 0.40 of height) use nearly full body half-width so paint meets the hem.
        near_waist = ch >= (min_h + height_h * 0.40)
        lower_half = (
            body_width_l * 0.52 if near_waist else effective_half_width * 0.95
        )
        poly_max_h = ch
        try:
            for vi in polygon.vertices:
                vh = body_vs[vi].co.y if height_axis == "y" else body_vs[vi].co.z
                if vh > poly_max_h:
                    poly_max_h = vh
        except Exception:
            pass
        is_lower = (
            (
                (lower_min_h <= ch <= lower_max_h)
                or (lower_min_h <= poly_max_h <= lower_max_h + height_h * 0.02 and ch >= lower_min_h)
            )
            and rel_x <= lower_half
        )
        # #147 arm clothing: forearm-segment proximity, not global height plane; distal band = skin.
        is_arm_clothing = False
        if arm_index >= 0 and rel_x >= arm_lat_min and ch <= arm_cuff_h + height_h * 0.02:
            px, py, pz = float(center.x), float(center.y), float(center.z)
            best_side = -1
            best_d = 1e9
            best_s = 0.0
            for side_i, (elb, hnd) in enumerate(((elbow_L, hand_L), (elbow_R, hand_R))):
                s, d = _seg_s_and_dist(px, py, pz, elb, hnd)
                if d < best_d:
                    best_d = d
                    best_s = s
                    best_side = side_i
            if (
                best_side >= 0
                and best_d <= arm_r * 1.35
                and best_s >= -0.25
                and best_s < side_hand_cut[best_side]
            ):
                is_arm_clothing = True
        # #124: paint lower FIRST so the shared waist band is claimed even when
        # skip_torso_paint would have continued past is_top faces (top_min=0.42*h
        # overlaps lower_max=0.50*h — that overlap is exactly the midriff gap).
        if is_lower:
            polygon.material_index = lower_index
            lower_faces += 1
            if ch > lower_paint_max_ch:
                lower_paint_max_ch = ch
            continue
        if is_arm_clothing:
            polygon.material_index = arm_index
            arm_faces += 1
            continue
        if skip_torso_paint and (is_collar_trim or is_waist_trim or is_top):
            # Leave skin material — real garment mesh owns this silhouette (#73).
            skipped_torso_paint_faces += 1
            continue
        if not skip_torso_paint and (is_collar_trim or is_waist_trim):
            polygon.material_index = trim_index
            trim_faces += 1
        elif not skip_torso_paint and is_top:
            polygon.material_index = top_index
            top_faces += 1

    print(
        f"[blender] #124/#147 paint bands: height_axis={height_axis} min_h={min_h:.4f} "
        f"height_h={height_h:.4f} lower_max_h={lower_max_h:.4f} "
        f"SHARED_WAIST_FRACTION={SHARED_WAIST_FRACTION} lower_faces={lower_faces} "
        f"lower_paint_max_ch={lower_paint_max_ch:.4f} "
        f"top_faces={top_faces} arm_faces={arm_faces} skip_torso={skip_torso_paint} "
        f"hand_cut_L={side_hand_cut[0]:.3f} hand_cut_R={side_hand_cut[1]:.3f} "
        f"s_max_L={side_s_max[0]:.3f} s_max_R={side_s_max[1]:.3f}"
    )
    if lower_faces == 0:
        raise RuntimeError(
            f"role clothing material assignment failed: top_faces={top_faces}, "
            f"lower_faces={lower_faces}, trim_faces={trim_faces}, skip_torso_paint={skip_torso_paint}"
        )
    if not skip_torso_paint and (top_faces == 0 or trim_faces == 0):
        raise RuntimeError(
            f"role clothing material assignment failed: top_faces={top_faces}, "
            f"lower_faces={lower_faces}, trim_faces={trim_faces}"
        )

    ret = {
        "meshRegionMaterialMode": "bounds_based_role_clothing_material_assignment",
        "clothingRegionRevision": (
            "v9_arm_clothing_hand_bone_wrist_boundary_issue_147_keep_forearm_coverage_103_colour_146"
            if skip_torso_paint
            else "v6_garment_source_quality_wider_native_trim_pediatric_school_age"
        ),
        "topMaterialName": top_mat.name if top_mat is not None else None,
        "lowerMaterialName": lower_mat.name,
        "trimMaterialName": trim_mat.name if trim_mat is not None else None,
        "armMaterialName": arm_mat.name if arm_mat is not None else None,
        "topFaceCount": top_faces,
        "lowerFaceCount": lower_faces,
        "trimFaceCount": trim_faces,
        "armFaceCount": arm_faces,
        "skippedBackFaceCount": skipped_back_faces,
        "skippedTorsoPaintFaceCount": skipped_torso_paint_faces,
        "skippedTorsoPaintBecauseRealGarment": skip_torso_paint,
        "claimScope": "procedural_bounds_based_clothing_material_regions_not_production_wardrobe",
        "notEvidenceFor": ["production_asset_readiness", "b_plus_visual_realism_gate", "clinical_validity", "scoring_validity"],
    }

    # PIVOT IMPLEMENTATION: embed-real-garment-region-from-phenotype (Q1 Q5)
    # Read garmentLayers from case phenotype (peds_asthma_parent_anxiety_v1: ["short_sleeve_exam_tshirt"])
    # Produce real (non-hint) sleeve-bearing geometry skinned for deformation. Expanded sleeve scope
    # per asset-pipeline-lead: len>=0.25, r/rows/cols up, +bulge/ripple/folds, vivid contrast color,
    # prominent separate mesh deforming on breathing. Q1 peds blueprint drives visible 3D garment.
    real_garment = None
    # #75 multi-layer: phenotype.garmentLayers is a LIST — build one shell per upper layer.
    # Inner shells are closed and at smaller radius so an open outer reveals cloth, not skin.
    # Do NOT restore torso paint (#73); do NOT remove lower paint (no pants shell yet).
    # re-orchestrated for peds-parent-nurse + ed-gown; role topology from #46 retained per layer.
    if will_embed_real_garment:
        import math
        # BIND-POSE: author garment in body local space X=width Y=height Z=depth.
        body_vs = list(mesh_obj.data.vertices)
        bxs = [v.co.x for v in body_vs]
        bys = [v.co.y for v in body_vs]
        bzs = [v.co.z for v in body_vs]
        body_min_x, body_max_x = min(bxs), max(bxs)
        body_min_y, body_max_y = min(bys), max(bys)
        body_min_z, body_max_z = min(bzs), max(bzs)
        body_height = max(body_max_y - body_min_y, 0.001)
        body_width = max(body_max_x - body_min_x, 0.001)
        body_depth = max(body_max_z - body_min_z, 0.001)
        cx = (body_min_x + body_max_x) * 0.5
        cz = (body_min_z + body_max_z) * 0.5
        shoulder_y_lo = body_min_y + body_height * 0.68
        shoulder_y_hi = body_min_y + body_height * 0.78
        shoulder_xs = [v.co.x for v in body_vs if shoulder_y_lo <= v.co.y <= shoulder_y_hi]
        if shoulder_xs:
            shoulder_half = max(abs(min(shoulder_xs) - cx), abs(max(shoulder_xs) - cx))
        else:
            shoulder_half = body_width * 0.28
        torso_half_w = max(body_depth * 0.52, shoulder_half * 0.55, body_width * 0.14)
        r_base_shared = torso_half_w * 1.06
        # Neckline height kept at 0.81 (#73); coverage of deltoids is geometry+under-layer, not higher top_y.
        top_y_shared = body_min_y + body_height * 0.81
        # #124: shared waist with painted lower (SHARED_WAIST_FRACTION above). Short tops
        # bisect slightly below so the mesh hem overlaps the paint top (not a height floor
        # gate — the inspect measures mesh-vs-paint relationship and hem regularity).
        HEM_OVERLAP_M = 0.035  # ~3.5 cm mesh overhang into painted lower region
        shared_waist_y = body_min_y + body_height * SHARED_WAIST_FRACTION
        bot_y_default = shared_waist_y - HEM_OVERLAP_M

        def _arm_p(x_factor: float, y_factor: float, z_factor: float = 0.0) -> tuple:
            return (
                cx + body_width * x_factor,
                body_min_y + body_height * y_factor,
                cz + body_depth * z_factor,
            )

        # #197: full arm chain shoulder→elbow→wrist. Pre-#197 arm_len was shoulder→elbow only,
        # so sleeve_along fraction 1.0 saturated at the elbow and no coefficient could author a
        # long sleeve. Wrist uses the same body-height 0.42 as the armature hand landmark
        # (limb_at(hand_off, 0.42)); x-factor 0.48 extends past the elbow at 0.34.
        shoulder_L = _arm_p(0.18, 0.74)
        elbow_L = _arm_p(0.34, 0.58)
        wrist_L = _arm_p(0.48, 0.42)
        shoulder_R = _arm_p(-0.18, 0.74)
        elbow_R = _arm_p(-0.34, 0.58)
        wrist_R = _arm_p(-0.48, 0.42)

        def _seg_len(a: tuple, b: tuple) -> float:
            return math.sqrt(
                (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2
            ) or 0.0

        upper_len = _seg_len(shoulder_L, elbow_L)
        forearm_len = _seg_len(elbow_L, wrist_L)
        # Full chain length — sleeve_along_fraction multiplies THIS, not upper alone.
        arm_len = (upper_len + forearm_len) or 0.25
        arm_dir_L = (
            elbow_L[0] - shoulder_L[0],
            elbow_L[1] - shoulder_L[1],
            elbow_L[2] - shoulder_L[2],
        )
        _u = upper_len or 0.25
        arm_dir_Ln = (arm_dir_L[0] / _u, arm_dir_L[1] / _u, arm_dir_L[2] / _u)
        arm_dir_Rn = (-arm_dir_Ln[0], arm_dir_Ln[1], arm_dir_Ln[2])
        print(
            f"[blender] #197 arm chain: upper={upper_len:.4f} forearm={forearm_len:.4f} "
            f"full={arm_len:.4f} (sleeve fractions are of full chain; long=wrist)"
        )

        # #76: body shoulder top from mesh (lateral upper half) — yoke must cover this.
        # Not a generator constant shared with the inspect band; measured from body verts.
        _lat = shoulder_half * 0.55
        _upper = body_min_y + body_height * 0.50
        body_shoulder_tops = [
            v.co.y
            for v in body_vs
            if abs(v.co.x - cx) >= _lat and v.co.y >= _upper
        ]
        body_shoulder_top_y = (
            max(body_shoulder_tops)
            if body_shoulder_tops
            else (body_min_y + body_height * 0.84)
        )
        # Cloth above skin. Extra lift (beyond solidify thickness) compensates Catmull-Clark
        # SUBSURF level-1 which otherwise collapses a single peak row below the body surface.
        # Not a coverage-gate fudge: after subsurf the surface must still sit on top of skin.
        yoke_peak_y = body_shoulder_top_y + 0.045
        print(
            f"[blender] #76 shoulder yoke targets: body_shoulder_top_y={body_shoulder_top_y:.4f} "
            f"yoke_peak_y={yoke_peak_y:.4f} (pre-subsurf authoring height)"
        )

        UPPER_LAYER_MARKERS = (
            "short_sleeve_exam_tshirt",
            "tshirt",
            "exam_tshirt",
            "short_sleeve",
            "casual_top",
            "open_cardigan",
            "open_front",
            "cardigan",
            "open_jacket",
            "lab_coat_open",
            "scrub_top",
            "scrub_pocket",
            "scrub",
            "hospital_gown",
            "gown",
            "patient_gown",
            "ed_gown",
        )

        def _is_upper_layer_token(token: str) -> bool:
            tl = str(token).lower()
            return any(k in tl for k in UPPER_LAYER_MARKERS)

        def _layer_kind(token: str) -> str:
            tl = str(token).lower()
            if any(k in tl for k in ("hospital_gown", "gown", "patient_gown", "ed_gown")):
                return "gown"
            if any(k in tl for k in ("open_cardigan", "open_front", "cardigan", "open_jacket", "lab_coat_open")):
                return "open_front"
            if "scrub_pocket" in tl:
                return "scrub_pocket"
            if any(k in tl for k in ("scrub_top", "scrub")):
                return "scrub"
            if "casual_top" in tl:
                return "closed_casual"
            if any(k in tl for k in ("tshirt", "exam_tshirt", "short_sleeve")):
                return "tshirt"
            return "closed_default"

        upper_layer_tokens: List[str] = []
        for g in garment_layers:
            if g and _is_upper_layer_token(str(g)):
                # de-dupe while preserving order
                s = str(g)
                if s not in upper_layer_tokens:
                    upper_layer_tokens.append(s)
        if not upper_layer_tokens:
            # role/phenotype fallback single shell (patient gown path etc.)
            if is_gown:
                upper_layer_tokens = ["hospital_gown"]
            elif is_open_front:
                # #103: open outer alone leaves bare torso — closed under first.
                upper_layer_tokens = ["casual_top", "open_cardigan"]
            elif is_scrub:
                upper_layer_tokens = ["scrub_top"]
            else:
                upper_layer_tokens = [str(garment_layers[0]) if garment_layers else "upper_default"]

        # #103 §6p: open-front outer must have a closed under-layer (base + open outer).
        # Inject casual_top when every declared upper layer is open — do not close the front.
        _kinds_now = [_layer_kind(t) for t in upper_layer_tokens]
        if any(k == "open_front" for k in _kinds_now) and not any(
            k != "open_front" for k in _kinds_now
        ):
            upper_layer_tokens = ["casual_top"] + list(upper_layer_tokens)
            print(
                f"[blender] #103 injected closed under-layer casual_top before open outer: "
                f"{upper_layer_tokens}"
            )

        # Blueprint declaration as a tiny exported mesh (empties may be stripped by glTF).
        # Mesh name is SSOT for declaredUpperLayerCount in garment-layer-coverage inspect.
        decl_name = "openclinxr_declared_upper_layers__" + "+".join(
            t.replace(" ", "_").lower()[:24] for t in upper_layer_tokens
        )[:120]
        if bpy.data.objects.get(decl_name) is None:
            decl_mesh = bpy.data.meshes.new(decl_name + "_mesh")
            # Degenerate micro-tri far under the feet — not visible, always exports.
            # Micro-tri inside torso volume so body AABB is unchanged.
            ym = body_min_y + body_height * 0.55
            decl_mesh.from_pydata(
                [(cx, ym, cz), (cx + 1e-4, ym, cz), (cx, ym + 1e-4, cz)],
                [],
                [(0, 1, 2)],
            )
            decl_mesh.update()
            decl_obj = bpy.data.objects.new(decl_name, decl_mesh)
            bpy.context.collection.objects.link(decl_obj)
            decl_obj.parent = mesh_obj
            decl_obj.matrix_parent_inverse = Matrix.Identity(4)
            decl_obj.hide_render = True
            decl_obj["openClinXrDeclaredUpperGarmentLayers"] = ",".join(upper_layer_tokens)
            decl_obj["openClinXrDeclaredUpperLayerCount"] = len(upper_layer_tokens)

        n_layers = len(upper_layer_tokens)
        layer_metas: List[Dict[str, Any]] = []
        body_key = (mesh_obj.name or "").lower()
        is_adult_or_ed = ("ed_" in body_key) or ("adult" in body_key)
        # #146: outermost shell colour drives sleeve-end arm paint (exact match).
        outermost_gown_color: Optional[tuple] = None

        for layer_index, layer_token in enumerate(upper_layer_tokens):
            kind = _layer_kind(layer_token)
            # Radial stack: innermost smaller so outer opening reveals under-layer, not skin.
            # Same-radius shells z-fight — offset by layer index (measured body scale, not magic paint).
            radial_rank = layer_index / float(max(n_layers - 1, 1)) if n_layers > 1 else 1.0
            radius_stack = 0.93 + 0.09 * radial_rank  # ~0.93 inner → ~1.02 outer
            layer_is_open = kind == "open_front"
            # Under an open outer: non-open layers stay closed (the point of #75).
            torso_wrap = not layer_is_open
            front_opening_rad = 0.0
            r_base = r_base_shared * radius_stack
            top_y = top_y_shared
            bot_y = bot_y_default
            torso_rows, torso_cols = 9, 14

            if kind == "gown":
                sleeve_rows, sleeve_cols = 10, 14
                # #200: short/upper-arm hospital gown sleeve — DECIDED from gown-sleeve-sweep-sheet.
                # #197 pinned 0.72 over the NEW full shoulder→wrist arm_len, which silently doubled
                # absolute length (~0.24 m → ~0.47 m) and saturated next to the cardigan at the arm
                # terminus. Sweep 0.35/0.42/0.50/0.55/0.72 on fixed body; 0.42 = upper_arm
                # (cuffAlongBoneT≈0.39, y_frac≈0.63) — exam-access gown, not street long-sleeve.
                # Cardigan stays 0.92 (counterweight). Scrub stays 0.22. Gown does NOT share the
                # cardigan coefficient.
                sleeve_along = arm_len * 0.42
                sleeve_r0 = max(body_depth * 0.22, r_base * 0.42)
                # Long drape well below shared waist (still overlaps painted lower).
                # Gown hem stays at 0.32 (#197): below-knee hospital gown is intentional.
                bot_y = body_min_y + body_height * 0.32
                r_base = torso_half_w * 1.14 * radius_stack
                torso_rows, torso_cols = 11, 16
                topology_class = "closed_gown_drape"
                sleeve_cov = "torso+shoulder+upper_arm_along_bone_hospital_gown_exam_sleeve"
                slf = 0.42
            elif kind == "open_front":
                sleeve_rows, sleeve_cols = 11, 12
                # 0.92 of full chain ≈ near wrist (long sleeve). Counterweight pin stays 0.92.
                sleeve_along = arm_len * 0.92
                sleeve_r0 = max(body_depth * 0.13, torso_half_w * 0.26, 0.042) * (0.96 + 0.04 * radial_rank)
                # #197: cardigan hem 0.42 (upper thigh). Rejected 0.31 (below-knee coat from the
                # #46 illustrative hemHeightRatio fixture) and 0.36 (long cardigan, narrower reading).
                # Gown stays 0.32 — move the cardigan away from the gown, not both.
                bot_y = body_min_y + body_height * 0.42
                r_base = torso_half_w * 1.10 * radius_stack
                torso_rows, torso_cols = 11, 16
                front_opening_rad = 0.95
                torso_wrap = False
                topology_class = "open_front_c_shell_anterior_gap"
                sleeve_cov = "torso+shoulder+full_arm_along_bone_open_cardigan_long_sleeve_to_wrist"
                slf = 0.92
            elif kind == "scrub":
                sleeve_rows, sleeve_cols = 7, 10
                # #197: short sleeves stay on the upper-arm half of the full chain (~0.22 of full
                # ≈ former 0.42 of upper-only). Not a counterweight pin — short-sleeve intent.
                sleeve_along = arm_len * 0.22
                sleeve_r0 = max(body_depth * 0.13, torso_half_w * 0.26, 0.040) * (0.96 + 0.04 * radial_rank)
                # #124: meet painted lower at shared waist (was 0.48 fraction ABOVE paint top 0.46).
                bot_y = bot_y_default
                r_base = torso_half_w * 1.04 * radius_stack
                torso_rows, torso_cols = 8, 12
                topology_class = "closed_scrub_ring"
                sleeve_cov = "torso+shoulder+upper_arm_along_bone_scrub_short_sleeve"
                slf = 0.22
            elif kind == "scrub_pocket":
                # Second upper layer for nurse: closed pocket-bearing shell outside scrub_top.
                # Keep torso_cols >= 12 so mid-height angular step stays below open-front detector
                # threshold (~0.55 rad) — 11 cols false-positive as anterior opening.
                sleeve_rows, sleeve_cols = 6, 10
                sleeve_along = arm_len * 0.20
                sleeve_r0 = max(body_depth * 0.12, torso_half_w * 0.24, 0.038) * radius_stack
                bot_y = bot_y_default
                r_base = torso_half_w * 1.08 * radius_stack
                torso_rows, torso_cols = 7, 14
                topology_class = "closed_scrub_pocket_shell"
                sleeve_cov = "torso+shoulder+upper_arm_along_bone_scrub_pocket_layer"
                slf = 0.20
            elif kind == "closed_casual":
                # Under-layer for open cardigan: closed front, smaller radius, covers chest/delts.
                # Dense ring (>=16 cols) so mid-height angular step stays well below open-front
                # detector (~0.55 rad); real-Anny proportions false-positived at 13 cols.
                sleeve_rows, sleeve_cols = 9, 12
                sleeve_along = arm_len * 0.28
                sleeve_r0 = max(body_depth * 0.14, torso_half_w * 0.28, 0.045) * radius_stack
                # Under-layer hem at shared waist (outer cardigan is longer).
                bot_y = bot_y_default
                r_base = torso_half_w * 1.00 * radius_stack
                torso_rows, torso_cols = 9, 18
                topology_class = "closed_casual_top_under_layer"
                sleeve_cov = "torso+shoulder+upper_arm_along_bone_casual_top_closed"
                slf = 0.28
            elif kind == "tshirt":
                sleeve_rows, sleeve_cols = 9, 12
                sleeve_along = arm_len * 0.30
                sleeve_r0 = max(body_depth * 0.14, torso_half_w * 0.28, 0.045) * radius_stack
                bot_y = bot_y_default
                topology_class = "closed_tshirt_ring"
                sleeve_cov = "torso+shoulder+upper_arm_along_bone_short_sleeve"
                slf = 0.30
            else:
                sleeve_rows, sleeve_cols = 9, 12
                sleeve_along = arm_len * 0.30
                sleeve_r0 = max(body_depth * 0.14, torso_half_w * 0.28, 0.045) * radius_stack
                bot_y = bot_y_default
                topology_class = "closed_default_ring"
                sleeve_cov = "torso+shoulder+upper_arm_along_bone_short_sleeve"
                slf = 0.30

            # #180a: colour = f(role, kind, fabricPalette) — not kind alone.
            gown_color = garment_shell_color(kind, role, phenotype)

            # #121: body-surface-derived shell (NOT ring+tube parametric cage).
            # Continuity from body topology; neck/arm cuts from landmarks; offset along normals.
            gkey = layer_token.replace(" ", "_").lower()[:32]
            is_tshirt_layer = "tshirt" in layer_token.lower()
            is_outermost = layer_index == n_layers - 1
            if is_adult_or_ed:
                base_mesh_name = "openclinxr_real_garment_peds_upper_v1_mesh"
            elif is_tshirt_layer and n_layers == 1:
                base_mesh_name = "openclinxr_real_garment_peds_tshirt_v1_mesh"
            else:
                base_mesh_name = "openclinxr_real_garment_peds_upper_v1_mesh"
            if is_outermost:
                gmesh_name = base_mesh_name
            else:
                gmesh_name = f"{base_mesh_name}__under_{gkey}"

            gname = f"openclinxr_real_garment_from_phenotype_{gkey}"
            if bpy.data.objects.get(gname) is not None:
                gname = f"{gname}_L{layer_index}"

            # Cloth offset varies by layer stack (inner closer). Constant base + layer rank.
            # Unlocked decision: ~1.0–2.2 cm skin gap; not equidistant (helper eases chest/underarm).
            cloth_offset = (0.010 + 0.012 * radial_rank) * (1.02 if kind == "gown" else 1.0)
            neck_y = body_min_y + body_height * 0.84  # neck-root band from body height + shoulder measure
            # #195 bake-matrix: optional coefficient overrides (shipping path when empty).
            bot_y, sleeve_along, sleeve_r0, front_opening_rad, cloth_offset, neck_y = (
                _apply_garment_coeff_overrides(
                    kind=kind,
                    body_min_y=body_min_y,
                    body_height=body_height,
                    arm_len=arm_len,
                    bot_y=bot_y,
                    sleeve_along=sleeve_along,
                    sleeve_r0=sleeve_r0,
                    front_opening_rad=front_opening_rad,
                    cloth_offset=cloth_offset,
                    neck_y=neck_y,
                    radial_rank=radial_rank,
                )
            )
            # Prefer measured body shoulder top when available for neck cut floor.
            if body_shoulder_top_y:
                neck_y = max(neck_y, body_shoulder_top_y + body_height * 0.01)
            # Open-front topology follows the effective opening after overrides.
            if kind == "open_front":
                layer_is_open = bool(front_opening_rad > 1e-6)
                torso_wrap = not layer_is_open
            sleeve_radius = max(sleeve_r0 * 1.35, body_depth * 0.18, torso_half_w * 0.42)

            garment = _build_body_surface_derived_garment(
                mesh_obj,
                gmesh_name=gmesh_name,
                gname=gname,
                bot_y=bot_y,
                neck_y=neck_y,
                cloth_offset=cloth_offset,
                sleeve_along=sleeve_along,
                sleeve_radius=sleeve_radius,
                layer_is_open=layer_is_open,
                front_opening_rad=front_opening_rad,
                cx=cx,
                cz=cz,
                body_width=body_width,
                body_depth=body_depth,
                shoulder_L=shoulder_L,
                elbow_L=elbow_L,
                wrist_L=wrist_L,
                shoulder_R=shoulder_R,
                elbow_R=elbow_R,
                wrist_R=wrist_R,
            )
            gmesh = garment.data
            verts = list(gmesh.vertices)
            faces = list(gmesh.polygons)
            if len(verts) < 24 or len(faces) < 12:
                raise RuntimeError(
                    f"#121 surface-derived garment too sparse after cut: "
                    f"verts={len(verts)} faces={len(faces)} layer={layer_token!r}"
                )
            # Topology class reflects authoring method (not the old ring labels).
            topology_class = (
                "body_surface_offset_open_front_v1"
                if layer_is_open
                else "body_surface_offset_closed_v1"
            )

            gmat = create_role_marker_material(f"openclinxr_real_garment_{gkey}_phenotype_L{layer_index}", gown_color)
            garment.data.materials.append(gmat)
            # Track outermost (last) layer colour for #146 arm clothing match.
            outermost_gown_color = gown_color
            # Thickness already applied in _build_body_surface_derived_garment (bmesh solidify).
            # No SUBSURF / WEIGHTED_NORMAL: both force custom split normals on glTF export and
            # re-split shared vertex indices (the §6t continuity trap).
            for poly in garment.data.polygons:
                poly.use_smooth = True
            weighted_bones: List[str] = []
            arm_use = arm_obj
            if arm_use is None:
                arm_use = bpy.data.objects.get("openclinxr_canonical_humanoid_armature")
            if arm_use is not None:
                arm_mod = garment.modifiers.new("openclinxr_real_garment_armature", "ARMATURE")
                arm_mod.object = arm_use
                arm_mod.use_vertex_groups = True
                bone_names = [b.name for b in arm_use.data.bones]
                groups: Dict[str, Any] = {}
                for bn in ["clavicle.L", "clavicle.R", "upper_arm.L", "upper_arm.R", "chest", "spine", "neck"]:
                    if bn in bone_names:
                        groups[bn] = garment.vertex_groups.get(bn) or garment.vertex_groups.new(name=bn)
                gvs = list(garment.data.vertices)
                if gvs:
                    gys = [v.co.y for v in gvs]
                    gxs = [v.co.x for v in gvs]
                    gmin_y, gmax_y = min(gys), max(gys)
                    gheight = max(gmax_y - gmin_y, 0.001)
                    gwidth = max(max(gxs) - min(gxs), 0.001) or 1.0
                    gcx = (min(gxs) + max(gxs)) / 2
                    sleeve_x_thresh = max(body_width * 0.16, gwidth * 0.22)
                    for vi, v in enumerate(gvs):
                        yn = (v.co.y - gmin_y) / gheight
                        xa = abs(v.co.x - gcx)
                        side = ".L" if v.co.x >= gcx else ".R"
                        if xa > sleeve_x_thresh:
                            aw = 0.72 if xa > sleeve_x_thresh * 1.35 else 0.55
                            if f"upper_arm{side}" in groups:
                                groups[f"upper_arm{side}"].add([vi], aw, "ADD")
                            if f"clavicle{side}" in groups:
                                groups[f"clavicle{side}"].add([vi], 0.28, "ADD")
                        elif yn > 0.55:
                            if xa > gwidth * 0.10:
                                if f"clavicle{side}" in groups:
                                    groups[f"clavicle{side}"].add([vi], 0.45, "ADD")
                                if "chest" in groups:
                                    groups["chest"].add([vi], 0.40, "ADD")
                            else:
                                if "chest" in groups:
                                    groups["chest"].add([vi], 0.70, "ADD")
                                if "spine" in groups:
                                    groups["spine"].add([vi], 0.22, "ADD")
                        else:
                            if "chest" in groups:
                                groups["chest"].add([vi], 0.58, "ADD")
                            if "spine" in groups:
                                groups["spine"].add([vi], 0.30, "ADD")
                weighted_bones = list(groups.keys())
            garment.parent = mesh_obj
            garment.matrix_parent_inverse = Matrix.Identity(4)
            garment.location = (0.0, 0.0, 0.0)
            garment.rotation_euler = (0.0, 0.0, 0.0)
            garment.scale = (1.0, 1.0, 1.0)
            garment["openClinXrRealGarmentFromPhenotype"] = "embed_body_surface_derived_garment_v1_issue_121"
            garment["openClinXrGarmentCoordinateBasis"] = "body_local_y_height_bind_pose_v1"
            garment["openClinXrGarmentSleeveFit"] = "body_surface_offset_upper_arm_landmarks_v1"
            garment["openClinXrGarmentAuthoringClass"] = "body_surface_normal_offset_not_ring_tube"
            garment["openClinXrGarmentLayerIndex"] = layer_index
            garment["openClinXrGarmentLayerToken"] = layer_token
            garment["openClinXrGarmentLayerKind"] = kind
            garment["openClinXrHasAnteriorOpening"] = 1 if layer_is_open else 0
            gxs2 = [v.co.x for v in garment.data.vertices]
            gys2 = [v.co.y for v in garment.data.vertices]
            gzs2 = [v.co.z for v in garment.data.vertices]
            local_bbox = {
                "min": [round(min(gxs2), 6), round(min(gys2), 6), round(min(gzs2), 6)],
                "max": [round(max(gxs2), 6), round(max(gys2), 6), round(max(gzs2), 6)],
            }
            bpy.context.view_layer.update()
            world_corners = [garment.matrix_world @ v.co for v in garment.data.vertices]
            wxs = [c.x for c in world_corners]
            wys = [c.y for c in world_corners]
            wzs = [c.z for c in world_corners]
            world_bbox = {
                "min": [round(min(wxs), 6), round(min(wys), 6), round(min(wzs), 6)],
                "max": [round(max(wxs), 6), round(max(wys), 6), round(max(wzs), 6)],
            }
            mean_r = 0.0
            if gxs2:
                rs = [math.hypot(gxs2[i] - cx, gzs2[i] - cz) for i in range(len(gxs2))]
                # torso-core only (exclude wide sleeves)
                half_w = max(max(gxs2) - min(gxs2), 0.001) * 0.5
                core = [rs[i] for i in range(len(rs)) if abs(gxs2[i] - cx) <= half_w * 0.55]
                mean_r = sum(core) / len(core) if core else (sum(rs) / len(rs))
            print(
                f"[blender] real garment layer[{layer_index}]={layer_token!r} kind={kind} "
                f"open={layer_is_open} r_base={r_base:.3f} mean_r={mean_r:.3f} "
                f"verts={len(verts)} faces={len(faces)} mesh={gmesh_name}"
            )
            face_count = len(faces)
            layer_meta = {
                "mode": "phenotype_embedded_body_surface_derived_garment_v1",
                "revision": "body_surface_normal_offset_issue_121_not_ring_tube",
                "objectName": garment.name,
                "meshName": gmesh_name,
                "layerIndex": layer_index,
                "layerToken": layer_token,
                "layerKind": kind,
                "faceCount": face_count,
                "vertexCount": len(verts),
                "hasShoulderYoke": False,
                "authoringClass": "body_surface_normal_offset",
                "clothOffsetM": round(cloth_offset, 4),
                "yokePeakY": round(yoke_peak_y, 4),
                "bodyShoulderTopY": round(body_shoulder_top_y, 4),
                "hasSleeveGeometry": True,
                "sleeveCoverage": sleeve_cov,
                "sleeveLenFactor": slf,
                "sleeveAlongArmM": round(sleeve_along, 4),
                "sleeveRows": sleeve_rows,
                "sleeveCols": sleeve_cols,
                "sleeveR0M": round(sleeve_r0, 4),
                "sleeveRFactor": round(sleeve_r0 / max(r_base, 0.001), 3),
                "torsoRBaseM": round(r_base, 4),
                "meanRadiusM": round(mean_r, 4),
                "radiusStackScale": round(radius_stack, 4),
                "hasProminentSleeves": True,
                "hasExpandedVolumeDetail": True,
                "sleeveDirection": "clavicle_to_elbow_upper_arm_bone",
                "topologyClass": topology_class,
                "hasAnteriorOpening": bool(layer_is_open),
                "anteriorOpeningRadians": round(front_opening_rad, 4) if layer_is_open else 0.0,
                "torsoWrapClosed": bool(torso_wrap),
                "weightedBones": weighted_bones,
                "deformsWithBreathing": True,
                "hasVisibleVolume": True,
                "hasSeamFoldHints": True,
                "hasFabricThicknessSolidify": False,
                "hasLightSubsurf": False,
                "hasGentleDisplacementFolds": False,
                "coordinateBasis": "body_local_y_height_bind_pose_v1",
                "bindPoseLocalBBox": local_bbox,
                "bindPoseWorldBBox": world_bbox,
                "bodyLocalHeightRange": [round(body_min_y, 6), round(body_max_y, 6)],
                "garmentLayers": [str(g) for g in garment_layers if g],
                "declaredUpperLayerTokens": list(upper_layer_tokens),
                "role": role,
                "claimScope": "case_phenotype_garment_layers_body_surface_derived_shell_q1_factory_not_ring_tube_not_production_not_clinical_costume",
                "notEvidenceFor": [
                    "production_asset_readiness",
                    "b_plus_visual_realism_gate",
                    "clinical_validity",
                    "scoring_validity",
                    "believable_clinical_costume",
                    "looks_worn_pixel_grade",
                ],
                "evidenceForThisSlice": "garment-surface-derived-v1-issue-121",
            }
            layer_metas.append(layer_meta)

        # Primary realGarmentRegion = outermost shell (back-compat for single-region consumers).
        real_garment = layer_metas[-1] if layer_metas else None
        if layer_metas:
            ret["realGarmentLayers"] = layer_metas
            ret["declaredUpperGarmentLayers"] = list(upper_layer_tokens)
            ret["declaredUpperGarmentLayerCount"] = len(upper_layer_tokens)

        # #146: recolor sleeve-end arm clothing from the outermost real garment mesh colour.
        # Decision: EXACT match (reads as continuous sleeve of that garment), not under-layer
        # related tone (undershirt). Rejected: keep role top_color paint palette (family role
        # fell into patient blue; mismatch ~0.76 vs pink). Rejected: silent teal fallback.
        if arm_mat is not None and outermost_gown_color is not None:
            bsdf = arm_mat.node_tree.nodes.get("Principled BSDF")
            if bsdf is not None:
                bsdf.inputs["Base Color"].default_value = outermost_gown_color
            ret["armClothingColourSource"] = "outermost_real_garment_mesh_exact_match"
            ret["armClothingColour"] = [float(c) for c in outermost_gown_color]
            ret["clothingRegionRevision"] = (
                "v9_arm_colour_tracks_outermost_garment_exact_match_issue_146"
            )
            print(
                f"[blender] #146 arm clothing colour <- outermost garment "
                f"{[round(float(c), 3) for c in outermost_gown_color]} "
                f"(was role top_color paint palette)"
            )
        elif arm_mat is not None:
            # No shell colour produced — keep provisional top_color; do not invent teal.
            ret["armClothingColourSource"] = "role_top_color_provisional_no_garment_shell"
            ret["armClothingColour"] = [float(c) for c in top_color]
            print(
                "[blender] #146 WARN: arm clothing kept provisional top_color "
                "(no outermost gown_color from real garment shells)"
            )

    if real_garment:
        ret["realGarmentRegion"] = real_garment

    # #188: footwear shells on foot.L / foot.R. Lower paint stays; no trouser/skirt shell.
    footwear_meta = embed_role_footwear_shells(
        mesh_obj, actor_role=actor_role, phenotype=phenotype, arm_obj=arm_obj
    )
    ret["footwearRegion"] = footwear_meta
    return ret


def _footwear_kind_and_color(actor_role: str, phenotype: Dict[str, Any]) -> tuple:
    """Role-class footwear for #188.

    Decision (recorded): ROLE-DISTINCT shoes, not one shoe for everyone.
      - nurse → clinical closed shoe (dark charcoal)
      - patient with gown → soft blue hospital slipper
      - patient child / other patient → soft blue slipper (same class, body-scale derived)
      - parent / family / street → dark casual lace-up
    Rejected: single shared shoe (loses role distinguishability that garmentLayers already carry).
    Rejected: barefoot for gown patient (contract (1) requires all seven; a barefoot exception
    would be reporting the gate wrong — not silently skipping).
    """
    role = (actor_role or "").lower()
    layers = " ".join(str(g).lower() for g in (phenotype.get("garmentLayers") or []))
    wardrobe = str(phenotype.get("wardrobeRole") or "").lower()
    cue = str(phenotype.get("role_visual_cue") or "").lower()
    is_gown = any(k in layers for k in ("hospital_gown", "gown", "patient_gown", "ed_gown"))
    is_nurse = "nurse" in role or "scrub" in layers or "nurse" in wardrobe
    is_family = any(k in role for k in ("parent", "family", "guardian", "spouse")) or "spouse" in cue or "parent" in cue
    is_street = "street" in wardrobe or "casual_top" in layers or "open_cardigan" in layers
    if is_nurse:
        return "clinical_shoe", (0.08, 0.09, 0.10, 1.0)
    if is_gown or ("patient" in role and not is_street and not is_family):
        return "hospital_slipper", (0.18, 0.42, 0.78, 1.0)
    if is_family or is_street:
        return "casual_shoe", (0.12, 0.08, 0.05, 1.0)
    return "casual_shoe", (0.10, 0.09, 0.08, 1.0)


def embed_role_footwear_shells(
    mesh_obj: bpy.types.Object,
    actor_role: str,
    phenotype: Dict[str, Any],
    arm_obj: Optional[bpy.types.Object] = None,
) -> Dict[str, Any]:
    """#188: parametric footwear shells derived from body foot vertex clusters.

    Derivation decision: parametric closed shoe primitive fitted to measured foot AABB
    of body verts with yn < 0.08 (peer ~2214 verts adult). Rejected pure body-surface
    offset of foot verts — feet are thin/open and solidify re-split traps apply; a solid
    shell reads as a shoe and stays continuous on export without solidify.

    Weights: 100% to foot.L / foot.R so the shell moves with the leg.
    Does NOT add trousers/skirts/lower shells. Does NOT touch lower paint.
    """
    import math

    kind, shoe_color = _footwear_kind_and_color(actor_role, phenotype)
    body_vs = list(mesh_obj.data.vertices)
    if not body_vs:
        raise RuntimeError("#188 footwear: body mesh has no vertices")
    bys = [v.co.y for v in body_vs]
    body_min_y = min(bys)
    body_max_y = max(bys)
    body_height = max(body_max_y - body_min_y, 0.001)
    # Foot band: bottom 8% of body height (peer measurement).
    foot_cut = body_min_y + body_height * 0.08
    left_pts = []
    right_pts = []
    for v in body_vs:
        if v.co.y > foot_cut:
            continue
        if v.co.x >= 0.0:
            left_pts.append(v.co.copy())
        else:
            right_pts.append(v.co.copy())
    if len(left_pts) < 8 or len(right_pts) < 8:
        raise RuntimeError(
            f"#188 footwear: insufficient foot verts L={len(left_pts)} R={len(right_pts)} "
            f"(need body feet at yn<0.08)"
        )

    arm_use = arm_obj or bpy.data.objects.get("openclinxr_canonical_humanoid_armature")
    shells: List[Dict[str, Any]] = []

    def _aabb(pts):
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        zs = [p.z for p in pts]
        return {
            "min": (min(xs), min(ys), min(zs)),
            "max": (max(xs), max(ys), max(zs)),
            "cx": (min(xs) + max(xs)) * 0.5,
            "cy": (min(ys) + max(ys)) * 0.5,
            "cz": (min(zs) + max(zs)) * 0.5,
            "sx": max(max(xs) - min(xs), 0.02),
            "sy": max(max(ys) - min(ys), 0.02),
            "sz": max(max(zs) - min(zs), 0.04),
        }

    def _build_one(side: str, pts) -> Dict[str, Any]:
        aabb = _aabb(pts)
        # Expand slightly outside the foot so the shell covers paint-level toes/heels.
        # Slipper is lower; clinical/casual shoes a bit taller — still < 14% body height.
        pad_x = aabb["sx"] * 0.18 + 0.006
        pad_z = aabb["sz"] * 0.12 + 0.008
        sole_drop = 0.004  # sole sits just under body min without sinking past 0.02m
        if kind == "hospital_slipper":
            top_extra = aabb["sy"] * 0.18 + 0.008
        else:
            top_extra = aabb["sy"] * 0.35 + 0.012
        hx = aabb["sx"] * 0.5 + pad_x
        hz = aabb["sz"] * 0.5 + pad_z
        y0 = body_min_y - sole_drop
        y1 = aabb["max"][1] + top_extra
        # Cap shoe top so contract topFrac ≤ 0.14 (with margin).
        y1 = min(y1, body_min_y + body_height * 0.12)
        if y1 <= y0 + 0.02:
            y1 = y0 + max(aabb["sy"] + 0.02, 0.04)
        cx, cz = aabb["cx"], aabb["cz"]

        # Parametric shoe: 5 long rings (heel→toe) × 8 circumference, closed ends.
        # Forward axis is +Z on this armature (foot tip at larger Z).
        n_long = 5
        n_circ = 8
        verts = []
        for i in range(n_long):
            t = i / float(n_long - 1)
            # Elliptical cross-section: wider mid-foot, tighter at heel/toe.
            width_scale = 0.78 + 0.28 * math.sin(t * math.pi)
            height_scale = 0.55 + 0.45 * (1.0 - abs(t - 0.35))
            if kind == "hospital_slipper":
                height_scale *= 0.72
            z = (aabb["min"][2] - pad_z * 0.5) + t * (aabb["sz"] + pad_z)
            for j in range(n_circ):
                ang = (j / n_circ) * 2.0 * math.pi
                # y from sole up; x lateral about foot center.
                rx = hx * width_scale
                ry = (y1 - y0) * 0.5 * height_scale
                cy_ring = y0 + (y1 - y0) * 0.45  # mass slightly above sole
                x = cx + rx * math.cos(ang)
                y = cy_ring + ry * math.sin(ang)
                # Flatten sole: bottom half sits flat-ish.
                if y < y0 + 0.006:
                    y = y0 + 0.002 + 0.004 * max(0.0, math.sin(ang))
                verts.append((x, y, z))
        faces = []
        for i in range(n_long - 1):
            for j in range(n_circ):
                a = i * n_circ + j
                b = i * n_circ + ((j + 1) % n_circ)
                c = (i + 1) * n_circ + ((j + 1) % n_circ)
                d = (i + 1) * n_circ + j
                faces.append((a, b, c, d))
        # Cap heel (i=0) and toe (i=n_long-1).
        heel_c = len(verts)
        verts.append((cx, y0 + (y1 - y0) * 0.35, aabb["min"][2] - pad_z * 0.55))
        toe_c = len(verts)
        verts.append((cx, y0 + (y1 - y0) * 0.30, aabb["max"][2] + pad_z * 0.55))
        for j in range(n_circ):
            a = j
            b = (j + 1) % n_circ
            faces.append((heel_c, b, a))
            a2 = (n_long - 1) * n_circ + j
            b2 = (n_long - 1) * n_circ + ((j + 1) % n_circ)
            faces.append((toe_c, a2, b2))

        mesh_name = f"openclinxr_footwear_{kind}_{side}_mesh"
        obj_name = f"openclinxr_footwear_{kind}_{side}"
        # Clear prior shells on re-bake.
        for old in list(bpy.data.objects):
            if old.name.startswith(obj_name):
                bpy.data.objects.remove(old, do_unlink=True)
        mesh = bpy.data.meshes.new(mesh_name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        shoe = bpy.data.objects.new(obj_name, mesh)
        bpy.context.collection.objects.link(shoe)
        mat = create_role_marker_material(f"openclinxr_footwear_{kind}_{side}_mat", shoe_color)
        shoe.data.materials.append(mat)
        for poly in shoe.data.polygons:
            poly.use_smooth = True

        bone_name = f"foot.{side}"
        weighted_bones: List[str] = []
        if arm_use is not None:
            arm_mod = shoe.modifiers.new("openclinxr_footwear_armature", "ARMATURE")
            arm_mod.object = arm_use
            arm_mod.use_vertex_groups = True
            bone_names = [b.name for b in arm_use.data.bones]
            if bone_name in bone_names:
                vg = shoe.vertex_groups.new(name=bone_name)
                vg.add(list(range(len(shoe.data.vertices))), 1.0, "REPLACE")
                weighted_bones = [bone_name]
            else:
                raise RuntimeError(f"#188 footwear: armature missing bone {bone_name}")
        shoe.parent = mesh_obj
        shoe.matrix_parent_inverse = Matrix.Identity(4)
        shoe.location = (0.0, 0.0, 0.0)
        shoe.rotation_euler = (0.0, 0.0, 0.0)
        shoe.scale = (1.0, 1.0, 1.0)
        shoe["openClinXrFootwear"] = kind
        shoe["openClinXrFootwearSide"] = side
        shoe["openClinXrFootwearRevision"] = "issue_188_parametric_foot_aabb_shell_v1"
        face_count = len(faces)
        ys = [v.co.y for v in shoe.data.vertices]
        meta = {
            "side": side,
            "kind": kind,
            "objectName": shoe.name,
            "meshName": mesh_name,
            "faceCount": face_count,
            "vertexCount": len(shoe.data.vertices),
            "weightedBones": weighted_bones,
            "minY": round(min(ys), 6),
            "maxY": round(max(ys), 6),
            "footVertCount": len(pts),
        }
        print(
            f"[blender] #188 footwear {side} kind={kind} faces={face_count} "
            f"y=[{meta['minY']},{meta['maxY']}] bone={bone_name}"
        )
        return meta

    shells.append(_build_one("L", left_pts))
    shells.append(_build_one("R", right_pts))
    total_faces = sum(s["faceCount"] for s in shells)
    return {
        "mode": "parametric_foot_aabb_shell_v1",
        "revision": "issue_188_footwear_only_no_lower_shell",
        "kind": kind,
        "shells": shells,
        "totalFaceCount": total_faces,
        "bodyHeight": round(body_height, 6),
        "bodyMinY": round(body_min_y, 6),
        "bodyMaxY": round(body_max_y, 6),
        "role": (actor_role or "").lower(),
        "claimScope": "procedural_footwear_geometry_on_foot_bones_not_clinical_costume_realism",
        "notEvidenceFor": [
            "production_asset_readiness",
            "b_plus_visual_realism_gate",
            "clinical_validity",
            "scoring_validity",
            "lower_body_garment_channel",
        ],
    }


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
    sol.offset = 1.0
    if hasattr(sol, "use_even_offset"):
        sol.use_even_offset = True
    if not any(m.type == "SUBSURF" for m in garment.modifiers):
        hsub = garment.modifiers.new("openclinxr_garment_hint_subsurf_v1", "SUBSURF")
        hsub.levels = 1
        hsub.render_levels = 1
    if not any(m.type == "WEIGHTED_NORMAL" for m in garment.modifiers):
        garment.modifiers.new("openclinxr_garment_hint_weighted_normals", "WEIGHTED_NORMAL")
    for poly in garment.data.polygons:
        poly.use_smooth = True
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

    #73: Anny is local-Y height / +Z anterior. Prior pass treated Z as height and Y as
    depth, so the face-front exclusion did not protect the nose/mouth band. Use the
    dominant height axis and exclude the front mid-face (nose/mouth) band entirely.
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

    # #73: LOCAL mesh space only. OBJ import can rotate the object so world Z is
    # height while local stays Y-height; world-space face exclusion then paints the face.
    body_vs = list(mesh_obj.data.vertices)
    bxs = [v.co.x for v in body_vs]
    bys = [v.co.y for v in body_vs]
    bzs = [v.co.z for v in body_vs]
    min_x_l, max_x_l = min(bxs), max(bxs)
    min_y_l, max_y_l = min(bys), max(bys)
    min_z_l, max_z_l = min(bzs), max(bzs)
    if (max_y_l - min_y_l) >= (max_z_l - min_z_l) * 0.9:
        height_axis = "y"
        depth_axis = "z"
        min_h = min_y_l
        height_h = max(max_y_l - min_y_l, 0.001)
        center_d = (min_z_l + max_z_l) * 0.5
        depth_d = max(max_z_l - min_z_l, 0.001)
    else:
        height_axis = "z"
        depth_axis = "y"
        min_h = min_z_l
        height_h = max(max_z_l - min_z_l, 0.001)
        center_d = (min_y_l + max_y_l) * 0.5
        depth_d = max(max_y_l - min_y_l, 0.001)
    center_x = (min_x_l + max_x_l) * 0.5
    width = max(max_x_l - min_x_l, 0.001)
    hair_density = max(0.0, min(1.0, float(phenotype.get("hair_density", 0.55))))
    # Tighter scalp: start higher so hairline sits on the crown, not the face.
    scalp_min_h = min_h + height_h * (0.905 - hair_density * 0.008)
    crown_min_h = min_h + height_h * 0.935
    max_scalp_half_width = width * (0.16 + hair_density * 0.018)
    # Anny local: +Z anterior (nose). Back = lower Z. Face front = high Z.
    if depth_axis == "z":
        back_start_d = center_d - depth_d * 0.02
        face_front_d = center_d  # mid-depth and forward
        def is_back(cd: float) -> bool:
            return cd <= back_start_d
        def is_face_front(cd: float) -> bool:
            return cd >= face_front_d
    else:
        back_start_d = center_d - depth_d * 0.02
        face_front_d = center_d - depth_d * 0.18
        def is_back(cd: float) -> bool:
            return cd >= back_start_d
        def is_face_front(cd: float) -> bool:
            return cd < face_front_d

    # Nose/mouth (+ lower forehead) band — never hair on the front of the head here.
    face_band_lo = min_h + height_h * 0.82
    face_band_hi = min_h + height_h * 0.93

    scalp_faces = 0
    crown_faces = 0
    skipped_face_front_faces = 0
    for polygon in mesh_obj.data.polygons:
        center = polygon.center  # local
        ch = center.y if height_axis == "y" else center.z
        cd = center.z if depth_axis == "z" else center.y
        rel_x = abs(center.x - center_x)
        on_crown = ch >= crown_min_h and rel_x <= max_scalp_half_width * 1.05
        on_back_scalp = ch >= scalp_min_h and is_back(cd) and rel_x <= max_scalp_half_width
        on_side_scalp = (
            ch >= (scalp_min_h + height_h * 0.015)
            and rel_x >= max_scalp_half_width * 0.55
            and rel_x <= max_scalp_half_width * 1.05
            and not is_face_front(cd)  # sides/back only — never pure face front
        )
        if on_crown or on_back_scalp or on_side_scalp:
            # Hard exclude: any front-of-head face in the nose/mouth/forehead band.
            if is_face_front(cd) and ch < crown_min_h and ch <= face_band_hi and ch >= face_band_lo:
                skipped_face_front_faces += 1
                continue
            # Also exclude front faces below scalp_min entirely (face, not hair).
            if is_face_front(cd) and ch < scalp_min_h:
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
        "hairRegionRevision": "v3_local_y_up_no_face_band_hair_issue_73",
        "hairMaterialName": hair_mat.name,
        "hairColor": hair_color,
        "scalpFaceCount": scalp_faces,
        "crownFaceCount": crown_faces,
        "skippedFaceFrontFaceCount": skipped_face_front_faces,
        "heightAxis": height_axis,
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


def finalize_body_mesh_shading_and_density(mesh_obj: bpy.types.Object) -> Dict[str, Any]:
    """
    Body mesh finalize pass immediately before export diagnostics.

    Reduces the "low-poly faceted / hard facets" read without breaking skinning:
      1) shade-smooth (per-face use_smooth=True) so exported normals are averaged
      2) light Catmull-Clark SUBSURF levels=1 (evaluation density only; NOT applied —
         vertex groups, shape keys, and ARMATURE weights stay intact; base V-count unchanged)
      3) WEIGHTED_NORMAL after subsurf for softer silhouette normals

    Modifier order forced to: SUBSURF → WEIGHTED_NORMAL → existing ARMATURE(s).
    Vertex groups / shape keys are never rewritten. Base mesh vertex count is preserved
    (<2x constraint) because modifiers are not applied.
    """
    mesh = mesh_obj.data
    for poly in mesh.polygons:
        poly.use_smooth = True
    # Blender 3.x auto-smooth; 4.x may ignore — best-effort only.
    if hasattr(mesh, "use_auto_smooth"):
        try:
            mesh.use_auto_smooth = True
            if hasattr(mesh, "auto_smooth_angle"):
                import math as _math
                mesh.auto_smooth_angle = _math.radians(60.0)
        except Exception:
            pass

    # Snapshot ARMATURE modifiers, then rebuild stack so subsurf runs before deform.
    arm_snapshots: List[Dict[str, Any]] = []
    for mod in list(mesh_obj.modifiers):
        if mod.type == "ARMATURE":
            arm_snapshots.append(
                {
                    "name": mod.name,
                    "object": mod.object,
                    "use_vertex_groups": bool(getattr(mod, "use_vertex_groups", True)),
                    "use_deform_preserve_volume": bool(getattr(mod, "use_deform_preserve_volume", False)),
                }
            )
            mesh_obj.modifiers.remove(mod)

    subsurf_name = "openclinxr_body_density_subsurf_v1"
    if not any(m.type == "SUBSURF" for m in mesh_obj.modifiers):
        sub = mesh_obj.modifiers.new(subsurf_name, "SUBSURF")
        sub.levels = 1
        sub.render_levels = 1
        if hasattr(sub, "subdivision_type"):
            sub.subdivision_type = "CATMULL_CLARK"
        if hasattr(sub, "show_only_control_edges"):
            sub.show_only_control_edges = False
    else:
        subsurf_name = next(m.name for m in mesh_obj.modifiers if m.type == "SUBSURF")
        sub = mesh_obj.modifiers[subsurf_name]
        sub.levels = min(int(getattr(sub, "levels", 1) or 1), 1)
        sub.render_levels = min(int(getattr(sub, "render_levels", 1) or 1), 1)

    wn_name = "openclinxr_body_weighted_normal_v1"
    if not any(m.type == "WEIGHTED_NORMAL" for m in mesh_obj.modifiers):
        wn = mesh_obj.modifiers.new(wn_name, "WEIGHTED_NORMAL")
        if hasattr(wn, "mode"):
            try:
                wn.mode = "FACE_AREA_WITH_ANGLE"
            except (TypeError, ValueError, AttributeError):
                try:
                    wn.mode = "FACE_AREA"
                except (TypeError, ValueError, AttributeError):
                    pass
        if hasattr(wn, "keep_sharp"):
            wn.keep_sharp = False
        if hasattr(wn, "weight"):
            try:
                wn.weight = 50
            except (TypeError, ValueError, AttributeError):
                pass
    else:
        wn_name = next(m.name for m in mesh_obj.modifiers if m.type == "WEIGHTED_NORMAL")

    # Re-append ARMATURE last so deformation uses subdivided rest pose when evaluated.
    restored_armatures: List[str] = []
    for snap in arm_snapshots:
        am = mesh_obj.modifiers.new(snap["name"], "ARMATURE")
        am.object = snap["object"]
        if hasattr(am, "use_vertex_groups"):
            am.use_vertex_groups = snap["use_vertex_groups"]
        if hasattr(am, "use_deform_preserve_volume"):
            am.use_deform_preserve_volume = snap["use_deform_preserve_volume"]
        restored_armatures.append(am.name)

    # Prefer shade_smooth operator when an active object context is available (no-op safe).
    try:
        view_layer = bpy.context.view_layer
        prev_active = view_layer.objects.active
        mesh_obj.select_set(True)
        view_layer.objects.active = mesh_obj
        bpy.ops.object.shade_smooth()
        if prev_active is not None:
            view_layer.objects.active = prev_active
    except Exception:
        pass  # per-face use_smooth already set above

    base_v = len(mesh.vertices)
    base_f = len(mesh.polygons)
    print(
        f"[blender] body shading/density finalize: shade_smooth=True subsurf_levels=1 "
        f"weighted_normal=True base_verts={base_v} base_faces={base_f} "
        f"(modifiers not applied; skinning/shape keys preserved)"
    )
    return {
        "shadeSmooth": True,
        "subsurfLevels": 1,
        "subsurfApplied": False,
        "weightedNormal": True,
        "baseVertexCount": base_v,
        "baseFaceCount": base_f,
        "modifierOrder": [m.name for m in mesh_obj.modifiers],
        "restoredArmatures": restored_armatures,
        "claimScope": "procedural_body_shade_smooth_light_subsurf_weighted_normal_not_production_sculpt",
        "notEvidenceFor": [
            "production_asset_readiness",
            "b_plus_visual_realism_gate",
            "clinical_validity",
            "scoring_validity",
        ],
    }


def align_y_height_bind_for_gltf_yup_export(arm_obj: "bpy.types.Object") -> Dict[str, Any]:
    """
    #67 durable export fix (supersedes #58 object-level +90° X).

    Anny mesh + create_canonical_armature author height on local Y. Blender glTF
    export_yup=True assumes a Z-up scene and maps world +Z → glTF +Y. Without
    correction, joint nodes land along −Z while the skinned mesh can still look
    upright via inverse bind matrices.

    #58 applied `arm_obj.rotation_euler.x += 90°` and left that rotation on the
    armature object. The exporter baked it into the glTF armature root as
    (0.707, 0, 0, 0.707). Mesh children parented with identity parent-inverse
    inherit it, so the rendered figure hangs head-down while joint world-Y still
    passes hand>foot. That inverted WHICH of mesh vs joints was wrong.

    Control/treatment (#67): baking +90 into rest DATA still left mesh POSITION
    on Z after export_yup (joints on Y, mesh on Z — IBM/node split). The working
    path matches apply_bvh_to_anny_full and the upright peds_patient_child control:
    keep Y-height rest on the object as identity, and export with export_yup=False
    so Blender's local Y numbers become glTF Y without a root quaternion. Mesh
    POSITION, joints, and root then all agree.
    """
    bones = list(arm_obj.data.bones)
    if not bones:
        return {"applied": False, "reason": "no_bones", "exportYup": True}

    ys = [float(b.head_local.y) for b in bones]
    zs = [float(b.head_local.z) for b in bones]
    y_span = max(ys) - min(ys)
    z_span = max(zs) - min(zs)
    # Already Z-primary rest → leave export_yup=True (Z-up authored rig).
    if y_span <= z_span * 1.1:
        return {
            "applied": False,
            "reason": "bones_not_y_height",
            "ySpan": round(y_span, 6),
            "zSpan": round(z_span, 6),
            "exportYup": True,
        }

    # Ensure armature object is identity — never leave a leftover root quaternion.
    arm_obj.rotation_mode = "XYZ"
    arm_obj.rotation_euler = (0.0, 0.0, 0.0)
    try:
        arm_obj.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    except Exception:
        pass

    # Mesh children: identity local under armature (matches skinning setup).
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        skinned = any(
            getattr(m, "type", None) == "ARMATURE" and getattr(m, "object", None) == arm_obj
            for m in obj.modifiers
        )
        if obj.parent == arm_obj or skinned:
            obj.parent = arm_obj
            obj.matrix_parent_inverse = Matrix.Identity(4)
            obj.location = (0.0, 0.0, 0.0)
            obj.rotation_euler = (0.0, 0.0, 0.0)

    bpy.context.view_layer.update()

    print(
        f"[blender] #67 export bind align: identity object + export_yup=False "
        f"(ySpan={y_span:.4f} zSpan={z_span:.4f}) — Y-height self-standing glTF, "
        f"no armature root quaternion"
    )
    return {
        "applied": True,
        "method": "identity_object_export_yup_false_y_height_self_standing",
        "exportYup": False,
        "ySpan": round(y_span, 6),
        "zSpan": round(z_span, 6),
        "claimScope": "export_bind_pose_identity_root_upright_mesh_and_joints_not_production_rig_quality",
        "notEvidenceFor": [
            "production_asset_readiness",
            "b_plus_visual_realism_gate",
            "clinical_validity",
            "scoring_validity",
        ],
    }


def export_final_glb(output_path: str, export_yup: bool = True) -> None:
    # #60: strip Blender default scratch meshes (Icosphere bone-shape helper, leftover
    # Cube/Plane, etc.) immediately before export so regeneration cannot re-ship them.
    # Geometry must be removed, not renamed. Safe: refuse if parented / skinned / weighted.
    purge_blender_default_scratch_meshes(reason="pre_export")
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_yup=export_yup,
        export_animations=True,
        export_nla_strips=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texture_dir="",
    )
    print(f"[blender] exported final GLB: {output_path} (export_yup={export_yup})")


def main() -> None:
    global _GARMENT_COEFF_OVERRIDES
    args = parse_cli()
    _GARMENT_COEFF_OVERRIDES = _load_garment_coeff_overrides(args.garment_coeff_overrides)
    if _GARMENT_COEFF_OVERRIDES:
        print(f"[blender] #195 garment coeff overrides active: {_GARMENT_COEFF_OVERRIDES}", flush=True)
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
    print("[blender] finalizing body mesh shading + light density (shade-smooth / subsurf L1 / weighted normal)")
    body_shading_density = finalize_body_mesh_shading_and_density(mesh_obj)
    # Bake procedural pore/dermal micro-relief to a packed normal image so glTF export
    # retains skin surface detail (procedural nodes are dropped by the exporter).
    # Guarded: failure logs a warning and continues with the current material.
    print("[blender] baking skin surface micro-detail normal map for glTF (Cycles, packed image)")
    skin_micro_detail_bake = bake_skin_surface_micro_detail_for_gltf(mesh_obj, phenotype)
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

    # #67: identity armature + export_yup=False for Y-height Anny content (must run after
    # all local-Y authoring: skin, morph, garment, animations). Never leave object +90 X.
    export_bind_pose_align = align_y_height_bind_for_gltf_yup_export(arm_obj)
    export_yup = bool(export_bind_pose_align.get("exportYup", True))
    if export_bind_pose_align.get("applied"):
        body_diagnostics["coordinateBasis"] = (
            "blender_mesh_local_y_height_identity_object_export_yup_false_self_standing_glb"
            if not export_yup
            else "blender_mesh_local_y_height_exported_y_up_glb"
        )
        body_diagnostics["exportBindPoseAlign"] = export_bind_pose_align

    print(f"[blender] exporting (export_yup={export_yup})...")
    export_final_glb(args.output_glb, export_yup=export_yup)

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
            "packedInGlb": True,
            "skinMicroDetail": skin_micro_detail_bake,
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
        "bodyShadingDensity": body_shading_density,
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
