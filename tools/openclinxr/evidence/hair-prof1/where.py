#!/usr/bin/env python3
"""hair-prof1 STEP 1: profile + front silhouette by region on b9 (=tilt5 s5).

Replicates judge v6 registration exactly (similarity render->target from
(a_row,b_row,c_col) triples; front skull-mode with 10 mm hair offset and
7x7-square closing on BOTH masks; profile/back resize-only, no closing),
then attributes false-negative (TS hair, ours empty) and false-positive
(ours hair, TS empty) pixels to anatomical regions on the CORRECTED ruler
(target-frame H / H_mm, not render-frame H).

Reads (read-only): tilt5 scores/s5 ID renders + score.json, hair-judge
worktree judge (provenance only) + target-set-back masks/landmarks,
hair-curtain3 landmarks (render triples), hair-curtain4 ROWS/RAW/ratio.
Writes: E/where.json + E/overlays/{profile,front}.png
System python, numpy + PIL only.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
T5 = ROOT / "tools/openclinxr/evidence/hair-tilt5"
S5SCORE = T5 / "scores/s5"
JROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TM = JROOT / "target-set-back"
SIZE = 1024

# ---- judge-v6 registration inputs (provenance) ----
# render triples: hair-curtain3/landmarks.json judge section (projected skull)
RENDER = {"front": (103.0, 583.0, 512.0),
          "profile": (131.0, 561.0, 209.0),
          "back": (155.0, 651.0, 512.0)}
# target triples: hair-judge worktree target-set-back/landmarks.json
#   front hair (127,608,513); profile (125,577,344); back (130,646,513)
T_HAIR = {"front": (127.0, 608.0, 513.0),
          "profile": (125.0, 577.0, 344.0),
          "back": (130.0, 646.0, 513.0)}
TARGET_MASK = {"front": TM / "mask-front-v2.png",
               "profile": TM / "mask-profile-v2.png",
               "back": TM / "mask-back-v3.png"}
H_MM = 210.65914630889893  # hair-judge landmarks-canonical.json H_mm
HAIR_OFFSET_MM = 10.0
# curtain4 face-relative front targets (analyze.py): TS-native rows, raw TS
# inner half-width mm (render-frame ruler), cheek/mouth face-width ratio
C4_ROWS = (190, 244, 298, 352, 406, 459, 513, 567, 621)
C4_RAW = (2.65, 34.6, 44.25, 47.55, 53.2, 52.75, 49.95, 39.0, 42.7)
C4_RCH = 0.625 / 0.533
C4_RMO = 0.556 / 0.493


def c4_ratio(y):
    if y <= 406:
        return C4_RCH
    if y >= 513:
        return C4_RMO
    return C4_RCH + (C4_RMO - C4_RCH) * (y - 406) / 107


# ---- judge morphology, verbatim logic ----
def _window_sum(b, k):
    r = k // 2
    p = np.pad(b.astype(np.float64), r, mode="constant")
    cs = np.cumsum(np.cumsum(p, axis=0), axis=1)
    cs = np.pad(cs, ((1, 0), (1, 0)), mode="constant")
    h, w = b.shape
    return cs[k:k + h, k:k + w] - cs[0:h, k:k + w] - cs[k:k + h, 0:w] + cs[0:h, 0:w]


def binary_dilation(b, r):
    return _window_sum(b, 2 * r + 1) > 0


def binary_erosion(b, r):
    k = 2 * r + 1
    return _window_sum(b, k) >= k * k


def binary_closing(b, r=3):
    return binary_erosion(binary_dilation(b, r), r)


def load_id_mask(path):
    """Hair bool from a Blender ID render (judge load_mask alpha path)."""
    im = Image.open(path)
    assert im.mode == "RGBA", path
    a = np.array(im)[:, :, 3].astype(np.float64)
    return a >= 0.9 * 255


def load_target_mask(path):
    return np.array(Image.open(path).convert("L")) > 127


def register(mask_r, a_r, b_r, c_r, a_t, b_t, c_t):
    """judge register_view: similarity render->target, mask NEAREST."""
    s = float(b_t - a_t) / float(b_r - a_r)
    tx = float(c_t) - s * float(c_r)
    ty = float(a_t) - s * float(a_r)
    inv = (1.0 / s, 0.0, -tx / s, 0.0, 1.0 / s, -ty / s)
    m = np.array(Image.fromarray((mask_r.astype(np.uint8) * 255)).transform(
        (SIZE, SIZE), Image.AFFINE, inv, Image.NEAREST)) > 127
    return m, {"scale": s, "tx": tx, "ty": ty}


def front_pair():
    m_nat = load_id_mask(S5SCORE / "front-id.png")
    m_r = binary_closing(m_nat, 3)  # working frame already 1024
    t_raw = load_target_mask(TARGET_MASK["front"])
    t_mask = binary_closing(t_raw, 3)
    a_h, b_h, c_h = T_HAIR["front"]
    px_per_mm_native = (b_h - a_h) / H_MM
    off = HAIR_OFFSET_MM * px_per_mm_native
    a_t, b_t, c_t = a_h + off, b_h, c_h
    a_r, b_r, c_r = RENDER["front"]
    m_o, tr = register(m_r, a_r, b_r, c_r, a_t, b_t, c_t)
    ruler = (b_t - a_t) / H_MM  # corrected: target-frame px/mm
    return m_o, t_mask, tr, ruler, {"offsetPx": off, "pxPerMmNative": px_per_mm_native}


def side_pair(view):
    m_r = load_id_mask(S5SCORE / ("profile_90-id.png" if view == "profile" else "back-id.png"))
    t_mask = load_target_mask(TARGET_MASK[view])
    if t_mask.shape != (SIZE, SIZE):
        t_mask = np.array(Image.fromarray(t_mask.astype(np.uint8) * 255).resize(
            (SIZE, SIZE), Image.NEAREST)) > 127
    a_r, b_r, c_r = RENDER[view]
    a_t, b_t, c_t = T_HAIR[view]
    m_o, tr = register(m_r, a_r, b_r, c_r, a_t, b_t, c_t)
    if view == "profile":
        ruler = (b_t - a_t) / H_MM  # target skull H depicts 210.66 mm
    else:
        ruler = (b_t - a_t) / ((1.6599169969558716 - 1.405) * 1000.0)  # crown-shoulder world 254.9 mm
    return m_o, t_mask, tr, ruler, {}


def iou(a, b):
    inter = float(np.logical_and(a, b).sum())
    union = float(np.logical_or(a, b).sum())
    return inter / union if union else 0.0


def row_edges(m, r):
    xs = np.where(m[r])[0]
    if len(xs) == 0:
        return None
    return int(xs.min()), int(xs.max())


def main():
    (E / "overlays").mkdir(parents=True, exist_ok=True)
    sj = json.load(open(S5SCORE / "score.json"))
    exp = sj["judgeV6"]["iou"]
    out = {"provenance": {
        "base": "tilt5 cells/s5/strands.npz via scores/s5 ID renders (no re-render)",
        "renderTriples": {k: list(v) for k, v in RENDER.items()},
        "renderTripleSource": "hair-curtain3/landmarks.json judge section",
        "targetTriplesHair": {k: list(v) for k, v in T_HAIR.items()},
        "targetTripleSource": "hair-judge worktree target-set-back/landmarks.json",
        "targetMasks": {k: str(v) for k, v in TARGET_MASK.items()},
        "frontSkullOffsetMm": HAIR_OFFSET_MM, "skullHmm": H_MM,
        "closing": "7x7 square binary closing both masks (front only)",
        "rulerRule": "target-frame H px / world mm (front skull, profile skull, back crown-shoulder 254.9mm)"},
        "expectedIoU": exp}

    # ---- register all three views ----
    mo_f, tt_f, tr_f, ppm_f, dbg_f = front_pair()
    mo_p, tt_p, tr_p, ppm_p, _ = side_pair("profile")
    mo_b, tt_b, tr_b, ppm_b, _ = side_pair("back")
    got = {"front": iou(mo_f, tt_f), "profile": iou(mo_p, tt_p), "back": iou(mo_b, tt_b)}
    out["iouCheck"] = {k: {"recomputed": got[k], "scoreJson": exp[k],
                           "absErr": abs(got[k] - exp[k])} for k in got}
    out["transforms"] = {"front": tr_f, "profile": tr_p, "back": tr_b}
    out["rulersPxPerMm"] = {"front": ppm_f, "profile": ppm_p, "back": ppm_b,
                            "note": "curtain4 used render-frame H (4.7% coarse); these use target-frame H"}
    print("IoU check:", json.dumps({k: [round(got[k], 4), round(exp[k], 4)] for k in got}))

    # ================= PROFILE =================
    H_p = T_HAIR["profile"][1] - T_HAIR["profile"][0]  # 452
    crown_p, chin_p, face_p = T_HAIR["profile"]
    # TS hem: lowest row with hair run >= 2% frame width
    runs = np.array([np.logical_and(tt_p[r], True).sum() for r in range(SIZE)])
    hem_p = int(np.where(runs >= 0.02 * SIZE)[0].max())
    # mapped render ear -> target frame (sanity anchor for behind-ear/nape split)
    s_p = tr_p["scale"]
    ear_row_p = crown_p + s_p * (441.84 - 131.0)
    out["profile"] = {"H": H_p, "tsHemRow": hem_p, "mappedEarRow": ear_row_p,
                      "tsHemMmBelowChin": (hem_p - chin_p) / ppm_p}
    # per-row front/back edges (mm, target-frame cols relative to face col)
    prows, pfront, pback = [], [], []
    for r in range(SIZE):
        e_o, e_t = row_edges(mo_p, r), row_edges(tt_p, r)
        if e_o is None and e_t is None:
            continue
        prows.append(r)
        pfront.append({"row": r,
                       "oursMm": (e_o[0] - face_p) / ppm_p if e_o else None,
                       "tsMm": (e_t[0] - face_p) / ppm_p if e_t else None})
        pback.append({"row": r,
                      "oursMm": (e_o[1] - face_p) / ppm_p if e_o else None,
                      "tsMm": (e_t[1] - face_p) / ppm_p if e_t else None})
    out["profile"]["frontEdgePerRowMm"] = pfront
    out["profile"]["backEdgePerRowMm"] = pback
    # six-height back-edge table (curtain4 heights)
    six = []
    for y in (250, 340, 430, 520, 610, 700):
        e_o, e_t = row_edges(mo_p, y), row_edges(tt_p, y)
        six.append({"row": y,
                    "oursMm": (e_o[1] - face_p) / ppm_p if e_o else None,
                    "tsMm": (e_t[1] - face_p) / ppm_p if e_t else None,
                    "deltaMm": ((e_o[1] - e_t[1]) / ppm_p) if (e_o and e_t) else None})
    out["profile"]["backEdgeSixHeights"] = six
    # region attribution
    crown_lim = crown_p + 0.12 * H_p
    hem_lim = hem_p - 25
    regions = ["crown_top", "front_edge", "behind_ear", "nape", "back_edge", "hem"]
    fn = np.logical_and(tt_p, np.logical_not(mo_p))
    fp = np.logical_and(mo_p, np.logical_not(tt_p))
    ts_front = np.full(SIZE, -1)
    ts_back = np.full(SIZE, -1)
    for r in range(SIZE):
        e = row_edges(tt_p, r)
        if e:
            ts_front[r], ts_back[r] = e
    preg = {k: {"fn": 0, "fp": 0} for k in regions}
    rr, cc = np.where(fn | fp)
    is_fn = fn[rr, cc]
    for r, c, f in zip(rr, cc, is_fn):
        if r <= crown_lim:
            reg = "crown_top"
        elif r >= hem_lim:
            reg = "hem"
        elif ts_front[r] >= 0 and c <= ts_front[r] + 25:
            reg = "front_edge"
        elif ts_back[r] >= 0 and c >= ts_back[r] - 25:
            reg = "back_edge"
        else:
            reg = "behind_ear" if r < ear_row_p else "nape"
        preg[reg]["fn" if f else "fp"] += 1
    union_p = float(np.logical_or(mo_p, tt_p).sum())
    for k in regions:
        preg[k]["iouCost"] = (preg[k]["fn"] + preg[k]["fp"]) / union_p
    out["profile"]["regions"] = preg
    order = sorted(regions, key=lambda k: -preg[k]["iouCost"])
    out["profile"]["topTwo"] = order[:2]
    print("PROFILE regions:", json.dumps({k: [preg[k]["fn"], preg[k]["fp"], round(preg[k]["iouCost"], 4)] for k in order}, indent=1))
    print("PROFILE six heights:", json.dumps(
        [{k: (round(v, 1) if isinstance(v, float) else v) for k, v in h.items()} for h in six], indent=1))

    # ================= FRONT =================
    H_f = (T_HAIR["front"][1] - (T_HAIR["front"][0] + dbg_f["offsetPx"]))  # skull H target frame
    crown_f, chin_f, centre_f = T_HAIR["front"][0] + dbg_f["offsetPx"], T_HAIR["front"][1], T_HAIR["front"][2]
    runs_f = np.array([tt_f[r].sum() for r in range(SIZE)])
    hem_f = int(np.where(runs_f >= 0.02 * SIZE)[0].max())
    out["front"] = {"tsHemRow": hem_f, "centreCol": centre_f,
                    "tsHemMmBelowChin": (hem_f - chin_f) / ppm_f}
    # per-row inner/outer edges, ours vs TS, mm from centre
    frows = []
    for r in range(SIZE):
        e_o, e_t = row_edges(mo_f, r), row_edges(tt_f, r)
        if e_o is None and e_t is None:
            continue
        def inner(e):
            if e is None:
                return None
            l = e[0]  # left mass always exists when row has hair? compute properly below
            return None
        # inner = gap half-widths from centre; outer = outer half-widths
        lo_o = e_o[0] if e_o else None
        lo_t = e_t[0] if e_t else None
        rec = {"row": r}
        c = int(round(centre_f))
        for key, e in (("ours", e_o), ("ts", e_t)):
            if e is None:
                rec[key] = None
                continue
            xs = np.where((mo_f if key == "ours" else tt_f)[r])[0]
            left = xs[xs < c]
            right = xs[xs > c]
            rec[key] = {
                "innerLMm": (c - left.max()) / ppm_f if len(left) else None,
                "innerRMm": (right.min() - c) / ppm_f if len(right) else None,
                "outerLMm": (c - xs.min()) / ppm_f,
                "outerRMm": (xs.max() - c) / ppm_f}
        frows.append(rec)
    out["front"]["edgesPerRowMm"] = frows
    # curtain4 face-relative targets on the corrected ruler
    ruler_fix = (480.0 / 0.2107) / (ppm_f * 1000.0 / 1000.0 * 1000.0)  # = old px/m / new px/m
    # old fppm = 480/0.2107 px/m ; new = ppm_f*1000 px/m
    ruler_fix = (480.0 / 0.2107) / (ppm_f * 1000.0)
    byrow = {r["row"]: r for r in frows}
    ctab = []
    for y, raw in zip(C4_ROWS, C4_RAW):
        rel = raw * ruler_fix * c4_ratio(y)
        r = byrow.get(y)
        o = None
        if r and r["ours"]:
            il, ir = r["ours"]["innerLMm"], r["ours"]["innerRMm"]
            vals = [v for v in (il, ir) if v is not None]
            o = sum(vals) / len(vals) if vals else None
        t = None
        if r and r["ts"]:
            il, ir = r["ts"]["innerLMm"], r["ts"]["innerRMm"]
            vals = [v for v in (il, ir) if v is not None]
            t = sum(vals) / len(vals) if vals else None
        ctab.append({"row": y, "rawTsMm": raw, "ratio": round(c4_ratio(y), 4),
                     "relTargetMm": rel, "tsDirectMm": t, "oursMm": o,
                     "deltaVsRelMm": (o - rel) if o is not None else None})
    out["front"]["curtain4InnerTable"] = ctab
    out["front"]["rulerFixVsCurtain4"] = ruler_fix
    # outer edge table at same rows
    otab = []
    for y in C4_ROWS:
        r = byrow.get(y)
        if not r:
            otab.append({"row": y, "ours": None, "ts": None})
            continue
        otab.append({"row": y,
                     "oursL": r["ours"]["outerLMm"] if r["ours"] else None,
                     "oursR": r["ours"]["outerRMm"] if r["ours"] else None,
                     "tsL": r["ts"]["outerLMm"] if r["ts"] else None,
                     "tsR": r["ts"]["outerRMm"] if r["ts"] else None})
    out["front"]["outerTable"] = otab
    # region attribution: bands along rows
    bands = [("part_crown", 150, 210), ("upper_inner", 210, 350),
             ("eye_cheek", 350, 475), ("lower_outer", 475, 608), ("hem", 608, 1024)]
    fnf = np.logical_and(tt_f, np.logical_not(mo_f))
    fpf = np.logical_and(mo_f, np.logical_not(tt_f))
    union_f = float(np.logical_or(mo_f, tt_f).sum())
    freg = {}
    for name, lo, hi in bands:
        seg_fn = fnf[lo:hi].sum()
        seg_fp = fpf[lo:hi].sum()
        freg[name] = {"rows": [lo, hi], "fn": int(seg_fn), "fp": int(seg_fp),
                      "iouCost": (int(seg_fn) + int(seg_fp)) / union_f}
    out["front"]["regions"] = freg
    forder = sorted(freg, key=lambda k: -freg[k]["iouCost"])
    out["front"]["topTwo"] = forder[:2]
    print("FRONT inner table:", json.dumps(
        [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in h.items()} for h in ctab], indent=1))
    print("FRONT outer table:", json.dumps(
        [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in h.items()} for h in otab], indent=1))
    print("FRONT regions:", json.dumps({k: [freg[k]["fn"], freg[k]["fp"], round(freg[k]["iouCost"], 4)] for k in forder}, indent=1))

    (E / "where.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE", E / "where.json")

    # overlays: TS photo + TS boundary green + ours boundary red
    for view, mo, tt in (("profile", mo_p, tt_p), ("front", mo_f, tt_f)):
        photo = Image.open(
            Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
            / ("target-profile.png" if view == "profile" else "target-front.png")).convert("RGB")
        base = np.array(photo).copy()
        bt = tt & np.logical_not(binary_erosion(tt, 1))
        bo = mo & np.logical_not(binary_erosion(mo, 1))
        base[bt] = (0, 255, 0)
        base[bo] = (255, 0, 0)
        Image.fromarray(base).save(E / "overlays" / f"{view}.png")
    print("WROTE overlays")


if __name__ == "__main__":
    main()
