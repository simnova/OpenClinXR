#!/usr/bin/env python3
"""Write the immutable M1 baseline before any look probe is rendered."""
from __future__ import annotations

import json
import math
from pathlib import Path

from measure import measure_set

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
CURTAIN = REPO / "tools/openclinxr/evidence/hair-curtain4/best"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")


def light(name, xyz, target, energy, size):
    dx, dy, dz = (xyz[i] - target[i] for i in range(3))
    return {"name": name, "position_m": list(xyz), "target_m": list(target),
            "energy_W": energy, "size_m": size,
            "elevation_deg": math.degrees(math.atan2(dz, math.hypot(dx, dy)))}


def main():
    best = json.load(open(REPO / "tools/openclinxr/evidence/hair-search2/best.json"))["params"]
    meta = json.load(open(CURTAIN / "children-meta.json"))
    judge = json.load(open(CURTAIN / "judge/d5.json"))
    ours = measure_set(CURTAIN/"children/front.png", CURTAIN/"children/front-id.png",
                       CURTAIN/"children/back.png", CURTAIN/"children/back-id.png")
    target = measure_set(TARGET/"target-front.png", JUDGE/"target-set-back/mask-front-v2.png",
                         TARGET/"target-back.png", JUDGE/"target-set-back/mask-back-v3.png", True)
    # Scene coordinates from hair_scene.py. The absolute z depends on the MPFB
    # crown; relative-to-target coordinates completely specify the rig.
    rel = {
        "key": [-1.2, -1.5, math.hypot(1.2, 1.5)*math.tan(math.radians(best["key_elev_deg"]))],
        "fill": [1.5, -1.0, math.hypot(1.5, 1.0)*math.tan(math.radians(best["fill_elev_deg"]))],
        "rim": [1.0, 1.2, .8+.12],
    }
    data = {
        "schema": "hair-light-2-diagnosis-v1",
        "precedence": "written before any probe or search render",
        "fixed_groom": {"tag": "d5", "requested_children": meta["requested"],
                         "actual_children": meta["generated"], "guides": 600,
                         "points_per_strand": 32},
        "fibre": {"profile_radius_m": .00005, "profile_radius_mm": .05,
                  "profile_shape": 0.0, "coverage_baseline_front_px": ours["mask_area"]["front_px"]},
        "material": {"shader": "Principled Hair BSDF", "parametrization": "MELANIN",
                     "melanin": best["melanin"], "melanin_redness": best["redness"],
                     "longitudinal_roughness": best["roughness"], "radial_roughness": .2,
                     "coat": "not exposed by hair shader", "specular_tint": "not exposed by hair shader"},
        "lights": [
            {"name":"OCLX_key", "relative_to_target_m": rel["key"], "energy_W":150.0,
             "size_m":best["key_size_m"], "elevation_deg":best["key_elev_deg"]},
            {"name":"OCLX_fill", "relative_to_target_m": rel["fill"], "energy_W":best["fill_W"],
             "size_m":1.7, "elevation_deg":best["fill_elev_deg"]},
            {"name":"OCLX_rim", "relative_to_target_m":rel["rim"], "energy_W":best["rim_W"],
             "size_m":1.0, "elevation_deg":40.0},
        ],
        "world": {"strength": .4190625, "view_transform":"Standard", "exposure": -.375},
        "regions_definition": {
            "crown_part_band":"top 35% of hair bbox, central 30% width",
            "sides":"18-68% hair bbox height, outer 28% each side",
            "lower_sheet":"bottom 35% of front hair bbox",
            "back_view":"entire target/render back hair-ID mask",
            "cheek":"normalized x=.39-.61 y=.40-.52 excluding hair-ID pixels"
        },
        "ours": ours, "target": target,
        "judge_v6_baseline": {"p50":judge["photometrics_render"]["p50"],
                              "p90":judge["photometrics_render"]["p90"],
                              "RB":judge["photometrics_render"]["RB"],
                              "target_p50":judge["photometrics_target"]["p50"],
                              "target_p90":judge["photometrics_target"]["p90"],
                              "target_RB":judge["photometrics_target"]["RB"],
                              "iou_front":judge["iou"],
                              "iou_profile":judge["profile_view"]["iou"],
                              "iou_back":judge["back_view"]["iou"],
                              "id_show_through":judge["id_show_through"]["fraction"]},
        "candidate_status_before_probes": {key:"UNKNOWN" for key in ["a_fibre_radius_count", "b_roughness_coat", "c_light_geometry", "d_melanin_redness", "e_root_darkening"]}
    }
    (HERE/"diagnosis.json").write_text(json.dumps(data, indent=2)+"\n")


if __name__ == "__main__": main()
