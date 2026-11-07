#!/usr/bin/env python3
"""Hair rulers v4b: v4a (R1/R4/R5, frozen) + one registration contract (FIX A),
R4 translucency (FIX B), and new rulers R2 root setback, R6 shoulder-relative
posterior gap, R3 hairline.

FIX A -- one registration: v4a used the judge's RAW triples everywhere (front
scale 1.0021); the scorer's orientation (score.json) uses SKULL mode for the
front view (+10 mm hair-over-skull offset on the target crown, front scale
0.9545) and raw triples for profile/back (score.json profile 1.0512/back
1.0403 are bit-identical to raw). Two registrations in one battery is a
defect. v4b adds `--registration raw|skull` (default skull, matching the
station/scorer alignment). R1/R5 run under both; the delta per row is
reported; the skull mode reproduces all three score.json orientation
transforms within 1e-6 (front exactly, profile/back by sharing the raw
triple). v4a probes are kept verbatim under raw (frozen).

FIX B -- R4 translucency: coverage is now reported at alpha >= 30/128/230
(128 was the only v4a number) plus a beauty-based skin-visible fraction
inside the pinna region: pixels whose beauty RGB is closer (L1) to the body
skin reference than to the hair reference (both references stated per
subject). Target has no beauty render, so the skin fraction is ours-only and
R4 stays ADVISORY.

R2 root setback (geometry; target N/A; HARD_GATE for the station): cap npz +
strands npz in; front boundary = cap mesh boundary verts (edges used by
exactly one face) with y < -0.120 m (crown4 write_diagnosis.py rule: front
arc; anterior is -y); zones midline |x|<=0.01 m, temples per side
0.01<|x|<=0.045 m. Per zone: boundary-to-nearest-root xy distance p50/p95/max
(mm) + capFrontYmm/firstRootYmm/gapMm per x-band (crown4 diagnosis-A method).
Parity: same spread.npz roots as crown4, so the midline firstRootYmm must
reproduce crown4's -121.9 mm within 1 mm; the capFrontYmm half is recorded as
a validation finding because cap-v8's front edge (-121.8 mm midline) is a
different cap file from crown4's crown3 cap_live (-148.2 mm), 26.4 mm apart by
construction, not by method drift. Also run: cap-v7 + hem2 c_curve strands
(current groom lineage) and cap-v7 + hem1 c_best8 strands (previous).

R6 shoulder-relative posterior gap: shoulder plane z=1.405 m (judge rule in
hair-curtain3/landmarks.json); its profile render-frame row is the projected
back_shoulder row 650.73 (curtain3 landmarks.json views.profile_90), mapped
through the profile registration into the target frame. Body silhouette =
non-background (|RGB - bg|>30, bg = per-image corner median) AND ID alpha<30
(not hair). Posterior = +column in profile. gap(row) = hair_posterior_col -
body_posterior_col (px and local mm); + = hair extends behind the body.
Rows: shoulder-plane row (common) and each subject's own hem row (bottom hair
row, registered frame). Target hair vs current body (target has no body
photo; stated assumption; same head/body). Plant: shift hair mask 20 px
posterior -> gap rises 20 px. Monotonicity 10/20/30 px.

R3 hairline (image): frontal hairline = lower hair-mask boundary (alpha>=128)
inside a brow-to-crown ROI, excluding face-side silhouette/curtain edges
(publish ROI + polyline overlay; columns with no clean lower boundary are
UNOBSERVED, never zero error). ROI rows: render-frame projected brow/crown
(front 269.13/102.77, curtain3) mapped into the target frame by the front
registration; column bands around the target centre (513): midline +-50 px,
brow 50-130 px, temple 130-200 px per side. A column is OBSERVED iff hair
exists in the band, its lowest hair row is above the brow row, and no hair
sits between that row and the brow row (curtain columns fail this and are
UNOBSERVED). Signed contour distance ours-target per ROI: + = ours hairline
lower (larger row). Front: ours vs registered target; three_quarter: ours
only (ROI rows/cols from projecting brow/crown/face-centre world points
through each subject's own three_quarter camera). No cusp/tab counts. Plant:
move the current hairline polyline 12 px up -> median distance changes
12 +- 1 px. Monotonicity 6/12/18 px.

CLI:
  rulers_v4.py --fixture-manifest <json> [--registration raw|skull]
    --subject <name> --out <json> [--probes-out <json>] [--overlay-out <png>]
    [--reg-compare-out <json>] [--battery-out <dir>]
  subject = target | current | previous. Only numpy + Pillow. Never imports
  hair-score/score.py (bpy at load).
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024

# Render triples from hair-curtain3/landmarks.json judge block (projected
# menton/crown; profile forehead col 209).
RENDER_TRIPLE = {
    "front": (103.0, 583.0, 512.0),
    "profile_90": (131.0, 561.0, 209.0),
    "back": (155.0, 651.0, 512.0),
}
# Raw target triples from target-set-back/landmarks.json (NO skull offset).
TARGET_TRIPLE_RAW = {
    "front": (127.0, 608.0, 513.0),
    "profile_90": (125.0, 577.0, 344.0),
    "back": (130.0, 646.0, 513.0),
}
# FIX A: skull-mode target triples. judge.judge() in skull mode adds
# offset_px = target_hair_offset_mm * H_hair_t / H_skull_mm to the target HAIR
# crown (front: 10 * 481 / 210.65914630889893). The scorer applies the offset
# to the FRONT view only: score.json profile/back transforms are bit-identical
# to raw registration, so skull mode keeps profile/back raw.
SKULL_H_MM = 210.65914630889893  # hair-judge landmarks-canonical.json H_mm
_FRONT_RAW_H = 608.0 - 127.0
SKULL_OFFSET_PX = 10.0 * _FRONT_RAW_H / SKULL_H_MM  # 22.833...
_FRONT_OFFSET_PX = SKULL_OFFSET_PX  # same +10 mm hair-over-skull offset
MM_PER_PX = SKULL_H_MM / (_FRONT_RAW_H - _FRONT_OFFSET_PX)
TARGET_TRIPLE_SKULL = {
    "front": (127.0 + SKULL_OFFSET_PX, 608.0, 513.0),
    "profile_90": (125.0, 577.0, 344.0),
    "back": (130.0, 646.0, 513.0),
}


def target_triple_for(view: str, reg_mode: str):
    if reg_mode == "skull":
        return TARGET_TRIPLE_SKULL[view]
    if reg_mode == "raw":
        return TARGET_TRIPLE_RAW[view]
    raise ValueError(f"registration must be raw|skull, got {reg_mode}")
TARGET_CHIN = {"front": 608, "profile_90": 577, "back": 611}  # back: chin-equiv
BACK_CHIN_EQUIV_SRC = "target-set-back landmarks.json targets_v5.back_chin_equiv_row"
TARGET_MASK_KEY = {"front": "target_front_mask", "profile_90": "target_profile_mask",
                   "back": "target_back_mask"}

LENS_MM = 50.0
SENSOR_MM = 36.0  # Blender default sensor width; square frame -> fit horizontal
FOCAL_PX = LENS_MM * SIZE / SENSOR_MM

REPO = Path(__file__).resolve().parents[4]  # tools/openclinxr/evidence/hair-score -> repo


# ---------------------------------------------------------------- manifest/io

def sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve(manifest: dict, key: str) -> Path:
    p = manifest["files"][key]["path"]
    full = Path(p) if os.path.isabs(p) else (REPO / p)
    want = manifest["files"][key]["sha256"]
    got = sha256(full)
    if got != want:
        raise SystemExit(f"sha256 mismatch for {key}: want {want[:12]} got {got[:12]} ({full})")
    return full


def load_hair_judge(manifest: dict):
    hj_path = resolve(manifest, "hair_judge")
    spec = importlib.util.spec_from_file_location("hair_judge_v4a", str(hj_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_bool_mask(path: Path, is_id: bool, thresh: int = 230) -> np.ndarray:
    """Hair bool mask at 1024. ID passes: alpha>=thresh (R1/R5: 230 =
    judge load_mask 'alpha>=0.9' encoding; R4: 128 per brief). Targets: L>127."""
    im = Image.open(path)
    if is_id and im.mode == "RGBA":
        a = np.array(im)[:, :, 3]
        m = a >= thresh
    else:
        m = np.array(im.convert("L")) > 127
    if m.shape != (SIZE, SIZE):
        m = np.array(Image.fromarray((m.astype(np.uint8) * 255)).resize(
            (SIZE, SIZE), Image.NEAREST)) > 127
    return m


def subject_id_paths(manifest: dict, subject: str) -> dict:
    if subject == "target":
        return {v: resolve(manifest, TARGET_MASK_KEY[v]) for v in
                ("front", "profile_90", "back")}
    return {v: resolve(manifest, f"{subject}_{v}_id") for v in
            ("front", "profile_90", "back", "three_quarter")}


# ---------------------------------------------------------------- registration

def register(mask: np.ndarray, view: str, hj, render_triple=None, target_triple=None,
             reg_mode: str = "raw"):
    a_r, b_r, c_r = render_triple or RENDER_TRIPLE[view]
    if target_triple is None:
        a_t, b_t, c_t = TARGET_TRIPLE_SKULL[view] if reg_mode == "skull" \
            else TARGET_TRIPLE_RAW[view]
    else:
        a_t, b_t, c_t = target_triple
    m_t, _, tr = hj.register_view(mask, None, a_r, b_r, c_r, a_t, b_t, c_t)
    return m_t, {"scale": float(tr["scale"]), "tx": float(tr["tx"]), "ty": float(tr["ty"])}


# ---------------------------------------------------------------- R1 regional

def contour_pts(mask: np.ndarray) -> np.ndarray:
    er = np.array(Image.fromarray((mask.astype(np.uint8) * 255)).filter(
        ImageFilter.MinFilter(3))) > 127
    c = mask & ~er
    return np.argwhere(c)  # (row, col)


def nearest_signed(ours_pts: np.ndarray, tgt_pts: np.ndarray,
                   tgt_mask: np.ndarray) -> np.ndarray:
    """Signed Euclidean distance ours->target; + = ours outside target hair."""
    if len(ours_pts) == 0 or len(tgt_pts) == 0:
        return np.full(len(ours_pts), np.nan)
    dmin = np.empty(len(ours_pts))
    for i in range(0, len(ours_pts), 512):
        blk = ours_pts[i:i + 512].astype(float)
        d2 = ((blk[:, None, :] - tgt_pts[None, :, :].astype(float)) ** 2).sum(-1)
        dmin[i:i + 512] = np.sqrt(d2.min(1))
    inside = tgt_mask[ours_pts[:, 0].clip(0, SIZE - 1), ours_pts[:, 1].clip(0, SIZE - 1)]
    return np.where(inside, -dmin, dmin)


def r1_region_stats(ours_reg: np.ndarray, tgt: np.ndarray, chin: int) -> dict:
    rows = np.arange(SIZE)
    out = {}
    for region, sel in (("above", rows < chin), ("below", rows >= chin)):
        o, t = ours_reg[sel, :], tgt[sel, :]
        inter = float(np.logical_and(o, t).sum())
        union = float(np.logical_or(o, t).sum())
        iou = float(inter / union) if union > 0 else 1.0
        oc = contour_pts(ours_reg & sel[:, None])
        tc = contour_pts(tgt & sel[:, None])
        sd = nearest_signed(oc, tc, tgt)
        valid = sd[~np.isnan(sd)]
        if len(valid):
            p50, p95s, p95a = (float(np.median(valid)),
                               float(np.percentile(valid, 95)),
                               float(np.percentile(np.abs(valid), 95)))
        else:
            p50 = p95s = p95a = float("nan")
        out[region] = {
            "iou": round(iou, 4),
            "nOursContour": int(len(oc)), "nTgtContour": int(len(tc)),
            "signedP50px": round(p50, 2), "signedP95px": round(p95s, 2),
            "absP95px": round(p95a, 2),
            "signedP50mm": round(p50 * MM_PER_PX, 3),
            "signedP95mm": round(p95s * MM_PER_PX, 3),
            "absP95mm": round(p95a * MM_PER_PX, 3),
        }
    return out


def r1_view(ours_render: np.ndarray, tgt: np.ndarray, view: str, hj,
            render_triple=None, reg_mode: str = "raw") -> dict:
    reg, tr = register(ours_render, view, hj, render_triple, None, reg_mode)
    stats = r1_region_stats(reg, tgt, TARGET_CHIN[view])
    return {"transform": tr, "chinRow": TARGET_CHIN[view], **stats,
            "_reg": reg}


# ---------------------------------------------------------------- R4 ear coverage

def project_cam(world: np.ndarray, mw: np.ndarray) -> tuple[float, float]:
    w = np.append(np.asarray(world, dtype=float), 1.0)
    cam = np.linalg.inv(np.asarray(mw, dtype=float)) @ w
    x, y, z = cam[0], cam[1], cam[2]
    return (SIZE / 2 + FOCAL_PX * (x / -z), SIZE / 2 - FOCAL_PX * (y / -z))


def convex_hull(points: np.ndarray) -> np.ndarray:
    pts = sorted(set(map(tuple, np.asarray(points, dtype=float))))
    if len(pts) <= 1:
        return np.array(pts)
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return np.array(lo[:-1] + hi[:-1])


def region_from_points(pts2d: np.ndarray, dilate_px: int = 8) -> np.ndarray:
    hull = convex_hull(pts2d)
    img = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(img).polygon([tuple(map(float, p)) for p in hull], fill=255)
    img = img.filter(ImageFilter.MaxFilter(dilate_px * 2 + 1))
    return np.array(img) > 127


def pinna_points(cap) -> np.ndarray:
    col = [np.asarray(cap["pset"]).reshape(-1, 3)]
    for k in ("pinna_front_L", "pinna_front_R", "pinna_top_L", "pinna_top_R",
              "pinna_lobe_L", "pinna_lobe_R"):
        if k in cap:
            col.append(np.asarray(cap[k]).reshape(-1, 3))
    return np.vstack(col)


def r4_view(hair_render: np.ndarray, mw, pts3d: np.ndarray,
            tgt_mask=None, transform=None) -> dict:
    proj = np.array([project_cam(p, mw) for p in pts3d])
    region = region_from_points(proj)
    cov = float((hair_render & region).sum() / max(int(region.sum()), 1))
    out = {"coverage": round(cov, 4), "nRegionPx": int(region.sum()),
           "nProjPts": int(len(proj)),
           "projBBox": [round(float(proj[:, 0].min()), 1), round(float(proj[:, 1].min()), 1),
                        round(float(proj[:, 0].max()), 1), round(float(proj[:, 1].max()), 1)],
           "_region": region}
    if tgt_mask is not None and transform is not None:
        s, tx, ty = transform["scale"], transform["tx"], transform["ty"]
        mapped = np.stack([s * proj[:, 0] + tx, s * proj[:, 1] + ty], 1)
        mapped[:, 0] = mapped[:, 0].clip(0, SIZE - 1)
        mapped[:, 1] = mapped[:, 1].clip(0, SIZE - 1)
        treg = region_from_points(mapped)
        tcov = float((tgt_mask & treg).sum() / max(int(treg.sum()), 1))
        out["targetCoverage"] = round(tcov, 4)
        out["nTgtRegionPx"] = int(treg.sum())
        out["_tregion"] = treg
    return out


# ---------------------------------------------------------------- R5 hem

def y_bottom(mask: np.ndarray) -> np.ndarray:
    yb = np.full(SIZE, -1, dtype=int)
    cols = np.where(mask.any(axis=0))[0]
    for x in cols:
        yb[x] = int(np.where(mask[:, x])[0].max())
    return yb


def r5_view(ours_reg: np.ndarray, tgt: np.ndarray) -> dict:
    rows_t = np.where(tgt.any(axis=1))[0]
    y_top, y_bot = int(rows_t.min()), int(rows_t.max())
    lo = int(round(y_top + 0.6 * (y_bot - y_top)))
    yb_o, yb_t = y_bottom(ours_reg), y_bottom(tgt)
    hem_t = (yb_t >= 0) & (yb_t >= lo)
    hem_both = hem_t & (yb_o >= 0)
    mae_y = (float(np.abs(yb_o[hem_both].astype(float) - yb_t[hem_both].astype(float)).mean())
             if hem_both.sum() else float("nan"))
    w_o = ours_reg[lo:, :].sum(axis=1).astype(float)
    w_t = tgt[lo:, :].sum(axis=1).astype(float)
    mae_w = float(np.abs(w_o - w_t).mean())
    return {"yTopTgt": y_top, "yBotTgt": y_bot, "lower40Lo": lo,
            "nTgtHemCols": int(hem_t.sum()), "nBothHemCols": int(hem_both.sum()),
            "coverage": round(float(hem_both.sum() / max(int(hem_t.sum()), 1)), 4),
            "yBottomMAEpx": round(mae_y, 2), "widthMAEpx": round(mae_w, 2),
            "yBottomMAEmm": round(mae_y * MM_PER_PX, 2),
            "widthMAEmm": round(mae_w * MM_PER_PX, 2),
            "widthMeanTgtPx": round(float(w_t.mean()), 1),
            "widthMeanOursPx": round(float(w_o.mean()), 1)}


# ---------------------------------------------------------------- FIX B helpers

def load_beauty_rgb(path: Path) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    if im.size != (SIZE, SIZE):
        im = im.resize((SIZE, SIZE), Image.BILINEAR)
    return np.array(im).astype(float)


def skin_hair_refs(beauty: np.ndarray, hair_solid: np.ndarray) -> dict:
    """Body-skin and hair RGB references from a profile/3q beauty render.

    hair = median RGB where ID alpha>=230 (solid curtain). skin = median RGB
    of pixels inside the face box (rows 400-500, cols 150-240, profile face
    lies anterior of the curtain) that are not hair (ID alpha<30 there) and
    within L1 90 of the coarse prior (250,190,150); fallback box median.
    Both references are stated per subject in the subject file."""
    hair_px = beauty[hair_solid]
    href = np.median(hair_px, axis=0) if len(hair_px) else np.array([0., 0., 0.])
    box = beauty[400:500, 150:240].reshape(-1, 3)
    prior = np.array([250.0, 190.0, 150.0])
    sel = box[np.abs(box - prior).sum(-1) < 90.0]
    sref = np.median(sel, axis=0) if len(sel) > 100 else np.median(box, axis=0)
    return {"skin": [round(float(v), 1) for v in sref],
            "hair": [round(float(v), 1) for v in href],
            "nSkinPx": int(len(sel)), "nHairPx": int(len(hair_px))}


def skin_visible_frac(beauty: np.ndarray, hair_mask: np.ndarray,
                      region: np.ndarray, skin: np.ndarray,
                      hair: np.ndarray) -> dict:
    """Beauty-based translucency: over region & hair(alpha>=128), fraction of
    pixels whose RGB is closer (L1) to the skin reference than the hair one;
    plus the whole-region fraction. Pinna-region pixels that read as skin
    while the ID pass calls them hair = see-through curtain."""
    sel = region & hair_mask
    dskin = np.abs(beauty - skin).sum(-1)
    dhair = np.abs(beauty - hair).sum(-1)
    skinlike = dskin < dhair
    n_sel = int(sel.sum())
    n_reg = int(region.sum())
    return {"denomHairPx": n_sel,
            "skinVisibleFracHair": round(float((skinlike & sel).sum() / max(n_sel, 1)), 4),
            "skinVisibleFracRegion": round(float((skinlike & region).sum() / max(n_reg, 1)), 4),
            "nRegionPx": n_reg}


# ---------------------------------------------------------------- R2 root setback

R2_FRONT_Y = -0.120  # cap boundary verts with y < -0.120 m = front arc (crown4 rule)
R2_MID_X = 0.010
R2_TEMPLE_X = 0.045


def cap_front_boundary(cap) -> np.ndarray:
    """Cap mesh boundary verts (edges used by exactly one face), in metres."""
    V = np.asarray(cap["verts"], dtype=float)
    F = np.asarray(cap["faces"], dtype=int)
    ec: dict = {}
    for tri in F:
        a, b, c = (int(v) for v in tri)
        for u, v in ((a, b), (b, c), (c, a)):
            e = (min(u, v), max(u, v))
            ec[e] = ec.get(e, 0) + 1
    bnd = sorted({v for e, n in ec.items() if n == 1 for v in e})
    return V[np.array(bnd)]


def _zone_sel(x: np.ndarray, zone: str) -> np.ndarray:
    ax = np.abs(x)
    if zone == "midline":
        return ax <= R2_MID_X
    if zone == "temple_L":
        return (x > R2_MID_X) & (x <= R2_TEMPLE_X)
    if zone == "temple_R":
        return (x < -R2_MID_X) & (x >= -R2_TEMPLE_X)
    raise ValueError(zone)


def r2_setback(cap, roots: np.ndarray) -> dict:
    """Boundary-to-nearest-root xy distance per zone + per-band y landmarks.

    Mirrors crown4 write_diagnosis.py section A: front = boundary y<-0.120;
    dmin = xy distance to nearest root; per-x-band capFrontY/firstRootY/gap.
    Left/right by sign of x (+x = L, matching cap-v8 pinna_front_L at +x)."""
    BV = cap_front_boundary(cap)
    front = BV[BV[:, 1] < R2_FRONT_Y]
    R = np.asarray(roots, dtype=float)
    out = {"selectionRule": ("boundary edges (used once) with y < -0.120 m; "
                             "midline |x|<=0.01 m; temples 0.01<|x|<=0.045 m; "
                             "+x = L"),
           "nFrontBndVerts": int(len(front)), "nRoots": int(len(R)),
           "zones": {}}
    for zone in ("midline", "temple_L", "temple_R"):
        sel = _zone_sel(front[:, 0], zone)
        F = front[sel]
        rsel = _zone_sel(R[:, 0], zone)
        RB = R[rsel]
        if len(F) == 0 or len(RB) == 0:
            out["zones"][zone] = {"nBnd": int(len(F)), "nRoots": int(len(RB)),
                                  "note": "empty zone"}
            continue
        dmin = np.empty(len(F))
        for i in range(0, len(F), 256):
            d2 = ((R[None, :, :2] - F[i:i + 256, None, :2]) ** 2).sum(-1)
            dmin[i:i + 256] = np.sqrt(d2.min(axis=1))
        mm = dmin * 1000.0
        out["zones"][zone] = {
            "nBnd": int(len(F)), "nRoots": int(len(RB)),
            "capFrontYmm": round(float(F[:, 1].min() * 1000), 1),
            "firstRootYmm": round(float(RB[:, 1].min() * 1000), 1),
            "gapMm": round(float((RB[:, 1].min() - F[:, 1].min()) * 1000), 1),
            "distP50mm": round(float(np.median(mm)), 2),
            "distP95mm": round(float(np.percentile(mm, 95)), 2),
            "distMaxMm": round(float(mm.max()), 2),
        }
    return out


def run_r2(manifest: dict) -> dict:
    cap8 = np.load(str(resolve(manifest, "cap_v8")), allow_pickle=True)
    spread = np.load(str(resolve(manifest, "spread")), allow_pickle=True)
    cap7 = np.load(str(resolve(manifest, "cap_v7")), allow_pickle=True)
    ccurve = np.load(str(resolve(manifest, "c_curve_strands")), allow_pickle=True)
    cbest8 = np.load(str(resolve(manifest, "c_best8_strands")), allow_pickle=True)
    return {
        "note": ("target N/A (geometry ruler). parity combo reproduces the "
                 "crown4 method on cap-v8 + crown2 spread; station combos run "
                 "cap-v7 + hem-lineage strands."),
        "parity_capV8_spread": r2_setback(cap8, spread["roots"]),
        "current_capV7_cCurve": r2_setback(cap7, ccurve["roots"]),
        "previous_capV7_cBest8": r2_setback(cap7, cbest8["roots"]),
        "crown4Reference": {"capFrontYmm": -148.2, "firstRootYmm": -121.9,
                            "src": ("crown4 diagnosis.json A_rootsVsCapFront "
                                    "midline x[-0.01,0.01]; cap = crown3 "
                                    "cap_live.npz, roots = crown2 spread.npz")},
    }


# ---------------------------------------------------------------- R6 shoulder gap

def corner_bg(beauty: np.ndarray) -> np.ndarray:
    c = np.concatenate([beauty[:32, :32].reshape(-1, 3),
                        beauty[:32, -32:].reshape(-1, 3),
                        beauty[-32:, :32].reshape(-1, 3),
                        beauty[-32:, -32:].reshape(-1, 3)])
    return np.median(c, axis=0)


def body_mask(beauty: np.ndarray, id_alpha: np.ndarray) -> np.ndarray:
    """Shirt/body silhouette: non-background AND ID alpha<30 (not hair)."""
    bg = corner_bg(beauty)
    nonbg = np.abs(beauty - bg).sum(-1) > 30.0
    return nonbg & (id_alpha < 30)


def posterior_edge(mask: np.ndarray, row: int):
    xs = np.where(mask[row])[0]
    return int(xs.max()) if len(xs) else None


def r6_gap(hair_reg: np.ndarray, body_reg: np.ndarray, rows: dict) -> dict:
    out = {"sign": "+ = hair extends behind (posterior of) the body",
           "rows": {}}
    for name, row in rows.items():
        hp = posterior_edge(hair_reg, int(row))
        bp = posterior_edge(body_reg, int(row))
        gap = (hp - bp) if (hp is not None and bp is not None) else None
        out["rows"][name] = {
            "row": int(row), "hairPostCol": hp, "bodyPostCol": bp,
            "gapPx": gap,
            "gapMm": round(gap * MM_PER_PX, 2) if gap is not None else None,
        }
    return out


def hem_bottom_row(mask: np.ndarray) -> int:
    w = mask.sum(axis=1)
    rows = np.where(w > 2)[0]
    return int(rows.max()) if len(rows) else -1


def run_r6(subject: str, manifest: dict, hair_reg: np.ndarray,
           tgt: dict, beauty: dict, ref_tr: dict) -> dict:
    """Posterior gap in the registered profile frame.

    One COMMON shoulder row for all subjects: the render shoulder plane
    (row 650.73) mapped by the reference profile transform (content-free
    register_view on the RENDER triple; identical for current/previous since
    they share the triple, mode-invariant since skull keeps profile raw).
    Body: own beauty where it exists; the target has no body photo so the
    CURRENT render's body (same head/body), registered with the same
    reference transform, stands in for every subject's body frame."""
    rs, rtx, rty = ref_tr["scale"], ref_tr["tx"], ref_tr["ty"]
    shoulder_t = rs * SHOULDER_ROW_RENDER_PROFILE + rty
    hem_t = hem_bottom_row(hair_reg)
    # body: own beauty where available, else current's (target subject)
    if subject == "target":
        bkey, idkey = "current_profile_90_beauty", "current_profile_90_id"
    else:
        bkey, idkey = f"{subject}_profile_90_beauty", f"{subject}_profile_90_id"
    b = load_beauty_rgb(resolve(manifest, bkey))
    a = np.array(Image.open(resolve(manifest, idkey)))[:, :, 3]
    if a.shape != (SIZE, SIZE):
        a = np.array(Image.fromarray(a).resize((SIZE, SIZE), Image.NEAREST))
    bm = body_mask(b, a)
    m_img = Image.fromarray((bm.astype(np.uint8) * 255))
    inv = (1.0 / rs, 0.0, -rtx / rs, 0.0, 1.0 / rs, -rty / rs)
    body_reg = np.array(m_img.transform((SIZE, SIZE), Image.AFFINE, inv,
                                        Image.NEAREST)) > 127
    gaps = r6_gap(hair_reg, body_reg,
                  {"shoulderPlane": int(round(shoulder_t)), "ownHem": hem_t})
    return {"bodyRule": ("non-background (|RGB-bg|>30, bg=corner median) AND "
                         "ID alpha<30; target body = current render body "
                         "(no target body photo; same head/body), registered "
                         "with the same reference transform"),
            "shoulderRenderRow": round(SHOULDER_ROW_RENDER_PROFILE, 2),
            "shoulderTargetRow": int(round(shoulder_t)),
            "shoulderRowCommon": True,
            "bgRef": [round(float(v), 1) for v in corner_bg(b)],
            **gaps}


