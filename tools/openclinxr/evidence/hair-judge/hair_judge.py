"""ONE deterministic judge: front hair render vs one front target photo.

Scores any front render against the target on the rendered hair-only mask.
numpy + Pillow only. Importable (`import hair_judge`) and CLI::

    python3 hair_judge.py --beauty B --mask M --name N [--landmarks JSON] --out DIR

Method (brief-fixed, 2026-10-12):
  registration: similarity (uniform scale + translation, no rotation) taking
    the render's (crown_top_row, chin_row, face_centre_col) onto the target's;
    render mask resampled nearest, render beauty bilinear, into target frame.
  H = target chin - crown. All lengths in units of H unless noted.
  stop bar provenance: orchestrator proposal 2026-10-12, tunable.
"""

import argparse
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

SIZE = 1024
FRACS = (0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6)

TARGET_PHOTO = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/target-front.png"
TARGET_MASK = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/mask-front.png"
TARGET_CROWN = 127
TARGET_CHIN = 607

STOPBAR_PROVENANCE = "orchestrator proposal 2026-10-12, tunable"
SCORE_FORMULA = ("(1-IoU) + width_rms + |below_chin_ours - below_chin_target|"
                 " + |ln(p50_ours/p50_target)|/2 + |ln(RB_ours/RB_target)|/2")


# ---------------------------------------------------------------- morphology

def _window_sum(b, k):
    """Sum over kxk square window centred on each pixel, numpy only."""
    r = k // 2
    p = np.pad(b.astype(np.float64), r, mode="constant")
    cs = np.cumsum(np.cumsum(p, axis=0), axis=1)
    cs = np.pad(cs, ((1, 0), (1, 0)), mode="constant")
    h, w = b.shape
    # straight integral-image window sum:
    tot = cs[k:k + h, k:k + w] - cs[0:h, k:k + w] - cs[k:k + h, 0:w] + cs[0:h, 0:w]
    return tot


def binary_dilation(b, r):
    k = 2 * r + 1
    return _window_sum(b, k) > 0


def binary_erosion(b, r):
    k = 2 * r + 1
    return _window_sum(b, k) >= k * k


def binary_closing(b, r=3):
    """3 px binary closing = dilate then erode with 7x7 square."""
    return binary_erosion(binary_dilation(b, r), r)


def boundary(mask):
    return mask & ~binary_erosion(mask, 1)


# ---------------------------------------------------------------- loading

def load_beauty(path):
    im = Image.open(path).convert("RGB")
    return np.array(im).astype(np.float64) / 255.0, im.size


def load_mask(path):
    """Return (hair_bool_native, encoding_label)."""
    im = Image.open(path)
    if im.mode == "RGBA":
        a = np.array(im)[:, :, 3].astype(np.float64)
        hi = (a >= 0.9 * 255).mean()
        lo = (a <= 0.1 * 255).mean()
        if hi > 0.01 and lo > 0.01:
            return a >= 0.9 * 255, "alpha>=0.9"
        rgb = np.array(im.convert("RGB")).astype(np.float64) / 255.0
        return rgb.mean(axis=2) > 0.5, "white"
    g = np.array(im.convert("L")).astype(np.float64) / 255.0
    return g > 0.5, "white"


def to_working_frame(beauty, mask):
    """Resample any square input to the 1024 working frame."""
    h, w = beauty.shape[:2]
    b = np.array(Image.fromarray((beauty * 255 + 0.5).astype(np.uint8)).resize(
        (SIZE, SIZE), Image.BILINEAR)).astype(np.float64) / 255.0
    m = np.array(Image.fromarray((mask.astype(np.uint8) * 255)).resize(
        (SIZE, SIZE), Image.NEAREST)) > 127
    return b, m


# ---------------------------------------------------------------- landmarks

def derive_target_centre(closed_mask):
    """Column of the part: centre of the hair mask's first 40 hair rows."""
    rows = np.where(closed_mask.any(axis=1))[0]
    r0 = int(rows.min())
    band = closed_mask[r0:r0 + 40, :]
    cols = np.where(band.any(axis=0))[0]
    return int(cols.min() + cols.max()) // 2, int(r0), int(cols.min()), int(cols.max())


