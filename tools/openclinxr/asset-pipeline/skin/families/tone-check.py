"""Card tsk_4c47cae8ca936ff6 instrument: nearest-family tone check + flattening-multiply refusal.

Reads (read-only): family PNGs from /Volumes/files/openclinxr-assets/store/skin-families/<age>/,
the dark CC0 source from the provider cache, UV masks from the a1 derive dir (same MakeHuman UV
for all inputs; manifest.json island_box_atlas identical [1228,307,2027,1843] for all 3 families).
Writes: tone-report.json (this dir). No Imagine, no GLB rewrite, no renders.

Method: sRGB -> XYZ -> Lab (D65) means under forehead (top 30% facecore bbox rows) / lips /
ears (L|R max) masks intersected with occupancy; RGB scale of the light family to the dark
family's forehead mean; CIEDE2000 lip/ear of multiplied-vs-dark against the untouched pair
(S/consult47/r4.answer.md card 5 threshold = that pair); cap rule: a residual uncapped past
the next family's forehead mean is a fail -> add_family, never ships the multiply.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent
STORE = Path("/Volumes/files/openclinxr-assets/store")
DERIVE = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95"
    "/.openclinxr/realism-spike/skinfamilies/a1/derive"
)
LIGHT_ID, LIGHT_REL = "middle", "skin-families/middle/middle-family-v4.png"
DARK_ID = "middleage_african_female"
DARK_ABS = Path(
    "/Volumes/files/src/openclinxr/.openclinxr-local/provider-cache/skins/sources"
    "/makehuman-system-skins/extracted/skins/middleage_african_female"
    "/middleage_darkskinned_female_diffuse.png"
)
FAMILIES = {
    "young": "skin-families/young/young-family-v3.png",
    "middle": "skin-families/middle/middle-family-v4.png",
    "old": "skin-families/old/old-family-v2.png",
}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def load_rgb(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0


def load_m(name: str) -> np.ndarray:
    return np.asarray(Image.open(DERIVE / name).convert("L"), dtype=np.float64) / 255.0


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array(
        [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]]
    )
    xyz = lin @ np.array(m).T / np.array([0.95047, 1.0, 1.08883])
    e, k = 0.008856, 903.3
    f = np.where(xyz > e, xyz ** (1 / 3), (k * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def ciede2000(l1: np.ndarray, l2: np.ndarray) -> float:
    L1, a1, b1 = (float(v) for v in l1)
    L2, a2, b2 = (float(v) for v in l2)
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cb**7 / (Cb**7 + 25**7)))
    ap1, ap2 = (1 + G) * a1, (1 + G) * a2
    Cp1, Cp2 = np.hypot(ap1, b1), np.hypot(ap2, b2)
    hp1, hp2 = np.degrees(np.arctan2(b1, ap1)) % 360, np.degrees(np.arctan2(b2, ap2)) % 360
    dL, dC = L2 - L1, Cp2 - Cp1
    dh = hp2 - hp1
    if Cp1 * Cp2 == 0:
        dh = 0.0
    elif abs(dh) > 180:
        dh -= 360 * np.sign(dh)
    dH = 2 * np.sqrt(Cp1 * Cp2) * np.sin(np.radians(dh / 2))
    Lp, Cp = (L1 + L2) / 2, (Cp1 + Cp2) / 2
    if Cp1 * Cp2 == 0:
        hp = hp1 + hp2
    elif abs(hp1 - hp2) <= 180:
        hp = (hp1 + hp2) / 2
    else:
        hp = (hp1 + hp2 + 360) / 2 if (hp1 + hp2) < 360 else (hp1 + hp2 - 360) / 2
    T = (
        1 - 0.17 * np.cos(np.radians(hp - 30)) + 0.24 * np.cos(np.radians(2 * hp))
        + 0.32 * np.cos(np.radians(3 * hp + 6)) - 0.20 * np.cos(np.radians(4 * hp - 63))
    )
    dRo = 30 * np.exp(-((hp - 275) / 25) ** 2)
    Rc = 2 * np.sqrt(Cp**7 / (Cp**7 + 25**7))
    Sl = 1 + 0.015 * (Lp - 50) ** 2 / np.sqrt(20 + (Lp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cp, 1 + 0.015 * Cp * T
    Rt = -np.sin(np.radians(2 * dRo)) * Rc
    return float(np.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh)))


def main() -> None:
    core, lips = load_m("mask-facecore.png"), load_m("mask-lips.png")
    ears = np.maximum(load_m("mask-ears-L.png"), load_m("mask-ears-R.png"))
    occ = load_m("occupancy.png")
    skin = (core > 0.5) & (occ > 0.5)
    ys = np.where(skin)[0]
    forehead = skin & (np.arange(skin.shape[0])[:, None] <= ys.min() + int(0.30 * (ys.max() - ys.min())))
    lip_m = (lips > 0.5) & (occ > 0.5)
    ear_m = (ears > 0.5) & (occ > 0.5)

    def means(rgb: np.ndarray) -> dict:
        lab = srgb_to_lab(rgb)
        return {k: [round(float(v), 2) for v in lab[m].mean(axis=0)] for k, m in
                [("forehead", forehead), ("lip", lip_m), ("ear", ear_m)]}

    fams: dict = {}
    for fid, rel in FAMILIES.items():
        rgb = load_rgb(STORE / rel)
        fams[fid] = {"assets": str(rel), "sha256": sha256_file(STORE / rel), **means(rgb)}
    dark_rgb = load_rgb(DARK_ABS)
    dark = {"source": str(DARK_ABS), "sha256": sha256_file(DARK_ABS), **means(dark_rgb)}

    light_rgb = load_rgb(STORE / LIGHT_REL)
    f_light, f_dark = light_rgb[forehead].mean(axis=0), dark_rgb[forehead].mean(axis=0)
    scale = [round(float(v), 4) for v in f_dark / np.maximum(f_light, 1e-6)]
    mult = np.clip(light_rgb * np.array(scale), 0, 1)
    mult_lab = srgb_to_lab(mult)
    mult_lip = mult_lab[lip_m].mean(axis=0)
    mult_ear = mult_lab[ear_m].mean(axis=0)
    L, D = np.array(fams[LIGHT_ID]["lip"]), np.array(dark["lip"])
    LE, DE = np.array(fams[LIGHT_ID]["ear"]), np.array(dark["ear"])

    report = {
        "version": 1,
        "instrument": "tools/openclinxr/asset-pipeline/skin/families/tone-check.py",
        "masks": "skinfamilies/a1/derive (facecore/lips/ears-L|R max/occupancy); forehead=top30pc facecore rows",
        "falsifier": {
            "case_skin_tones": ["warm_light", "warm_light_child", "warm_medium", "medium_warm"],
            "sources": [
                "packages/openclinxr/scenario-fixtures/src/ward-delirium.ts:118",
                "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts:141",
                "packages/openclinxr/scenario-fixtures/src/pediatric-asthma-mod.ts:81,138,185",
                "tools/openclinxr/asset-pipeline/reference-set/manifest.json:32,334",
            ],
            "decision": "multi_tone",
            "detail": "warm_light(+child) and warm_medium(medium_warm) are 2 distinct tones; not single_tone, proceed",
        },
        "tone_anchors_Lab": {
            "warm_light": [58.37, 9.05, 16.01],
            "warm_medium": [49.26, 13.89, 19.44],
            "source": "tools/openclinxr/asset-pipeline/reference-set/manifest.json "
                       "aisha goal_front facecore + body2 goal_front facecore",
        },
        "families": fams,
        "lightness_order_dark_to_light_forehead_L": ["dark-33", "young-60", "old-68", "middle-75"],
        "nearest": {
            "warm_light": "young",
            "warm_light_child": "young",
            "warm_medium": "young",
            "method": "min dLab anchor vs family forehead mean; both anchors nearest the darkest light family",
        },
        "cap_rule": "per-chart Lab residual capped at the next family's forehead mean; "
                    "a residual uncapped past the next family's mean is a fail",
        "multiply": {
            "light": {"id": LIGHT_ID, "assets": str(LIGHT_REL), "sha256": sha256_file(STORE / LIGHT_REL)},
            "dark": {"id": DARK_ID, "sha256": dark["sha256"]},
            "forehead_rgb_scale_light_to_dark": scale,
            "lip_lab": {"untouched_light": fams[LIGHT_ID]["lip"], "untouched_dark": dark["lip"],
                        "multiplied_light": [round(float(v), 2) for v in mult_lip]},
            "ear_lab": {"untouched_light": fams[LIGHT_ID]["ear"], "untouched_dark": dark["ear"],
                        "multiplied_light": [round(float(v), 2) for v in mult_ear]},
            "ciede2000_threshold_untouched_pair": {
                "lip": round(ciede2000(L, D), 2),
                "ear": round(ciede2000(LE, DE), 2),
            },
            "ciede2000_multiplied_vs_dark": {
                "lip": round(ciede2000(mult_lip, D), 2),
                "ear": round(ciede2000(mult_ear, DE), 2),
            },
            "structure_lip_minus_forehead_b_sep": {
                "untouched_dark": round(float(dark["lip"][2] - dark["forehead"][2]), 2),
                "multiplied_light": round(float(mult_lip[2] - dark["forehead"][2]), 2),
            },
        },
        "known_bad": "face-replay/face_replay_colour.py global Lab6: "
                     "second-body-report.json render_vs_goal 1/4 regions within_3_per_channel (R_cheek only)",
        "decision": "add_family",
        "shipped_multiply": False,
        "not_tested": "dynamic blush/pallor (layer weights)",
    }
    (HERE / "tone-report.json").write_text(json.dumps(report, indent=1) + "\n")
    print("wrote tone-report.json; lip gate %.2f vs %.2f; ear gate %.2f vs %.2f"
          % (report["multiply"]["ciede2000_multiplied_vs_dark"]["lip"],
             report["multiply"]["ciede2000_threshold_untouched_pair"]["lip"],
             report["multiply"]["ciede2000_multiplied_vs_dark"]["ear"],
             report["multiply"]["ciede2000_threshold_untouched_pair"]["ear"]))


if __name__ == "__main__":
    main()
