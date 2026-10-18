"""Noise floors for the eyeshade card (method of shell-placement-report.json).

For each beauty+ID pair: rebuild the ID-globe sclera mask with
sclera_metrics internals, verify base metrics reproduce the CLI JSON, then
1px-erode and 1px-dilate the final sclera mask and take the largest metric
delta as the mask floor; iris radius -/+1px gives the irisEuclid floor.
Catch-light noise comes from measure_catchlight.py itself.

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 probe_noise.py
Writes eyes-runtime-shading/frames/noise.json
"""
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "sclera-shade"))
import sclera_metrics as sm  # noqa: E402
import measure_catchlight as mc  # noqa: E402

STORE = "/Volumes/files/openclinxr-assets/store/eyes-runtime-shading/frames"
CELLS = ["pre-aisha-front", "pre-aisha-yaw25", "pre-body2-front", "pre-body2-yaw25"]


def id_masks(rgb, id_rgb, pts, radius_delta=0.0):
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    iris_union = np.zeros((h, w), dtype=bool)
    per_eye = []
    for contour, (ring, pupil), (co, ci) in (
        (sm.EYE_R, sm.IRIS_R, sm.CORNERS_R),
        (sm.EYE_L, sm.IRIS_L, sm.CORNERS_L),
    ):
        poly = pts[contour]
        centre = pts[pupil]
        ring_pts = pts[ring]
        radius = float(np.max(np.linalg.norm(ring_pts - centre, axis=1))) + radius_delta
        iris_mask = (xx - centre[0]) ** 2 + (yy - centre[1]) ** 2 <= radius**2
        iris_union |= iris_mask
        per_eye.append({"poly": poly, "centre": centre, "radius": radius, "iris_mask": iris_mask})
    R, G, B = (id_rgb[:, :, i].astype(int) for i in range(3))
    key = (G - R >= sm.KEY_GR_MIN) & (G - B >= sm.KEY_GB_MIN) & (G >= sm.KEY_G_MIN)
    d0 = np.full((h, w), np.inf)
    owner = np.full((h, w), -1, dtype=np.int8)
    for i, e in enumerate(per_eye):
        region = sm.morph_bool(sm.rasterize_polygon(rgb.shape, e["poly"]), sm.ASSIGN_DILATE_PX, False)
        e["region"] = region
        dist = np.sqrt((xx - e["centre"][0]) ** 2 + (yy - e["centre"][1]) ** 2)
        closer = region & (dist < d0)
        d0[closer] = dist[closer]
        owner[closer] = i
    for i, e in enumerate(per_eye):
        e["sclera"] = key & (owner == i) & ~iris_union
    return per_eye, iris_union


