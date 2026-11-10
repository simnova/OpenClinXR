"""score_trial.py: score one candidate (4 view crops) against the target in the registered frame (SPEC OBJECTIVE, D4).

  score_trial.py --crop <prefix> --nohair <prefix> --targets <dir/target-%s.png> [--matte <prefix>] [--frame-id ID] [--part-json F]
                 [--terms objective|a3] [--glb F | --tris N] [--iou-floor-back X] [--out F.json] [--objective F]
Files read: <prefix>-<view>.png for view in front, three_quarter_left, side, back; targets pattern takes the runtime
view name (as `sheen_gate.py score --targets=`). Frame (A2): targets are mapped INTO the runtime crop frame by
`runtime_frame.py to-runtime` with frames-fithead.json (objective.json frame.id), so crops, nohair and matte stay native.
--matte <prefix>: hair mask = erode(alpha > .5, 2) of <prefix>-<view>.png (matte.py write; A1b), as sheen_gate's matte path;
absent = the hideHair difference mask. HARD iou floors come from objective.json hard.iouFloor (registered, matte; A2);
the iou term itself (s=.05) is a soft term. Masks and sheen metrics are sheen_gate's own (render_hair,
target_hair, full_row), so --terms a3 reproduces `sheen_gate.py score` + A3 compute.py exactly.
--part-json: optional {"target": {partWidthMedPx, hairlineFalloffMedPx, hairlineRow}} (part-*.json shape) that
replaces measuring the target front image with part_width.
Python: score_views(...) -> dict with views.<v>.{metrics,target,terms,D_v}, D, hard, feasible, violation, frame_id.
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "grade"))
import part_width as pw  # noqa: E402
import sheen_gate as sg  # noqa: E402

VIEWS = ["front", "three_quarter_left", "side", "back"]
BLACK = 0.06
PART_FAIL_NORM = 20.0  # wnorm charged when part_width cannot find a hairline/part (no SPEC value; recorded in 'missing')
MISSING_NORM = 20.0  # same for any other term that cannot be computed on a view


def _obj(path=None):
    return json.load(open(path or HERE / "objective.json"))


def scale_of(sc, target_row, H, target_val=None):
    k = sc["kind"]
    if k == "abs":
        return sc["v"]
    if k == "rel":
        return sc["k"] * (target_row[sc["of"]] if "of" in sc else target_val)
    if k == "cropH":
        return sc["k"] * H
    raise ValueError(k)


def hair_mask(img, nohair, matte, v):
    if matte:
        from PIL import Image
        a = np.asarray(Image.open("%s-%s.png" % (matte, v)).convert("RGBA"), float)[..., 3] / 255.
        return sg.erode(a > 0.5, 2)
    return sg.render_hair(img, nohair)


# ---------- placement terms ----------

def iou(a, b):
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 0.0


def bands8(img, m, tm):
    """SPEC bandProfileL8/bandBlack8: 8 equal row bands crown->hem over the TARGET hair row extent (both images use the
    same rows: the frame is registered, D4); empty band -> median L 0, black share 0."""
    rows = np.where(tm.sum(1) > 3)[0]
    edges = np.linspace(rows.min(), rows.max() + 1, 9).astype(int)
    L = sg.luma(img)
    med, blk = [], []
    for b in range(8):
        sel = np.zeros_like(m)
        sel[edges[b]:edges[b + 1]] = True
        sel &= m
        v = L[sel]
        med.append(float(np.median(v)) if v.size else 0.0)
        blk.append(float((v < BLACK).mean()) if v.size else 0.0)
    return np.array(med), np.array(blk)


def col_rows(img, m, crown_frac=0.30, smooth=5):
    """Per crown column row of max L (same construction as sheen_gate.band_cols, per column rows kept)."""
    L = sg.luma(img)
    ker = np.ones(smooth) / smooth
    out = {}
    for x in range(m.shape[1]):
        ys = np.where(m[:, x])[0]
        if len(ys) < 10:
            continue
        n = max(int(round(crown_frac * len(ys))), 3)
        cy = ys[:n]
        out[x] = cy[int(np.argmax(np.convolve(L[cy, x], ker, mode='same')))]
    return out


def hue_deg(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = np.where(mx - mn == 0, 1, mx - mn)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6.0
    return h


def circ_mean_deg(h):
    return float(np.degrees(np.angle(np.exp(2j * np.pi * h).mean())) % 360)


def skin_region(tskin, lo=5, hi=40, run=5):
    """SPEC skinBand: per column, first row of a >=5 px skin run in the target skin mask = hairline; region = rows
    hairline+lo..hairline+hi inside that mask."""
    reg = np.zeros_like(tskin)
    for x in range(tskin.shape[1]):
        col = tskin[:, x].astype(int)
        r = np.where(np.convolve(col, np.ones(run), 'valid') == run)[0]
        if len(r):
            h = int(r[0])
            reg[h + lo:h + hi + 1, x] = True
    return reg & tskin


def skin_terms(img, t, tskin):
    reg = skin_region(tskin)
    if reg.sum() < 50:
        return None
    L, Lt = sg.luma(img)[reg].mean(), sg.luma(t)[reg].mean()
    h, ht = circ_mean_deg(hue_deg(img[reg])), circ_mean_deg(hue_deg(t[reg]))
    return dict(skinL=(float(L), float(Lt)), skinHue=(h, ht))


# ---------- scoring ----------

def glb_hair_tris(path):
    """Triangle count of meshes named /hair/ (63,024 for the incumbent; DESIGN G4 record)."""
    with open(path, "rb") as fh:
        head = fh.read(20)
        jl = struct.unpack_from("<I", head, 12)[0]
        doc = json.loads(fh.read(jl))
    n = 0
    for m in doc["meshes"]:
        if re.search("hair", m.get("name", ""), re.I) and not re.search("eyebrow|eyelash", m["name"], re.I):
            for pr in m["primitives"]:
                n += (doc["accessors"][pr["indices"]]["count"] if "indices" in pr
                      else doc["accessors"][pr["attributes"]["POSITION"]]["count"]) // 3
    return n


def _a3(img, nohair, t, matte=None, v=None):
    spec = _obj()["a3"]["terms"]
    c, tr = sg.full_row(img, hair_mask(img, nohair, matte, v)), sg.full_row(t, sg.target_hair(t))
    terms = {}
    for T in spec:
        f = T["field"]
        if c.get(f) is None or tr.get(f) is None:
            terms[T["name"]] = {"status": "MISSING"}
            continue
        s = scale_of(T["scale"], tr, img.shape[0], tr[f])
        nd = abs(c[f] - tr[f]) / s
        terms[T["name"]] = dict(raw=c[f], target=tr[f], scale=s, w=T["w"], norm=nd, wnorm=T["w"] * nd)
    return c, tr, terms


def _objective_view(v, img, nohair, t, spec, part, part_target, crop_front_path, target_front_path, missing, matte=None):
    H = img.shape[0]
    m = hair_mask(img, nohair, matte, v)
    tm = sg.target_hair(t)
    c, tr = sg.full_row(img, m), sg.full_row(t, tm)
    c["iou"] = iou(m, tm)
    tr["iou"] = 1.0  # SPEC iou: target is the mask itself
    raw = {}
    mc, bc = bands8(img, m, tm)
    mt, bt = bands8(t, tm, tm)
    raw["bandProfileL8"] = (float(np.abs(mc - mt).mean()), 0.0)
    raw["bandBlack8"] = (float(np.abs(bc - bt).mean()), 0.0)
    rc, rt = col_rows(img, m), col_rows(t, tm)
    common = sorted(set(rc) & set(rt))
    raw["bandRowVec"] = (float(np.median([abs(rc[x] - rt[x]) for x in common])), 0.0) if common else None
    if v in ("front", "three_quarter_left"):
        tskin = sg.target_masks(t)["skin"]
        sk = skin_terms(img, t, tskin)
        if sk:
            raw["skinL"] = sk["skinL"]
            raw["skinHue"] = sk["skinHue"]
    if v == "front" and part is not None:
        for k in ("partWidthMedPx", "hairlineFalloffMedPx", "hairlineRow"):
            if part.get(k) is not None and part_target.get(k) is not None:
                raw[k] = (part[k], part_target[k])
    terms = {}
    for T in spec:
        n = T["name"]
        if T["views"] != "all" and v not in T["views"]:
            continue
        if n == "peakCeil":
            tgt = tr["peak"]
            s = scale_of({"kind": "rel", "k": T["scale"]["k"]}, tr, H, tgt)
            # SPEC soft ceiling: max(0, peak - 1.25*target)/(.3*target)
            nd = max(0.0, c["peak"] - T["scale"]["ceil"] * tgt) / s
            terms[n] = dict(raw=c["peak"], target=T["scale"]["ceil"] * tgt, scale=s, w=T["w"], norm=nd, wnorm=T["w"] * nd)
            continue
        src = T["source"]
        if src.startswith("sheen_gate.full_row") or n == "iou":
            f = src.split(".")[-1] if n != "iou" else "iou"
            if c.get(f) is None or tr.get(f) is None:
                terms[n] = dict(status="MISSING", wnorm=T["w"] * MISSING_NORM)
                missing.append((v, n, "metric None in crop or target"))
                continue
            rv, tv = c[f], tr[f]
        else:
            if raw.get(n) is None:
                why = ("part_width failed or front part missing" if n in ("partWidthMedPx", "hairlineFalloffMedPx", "hairlineRow")
                       else "no common crown columns" if n == "bandRowVec" else "skin region < 50 px")
                terms[n] = dict(status="MISSING", wnorm=T["w"] * (PART_FAIL_NORM if why.startswith("part") else MISSING_NORM))
                missing.append((v, n, why))
                continue
            rv, tv = raw[n]
        s = scale_of(T["scale"], tr, H, tv)
        d = abs(rv - tv)
        if n == "skinHue":
            d = min(d, 360 - d)  # hue is circular
        nd = d / s
        terms[n] = dict(raw=rv, target=tv, scale=s, w=T["w"], norm=nd, wnorm=T["w"] * nd)
    return c, tr, terms


def score_views(crop, nohair, targets, frame_id="", part_json=None, terms="objective", tris=None, iou_floor_back=None,
                objective=None, views=VIEWS, matte=None):
    ob = _obj(objective)
    frame_id = frame_id or ob.get("frame", {}).get("id", "")
    out = dict(frame_id=frame_id, matte=bool(matte), terms=terms, views={}, hard={}, missing=[])
    missing = []
    part_target = None
    if part_json:
        part_target = json.load(open(part_json))["target"]
    for v in views:
        img = sg.load("%s-%s.png" % (crop, v))
        nh = sg.load("%s-%s.png" % (nohair, v))
        tpath = targets % v
        t = sg.load(tpath)
        if terms == "a3":
            c, tr, tt = _a3(img, nh, t, matte, v)
        else:
            part = None
            if v == "front":
                try:
                    pmeasure = pw.measure_band if ob.get("partMeasure") == "band" else pw.measure  # absent key = v1
                    part = pmeasure("%s-front.png" % crop)
                    if part_target is None:
                        part_target = pmeasure(tpath)
                except Exception as e:  # part_width raises RuntimeError when no hairline is found
                    missing.append((v, "part", str(e)[:120]))
                    part = part if part is not None else None
            pt = part_target or {}
            c, tr, tt = _objective_view(v, img, nh, t, ob["terms"], part, pt, None, tpath, missing, matte)
        out["views"][v] = dict(metrics=c, target=tr, terms=tt, D_v=sum(x["wnorm"] for x in tt.values() if "wnorm" in x))
    out["D"] = sum(out["views"][v]["D_v"] for v in views)
    out["missing"] = missing
    if terms == "objective":
        hard, viol = {}, 0.0
        floors = dict(ob["hard"]["iouFloor"])
        if iou_floor_back is not None:
            floors["back"] = iou_floor_back
        for v in views:
            c, tr = out["views"][v]["metrics"], out["views"][v]["target"]
            g = {}
            fl = floors.get(v)
            if fl is not None:
                g["iou"] = (c["iou"] >= fl, (fl - c["iou"]) / 0.05)
            g["black"] = (c["black"] <= tr["black"] + ob["hard"]["g2"]["blackMaxOverTarget"],
                          (c["black"] - tr["black"] - ob["hard"]["g2"]["blackMaxOverTarget"]) / 0.05)
            pmin = ob["hard"]["g2"]["peakMinFracOfTarget"] * tr["peak"]
            g["peak"] = (c["peak"] >= pmin, (pmin - c["peak"]) / (0.3 * tr["peak"]))
            for k, (ok, ex) in g.items():
                if not ok:
                    viol += max(ex, 0.0)
            hard[v] = {k: bool(ok) for k, (ok, _) in g.items()}
        if tris is not None:
            ok = tris <= ob["hard"]["trisMax"]
            hard["tris"] = bool(ok)
            if not ok:
                viol += 100.0 * (tris - ob["hard"]["trisMax"]) / ob["hard"]["trisMax"]
        out["hard"] = hard
        out["violation"] = viol
        out["feasible"] = bool(viol == 0.0)
        out["tris"] = tris
    return out


def flat(res):
    """Flat row for trials.csv: m_<view>_<metric>, D_<view>, D, feasible, violation."""
    f = {}
    for v, d in res["views"].items():
        for k, x in d["metrics"].items():
            f["m_%s_%s" % (v, k)] = x
        for k, x in d["terms"].items():
            if "wnorm" in x:
                f["w_%s_%s" % (v, k)] = x["wnorm"]
        f["D_%s" % v] = d["D_v"]
    f["D"] = res["D"]
    f["feasible"] = int(res.get("feasible", False))
    f["violation"] = res.get("violation", 0.0)
    return f


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--crop", required=True)
    ap.add_argument("--nohair", required=True)
    ap.add_argument("--targets", required=True)
    ap.add_argument("--frame-id", default="")
    ap.add_argument("--part-json")
    ap.add_argument("--terms", choices=["objective", "a3"], default="objective")
    ap.add_argument("--matte")
    ap.add_argument("--glb")
    ap.add_argument("--tris", type=int)
    ap.add_argument("--iou-floor-back", type=float)
    ap.add_argument("--objective")
    ap.add_argument("--out")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    tris = a.tris if a.tris is not None else (glb_hair_tris(a.glb) if a.glb else None)
    r = score_views(a.crop, a.nohair, a.targets, a.frame_id, a.part_json, a.terms, tris, a.iou_floor_back, a.objective, matte=a.matte)
    if a.out:
        Path(a.out).write_text(json.dumps(r, indent=1, default=float))
    if not a.quiet:
        for v, d in r["views"].items():
            print("%-20s D_v=%.6f  %s" % (v, d["D_v"], " ".join("%s=%.3f" % (k, x["wnorm"]) for k, x in d["terms"].items() if "wnorm" in x)))
        print("D=%.6f" % r["D"], "" if a.terms == "a3" else "feasible=%s violation=%.3f hard=%s" % (r["feasible"], r["violation"], r["hard"]))
        for m in r["missing"]:
            print("MISSING", m)
    return r


if __name__ == "__main__":
    main()
