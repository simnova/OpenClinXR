#!/usr/bin/env python3
"""
Apply open, in-repo proof locomotion animations onto an OpenClinXR Anny-rest GLB.

Clips (Apache-2.0 friendly, no third-party mocap license):
  - openclinxr_proof_walk_cycle   — looping walk
  - openclinxr_proof_dance_sway   — upbeat dance/sway

These prove Anny LBS → runtime 23-bone skinning deforms visibly (not clinical validity).

Usage:
  blender --background --python apply_proof_animations.py -- \\
    --input-glb path/to/character.glb \\
    --output-glb path/to/character.proof-anim.glb
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

try:
    import bpy
    from mathutils import Euler, Vector
except ImportError:
    print("ERROR: run inside Blender: blender --background --python apply_proof_animations.py -- ...")
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(description="Bake open proof walk/dance clips onto Anny-rest GLB")
    ap.add_argument("--input-glb", required=True)
    ap.add_argument("--output-glb", required=True)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--walk-frames", type=int, default=40, help="frames per walk cycle (loop)")
    ap.add_argument("--dance-frames", type=int, default=60, help="frames per dance cycle (loop)")
    ap.add_argument("--loops", type=int, default=4, help="how many loops to key (walk and dance)")
    return ap.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.actions:
        bpy.data.actions.remove(block)


def import_glb(path: str) -> None:
    bpy.ops.import_scene.gltf(filepath=path)


def find_armature() -> bpy.types.Object:
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            return obj
    raise RuntimeError("No ARMATURE found in imported GLB")


def stand_armature_rest_for_animation(arm: bpy.types.Object) -> Dict[str, Any]:
    """
    glTF from export_yup often leaves pelvis ~-90° X (bones lie, mesh stands via IBMs).
    Keying walk/dance on that rest explodes the mesh in three.js.

    Fix: clear lying pelvis rest rotation in edit mode (absorb into children),
    then re-bind skinned meshes so rest matches standing mesh before keying.
    """
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm.data.edit_bones
    pelvis = eb.get("pelvis")
    head = eb.get("head")
    fixed = False
    method = "noop"
    if pelvis is not None:
        # If pelvis has large roll/orientation vs world Y, rebuild pelvis as Y-up chain.
        # Measure current head-tail of spine chain.
        # Simpler proven approach: set all bone rolls 0 and align bone Y to parent→child
        # by recomputing head/tail from world positions while standing.

        # Collect world head positions from edit bones
        def wpos(bone):
            return arm.matrix_world @ bone.head.copy()

        # Detect lying: pelvis→head more along -Z than +Y in world
        if head is not None:
            p = wpos(pelvis)
            h = wpos(head)
            d = h - p
            lying = abs(d.z) > abs(d.y) * 1.2
        else:
            lying = True

        if lying:
            # Rotate entire edit bone hierarchy +90° about X around pelvis head
            # so chain stands on +Y, then rebind.
            origin = pelvis.head.copy()
            rot = Euler((math.radians(90.0), 0.0, 0.0), "XYZ").to_matrix()
            for bone in eb:
                for attr in ("head", "tail"):
                    v = getattr(bone, attr) - origin
                    v = rot @ v
                    setattr(bone, attr, origin + v)
            fixed = True
            method = "edit_bones_rotate_plus_90x_around_pelvis"

    bpy.ops.object.mode_set(mode="OBJECT")

    # Re-parent/bind meshes: apply armature modifier bind to new rest
    skinned = [
        o
        for o in bpy.context.scene.objects
        if o.type == "MESH"
        and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)
    ]
    for mesh in skinned:
        # Ensure parented to arm with identity parent inverse
        mesh.parent = arm
        mesh.matrix_parent_inverse = arm.matrix_world.inverted() @ mesh.matrix_world
        # Force rest pose evaluation
        for mod in mesh.modifiers:
            if mod.type == "ARMATURE" and mod.object == arm:
                mod.use_deform_preserve_volume = False

    # Apply pose as rest is not needed if we edited bones; clear pose
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    return {"fixed": fixed, "method": method, "skinnedMeshes": len(skinned)}


def bone_pbone(arm: bpy.types.Object, name: str) -> Optional[bpy.types.PoseBone]:
    return arm.pose.bones.get(name)


def _smooth_action_keyframes(action: bpy.types.Action) -> None:
    """Blender 5 actions are layered — walk channels if present."""
    fcurves = getattr(action, "fcurves", None)
    if fcurves is not None:
        for fc in fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
        return
    # Layered action API
    try:
        for layer in action.layers:
            for strip in layer.strips:
                chans = getattr(strip, "channelbags", None) or []
                for bag in chans:
                    for fc in getattr(bag, "fcurves", []) or []:
                        for kp in fc.keyframe_points:
                            kp.interpolation = "BEZIER"
    except Exception:
        pass


def key_euler(pb: bpy.types.PoseBone, frame: int, xyz: Tuple[float, float, float]) -> None:
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler((xyz[0], xyz[1], xyz[2]), "XYZ")
    pb.keyframe_insert(data_path="rotation_euler", frame=frame)


def key_loc(pb: bpy.types.PoseBone, frame: int, xyz: Tuple[float, float, float]) -> None:
    pb.location = Vector(xyz)
    pb.keyframe_insert(data_path="location", frame=frame)


def make_walk_action(arm: bpy.types.Object, frames: int, cycles: int, fps: int) -> str:
    """Deterministic looping walk on OpenClinXR runtime bone names."""
    name = "openclinxr_proof_walk_cycle"
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action

    pelvis = bone_pbone(arm, "pelvis")
    spine = bone_pbone(arm, "spine")
    chest = bone_pbone(arm, "chest")
    head = bone_pbone(arm, "head")
    thigh_l = bone_pbone(arm, "thigh.L")
    thigh_r = bone_pbone(arm, "thigh.R")
    shin_l = bone_pbone(arm, "shin.L")
    shin_r = bone_pbone(arm, "shin.R")
    foot_l = bone_pbone(arm, "foot.L")
    foot_r = bone_pbone(arm, "foot.R")
    arm_l = bone_pbone(arm, "upper_arm.L")
    arm_r = bone_pbone(arm, "upper_arm.R")
    fore_l = bone_pbone(arm, "forearm.L")
    fore_r = bone_pbone(arm, "forearm.R")

    total = frames * cycles
    for f in range(total + 1):
        t = (f % frames) / float(frames)  # 0..1
        phase = t * 2.0 * math.pi
        # Opposite phase L/R
        leg_l = math.sin(phase)
        leg_r = math.sin(phase + math.pi)
        arm_swing_l = math.sin(phase + math.pi)
        arm_swing_r = math.sin(phase)

        # Pelvis: slight bob + yaw
        if pelvis:
            key_loc(pelvis, f, (0.0, 0.012 * abs(math.sin(phase * 2)), 0.0))
            key_euler(pelvis, f, (0.04 * math.sin(phase * 2), 0.08 * math.sin(phase), 0.0))
        if spine:
            key_euler(spine, f, (0.05 * math.sin(phase * 2), 0.06 * math.sin(phase), 0.0))
        if chest:
            key_euler(chest, f, (0.03 * math.sin(phase * 2 + 0.3), 0.05 * math.sin(phase + 0.2), 0.0))
        if head:
            key_euler(head, f, (-0.02 * math.sin(phase * 2), 0.04 * math.sin(phase + math.pi), 0.0))

        # Legs (X = pitch in typical Blender bone local for Y-up chains after export varies;
        # key multiple axes so some deformation always reads in glTF)
        def leg(thigh, shin, foot, s: float) -> None:
            if thigh:
                key_euler(thigh, f, (0.55 * s, 0.0, 0.08 * s))
            if shin:
                # knee bends more on recovery
                knee = max(0.0, -s) * 0.9 + 0.15 * abs(s)
                key_euler(shin, f, (knee, 0.0, 0.0))
            if foot:
                key_euler(foot, f, (-0.25 * s, 0.0, 0.0))

        leg(thigh_l, shin_l, foot_l, leg_l)
        leg(thigh_r, shin_r, foot_r, leg_r)

        if arm_l:
            key_euler(arm_l, f, (0.35 * arm_swing_l, 0.0, 0.12 + 0.05 * arm_swing_l))
        if arm_r:
            key_euler(arm_r, f, (0.35 * arm_swing_r, 0.0, -0.12 - 0.05 * arm_swing_r))
        if fore_l:
            key_euler(fore_l, f, (0.25 + 0.15 * abs(arm_swing_l), 0.0, 0.0))
        if fore_r:
            key_euler(fore_r, f, (0.25 + 0.15 * abs(arm_swing_r), 0.0, 0.0))

    # Loop markers (Blender 5 layered actions: no action.fcurves)
    try:
        action.use_frame_range = True
        action.frame_start = 0
        action.frame_end = frames
    except Exception:
        pass
    _smooth_action_keyframes(action)

    # Push to NLA as looping strip spanning full duration
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, action)
    strip.frame_end = total
    try:
        strip.repeat = float(cycles)
    except Exception:
        pass
    arm.animation_data.action = None  # NLA owns it
    return name


def make_dance_action(arm: bpy.types.Object, frames: int, cycles: int, fps: int) -> str:
    """Deterministic looping dance/sway — more torso twist + arm raise."""
    name = "openclinxr_proof_dance_sway"
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action

    pelvis = bone_pbone(arm, "pelvis")
    spine = bone_pbone(arm, "spine")
    chest = bone_pbone(arm, "chest")
    neck = bone_pbone(arm, "neck")
    head = bone_pbone(arm, "head")
    arm_l = bone_pbone(arm, "upper_arm.L")
    arm_r = bone_pbone(arm, "upper_arm.R")
    fore_l = bone_pbone(arm, "forearm.L")
    fore_r = bone_pbone(arm, "forearm.R")
    thigh_l = bone_pbone(arm, "thigh.L")
    thigh_r = bone_pbone(arm, "thigh.R")
    clav_l = bone_pbone(arm, "clavicle.L")
    clav_r = bone_pbone(arm, "clavicle.R")

    total = frames * cycles
    for f in range(total + 1):
        t = (f % frames) / float(frames)
        phase = t * 2.0 * math.pi
        bounce = math.sin(phase * 2)
        sway = math.sin(phase)

        if pelvis:
            key_loc(pelvis, f, (0.03 * sway, 0.03 * abs(bounce), 0.0))
            key_euler(pelvis, f, (0.08 * bounce, 0.25 * sway, 0.1 * math.sin(phase * 2)))
        if spine:
            key_euler(spine, f, (0.1 * bounce, 0.35 * sway, 0.08 * bounce))
        if chest:
            key_euler(chest, f, (0.12 * bounce, 0.4 * sway, 0.1 * math.sin(phase + 0.5)))
        if neck:
            key_euler(neck, f, (0.05 * bounce, 0.15 * sway, 0.0))
        if head:
            key_euler(head, f, (0.08 * bounce, 0.2 * sway, 0.05 * math.sin(phase * 3)))

        # Arms: alternate raise / wave
        if clav_l:
            key_euler(clav_l, f, (0.0, 0.0, 0.15 + 0.1 * sway))
        if clav_r:
            key_euler(clav_r, f, (0.0, 0.0, -0.15 - 0.1 * sway))
        if arm_l:
            key_euler(arm_l, f, (-0.9 - 0.4 * sway, 0.2 * bounce, 0.5 + 0.3 * sway))
        if arm_r:
            key_euler(arm_r, f, (-0.9 + 0.4 * sway, -0.2 * bounce, -0.5 - 0.3 * sway))
        if fore_l:
            key_euler(fore_l, f, (0.4 + 0.3 * abs(sway), 0.0, 0.2 * bounce))
        if fore_r:
            key_euler(fore_r, f, (0.4 + 0.3 * abs(sway), 0.0, -0.2 * bounce))

        # Light step in place
        if thigh_l:
            key_euler(thigh_l, f, (0.25 * max(0.0, math.sin(phase)), 0.0, 0.1 * sway))
        if thigh_r:
            key_euler(thigh_r, f, (0.25 * max(0.0, math.sin(phase + math.pi)), 0.0, -0.1 * sway))

    try:
        action.use_frame_range = True
        action.frame_start = 0
        action.frame_end = frames
    except Exception:
        pass
    _smooth_action_keyframes(action)

    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, action)
    strip.frame_end = total
    try:
        strip.repeat = float(cycles)
    except Exception:
        pass
    arm.animation_data.action = None
    return name


def export_glb(path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    # Mute all but one track at a time? Export all NLA strips as separate animations.
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_nla_strips=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )


def main() -> None:
    args = parse_args()
    clear_scene()
    print(f"[proof-anim] import {args.input_glb}")
    import_glb(args.input_glb)
    arm = find_armature()
    print(f"[proof-anim] armature={arm.name} bones={len(arm.pose.bones)}")
    stand_meta = stand_armature_rest_for_animation(arm)
    print(f"[proof-anim] stand_rest={stand_meta}")

    bpy.context.scene.render.fps = args.fps
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = max(args.walk_frames, args.dance_frames) * args.loops

    walk = make_walk_action(arm, args.walk_frames, args.loops, args.fps)
    dance = make_dance_action(arm, args.dance_frames, args.loops, args.fps)
    print(f"[proof-anim] clips: {walk}, {dance}")

    print(f"[proof-anim] export {args.output_glb}")
    export_glb(args.output_glb)

    report = {
        "schemaVersion": "openclinxr.proof-animations.v1",
        "inputGlb": os.path.abspath(args.input_glb),
        "outputGlb": os.path.abspath(args.output_glb),
        "armature": arm.name,
        "boneCount": len(arm.data.bones),
        "clips": [
            {
                "name": walk,
                "kind": "walk_cycle",
                "framesPerCycle": args.walk_frames,
                "loops": args.loops,
                "fps": args.fps,
                "license": "Apache-2.0 (generated in-repo; no third-party mocap)",
            },
            {
                "name": dance,
                "kind": "dance_sway",
                "framesPerCycle": args.dance_frames,
                "loops": args.loops,
                "fps": args.fps,
                "license": "Apache-2.0 (generated in-repo; no third-party mocap)",
            },
        ],
        "standRest": stand_meta,
        "purpose": "Prove Anny-rest → runtime 23-bone LBS deforms under open locomotion clips",
        "claimScope": "animation_deformation_proof_not_clinical_validity",
        "notEvidenceFor": [
            "clinical_validity",
            "scoring_validity",
            "production_asset_readiness",
            "quest_readiness",
            "b_plus_visual_realism_gate",
        ],
    }
    report_path = os.path.splitext(args.output_glb)[0] + ".proof-anim-report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(f"[proof-anim] report {report_path}")
    print("[proof-anim] done")


if __name__ == "__main__":
    main()