def derive_render_landmarks(beauty, mask):
    """Heuristic landmarks; beauty/mask are 1024 working-frame arrays."""
    R, G, B = beauty[:, :, 0], beauty[:, :, 1], beauty[:, :, 2]
    skin = (R > G) & (G > B) & ((R - B) > 0.08)
    sweater = (R - G) > 0.15
    c0, c1 = int(SIZE * 0.4), int(SIZE * 0.6)
    skf = skin[:, c0:c1].mean(axis=1)
    swf = sweater[:, c0:c1].mean(axis=1)
    j = SIZE - 1
    while j >= 0 and (swf[j] > 0.5 and skf[j] < 0.5):
        j -= 1
    sweater_top = j + 1
    if sweater_top >= SIZE - 1:
        j = SIZE - 1
        while j >= 0 and swf[j] > 0.5:
            j -= 1
        sweater_top = j + 1
    above = np.where(skf[:sweater_top] > 0)[0]
    chin = int(above.max()) if len(above) else None
    crown = int(np.where(mask.any(axis=1))[0].min())
    if chin is None:
        return {"crown_top_row": crown, "chin_row": None,
                "face_centre_col": None, "sweater_top": int(sweater_top)}
    H = chin - crown
    eye = crown + round(0.45 * H)
    eye = min(max(eye, 0), SIZE - 1)
    row = skin[eye]
    best = None
    start = None
    for x in range(SIZE + 1):
        on = row[x] if x < SIZE else False
        if on and start is None:
            start = x
        if (not on or x == SIZE) and start is not None:
            run = (start, x - 1)
            if best is None or (run[1] - run[0]) > (best[1] - best[0]):
                best = run
            start = None
    centre = (best[0] + best[1]) // 2 if best else None
    return {"crown_top_row": crown, "chin_row": chin,
            "face_centre_col": centre, "eye_row": int(eye),
            "sweater_top": int(sweater_top)}


# ---------------------------------------------------------------- geometry

def register_into_target(mask_r, beauty_r, lm_r, lm_t):
    """Similarity render->target. Returns (mask_t, beauty_t, transform)."""
    H_t = float(lm_t["chin_row"] - lm_t["crown_top_row"])
    H_r = float(lm_r["chin_row"] - lm_r["crown_top_row"])
    s = H_t / H_r
    tx = float(lm_t["face_centre_col"]) - s * float(lm_r["face_centre_col"])
    ty = float(lm_t["crown_top_row"]) - s * float(lm_r["crown_top_row"])
    transform = {"scale": s, "tx": tx, "ty": ty}
    if s == 1.0 and tx == 0.0 and ty == 0.0:
        return mask_r.copy(), beauty_r.copy(), transform
    inv = (1.0 / s, 0.0, -tx / s, 0.0, 1.0 / s, -ty / s)
    m_img = Image.fromarray((mask_r.astype(np.uint8) * 255))
    m_t = np.array(m_img.transform((SIZE, SIZE), Image.AFFINE, inv,
                                   Image.NEAREST)) > 127
    b_img = Image.fromarray((np.clip(beauty_r, 0, 1) * 255 + 0.5).astype(np.uint8))
    b_t = np.array(b_img.transform((SIZE, SIZE), Image.AFFINE, inv,
                                   Image.BILINEAR)).astype(np.float64) / 255.0
    return m_t, b_t, transform


def half_widths(mask, row, centre):
    """(left, right) hair half-widths in px from centre to outermost hair."""
    r = min(max(row, 0), SIZE - 1)
    xs = np.where(mask[r])[0]
    left = [x for x in xs if x < centre]
    right = [x for x in xs if x > centre]
    lw = int(centre - min(left)) if left else 0
    rw = int(max(right) - centre) if right else 0
    return lw, rw


def gap_width(mask, row, centre):
    """Width in px of the non-hair run containing centre (0 if hair)."""
    r = min(max(row, 0), SIZE - 1)
    if mask[r, min(max(centre, 0), SIZE - 1)]:
        return 0
    rowm = mask[r]
    lo = centre
    while lo - 1 >= 0 and not rowm[lo - 1]:
        lo -= 1
    hi = centre
    while hi + 1 < SIZE and not rowm[hi + 1]:
        hi += 1
    return int(hi - lo + 1)


def lowest_hair_row(mask):
    rows = np.where(mask.any(axis=1))[0]
    return int(rows.max()) if len(rows) else None


def rel_err(o, t):
    if t > 0:
        return (o - t) / t
    return 0.0 if o == 0 else float("inf")


# ---------------------------------------------------------------- photometrics

