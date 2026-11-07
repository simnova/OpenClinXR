#!/usr/bin/env python3
"""hair-groom7 STEP 1: silhouette rulers R-PROTRUDE / R-HEMSTEP / R-GROOVE / R-LOOP.

Each ruler is probe-tested: an analytic fixture (synthetic input with a
known defect value) plus a planted perturbation (the defect stamped onto
the real target, which must move the ruler while the clean target stays
at reference). Probes run on every invocation; any probe failure aborts
before scoring. Results for target, groom5, groom6 -> E/rulers.json.

Masks: aisha-v3 mask-{front,three_quarter,profile,back}.png (the same
masks score6.py uses for IoU). IDs: fixed body-occluded alpha>=230.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E7 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E5 = ROOT / "tools/openclinxr/evidence/hair-groom5"
E6 = ROOT / "tools/openclinxr/evidence/hair-groom6"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")

VIEWS = ("front", "three_quarter", "profile_90", "back")
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}
BEAUTY = {"front": "target-front-a1.png",
          "three_quarter": "target-three_quarter-a1.png",
          "profile_90": "target-profile.png",
          "back": "target-back.png"}
IDDIR = {"groom5": E5 / "renders-studio", "groom6": E6 / "renders-studio",
         "groom7": E7 / "renders-studio"}
S5 = Path("/Volumes/files/src/openclinxr/.openclinxr/asset-production"
          "/hair-groom5/strands.npz")
S6 = E6 / "build" / "strands.npz"
S7 = E7 / "build" / "strands.npz"
SN = {"groom5": S5, "groom6": S6, "groom7": S7}
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"

opened: list[str] = []


def log_open(p) -> None:
    opened.append(str(Path(p).resolve()))


def load_mask(view: str) -> np.ndarray:
    p = SCR / MASKF[view]
    log_open(p)
    return np.array(Image.open(p)) > 127


def load_id(tag: str, view: str) -> np.ndarray:
    p = IDDIR[tag] / (view + "-id.png")
    log_open(p)
    return (np.array(Image.open(p).convert("RGBA"))[:, :, 3] >= 230)


def load_beauty(view: str, tag: str | None = None) -> np.ndarray:
    if tag is None:
        p = SCR / BEAUTY[view]
    else:
        p = IDDIR[tag].parent / "renders-studio" / (view + ".png")
    log_open(p)
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)


# ---------------------------------------------------------------- R-PROTRUDE
def protrude(ours: np.ndarray, tgt: np.ndarray) -> dict:
    """Connected components of (ours minus target) after a 3 px opening.

    Per component: area px + max distance outside the target contour
    (EDT of ~target), both plain JSON numbers (int / float, never
    null). Gate: no component with area > 150 px AND maxdist > 8 px.
    """
    diff = ours & ~tgt
    diff = ndimage.binary_opening(diff, structure=np.ones((3, 3)))
    edt = ndimage.distance_transform_edt(~tgt)
    lab, n = ndimage.label(diff)
    comps = []
    for i in range(1, n + 1):
        m = lab == i
        area = int(m.sum())
        md = round(float(edt[m].max()), 1) if area else 0.0
        ys, xs = np.nonzero(m)
        assert isinstance(area, int) and isinstance(md, float), (area, md)
        comps.append({"area": area, "maxDistPx": md,
                      "centroid": [round(float(ys.mean()), 1),
                                   round(float(xs.mean()), 1)],
                      "fail": bool(area > 150 and md > 8.0)})
    comps.sort(key=lambda c: -c["area"])
    fails = [c for c in comps if c["fail"]]
    return {"nComponents": int(n), "top": comps[:8],
            "nFail": int(len(fails)),
            "gatePass": not fails,
            "gate": "no component area>150px with maxDistPx>8px"}


def probe_protrude() -> dict:
    # Analytic fixture: 40x40 target box; 20x20 (=400px) flap square
    # placed 12 px outside the box edge. Must fire (area 400 > 150,
    # dist 12+ > 8).
    tgt = np.zeros((200, 200), dtype=bool)
    tgt[60:100, 60:100] = True
    ours = tgt.copy()
    ours[20:40, 65:85] = True  # 12+ px above the box top (row 60)
    r = protrude(ours, tgt)
    assert not r["gatePass"], "analytic flap must FAIL protrude, got %s" % r
    top = r["top"][0]
    assert top["area"] >= 300, top
    assert top["maxDistPx"] >= 10.0, top
    # Clean fixture: identical masks -> no components -> pass.
    r0 = protrude(tgt, tgt)
    assert r0["gatePass"] and r0["nComponents"] == 0, r0
    # Planted perturbation: stamp a 20x15 flap 12 px outside the real
    # front-target contour; the ruler must newly fail there.
    t = load_mask("front")
    ys, xs = np.nonzero(t)
    y0 = int(ys.min())
    band = np.nonzero(t[y0 + 5])[0]
    cx = int(xs.min() + (xs.max() - xs.min()) * 0.7)
    plant = t.copy()
    plant[max(y0 - 12 - 15, 0):max(y0 - 12, 0), cx:cx + 20] = True
    # keep only the planted bit outside the target (rows above y0 are
    # outside by construction at this column only if target absent
    # there; force-clean any overlap so the flap is isolated).
    plant = plant & ~t
    plant[:, :] = False
    plant[max(y0 - 27, 0):max(y0 - 12, 0), cx:cx + 20] = True
    rp = protrude(t | plant, t)
    assert not rp["gatePass"], "planted flap must FAIL protrude, got %s" % rp
    for c in rp["top"]:
        assert isinstance(c["area"], int) \
            and isinstance(c["maxDistPx"], float), c
        assert c["maxDistPx"] is not None and c["area"] is not None, c
    rc = protrude(t, t)
    assert rc["gatePass"], rc
    return {"analytic": "flap 400px@12px fails, clean passes",
            "planted": "front-target + 20x15 flap newly fails"}


# ---------------------------------------------------------------- R-HEMSTEP
def poly_runs(pts: np.ndarray) -> dict:
    """pts: (N,2) polyline in (x,y) px. Horizontal runs (|angle|<15deg,
    chained length > 6px) share of total length; vertical steps
    (|angle-90|<15deg, length > 6px) count."""
    d = np.diff(pts.astype(np.float64), axis=0)
    seglen = np.linalg.norm(d, axis=1)
    keep = seglen > 1e-9
    d, seglen = d[keep], seglen[keep]
    if not len(seglen):
        return {"lengthPx": 0.0, "horizFrac": 0.0, "steps": 0}
    ang = np.degrees(np.arctan2(np.abs(d[:, 1]), np.abs(d[:, 0])))
    horiz = ang < 15.0
    # chain consecutive horizontal segments, sum chained lengths
    hl = 0.0
    run = 0.0
    for h, L in zip(horiz, seglen):
        if h:
            run += L
        else:
            if run > 6.0:
                hl += run
            run = 0.0
    if run > 6.0:
        hl += run
    vert = (np.abs(ang - 90.0) < 15.0) & (seglen > 6.0)
    total = float(seglen.sum())
    return {"lengthPx": round(total, 1),
            "horizFrac": round(float(hl / total), 4),
            "steps": int(vert.sum())}


def hemstep_back(mask: np.ndarray) -> dict:
    """Back hem: bottom-most hair pixel per column (hemline), analysed
    where it lies in the lower 25% of the mask row range."""
    ys, xs = np.nonzero(mask)
    y0, y1 = int(ys.min()), int(ys.max())
    lo = y1 - 0.25 * (y1 - y0)
    cols = np.nonzero(mask.any(axis=0))[0]
    hx, hy = [], []
    for c in cols:
        rows = np.nonzero(mask[:, c])[0]
        b = int(rows.max())
        if b >= lo:
            hx.append(c)
            hy.append(b)
    pts = np.stack([np.array(hx), np.array(hy)], axis=1)
    return poly_runs(pts)


def hemstep_front(mask: np.ndarray) -> dict:
    """Front curtains: outer left/right edges over the lower 25% of the
    mask row range (shoulder height)."""
    ys, _ = np.nonzero(mask)
    y0, y1 = int(ys.min()), int(ys.max())
    lo = int(y1 - 0.25 * (y1 - y0))
    out = {}
    for side in ("left", "right"):
        ex, ey = [], []
        for r in range(lo, y1 + 1):
            row = np.nonzero(mask[r])[0]
            if not len(row):
                continue
            ex.append(int(row.min() if side == "left" else row.max()))
            ey.append(r)
        pts = np.stack([np.array(ex), np.array(ey)], axis=1)
        out[side] = poly_runs(pts)
    tot = out["left"]["lengthPx"] + out["right"]["lengthPx"]
    hl = (out["left"]["horizFrac"] * out["left"]["lengthPx"]
          + out["right"]["horizFrac"] * out["right"]["lengthPx"])
    return {"left": out["left"], "right": out["right"],
            "horizFrac": round(float(hl / max(tot, 1e-9)), 4),
            "steps": int(out["left"]["steps"] + out["right"]["steps"]),
            "lengthPx": round(tot, 1)}


def hemstep_gate(g: dict, t: dict) -> bool:
    hf = g["horizFrac"] <= max(1.5 * t["horizFrac"], t["horizFrac"] + 0.05)
    st = g["steps"] <= max(1.5 * t["steps"], t["steps"] + 3)
    return bool(hf and st)


def probe_hemstep() -> dict:
    # Analytic: staircase polyline (10px horizontal / 8px vertical
    # alternating) must read high horizFrac + steps; a straight
    # diagonal of the same extent must read ~0 steps.
    x, y = [0.0], [0.0]
    for _ in range(10):
        x.append(x[-1] + 10.0); y.append(y[-1])
        x.append(x[-1]); y.append(y[-1] + 8.0)
    stair = poly_runs(np.stack([np.array(x), np.array(y)], axis=1))
    assert stair["steps"] == 10, stair
    assert stair["horizFrac"] > 0.4, stair
    n = 50
    diag = poly_runs(np.stack(
        [np.linspace(0, 100, n), np.linspace(0, 100, n)], axis=1))
    assert diag["steps"] == 0, diag
    assert diag["horizFrac"] < 0.05, diag
    # Planted: stamp 8 staircase blocks onto the real back-target hem;
    # step count must jump vs the clean target.
    t = load_mask("back")
    ys, xs = np.nonzero(t)
    y1 = int(ys.max())
    plant = t.copy()
    x0 = int(xs.min() + (xs.max() - xs.min()) * 0.3)
    for i in range(8):
        c0 = x0 + i * 14
        plant[y1 - 8:y1 + 1, c0:c0 + 7] = False  # notch -> steps
    a = hemstep_back(t)
    b = hemstep_back(plant)
    assert b["steps"] > a["steps"], (a, b)
    return {"analytic": "staircase %s vs diagonal %s" % (stair, diag),
            "planted": "back-target notches steps %d -> %d"
                       % (a["steps"], b["steps"])}


# ---------------------------------------------------------------- R-GROOVE
# v2 (silhouette review: photometric sweeps showed band energy,
# valley fractions, gradient tails, spectral ratios and orientation
# coherence ALL read groom6 <= target in the crown -- the target's
# own painted streak texture dominates every such statistic, and
# the blocks are sparse raised ropes. The separator that survives
# is the fibre-to-block ratio R = E(2-6px) / E(15-40px) in the dome
# band (3q rows 150-330): fray tips + hard thin groove edges raise
# fine-scale energy relative to block scale. 3q dome: target 0.478,
# groom5 0.505, groom6 0.550. Gate R <= R_target + 0.05 (same
# absolute-floor form as the hemstep-frac gate).
DOME_ROWS = (150, 330)


def band_energies(beauty: np.ndarray, mask: np.ndarray,
                  rows=DOME_ROWS) -> dict:
    lum = (0.2126 * beauty[..., 0] + 0.7152 * beauty[..., 1]
           + 0.0722 * beauty[..., 2])
    band = np.zeros_like(mask)
    band[rows[0]:rows[1], :] = True
    m = band & mask
    e26 = float((((ndimage.gaussian_filter(lum, 2, mode="nearest")
                   - ndimage.gaussian_filter(lum, 6, mode="nearest"))
                  [m]) ** 2).mean()) if m.any() else 0.0
    e513 = float((((ndimage.gaussian_filter(lum, 5, mode="nearest")
                    - ndimage.gaussian_filter(lum, 13, mode="nearest"))
                   [m]) ** 2).mean()) if m.any() else 0.0
    return {"e26": e26, "e513": e513,
            "R": float(e26 / max(e513, 1e-12)), "nPx": int(m.sum())}


def groove(beauty: np.ndarray, mask: np.ndarray, view: str) -> dict:
    """Crown/top band (top 35% of mask rows) high-pass luminance energy
    at 15-40 px scale: bp = gauss(5) - gauss(13); energy = mean(bp^2)
    over band cap hair mask. Reports ratio-1.0 for the target itself;
    the caller forms groom/target ratios."""
    lum = (0.2126 * beauty[..., 0] + 0.7152 * beauty[..., 1]
           + 0.0722 * beauty[..., 2])
    ys, _ = np.nonzero(mask)
    y0, y1 = int(ys.min()), int(ys.max())
    band = np.zeros_like(mask)
    band[y0:int(y0 + 0.35 * (y1 - y0)), :] = True
    m = band & mask
    lo = ndimage.gaussian_filter(lum, 5, mode="nearest")
    hi = ndimage.gaussian_filter(lum, 13, mode="nearest")
    bp = lo - hi
    e = float((bp[m] ** 2).mean()) if m.any() else 0.0
    return {"energy": e, "nPx": int(m.sum())}


def groove_v2(beauty: np.ndarray, mask: np.ndarray, ref_R: float) -> dict:
    b = band_energies(beauty, mask)
    return {"R": round(b["R"], 4), "e26": round(b["e26"], 2),
            "e513": round(b["e513"], 2), "nPx": b["nPx"],
            "gatePass": bool(b["R"] <= ref_R + 0.05),
            "gate": "fibre-to-block R <= target R + 0.05 (dome rows %s)"
                    % (DOME_ROWS,)}


def probe_groove() -> dict:
    # Analytic: flat grey (R ~ 0.02, no structure) vs synthetic BLOCK
    # texture (24 px dark/light blocks + fine grain: block edges carry
    # fine-scale energy like fray/groove edges). Must separate 3x+.
    yy, xx = np.mgrid[0:200, 0:200]
    flat = np.stack([yy * 0 + 128.0] * 3, axis=2)
    blk = (np.indices((200, 200)).sum(axis=0) // 24) % 2
    blk = 128.0 + np.where(blk, 50.0, -50.0).astype(float)
    rng = np.random.RandomState(0)
    blk = blk + rng.randn(200, 200) * 6.0
    blkim = np.stack([blk] * 3, axis=2)
    m = np.ones((200, 200), dtype=bool)
    r0 = band_energies(flat, m, rows=(0, 200))["R"]
    r1 = band_energies(blkim, m, rows=(0, 200))["R"]
    assert r1 > 3.0 * max(r0, 1e-9), (r0, r1)
    # Planted: stamp BLOCKS (12 dark bars 10x70, -80 lum) onto the
    # real 3q target dome; R must cross target R + 0.05 while the
    # clean target stays at reference.
    b = load_beauty("three_quarter")
    t = load_mask("three_quarter")
    e0 = band_energies(b, t)["R"]
    b2 = b.copy()
    prng = np.random.RandomState(3)
    for _ in range(12):
        r = int(prng.randint(160, 280))
        c = int(prng.randint(300, 700))
        b2[r:r + 70, c:c + 10] = np.clip(
            b2[r:r + 70, c:c + 10] - 80.0, 0, 255)
    e1 = band_energies(b2, t)["R"]
    assert e1 > e0 + 0.05, (e0, e1)
    return {"analytic": "flat R=%.4f vs blocks R=%.4f" % (r0, r1),
            "planted": "3q-target blocks R %.4f -> %.4f (gate %.4f)"
                       % (e0, e1, e0 + 0.05)}


# ---------------------------------------------------------------- R-LOOP
def loop_strands(pts_mm: np.ndarray, z_ear_mm: float,
                 radii: np.ndarray | None = None) -> dict:
    """pts_mm: (N,P,3) strand polylines in mm (x lateral, y posterior,
    z up). Counts strands whose tangent turns > 120 deg within any
    60 mm arc window, plus strands running horizontal (|dz| < 0.2 of
    arc) for > 40 mm continuously above the ear line (z > z_ear).
    Only counts strands with a VISIBLE sample (radii > 1e-6) inside
    the event window: fully-trimmed strands (concha/hem/lobe trims)
    are invisible and cannot read as loops/bands ("0 visible").
    Gate: 0."""
    seg = np.diff(pts_mm.astype(np.float64), axis=1)
    seglen = np.linalg.norm(seg, axis=2, keepdims=True) + 1e-12
    arc = np.concatenate([np.zeros((len(pts_mm), 1)),
                          np.cumsum(seglen.squeeze(-1), axis=1)], axis=1)
    total = arc[:, -1]
    u = seg / seglen
    n, P = pts_mm.shape[0], pts_mm.shape[1]
    if radii is None:
        radii = np.ones((n, P), dtype=np.float64)
    else:
        radii = np.asarray(radii, dtype=np.float64)
    # net direction change over 60 mm windows: compare segment
    # tangents straddling each window (vectorised over starts).
    turn_bad = np.zeros(n, dtype=bool)
    for a in range(P - 1):
        # end index with arc >= arc[:,a] + 60
        tgt = arc[:, a, None] + 60.0
        b = np.argmax(arc >= tgt, axis=1)
        ok = arc[np.arange(n), b] >= tgt[:, 0] - 1e-9
        ok &= b > a
        if not ok.any():
            continue
        rows = np.nonzero(ok)[0]
        d = (u[rows, a, :] * u[rows, b[rows] - 1, :]).sum(axis=1)
        d = np.clip(d, -1.0, 1.0)
        hot = rows[np.degrees(np.arccos(d)) > 120.0]
        if not len(hot):
            continue
        # visible iff a sample in the MIDDLE third of the event
        # window renders (radii > 1e-6): a buried kink with a visible
        # tail elsewhere (e.g. wrap-marched strands behind the ear
        # whose drape below shows) is not a visible loop.
        blo = np.minimum(b[hot] - 1, P - 1)
        m0 = np.clip(a + (blo - a) // 3, 0, P - 1)
        m1 = np.clip(a + 2 * (blo - a) // 3 + 1, 0, P - 1)
        vis = np.array([radii[h, m0[k]:m1[k] + 1].max() > 1e-6
                        for k, h in enumerate(hot)])
        turn_bad[hot[vis]] = True
    # horizontal runs above the ear line: sliding 40 mm windows with
    # |dz| < 8 mm, strand z-max above the ear line. Visibility-gated
    # like turns. Diagnostic only (sleek crown flow legitimately
    # runs horizontal over the dome, so this clause cannot gate at
    # zero; the visible loop/band defect is the turn count).
    horiz_bad = np.zeros(n, dtype=bool)
    zmax = pts_mm[:, :, 2].max(axis=1)
    cand = zmax > z_ear_mm
    for a in range(P - 1):
        tgt = arc[:, a, None] + 40.0
        b = np.argmax(arc >= tgt, axis=1)
        ok = cand & (b > a) & (arc[np.arange(n), b] >= tgt[:, 0] - 1e-9)
        if not ok.any():
            continue
        rows = np.nonzero(ok)[0]
        dz = np.abs(pts_mm[rows, b[rows] - 1, 2] - pts_mm[rows, a, 2])
        hot = rows[dz < 8.0]
        if not len(hot):
            continue
        blo = np.minimum(b[hot] - 1, P - 1)
        m0 = np.clip(a + (blo - a) // 3, 0, P - 1)
        m1 = np.clip(a + 2 * (blo - a) // 3 + 1, 0, P - 1)
        vis = np.array([radii[h, m0[k]:m1[k] + 1].max() > 1e-6
                        for k, h in enumerate(hot)])
        horiz_bad[hot[vis]] = True
    bad = turn_bad | horiz_bad
    idx = np.nonzero(turn_bad)[0]
    return {"nTurn": int(turn_bad.sum()), "nHoriz": int(horiz_bad.sum()),
            "nLoop": int(bad.sum()), "frac": round(float(bad.mean()), 5),
            "gatePass": bool(turn_bad.sum() == 0),
            "gate": "0 visible strands turning >120deg in 60mm "
                    "(nHoriz diagnostic: crown flow runs horizontal)",
            "exLenMm": [round(float(total[i]), 1)
                        for i in idx[:10].tolist()]}


CAMERAS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"


def load_cams() -> dict:
    import json as _js
    log_open(CAMERAS)
    cams = _js.loads(CAMERAS.read_text())
    sensor = float(cams["sensorWidthMm"])
    proj = {}
    for v in ("front", "three_quarter", "profile_90", "back"):
        m = np.array(cams["views"][v]["matrixWorld"], dtype=np.float64)
        proj[v] = (np.linalg.inv(m),
                   float(cams["views"][v]["lensMm"]) / sensor * 1024.0)
    return proj


def wrap_boxes_mm() -> list:
    """Ear-wrap zone boxes (x, z, mm) per side, same definition as the
    children.py wrap march: |x-xEar| < 25, z in [zMin-100, zMin+20]."""
    pin = np.load(PINNA, allow_pickle=True)
    xyz = np.asarray(pin["xyz"], dtype=np.float64) * 1000.0
    boxes = []
    for key in ("idx_earXpos", "idx_earXneg"):
        pv = xyz[np.asarray(pin[key])]
        boxes.append({"xEar": float(np.median(pv[:, 0])),
                      "zMin": float(pv[:, 2].min())})
    return boxes


def in_wrap(x_mm: float, z_mm: float, boxes: list) -> bool:
    return any(abs(x_mm - b["xEar"]) < 25.0
               and b["zMin"] - 100.0 <= z_mm <= b["zMin"] + 20.0
               for b in boxes)


def profile_ear_top_row(proj) -> float:
    pin = np.load(PINNA, allow_pickle=True)
    xyz = np.asarray(pin["xyz"], dtype=np.float64)
    idx = np.concatenate([np.asarray(pin["idx_earXpos"]),
                          np.asarray(pin["idx_earXneg"])])
    pv = xyz[idx]
    inv, f = proj["profile_90"]
    hw = np.ones((len(pv), 4))
    hw[:, :3] = pv
    lc = (inv @ hw.T).T
    dep = -lc[:, 2]
    rr = 512.0 - (lc[dep > 0, 1] / dep[dep > 0]) * f
    return float(rr.min())


def turn_events(pts_mm: np.ndarray,
               radii: np.ndarray) -> list:
    """All turn events (net tangent turn > 120 deg in 60 mm) with a
    visible middle third. Returns (strand, a, bb, apex_xyz_mm)."""
    seg = np.diff(pts_mm.astype(np.float64), axis=1)
    seglen = np.linalg.norm(seg, axis=2, keepdims=True) + 1e-12
    arc = np.concatenate([np.zeros((len(pts_mm), 1)),
                          np.cumsum(seglen.squeeze(-1), axis=1)], axis=1)
    u = seg / seglen
    n, P = pts_mm.shape[0], pts_mm.shape[1]
    ev = []
    for a in range(P - 1):
        tgt = arc[:, a, None] + 60.0
        b = np.argmax(arc >= tgt, axis=1)
        ok = arc[np.arange(n), b] >= tgt[:, 0] - 1e-9
        ok &= b > a
        if not ok.any():
            continue
        rows = np.nonzero(ok)[0]
        d = (u[rows, a, :] * u[rows, b[rows] - 1, :]).sum(axis=1)
        d = np.clip(d, -1.0, 1.0)
        hot = rows[np.degrees(np.arccos(d)) > 120.0]
        if not len(hot):
            continue
        blo = np.minimum(b[hot] - 1, P - 1)
        for k, h in enumerate(hot):
            bb = int(blo[k])
            m0 = max(a + (bb - a) // 3, 0)
            m1 = min(a + 2 * (bb - a) // 3 + 1, P - 1)
            if radii[h, m0:m1 + 1].max() <= 1e-6:
                continue
            w = pts_mm[h, a:bb + 1]
            chord = w[-1] - w[0]
            cl = float(np.linalg.norm(chord)) + 1e-9
            dev = np.linalg.norm(
                (w - w[0]) - np.outer((w - w[0]) @ chord / cl ** 2 * cl,
                                      chord / cl), axis=1)
            apex = w[int(np.argmax(dev))]
            ev.append((int(h), int(a), bb,
                       [float(apex[0]), float(apex[1]), float(apex[2])]))
    return ev


def loop_profile(pts_mm: np.ndarray, radii: np.ndarray, z_ear_mm: float,
                 proj, boxes: list, ear_top_row: float) -> dict:
    """R-LOOP profile gate: turn-event strands whose event apex is
    VISIBLE in profile above the ear line and OUTSIDE the ear-wrap
    zone (the legitimate tuck wrap behind the ear + normal crown
    curvature never turn 120 deg in 60 mm). Gate: 0."""
    inv, f = proj["profile_90"]
    ev = turn_events(pts_mm, radii)
    counted: dict[int, list] = {}
    wrap_n = 0
    for h, a, bb, apex in ev:
        if apex[2] <= z_ear_mm:
            continue
        if in_wrap(apex[0], apex[2], boxes):
            wrap_n += 1
            continue
        hw = np.ones(4)
        hw[:3] = np.array(apex) / 1000.0
        lc = inv @ hw
        dep = -lc[2]
        if dep <= 0:
            continue
        cc = 512.0 + (lc[0] / dep) * f
        rr = 512.0 - (lc[1] / dep) * f
        if not (0 <= cc < 1024 and 0 <= rr < 1024):
            continue
        if rr >= ear_top_row:
            continue
        counted.setdefault(h, []).append([round(float(cc), 1),
                                          round(float(rr), 1)])
    ids = sorted(counted)
    return {"nProfile": int(len(ids)),
            "nWrapExcluded": int(wrap_n),
            "nEvents": int(len(ev)),
            "gatePass": not ids,
            "gate": "0 turn-event strands visible in profile above "
                    "the ear line outside the wrap zone",
            "strandIds": ids[:50],
            "apexPx": {str(h): counted[h][0] for h in ids[:5000]}}


def draw_overlay(beauty_path: Path, out_path: Path, apex_px: dict,
                 title: str) -> int:
    from PIL import ImageDraw
    im = Image.open(beauty_path).convert("RGB")
    log_open(beauty_path)
    dr = ImageDraw.Draw(im)
    for h, (cc, rr) in apex_px.items():
        dr.ellipse([cc - 3, rr - 3, cc + 3, rr + 3],
                   outline=(255, 30, 30), width=2)
    im.save(out_path)
    log_open(out_path)
    return len(apex_px)


def probe_loop(z_ear_mm: float) -> dict:
    # Analytic: a 180-degree hairpin (out 40 mm, back 40 mm) must fire;
    # a straight 200 mm strand must pass.
    P = 32
    pin = np.zeros((1, P, 3))
    pin[0, :, 0] = np.concatenate([np.linspace(0, 40, 16),
                                   np.linspace(40, 0, 16)])
    pin[0, :, 2] = z_ear_mm + 50.0
    r = loop_strands(pin, z_ear_mm)
    assert not r["gatePass"] and r["nTurn"] == 1, r
    st = np.zeros((1, P, 3))
    st[0, :, 2] = (z_ear_mm + 250.0) - np.linspace(0, 200, P)
    st[0, :, 1] = np.linspace(0, 20, P)
    r0 = loop_strands(st, z_ear_mm)
    assert r0["gatePass"], r0
    # Planted: 50 hairpins appended to straight strands must count 50.
    many = np.repeat(st, 60, axis=0)
    many[:50] = pin
    r1 = loop_strands(many, z_ear_mm)
    assert r1["nTurn"] == 50 and not r1["gatePass"], r1
    # Visibility probe: a hairpin with all radii trimmed is invisible
    # and must NOT count ("0 visible").
    r2 = loop_strands(pin, z_ear_mm, radii=np.zeros((1, P)))
    assert r2["nTurn"] == 0 and r2["gatePass"], r2
    # Profile-gate probes (real profile camera + wrap boxes): a crown
    # hairpin above the ear line outside the wrap zone counts and
    # projects in-frame above the ear top; a wrap-zone hairpin is
    # excluded by zone (not by depth).
    proj = load_cams()
    boxes = wrap_boxes_mm()
    ear_top = profile_ear_top_row(proj)
    assert 200.0 < ear_top < 600.0, ear_top
    rad1 = np.ones((1, P))
    crown = pin.copy()
    crown[0, :, 1] = 20.0
    crown[0, :, 2] = z_ear_mm + 120.0
    lp = loop_profile(crown, rad1, z_ear_mm, proj, boxes, ear_top)
    assert lp["nProfile"] == 1 and not lp["gatePass"], lp
    assert len(lp["apexPx"]) == 1, lp
    zm = boxes[0]["zMin"]
    wrap = np.zeros((1, P, 3))
    wrap[0, :, 0] = boxes[0]["xEar"]
    wrap[0, :, 1] = -50.0
    wrap[0, :, 2] = (zm - 30.0) + np.concatenate(
        [np.linspace(0, 40, 16), np.linspace(40, 0, 16)])
    lw = loop_profile(wrap, rad1, z_ear_mm, proj, boxes, ear_top)
    assert lw["nProfile"] == 0 and lw["gatePass"], lw
    assert lw["nWrapExcluded"] >= 1, lw
    return {"analytic": "hairpin fires (nTurn=1), straight passes",
            "planted": "50 hairpins in 60 strands count 50; "
                       "fully-trimmed hairpin counts 0",
            "profile": "crown hairpin counts+projects above ear top; "
                       "wrap-zone/below-ear hairpins excluded"}


# ---------------------------------------------------------------- main
def main() -> None:
    t0 = time.time()
    pin = np.load(PINNA, allow_pickle=True)
    log_open(PINNA)
    ear_idx = np.concatenate([np.asarray(pin["idx_earXpos"]),
                              np.asarray(pin["idx_earXneg"])])
    z_ear_mm = float(np.asarray(pin["xyz"], dtype=np.float64)[ear_idx, 2]
                     .min() * 1000.0)
    print("ear line z_mm=%.1f" % z_ear_mm, flush=True)

    probes = {"protrude": probe_protrude(), "hemstep": probe_hemstep(),
              "groove": probe_groove(), "loop": probe_loop(z_ear_mm)}
    print("PROBES PASS %s" % json.dumps(probes), flush=True)

    out: dict = {"probes": probes, "rulers": {},
                 "registration": "skull (same masks/cameras as score6)",
                 "idThreshold": 230}
    masks = {v: load_mask(v) for v in VIEWS}

    # target self-reads (reference values)
    out["rulers"]["target"] = {}
    for v in VIEWS:
        out["rulers"]["target"][v] = {"protrude": protrude(masks[v],
                                                           masks[v])}
    out["rulers"]["target"]["back"]["hemstep"] = hemstep_back(masks["back"])
    out["rulers"]["target"]["front"]["hemstep"] = hemstep_front(
        masks["front"])
    for v in ("three_quarter", "profile_90"):
        out["rulers"]["target"][v]["groove"] = groove(
            load_beauty(v), masks[v], v)
        out["rulers"]["target"][v]["grooveV2"] = band_energies(
            load_beauty(v), masks[v])
    proj = load_cams()
    boxes = wrap_boxes_mm()
    ear_top = profile_ear_top_row(proj)
    print("profile ear top row=%.0f wrap=%s" % (ear_top, boxes), flush=True)

    for tag in ("groom5", "groom6", "groom7"):
        g: dict = {}
        for v in VIEWS:
            ours = load_id(tag, v)
            g[v] = {"protrude": protrude(ours, masks[v])}
        g["back"]["hemstep"] = hemstep_back(load_id(tag, "back"))
        g["front"]["hemstep"] = hemstep_front(load_id(tag, "front"))
        t_b, t_f = (out["rulers"]["target"]["back"]["hemstep"],
                    out["rulers"]["target"]["front"]["hemstep"])
        g["back"]["hemstep"]["gatePass"] = hemstep_gate(
            g["back"]["hemstep"], t_b)
        g["front"]["hemstep"]["gatePass"] = hemstep_gate(
            g["front"]["hemstep"], t_f)
        for v in ("three_quarter", "profile_90"):
            e = groove(load_beauty(v, tag), load_id(tag, v), v)["energy"]
            et = out["rulers"]["target"][v]["groove"]["energy"]
            ref_R = out["rulers"]["target"][v]["grooveV2"]["R"]
            g[v]["groove"] = {"energy": e,
                              "ratio": round(float(e / max(et, 1e-12)), 3),
                              "note": "v1 energy (insensitive to sparse "
                                      "loops; kept as regression guard)"}
            g[v]["grooveV2"] = groove_v2(load_beauty(v, tag),
                                         load_id(tag, v), ref_R)
        pts = np.asarray(np.load(SN[tag], allow_pickle=True)["points"],
                         dtype=np.float64) * 1000.0
        rad = np.asarray(np.load(SN[tag], allow_pickle=True)["radii"],
                         dtype=np.float64)
        log_open(SN[tag])
        g["geometry"] = {"loop": loop_strands(pts, z_ear_mm, rad)}
        lp = loop_profile(pts, rad, z_ear_mm, proj, boxes, ear_top)
        g["geometry"]["loopProfile"] = {
            k: v for k, v in lp.items() if k != "apexPx"}
        nmarks = draw_overlay(
            IDDIR[tag] / "profile_90.png",
            E7 / ("loop-overlay-%s.png" % tag), lp["apexPx"], tag)
        g["geometry"]["loopProfile"]["overlayMarks"] = nmarks
        g["geometry"]["loopProfile"]["overlay"] = \
            "loop-overlay-%s.png" % tag
        out["rulers"][tag] = g
        print("RULER %s protrude=%s hemstep=%s/%s grooveV2=%s/%s loopProf=%s"
              % (tag,
                 {v: (g[v]["protrude"]["nFail"],
                      [(c["area"], c["maxDistPx"],
                        c["centroid"]) for c in
                       g[v]["protrude"]["top"][:3]]) for v in VIEWS},
                 g["back"]["hemstep"], g["front"]["hemstep"],
                 g["three_quarter"]["grooveV2"],
                 g["profile_90"]["grooveV2"],
                 g["geometry"]["loopProfile"]), flush=True)

    import shutil
    shutil.copy(E7 / "loop-overlay-groom6.png", E7 / "loop-overlay.png")
    (E7 / "rulers.json").write_text(json.dumps(out, indent=1) + "\n")
    (E7 / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(opened))) + "\n")
    print("rulers done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
