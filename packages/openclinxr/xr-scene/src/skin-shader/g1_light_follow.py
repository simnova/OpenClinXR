"""G1 light-follow (tsk_8bbeb141d792bdcb): albedo leak at two key positions.

Measures Pearson r between each candidate albedo's low-band luminance and
the studio irradiance bake S at key azimuth 15 deg (existing cache
s-aisha-ref3-finalb.png, sha pinned below) and 45 deg (fresh Cycles bake,
30 deg apart, same rig otherwise), using the P2 leak machinery in
tools/openclinxr/asset-pipeline/skin/families/leak_check.py WITHOUT editing
it (imported, STUDIO azimuth overridden for the second bake only).

Gate: max(|r15|, |r45|) of the clean (AO-divided) albedo <= the same
quantity for the untouched CC0 atlas, measured in this script.
 AO-in-albedo rows (shipped skin-baked, shade alb-occ, sym out-albedo) are
context, not gated.

Texture convention: row=v*S, col=u*S (flipY=false), same as leak_check.py.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO / "tools/openclinxr/asset-pipeline/skin/families"))
import leak_check as LC  # noqa: E402

R95 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/realism-95"
           "/.openclinxr/realism-spike")
SCRATCH = R95 / "skinspec"
STORE_FAM = Path("/Volumes/files/openclinxr-assets/store/skin-families")
CC0 = Path("/Volumes/files/src/openclinxr/.openclinxr-local/provider-cache"
           "/skins/sources/makehuman-skins01/extracted/skins"
           "/bobby_03_young_female_hairless/Young_Female_Hairless.png")
GLB = R95 / "regen3/aisha-ref3.glb"
DERIVE = R95 / "skinfamilies/a1/derive"
S15 = STORE_FAM / "s-aisha-ref3-finalb.png"
S15_SHA = "8bc57f72d9972d3da39ae3b56e341ec969348fb32b5227cd5f6b56c6d19f0cfb"
CC0_SHA = ("9e2fa4ab993dd938ba896bb98848bd65346500c4c0a07d8789d2f1e14bb3dd7f")
GLB_SHA = ("6a572bf1387f0b032f482dc9d64722ed5cee914fe3f015de5b991f773a3376d2")
S45 = SCRATCH / "s-aisha-ref3-az45.png"
OUT = SCRATCH / "g1_rows.json"

ATLASES = {
    "clean-h1": SCRATCH / "chain-input-2048.png",
    "baked-occ-only-h1": SCRATCH / "chain-with/albedo_occ.png",
    "cc0-untouched": CC0,
}


def sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def lowband_L(atlas: Path) -> np.ndarray:
    S = LC.BAKE_SIZE
    rgb = np.asarray(Image.open(atlas).convert("RGB"))
    if rgb.shape[0] != S or rgb.shape[1] != S:
        rgb = np.asarray(Image.fromarray(rgb).resize((S, S), Image.LANCZOS))
    lab = cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)
    return LC.lowband(lab[:, :, 0].astype(np.float64))


def skin_safe() -> np.ndarray:
    S = LC.BAKE_SIZE
    core = LC.mask01(DERIVE / "mask-facecore.png", S)
    feat = np.maximum.reduce([
        LC.mask01(DERIVE / "mask-lips.png", S),
        LC.mask01(DERIVE / "mask-eyes-L.png", S),
        LC.mask01(DERIVE / "mask-eyes-R.png", S),
        LC.mask01(DERIVE / "mask-brows-L.png", S),
        LC.mask01(DERIVE / "mask-brows-R.png", S),
    ])
    occ = LC.mask01(DERIVE / "occupancy.png", S)
    return (core > 0.5) & (feat <= 0.5) & (occ > 0.5)


def lum(p: Path) -> np.ndarray:
    s = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0
    return 0.2126 * s[:, :, 0] + 0.7152 * s[:, :, 1] + 0.0722 * s[:, :, 2]


def main() -> int:
    for p in [CC0, GLB, DERIVE / "mask-facecore.png", S15,
              *ATLASES.values()]:
        assert p.exists(), f"missing input {p}"
    assert sha(CC0) == CC0_SHA, "CC0 atlas sha mismatch"
    assert sha(GLB) == GLB_SHA, "aisha-ref3.glb sha mismatch"
    assert sha(S15) == S15_SHA, "S15 cache sha mismatch"
    assert LC.STUDIO["keyAzimuthDeg"] == 15, "leak_check STUDIO drifted"

    if not S45.exists():
        LC.STUDIO["keyAzimuthDeg"] = 45
        try:
            LC.bake_studio_irradiance(GLB, S45)
        finally:
            LC.STUDIO["keyAzimuthDeg"] = 15
    s15, s45 = lum(S15), lum(S45)
    assert s15.shape == s45.shape == (LC.BAKE_SIZE, LC.BAKE_SIZE)
    safe = skin_safe()
    rows = {"keyAzimuthsDeg": [15, 45], "s15_sha256": sha(S15),
            "s45_sha256": sha(S45), "atlases": {}}
    for label, atlas in ATLASES.items():
        low = lowband_L(atlas)
        r15 = LC.pearson(low[safe], s15[safe])
        r45 = LC.pearson(low[safe], s45[safe])
        rows["atlases"][label] = {
            "atlas_sha256": sha(atlas), "n_skin_texels": int(safe.sum()),
            "r_s15": round(r15, 4), "r_s45": round(r45, 4),
            "max_abs_r": round(max(abs(r15), abs(r45)), 4),
        }
        print(f"{label}: r15={r15:+.4f} r45={r45:+.4f} "
              f"max|r|={max(abs(r15), abs(r45)):.4f}", flush=True)
    cc0 = rows["atlases"]["cc0-untouched"]["max_abs_r"]
    clean = rows["atlases"]["clean-h1"]["max_abs_r"]
    rows["threshold"] = {"kind": "cc0-untouched max|r|", "value": cc0}
    rows["gate"] = {"pass": bool(clean <= cc0),
                    "clean_max_abs_r": clean, "cc0_max_abs_r": cc0}
    print(f"GATE clean {clean:.4f} <= cc0 {cc0:.4f}: "
          f"{'PASS' if clean <= cc0 else 'FAIL'}", flush=True)
    OUT.write_text(json.dumps(rows, indent=1) + "\n")
    print(f"wrote {OUT}", flush=True)
    return 0 if clean <= cc0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