def photometrics(beauty, mask):
    R, G, B = beauty[:, :, 0], beauty[:, :, 1], beauty[:, :, 2]
    lum = 0.2126 * R + 0.7152 * G + 0.0722 * B
    L = lum[mask]
    Rm, Bm = R[mask], B[mask]
    meanR = float(Rm.mean())
    meanB = float(Bm.mean())
    return {"p10": float(np.percentile(L, 10)),
            "p50": float(np.percentile(L, 50)),
            "p90": float(np.percentile(L, 90)),
            "meanR": meanR, "meanB": meanB,
            "RB": meanR / meanB if meanB > 0 else float("inf"),
            "meanRminusB": float((Rm - Bm).mean())}


# ---------------------------------------------------------------- main entry

def load_target(target_photo=None, target_mask=None, target_landmarks=None):
    tp = target_photo or TARGET_PHOTO
    tm = target_mask or TARGET_MASK
    beauty, _ = load_beauty(tp)
    raw, enc = load_mask(tm)
    beauty, _ = to_working_frame(beauty, raw) if beauty.shape[:2] != (SIZE, SIZE) else (beauty, raw)
    mask = raw
    if mask.shape != (SIZE, SIZE):
        mask = np.array(Image.fromarray((mask.astype(np.uint8) * 255)).resize(
            (SIZE, SIZE), Image.NEAREST)) > 127
        beauty = np.array(Image.fromarray(
            (np.clip(beauty, 0, 1) * 255 + 0.5).astype(np.uint8)).resize(
            (SIZE, SIZE), Image.BILINEAR)).astype(np.float64) / 255.0
    closed = binary_closing(mask, 3)
    centre, r0, cmin, cmax = derive_target_centre(closed)
    print("target part: first hair row %d, top-band cols %d..%d -> face_centre_col %d"
          % (r0, cmin, cmax, centre))
    if target_landmarks:
        lm = {"crown_top_row": target_landmarks["crown_top_row"],
              "chin_row": target_landmarks["chin_row"],
              "face_centre_col": target_landmarks["face_centre_col"]}
    else:
        lm = {"crown_top_row": TARGET_CROWN, "chin_row": TARGET_CHIN,
              "face_centre_col": centre}
    return beauty, closed, lm, enc


