#!/usr/bin/env python3
"""Self-tests for compare.py. Run: mise exec -- python3 compare_test.py"""
import json
import os
import shutil
import sys
import tempfile
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import COLORS, erode2, main, region_masks  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402

REF = "/Volumes/files/openclinxr-assets/store/aisha-parity/p1a"
CAMS = ["head_front", "head_34", "body_front", "body_34"]
GRADED = ("skin", "eyes", "clothing")


def srgb_to_linear(a):
    a = a / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    return np.where(
        a <= 0.0031308, a * 12.92, 1.055 * np.clip(a, 0, None) ** (1 / 2.4) - 0.055
    )


def metrics(out):
    with open(os.path.join(out, "metrics.json")) as f:
        return json.load(f)


def test_self(tmp):
    out = os.path.join(tmp, "self")
    assert main(["--ref", REF, "--cand", os.path.join(REF, "beauty"),
                 "--out", out, "--label", "self"]) == 0
    m = metrics(out)
    for cam in CAMS:
        for r in GRADED:
            reg = m["cameras"][cam]["regions"][r]
            assert reg["mean_dE"] < 1e-6, (cam, r, reg["mean_dE"])
            assert reg["ssim"] == 1, (cam, r, reg["ssim"])
            assert reg["detail_ratio"] == 1.0, (cam, r, reg["detail_ratio"])
        assert m["cameras"][cam]["whole"]["ssim"] == 1, cam
    print("a ok: self mean dE 0, SSIM 1")


def test_bright(tmp):
    cand = os.path.join(tmp, "bright")
    os.makedirs(cand)
    for cam in CAMS:
        img = np.array(Image.open(f"{REF}/beauty/{cam}.png").convert("RGB"))
        up = (np.clip(linear_to_srgb(srgb_to_linear(img) * 1.10), 0, 1) * 255
               ).round().astype(np.uint8)
        Image.fromarray(up).save(os.path.join(cand, f"{cam}.png"))
    out = os.path.join(tmp, "bright-out")
    assert main(["--ref", REF, "--cand", cand, "--out", out]) == 0
    m = metrics(out)
    for cam in CAMS:
        skin = m["cameras"][cam]["regions"]["skin"]
        assert skin["dL"] > 0, (cam, skin["dL"])
        assert skin["mean_dE"] > 1, (cam, skin["mean_dE"])
    skin0 = m["cameras"]["head_front"]["regions"]["skin"]
    print(f"b ok: head_front skin dL={skin0['dL']:.3f} mean_dE={skin0['mean_dE']:.3f}")
    return skin0


def test_blur(tmp):
    cand = os.path.join(tmp, "blur")
    os.makedirs(cand)
    for cam in CAMS:
        img = Image.open(f"{REF}/beauty/{cam}.png").convert("RGB")
        img.filter(ImageFilter.GaussianBlur(2)).save(
            os.path.join(cand, f"{cam}.png"))
    out = os.path.join(tmp, "blur-out")
    assert main(["--ref", REF, "--cand", cand, "--out", out]) == 0
    m = metrics(out)
    for cam in CAMS:
        for r in GRADED:
            reg = m["cameras"][cam]["regions"][r]
            assert reg["detail_ratio"] < 0.7, (cam, r, reg["detail_ratio"])
            # colour bar only for statistically stable regions: distant eyes
            # shrink to tens of px after erosion, where pupil/sclera mixing
            # under blur is noise, not a colour shift (body eyes n<40)
            if reg["n_pixels"] >= 500:
                assert reg["mean_dE"] < 2, (cam, r, reg["mean_dE"])
            else:
                print(f"  skip colour on {cam}/{r} "
                      f"(n={reg['n_pixels']}, dE={reg['mean_dE']:.2f})")
    skin0 = m["cameras"]["head_front"]["regions"]["skin"]
    print(f"c ok: head_front skin detail={skin0['detail_ratio']:.3f} "
          f"mean_dE={skin0['mean_dE']:.3f}")
    return skin0


