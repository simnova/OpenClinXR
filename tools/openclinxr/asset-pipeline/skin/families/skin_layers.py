"""Card tsk_f1f3eba7615d92f0 instrument: freckle / redness / accent weights over a skin family.

Reads (read-only): the young family PNG from the asset store, UV masks +
landmarks from the a1 derive dir (same MakeHuman UV for all inputs; derive.py
masks are 2048px, exactly the family PNG size). Writes: variant PNGs to
store/skin-layers/ + layers-report.json (this dir). No Imagine, no GLB, no shading.

Method: numpy layers in CIELAB over the family PNG. Every layer blends only
inside its hard binary mask (soft interior falloff is clipped to the hard
mask, fix_lips.py inward-feather pattern); texels outside the hard mask are
restored to the source bytes bit-exactly. All weights 0 is a byte copy, so
identity max abs error is 0 by construction. Freckle positions are seeded
(seed recorded); nothing is baked into the family PNG.

Cheek/nose masks: derive.py ships lip/eye/brow/ear/facecore masks plus
landmarks-uv.json but no cheek/nose masks, so cheek boxes + nose disc are
derived deterministically from the nose-tip / eye-corner / lip-corner
landmarks below (numbers recorded in the report, no hand-drawn art).
Texture convention: row=v*S, col=u*S (derive.py renderer convention).
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "face-replay"))
from fix_lips import lab_to_rgb, rgb_to_lab  # noqa: E402  (tools/openclinxr/asset-pipeline/skin/face-replay/fix_lips.py)

STORE = Path("/Volumes/files/openclinxr-assets/store")
DERIVE = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95"
    "/.openclinxr/realism-spike/skinfamilies/a1/derive"
)
FAMILY_ID = "young"
FAMILY_REL = "skin-families/young/young-family-v3.png"
OUT_DIR = STORE / "skin-layers"

FRECKLE_SEED = 7
FRECKLE_COUNT = 140
FRECKLE_RADIUS_PX = 2
FEATHER_SIGMA_PX = 6.0

# Cheek/nose derivation from derive landmarks (uv_texel = [col=u*S, row=v*S]):
# nose-tip (1773.1, 1058.5); nostril rows 1017.2/1099.8; eye-outer cols 1714.8
# rows 973.7/1143.3; lip-corner cols 1863.8/1863.2. Cheeks sit lateral to the
# nostrils, between the eye line and the lip line.
NOSE_TIP = (1773.1, 1058.5)  # (col, row)
NOSE_RADIUS_PX = 45.0
CHEEK_COLS = (1690, 1930)
CHEEK_ROWS_SIDE1 = (850, 985)
CHEEK_ROWS_SIDE2 = (1131, 1281)

LAYER_ORDER = ["freckles", "cheek_redness", "nose_redness", "lip", "ear", "pallor"]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def load_mask(name: str) -> np.ndarray:
    return np.asarray(Image.open(DERIVE / name).convert("L"), dtype=np.float64) / 255.0


def srgb_to_lab_f(rgb01: np.ndarray) -> np.ndarray:
    """tone-check.py sRGB->Lab (D65) on float 0..1; used only for the dLab gate measure."""
    lin = np.where(rgb01 <= 0.04045, rgb01 / 12.92, ((rgb01 + 0.055) / 1.055) ** 2.4)
    m = np.array(
        [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]]
    )
    xyz = lin @ np.array(m).T / np.array([0.95047, 1.0, 1.08883])
    e, k = 0.008856, 903.3
    f = np.where(xyz > e, xyz ** (1 / 3), (k * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def soft_inside(hard: np.ndarray) -> np.ndarray:
    blurred = np.asarray(
        Image.fromarray((hard * 255.0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(FEATHER_SIGMA_PX)),
        dtype=np.float64,
    ) / 255.0
    return blurred * hard


def build_masks() -> dict[str, np.ndarray]:
    core = load_mask("mask-facecore.png")
    lips = load_mask("mask-lips.png")
    feat = np.maximum.reduce(
        [lips, load_mask("mask-eyes-L.png"), load_mask("mask-eyes-R.png"),
         load_mask("mask-brows-L.png"), load_mask("mask-brows-R.png")]
    )
    ears = np.maximum(load_mask("mask-ears-L.png"), load_mask("mask-ears-R.png"))
    occ = load_mask("occupancy.png")
    skin = ((core > 0.5) & (feat <= 0.5) & (occ > 0.5)).astype(np.float64)

    rows, cols = np.mgrid[0 : skin.shape[0], 0 : skin.shape[1]]
    nose_disc = ((cols - NOSE_TIP[0]) ** 2 + (rows - NOSE_TIP[1]) ** 2) <= NOSE_RADIUS_PX**2
    nose = (nose_disc & (skin > 0.5)).astype(np.float64)
    c0, c1 = CHEEK_COLS
    cheek1 = ((cols >= c0) & (cols < c1) & (rows >= CHEEK_ROWS_SIDE1[0]) & (rows < CHEEK_ROWS_SIDE1[1]))
    cheek2 = ((cols >= c0) & (cols < c1) & (rows >= CHEEK_ROWS_SIDE2[0]) & (rows < CHEEK_ROWS_SIDE2[1]))
    cheek = (((cheek1 | cheek2)) & (skin > 0.5)).astype(np.float64)
    lip = (((lips > 0.5) & (occ > 0.5))).astype(np.float64)
    ear = (((ears > 0.5) & (occ > 0.5))).astype(np.float64)
    freckle_zone = ((((cheek > 0.5) | (nose > 0.5))) & (skin > 0.5)).astype(np.float64)
    return {"cheek": cheek, "nose": nose, "lip": lip, "ear": ear, "pallor": skin, "freckle_zone": freckle_zone}


def freckle_dots(zone: np.ndarray) -> list[tuple[int, int]]:
    rng = np.random.default_rng(FRECKLE_SEED)
    ys, xs = np.where(zone > 0.5)
    lo_x, hi_x, lo_y, hi_y = xs.min(), xs.max(), ys.min(), ys.max()
    dots: list[tuple[int, int]] = []
    guard = 0
    while len(dots) < FRECKLE_COUNT and guard < 200000:
        guard += 1
        x = int(rng.integers(lo_x, hi_x + 1))
        y = int(rng.integers(lo_y, hi_y + 1))
        if zone[y, x] > 0.5:
            dots.append((y, x))
    assert len(dots) == FRECKLE_COUNT, "freckle sampling failed: %d/%d" % (len(dots), FRECKLE_COUNT)
    return dots


def apply_layers(src_u8: np.ndarray, masks: dict[str, np.ndarray],
                 dots: list[tuple[int, int]], weights: dict[str, float]) -> np.ndarray:
    """Blend the six layers over src (uint8 RGB). Outside each layer's hard
    mask the source bytes are restored bit-exactly."""
    if all(float(weights.get(k, 0.0)) == 0.0 for k in LAYER_ORDER):
        return src_u8.copy()
    lab = rgb_to_lab(src_u8)
    out = lab.copy()
    soft = {k: soft_inside(masks[k]) for k in ("cheek", "nose", "lip", "ear", "pallor")}

    w = float(weights.get("cheek_redness", 0.0))
    if w:
        adj = out.copy()
        adj[..., 1] += 7.0 * w
        out = (1 - soft["cheek"])[..., None] * out + soft["cheek"][..., None] * adj
    w = float(weights.get("nose_redness", 0.0))
    if w:
        adj = out.copy()
        adj[..., 1] += 7.0 * w
        out = (1 - soft["nose"])[..., None] * out + soft["nose"][..., None] * adj
    w = float(weights.get("lip", 0.0))
    if w:
        adj = out.copy()
        adj[..., 1] *= 1 + 0.35 * w
        adj[..., 2] *= 1 + 0.35 * w
        out = (1 - soft["lip"])[..., None] * out + soft["lip"][..., None] * adj
    w = float(weights.get("ear", 0.0))
    if w:
        adj = out.copy()
        adj[..., 1] += 6.0 * w
        out = (1 - soft["ear"])[..., None] * out + soft["ear"][..., None] * adj
    w = float(weights.get("pallor", 0.0))
    if w:
        adj = out.copy()
        adj[..., 0] += 5.0 * w
        adj[..., 1] *= 1 - 0.45 * w
        adj[..., 2] *= 1 - 0.45 * w
        out = (1 - soft["pallor"])[..., None] * out + soft["pallor"][..., None] * adj
    w = float(weights.get("freckles", 0.0))
    if w:
        r = FRECKLE_RADIUS_PX
        dy, dx = np.mgrid[-r : r + 1, -r : r + 1]
        disc = (dx**2 + dy**2) <= r**2
        for y, x in dots:
            y0, y1, x0, x1 = y - r, y + r + 1, x - r, x + r + 1
            if y0 < 0 or x0 < 0 or y1 > out.shape[0] or x1 > out.shape[1]:
                continue
            patch = out[y0:y1, x0:x1]
            m = disc & (masks["freckle_zone"][y0:y1, x0:x1] > 0.5)
            patch[m, 0] -= 20.0 * w
            patch[m, 1] += 3.0 * w
            patch[m, 2] += 7.0 * w

    out[..., 0] = np.clip(out[..., 0], 0, 100)
    rgb = lab_to_rgb(out)
    union = np.zeros(src_u8.shape[:2], bool)
    for k in LAYER_ORDER:
        key = "freckle_zone" if k == "freckles" else ("cheek" if k == "cheek_redness" else ("nose" if k == "nose_redness" else k))
        if float(weights.get(k, 0.0)) != 0.0:
            union |= masks[key] > 0.5
    rgb[~union] = src_u8[~union]
    return rgb


def max_abs_error(a: np.ndarray, b: np.ndarray) -> int:
    return int(np.abs(a.astype(np.int32) - b.astype(np.int32)).max())


def outside_dlab(src_u8: np.ndarray, out_u8: np.ndarray, hard: np.ndarray) -> float:
    outside = hard <= 0.5
    if not outside.any():
        return 0.0
    dl = np.abs(
        srgb_to_lab_f(out_u8[outside].astype(np.float64) / 255.0)
        - srgb_to_lab_f(src_u8[outside].astype(np.float64) / 255.0)
    ).max(axis=-1)
    return float(dl.max())


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fam_path = STORE / FAMILY_REL
    src_u8 = np.asarray(Image.open(fam_path).convert("RGB"))
    assert src_u8.shape == (2048, 2048, 3), src_u8.shape
    masks = build_masks()
    for k, m in masks.items():
        assert int((m > 0.5).sum()) > 1000, (k, int((m > 0.5).sum()))
    dots = freckle_dots(masks["freckle_zone"])
    # Determinism: resample + re-apply, shapes must match.
    assert freckle_dots(masks["freckle_zone"]) == dots, "freckle RNG not deterministic"

    zero = apply_layers(src_u8, masks, dots, {})
    identity_err = max_abs_error(zero, src_u8)
    assert identity_err == 0, identity_err

    layer_key = {"freckles": "freckle_zone", "cheek_redness": "cheek", "nose_redness": "nose",
                 "lip": "lip", "ear": "ear", "pallor": "pallor"}
    layer_files = {"freckles": "young-layers-freckles-06.png", "cheek_redness": "young-layers-cheekred-06.png",
                   "nose_redness": "young-layers-noserred-06.png", "lip": "young-layers-lip-06.png",
                   "ear": "young-layers-ear-06.png", "pallor": "young-layers-pallor-06.png"}
    zero_rel = "skin-layers/young-family-layers-zero.png"
    Image.fromarray(zero).save(STORE / zero_rel)

    layers: dict = {}
    for layer in LAYER_ORDER:
        out = apply_layers(src_u8, masks, dots, {layer: 0.6})
        rel = "skin-layers/" + layer_files[layer]
        Image.fromarray(out).save(STORE / rel)
        # Determinism re-run for the seeded layer.
        out2 = apply_layers(src_u8, masks, freckle_dots(masks["freckle_zone"]), {layer: 0.6})
        assert (out2 == out).all(), "non-deterministic layer %s" % layer
        hard = masks[layer_key[layer]]
        layers[layer] = {
            "weight": 0.6,
            "assets": rel,
            "sha256": sha256_file(STORE / rel),
            "mask_px": int((hard > 0.5).sum()),
            "inside_changed_px": int((((np.abs(out.astype(np.int32) - src_u8.astype(np.int32)).max(axis=-1)) > 0) & (hard > 0.5)).sum()),
            "outside_max_abs_dLab": round(outside_dlab(src_u8, out, hard), 4),
        }
        assert layers[layer]["outside_max_abs_dLab"] == 0.0, (layer, layers[layer]["outside_max_abs_dLab"])
        assert layers[layer]["inside_changed_px"] > 100, (layer, layers[layer]["inside_changed_px"])

    mask_files = {"cheek": "skin-layers/mask-cheek.png", "nose": "skin-layers/mask-nose.png",
                  "lip": "skin-layers/mask-lip.png", "ear": "skin-layers/mask-ear.png",
                  "pallor": "skin-layers/mask-pallor.png", "freckle_zone": "skin-layers/mask-freckle-zone.png"}
    mask_shas = {}
    for k, rel in mask_files.items():
        Image.fromarray(((masks[k] > 0.5) * 255).astype(np.uint8)).save(STORE / rel)
        mask_shas[k] = {"assets": rel, "sha256": sha256_file(STORE / rel)}

    # Per-case weights from the committed actor-phenotype export. Mapping rule:
    # cheek_redness = nose_redness = lip = ear = flush; freckles = 0 (no
    # fixture authors a freckle/mole field); pallor = 0. Family via
    # tone-report.json nearest (warm_light(+child)/warm_medium all -> young);
    # actors without an authored skin_tone get family null.
    export = json.loads((HERE.parents[4]
                         / "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json").read_text())
    nearest = json.loads((HERE / "tone-report.json").read_text())["nearest"]
    cases: dict = {}
    for case_id, actors in export["entries"].items():
        for actor_id, rec in actors.items():
            ph = rec.get("phenotype", {}) if isinstance(rec, dict) else {}
            if not isinstance(ph, dict) or ph.get("descriptor_derived"):
                continue
            flush = float(ph.get("flush", 0.0))
            tone = ph.get("skin_tone")
            if tone == "medium_warm":
                tone = "warm_medium"  # tone-report falsifier: warm_medium(medium_warm) are one tone
            cases["%s/%s" % (case_id, actor_id)] = {
                "skin_tone": tone,
                "family": nearest.get(tone) if isinstance(tone, str) else None,
                "flush": flush,
                "weights": {"freckles": 0.0, "cheek_redness": flush, "nose_redness": flush,
                            "lip": flush, "ear": flush, "pallor": 0.0},
            }
    young_flush = sorted({c["flush"] for c in cases.values() if c["family"] == "young"})
    falsifier = {
        "young_family_flush_values": young_flush,
        "decision": "proceed_layers" if len(young_flush) > 1 else "single_value_bake_and_stop",
        "detail": "flush varies within the young family, so redness weights vary per case; "
                  "no fixture authors freckles/moles (freckle weight 0 everywhere, positions still seeded+recorded)",
    }
    assert falsifier["decision"] == "proceed_layers", falsifier

    report = {
        "version": 1,
        "instrument": "tools/openclinxr/asset-pipeline/skin/families/skin_layers.py",
        "family": FAMILY_ID,
        "family_assets": FAMILY_REL,
        "family_sha256": sha256_file(fam_path),
        "masks": {
            "derive_dir": "skinfamilies/a1/derive (facecore/lips/eyes-L|R/brows-L|R/ears-L|R max/occupancy/landmarks-uv.json)",
            "cheek_cols": list(CHEEK_COLS),
            "cheek_rows_side1": list(CHEEK_ROWS_SIDE1),
            "cheek_rows_side2": list(CHEEK_ROWS_SIDE2),
            "nose_tip_col_row": list(NOSE_TIP),
            "nose_radius_px": NOSE_RADIUS_PX,
            "feather": "gaussian sigma %.1f clipped to the hard mask (inward-only); texels outside the hard mask restored bit-exact" % FEATHER_SIGMA_PX,
            "files": mask_shas,
        },
        "freckles": {"seed": FRECKLE_SEED, "count": FRECKLE_COUNT, "radius_px": FRECKLE_RADIUS_PX,
                     "zone": "cheek+nose intersect facecore-minus-features",
                     "stored_as": "seeded weights, not baked into the family PNG"},
        "layer_ops_Lab": {
            "freckles": "L-=20w, a+=3w, b+=7w in r=2 discs",
            "cheek_redness": "a+=7w", "nose_redness": "a+=7w",
            "lip": "chroma x(1+0.35w)", "ear": "a+=6w",
            "pallor": "L+=5w, a/b x(1-0.45w) on facecore-minus-features",
        },
        "weight_rule": "cheek=nose=lip=ear=flush; freckles=0 (no authored field); pallor=0",
        "cases": cases,
        "falsifier": falsifier,
        "identity": {"zero_assets": zero_rel, "zero_sha256": sha256_file(STORE / zero_rel),
                     "max_abs_error_at_weight_0": identity_err},
        "layers": layers,
        "not_tested": "animated blush",
    }
    prev = HERE / "layers-report.json"
    if prev.exists():
        old_sheet = json.loads(prev.read_text()).get("sheet")
        if old_sheet:
            report["sheet"] = old_sheet  # renders/crops survive a re-run; PNGs are deterministic
    (HERE / "layers-report.json").write_text(json.dumps(report, indent=1) + "\n")
    print("identity max_abs_error=%d; layers=%s; young flush=%s"
          % (identity_err, {k: (v["inside_changed_px"], v["outside_max_abs_dLab"]) for k, v in layers.items()}, young_flush))


if __name__ == "__main__":
    main()