def judge(beauty_path, mask_path, name, landmarks=None, out_dir=".",
          target_photo=None, target_mask=None, target_landmarks=None):
    os.makedirs(out_dir, exist_ok=True)
    t_beauty, t_mask, lm_t, t_enc = load_target(target_photo, target_mask,
                                               target_landmarks)
    H = float(lm_t["chin_row"] - lm_t["crown_top_row"])

    b_nat, _ = load_beauty(beauty_path)
    m_nat, enc = load_mask(mask_path)
    if m_nat.shape != b_nat.shape[:2]:
        m_nat = np.array(Image.fromarray((m_nat.astype(np.uint8) * 255)).resize(
            (b_nat.shape[1], b_nat.shape[0]), Image.NEAREST)) > 127
    photo = photometrics(b_nat, m_nat)
    contaminated = bool(photo["meanRminusB"] > 0.20)

    b_r, m_r = to_working_frame(b_nat, m_nat)
    m_r = binary_closing(m_r, 3)

    if landmarks:
        lm_r = {"crown_top_row": landmarks["crown_top_row"],
                "chin_row": landmarks["chin_row"],
                "face_centre_col": landmarks["face_centre_col"]}
        derived = False
    else:
        auto = derive_render_landmarks(b_r, m_r)
        lm_r = {"crown_top_row": auto["crown_top_row"],
                "chin_row": auto["chin_row"],
                "face_centre_col": auto["face_centre_col"]}
        derived = True
        print("%s derived landmarks: crown=%s chin=%s centre=%s eye=%s sweater_top=%s"
              % (name, auto["crown_top_row"], auto["chin_row"],
                 auto["face_centre_col"], auto.get("eye_row"),
                 auto.get("sweater_top")))
    print("%s landmarks used: crown=%s chin=%s centre=%s (target crown=%s chin=%s centre=%s)"
          % (name, lm_r["crown_top_row"], lm_r["chin_row"],
             lm_r["face_centre_col"], lm_t["crown_top_row"],
             lm_t["chin_row"], lm_t["face_centre_col"]))

    result = {"name": name, "mask_encoding": enc,
              "target_mask_encoding": t_enc,
              "landmarks_render": {k: (float(v) if v is not None else None)
                                   for k, v in lm_r.items()},
              "landmarks_target": {k: float(v) for k, v in lm_t.items()},
              "landmarks_derived": derived,
              "H_target": H,
              "stopbar_provenance": STOPBAR_PROVENANCE,
              "score_formula": SCORE_FORMULA,
              "photometrics_render": photo,
              "photometrics_target": photometrics(t_beauty, t_mask),
              "contaminated": contaminated}

    if (lm_r["crown_top_row"] is None or lm_r["chin_row"] is None
            or lm_r["face_centre_col"] is None):
        result["registered"] = False
        result["unregistered_reason"] = "landmarks missing"
        print("%s UNREGISTERED: landmarks missing" % name)
    else:
        H_r = float(lm_r["chin_row"] - lm_r["crown_top_row"])
        if not (250 <= H_r <= 650):
            result["registered"] = False
            result["unregistered_reason"] = (
                "chin - crown %.1f outside 250..650" % H_r)
            print("%s UNREGISTERED: %s" % (name, result["unregistered_reason"]))
        else:
            result["registered"] = True
    if not result["registered"]:
        result["overall"] = False
        write_landmarks_debug(b_r, lm_r if landmarks else auto, out_dir, name)
        out = os.path.join(out_dir, name + ".json")
        with open(out, "w") as f:
            json.dump(result, f, indent=2, sort_keys=True)
        return result

    m_o, b_o, transform = register_into_target(m_r, b_r, lm_r, lm_t)
    result["transform"] = {k: float(v) for k, v in transform.items()}

    inter = float(np.logical_and(m_o, t_mask).sum())
    union = float(np.logical_or(m_o, t_mask).sum())
    iou = inter / union if union > 0 else 0.0

    widths = []
    sq = []
    for f in FRACS:
        row = int(round(lm_t["crown_top_row"] + f * H))
        tl, tr = half_widths(t_mask, row, int(lm_t["face_centre_col"]))
        ol, orr = half_widths(m_o, row, int(lm_t["face_centre_col"]))
        rl, rr = rel_err(ol, tl), rel_err(orr, tr)
        widths.append({"frac": f, "row": row,
                       "target_left": tl, "target_right": tr,
                       "ours_left": ol, "ours_right": orr,
                       "rel_err_left": rl, "rel_err_right": rr})
        if tl + tr > 0:
            if tl > 0:
                sq.append(rl * rl)
            if tr > 0:
                sq.append(rr * rr)
    width_rms = math.sqrt(sum(sq) / len(sq)) if sq else 0.0

    openings = {}
    for key, f in (("eye", 0.45), ("jaw", 0.9)):
        row = int(round(lm_t["crown_top_row"] + f * H))
        t = gap_width(t_mask, row, int(lm_t["face_centre_col"]))
        o = gap_width(m_o, row, int(lm_t["face_centre_col"]))
        openings[key] = {"row": row, "target_px": t, "ours_px": o,
                         "target": t / H, "ours": o / H,
                         "rel_err": rel_err(o, t)}

    bc_t = (lowest_hair_row(t_mask) - lm_t["chin_row"]) / H
    bc_o = (lowest_hair_row(m_o) - lm_t["chin_row"]) / H

    band_end = int(round(lm_t["crown_top_row"] + 0.12 * H))
    mid = (int(lm_t["crown_top_row"]) + band_end) // 2
    part_t = gap_width(t_mask, mid, int(lm_t["face_centre_col"]))
    part_o = gap_width(m_o, mid, int(lm_t["face_centre_col"]))

    pt = result["photometrics_target"]
    pr = result["photometrics_render"]
    clauses = {
        "iou": bool(iou >= 0.80),
        "width_rms": bool(width_rms <= 0.10),
        "below_chin": bool(abs(bc_o - bc_t) <= 0.10),
        "photo": bool((1 / 1.5 <= pr["p50"] / pt["p50"] <= 1.5)
                      and (pr["p90"] <= 1.8 * pt["p90"])) if pt["p50"] > 0 else False,
        "rb": bool(1.2 <= pr["RB"] <= 1.8),
        "opening_eye": bool(abs(openings["eye"]["rel_err"]) <= 0.15),
        "opening_jaw": bool(abs(openings["jaw"]["rel_err"]) <= 0.15),
    }
    overall = all(clauses.values()) and not contaminated
    p50r = pr["p50"] if pr["p50"] > 0 else 1e-6
    p50t = pt["p50"] if pt["p50"] > 0 else 1e-6
    rbr = pr["RB"] if pr["RB"] > 0 else 1e-6
    rbt = pt["RB"] if pt["RB"] > 0 else 1e-6
    score = ((1 - iou) + width_rms + abs(bc_o - bc_t)
             + abs(math.log(p50r / p50t)) / 2 + abs(math.log(rbr / rbt)) / 2)

    result.update({"iou": float(iou), "width_profile": widths,
                   "width_rms": float(width_rms), "openings": openings,
                   "below_chin_target": float(bc_t),
                   "below_chin_ours": float(bc_o),
                   "part_target_px": part_t, "part_ours_px": part_o,
                   "part_row": mid, "clauses": clauses,
                   "overall": bool(overall), "score": float(score)})

    print("STOP BAR (%s): IoU>=0.80 %s (%.4f); width_rms<=0.10 %s (%.4f); "
          "below_chin|d|<=0.10 %s (ours %.4f tgt %.4f); photo %s "
          "(p50 %.4f/%.4f p90 %.4f/%.4f); R/B in [1.2,1.8] %s (%.4f); "
          "openings +-0.15 %s/%s (eye %.3f jaw %.3f); contaminated %s -> "
          "overall %s score %.4f"
          % (STOPBAR_PROVENANCE, clauses["iou"], iou,
             clauses["width_rms"], width_rms, clauses["below_chin"], bc_o,
             bc_t, clauses["photo"], pr["p50"], pt["p50"], pr["p90"],
             pt["p90"], clauses["rb"], pr["RB"], clauses["opening_eye"],
             clauses["opening_jaw"], openings["eye"]["rel_err"],
             openings["jaw"]["rel_err"], contaminated,
             "pass" if overall else "FAIL", score))

    write_overlay(t_beauty, t_mask, m_o, out_dir, name)
    write_landmarks_debug(b_r, lm_r, out_dir, name)
    out = os.path.join(out_dir, name + ".json")
    with open(out, "w") as f:
        json.dump(result, f, indent=2, sort_keys=True)
    return result