# ---------------------------------------------------------------- R3 hairline

def hairline_polyline(mask: np.ndarray, crown_row: int, brow_row: int,
                      c0: int, c1: int):
    """Lower hair-mask boundary per column. Returns (rows, observed) over
    [c0, c1): OBSERVED iff hair exists in [crown_row, brow_row], its lowest
    hair row is strictly above brow_row, and nothing hair sits between that
    row and brow_row (curtain/silhouette-edge columns fail -> UNOBSERVED)."""
    n = c1 - c0
    rows = np.full(n, -1, dtype=int)
    obs = np.zeros(n, bool)
    for i, c in enumerate(range(c0, c1)):
        col = mask[crown_row:brow_row, c] if brow_row > crown_row else np.zeros(0, bool)
        ys = np.where(col)[0]
        if not len(ys):
            continue
        hl = int(ys.max()) + crown_row
        below = mask[hl + 1:brow_row, c]
        if hl < brow_row - 1 and not below.any():
            rows[i] = hl
            obs[i] = True
    return rows, obs


def zone_of(dcol: np.ndarray) -> np.ndarray:
    z = np.full(dcol.shape, "", dtype=object)
    a = np.abs(dcol)
    z[a <= R3_BANDS["midline"]] = "midline"
    z[(a > R3_BANDS["midline"]) & (a <= R3_BANDS["brow"])] = "brow"
    z[(a > R3_BANDS["brow"]) & (a <= R3_BANDS["temple"])] = "temple"
    return z


