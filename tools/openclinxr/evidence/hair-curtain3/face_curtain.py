"""Closed-form, opt-in face curtain over frozen b3 guides.

No walkers and no corrective push loops are used.  Selected front-corner and
temple tails are evaluated directly from target-mask functions, then smoothly
joined to the unchanged b3 shoulder/hem path.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
CAP = E.parent / "hair-cap8" / "cap-v8.npz"
J = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TM = J / "target-set-back"
HH = 0.2107
F_H, P_H = 481.0, 452.0
F_C, F_CROWN, P_CROWN, P_FACE = 513, 127.0, 125.0, 344


def module(name, path):
    s = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(s); sys.modules[name] = m
    s.loader.exec_module(m)
    return m


def smooth(u):
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


def mask(path):
    return np.asarray(Image.open(path).convert("L")) > 127


def sector(root, cx, cy):
    a = float(np.degrees(np.arctan2(abs(root[0] - cx), -(root[1] - cy))))
    return ("front_corner" if a < 35 else ("temple" if a < 70 else "other")), a


class Target:
    def __init__(self, cap):
        self.f = mask(TM / "mask-front-v2.png")
        self.p = mask(TM / "mask-profile-v2.png")
        forehead = np.asarray(cap["verts"])[np.asarray(cap["forehead"], int)]
        self.face_y = float(np.median(forehead[:, 1]))

    def rows(self, z, crown):
        frac = (crown - z) / HH
        return int(np.clip(round(F_CROWN + frac * F_H), 0, 1023)), int(np.clip(round(P_CROWN + frac * P_H), 0, 1023))

    def band(self, z, crown, side):
        rf, _ = self.rows(z, crown); xs = np.where(self.f[rf])[0]
        q = xs[xs < F_C] if side == "L" else xs[xs > F_C]
        if not len(q): return None
        if side == "L": inner, outer = F_C - q.max(), F_C - q.min()
        else: inner, outer = q.min() - F_C, q.max() - F_C
        return inner / F_H * HH, outer / F_H * HH

    def front_y(self, z, crown):
        _, rp = self.rows(z, crown); xs = np.where(self.p[rp])[0]
        if not len(xs): return None
        return self.face_y + (float(xs.min()) - P_FACE) / P_H * HH


def interp_baseline(g, z):
    q = g[np.argsort(g[:, 2])]
    return np.array([np.interp(z, q[:, 2], q[:, k]) for k in range(3)])


def construct(base, c0_mm, c1_mm):
    cap = np.load(CAP); d = np.load(base)
    G, R, PH, L = (np.asarray(d[k]).copy() for k in ("points", "roots", "phases", "liftoff"))
    cx, cy = float(cap["cx"]), float(cap["Cy"]); crown = float(cap["crown"])
    menton = float(cap["menton_z"]); collar = menton - 0.070
    ear_outer = max(abs(float(cap["pinna_top_L"][0]) - cx),
                    abs(float(cap["pinna_top_R"][0]) - cx))
    tgt = Target(cap)
    candidates = []
    for i, r in enumerate(R):
        sec, az = sector(r, cx, cy)
        side = "R" if r[0] >= cx else "L"
        band = tgt.band(float(L[i, 2]), crown, side)
        inner_limit = (0.1921 if side == "R" else 0.2004) * HH
        if sec in ("front_corner", "temple") and abs(float(L[i, 0] - cx)) >= inner_limit:
            candidates.append((i, sec, az, side, band))

    # Mirror-stable layer rank depends only on absolute exit x.
    keys = sorted(set(round(abs(float(L[q[0], 0] - cx)), 9) for q in candidates))
    clearance = {}
    for q in candidates:
        key = round(abs(float(L[q[0], 0] - cx)), 9)
        rank = keys.index(key); u = rank / max(len(keys) - 1, 1)
        clearance[q[0]] = (c0_mm + (c1_mm - c0_mm) * u) / 1000.0

    exits = []
    for i, sec, az, side, _ in candidates:
        sign = 1.0 if side == "R" else -1.0; c = clearance[i]
        baseg = G[i].copy()
        exit_z = max(float(L[i, 2]), float(cap["brow_z"]) + 0.018)
        tail = np.where(baseg[:, 2] <= exit_z)[0]
        if not len(tail): continue
        first = int(tail[0]); exit_p = baseg[first].copy(); L[i] = exit_p
        PH[i, first:] = 1
        exits.append({"guide": int(i), "sector": sec, "side": side,
                      "clearance_mm": c * 1000.0, "point_m": exit_p.tolist()})
        # Direct formula at each existing sample height.  This preserves the
        # sample count, z sequence, hem, and the complete unselected paths.
        for k in tail:
            z = float(baseg[k, 2])
            band = tgt.band(z, crown, side); fy = tgt.front_y(z, crown)
            if band is None or fy is None:
                continue
            # The guide centre sits c inside the target outer mass but outside
            # the target-derived opening (inner edge minus 4 mm).
            xwant = min(max(abs(float(exit_p[0] - cx)), band[0] + c,
                            ear_outer + c),
                        max(band[0] + c, band[1] - 0.001))
            ywant = fy - c
            # Ease from the exact cap exit during the first 18 mm of descent.
            enter = smooth((float(exit_p[2]) - z) / 0.040)
            xhang = (1.0 - enter) * abs(float(exit_p[0] - cx)) + enter * xwant
            yhang = (1.0 - enter) * float(exit_p[1]) + enter * ywant
            # Begin the TS-like rear drift below the jaw; meet the unchanged
            # b3 string at collarbone and retain its complete hem thereafter.
            # Clear the shoulder by returning to the proven b3 rear hull in
            # the first 20 mm below menton; b3 then carries the join through
            # collarbone and preserves the hem exactly.
            drift = smooth((menton - z) / 0.020)
            bp = interp_baseline(baseg, z)
            G[i, k, 0] = cx + sign * ((1.0 - drift) * xhang + drift * abs(float(bp[0] - cx)))
            G[i, k, 1] = (1.0 - drift) * yhang + drift * float(bp[1])
        G[i, -1, 2] = baseg[-1, 2]

    return d, G, R, PH, L, candidates, exits


def validate_and_render(tag, c0, c1, no_render=False):
    gd, G, R, PH, L, selected, exits = construct(E / "cells" / "b3" / "guides16.npz", c0, c1)
    out = E / "revisions" / tag; out.mkdir(parents=True, exist_ok=True)
    np.savez(out / "guides16.npz", **{k: (G if k == "points" else (PH if k == "phases" else (L if k == "liftoff" else gd[k]))) for k in gd.files})
    style = json.loads((E / "cells" / "b3" / "style.json").read_text())
    style.update({"face_curtain": True, "face_curtain_c0_mm": c0, "face_curtain_c1_mm": c1})
    (out / "style.json").write_text(json.dumps(style, indent=2) + "\n")

    gmod = module("curtain2_guides_" + tag, E / "guides.py")
    handle = gmod.load_scene(); W = gmod.world_points(handle.head); objs, bvhs = gmod.colliders(handle)
    cx = float(np.load(CAP)["cx"]); menton = float(np.load(CAP)["menton_z"])
    if not no_render:
        gmod.render_and_masks(handle, G, PH, L, out, objs, W, cx, menton)

    inside = 0; min_sd = float("inf"); inside_detail = []
    for i, *_ in selected:
        for p in G[i]:
            for bvh in bvhs.values():
                sd = gmod.signed_distance(bvh, p)
                if sd is not None:
                    min_sd = min(min_sd, float(sd))
                    if sd < 0:
                        inside += 1
                        if len(inside_detail) < 40: inside_detail.append({"guide": int(i), "point_m": p.tolist(), "sd_mm": float(sd)*1000.0})
    q = np.diff(G[[x[0] for x in selected]], axis=1)
    ln = np.linalg.norm(q, axis=2)
    sel_ph = PH[[x[0] for x in selected]]
    hmask = ((ln > 0.012) & (np.abs(q[:, :, 2]) < 0.002)
             & (sel_ph[:, :-1] == 1) & (sel_ph[:, 1:] == 1))
    horiz_ids = [int(selected[j][0]) for j in np.where(np.any(hmask, axis=1))[0]]
    horiz = len(horiz_ids)

    # Reuse the binding M1 target definitions for exact error calculation.
    diag = module("curtain2_diag_" + tag, E / "diagnose.py")
    target = diag.Target if hasattr(diag, "Target") else None
    # Standalone calculation parallels diagnosis.py and includes only selected guides.
    cap = np.load(CAP); tf = mask(TM / "mask-front-v2.png"); tp = mask(TM / "mask-profile-v2.png")
    forehead = np.asarray(cap["verts"])[np.asarray(cap["forehead"], int)]
    face_y = float(np.median(forehead[:, 1])); crown = float(cap["crown"])
    heights = {"eye": float(np.mean([cap["canthus_L"][2], cap["canthus_R"][2]])),
               "ear_top": float(np.mean([cap["pinna_top_L"][2], cap["pinna_top_R"][2]])),
               "ear_lobe": float(np.mean([cap["pinna_lobe_L"][2], cap["pinna_lobe_R"][2]])),
               "menton": float(cap["menton_z"])}
    table = {}
    for name, z in heights.items():
        xf, yf = [], []
        frac = (crown - z) / HH; rf = int(round(F_CROWN + frac * F_H)); rp = int(round(P_CROWN + frac * P_H))
        px = np.where(tp[rp])[0]; ty = face_y + (float(px.min()) - P_FACE) / P_H * HH
        for i, _, _, side, _ in selected:
            p = interp_baseline(G[i], z); xs = np.where(tf[rf])[0]; qs = xs[xs < F_C] if side == "L" else xs[xs > F_C]
            inner = (F_C - qs.max() if side == "L" else qs.min() - F_C) / F_H * HH * 1000.0
            outer = (F_C - qs.min() if side == "L" else qs.max() - F_C) / F_H * HH * 1000.0
            xv = abs(float(p[0] - cx)) * 1000.0
            xf.append(max(inner - xv, 0.0, xv - outer)); yf.append(abs(float(p[1]) - ty) * 1000.0)
        table[name] = {"front": {"median_mm": float(np.median(xf)), "p90_mm": float(np.percentile(xf, 90))},
                       "profile": {"median_mm": float(np.median(yf)), "p90_mm": float(np.percentile(yf, 90))}}

    earz = heights["ear_lobe"]; pin_y = float(np.mean([cap["pinna_front_L"][1], cap["pinna_front_R"][1]]))
    pin_x = max(abs(float(cap["pinna_top_L"][0]) - cx), abs(float(cap["pinna_top_R"][0]) - cx))
    cls = {"front": 0, "over": 0, "behind": 0}
    for i, *_ in selected:
        p = interp_baseline(G[i], earz)
        k = "front" if p[1] < pin_y - 0.002 else ("over" if abs(p[0] - cx) >= .85 * pin_x else "behind")
        cls[k] += 1
    n = max(len(selected), 1); share = {k: 100.0 * v / n for k, v in cls.items()}
    face_open = 0
    for i, _, _, side, _ in selected:
        for p in G[i]:
            z = float(p[2]); frac = (crown-z)/HH; rf = int(np.clip(round(F_CROWN+frac*F_H),0,1023)); xs=np.where(tf[rf])[0]
            qs=xs[xs<F_C] if side=="L" else xs[xs>F_C]
            if len(qs):
                inner=(F_C-qs.max() if side=="L" else qs.min()-F_C)/F_H*HH
                face_open += int(abs(float(p[0]-cx)) < inner-0.004 and float(cap["menton_z"]) <= z <= float(cap["brow_z"]))
    report = {"tag": tag, "style": {"c0_mm": c0, "c1_mm": c1}, "selected": len(selected),
              "sector": {s: sum(1 for _, q, *_ in selected if q == s) for s in ("front_corner", "temple")},
              "changed": len(selected), "inside_points": inside, "min_signed_distance_mm": min_sd*1000.0,
              "inside_detail": inside_detail, "face_opening_points": face_open,
              "horizontal_runs": horiz, "horizontal_guide_ids": horiz_ids,
              "target_path": table, "ear_share_percent": share, "exits": exits}
    (out / "guide-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--tag", required=True)
    ap.add_argument("--c0", type=float, required=True); ap.add_argument("--c1", type=float, required=True)
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])
    validate_and_render(a.tag, a.c0, a.c1, a.no_render)


if __name__ == "__main__": main()