# ---------------------------------------------------------------- pictures

def write_overlay(t_beauty, t_mask, m_o, out_dir, name):
    base = (np.clip(t_beauty, 0, 1) * 255 + 0.5).astype(np.uint8).copy()
    bt, bo = boundary(t_mask), boundary(m_o)
    base[bt] = (0, 255, 0)
    base[bo] = (255, 0, 0)
    Image.fromarray(base).save(os.path.join(out_dir, "overlay-%s.png" % name))


def write_landmarks_debug(beauty1024, lm, out_dir, name):
    img = Image.fromarray(
        (np.clip(beauty1024, 0, 1) * 255 + 0.5).astype(np.uint8)).convert("RGB")
    d = ImageDraw.Draw(img)
    if lm.get("crown_top_row") is not None:
        d.line([(0, lm["crown_top_row"]), (SIZE, lm["crown_top_row"])],
               fill=(0, 255, 255), width=2)
        d.text((8, lm["crown_top_row"] + 4), "crown %s" % lm["crown_top_row"],
               fill=(0, 255, 255))
    if lm.get("chin_row") is not None:
        d.line([(0, lm["chin_row"]), (SIZE, lm["chin_row"])],
               fill=(255, 0, 255), width=2)
        d.text((8, lm["chin_row"] + 4), "chin %s" % lm["chin_row"],
               fill=(255, 0, 255))
    if lm.get("face_centre_col") is not None:
        d.line([(lm["face_centre_col"], 0), (lm["face_centre_col"], SIZE)],
               fill=(255, 255, 0), width=2)
        d.text((lm["face_centre_col"] + 4, 8), "centre %s" % lm["face_centre_col"],
               fill=(255, 255, 0))
    if lm.get("crown_top_row") is not None and lm.get("chin_row") is not None:
        H = lm["chin_row"] - lm["crown_top_row"]
        for key, f, col in (("eye", 0.45, (0, 255, 0)),
                            ("jaw", 0.9, (255, 128, 0))):
            r = int(lm["crown_top_row"] + round(f * H))
            d.line([(0, r), (SIZE, r)], fill=col, width=1)
            d.text((8, r + 2), key, fill=col)
    img.save(os.path.join(out_dir, "landmarks-%s.png" % name))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--beauty", required=True)
    ap.add_argument("--mask", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--landmarks", default=None)
    ap.add_argument("--out", default=".")
    ap.add_argument("--target-photo", default=None)
    ap.add_argument("--target-mask", default=None)
    ap.add_argument("--target-landmarks", default=None)
    a = ap.parse_args(argv)
    lm = json.loads(a.landmarks) if a.landmarks else None
    tlm = json.loads(a.target_landmarks) if a.target_landmarks else None
    judge(a.beauty, a.mask, a.name, lm, a.out, a.target_photo,
          a.target_mask, tlm)


if __name__ == "__main__":
    main()