def r3_front(ours_reg: np.ndarray, tgt: np.ndarray, centre: int,
             crown_row: int, brow_row: int) -> dict:
    c0, c1 = centre - R3_BANDS["temple"], centre + R3_BANDS["temple"]
    o_rows, o_obs = hairline_polyline(ours_reg, crown_row, brow_row, c0, c1)
    t_rows, t_obs = hairline_polyline(tgt, crown_row, brow_row, c0, c1)
    cols = np.arange(c0, c1)
    side = np.where(cols < centre, "L", "R")
    zones = zone_of(cols - centre)
    out = {"roi": {"crownRow": crown_row, "browRow": brow_row,
                   "centreCol": centre, "colRange": [c0, c1],
                   "bands": {"midline": R3_BANDS["midline"],
                             "brow": R3_BANDS["brow"],
                             "temple": R3_BANDS["temple"]}},
           "observedOurs": int(o_obs.sum()), "observedTgt": int(t_obs.sum()),
           "nCols": int(c1 - c0), "zones": {}}
    both = o_obs & t_obs
    d = (o_rows.astype(float) - t_rows.astype(float))  # + = ours lower
    for zname in ("midline", "brow_L", "brow_R", "temple_L", "temple_R"):
        if "_" in zname:
            base, sd = zname.split("_")
            sel = both & (zones == base) & (side == sd)
        else:
            sel = both & (zones == zname)
        v = d[sel]
        if "_" in zname:
            base, sd = zname.split("_")
            zsel_all = (zones == base) & (side == sd)
        else:
            zsel_all = (zones == zname)
        unobs = int((~both & zsel_all).sum())
        if len(v):
            out["zones"][zname] = {
                "nObserved": int(len(v)), "nUnobserved": unobs,
                "signedP50px": round(float(np.median(v)), 2),
                "signedP95px": round(float(np.percentile(v, 95)), 2),
                "absP95px": round(float(np.percentile(np.abs(v), 95)), 2),
                "signedP50mm": round(float(np.median(v) * MM_PER_PX), 3),
                "signedP95mm": round(float(np.percentile(v, 95) * MM_PER_PX), 3),
            }
        else:
            out["zones"][zname] = {"nObserved": 0, "nUnobserved": unobs,
                                   "note": "UNOBSERVED throughout zone"}
    out["_ours"] = o_rows
    out["_oursObs"] = o_obs
    out["_tgt"] = t_rows
    out["_tgtObs"] = t_obs
    return out


def r3_three_quarter(hair_render: np.ndarray, mw: np.ndarray) -> dict:
    """Ours-only three_quarter hairline: ROI from projected anatomy."""
    brow = np.array(project_cam(np.array(ANATOMY_WORLD["brow"]), mw))
    crown = np.array(project_cam(np.array(ANATOMY_WORLD["crown"]), mw))
    fc = np.array(project_cam(np.array(ANATOMY_WORLD["face_centre"]), mw))
    crown_row = int(round(crown[1]))
    brow_row = int(round(brow[1]))
    centre = int(round(fc[0]))
    c0 = max(0, centre - R3_BANDS["temple"])
    c1 = min(SIZE, centre + R3_BANDS["temple"])
    rows, obs = hairline_polyline(hair_render, max(0, crown_row),
                                  min(SIZE, brow_row), c0, c1)
    return {"note": "three_quarter has no registered target: ours only",
            "projBrow": [round(float(brow[0]), 1), round(float(brow[1]), 1)],
            "projCrown": [round(float(crown[0]), 1), round(float(crown[1]), 1)],
            "projFaceCentre": [round(float(fc[0]), 1), round(float(fc[1]), 1)],
            "roi": {"crownRow": crown_row, "browRow": brow_row,
                    "centreCol": centre, "colRange": [c0, c1]},
            "observed": int(obs.sum()), "nCols": int(c1 - c0),
            "hairlineP50row": round(float(np.median(rows[obs])), 1) if obs.sum() else None,
            "_rows": rows, "_obs": obs, "_c0": c0}


def run_r3(subject: str, manifest: dict, ours_reg: np.ndarray,
           tr: dict, tgt: dict, ours128: dict, MW: dict) -> dict:
    s, tx, ty = tr["scale"], tr["tx"], tr["ty"]
    crown_t = int(round(s * CROWN_ROW_RENDER["front"] + ty))
    brow_t = int(round(s * BROW_ROW_RENDER["front"] + ty))
    centre = 513
    front = r3_front(ours_reg, tgt["front"], centre, crown_t, brow_t)
    for k in ("_ours", "_oursObs", "_tgt", "_tgtObs"):
        front.pop(k, None)
    out = {"front": front}
    if subject == "target":
        out["three_quarter"] = {"note": "no target three_quarter (reference N/A)"}
    else:
        tq = r3_three_quarter(ours128["three_quarter"], MW["three_quarter"])
        for k in ("_rows", "_obs"):
            tq.pop(k, None)
        out["three_quarter"] = tq
    return out


# ---------------------------------------------------------------- subject run

SUBJECT_RENDER_TRIPLE = {
    "target": None,  # resolved per-view to the TARGET triple (identity registration)
    "current": None, "previous": None,  # RENDER_TRIPLE
}


BEAUTY_KEY = {"front": "front_beauty", "profile_90": "profile_90_beauty",
              "three_quarter": "three_quarter_beauty"}
# Render-frame projected anatomy rows (hair-curtain3/landmarks.json
# views.*.projected; Blender perspective model, same model R4 validates).
BROW_ROW_RENDER = {"front": 269.13348388671875}
CROWN_ROW_RENDER = {"front": 102.77374267578125}
SHOULDER_ROW_RENDER_PROFILE = 650.7325744628906  # projected back_shoulder
# R3 column bands around the target centre col (px, target frame).
R3_BANDS = {"midline": 50, "brow": 130, "temple": 200}
# R3 three_quarter anatomy world points (curtain3 landmarks.json anatomy).
ANATOMY_WORLD = {
    "brow": (1.8774706234125915e-09, -0.1486320048570633, 1.5716520547866821),
    "crown": (1.1403722410818773e-09, -0.053241077810525894, 1.6599169969558716),
    "face_centre": (0.0, -0.1348039209842682, 1.4492578506469727),
}


