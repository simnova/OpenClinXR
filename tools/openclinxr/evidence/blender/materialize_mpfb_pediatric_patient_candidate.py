"""Materialize a local MPFB/MakeHuman pediatric patient comparator GLB (cagematch only)."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

import bpy


def make_material(name: str, color: tuple[float, float, float, float]):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.78
    return material


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="MPFB pediatric patient cagematch comparator.")
    parser.add_argument("--output-glb", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--child-scale", type=float, default=0.62)
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.mpfb.create_human()

    human = bpy.data.objects["Human"]
    human.name = "mpfb_peds_patient_child_body_mesh"
    human.data.name = "mpfb_peds_patient_child_body"
    human.scale = (args.child_scale, args.child_scale, args.child_scale)
    bpy.ops.object.transform_apply(scale=True)
    human.data.materials.clear()
    human.data.materials.append(make_material("mpfb_peds_child_skin", (0.78, 0.62, 0.52, 1.0)))

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = human
    human.select_set(True)
    bpy.ops.mpfb.add_standard_rig()
    bpy.ops.mpfb.load_face_shape_keys()

    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("MPFB standard rig was not created")
    armature.name = "mpfb_peds_patient_child_standard_rig"

    output_glb = pathlib.Path(args.output_glb)
    output_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output_glb), export_format="GLB", export_animations=False)

    morph_count = max(0, len(human.data.shape_keys.key_blocks) - 1) if human.data.shape_keys else 0
    report = {
        "schemaVersion": "openclinxr.mpfb-pediatric-patient-cagematch.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "claimScope": "local_mpfb_makehuman_pediatric_comparator_not_runtime_promotion",
        "outputGlbPath": str(output_glb),
        "childScaleApplied": args.child_scale,
        "mpfb2": {
            "module": "bl_ext.user_default.mpfb",
            "standardRigCreated": armature is not None,
            "faceShapeKeyCount": morph_count,
        },
        "providerBoundary": {
            "localOnly": True,
            "externalNetworkUsed": False,
            "paidApiUsed": False,
            "makehumanSourceEmbedded": False,
            "runtimePromotionAllowed": False,
            "productionAssetReadinessClaimed": False,
        },
        "notEvidenceFor": [
            "b_plus_visual_realism_gate",
            "production_asset_readiness",
            "quest_readiness",
            "learner_readiness",
            "clinical_validity",
            "scoring_validity",
        ],
    }
    report_path = pathlib.Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"EXPORTED {output_glb}")
    print(json.dumps(report))


if __name__ == "__main__":
    main()