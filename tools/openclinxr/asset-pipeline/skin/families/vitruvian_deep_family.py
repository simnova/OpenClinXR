"""Fourth skin family `deep`: topology-free region-aware remap of a light family.

Method (recorded in the manifest):
  a) linear-RGB multiply of the whole family by k = African_cheek_rgb /
     family_cheek_rgb (per channel; African cheek from the Vitruvian
     chroma-table; family cheek = linear mean inside the skin_layers cheek
     hard mask);
  b) per region r in {lip, ear, nose, forehead}: add the Vitruvian residual
     dLab_r = African_r - predicted_r (chroma-table Lab) in Lab inside r's
     hard mask with the skin_layers inward feather; texels outside every
     mask keep step (a) bytes bit-exactly.

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

STORE = Path("/Volumes/files/openclinxr-assets/store")
CHROMA = HERE.parent / "vitruvian_dark" / "chroma-table.json"
TONE_REPORT = HERE / "tone-report.json"
FAMILIES = {
    "young": "skin-families/young/young-family-v3.png",
    "middle": "skin-families/middle/middle-family-v4.png",
    "old": "skin-families/old/old-family-v2.png",
}
REGIONS = ("lip", "ear", "nose", "forehead")


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
    a = ap.parse_args()

    chroma = json.loads(CHROMA.read_text())
    afr = {r: np.array(chroma["african"][r]["lab_d65"], float) for r in REGIONS + ("cheek",)}
    pred = {r: np.array(chroma["cheek_multiply"]["predicted"][r]["lab_d65"], float) for r in REGIONS + ("cheek",)}
    dlab = {r: [round(float(v), 6) for v in (afr[r] - pred[r])] for r in REGIONS}

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
    else:
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

    a.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out_u8).save(a.out)
    if a.preview is None:
        a.preview = a.out.parent / "deep-family-preview.png"
    Image.fromarray(out_u8).resize((1024, 1024), Image.Resampling.LANCZOS).save(a.preview)
    mask_files = ["mask-facecore.png", "mask-lips.png", "mask-ears-L.png", "mask-ears-R.png", "occupancy.png"]
    manifest = {
        "version": 1,
        "method": ["(a) linear-RGB whole-family multiply by k", "(b) per-region Lab residual dLab_r inside hard mask with inward feather"],
        "inputs": {"family": {"id": src_id, "rel": src_rel, "sha256": sha256_file(STORE / src_rel)},
                   "chroma_table": {"rel": str(CHROMA.relative_to(CHROMA.parents[5])), "sha256": sha256_file(CHROMA)}},
        "forehead_L_distances_to_vitruvian_light": dists,
        "vitruvian_light_forehead_L": round(light_L, 6),
        "k_rgb": [round(float(v), 6) for v in k],
        "african_cheek_linear_rgb": [round(float(v), 6) for v in afr_cheek],
        "family_cheek_linear_rgb": [round(float(v), 6) for v in fam_cheek],
        "dLab_african_minus_predicted": dlab,
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