def run_subject(subject: str, manifest: dict, hj, reg_mode: str = "skull") -> dict:
    paths = subject_id_paths(manifest, subject)
    cap = np.load(str(resolve(manifest, "cap_v8")), allow_pickle=True)
    pts3d = pinna_points(cap)
    cur_score = json.loads(resolve(manifest, "current_score").read_text())
    cams = cur_score["render"]["cameras"]
    MW = {v: np.array(cams[v]["matrixWorld"]) for v in ("profile_90", "three_quarter")}
    if subject == "previous":
        prev_score = json.loads(resolve(manifest, "previous_score").read_text())
        MW["three_quarter"] = np.array(
            prev_score["render"]["cameras"]["three_quarter"]["matrixWorld"])
        MW["profile_90"] = np.array(
            prev_score["render"]["cameras"]["profile_90"]["matrixWorld"])
    tgt = {v: load_bool_mask(resolve(manifest, TARGET_MASK_KEY[v]), False)
           for v in ("front", "profile_90", "back")}
    # ID thresholds: R1/R5 use 230 (judge load_mask 'alpha>=0.9' encoding;
    # reproduces judge profile/back IoU); R4 uses 128 (brief-fixed); FIX B
    # adds 30/230 brackets; R3/R6 use 128 (visible-hair edge, stated).
    ours230, ours128, ours30 = {}, {}, {}
    if subject == "target":
        ours230 = {v: tgt[v] for v in ("front", "profile_90", "back")}
        cur128 = {v: load_bool_mask(resolve(manifest, f"current_{v}_id"), True, 128)
                  for v in ("profile_90", "three_quarter")}
        ours128 = {"profile_90": cur128["profile_90"],
                   "three_quarter": cur128["three_quarter"]}
        ours30, ours230_3q = {}, {}
    else:
        for v in ("front", "profile_90", "back", "three_quarter"):
            ours230[v] = load_bool_mask(paths[v], True, 230)
            ours128[v] = load_bool_mask(paths[v], True, 128)
            ours30[v] = load_bool_mask(paths[v], True, 30)
        ours230_3q = ours230["three_quarter"]
    res = {"subject": subject, "mmPerPx": MM_PER_PX,
           "regMode": reg_mode,
           "idThreshold": {"R1_R5": 230, "R4": 128, "R4_FIXB": [30, 128, 230],
                           "R3_R6": 128,
                           "why": ("R1/R5 230 = judge load_mask alpha>=0.9 "
                                   "encoding (reproduces judge profile/back IoU); "
                                   "R4 128 per brief, bracketed by 30/230 in v4b; "
                                   "R3/R6 128 = visible-hair edge")},
           "registration": {
               "method": "hair_judge.register_view (imported, no bpy) with "
                         f"{reg_mode.upper()} triples",
               "mode": reg_mode,
               "renderTriple": {k: list(v) for k, v in RENDER_TRIPLE.items()},
               "targetTriple": {k: list(target_triple_for(k, reg_mode))
                                for k in ("front", "profile_90", "back")},
               "note": ("skull = scorer orientation (front +10 mm offset, "
                        "scale 0.9545; profile/back raw, matching score.json); "
                        "raw = v4a-frozen hem2 shape_base parity triple set")},
           "r1": {}, "r4": {}, "r5": {}, "r2": {}, "r3": {}, "r6": {}}
    regs = {}
    for view in ("front", "profile_90", "back"):
        rt = target_triple_for(view, reg_mode) if subject == "target" \
            else RENDER_TRIPLE[view]
        r1 = r1_view(ours230[view], tgt[view], view, hj, rt, reg_mode)
        regs[view] = r1.pop("_reg")
        res["r1"][view] = r1
        r5 = r5_view(regs[view], tgt[view])
        r5["transform"] = r1["transform"]
        res["r5"][view] = r5
    # R4 in render frame; profile also gets target value over mapped region.
    # FIX B: coverage at 30/128/230 + beauty skin-visible fraction.
    beauty = {}
    if subject != "target":
        for v in ("profile_90", "three_quarter"):
            beauty[v] = load_beauty_rgb(resolve(manifest, f"{subject}_{BEAUTY_KEY[v]}"))
    for view in ("profile_90", "three_quarter"):
        hair_render = ours128[view]
        note = ("target subject: region/hair shown via current render frame"
                if subject == "target" else None)
        if view == "profile_90":
            tr = res["r1"]["profile_90"]["transform"]
            r4 = r4_view(hair_render, MW[view], pts3d, tgt["profile_90"], tr)
            # for the target subject the meaningful number is targetCoverage
            if subject == "target":
                r4["coverage"] = r4["targetCoverage"]
                r4["coverageNote"] = "target-vs-itself: coverage of target mask"
            if subject != "target":
                covs = {}
                for th, key in ((30, "ours30"), (128, "ours128"), (230, "ours230")):
                    m = ours30[view] if th == 30 else (
                        hair_render if th == 128 else ours230[view])
                    covs[str(th)] = round(
                        float((m & r4["_region"]).sum() / max(int(r4["_region"].sum()), 1)), 4)
                r4["coverageByThreshold"] = covs
                refs = skin_hair_refs(beauty[view], ours230[view])
                r4["skinRef"] = refs["skin"]
                r4["hairRef"] = refs["hair"]
                r4["skinVisibleFrac"] = skin_visible_frac(
                    beauty[view], hair_render, r4["_region"],
                    np.array(refs["skin"]), np.array(refs["hair"]))
        else:
            r4 = r4_view(hair_render, MW[view], pts3d)
            r4["targetCoverage"] = None
            r4["targetNote"] = "three_quarter has no registered target: ours only"
            if subject != "target":
                refs = skin_hair_refs(beauty[view], ours230_3q)
                r4["skinRef"] = refs["skin"]
                r4["hairRef"] = refs["hair"]
                r4["skinVisibleFrac"] = skin_visible_frac(
                    beauty[view], hair_render, r4["_region"],
                    np.array(refs["skin"]), np.array(refs["hair"]))
            else:
                r4["skinVisibleFrac"] = None
                r4["skinNote"] = "target has no beauty render"
        if note:
            r4["note"] = note
        for k in ("_region", "_tregion"):
            r4.pop(k, None)
        res["r4"][view] = r4
    # R6 + R3 need the alpha>=128 masks in the registered (target) frame.
    reg128, reg128_tr = {}, {}
    for view in ("front", "profile_90"):
        if subject == "target":
            reg128[view] = tgt[view]
            reg128_tr[view] = {"scale": 1.0, "tx": 0.0, "ty": 0.0}
        else:
            m, tr = register(ours128[view], view, hj, RENDER_TRIPLE[view],
                             None, reg_mode)
            reg128[view] = m
            reg128_tr[view] = tr
    # R6 + R3 (image rulers; FIX A mode applies to front registration only;
    # profile/back transforms are mode-invariant by construction).
    # Reference profile transform (content-free): anchors the COMMON
    # shoulder row and registers the shared body for every subject.
    _, ref_tr = register(np.zeros((SIZE, SIZE), bool), "profile_90", hj,
                         RENDER_TRIPLE["profile_90"], None, reg_mode)
    res["r6"] = run_r6(subject, manifest, reg128["profile_90"], tgt, beauty,
                       ref_tr)
    res["r3"] = run_r3(subject, manifest, reg128["front"],
                       reg128_tr["front"], tgt, ours128, MW)
    # R2 (geometry; registration-independent).
    res["r2"] = run_r2(manifest)
    return res


# ---------------------------------------------------------------- probes

def _ok(pid: str, kind: str, expected, measured, tol, extra=None) -> dict:
    try:
        passed = bool(abs(float(measured) - float(expected)) <= tol)
    except (TypeError, ValueError):
        passed = bool(measured == expected)
    d = {"id": pid, "kind": kind, "expected": expected, "measured": measured,
         "tol": tol, "pass": passed}
    if extra:
        d.update(extra)
    return d


# ---------------------------------------------------------------- v4b probes
# FIX A (one registration), FIX B (R4 translucency), R2, R6, R3.
# Every new ruler: analytic fixture + planted perturbation of known magnitude
# + monotonicity over 3 magnitudes. Target-vs-itself is reference only.

def _synth_cap_polyline(xs: np.ndarray, y_line: float) -> dict:
    """Strip mesh whose front boundary is the polyline (xs, y_line): back row
    at y=+0.10 so only the polyline verts pass the y<-0.12 front filter."""
    n = len(xs)
    V = np.zeros((2 * n, 3))
    V[:n, 0] = xs
    V[:n, 1] = y_line
    V[n:, 0] = xs
    V[n:, 1] = 0.10
    F = []
    for i in range(n - 1):
        F.append([i, i + 1, n + i])
        F.append([i + 1, n + i + 1, n + i])
    return {"verts": V, "faces": np.array(F, dtype=int)}


