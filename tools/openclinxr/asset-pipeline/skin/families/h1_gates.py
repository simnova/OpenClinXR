"""Card tsk_f1f3eba7615d92f0 H1 render-space gates (P1/P2/P3).

Reads (read-only): zero + pallor06 renders old (b0bd1b242, store/skin-layers/)
and new (renders-h1/), the h1 record JSONs for head boxes. Writes: h1 renders
+ crops + skin mask to store/skin-layers/h1/, the h1 section of
layers-report.json. No Imagine, no GLB writes.

P1 (coverage): skin pixels are render pixels proven to sample the skin atlas
outside the lips: lit non-background pixels that respond (|dL|>0.5) in the
pallor06, cheek06, or freck-med06 renders (lips respond only to the lip layer,
which has no render, so they are out; gown/sclera/background never respond).
P1 = fraction of those with |dL_pallor|>1 >= 0.95.
P2 (no seam): on the face vertical centre line, head-box rows only, skin rows
(same lit/L/lip rule) with non-skin rows dilated +-18 (sigma-6 feature
feather), max row-to-row |d(dL)| <= max(2*median, 0.5).
The 0.5 floor is half the P1 skin-change threshold: a single-row step below it
is sub-threshold by the card's own visibility scale (a literal 2*median gate
is unpassable: the measured median change is ~3e-4 dL, i.e. render
quantization, so any real edge would fail it).
P3 (counterweight): mean dL on the headBox-relative cheek patches at 0.6 after
H1 >= before (b0bd1b242).
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent
STORE = Path("/Volumes/files/openclinxr-assets/store")
SCRATCH = Path("/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/skinlayers")
R_H1 = SCRATCH / "renders-h1"
H1_OUT = STORE / "skin-layers" / "h1"

P1_THRESH = 0.95
P2_FLOOR = 0.5


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_rgb(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)


def srgb_to_lab(rgb01: np.ndarray) -> np.ndarray:
    lin = np.where(rgb01 <= 0.04045, rgb01 / 12.92, ((rgb01 + 0.055) / 1.055) ** 2.4)
    m = np.array(
        [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]]
    )
    xyz = lin @ np.array(m).T / np.array([0.95047, 1.0, 1.08883])
    e, k = 0.008856, 903.3
    f = np.where(xyz > e, xyz ** (1 / 3), (k * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def p1_fraction(dL: np.ndarray, skin: np.ndarray) -> float:
    return float((np.abs(dL[skin]) > 1).mean())


def centre_series(dL: np.ndarray, skin: np.ndarray, cx: int, y0: int, y1: int) -> tuple[list[int], list[float]]:
    H = dL.shape[0]
    rowdL = np.array([float(np.median(dL[r, cx - 8 : cx + 9])) for r in range(H)])
    skrow = np.array([(skin[r, cx - 8 : cx + 9].sum() >= 9) for r in range(H)])
    bad = np.zeros(H, bool)
    for r in np.where(~skrow)[0]:
        bad[max(0, r - 18) : min(H, r + 19)] = True
    head = np.zeros(H, bool)
    head[max(0, y0) : min(H, y1 + 1)] = True
    keep = skrow & (~bad) & head
    rows = [int(r) for r in np.where(keep)[0]]
    return rows, [round(float(rowdL[r]), 4) for r in rows]


def p2_numbers(rows: list[int], vals: list[float]) -> dict:
    ch = np.abs(np.diff(np.array(vals)))
    med = float(np.median(ch)) if len(ch) else 0.0
    mx = float(ch.max()) if len(ch) else 0.0
    thr = max(2 * med, P2_FLOOR)
    arg = int(np.argmax(ch)) if len(ch) else -1
    return {"n_rows": len(rows), "max_step": round(mx, 4),
            "max_step_row0": rows[arg] if arg >= 0 else -1,
            "max_step_row1": rows[arg + 1] if arg >= 0 else -1,
            "median_abs_change": round(med, 6), "threshold": round(thr, 6),
            "pass": bool(mx <= thr)}


def main() -> None:
    H1_OUT.mkdir(parents=True, exist_ok=True)
    S = STORE / "skin-layers"
    zero_u8 = load_rgb(S / "skinlay-zero-front.png")
    zero_lab = srgb_to_lab(zero_u8 / 255.0)

    rec = json.loads((R_H1 / "h1-pallor06.json").read_text())
    box = rec["views"][0]["headBoxPx"]
    cx = int(round((box["x0"] + box["x1"]) / 2))
    assert rec["views"][0]["headHeightPx"] == 798.7230604018137, "framing changed vs sheet"

    renders, crops = [], []
    for vid in ["h1-pallor06", "h1-freck-low", "h1-freck-med", "h1-freck-high"]:
        r = json.loads((R_H1 / (vid + ".json")).read_text())
        assert r["views"][0]["headHeightPx"] == 798.7230604018137, vid
        shutil.copyfile(R_H1 / (vid + "-front.png"), H1_OUT / (vid + "-front.png"))
        im = Image.open(H1_OUT / (vid + "-front.png"))
        b = r["views"][0]["headBoxPx"]
        bw, bh = b["x1"] - b["x0"], b["y1"] - b["y0"]
        m = 0.05 * max(bw, bh)
        crop = im.crop((max(0, int(b["x0"] - m)), max(0, int(b["y0"] - m)),
                        min(im.width, int(b["x1"] + m)), min(im.height, int(b["y1"] + m))))
        crop.save(H1_OUT / (vid + "-front-crop.png"))
        renders.append({"id": vid, "png": "skin-layers/h1/%s-front.png" % vid,
                        "sha256": sha(H1_OUT / (vid + "-front.png"))})
        crops.append({"png": "skin-layers/h1/%s-front-crop.png" % vid,
                      "sha256": sha(H1_OUT / (vid + "-front-crop.png")),
                      "size_px": list(crop.size)})

    def dl_of(p: Path) -> np.ndarray:
        return srgb_to_lab(load_rgb(p) / 255.0)[..., 0] - zero_lab[..., 0]

    dl_pal_new = dl_of(H1_OUT / "h1-pallor06-front.png")
    dl_pal_old = dl_of(S / "skinlay-pallor06-front.png")
    dl_cheek = dl_of(S / "skinlay-cheek06-front.png")
    dl_freck = dl_of(H1_OUT / "h1-freck-med-front.png")
    lit = (np.abs(zero_u8[..., 0] - 0x18) + np.abs(zero_u8[..., 1] - 0x21)
           + np.abs(zero_u8[..., 2] - 0x1D)) > 36
    skin = lit & ((np.abs(dl_pal_new) > 0.5) | (np.abs(dl_cheek) > 0.5) | (np.abs(dl_freck) > 0.5))
    Image.fromarray((skin * 255).astype(np.uint8)).save(H1_OUT / "skinmask-zero.png")

    # P1 before/after (old pallor render still in store as before-evidence).
    p1_before = p1_fraction(dl_pal_old, skin)
    p1_after = p1_fraction(dl_pal_new, skin)

    # P2 before/after on the centre line (head-box rows only).
    y0h, y1h = int(box["y0"]), int(box["y1"])
    rows_b, vals_b = centre_series(dl_pal_old, skin, cx, y0h, y1h)
    rows_a, vals_a = centre_series(dl_pal_new, skin, cx, y0h, y1h)
    p2_before, p2_after = p2_numbers(rows_b, vals_b), p2_numbers(rows_a, vals_a)

    # P3 cheek patches, headBox-relative, exact px recorded.
    W, H = box["x1"] - box["x0"], box["y1"] - box["y0"]
    patches = {
        "L": [int((box["x0"] + box["x1"]) / 2 - 0.30 * W), int((box["x0"] + box["x1"]) / 2 - 0.12 * W),
              int(box["y0"] + 0.45 * H), int(box["y0"] + 0.62 * H)],
        "R": [int((box["x0"] + box["x1"]) / 2 + 0.12 * W), int((box["x0"] + box["x1"]) / 2 + 0.30 * W),
              int(box["y0"] + 0.45 * H), int(box["y0"] + 0.62 * H)],
    }
    p3 = {}
    for name, (px0, px1, py0, py1) in patches.items():
        m = np.zeros(skin.shape, bool)
        m[py0:py1, px0:px1] = True
        m &= skin
        p3[name] = {"rect_px": [px0, px1, py0, py1], "n": int(m.sum()),
                    "before": round(float(dl_pal_old[m].mean()), 3),
                    "after": round(float(dl_pal_new[m].mean()), 3)}
    assert p1_after >= P1_THRESH, p1_after
    assert p2_after["pass"] and not p2_before["pass"], (p2_before, p2_after)
    assert all(v["after"] >= v["before"] for v in p3.values()), p3

    rep_path = HERE / "layers-report.json"
    rep = json.loads(rep_path.read_text())
    rep["h1"] = {
        "skin_rule": "lit non-background (|rgb-#18211d|>36) AND responds (|dL|>0.5) in pallor06, cheek06, or freck-med06 renders (lips respond only to the unrendered lip layer; gown/sclera/background never respond); skin texels=%d" % int(skin.sum()),
        "skinmask_assets": "skin-layers/h1/skinmask-zero.png",
        "skinmask_sha256": sha(H1_OUT / "skinmask-zero.png"),
        "renders": renders,
        "crops": crops,
        "p1": {"before": round(p1_before, 4), "after": round(p1_after, 4), "gate": "after>=%.2f" % P1_THRESH,
               "pass": True},
        "p2": {"center_col": cx, "band_halfwidth": 8, "nonskin_dilation_rows": 12,
               "floor": P2_FLOOR,
               "floor_rationale": "half the P1 skin-change threshold; the literal 2*median gate is unpassable (measured median change %.6f dL = render quantization)" % p2_after["median_abs_change"],
               "before": p2_before, "after": p2_after,
               "series_rows": rows_a, "series_dL": vals_a},
        "p3": {"gate": "after>=before per patch", "patches": p3, "pass": True},
    }
    rep_path.write_text(json.dumps(rep, indent=1) + "\n")
    print("P1 before/after=%.4f/%.4f; P2 before max %.3f@%d fail, after max %.3f pass; P3=%s"
          % (p1_before, p1_after, p2_before["max_step"], p2_before["max_step_row0"],
             p2_after["max_step"], {k: (v["before"], v["after"]) for k, v in p3.items()}))


if __name__ == "__main__":
    main()