def test_badsize(tmp):
    cand = os.path.join(tmp, "bad")
    os.makedirs(cand)
    for cam in CAMS:
        img = Image.open(f"{REF}/beauty/{cam}.png").convert("RGB")
        img.resize((img.width // 2, img.height // 2)).save(
            os.path.join(cand, f"{cam}.png"))
    rc = main(["--ref", REF, "--cand", cand,
               "--out", os.path.join(tmp, "bad-out")])
    assert rc == 2, rc
    print("d ok: wrong size exits 2")


def exact_region_masks(mask_rgb):
    # verbatim from 1dd36e43b compare.py region_masks
    out = {}
    for name, rgb in COLORS.items():
        out[name] = np.all(mask_rgb == np.array(rgb, dtype=np.uint8), axis=-1)
    return out


def test_real_fixture(tmp):
    mask = np.array(
        Image.open(f"{REF}/masks/head_front.png").convert("RGB"))
    thr = ((mask[..., 0].astype(np.int32) > 200)
           & (mask[..., 1].astype(np.int32) < 60)
           & (mask[..., 2].astype(np.int32) < 60))
    n_thr = int(thr.sum())
    n_exact = int(erode2(exact_region_masks(mask)["skin"]).sum())
    n_near = int(erode2(region_masks(mask)["skin"]).sum())
    print(f"e counts: thresholded={n_thr} exact_eroded={n_exact} "
          f"nearest_eroded={n_near}")
    assert n_exact / n_thr < 0.5, ("exact", n_exact, n_thr)
    assert n_near / n_thr >= 0.9, ("nearest", n_near, n_thr)
    print(f"e ok: exact {n_exact / n_thr:.3f} < 0.5, "
          f"nearest {n_near / n_thr:.3f} >= 0.9")


def test_synthetic_checker(tmp):
    m = np.zeros((64, 64, 3), dtype=np.uint8)
    sq = np.zeros((40, 40, 3), dtype=np.uint8)
    sq[..., 0] = 255
    yy, xx = np.mgrid[0:40, 0:40]
    sq[(yy + xx) % 2 == 1] = (254, 0, 0)
    m[12:52, 12:52] = sq
    n_exact = int(erode2(exact_region_masks(m)["skin"]).sum())
    n_near = int(erode2(region_masks(m)["skin"]).sum())
    print(f"f counts: square=1600 exact_eroded={n_exact} "
          f"nearest_eroded={n_near}")
    assert n_exact < 160, ("exact", n_exact)
    assert n_near == 1296, ("nearest", n_near)
    print("f ok: exact keeps <10% of square, nearest keeps 1296/1600")


def test_no_oversnap(tmp):
    for rgb in [(128, 128, 128), (128, 0, 128), (128, 128, 0)]:
        px = np.array([[list(rgb)]], dtype=np.uint8)
        got = [n for n, mm in region_masks(px).items() if mm[0, 0]]
        assert got == [], (rgb, got)
    for rgb, want in {(230, 10, 10): "skin", (10, 240, 10): "eyes"}.items():
        px = np.array([[list(rgb)]], dtype=np.uint8)
        got = [n for n, mm in region_masks(px).items() if mm[0, 0]]
        assert got == [want], (rgb, got)
    print("g ok: far pixels in no region; "
          "(230,10,10)->skin (10,240,10)->eyes")


CASES = [
    ("a", test_self),
    ("b", test_bright),
    ("c", test_blur),
    ("d", test_badsize),
    ("e", test_real_fixture),
    ("f", test_synthetic_checker),
    ("g", test_no_oversnap),
]


if __name__ == "__main__":
    tmp = tempfile.mkdtemp(prefix="parity-test-")
    failed = []
    try:
        for name, fn in CASES:
            try:
                fn(tmp)
            except Exception:
                traceback.print_exc()
                print(f"FAIL {name}")
                failed.append(name)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if failed:
        print(f"FAILURES: {','.join(failed)}")
        sys.exit(1)
    print("ALL 7 PASS")