def run_probes_v4b(manifest: dict, hj, cur_run_raw: dict) -> list[dict]:
    probes = []
    tgt = {v: load_bool_mask(resolve(manifest, TARGET_MASK_KEY[v]), False)
           for v in ("front", "profile_90", "back")}
    cur230 = {v: load_bool_mask(resolve(manifest, f"current_{v}_id"), True, 230)
              for v in ("front", "profile_90", "back")}
    cur128 = {v: load_bool_mask(resolve(manifest, f"current_{v}_id"), True, 128)
              for v in ("front", "profile_90")}

    # -- FIX A: skull mode reproduces score.json orientation transforms.
    sc = json.loads(resolve(manifest, "current_score").read_text())
    skull_run = run_subject("current", manifest, hj, "skull")
    for view in ("front", "profile_90", "back"):
        got = skull_run["r1"][view]["transform"]
        want = sc["orientation"][view]["transform"]
        for k in ("scale", "tx", "ty"):
            probes.append(_ok(f"A-skull-{view}-{k}", "agreement", want[k],
                              got[k], 1e-6))
    # raw triple math is exact by construction (frozen contract half).
    probes.append(_ok("A-raw-front-scale", "analytic", 481.0 / 480.0,
                      cur_run_raw["r1"]["front"]["transform"]["scale"], 1e-9))
    probes.append(_ok("A-skull-front-scale", "analytic",
                      (608.0 - 127.0 - SKULL_OFFSET_PX) / 480.0,
                      skull_run["r1"]["front"]["transform"]["scale"], 1e-9))
    dscale = (skull_run["r1"]["front"]["transform"]["scale"]
              - cur_run_raw["r1"]["front"]["transform"]["scale"])
    probes.append(_ok("A-front-mode-delta", "planted", -0.0476, dscale, 1e-3,
                      {"note": "skull-raw front scale delta (offset/H_r)"}))
    dprof = (skull_run["r1"]["profile_90"]["transform"]["scale"]
             - cur_run_raw["r1"]["profile_90"]["transform"]["scale"])
    probes.append(_ok("A-profile-mode-invariant", "analytic", 0.0, dprof, 1e-12,
                      {"note": "profile/back share the raw triple in skull mode"}))
    # -- FIX A: R1/R5 planted self-comparison under skull (default mode).
    chin = TARGET_CHIN["front"]
    reg_sk, _ = register(cur230["front"], "front", hj, None, None, "skull")
    sh = reg_sk.copy()
    below = sh[chin:, :]
    tmp = np.zeros_like(below)
    tmp[10:, :] = below[:-10, :]
    sh[chin:, :] = tmp
    st = r1_region_stats(sh, reg_sk, chin)
    probes.append(_ok("A-R1-skull-planted-10px", "planted", 10.0,
                      st["below"]["absP95px"], 1.0))
    px30 = int(round(30.0 / MM_PER_PX))
    back_sk, _ = register(cur230["back"], "back", hj, None, None, "skull")
    sh30 = np.zeros_like(back_sk)
    sh30[px30:, :] = back_sk[:-px30, :]
    self30 = r5_view(sh30, back_sk)
    probes.append(_ok("A-R5-skull-planted-30mm", "planted",
                      round(px30 * MM_PER_PX, 2), self30["yBottomMAEmm"], 2.0,
                      {"px30": px30}))

    # -- FIX B: three thresholds bracket the fringe; analytic + planted skin.
    cap = np.load(str(resolve(manifest, "cap_v8")), allow_pickle=True)
    MWp = np.array(json.loads(resolve(manifest, "current_score").read_text())
                   ["render"]["cameras"]["profile_90"]["matrixWorld"])
    region_r4 = r4_view(cur128["profile_90"], MWp, pinna_points(cap))["_region"]
    covs = {}
    for th in (30, 128, 230):
        m = load_bool_mask(resolve(manifest, "current_profile_90_id"), True, th)
        covs[th] = float((m & region_r4).sum() / max(int(region_r4.sum()), 1))
    probes.append({"id": "B-monotonic-thresholds", "kind": "monotonicity",
                   "measured": {str(k): round(v, 4) for k, v in covs.items()},
                   "pass": bool(covs[30] >= covs[128] >= covs[230])})
    probes.append(_ok("B-fringe-visible", "planted", True, covs[30] > covs[230],
                      True, {"note": "alpha 30 vs 230 coverage differs: the "
                                     "fringe R4-128 was blind to exists"}))
    skin = np.array([253.0, 189.0, 151.0])
    hair = np.array([35.0, 32.0, 30.0])
    syn = np.zeros((100, 100, 3))
    syn[:, :50] = skin
    syn[:, 50:] = hair
    f = skin_visible_frac(syn, np.ones((100, 100), bool),
                          np.ones((100, 100), bool), skin, hair)
    probes.append(_ok("B-skinfrac-analytic", "analytic", 0.5,
                      f["skinVisibleFracHair"], 1e-9))
    bcur = load_beauty_rgb(resolve(manifest, "current_profile_90_beauty"))
    refs = skin_hair_refs(bcur, load_bool_mask(
        resolve(manifest, "current_profile_90_id"), True, 230))
    probes.append(_ok("B-skinref-sane", "analytic", True,
                      float(np.abs(np.array(refs["skin"]) - skin).sum()) < 60.0,
                      True, {"measured": refs["skin"]}))
    probes.append(_ok("B-hairref-sane", "analytic", True,
                      float(np.abs(np.array(refs["hair"]) - hair).sum()) < 60.0,
                      True, {"measured": refs["hair"]}))
    sel = region_r4 & cur128["profile_90"]
    denom = int(sel.sum())
    if denom > 1000:
        copy = bcur.copy()
        idx = np.argwhere(sel)
        take = idx[:500]
        copy[take[:, 0], take[:, 1]] = np.array(refs["skin"])
        f0 = skin_visible_frac(bcur, cur128["profile_90"], region_r4,
                               np.array(refs["skin"]), np.array(refs["hair"]))
        f1 = skin_visible_frac(copy, cur128["profile_90"], region_r4,
                               np.array(refs["skin"]), np.array(refs["hair"]))
        probes.append(_ok("B-skinfrac-planted-500px", "planted",
                          round(500.0 / denom, 4),
                          round(f1["skinVisibleFracHair"] - f0["skinVisibleFracHair"], 4),
                          1e-9, {"denom": denom}))

    # -- R2: synthetic polyline + roots at known offsets.
    xs = np.linspace(-0.04, 0.04, 10)
    cap_syn = _synth_cap_polyline(xs, -0.14)
    xr = np.linspace(-0.04, 0.04, 20)
    for off_mm, pid in ((10.0, "10"), (25.0, "25"), (40.0, "40")):
        R = np.zeros((20, 3))
        R[:, 0] = xr
        R[:, 1] = -0.14 + off_mm / 1000.0
        got = r2_setback(cap_syn, R)["zones"]["midline"]["distP50mm"]
        # independent 5-line median, written first (brief rule): brute
        # nearest-root xy distances, then the median in mm.
        P = cap_syn["verts"][:10]
        dd = np.sqrt(((R[None, :, :2] - P[:, None, :2]) ** 2).sum(-1)).min(1)
        ref = float(np.median(dd[np.abs(P[:, 0]) <= 0.01]) * 1000.0)
        probes.append(_ok(f"R2-planted-{pid}mm", "planted", off_mm, got, 0.5,
                          {"independentMedianMm": round(ref, 3)}))
    vals = []
    for off_mm in (10.0, 25.0, 40.0):
        R = np.zeros((20, 3))
        R[:, 0] = xr
        R[:, 1] = -0.14 + off_mm / 1000.0
        vals.append(r2_setback(cap_syn, R)["zones"]["midline"]["distP50mm"])
    probes.append({"id": "R2-monotonic-10-25-40", "kind": "monotonicity",
                   "measured": [round(v, 2) for v in vals],
                   "pass": bool(vals[0] < vals[1] < vals[2])})
    R0 = np.zeros((20, 3))
    R0[:, 0] = np.repeat(xs, 2)
    R0[:, 1] = -0.14
    probes.append(_ok("R2-on-line", "analytic", 0.0,
                      r2_setback(cap_syn, R0)["zones"]["midline"]["distMaxMm"],
                      2.0))
    # -- R2 parity: same spread.npz roots as crown4 -> midline firstRootYmm.
    r2 = run_r2(manifest)
    probes.append(_ok("R2-parity-firstRoot", "parity", -121.9,
                      r2["parity_capV8_spread"]["zones"]["midline"]["firstRootYmm"],
                      1.0))
    probes.append({"id": "R2-validation-capFront", "kind": "validation",
                   "note": ("crown4 -148.2 mm is crown3 cap_live.npz; cap-v8 "
                            "front edge measures "
                            f"{r2['parity_capV8_spread']['zones']['midline']['capFrontYmm']} mm "
                            "midline (different cap file, 26.4 mm shorter by "
                            "construction). Parity gate uses firstRootYmm, "
                            "which shares the identical spread.npz file."),
                   "measuredCapFrontYmm": r2["parity_capV8_spread"]["zones"]["midline"]["capFrontYmm"],
                   "pass": True})
    for combo in ("current_capV7_cCurve", "previous_capV7_cBest8"):
        p50 = r2[combo]["zones"]["midline"]["distP50mm"]
        probes.append(_ok(f"R2-smoke-{combo}", "analytic", True,
                          bool(np.isfinite(p50) and p50 >= 0.0), True,
                          {"midlineP50mm": p50}))

    # -- R6: analytic rects + planted posterior shift on real masks.
    Hb = np.zeros((SIZE, SIZE), bool)
    Hb[600:701, 300:451] = True
    Bb = np.zeros((SIZE, SIZE), bool)
    Bb[600:701, 300:401] = True
    g = r6_gap(Hb, Bb, {"shoulderPlane": 650, "ownHem": 700})
    probes.append(_ok("R6-analytic-gap", "analytic", 50,
                      g["rows"]["shoulderPlane"]["gapPx"], 0,
                      {"mm": g["rows"]["shoulderPlane"]["gapMm"]}))
    reg_prof, _ = register(cur128["profile_90"], "profile_90", hj, None, None,
                           "skull")
    btmp = load_beauty_rgb(resolve(manifest, "current_profile_90_beauty"))
    atmp = np.array(Image.open(resolve(manifest, "current_profile_90_id")))[:, :, 3]
    s1 = skull_run["r1"]["profile_90"]["transform"]
    inv = (1.0 / s1["scale"], 0.0, -s1["tx"] / s1["scale"],
           0.0, 1.0 / s1["scale"], -s1["ty"] / s1["scale"])
    bm_img = Image.fromarray((body_mask(btmp, atmp).astype(np.uint8) * 255))
    body_reg = np.array(bm_img.transform((SIZE, SIZE), Image.AFFINE, inv,
                                         Image.NEAREST)) > 127
    rows = {"shoulderPlane": int(round(s1["scale"] * SHOULDER_ROW_RENDER_PROFILE
                                       + s1["ty"])),
            "ownHem": hem_bottom_row(reg_prof)}
    g0 = r6_gap(reg_prof, body_reg, rows)
    deltas = {}
    for mag in (10, 20, 30):
        sh = np.zeros_like(reg_prof)
        sh[:, mag:] = reg_prof[:, :-mag]
        gm = r6_gap(sh, body_reg, rows)
        deltas[str(mag)] = {k: gm["rows"][k]["gapPx"] - g0["rows"][k]["gapPx"]
                            for k in rows}
    probes.append(_ok("R6-planted-20px", "planted", 20,
                      deltas["20"]["shoulderPlane"], 0.5,
                      {"hemDelta": deltas["20"]["ownHem"]}))
    probes.append({"id": "R6-monotonic-10-20-30", "kind": "monotonicity",
                   "measured": deltas,
                   "pass": bool(deltas["10"]["shoulderPlane"]
                                < deltas["20"]["shoulderPlane"]
                                < deltas["30"]["shoulderPlane"])})
    probes.append(_ok("R6-planted-hem-follows", "planted", 20,
                      deltas["20"]["ownHem"], 0.5))

    # -- R3: analytic step + planted hairline lift + unobserved columns.
    Ta = np.zeros((SIZE, SIZE), bool)
    Ta[150:301, 400:627] = True
    Oa = np.zeros((SIZE, SIZE), bool)
    Oa[150:313, 400:627] = True
    ra = r3_front(Oa, Ta, 513, 100, 400)
    probes.append(_ok("R3-analytic-12px", "analytic", 12.0,
                      ra["zones"]["midline"]["signedP50px"], 1e-9,
                      {"p95": ra["zones"]["midline"]["signedP95px"]}))
    probes.append(_ok("R3-reference-self", "analytic", 0.0,
                      r3_front(Ta, Ta, 513, 100, 400)["zones"]["midline"]["signedP50px"],
                      1e-9, {"note": "target-vs-itself is reference only"}))
    # unobserved: curtain cols (hair reaches brow) + empty cols excluded.
    Tu = np.zeros((SIZE, SIZE), bool)
    Tu[150:301, 400:627] = True
    Tu[301:400, 500:531] = True  # curtain: hair down to the brow row
    ru = r3_front(Tu, Tu, 513, 100, 400)
    probes.append(_ok("R3-unobserved-curtain", "analytic", 31,
                      (627 - 400) - ru["observedOurs"], 0,
                      {"note": "31 curtain cols UNOBSERVED, never zero error"}))
    # planted lift on the real current front hairline (skull frame).
    reg_f128, _ = register(cur128["front"], "front", hj, None, None, "skull")
    s1f = skull_run["r1"]["front"]["transform"]
    crown_t = int(round(s1f["scale"] * CROWN_ROW_RENDER["front"] + s1f["ty"]))
    brow_t = int(round(s1f["scale"] * BROW_ROW_RENDER["front"] + s1f["ty"]))
    base = r3_front(reg_f128, tgt["front"], 513, crown_t, brow_t)
    lifts = {}
    for mag in (6, 12, 18):
        lifted = reg_f128.copy()
        o_rows, o_obs = hairline_polyline(reg_f128, crown_t, brow_t,
                                          513 - 200, 513 + 200)
        for i, c in enumerate(range(513 - 200, 513 + 200)):
            if o_obs[i]:
                lifted[max(crown_t, o_rows[i] - mag):o_rows[i] + 1, c] = False
        rm = r3_front(lifted, tgt["front"], 513, crown_t, brow_t)
        lifts[str(mag)] = round(
            rm["zones"]["midline"]["signedP50px"]
            - base["zones"]["midline"]["signedP50px"], 2)
    probes.append(_ok("R3-planted-12px", "planted", -12.0, lifts["12"], 1.0,
                      {"baseMidP50": base["zones"]["midline"].get("signedP50px"),
                       "nObserved": base["zones"]["midline"].get("nObserved")}))
    probes.append({"id": "R3-monotonic-6-12-18", "kind": "monotonicity",
                   "measured": lifts,
                   "pass": bool(lifts["6"] > lifts["12"] > lifts["18"])})
    return probes
    try:
        passed = bool(abs(float(measured) - float(expected)) <= tol)
    except (TypeError, ValueError):
        passed = bool(measured == expected)
    d = {"id": pid, "kind": kind, "expected": expected, "measured": measured,
         "tol": tol, "pass": passed}
    if extra:
        d.update(extra)
    return d


