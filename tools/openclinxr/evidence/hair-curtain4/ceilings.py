"""Compute M2 synthetic front-mask ceilings on corrected registration."""
from pathlib import Path
import importlib.util
import json
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, distance_transform_edt

HERE = Path(__file__).resolve().parent
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TM = JUDGE / "target-set-back"


def load_judge():
    spec = importlib.util.spec_from_file_location("hair_judge_v6_ceiling", JUDGE / "hair_judge.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def alpha(path):
    im = Image.open(path).convert("RGBA")
    return np.asarray(im)[:, :, 3] > 127


def gray(path):
    return np.asarray(Image.open(path).convert("L")) > 127


def iou(a, b):
    return float(np.logical_and(a, b).sum() / np.logical_or(a, b).sum())


def save(mask, name):
    Image.fromarray(mask.astype(np.uint8) * 255).save(HERE / name)


def main():
    lm = json.loads((HERE / "landmarks.json").read_text())
    f = lm["judge"]["front"]
    h = load_judge()
    canon = h.get_canonical()
    target_hair = json.loads((TM / "landmarks.json").read_text())["front"]
    target_px_per_mm = (target_hair["chin_row"] - target_hair["crown_top_row"]) / float(canon["H_mm"])
    target_skull = {
        "crown_top_row": target_hair["crown_top_row"] + 10.0 * target_px_per_mm,
        "chin_row": target_hair["chin_row"],
        "face_centre_col": target_hair["face_centre_col"],
    }
    render_lm = {"crown_top_row": f["crown_top_row"], "chin_row": f["chin_row"], "face_centre_col": f["face_centre_col"]}
    z = np.zeros((1024, 1024, 3), dtype=float)
    head, _, _ = h.register_into_target(alpha(HERE / "bare-head-mask.png"), z, render_lm, target_skull)
    body, _, _ = h.register_into_target(alpha(HERE / "bare-body-mask.png"), z, render_lm, target_skull)
    target = gray(TM / "mask-front-v2.png")
    px_per_mm = (target_skull["chin_row"] - target_skull["crown_top_row"]) / float(canon["H_mm"])
    hem = int(np.where(target.any(axis=1))[0].max())
    brow = int(round(target_skull["crown_top_row"] + 0.40 * (target_skull["chin_row"] - target_skull["crown_top_row"])))

    # Face opening: the centre-connected non-hair run between target curtains.
    face_open = np.zeros_like(target)
    centre = int(target_hair["face_centre_col"])
    for row in range(1024):
        if target[row, centre]:
            continue
        lo = centre
        hi = centre
        while lo > 0 and not target[row, lo - 1]:
            lo -= 1
        while hi + 1 < 1024 and not target[row, hi + 1]:
            hi += 1
        face_open[row, lo:hi + 1] = True

    # (i) a 25mm exterior band. Below the head, extend the last valid head
    # side silhouette vertically to the target hem before applying the band.
    proxy = head.copy()
    rows = np.where(head.any(axis=1))[0]
    last = int(rows.max())
    xs = np.where(head[last])[0]
    if len(xs):
        proxy[last:hem + 1, xs.min():xs.max() + 1] = True
    d_out = distance_transform_edt(~proxy)
    band25 = (~proxy) & (d_out <= 25.0 * px_per_mm)
    band25[hem + 1:, :] = False
    synth_band = band25 & ~face_open

    # (ii) target clipped only where it would lie inside the bare cranium
    # above the brow/hairline band; face-side occlusion remains legal.
    forbidden_skull = head.copy()
    forbidden_skull[brow + 1:, :] = False
    synth_skull = target & ~forbidden_skull

    # (iii) target constrained to a 30mm dilation of the body/head silhouette.
    d_body = distance_transform_edt(~body)
    synth_body = target & (d_body <= 30.0 * px_per_mm)

    rows_out = {
        "schemaVersion": 1,
        "registration": {"render": render_lm, "target_skull": target_skull, "px_per_mm": px_per_mm},
        "hem_row": hem,
        "brow_row": brow,
        "ceilings": {
            "head_exterior_band_0_25mm": iou(synth_band, target),
            "target_outside_bare_skull": iou(synth_skull, target),
            "target_within_30mm_body": iou(synth_body, target),
        },
        "areas": {"target": int(target.sum()), "band": int(synth_band.sum()), "skull_clip": int(synth_skull.sum()), "body_clip": int(synth_body.sum())},
        "binding": min((iou(synth_band, target), "head_exterior_band_0_25mm"), (iou(synth_skull, target), "target_outside_bare_skull"), (iou(synth_body, target), "target_within_30mm_body"))[1],
    }
    (HERE / "ceilings.json").write_text(json.dumps(rows_out, indent=2, sort_keys=True) + "\n")
    save(head, "registered-bare-head.png")
    save(body, "registered-bare-body.png")
    save(synth_band, "ceiling-band25.png")
    save(synth_skull, "ceiling-skull-clip.png")
    save(synth_body, "ceiling-body30.png")
    print("CEILINGS", json.dumps(rows_out, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
