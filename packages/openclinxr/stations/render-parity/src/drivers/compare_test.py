#!/usr/bin/env python3
"""Self-tests for compare.py. Run: mise exec -- python3 compare_test.py"""
import json
import os
import shutil
import sys
import tempfile
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import COLORS, EYE_SUB, compare_cam, erode2, eye_sub_masks, main, region_masks  # noqa: E402

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
            assert reg["p95_dE"] < 1e-6, (cam, r, reg["p95_dE"])
            assert reg["ssim"] == 1, (cam, r, reg["ssim"])
            assert reg["detail_ratio"] == 1.0, (cam, r, reg["detail_ratio"])
        for r in EYE_SUB:
            reg = m["cameras"][cam]["regions"][r]
            assert reg["mean_dE"] < 1e-6, (cam, r, reg["mean_dE"])
            assert reg["p95_dE"] < 1e-6, (cam, r, reg["p95_dE"])
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


P1B_NOHAIR = "/Volumes/files/openclinxr-assets/store/aisha-parity/p1b/nohair"
P2L_CAMS = ["head_front", "head_34"]


def test_eye_sub_self(tmp):
    # (a) known-good: ref vs itself = 0 mean and 0 p95 on every sub-mask
    from compare import load_rgb  # noqa: E402
    for cam in P2L_CAMS:
        rb = os.path.join(P1B_NOHAIR, "beauty", f"{cam}.png")
        rm = os.path.join(P1B_NOHAIR, "masks", f"{cam}.png")
        res, err = compare_cam(cam, rb, rm, rb)
        assert err is None, (cam, err)
        ref_u8 = load_rgb(rb)
        sub, _ = eye_sub_masks(ref_u8, load_rgb(rm))
        for name in EYE_SUB:
            r = res["regions"][name]
            assert r["n_pixels"] == int(sub[name].sum()), (cam, name)
            assert r["mean_dE"] == 0, (cam, name, r["mean_dE"])
            assert r["p95_dE"] == 0, (cam, name, r["p95_dE"])
            assert r["n_L"] + r["n_R"] == r["n_pixels"], (cam, name)
    print("h ok: ref-vs-self 0 mean+0 p95 on all eye sub-masks, per-eye counts add up")


def test_eye_sub_disjoint(tmp):
    # (b) the four sub-masks are pairwise disjoint and cover the aperture
    from compare import load_rgb  # noqa: E402
    for cam in P2L_CAMS:
        ref_u8 = load_rgb(os.path.join(P1B_NOHAIR, "beauty", f"{cam}.png"))
        mask_u8 = load_rgb(os.path.join(P1B_NOHAIR, "masks", f"{cam}.png"))
        sub, _ = eye_sub_masks(ref_u8, mask_u8)
        eye = region_masks(mask_u8)["eyes"]
        names = list(EYE_SUB)
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                assert int((sub[names[i]] & sub[names[j]]).sum()) == 0, (cam, names[i], names[j])
        assert ((sub["iris"] | sub["sclera"] | sub["catchlights"]) == eye).all(), cam
        assert int((sub["lid_ring"] & eye).sum()) == 0, cam
    print("i ok: sub-masks disjoint, iris|sclera|catchlights == aperture, ring outside")


def test_eye_sub_ring_only(tmp):
    # (c) planted fixture: only ring pixels differ -> ring moves, eye interior stays 0
    from compare import load_rgb  # noqa: E402
    cam = "head_front"
    rb = os.path.join(P1B_NOHAIR, "beauty", f"{cam}.png")
    rm = os.path.join(P1B_NOHAIR, "masks", f"{cam}.png")
    ref_u8 = load_rgb(rb)
    sub, _ = eye_sub_masks(ref_u8, load_rgb(rm))
    ring = sub["lid_ring"]
    assert int(ring.sum()) > 1000, int(ring.sum())
    planted = ref_u8.copy()
    up = np.clip(planted[ring].astype(np.int32) + 60, 0, 255).astype(np.uint8)
    planted[ring] = up
    cp = os.path.join(tmp, "ring-only.png")
    Image.fromarray(planted).save(cp)
    res, err = compare_cam(cam, rb, rm, cp)
    assert err is None, err
    assert res["regions"]["lid_ring"]["mean_dE"] > 1, res["regions"]["lid_ring"]["mean_dE"]
    for name in ("iris", "sclera", "catchlights"):
        r = res["regions"][name]
        assert r["mean_dE"] == 0, (name, r["mean_dE"])
        assert r["p95_dE"] == 0, (name, r["p95_dE"])
    print(f"j ok: ring-only plant moves lid_ring "
          f"({res['regions']['lid_ring']['mean_dE']:.2f}) leaves iris/sclera/catchlights at 0")


CASES = [
    ("a", test_self),
    ("b", test_bright),
    ("c", test_blur),
    ("d", test_badsize),
    ("e", test_real_fixture),
    ("f", test_synthetic_checker),
    ("g", test_no_oversnap),
    ("h", test_eye_sub_self),
    ("i", test_eye_sub_disjoint),
    ("j", test_eye_sub_ring_only),
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
    print("ALL 10 PASS")
