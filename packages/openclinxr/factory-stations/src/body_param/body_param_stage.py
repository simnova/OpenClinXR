#!/usr/bin/env python3
"""#151/#216 body_param factory stage — MPFB macros + fitted garment + skinned armature.

Entry point for Blender `--python`. Implementation is split across sibling modules
in this directory so the 3k-line baker is navigable:

- phenotype_macros.py — case→MPFB translators and BODY_CELL_PACK
- stature_solve.py — height-macro bake-measure-interpolate
- mesh_io.py — scene import/export/camera/render
- garment_ops.py — MakeClothes fit, hide-mask, hem
- rig_bind.py — mixamo_unity bind + pose deformation
- mpfb_body.py — enable MPFB, macros, face keys, helper strip
- body_class.py — one body-class bake
- constants.py / paths.py — shared ids and repo paths

Public names stay importable from this module (tools shim + capability manifest).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

_STATION_DIR = str(Path(__file__).resolve().parent)
if _STATION_DIR not in sys.path:
    sys.path.insert(0, _STATION_DIR)

from body_class import build_one_body_class, render_grade_sheet, render_posed_deformation_grade
from constants import DRIVEN_BONE, DRIVEN_ROTATION_DEG, NOT_EVIDENCE_FOR, STAGE_ID
from mesh_io import clear_scene, write_report
from mpfb_body import enable_mpfb
from phenotype_macros import (
    BODY_CELL_PACK,
    _gender_presentation_to_macro,
    _years_to_age_macro,
    derive_macro_dict_from_authored_phenotype,
)
from stature_solve import measure_height_reachable_band, solve_height_macro_from_stature

# Re-export for `from body_param_stage import BODY_CELL_PACK` and evidence blender helpers.
__all__ = [
    "BODY_CELL_PACK",
    "STAGE_ID",
    "_gender_presentation_to_macro",
    "_years_to_age_macro",
    "clear_scene",
    "derive_macro_dict_from_authored_phenotype",
    "enable_mpfb",
    "measure_height_reachable_band",
    "solve_height_macro_from_stature",
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="body_param factory stage — two MPFB body classes")
    p.add_argument("--mhclo", required=True)
    p.add_argument("--garment-obj", required=True)
    p.add_argument(
        "--mh-base-obj",
        required=True,
        help="MPFB data/3dobjs/base.obj (hm08) — same load path as #215 fit_stage",
    )
    p.add_argument("--out-dir", required=True, help="Directory for per-class GLBs + grade PNG")
    p.add_argument("--report", required=True)
    p.add_argument(
        "--body-classes-json",
        required=True,
        help="JSON list of {bodyClassId, weight, gender, age?, muscle?} (0..1 macros)",
    )
    p.add_argument(
        "--garment-mesh-name-prefix",
        default="makeclothes_library_scrub_shirt",
        help="Mesh name prefix for the upper garment. DEFAULT IS THE FACTORY FALLBACK "
        "(#275); the per-class `garment` spec on --body-classes-json overrides it so the "
        "case definition drives the choice.",
    )
    p.add_argument("--body-mesh-name-prefix", default="hm08_basemesh")
    p.add_argument(
        "--lower-mhclo",
        default="",
        help="Optional lower-body .mhclo (e.g. CC0 cargo pants). Empty = upper-only legacy path.",
    )
    p.add_argument("--lower-garment-obj", default="", help="OBJ companion for --lower-mhclo")
    p.add_argument(
        "--lower-garment-mesh-name-prefix",
        default="makeclothes_library_cargo_pants",
        help="Mesh name prefix for lower garment per body class",
    )
    p.add_argument("--out-grade-png", default="", help="Optional override for grade PNG path")
    p.add_argument(
        "--out-posed-grade-png",
        default="",
        help="Optional #216 rest|posed deformation grade PNG path",
    )
    p.add_argument(
        "--anny-obj",
        default="",
        help="Optional Anny reference OBJ for foot/centre align + girth recording (0044 path). "
        "Stature comes from the body's own macros (#304) — never matched to the reference.",
    )
    return p.parse_args(args)


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    grade_path = args.out_grade_png or str(out_dir / "body-classes-grade.png")
    posed_grade_path = args.out_posed_grade_png or str(out_dir / "posed-deformation-grade.png")

    body_classes = json.loads(Path(args.body_classes_json).read_text(encoding="utf-8"))
    if not isinstance(body_classes, list) or len(body_classes) < 2:
        raise SystemExit("body-classes-json must be a list of at least two body class objects")

    report: dict = {
        "schemaVersion": "openclinxr.body-param-stage.v1",
        "producedByStage": STAGE_ID,
        "notEvidenceFor": NOT_EVIDENCE_FOR,
        "mpfb": {},
        "bodyClasses": [],
        "calibration": {},
        "deformationCalibration": {},
        "artifacts": {},
        "errors": [],
        "status": "started",
    }
    t0 = time.perf_counter()
    clear_scene()
    mpfb = enable_mpfb()
    report["mpfb"] = mpfb
    write_report(args.report, report)
    if not mpfb.get("enabled"):
        report["status"] = "mpfb_load_failed"
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(json.dumps(report))
        return

    try:
        from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
        from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties
        from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo
        from bl_ext.user_default.mpfb.services.objectservice import ObjectService
    except Exception as exc:  # noqa: BLE001
        report["status"] = "mpfb_import_failed"
        report["errors"].append(f"{type(exc).__name__}: {exc}")
        report["traceback"] = traceback.format_exc()[-2000:]
        write_report(args.report, report)
        print(json.dumps(report))
        return

    class_results: list[dict] = []
    try:
        for i, bc in enumerate(body_classes):
            cr = build_one_body_class(
                body_class=bc,
                class_index=i,
                mhclo_path=args.mhclo,
                garment_obj_path=args.garment_obj,
                mh_base_obj=args.mh_base_obj,
                out_dir=out_dir,
                garment_prefix=args.garment_mesh_name_prefix,
                body_prefix=args.body_mesh_name_prefix,
                anny_obj=args.anny_obj,
                ClothesService=ClothesService,
                Mhclo=Mhclo,
                ObjectService=ObjectService,
                GeneralObjectProperties=GeneralObjectProperties,
                lower_mhclo_path=str(args.lower_mhclo or ""),
                lower_garment_obj_path=str(args.lower_garment_obj or ""),
                lower_garment_prefix=str(
                    args.lower_garment_mesh_name_prefix or "makeclothes_library_cargo_pants"
                ),
            )
            class_results.append(cr)
            report["bodyClasses"].append(cr)
            write_report(args.report, report)

        girths = [c["torsoGirthProxyMeters"] for c in class_results]
        spread = max(girths) - min(girths)
        eps = max(spread * 0.35, 0.01) if spread > 0 else 0.01
        report["calibration"] = {
            "bandLowFraction": 0.45,
            "bandHighFraction": 0.60,
            "girthEpsilonMeters": round(eps, 5),
            "observedGirthSpreadMeters": round(spread, 5),
            "observedGirths": [round(g, 5) for g in girths],
            "source": "calibrated_from_two_real_exports_this_run",
        }

        deform_rows = [c.get("deformation") or {} for c in class_results]
        tip_medians = [
            float(d["medianBoneTipMotionMeters"])
            for d in deform_rows
            if isinstance(d.get("medianBoneTipMotionMeters"), (int, float))
        ]
        if tip_medians:
            class_eps = [0.5 * m for m in tip_medians]
            def_eps = min(class_eps) if class_eps else 0.0
            report["deformationCalibration"] = {
                "drivenBone": DRIVEN_BONE,
                "rotationDegrees": DRIVEN_ROTATION_DEG,
                "deformationEpsilonMeters": round(def_eps, 5),
                "perClassMedianBoneTipMotionMeters": [round(m, 5) for m in tip_medians],
                "perClassBodyDeformationMeters": [
                    float((d or {}).get("bodyDeformationMeters") or 0) for d in deform_rows
                ],
                "perClassGarmentDeformationMeters": [
                    float((d or {}).get("garmentDeformationMeters") or 0) for d in deform_rows
                ],
                "source": "calibrated_half_median_bone_tip_motion_this_export",
            }
        else:
            report["deformationCalibration"] = {
                "drivenBone": DRIVEN_BONE,
                "rotationDegrees": DRIVEN_ROTATION_DEG,
                "deformationEpsilonMeters": 0.0,
                "source": "calibrated_half_median_bone_tip_motion_this_export_no_tips",
            }

        grade_engine = render_grade_sheet(class_results, grade_path, out_dir)
        posed_meta = render_posed_deformation_grade(class_results[0], posed_grade_path)
        report["artifacts"] = {
            "gradePng": grade_path,
            "gradeRenderEngine": grade_engine,
            "posedDeformationGradePng": posed_grade_path,
            "posedDeformationGrade": posed_meta,
            "glbs": [c["glbPath"] for c in class_results],
        }
        report["status"] = "completed"
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(
            json.dumps(
                {
                    "status": "completed",
                    "report": args.report,
                    "bodyClassCount": len(class_results),
                    "girthSpread": report["calibration"]["observedGirthSpreadMeters"],
                    "deformationEpsilon": report["deformationCalibration"].get(
                        "deformationEpsilonMeters"
                    ),
                    "gradePng": grade_path,
                    "posedGradePng": posed_grade_path,
                }
            )
        )
    except Exception as exc:  # noqa: BLE001
        report["status"] = "failed"
        report["errors"].append(f"{type(exc).__name__}: {exc}")
        report["traceback"] = traceback.format_exc()[-3000:]
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(json.dumps(report))
        raise


if __name__ == "__main__":
    main()
