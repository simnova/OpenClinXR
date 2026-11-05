"""Fourth skin family `deep`: topology-free region-aware remap of a light family.

Method (recorded in the manifest):
  a) linear-RGB multiply of the whole family by k = African_cheek_rgb /
     family_cheek_rgb (per channel; African cheek from the Vitruvian
     chroma-table; family cheek = linear mean inside the skin_layers cheek
     hard mask);
  b) per region r in {lip, ear}: add the Vitruvian residual
     dLab_r = African_sep_r - family_after_multiply_sep_r (target method,
     Lab) in Lab inside r's hard mask ERODED by the feather width (r6
     inward-only: weight 0 on the boundary band) with the skin_layers
     inward feather;
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
# r6: lip/ear residuals feather INWARD only. The r5 mouth-corner grade showed a
# pale crescent on cheek skin at both commissures (contrast C minus B +6.9L /
# +4.7L); the soft_inside weight is already 0 outside the hard mask, so the
# crescent texels sit INSIDE the hard lip mask at the commissure edge. Eroding
# the applied hard mask by the feather width before blurring pulls the residual
# back from the mask boundary; the band between eroded and hard keeps step (a).
R6_DECISION = ("r6: erode applied (lip/ear) hard masks by the feather width "
               "(6 px = FEATHER_SIGMA_PX) before blurring, so residual weight "
               "is 0 on the boundary band; band keeps step (a) multiply bytes")
ERODE_PX = 6


def erode_inside(hard: np.ndarray, px: int = ERODE_PX) -> np.ndarray:
    """Binary erosion by px (PIL MinFilter, no new deps).

    Returns a 0/1 mask; the residual weight built from it is 0 on every texel
    within px of the hard-mask boundary (inward-only feather)."""
    size = 2 * int(px) + 1
    er = np.asarray(
        Image.fromarray((hard * 255.0).astype(np.uint8)).filter(ImageFilter.MinFilter(size)),
        dtype=np.float64,
    ) / 255.0
    return (er > 0.5).astype(np.float64)


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
    a = ap.parse_args()

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
        # r6: residual weight from the ERODED applied masks (inward-only
        # feather); the boundary band keeps step (a) via the eroded union.
        hard_applied = {r: erode_inside(hard[r]) for r in APPLIED_REGIONS}
        for r in APPLIED_REGIONS:
            w = sl.soft_inside(hard_applied[r])[..., None]
            out_lab += w * np.array(dlab[r], float)[None, None, :]
        out_lab[..., 0] = np.clip(out_lab[..., 0], 0, 100)
        out_u8 = lab_to_rgb(out_lab)
        union = np.zeros(hard["lip"].shape, bool)
        for r in APPLIED_REGIONS:
            union |= hard_applied[r] > 0.5
        out_u8[~union] = step_u8[~union]
        eroded_counts = {r: int((hard_applied[r] > 0.5).sum()) for r in APPLIED_REGIONS}
        hard_counts = {r: int((hard[r] > 0.5).sum()) for r in APPLIED_REGIONS}

    a.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out_u8).save(a.out)
    if a.preview is None:
        a.preview = a.out.parent / "deep-family-preview.png"
    Image.fromarray(out_u8).resize((1024, 1024), Image.Resampling.LANCZOS).save(a.preview)
    mask_files = ["mask-facecore.png", "mask-lips.png", "mask-ears-L.png", "mask-ears-R.png", "occupancy.png"]
    manifest = {
        "version": 4,
        "method": ["(a) linear-RGB whole-family multiply by k", "(b) per-region Lab residual dLab_r inside the ERODED hard mask (r6 inward-only feather; lip+ear only; nose control)"],
        "r5_decision": R5_DECISION,
        "r6_decision": R6_DECISION,
        "r6_feather": {"erode_px": ERODE_PX, "op": "PIL MinFilter(2*px+1) on applied hard masks before soft_inside; boundary band keeps step (a)",
                       "hard_texels": hard_counts if not a.no_residual and a.method == "target" else {},
                       "eroded_texels": eroded_counts if not a.no_residual and a.method == "target" else {}},
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
