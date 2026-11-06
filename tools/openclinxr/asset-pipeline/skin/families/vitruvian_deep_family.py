"""Fourth skin family `deep`: topology-free region-aware remap of a light family.

Method (recorded in the manifest):
  a) linear-RGB multiply of the whole family by k = African_cheek_rgb /
     family_cheek_rgb (per channel; African cheek from the Vitruvian
     chroma-table; family cheek = linear mean inside the skin_layers cheek
     hard mask);
  b) per region r in {lip, ear}: add the Vitruvian residual
     dLab_r = African_sep_r - family_after_multiply_sep_r (target method,
     Lab) in Lab inside r's hard mask with the skin_layers
     inward feather; the lip residual's L COMPONENT additionally tapers to 0
     at the two commissures (r8 L-only row taper: smoothstep 0->1 over N rows
     from either mask row extreme; a*/b* keep full r5 weight);
     nose is a CONTROL (vitruvian_dark gate-result.md: GO earned on lip+ear,
     nose control per GATE G2): nose is measured and reported, keeps the
     cheek multiply, no residual. Texels outside every applied mask keep
     step (a) bytes bit-exactly.

Lab/CIEDE2000 and mask derivation are reused, not reimplemented:
tone-check.py (sRGB transfer), fix_lips lab_to_rgb/rgb_to_lab,
skin_layers build_masks/soft_inside/load_mask (cheek boxes + nose disc from
landmarks; lip/ear/facecore masks from the derive dir).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "face-replay"))
sys.path.insert(0, str(HERE))
from fix_lips import lab_to_rgb, rgb_to_lab  # noqa: E402
import skin_layers as sl  # noqa: E402
from PIL import ImageFilter  # noqa: E402

STORE = Path("/Volumes/files/openclinxr-assets/store")
CHROMA = HERE.parent / "vitruvian_dark" / "chroma-table.json"
TONE_REPORT = HERE / "tone-report.json"
FAMILIES = {
    "young": "skin-families/young/young-family-v3.png",
    "middle": "skin-families/middle/middle-family-v4.png",
    "old": "skin-families/old/old-family-v2.png",
}
REGIONS = ("lip", "ear", "nose", "forehead")
# r5: nose is a CONTROL (vitruvian_dark gate-result.md GO on lip+ear only).
# The target method corrects APPLIED only; nose is measured/reported, keeps (a).
APPLIED_REGIONS = ("lip", "ear")
MEASURED_REGIONS = ("lip", "ear", "nose")
R5_DECISION = ("r5: nose back to control per st-vitdark gate G2 "
               "(go earned on lip+ear; nose control retained in table); "
               "residual set {lip, ear} only, nose keeps cheek multiply; "
               "lip b* +0.317 over 2xSD accepted as feather dilution (r4 analysis)")
# r8: the lip residual's L COMPONENT tapers to 0 around the two mouth-corner
# ROWS only. Cause (r7 forensics): dLab_lip = (+6.31, -2.78, -3.49); its L term
# (+6.3) lands on the commissure skin the hard lip mask covers, across a ~30-row
# plateau per corner. The crescent is an L defect; a*/b* hold the lip-chroma
# gates, so the a*/b* weight stays exactly r5 (full soft_inside, no erosion,
# no disc taper) and only the L weight fades near the corners. Corners are the
# mask ROW extremes (axis corrected r7: rows run horizontal per v4/v1 renders;
# max-row end = LEFT corner, min-row end = RIGHT corner). Ear = r5 feather
# (soft_inside of full hard ear); the r6 handback's ear change was a mistake.
R8_DECISION = ("r8: lip L weight = soft_inside(full hard lip) * row-factor "
               "(smoothstep 0 at either corner row extreme, 1 at >= N rows "
               "away); lip a*/b* weight = soft_inside(full hard lip) uncut; "
               "ear = r5 feather (soft_inside of full hard ear, no erosion)")
LIP_L_TAPER_ROWS = 32


def corner_points(hard: np.ndarray) -> list[tuple[int, int]]:
    """Mouth-corner points from the mask: (end-row mid col, end row) per side.

    The lip UV island's ROW axis runs horizontally across the face (proven by
    v4/v1 debug renders: row bands render as vertical bars), so the left and
    right commissures are the min/max ROWS containing mask texels (pointed
    ends ~10 texels wide), never literal coordinates. The corner col is the
    mean col of texels in that single outermost row. Screen mapping per v4
    chromaticity: max-row end = LEFT corner, min-row end = RIGHT corner."""
    rows = np.where(hard > 0.5)[0]
    r0, r1 = int(rows.min()), int(rows.max())
    pts = []
    for re in (r0, r1):
        cols = np.where(hard[re] > 0.5)[0]
        pts.append((int(round(float(cols.mean()))), re))
    return pts


def corner_disc_taper(hard: np.ndarray, r0: float = 6.0, r1: float = 10.0) -> np.ndarray:
    """Taper to 0 near the mouth-corner points only (r7; SUPERSEDED by r8).

    Retained for --lip-r0/--lip-r1 CLI compat; r8 no longer calls it. Returns
    smoothstep(0 within r0 texels of either corner point, 1 beyond r1)."""
    assert r1 > r0, (r0, r1)
    yy, xx = np.mgrid[0:hard.shape[0], 0:hard.shape[1]]
    dist = np.full(hard.shape, np.inf)
    for cx, cy in corner_points(hard):
        dist = np.minimum(dist, np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2))
    t = np.clip((dist - r0) / (r1 - r0), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)) * (hard > 0.5).astype(np.float64)


def lip_l_row_factor(
    hard: np.ndarray, n_rows_right: float, n_rows_left: float | None = None
) -> np.ndarray:
    """Side-specific row-distance smoothsteps for the lip L residual.

    The runtime RIGHT corner is the minimum mask-row extreme and the runtime
    LEFT corner is the maximum (r7 axis correction). Each side is 0 at its
    corner, 1 at or beyond its configured row distance, and smoothstep
    between. A side with N <= 0 contributes factor 1. Passing only the first
    value retains the legacy symmetric-call behaviour.
    """
    if n_rows_left is None:
        n_rows_left = n_rows_right
    rows = np.where((hard > 0.5).any(axis=1))[0]
    r0, r1 = int(rows.min()), int(rows.max())
    yy = np.mgrid[0:hard.shape[0], 0:hard.shape[1]][0].astype(np.float64)

    def side_factor(distance: np.ndarray, n_rows: float) -> np.ndarray:
        if n_rows <= 0:
            return np.ones_like(hard)
        t = np.clip(distance / float(n_rows), 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)

    right = side_factor(np.abs(yy - float(r0)), n_rows_right)
    left = side_factor(np.abs(yy - float(r1)), n_rows_left)
    return right * left


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)


def forehead_hard() -> np.ndarray:
    """Shared forehead: skin_layers.forehead_disc (build_roughness disc)."""
    return sl.forehead_disc()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=STORE / "skin-families/deep/deep-family.png")
    ap.add_argument("--preview", type=Path, default=None)
    ap.add_argument("--manifest", type=Path, default=None)
    ap.add_argument("--no-residual", action="store_true")
    ap.add_argument("--method", choices=("transfer", "target"), default="target",
                    help="transfer=r3 Vitruvian-relative residual (reproduces 33c5f621); target=African separation minus family-after-multiply separation (default)")
    ap.add_argument("--lip-r0", type=float, default=6.0,
                    help="r7 compat, ignored by r8 (disc taper superseded)")
    ap.add_argument("--lip-r1", type=float, default=10.0,
                    help="r7 compat, ignored by r8 (disc taper superseded)")
    ap.add_argument("--lip-l-taper", type=float, default=LIP_L_TAPER_ROWS,
                    help="r8: rows over which the lip L residual fades to 0 at the commissures (0 = off, = r5)")
    ap.add_argument("--lip-l-taper-right", type=float, default=None,
                    help="rows for the runtime RIGHT/min-row corner (defaults to --lip-l-taper)")
    ap.add_argument("--lip-l-taper-left", type=float, default=None,
                    help="rows for the runtime LEFT/max-row corner (defaults to --lip-l-taper)")
    a = ap.parse_args()
    lip_l_taper_right = a.lip_l_taper if a.lip_l_taper_right is None else a.lip_l_taper_right
    lip_l_taper_left = a.lip_l_taper if a.lip_l_taper_left is None else a.lip_l_taper_left

    for p in (a.out, a.preview or a.out.parent / "deep-family-preview.png",
              a.manifest or a.out.parent / "deep-manifest.json"):
        if p.exists():
            print(f"REFUSE: target exists (write-once STORE): {p}", flush=True)
            sys.exit(2)

    chroma = json.loads(CHROMA.read_text())
    afr = {r: np.array(chroma["african"][r]["lab_d65"], float) for r in REGIONS + ("cheek",)}
    pred = {r: np.array(chroma["cheek_multiply"]["predicted"][r]["lab_d65"], float) for r in REGIONS + ("cheek",)}
    dlab_transfer = {r: [round(float(v), 6) for v in (afr[r] - pred[r])] for r in REGIONS}

    light_L = float(chroma["light"]["forehead"]["lab_d65"][0])
    trep = json.loads(TONE_REPORT.read_text())
    dists = {fid: round(abs(float(trep["families"][fid]["forehead"][0]) - light_L), 6) for fid in FAMILIES}
    src_id = min(dists, key=lambda k: dists[k])
    src_rel = FAMILIES[src_id]
    src_u8 = np.asarray(Image.open(STORE / src_rel).convert("RGB"))
    assert src_u8.shape == (2048, 2048, 3), src_u8.shape

    masks = sl.build_masks()
    hard = {"lip": masks["lip"], "ear": masks["ear"], "nose": masks["nose"], "forehead": forehead_hard()}
    fam_lin = srgb_to_linear(src_u8.astype(np.float64) / 255.0)
    cheek = hard_cheek = masks["cheek"] > 0.5
    fam_cheek = fam_lin[cheek].mean(axis=0)
    afr_cheek = np.array(chroma["african"]["cheek"]["mean_linear_rgb"], float)
    k = afr_cheek / np.maximum(fam_cheek, 1e-12)

    step_lin = np.clip(fam_lin * k, 0, 1)
    step_u8 = np.rint(np.clip(linear_to_srgb(step_lin), 0, 1) * 255).astype(np.uint8)
    if a.no_residual:
        out_u8 = step_u8
        dlab = {r: [0.0, 0.0, 0.0] for r in REGIONS}
        target_terms: dict = {}
    elif a.method == "transfer":
        dlab = dlab_transfer
        target_terms = {"note": "transfer reproduces r3 (Vitruvian-relative residual)"}
        lab = rgb_to_lab(step_u8).astype(np.float64)
        out_lab = lab.copy()
        for r in REGIONS:
            w = sl.soft_inside(hard[r])[..., None]
            out_lab += w * np.array(dlab[r], float)[None, None, :]
        out_lab[..., 0] = np.clip(out_lab[..., 0], 0, 100)
        out_u8 = lab_to_rgb(out_lab)
        union = np.zeros(hard["lip"].shape, bool)
        for r in REGIONS:
            union |= hard[r] > 0.5
        out_u8[~union] = step_u8[~union]
    else:
        lab_step = rgb_to_lab(step_u8).astype(np.float64)
        means = {}
        for r in ("lip", "ear", "nose", "forehead"):
            m = hard[r] > 0.5
            means[r] = lab_step[m].mean(axis=0)
        african_sep = {r: afr[r] - afr["forehead"] for r in MEASURED_REGIONS}
        family_mult_sep = {r: means[r] - means["forehead"] for r in MEASURED_REGIONS}
        dlab = {r: [round(float(v), 6) for v in (african_sep[r] - family_mult_sep[r])]
                for r in APPLIED_REGIONS}
        target_terms = {
            "african_sep_Lab": {r: [round(float(v), 6) for v in african_sep[r]] for r in MEASURED_REGIONS},
            "family_after_multiply_sep_Lab": {r: [round(float(v), 6) for v in family_mult_sep[r]] for r in MEASURED_REGIONS},
            "family_after_multiply_means_Lab": {r: [round(float(v), 6) for v in means[r]] for r in ("lip", "ear", "nose", "forehead")},
            "forehead_reference": "no residual on forehead (it is the reference)",
            "nose_control": "nose measured + reported, keeps step (a) multiply, no residual (r5 decision)",
            "r5_decision": R5_DECISION,
        }
        out_lab = lab_step.copy()
        # r8: lip a*/b* = r5 full soft_inside (uncut); lip L additionally
        # fades near the commissure rows; ear = r5 feather.
        w_lip_ab = sl.soft_inside(hard["lip"])
        w_lip_l = w_lip_ab * lip_l_row_factor(
            hard["lip"], lip_l_taper_right, lip_l_taper_left
        )
        w_ear = sl.soft_inside(hard["ear"])
        dlip = np.array(dlab["lip"], float)
        out_lab[..., 0] += w_lip_l * dlip[0]
        out_lab[..., 1] += w_lip_ab * dlip[1]
        out_lab[..., 2] += w_lip_ab * dlip[2]
        dear = np.array(dlab["ear"], float)
        out_lab += w_ear[..., None] * dear[None, None, :]
        out_lab[..., 0] = np.clip(out_lab[..., 0], 0, 100)
        out_u8 = lab_to_rgb(out_lab)
        union = np.zeros(hard["lip"].shape, bool)
        for r in APPLIED_REGIONS:
            union |= hard[r] > 0.5
        out_u8[~union] = step_u8[~union]
        hard_counts = {r: int((hard[r] > 0.5).sum()) for r in APPLIED_REGIONS}
        cover_counts = {"lip": int((w_lip_ab > 0.5).sum()), "ear": int((w_ear > 0.5).sum())}
        l_cover_counts = {"lip": int((w_lip_l > 0.5).sum())}
        lip_corners = [[int(c), int(r)] for c, r in corner_points(hard["lip"])]

    a.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out_u8).save(a.out)
    if a.preview is None:
        a.preview = a.out.parent / "deep-family-preview.png"
    Image.fromarray(out_u8).resize((1024, 1024), Image.Resampling.LANCZOS).save(a.preview)
    mask_files = ["mask-facecore.png", "mask-lips.png", "mask-ears-L.png", "mask-ears-R.png", "occupancy.png"]
    manifest = {
        "version": 6,
        "method": ["(a) linear-RGB whole-family multiply by k", "(b) per-region Lab residual dLab_r with r8 weights (lip L: soft_inside * row-factor; lip a*/b*: soft_inside uncut; ear: r5 soft_inside; nose control)"],
        "r5_decision": R5_DECISION,
        "r8_decision": R8_DECISION,
        "r7_superseded": "corner-disc taper (uniform a*/b*/L erosion near corner points) exhausted: every taper broke lip b* while G7 stayed flat; r8 tapers the L component only",
        "r8_taper": {"lip_l_taper_rows": a.lip_l_taper if not a.no_residual and a.method == "target" else None,
                     "lip_l_taper_right_rows": lip_l_taper_right if not a.no_residual and a.method == "target" else None,
                     "lip_l_taper_left_rows": lip_l_taper_left if not a.no_residual and a.method == "target" else None,
                     "lip_r0_r1_ignored": [a.lip_r0, a.lip_r1],
                     "lip_corner_points_col_row": lip_corners if not a.no_residual and a.method == "target" else [],
                     "hard_texels": hard_counts if not a.no_residual and a.method == "target" else {},
                     "cover_texels_ab_weight_gt_half": cover_counts if not a.no_residual and a.method == "target" else {},
                     "cover_texels_L_weight_gt_half": l_cover_counts if not a.no_residual and a.method == "target" else {}},
        "residual_method": a.method if not a.no_residual else "none(no-residual)",
        "inputs": {"family": {"id": src_id, "rel": src_rel, "sha256": sha256_file(STORE / src_rel)},
                   "chroma_table": {"rel": str(CHROMA.relative_to(CHROMA.parents[5])), "sha256": sha256_file(CHROMA)}},
        "forehead_L_distances_to_vitruvian_light": dists,
        "vitruvian_light_forehead_L": round(light_L, 6),
        "k_rgb": [round(float(v), 6) for v in k],
        "african_cheek_linear_rgb": [round(float(v), 6) for v in afr_cheek],
        "family_cheek_linear_rgb": [round(float(v), 6) for v in fam_cheek],
        "dLab_african_minus_predicted": dlab_transfer,
        "dLab_applied": dlab,
        "target_terms": target_terms,
        "no_residual": bool(a.no_residual),
        "masks": {"derive_files": {n: sha256_file(sl.DERIVE / n) for n in mask_files},
                  "cheek_cols": list(sl.CHEEK_COLS), "cheek_rows": [list(sl.CHEEK_ROWS_SIDE1), list(sl.CHEEK_ROWS_SIDE2)],
                  "nose_tip_col_row": list(sl.NOSE_TIP), "nose_radius_px": sl.NOSE_RADIUS_PX,
                  "feather_sigma_px": sl.FEATHER_SIGMA_PX, "forehead": "shared skin_layers.forehead_disc = build_roughness brow-push disc (r=0.055*S) AND occupancy NOT brows NOT eyes (r3; replaces r2 above-brow cut)"},
        "outputs": {"family_png": str(a.out), "sha256": sha256_file(a.out)},
    }
    mpath = a.manifest or (a.out.parent / "deep-manifest.json")
    mpath.write_text(json.dumps(manifest, indent=1) + "\n")
    print(json.dumps({"family": src_id, "dists": dists, "k": manifest["k_rgb"], "dLab": dlab, "out": str(a.out), "sha256": manifest["outputs"]["sha256"]}, indent=1))


if __name__ == "__main__":
    main()