def run_probes(manifest: dict, hj) -> list[dict]:
    probes = []
    tgt = {v: load_bool_mask(resolve(manifest, TARGET_MASK_KEY[v]), False)
           for v in ("front", "profile_90", "back")}
    cur230 = {v: load_bool_mask(resolve(manifest, f"current_{v}_id"), True, 230)
              for v in ("front", "profile_90", "back")}
    cur128 = {v: load_bool_mask(resolve(manifest, f"current_{v}_id"), True, 128)
              for v in ("profile_90",)}
    chin = TARGET_CHIN["front"]

    # -- R1 analytic: rect vs rect shifted 20 px below chin
    A = np.zeros((SIZE, SIZE), bool)
    A[500:701, 400:601] = True
    B = np.zeros((SIZE, SIZE), bool)
    B[500:608, 400:601] = True
    B[628:721, 400:601] = True
    st = r1_region_stats(B, A, chin)
    exp_below = (628 - 608 + 0)  # intersection rows 628..700
    inter, union = 73 * 201, 113 * 201
    probes.append(_ok("R1-analytic-above-iou", "analytic", 1.0, st["above"]["iou"], 1e-9))
    probes.append(_ok("R1-analytic-below-iou", "analytic", round(inter / union, 4),
                      st["below"]["iou"], 1e-9,
                      {"note": "73 shared rows / 113 union rows below chin"}))

    # -- R1 planted: shift below-chin part of the current mask by mag px and
    # compare against the UNSHIFTED current mask (self-comparison isolates the
    # shift from pre-existing target mismatch; nearest-contour distance is
    # then translation-equivariant). Below-chin absP95 must equal mag;
    # above-chin must be untouched (IoU 1.0, distance 0).
    reg, _ = register(cur230["front"], "front", hj)
    shifted = {}
    for mag in (5, 10, 15):
        sh = reg.copy()
        below = sh[chin:, :]
        tmp = np.zeros_like(below)
        tmp[mag:, :] = below[:-mag, :]
        sh[chin:, :] = tmp
        shifted[mag] = r1_region_stats(sh, reg, chin)
    for mag in (5, 10, 15):
        st = shifted[mag]
        probes.append(_ok(f"R1-planted-{mag}px-below", "planted", float(mag),
                          st["below"]["absP95px"], 1.0,
                          {"above_iou": st["above"]["iou"],
                           "above_absP95px": st["above"]["absP95px"]}))
    probes.append(_ok("R1-planted-above-stable", "planted", 1.0,
                      shifted[15]["above"]["iou"], 1e-9,
                      {"above_absP95px": shifted[15]["above"]["absP95px"],
                       "note": "above-chin untouched by below-chin shift"}))
    vals = [shifted[m]["below"]["absP95px"] for m in (5, 10, 15)]
    probes.append({"id": "R1-monotonic-5-10-15", "kind": "monotonicity",
                   "measured": [round(v, 2) for v in vals],
                   "pass": bool(vals[0] < vals[1] < vals[2])})

    # -- R4 analytic: half-covered rect region
    region = np.zeros((SIZE, SIZE), bool)
    region[400:501, 400:501] = True
    hair = np.zeros((SIZE, SIZE), bool)
    hair[400:501, 400:451] = True
    probes.append(_ok("R4-analytic-half", "analytic",
                      round(51 * 101 / (101 * 101), 4),
                      round(float((hair & region).sum() / region.sum()), 4), 1e-9))

    # -- R4 planted + monotonic on real profile data
    cap = np.load(str(resolve(manifest, "cap_v8")), allow_pickle=True)
    pts3d = pinna_points(cap)
    cur_score = json.loads(resolve(manifest, "current_score").read_text())
    mw = np.array(cur_score["render"]["cameras"]["profile_90"]["matrixWorld"])
    hair_p = cur128["profile_90"]
    proj = np.array([project_cam(p, mw) for p in pts3d])
    R = region_from_points(proj)
    cov0 = float((hair_p & R).sum() / R.sum())
    rpix = np.argwhere(R)
    order = np.argsort(rpix[:, 0])
    covs = {}
    for f in (0.1, 0.2, 0.3):
        n = int(len(order) * f)
        h2 = hair_p.copy()
        h2[rpix[order[:n]][:, 0], rpix[order[:n]][:, 1]] = False
        removed_hair = int((hair_p & ~h2 & R).sum())
        exp = (float((hair_p & R).sum()) - removed_hair) / R.sum()
        got = float((h2 & R).sum() / R.sum())
        covs[str(f)] = round(got, 4)
        probes.append(_ok(f"R4-planted-remove-{int(f*100)}pct", "planted",
                          round(exp, 4), round(got, 4), 1e-9,
                          {"drop": round(cov0 - got, 4)}))
    probes.append({"id": "R4-monotonic-10-20-30", "kind": "monotonicity",
                   "measured": covs,
                   "pass": bool(covs["0.1"] >= covs["0.2"] >= covs["0.3"] and
                                (covs["0.1"] - covs["0.3"]) > 0)})

    # -- R5 analytic: 20 px longer hem
    TA = np.zeros((SIZE, SIZE), bool)
    TA[100:701, 400:601] = True
    OA = np.zeros((SIZE, SIZE), bool)
    OA[100:721, 400:601] = True
    st = r5_view(OA, TA)
    probes.append(_ok("R5-analytic-ybottom", "analytic", 20.0, st["yBottomMAEpx"], 1e-9))
    probes.append(_ok("R5-analytic-width", "analytic",
                      round(201 * 20 / (SIZE - 460), 2), st["widthMAEpx"], 1e-9))

    # -- R5 planted: shift the back ID mask down by the 30 mm equivalent px
    # and compare against the UNSHIFTED mask (self-comparison: every hem
    # column bottom moves exactly +px, so yBottomMAE must equal px; vs-target
    # comparison folds sign mixing of pre-existing errors into |.|).
    # This is the mask-shift equivalent of +30 mm tip z from the brief.
    px30 = int(round(30.0 / MM_PER_PX))
    back_reg, _ = register(cur230["back"], "back", hj)
    sh30 = np.zeros_like(back_reg)
    sh30[px30:, :] = back_reg[:-px30, :]
    self30 = r5_view(sh30, back_reg)
    probes.append(_ok("R5-planted-30mm", "planted", round(px30 * MM_PER_PX, 2),
                      self30["yBottomMAEmm"], 2.0,
                      {"px30": px30, "yBottomMAEpx": self30["yBottomMAEpx"],
                       "note": "mask-shift equiv of +30mm tip z, self-comparison; tol 2mm"}))
    base5 = r5_view(back_reg, tgt["back"])
    shifts, maes = {}, {}
    for mm in (10.0, 20.0, 30.0):
        px = int(round(mm / MM_PER_PX))
        sh = np.zeros_like(back_reg)
        sh[px:, :] = back_reg[:-px, :]
        st = r5_view(sh, tgt["back"])
        shifts[str(mm)] = px
        maes[str(mm)] = st["yBottomMAEpx"]
    probes.append({"id": "R5-monotonic-10-20-30mm", "kind": "monotonicity",
                   "measured": maes, "shiftsPx": shifts,
                   "pass": bool(maes["10.0"] < maes["20.0"] < maes["30.0"])})
    # -- R5 parity: same inputs + same method as hem2's own c_curve run.
    # shape_scores_c_curve.json is the hem2-method output on scores/c_curve
    # (the brief's current inputs); parity must hold within 1 px.
    # shape_base.json was built from the older base/ renders, so it is
    # reported as a VALIDATION finding, not a parity gate.
    sc = json.loads(resolve(manifest, "shape_c_curve").read_text())
    sb = json.loads(resolve(manifest, "shape_base").read_text())
    cur_run = run_subject("current", manifest, hj, "raw")
    for view in ("front", "profile_90", "back"):
        for metric in ("yBottomMAEpx", "widthMAEpx"):
            probes.append(_ok(f"R5-parity-{view}-{metric}", "parity",
                              sc[view if view != "profile_90" else "profile_90"][metric],
                              cur_run["r5"][view][metric], 1.0))
    probes.append({"id": "R5-validation-shape-base-divergence", "kind": "validation",
                   "note": ("shape_base.json (base/ renders) vs c_curve "
                            "(scores/c_curve renders): back yBottom 21.58 vs "
                            f"{cur_run['r5']['back']['yBottomMAEpx']}px. Same method, "
                            "different inputs; parity gate uses shape_scores_c_curve.json."),
                   "shapeBaseBack": {k: sb["back"][k] for k in
                                     ("yBottomMAEpx", "widthMAEpx")},
                   "pass": True})
    # -- registration agreement: imported register_view vs stored transforms.
    # shape_base.json rounds to 4 decimals, so tols cover rounding (not math).
    for view in ("front", "profile_90", "back"):
        tr = cur_run["r1"][view]["transform"]
        stored = sb[view if view != "profile_90" else "profile_90"]["transform"]
        probes.append(_ok(f"agree-{view}-scale", "agreement", stored["scale"],
                          tr["scale"], 1e-4))
        probes.append(_ok(f"agree-{view}-tx", "agreement", stored["tx"],
                          tr["tx"], 1e-3))
        probes.append(_ok(f"agree-{view}-ty", "agreement", stored["ty"],
                          tr["ty"], 1e-3))
    probes.extend(run_probes_v4b(manifest, hj, cur_run))
    return probes


# ---------------------------------------------------------------- overlays

def outline_overlay(tgt: np.ndarray, ours_reg: np.ndarray, extra_lines=()) -> Image.Image:
    img = np.zeros((SIZE, SIZE, 3), np.uint8)
    img[tgt] = (70, 70, 70)
    for m, col in ((tgt, (0, 255, 0)), (ours_reg, (255, 60, 60))):
        c = contour_pts(m)
        img[c[:, 0], c[:, 1]] = col
    im = Image.fromarray(img)
    d = ImageDraw.Draw(im)
    for y, col in extra_lines:
        d.line([(0, y), (SIZE - 1, y)], fill=col, width=2)
    return im


# ---------------------------------------------------------------- v4b overlays

def build_overlays_v4b(manifest: dict, hj, reg_mode: str = "skull") -> Image.Image:
    """Overlay sheet: new rulers (R3/R6/R2) + R4 translucency. All panels in
    the registered target frame unless noted (R2 is a geometry schematic)."""
    tgt = {v: load_bool_mask(resolve(manifest, TARGET_MASK_KEY[v]), False)
           for v in ("front", "profile_90", "back")}
    cur128 = {v: load_bool_mask(resolve(manifest, f"current_{v}_id"), True, 128)
              for v in ("front", "profile_90")}
    panels = []
    # R3 front: target vs current hairline polylines + ROI bands.
    reg_f, trf = register(cur128["front"], "front", hj, RENDER_TRIPLE["front"],
                          None, reg_mode)
    crown_t = int(round(trf["scale"] * CROWN_ROW_RENDER["front"] + trf["ty"]))
    brow_t = int(round(trf["scale"] * BROW_ROW_RENDER["front"] + trf["ty"]))
    c0, c1 = 513 - 200, 513 + 200
    o_rows, o_obs = hairline_polyline(reg_f, crown_t, brow_t, c0, c1)
    t_rows, t_obs = hairline_polyline(tgt["front"], crown_t, brow_t, c0, c1)
    img = np.zeros((SIZE, SIZE, 3), np.uint8)
    img[tgt["front"]] = (60, 60, 60)
    img[reg_f] = (90, 40, 40)
    im = Image.fromarray(img)
    d = ImageDraw.Draw(im)
    for band, col in ((50, (0, 255, 0)), (130, (255, 255, 0)), (200, (255, 140, 0))):
        d.rectangle([513 - band, crown_t, 513 + band, brow_t], outline=col)
    for xs, obs, col in ((o_rows, o_obs, (255, 60, 60)),
                         (t_rows, t_obs, (0, 255, 0))):
        for i, c in enumerate(range(c0, c1)):
            if obs[i]:
                d.ellipse([c - 1, xs[i] - 1, c + 1, xs[i] + 1], fill=col)
    panels.append(("R3 front(%s): green=tgt red=cur hairline; boxes=mid/brow/temple ROI"
                   % reg_mode, im))
    # R4 translucency: pinna region, skin-visible pixels in yellow.
    cap = np.load(str(resolve(manifest, "cap_v8")), allow_pickle=True)
    cur_score = json.loads(resolve(manifest, "current_score").read_text())
    mw = np.array(cur_score["render"]["cameras"]["profile_90"]["matrixWorld"])
    region = r4_view(cur128["profile_90"], mw,
                     pinna_points(cap))["_region"]
    bcur = load_beauty_rgb(resolve(manifest, "current_profile_90_beauty"))
    refs = skin_hair_refs(bcur, load_bool_mask(
        resolve(manifest, "current_profile_90_id"), True, 230))
    skinlike = (np.abs(bcur - np.array(refs["skin"])).sum(-1)
                < np.abs(bcur - np.array(refs["hair"])).sum(-1))
    img4 = np.zeros((SIZE, SIZE, 3), np.uint8)
    img4[cur128["profile_90"]] = (70, 70, 70)
    img4[region & cur128["profile_90"]] = (0, 140, 0)
    img4[region & cur128["profile_90"] & skinlike] = (255, 255, 0)
    c = contour_pts(region)
    img4[c[:, 0], c[:, 1]] = (0, 255, 255)
    f = skin_visible_frac(bcur, cur128["profile_90"], region,
                          np.array(refs["skin"]), np.array(refs["hair"]))
    panels.append(("R4 profile translucency: yellow=skin-visible-in-hair "
                   "frac=%.4f skin=%s hair=%s"
                   % (f["skinVisibleFracHair"], refs["skin"], refs["hair"]),
                   Image.fromarray(img4)))
    # R6 profile: shoulder + hem rows with gap segments (registered frame).
    reg_p, trp = register(cur128["profile_90"], "profile_90", hj,
                          RENDER_TRIPLE["profile_90"], None, reg_mode)
    s, tx, ty = trp["scale"], trp["tx"], trp["ty"]
    b = load_beauty_rgb(resolve(manifest, "current_profile_90_beauty"))
    a = np.array(Image.open(resolve(manifest, "current_profile_90_id")))[:, :, 3]
    inv = (1.0 / s, 0.0, -tx / s, 0.0, 1.0 / s, -ty / s)
    bm = Image.fromarray((body_mask(b, a).astype(np.uint8) * 255))
    body_reg = np.array(bm.transform((SIZE, SIZE), Image.AFFINE, inv,
                                     Image.NEAREST)) > 127
    img6 = np.zeros((SIZE, SIZE, 3), np.uint8)
    img6[tgt["profile_90"]] = (60, 60, 60)
    img6[reg_p] = (90, 40, 40)
    img6[body_reg] = (40, 40, 120)
    im6 = Image.fromarray(img6)
    d6 = ImageDraw.Draw(im6)
    sh_t = int(round(s * SHOULDER_ROW_RENDER_PROFILE + ty))
    hem_t = hem_bottom_row(reg_p)
    for row in (sh_t, hem_t):
        hp = posterior_edge(reg_p, row)
        bp = posterior_edge(body_reg, row)
        d6.line([(0, row), (SIZE - 1, row)], fill=(255, 255, 0), width=1)
        if hp is not None and bp is not None:
            d6.line([(bp, row), (hp, row)], fill=(0, 255, 255), width=3)
    panels.append(("R6 profile(%s): yellow=shoulder/hem rows cyan=hair-body gap"
                   % reg_mode, im6))
    # R2 schematic: cap boundary front arc (x-y, metres->mm) + nearest roots.
    r2c = run_r2(manifest)
    cap8 = np.load(str(resolve(manifest, "cap_v8")), allow_pickle=True)
    BV = cap_front_boundary(cap8)
    F = BV[BV[:, 1] < R2_FRONT_Y]
    spread = np.load(str(resolve(manifest, "spread")), allow_pickle=True)
    R = np.asarray(spread["roots"], dtype=float)
    sel = np.random.default_rng(0).choice(len(R), size=min(3000, len(R)),
                                replace=False)
    Rs = R[sel]
    sc = 1400.0
    ox, oy = 512 - sc * float(np.median(F[:, 0])), 700 - sc * float(np.median(F[:, 1]))
    img2 = Image.new("RGB", (SIZE, SIZE), (8, 8, 8))
    d2 = ImageDraw.Draw(img2)
    for p in Rs:
        d2.point([ox + sc * p[0], oy + sc * p[1]], fill=(90, 90, 160))
    for p in F:
        z = "midline" if abs(p[0]) <= 0.01 else "temple"
        d2.ellipse([ox + sc * p[0] - 2, oy + sc * p[1] - 2,
                    ox + sc * p[0] + 2, oy + sc * p[1] + 2],
                   fill=(0, 255, 0) if z == "midline" else (255, 255, 0))
    z = r2c["parity_capV8_spread"]["zones"]["midline"]
    d2.text((8, 6), "R2 cap-v8+spread: blue=roots(teal) green=midline-bnd "
                    "yellow=temple-bnd midline p50=%.2fmm" % z["distP50mm"],
            fill=(255, 255, 255))
    panels.append(("R2 geometry schematic (x-y mm, not to registered scale)", img2))
    W, H = SIZE, SIZE + 28
    sheet = Image.new("RGB", (W, H * len(panels)), (10, 10, 10))
    d = ImageDraw.Draw(sheet)
    for i, (label, p) in enumerate(panels):
        if p.size != (SIZE, SIZE):
            p = p.resize((SIZE, SIZE))
        sheet.paste(p, (0, i * H + 28))
        d.text((8, i * H + 6), label, fill=(255, 255, 255))
    return sheet


