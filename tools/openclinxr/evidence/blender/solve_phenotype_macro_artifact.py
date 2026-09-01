"""issue-329 — solve the case-authored phenotypes against MPFB's OWN body.

Reads the committed actor-phenotype export (buildActorPhenotypeExport -> the same
data the factory consumes), derives each actor's MPFB macro dict from the CASE's
authored phenotype (derive_macro_dict_from_authored_phenotype), solves the height
macro against MPFB's own measured body (bake-measure-interpolate, #328 machinery),
and records the PER-ACTOR reachable stature band.

Writes `.openclinxr/evidence/issue-329/phenotype-macro-solve.json` — the planted
contract's substance artifact. Every row is produced by the SAME functions
body_param_stage.py exposes (the production chain), not by a second ad-hoc solver.

Run inside Blender (MPFB enabled):

    /opt/homebrew/bin/blender --background --python tools/openclinxr/evidence/blender/solve_phenotype_macro_artifact.py
"""

import argparse
import json
import pathlib
import sys

import bpy

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
_STAGE_DIR = REPO_ROOT / "packages/openclinxr/factory-stations/src/body_param"
if str(_STAGE_DIR) not in sys.path:
    sys.path.insert(0, str(_STAGE_DIR))

from body_param_stage import (  # noqa: E402
    clear_scene,
    derive_macro_dict_from_authored_phenotype,
    enable_mpfb,
    measure_height_reachable_band,
    solve_height_macro_from_stature,
)

EXPORT_PATH = (
    REPO_ROOT
    / "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json"
)
ARTIFACT_PATH = REPO_ROOT / ".openclinxr/evidence/issue-329/phenotype-macro-solve.json"


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="issue-329 phenotype→macro solve artifact")
    p.add_argument(
        "--export",
        default=str(EXPORT_PATH),
        help="committed actor-phenotype export (default: the fixture one)",
    )
    p.add_argument(
        "--out",
        default=str(ARTIFACT_PATH),
        help="artifact JSON path (default: .openclinxr/evidence/issue-329/phenotype-macro-solve.json)",
    )
    return p.parse_args(args)


def main() -> None:
    args = parse_args()
    export_path = pathlib.Path(args.export)
    out_path = pathlib.Path(args.out)
    if not export_path.is_file():
        raise SystemExit(f"actor-phenotype export missing: {export_path}")
    export = json.loads(export_path.read_text(encoding="utf-8"))
    entries = export.get("entries") or {}

    clear_scene()
    mpfb = enable_mpfb()
    if not mpfb.get("enabled"):
        raise SystemExit(f"MPFB not enabled: {mpfb}")

    rows: list[dict] = []
    for scenario_id in sorted(entries.keys()):
        for actor_id in sorted(entries[scenario_id].keys()):
            entry = entries[scenario_id][actor_id] or {}
            authored = entry.get("phenotype") or {}
            target_cm = authored.get("height_cm")
            if not isinstance(target_cm, (int, float)) or float(target_cm) <= 0:
                continue  # only actors that author a height are in scope (#329)
            target_cm = float(target_cm)
            base_macro, derivation = derive_macro_dict_from_authored_phenotype(authored)
            tmp = out_path.parent / f".{actor_id}.height-solve"
            tmp.mkdir(parents=True, exist_ok=True)
            row = {
                "actorId": actor_id,
                "scenarioId": scenario_id,
                "role": entry.get("role") or "",
                "authoredHeightCm": target_cm,
                "solvedMacros": None,
                "measuredStatureCm": None,
                "reachableBandCm": None,
                "refused": False,
                "refusalReason": None,
                "macroDerivation": derivation,
            }
            try:
                solved = solve_height_macro_from_stature(
                    base_macro, target_cm / 100.0, tmp
                )
                base_macro["height"] = solved["heightMacro"]
                row["solvedMacros"] = {
                    k: round(float(v), 4)
                    for k, v in base_macro.items()
                    if k != "race"
                }
                row["measuredStatureCm"] = round(solved["measuredStatureM"] * 100.0, 2)
                row["reachableBandCm"] = solved["reachableBandCm"]
            except RuntimeError as exc:  # refused: recorded band + reason, never a short body
                row["refused"] = True
                row["refusalReason"] = str(exc)
                band = None
                # The solve re-raises with the band text; measure the band directly if
                # the refusal came from the solve's own bracket check.
                try:
                    band_m = measure_height_reachable_band(base_macro, tmp)
                    band = [round(band_m[0] * 100.0, 2), round(band_m[1] * 100.0, 2)]
                except RuntimeError:
                    band = None
                row["reachableBandCm"] = band
            finally:
                import shutil

                shutil.rmtree(tmp, ignore_errors=True)
            rows.append(row)

    artifact = {
        "schemaVersion": "openclinxr.phenotype-macro-solve.v1",
        "generatedAt": _utc_now().isoformat(),
        "producedByStage": "body_param_stage.derive_macro_dict_from_authored_phenotype + solve_height_macro_from_stature (#329)",
        "source": "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json (buildActorPhenotypeExport)",
        "claimScope": "the MPFB rail's macros are derived from the case-authored phenotype; the solved height is measured against MPFB's own body",
        "notEvidenceFor": [
            "clinical_body_realism",
            "quest_readiness",
            "learner_readiness",
            "a body that LOOKS like the person the case describes",
        ],
        "rows": rows,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(
        f"SOLVE_ARTIFACT_WRITTEN {out_path} rows={len(rows)} "
        + json.dumps(
            [
                {
                    "actorId": r["actorId"],
                    "authoredHeightCm": r["authoredHeightCm"],
                    "solvedMacrosHeight": (r["solvedMacros"] or {}).get("height"),
                    "measuredStatureCm": r["measuredStatureCm"],
                    "reachableBandCm": r["reachableBandCm"],
                    "refused": r["refused"],
                }
                for r in rows
            ]
        )
    )


def timezone_utc():
    from datetime import timezone

    return timezone.utc


def _utc_now():
    from datetime import datetime

    return datetime.now(timezone_utc())


if __name__ == "__main__":
    main()