def metrics_from_masks(rgb, L, per_eye, pts):
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    skin_vals = []
    for contour, (_, pupil), (co, ci) in (
        (sm.EYE_R, sm.IRIS_R, sm.CORNERS_R),
        (sm.EYE_L, sm.IRIS_L, sm.CORNERS_L),
    ):
        outer, inner = pts[co], pts[ci]
        w_eye = float(np.linalg.norm(inner - outer))
        cx = float(pts[pupil][0])
        lower_y = float(np.max(pts[contour][:, 1]))
        x0, x1 = max(0, int(cx - 0.25 * w_eye)), min(w, int(cx + 0.25 * w_eye))
        y0, y1 = max(0, int(lower_y + 0.20 * w_eye)), min(h, int(lower_y + 0.50 * w_eye))
        skin_vals.append(L[y0:y1, x0:x1].ravel())
    skin_med = float(np.median(np.concatenate(skin_vals)))
    all_sclera = np.concatenate([L[e["sclera"]] for e in per_eye])
    m1 = float(np.median(all_sclera)) - skin_med
    mids, canthals, ups, los = [], [], [], []
    for (co, ci), e in zip((sm.CORNERS_R, sm.CORNERS_L), per_eye):
        outer, inner = pts[co], pts[ci]
        axis = inner - outer
        axis_len = float(np.linalg.norm(axis))
        u = axis / axis_len
        r_eye = float(e["radius"])
        sel = e["sclera"]
        d_iris_edge = np.sqrt((xx - e["centre"][0]) ** 2 + (yy - e["centre"][1]) ** 2)[sel] - r_eye
        d_corner = np.minimum(
            np.sqrt((xx - outer[0]) ** 2 + (yy - outer[1]) ** 2)[sel],
            np.sqrt((xx - inner[0]) ** 2 + (yy - inner[1]) ** 2)[sel],
        )
        sL = L[sel]
        is_limbus = (d_iris_edge / (0.5 * r_eye)) <= (d_corner / (0.25 * axis_len))
        mids.append(sL[is_limbus])
        canthals.append(sL[~is_limbus])
        n = np.array([-u[1], u[0]])
        v = (xx - outer[0]) * n[0] + (yy - outer[1]) * n[1]
        upper_m = (v[sel] - float((e["centre"] - outer) @ n)) < 0
        ups.append(sL[upper_m])
        los.append(sL[~upper_m])
    m2a = float(np.median(np.concatenate(mids))) - float(np.median(np.concatenate(canthals)))
    m2b = float(np.median(np.concatenate(ups))) - float(np.median(np.concatenate(los)))
    d90 = float(np.percentile(all_sclera, 90)) - skin_med
    iris = np.array([rgb[e["iris_mask"]].mean(axis=0) for e in per_eye]).mean(axis=0)
    return {"M1": m1, "M2a": m2a, "M2b": m2b, "D90": d90, "irisMeanRGB": iris}


def main():
    out = {}
    for cell in CELLS:
        img = os.path.join(STORE, f"{cell}.png")
        idp = os.path.join(STORE, f"{cell}-id.png")
        rgb = np.array(Image.open(img).convert("RGB"))
        L = sm.srgb_to_lab_l(rgb)
        id_rgb = np.array(Image.open(idp).convert("RGB"))
        pts = sm.detect_landmarks(rgb)
        base_eyes, _ = id_masks(rgb, id_rgb, pts)
        base = metrics_from_masks(rgb, L, base_eyes, pts)
        cli = json.load(open(os.path.join(STORE, f"{cell}.metrics.json")))
        for k in ("M1", "M2a", "M2b", "D90"):
            assert abs(base[k] - cli[k]) < 2e-3, (cell, k, base[k], cli[k])
        variants = {}
        for tag, fn in (
            ("erode1", lambda m: sm.morph_bool(m, 1, True)),
            ("dilate1", lambda m: sm.morph_bool(m, 1, False)),
        ):
            eyes, _ = id_masks(rgb, id_rgb, pts)
            for e in eyes:
                e["sclera"] = fn(e["sclera"])
            variants[tag] = metrics_from_masks(rgb, L, eyes, pts)
        floors = {}
        for k in ("M1", "M2a", "M2b", "D90"):
            floors[k] = round(max(abs(variants[t][k] - base[k]) for t in variants), 3)
        iris_lo = metrics_from_masks(rgb, L, id_masks(rgb, id_rgb, pts, -1.0)[0], pts)["irisMeanRGB"]
        iris_hi = metrics_from_masks(rgb, L, id_masks(rgb, id_rgb, pts, +1.0)[0], pts)["irisMeanRGB"]
        iris_floor = round(float(max(np.linalg.norm(base["irisMeanRGB"] - iris_lo), np.linalg.norm(base["irisMeanRGB"] - iris_hi))), 3)
        cl = mc.measure_image(img)
        out[cell] = {
            "maskFloor": floors,
            "irisEuclidFloor": iris_floor,
            "catchlightPeakL": cl["catchlightPeakL"],
            "catchlightNoiseL": cl["catchlightNoiseL"],
        }
        mc_out = os.path.join(STORE, f"{cell}.catchlight.json")
        json.dump(cl, open(mc_out, "w"), indent=1)
        print(f"OK {cell} floors={floors} irisFloor={iris_floor} CL={cl['catchlightPeakL']}~{cl['catchlightNoiseL']}")
    json.dump(out, open(os.path.join(STORE, "noise.json"), "w"), indent=1)
    print("wrote noise.json")


if __name__ == "__main__":
    main()