# ---------------------------------------------------------------- v4b table + battery

def _fmt_cur(v, unit):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "n/a"
    return f"{v} {unit}"


def build_table(subjects: dict, probes: dict, delta: dict) -> tuple[str, dict]:
    """Extended table: v4a-frozen raw rows + skull-mode R1/R5 rows + R4b/R2/R6/R3."""
    raw, skull = subjects["raw"], subjects["skull"]
    rows = []
    # v4a-frozen rows (raw), verbatim numbers from the raw subjects.
    for view, vlabel in (("front", "front"), ("profile_90", "profile"),
                         ("back", "back")):
        r = raw["current"]["r1"][view]
        rp = raw["previous"]["r1"][view]
        rt = raw["target"]["r1"][view]
        chin = "chin" if view != "back" else "chin-equiv"
        for region in ("above", "below"):
            rows.append({
                "row": f"r1.{view}.{region}.iou", "ruler": "R1", "view": vlabel,
                "metric": f"{chin} IoU", "reg": "raw(frozen)",
                "target": rt[region]["iou"], "current": r[region]["iou"],
                "previous": rp[region]["iou"], "class": "HARD_GATE",
                "threshold": ">=0.95",
                "verdict": "PASS" if r[region]["iou"] >= 0.95 else "FAIL"})
        for region in ("above", "below"):
            for m, th in (("absP95px", 10.0),):
                rows.append({
                    "row": f"r1.{view}.{region}.absP95", "ruler": "R1",
                    "view": vlabel, "metric": f"{region} contour absP95",
                    "reg": "raw(frozen)",
                    "target": f"{rt[region][m]} px / 0.0 mm",
                    "current": f"{r[region][m]} px / {r[region]['absP95mm']} mm",
                    "previous": f"{rp[region][m]} px / {rp[region]['absP95mm']} mm",
                    "class": "HARD_GATE", "threshold": "<=10 px",
                    "verdict": "PASS" if r[region][m] <= th else "FAIL"})
    # skull-mode R1 rows (new standard).
    for view, vlabel in (("front", "front"), ("profile_90", "profile"),
                         ("back", "back")):
        r = skull["current"]["r1"][view]
        rp = skull["previous"]["r1"][view]
        rt = skull["target"]["r1"][view]
        chin = "chin" if view != "back" else "chin-equiv"
        for region in ("above", "below"):
            rows.append({
                "row": f"r1.{view}.{region}.iou.skull", "ruler": "R1",
                "view": vlabel, "metric": f"{chin} IoU", "reg": "skull",
                "target": rt[region]["iou"], "current": r[region]["iou"],
                "previous": rp[region]["iou"], "class": "HARD_GATE",
                "threshold": ">=0.95",
                "verdict": "PASS" if r[region]["iou"] >= 0.95 else "FAIL"})
        for region in ("above", "below"):
            rows.append({
                "row": f"r1.{view}.{region}.absP95.skull", "ruler": "R1",
                "view": vlabel, "metric": f"{region} contour absP95",
                "reg": "skull",
                "target": f"{rt[region]['absP95px']} px / 0.0 mm",
                "current": f"{r[region]['absP95px']} px / {r[region]['absP95mm']} mm",
                "previous": f"{rp[region]['absP95px']} px / {rp[region]['absP95mm']} mm",
                "class": "HARD_GATE", "threshold": "<=10 px",
                "verdict": "PASS" if r[region]["absP95px"] <= 10.0 else "FAIL"})
    # R5 rows: raw frozen + skull.
    for view, vlabel in (("front", "front"), ("profile_90", "profile"),
                         ("back", "back")):
        for mode, S in (("raw(frozen)", raw), ("skull", skull)):
            r, rp = S["current"]["r5"][view], S["previous"]["r5"][view]
            for m, mlabel in (("yBottomMAEpx", "yBottom MAE"),
                              ("widthMAEpx", "width MAE")):
                mm = r["yBottomMAEmm"] if "yBottom" in m else r["widthMAEmm"]
                mmp = rp["yBottomMAEmm"] if "yBottom" in m else rp["widthMAEmm"]
                rows.append({
                    "row": f"r5.{view}.{m}.{'skull' if mode=='skull' else 'raw'}",
                    "ruler": "R5", "view": vlabel, "metric": mlabel,
                    "reg": mode, "target": "0.0 px / 0.0 mm",
                    "current": f"{r[m]} px / {mm} mm",
                    "previous": f"{rp[m]} px / {mmp} mm",
                    "class": "HARD_GATE", "threshold": "<=10 px",
                    "verdict": "PASS" if r[m] <= 10.0 else "FAIL"})
    # R4 rows: multi-threshold + translucency (ADVISORY).
    S = skull
    for vkey, vlabel in (("profile_90", "profile"),):
        r, rp, rt = (S["current"]["r4"][vkey], S["previous"]["r4"][vkey],
                     S["target"]["r4"][vkey])
        cov = r.get("coverageByThreshold", {})
        rows.append({
            "row": "r4.profile.coverage.30-128-230", "ruler": "R4",
            "view": vlabel, "metric": "pinna coverage @30/128/230", "reg": "n/a",
            "target": rt.get("targetCoverage"),
            "current": f"{cov.get('30')}/{cov.get('128')}/{cov.get('230')}",
            "previous": "/".join(str(x) for x in
                                 rp.get("coverageByThreshold", {}).values()),
            "class": "ADVISORY", "threshold": "report-only",
            "verdict": "--"})
        sv = r.get("skinVisibleFrac", {})
        svp = rp.get("skinVisibleFrac", {})
        rows.append({
            "row": "r4.profile.skinVisible", "ruler": "R4", "view": vlabel,
            "metric": "skin-visible frac in hair (skin %s; hair %s)"
                      % (r.get("skinRef"), r.get("hairRef")), "reg": "n/a",
            "target": "n/a (no target beauty)",
            "current": sv.get("skinVisibleFracHair"),
            "previous": svp.get("skinVisibleFracHair"),
            "class": "ADVISORY", "threshold": "report-only", "verdict": "--"})
    r3q, r3qp = S["current"]["r4"]["three_quarter"], S["previous"]["r4"]["three_quarter"]
    rows.append({"row": "r4.3q.coverage", "ruler": "R4", "view": "three_quarter",
                 "metric": "pinna coverage, ours only", "reg": "n/a",
                 "target": "n/a, no registered target",
                 "current": r3q.get("coverage"), "previous": r3qp.get("coverage"),
                 "class": "ADVISORY", "threshold": "report-only", "verdict": "--"})
    # R2 rows (geometry; target N/A).
    r2c = S["current"]["r2"]["current_capV7_cCurve"]["zones"]
    r2p = S["previous"]["r2"]["previous_capV7_cBest8"]["zones"]
    r2par = S["current"]["r2"]["parity_capV8_spread"]["zones"]
    for zone, th in (("midline", 5.0), ("temple_L", 10.0), ("temple_R", 10.0)):
        cv = r2c[zone].get("distP50mm")
        pv = r2p[zone].get("distP50mm")
        rows.append({
            "row": f"r2.{zone}.p50", "ruler": "R2", "view": zone,
            "metric": "boundary-to-root p50 (cap-v7 + lineage strands)",
            "reg": "n/a", "target": "N/A (geometry)",
            "current": f"{cv} mm (gap {r2c[zone].get('gapMm')} mm)" if cv is not None else "n/a",
            "previous": f"{pv} mm (gap {r2p[zone].get('gapMm')} mm)" if pv is not None else "n/a",
            "class": "HARD_GATE", "threshold": f"<={th} mm",
            "verdict": ("PASS" if (cv is not None and cv <= th) else "FAIL")})
    rows.append({"row": "r2.parity.firstRoot", "ruler": "R2", "view": "midline",
                 "metric": "parity midline firstRootYmm (cap-v8+spread)",
                 "reg": "n/a", "target": "crown4 -121.9 mm",
                 "current": f"{r2par['midline'].get('firstRootYmm')} mm",
                 "previous": "same inputs (shared)",
                 "class": "HARD_GATE", "threshold": "+-1 mm",
                 "verdict": ("PASS" if abs(r2par["midline"].get("firstRootYmm", 0)
                                           + 121.9) <= 1.0 else "FAIL")})
    # R6 rows.
    for rname, rlabel in (("shoulderPlane", "shoulder-plane row"),
                          ("ownHem", "own-hem row")):
        gc = S["current"]["r6"]["rows"][rname]
        gp = S["previous"]["r6"]["rows"][rname]
        gt = S["target"]["r6"]["rows"][rname]
        dcur = (gc["gapPx"] - gt["gapPx"]) if (gc["gapPx"] is not None
                                               and gt["gapPx"] is not None) else None
        if rname == "shoulderPlane":
            metric = f"posterior gap @ {rlabel} (row {gc['row']}, common)"
        else:
            metric = (f"posterior gap @ {rlabel} (tgt row {gt['row']} / "
                      f"cur row {gc['row']} / prev row {gp['row']})")
        rows.append({
            "row": f"r6.{rname}.gap", "ruler": "R6", "view": "profile",
            "metric": metric,
            "reg": "skull", "target": f"{gt['gapPx']} px / {gt['gapMm']} mm (ref)",
            "current": f"{gc['gapPx']} px / {gc['gapMm']} mm",
            "previous": f"{gp['gapPx']} px / {gp['gapMm']} mm",
            "class": "HARD_GATE", "threshold": "|ours-tgt|<=5 px",
            "verdict": ("PASS" if (dcur is not None and abs(dcur) <= 5) else "FAIL")})
    # R3 rows.
    for zname in ("midline", "brow_L", "brow_R", "temple_L", "temple_R"):
        zc = S["current"]["r3"]["front"]["zones"][zname]
        zp = S["previous"]["r3"]["front"]["zones"][zname]
        cv, pv = zc.get("signedP50px"), zp.get("signedP50px")
        av = zc.get("absP95px")
        nobs = zc.get("nObserved", 0)
        if nobs == 0:
            verdict = "UNOBSERVED"  # curtain reaches the brow in target too:
            cur_s, prev_s = "UNOBSERVED", "UNOBSERVED"  # never zero error
        else:
            verdict = ("PASS" if (cv is not None and abs(cv) <= 3
                                  and av is not None and av <= 10) else "FAIL")
            cur_s = f"{cv} px" if cv is not None else "UNOBSERVED"
            prev_s = f"{pv} px" if pv is not None else "UNOBSERVED"
        rows.append({
            "row": f"r3.front.{zname}.p50", "ruler": "R3", "view": "front",
            "metric": f"signed hairline p50 {zname} (n={zc.get('nObserved')})",
            "reg": "skull", "target": "0.0 px (ref)",
            "current": cur_s,
            "previous": prev_s,
            "class": "HARD_GATE", "threshold": "|p50|<=3 px and absP95<=10 px",
            "verdict": verdict})
    tq3 = S["current"]["r3"]["three_quarter"]
    rows.append({"row": "r3.3q.observed", "ruler": "R3", "view": "three_quarter",
                 "metric": "hairline observed fraction, ours only", "reg": "n/a",
                 "target": "n/a (no 3q target)",
                 "current": f"{tq3.get('observed')}/{tq3.get('nCols')} "
                            f"(p50 row {tq3.get('hairlineP50row')})",
                 "previous": f"{S['previous']['r3']['three_quarter'].get('observed')}/"
                             f"{S['previous']['r3']['three_quarter'].get('nCols')}",
                 "class": "ADVISORY", "threshold": "report-only", "verdict": "--"})
    md = ["# Hair rulers v4b — extended table (R1/R4/R5 + R2/R6/R3, FIX A/B)",
          "",
          "Subjects: target = reference (target-vs-itself where defined); "
          "current = hem2 `scores/c_curve`; previous = hem1 `scores/c_best8`.",
          "Registration: default skull (scorer orientation; front +10 mm offset, "
          "scale 0.9545); v4a-frozen rows keep raw (front 1.0021). "
          "Skull reproduces all three score.json orientation transforms within "
          "1e-6 (probes A-skull-*); profile/back are mode-invariant (probe "
          "A-profile-mode-invariant). Local mm: 0.4599 mm/px.",
          "",
          "Thresholds derive from the TARGET value plus probe noise only "
          "(R1 IoU >=0.95; R1/R5/R6 distances <=10/10/5 px; R3 |p50|<=3 px = "
          "3x the +-1 px plant resolution with absP95<=10 px tail guard as in "
          "R1; R2 midline <=5 mm = 10x the 0.5 mm plant resolution, an order "
          "of magnitude below the diagnosed 21-26 mm defect), never fitted "
          "to either groom. R4/R3-3q are ADVISORY (no target beauty / no 3q "
          "target); R3 temple zones are UNOBSERVED (curtain reaches the brow "
          "in the target too), never zero error and non-blocking.",
          "",
          "| row | ruler | view | metric | reg | target | current | previous | class | threshold | current |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        md.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            r["row"], r["ruler"], r["view"], r["metric"], r["reg"], r["target"],
            r["current"], r["previous"], r["class"], r["threshold"], r["verdict"]))
    md.append("")
    md.append("Registration delta (current, skull - raw): front IoU/scales move "
              "with the 22.83 px crown shift; profile/back deltas are exactly 0 "
              "(shared triple). Full per-row deltas: RESULT.txt + table.json "
              "`registrationDelta`.")
    return "\n".join(md) + "\n", {"rows": rows, "registrationDelta": delta,
                                  "nProbes": probes["nTotal"],
                                  "nProbesPass": probes["nPass"]}


