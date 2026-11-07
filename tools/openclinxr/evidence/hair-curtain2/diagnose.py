"""Binding M1 diagnosis for hair-curtain-2. Run before any face_curtain code.

The measurements deliberately use the frozen b3 children/guides and judge-v6
similarity registrations.  No construction code is imported or executed.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
CAP = E.parent / "hair-cap8" / "cap-v8.npz"
J = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TM = J / "target-set-back"
HH_MM = 210.7
FRONT_CENTRE = 513
FRONT_H_PX = 481.0
PROFILE_H_PX = 452.0
PROFILE_FACE_FRONT_COL = 344

# Frozen registrations from b3 judge-v6 (front 55,595,512; profile 90,570,200).
FRONT_TR = {"scale": 0.8484572341212556, "tx": 78.58989612991712, "ty": 103.1679456978529}
PROFILE_TR = {"scale": 0.9416666666666667, "tx": 155.66666666666666, "ty": 40.25}


def load_mask(path):
    return np.asarray(Image.open(path).convert("L")) > 127


def warp(mask, tr):
    """Nearest-neighbour render->target warp, matching judge-v6."""
    inv = (1.0 / tr["scale"], 0.0, -tr["tx"] / tr["scale"],
           0.0, 1.0 / tr["scale"], -tr["ty"] / tr["scale"])
    im = Image.fromarray(mask.astype(np.uint8) * 255)
    return np.asarray(im.transform((1024, 1024), Image.Transform.AFFINE, inv,
                                   resample=Image.Resampling.NEAREST)) > 127


def mm(px, denom=FRONT_H_PX):
    return float(px) * HH_MM / float(denom)


def front_edges(mask, row):
    """Inner/outer distance from centre on both sides at one row."""
    xs = np.where(mask[int(row)])[0]
    left = xs[xs < FRONT_CENTRE]
    right = xs[xs > FRONT_CENTRE]
    if not len(left) or not len(right):
        return None
    return {
        "inner_L_mm": mm(FRONT_CENTRE - int(left.max())),
        "outer_L_mm": mm(FRONT_CENTRE - int(left.min())),
        "inner_R_mm": mm(int(right.min()) - FRONT_CENTRE),
        "outer_R_mm": mm(int(right.max()) - FRONT_CENTRE),
    }


def profile_front(mask, row, ear_col):
    xs = np.where(mask[int(row)])[0]
    if not len(xs):
        return None
    col = int(xs.min())
    return {
        "front_col_px": col,
        "from_face_front_mm": mm(col - PROFILE_FACE_FRONT_COL, PROFILE_H_PX),
        "from_ear_mm": mm(col - ear_col, PROFILE_H_PX),
    }


def interp_path(g, z):
    """Linear point on a guide at world z; paths descend monotonically enough for M1."""
    order = np.argsort(g[:, 2])
    q = g[order]
    return np.array([np.interp(z, q[:, 2], q[:, k]) for k in range(3)])


def sector(root, cx, cy):
    az = float(np.degrees(np.arctan2(abs(root[0] - cx), -(root[1] - cy))))
    name = "front_corner" if az < 35.0 else ("temple" if az < 70.0 else "other")
    return name, az


def band_error(x_mm, edges, side):
    lo = edges[f"inner_{side}_mm"]
    hi = edges[f"outer_{side}_mm"]
    return max(lo - x_mm, 0.0, x_mm - hi)


def qsummary(vals):
    a = np.asarray(vals, float)
    if not len(a):
        return {"n": 0, "median_mm": None, "p90_mm": None, "max_mm": None}
    return {"n": int(len(a)), "median_mm": float(np.median(a)), "p90_mm": float(np.percentile(a, 90)),
            "max_mm": float(np.max(a))}


def main():
    cap = np.load(CAP)
    gd = np.load(E / "cells" / "b3" / "guides16.npz")
    G, R, L = (np.asarray(gd[k], float) for k in ("points", "roots", "liftoff"))
    cx, cy = float(cap["cx"]), float(cap["Cy"])
    crown, menton = float(cap["crown"]), float(cap["menton_z"])

    target_front = load_mask(TM / "mask-front-v2.png")
    target_profile = load_mask(TM / "mask-profile-v2.png")
    b3_front = warp(load_mask(E / "cells" / "b3" / "children" / "front-id.png"), FRONT_TR)
    b3_profile = warp(load_mask(E / "cells" / "b3" / "children" / "profile_90-id.png"), PROFILE_TR)

    # Ten common physical levels from upper hairline through the target hair/collar join.
    front_rows = np.rint(np.linspace(190, 675, 10)).astype(int)
    fracs = (front_rows - 127.0) / FRONT_H_PX
    profile_rows = np.rint(125.0 + fracs * PROFILE_H_PX).astype(int)
    zs = crown - fracs * (HH_MM / 1000.0)

    # Target ear is fully occluded.  Register its anatomical location by the
    # canonical forehead-to-pinna-front depth, expressed in target profile px.
    face_front_y = float(np.median(np.asarray(cap["verts"])[np.asarray(cap["forehead"], int), 1]))
    ear_y = float(np.mean([cap["pinna_front_L"][1], cap["pinna_front_R"][1]]))
    ear_col = int(round(PROFILE_FACE_FRONT_COL + (ear_y - face_front_y) * 1000.0 / HH_MM * PROFILE_H_PX))

    target_rows, b3_rows = [], []
    for i, (rf, rp, z) in enumerate(zip(front_rows, profile_rows, zs)):
        te, be = front_edges(target_front, rf), front_edges(b3_front, rf)
        tp, bp = profile_front(target_profile, rp, ear_col), profile_front(b3_profile, rp, ear_col)
        target_rows.append({"i": i, "z_m": float(z), "front_row_px": int(rf),
                            "profile_row_px": int(rp), "front": te, "profile": tp})
        b3_rows.append({"i": i, "z_m": float(z), "front_row_px": int(rf),
                        "profile_row_px": int(rp), "front": be, "profile": bp})

    heights = {
        "eye": float(np.mean([cap["canthus_L"][2], cap["canthus_R"][2]])),
        "ear_top": float(np.mean([cap["pinna_top_L"][2], cap["pinna_top_R"][2]])),
        "ear_lobe": float(np.mean([cap["pinna_lobe_L"][2], cap["pinna_lobe_R"][2]])),
        "menton": menton,
        "collarbone": menton - 0.070,
    }

    chosen = []
    for i, root in enumerate(R):
        sec, az = sector(root, cx, cy)
        if sec in ("front_corner", "temple"):
            chosen.append((i, sec, az))

    guide_records = []
    by_height = {name: {"front_error_mm": [], "profile_error_mm": []} for name in heights}
    for i, sec, az in chosen:
        rec = {"guide": int(i), "sector": sec, "azimuth_deg": az,
               "root_m": R[i].tolist(), "liftoff_m": L[i].tolist(), "heights": {}}
        for name, z in heights.items():
            p = interp_path(G[i], z)
            frac = (crown - z) / (HH_MM / 1000.0)
            rf = int(round(127.0 + frac * FRONT_H_PX))
            rp = int(round(125.0 + frac * PROFILE_H_PX))
            fe = front_edges(target_front, np.clip(rf, 0, 1023))
            pe = profile_front(target_profile, np.clip(rp, 0, 1023), ear_col)
            side = "R" if p[0] >= cx else "L"
            x_mm = abs(float(p[0] - cx)) * 1000.0
            # Canonical and target share the same skull-height scale; target
            # profile distance from forehead maps directly back to world y.
            target_y = face_front_y + pe["from_face_front_mm"] / 1000.0 if pe else None
            xe = band_error(x_mm, fe, side) if fe else None
            ye = abs(float(p[1]) - target_y) * 1000.0 if target_y is not None else None
            rec["heights"][name] = {
                "z_m": z, "point_m": p.tolist(), "front_x_mm": x_mm,
                "target_front_band_mm": None if fe is None else [fe[f"inner_{side}_mm"], fe[f"outer_{side}_mm"]],
                "front_error_mm": xe, "profile_y_m": float(p[1]),
                "target_profile_y_m": target_y, "profile_error_mm": ye,
            }
            if xe is not None: by_height[name]["front_error_mm"].append(xe)
            if ye is not None: by_height[name]["profile_error_mm"].append(ye)
        guide_records.append(rec)

    summaries = {h: {axis: qsummary(vals) for axis, vals in d.items()} for h, d in by_height.items()}
    eye_ok = all(summaries[h][a]["median_mm"] <= 8.0
                 for h in ("eye", "ear_top") for a in ("front_error_mm", "profile_error_mm"))

    front_exit_count = int(json.loads((E / "cells" / "b3" / "row.json").read_text())["g5"]["front_lo"])
    # A taut string has no sustained near-vertical segment: measure the angle
    # from lift-off to the eye/ear level in profile depth versus vertical.
    taut_angles = []
    for i, _, _ in chosen:
        p = interp_path(G[i], heights["ear_lobe"])
        dz = abs(float(L[i, 2] - p[2]))
        taut_angles.append(float(np.degrees(np.arctan2(abs(float(p[1] - L[i, 1])), max(dz, 1e-9)))))
    near_vertical = int(np.sum(np.asarray(taut_angles) <= 21.0))

    causes = {
        "part1_front_exits_forbidden": {
            "verdict": "SUPPORTED" if front_exit_count / len(G) < 0.02 else "REFUTED",
            "number": {"front_edge_exits": front_exit_count, "all_guides": int(len(G)),
                       "percent": 100.0 * front_exit_count / len(G),
                       "selected_front_corner_temple": len(chosen)},
        },
        "part2_taut_prevents_vertical_hang": {
            "verdict": "SUPPORTED" if near_vertical / max(len(chosen), 1) < 0.5 else "REFUTED",
            "number": {"selected_guides": len(chosen), "near_vertical_le_21deg": near_vertical,
                       "percent": 100.0 * near_vertical / max(len(chosen), 1),
                       "median_profile_angle_from_vertical_deg": float(np.median(taut_angles))},
            "closed_negative": "hair-sweep1 s3 vertical_then_taut changed every side strand on flow-v10; it kept 54.3%, produced ear cover 0.000, and lost G3/G8. face_curtain instead selects only measured front-corner/temple roots, permits a controlled front exit, hangs outside the face/ear shadow, and drifts after the jaw, so s3 refutes that global implementation but not this local construction premise."
        }
    }

    doc = {
        "schemaVersion": 1, "card": "hair-curtain-2", "baseline": "hair-curtain1/g1 copied as b3",
        "measurement_order": "written before any face_curtain construction code exists or runs",
        "scales": {"skull_H_mm": HH_MM, "front_H_px": FRONT_H_PX, "profile_H_px": PROFILE_H_PX,
                   "profile_face_front_col": PROFILE_FACE_FRONT_COL, "profile_ear_col": ear_col,
                   "profile_ear_note": "target ear is fully hair-occluded; column is anatomical forehead-to-pinna-front depth transferred from cap-v8"},
        "target_10_rows": target_rows, "b3_children_10_rows": b3_rows,
        "guide_selection": {"n": len(chosen), "sectors": {s: sum(1 for _, q, _ in chosen if q == s) for s in ("front_corner", "temple")}},
        "target_path_summary": summaries, "guide_records": guide_records,
        "g1_premise_wrong_stop": {"triggered": eye_ok,
                                   "rule": "median front and profile TARGET_PATH error <=8 mm at eye and ear_top"},
        "causes": causes,
    }
    (E / "diagnosis.json").write_text(json.dumps(doc, indent=2) + "\n")
    print(json.dumps({"guide_selection": doc["guide_selection"], "target_path": summaries,
                      "premise_wrong_stop": doc["g1_premise_wrong_stop"], "causes": causes}, indent=2))


if __name__ == "__main__":
    main()