def run_reg_compare(manifest: dict, hj) -> dict:
    """R1/R5 under both registrations for current+previous: per-row deltas."""
    out = {"note": ("skull - raw, per row. Front moves (target crown +22.83 px); "
                    "profile/back share the raw triple in skull mode, delta 0."),
           "subjects": {}}
    for subject in ("current", "previous"):
        s_raw = run_subject(subject, manifest, hj, "raw")
        s_sk = run_subject(subject, manifest, hj, "skull")
        d = {"transforms": {}, "r1": {}, "r5": {}}
        for view in ("front", "profile_90", "back"):
            d["transforms"][view] = {
                k: round(s_sk["r1"][view]["transform"][k]
                         - s_raw["r1"][view]["transform"][k], 6)
                for k in ("scale", "tx", "ty")}
            for region in ("above", "below"):
                d["r1"][f"{view}.{region}.iou"] = round(
                    s_sk["r1"][view][region]["iou"]
                    - s_raw["r1"][view][region]["iou"], 4)
                d["r1"][f"{view}.{region}.absP95px"] = round(
                    s_sk["r1"][view][region]["absP95px"]
                    - s_raw["r1"][view][region]["absP95px"], 2)
            for m in ("yBottomMAEpx", "widthMAEpx"):
                d["r5"][f"{view}.{m}"] = round(
                    s_sk["r5"][view][m] - s_raw["r5"][view][m], 2)
        out["subjects"][subject] = d
    return out


def run_battery(manifest_path: str, out_dir: str, hj=None) -> dict:
    manifest = json.load(open(manifest_path))
    hj = hj or load_hair_judge(manifest)
    os.makedirs(out_dir, exist_ok=True)
    subjects = {"skull": {}, "raw": {}}
    for mode in ("skull", "raw"):
        for subject in ("target", "current", "previous"):
            if mode == "raw" and subject == "target":
                continue  # identity under both modes; skull copy reused
            res = run_subject(subject, manifest, hj, mode)
            p = os.path.join(out_dir, f"subject-{subject}-{mode}.json")
            with open(p, "w") as f:
                json.dump(res, f, indent=1)
            subjects[mode][subject] = res
            print(f"wrote {p}")
    subjects["raw"]["target"] = subjects["skull"]["target"]
    probes = run_probes(manifest, hj)
    fails = [p["id"] for p in probes if not p["pass"]]
    pj = {"probes": probes, "pass": len(fails) == 0,
          "nPass": sum(1 for p in probes if p["pass"]), "nTotal": len(probes)}
    with open(os.path.join(out_dir, "probes.json"), "w") as f:
        json.dump(pj, f, indent=1)
    print(f"probes {pj['nPass']}/{pj['nTotal']}" + (f" FAIL: {fails}" if fails else ""))
    delta = run_reg_compare(manifest, hj)
    with open(os.path.join(out_dir, "reg-delta.json"), "w") as f:
        json.dump(delta, f, indent=1)
    md, tj = build_table(subjects, pj, delta)
    with open(os.path.join(out_dir, "table.md"), "w") as f:
        f.write(md)
    with open(os.path.join(out_dir, "table.json"), "w") as f:
        json.dump(tj, f, indent=1)
    sheet = build_overlays_v4b(manifest, hj)
    sheet.save(os.path.join(out_dir, "overlays.png"))
    print(f"wrote table + overlays {sheet.size}")
    return {"subjects": list(subjects["skull"]), "probes": pj,
            "fails": fails, "delta": delta}


def build_overlays(manifest: dict, hj) -> Image.Image:
    """v4a overlay sheet, kept verbatim (frozen)."""
    tgt = {v: load_bool_mask(resolve(manifest, TARGET_MASK_KEY[v]), False)
           for v in ("front", "profile_90", "back")}
    cur230 = {v: load_bool_mask(resolve(manifest, f"current_{v}_id"), True, 230)
              for v in ("front", "back")}
    cur128 = load_bool_mask(resolve(manifest, "current_profile_90_id"), True, 128)
    panels = []
    # R1: front regional (chin split)
    reg_f, _ = register(cur230["front"], "front", hj)
    p1 = outline_overlay(tgt["front"], reg_f, [(TARGET_CHIN["front"], (255, 255, 0))])
    panels.append(("R1 front: green=target red=current yellow=TARGETchin608", p1))
    # R4: profile pinna region
    cap = np.load(str(resolve(manifest, "cap_v8")), allow_pickle=True)
    pts3d = pinna_points(cap)
    cur_score = json.loads(resolve(manifest, "current_score").read_text())
    mw = np.array(cur_score["render"]["cameras"]["profile_90"]["matrixWorld"])
    proj = np.array([project_cam(p, mw) for p in pts3d])
    region = region_from_points(proj)
    img = np.zeros((SIZE, SIZE, 3), np.uint8)
    img[cur128] = (70, 70, 70)
    img[region & cur128] = (0, 140, 0)
    c = contour_pts(region)
    img[c[:, 0], c[:, 1]] = (0, 255, 255)
    panels.append(("R4 profile: cyan=pinna-region green=covered gray=hair", Image.fromarray(img)))
    # R5: back hem (lower40)
    reg_b, _ = register(cur230["back"], "back", hj)
    rows_t = np.where(tgt["back"].any(axis=1))[0]
    lo = int(round(int(rows_t.min()) + 0.6 * (int(rows_t.max()) - int(rows_t.min()))))
    p3 = outline_overlay(tgt["back"], reg_b, [(lo, (0, 180, 255))])
    panels.append(("R5 back: green=target red=current blue=lower40-top", p3))
    W, H = SIZE, SIZE + 28
    sheet = Image.new("RGB", (W, H * len(panels)), (10, 10, 10))
    d = ImageDraw.Draw(sheet)
    for i, (label, p) in enumerate(panels):
        sheet.paste(p, (0, i * H + 28))
        d.text((8, i * H + 6), label, fill=(255, 255, 255))
    return sheet


# ---------------------------------------------------------------- CLI

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture-manifest", required=True)
    ap.add_argument("--registration", choices=("raw", "skull"), default="skull")
    ap.add_argument("--subject", choices=("target", "current", "previous"), default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--probes-out", default=None)
    ap.add_argument("--overlay-out", default=None)
    ap.add_argument("--reg-compare-out", default=None)
    ap.add_argument("--battery-out", default=None)
    args = ap.parse_args()
    manifest = json.load(open(args.fixture_manifest))
    hj = load_hair_judge(manifest)
    if args.subject and args.out:
        res = run_subject(args.subject, manifest, hj, args.registration)
        with open(args.out, "w") as f:
            json.dump(res, f, indent=1)
        print(f"wrote {args.out} subject={args.subject} reg={args.registration}")
    if args.probes_out:
        probes = run_probes(manifest, hj)
        fails = [p["id"] for p in probes if not p["pass"]]
        with open(args.probes_out, "w") as f:
            json.dump({"probes": probes,
                       "pass": len(fails) == 0,
                       "nPass": sum(1 for p in probes if p["pass"]),
                       "nTotal": len(probes)}, f, indent=1)
        print(f"wrote {args.probes_out} {len(probes)-len(fails)}/{len(probes)} pass"
              + (f" FAIL: {fails}" if fails else ""))
    if args.overlay_out:
        sheet = build_overlays_v4b(manifest, hj, args.registration)
        sheet.save(args.overlay_out)
        print(f"wrote {args.overlay_out} {sheet.size}")
    if args.reg_compare_out:
        delta = run_reg_compare(manifest, hj)
        with open(args.reg_compare_out, "w") as f:
            json.dump(delta, f, indent=1)
        print(f"wrote {args.reg_compare_out}")
    if args.battery_out:
        run_battery(args.fixture_manifest, args.battery_out, hj)


if __name__ == "__main__":
    main()
