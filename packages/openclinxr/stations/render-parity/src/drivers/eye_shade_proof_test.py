#!/usr/bin/env python3
"""Synthetic tests for eye_shade_proof.py (no Blender, no browser).

  good pair: f0 evidence carries a readback matching the preset values with
    >= 1 globe material and >= 2 lid margins, control has no readback, and the
    f0 image is darker-sclera than control beyond 2*F -> overall PASS.
  missing readback: f0 evidence without eyeShade -> clauses A-D FAIL,
    overall FAIL (counterweight: the lever must record what it applies).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import COLORS  # noqa: E402
from eye_shade_proof import check, verify_refs  # noqa: E402

CAM = "head_front"
WANT = {"scleraAtten": 0.35, "lidBandM": 0.007, "lidDarken": 0.85}


def write_png(path, arr):
    Image.fromarray(arr).save(path)


def grey(v, h=40, w=40):
    return np.full((h, w, 3), v, dtype=np.uint8)


def mask_with_eye(h=40, w=40):
    m = np.zeros((h, w, 3), dtype=np.uint8)
    m[10:30, 8:32] = COLORS["eyes"]
    return m


def evidence(dirpath, readback):
    os.makedirs(os.path.join(dirpath), exist_ok=True)
    d = {"cameras": {CAM: {"evidence": {"parity": {"physical": {"eyeShade": readback}}}}}}
    with open(os.path.join(dirpath, "evidence.json"), "w") as fh:
        json.dump(d, fh)


def layout(f0_rb, control_rb):
    """Build synthetic f0/control/ref dirs; f0 sclera dark (L~25), control bright (L~80)."""
    tmp = tempfile.mkdtemp(prefix="eye_shade_proof_test_")
    f0, control = os.path.join(tmp, "f0"), os.path.join(tmp, "control")
    evidence(f0, f0_rb)
    evidence(control, control_rb)
    mask = mask_with_eye()
    for d, v in ((f0, 60), (control, 200)):
        write_png(os.path.join(d, f"{CAM}.png"), grey(v))
    refs = {}
    for name in ("p1a", "p1b"):
        rd = os.path.join(tmp, name)
        os.makedirs(os.path.join(rd, "beauty"))
        os.makedirs(os.path.join(rd, "masks"))
        write_png(os.path.join(rd, "beauty", f"{CAM}.png"), grey(200))
        write_png(os.path.join(rd, "masks", f"{CAM}.png"), mask)
        refs[name] = rd
    preset = os.path.join(tmp, "preset.json")
    with open(preset, "w") as fh:
        json.dump({"physical": {"eyeShade": dict(WANT)}}, fh)
    maskpath = os.path.join(tmp, "cand-mask.png")
    write_png(maskpath, mask)
    return tmp, f0, control, preset, refs, maskpath


GOOD_RB = {"matched": ["globe_mesh|mat_eyes"], "margins": 1,
           "scleraAtten": 0.35, "lidBandM": 0.007, "lidDarken": 0.85,
           "corneaFresnel": False}


def test_good_pair_passes():
    tmp, f0, control, preset, refs, mask = layout(dict(GOOD_RB), None)
    results, ok = check(f0, control, preset, refs["p1a"], refs["p1b"], mask, CAM)
    assert ok, results
    assert all(p for _, p, _ in results), results


def test_missing_readback_fails():
    tmp, f0, control, preset, refs, mask = layout(None, None)
    results, ok = check(f0, control, preset, refs["p1a"], refs["p1b"], mask, CAM)
    assert not ok, results
    byname = dict((n, p) for n, p, _ in results)
    for clause in ("A:readback-present", "B:readback-values-match-preset",
                   "C:>=1-globe-material", "D:>=2-lid-margins"):
        assert byname[clause] is False, (clause, results)
    # the sclera margin clause still evaluates (no short-circuit)
    assert "F:sclera-margin" in byname, results


def pinned_dirs():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "eye_shade_proof_refs.json")) as fh:
        return json.load(fh)["refs"]


def test_temp_ref_dir_refuses():
    """A ref dir that is not the pinned one refuses (exit path 2)."""
    tmp = tempfile.mkdtemp(prefix="eye_shade_proof_refuse_")
    for sub in ("beauty", "masks"):
        os.makedirs(os.path.join(tmp, sub))
        write_png(os.path.join(tmp, sub, f"{CAM}.png"), grey(10))
    assert verify_refs(tmp, tmp, CAM) == 2


def copy_pinned_refs():
    """Copy the pinned p1a/p1b ref dirs to temp. Returns (tmp, copies)."""
    pins = pinned_dirs()
    tmp = tempfile.mkdtemp(prefix="eye_shade_proof_maskchg_")
    copies = {}
    for a in ("--ref-p1a", "--ref-p1b"):
        dst = os.path.join(tmp, a.strip("-"))
        shutil.copytree(pins[a]["expectedDir"], dst)
        copies[a] = dst
    return tmp, copies


def alter_p1a_mask(p1a_copy):
    """Shrink the eye region in the p1a mask copy so sclera_L moves > 0.01.
    Returns (before, after)."""
    from eye_shade_proof import sclera_L
    before = sclera_L(os.path.join(p1a_copy, "beauty", f"{CAM}.png"),
                      os.path.join(p1a_copy, "masks", f"{CAM}.png"))
    maskpath = os.path.join(p1a_copy, "masks", f"{CAM}.png")
    m = np.array(Image.open(maskpath).convert("RGB"))
    eye = (m[:, :, 0] == 0) & (m[:, :, 1] == 255) & (m[:, :, 2] == 0)
    ys, _ = np.nonzero(eye)
    assert len(ys) > 100, "expected an eye region in the ref mask"
    # Drop every eye row at/below the median eye row (reclass to
    # background): shrinks the eye set the sclera mean is taken over.
    rows = np.unique(ys[ys >= int(np.median(ys))])
    m[rows, :, :] = (0, 0, 0)
    Image.fromarray(m).save(maskpath)
    after = sclera_L(os.path.join(p1a_copy, "beauty", f"{CAM}.png"),
                     maskpath)
    return before, after


def test_mask_change_moves_sclera_refuses():
    """Copies of the recorded refs pass; a MASK edit that moves sclera_L by
    more than 0.01 refuses. Prints before/after values."""
    pins = pinned_dirs()
    missing = [a for a in ("--ref-p1a", "--ref-p1b")
               if not os.path.isdir(pins[a]["expectedDir"])]
    if missing:
        print(f"eye_shade_proof_test: SKIP mask-change test (store absent: {missing})")
        return
    tmp, copies = copy_pinned_refs()
    assert verify_refs(copies["--ref-p1a"], copies["--ref-p1b"], CAM) == 0
    assert verify_refs(copies["--ref-p1a"], copies["--ref-p1b"], "head_34") == 0
    before, after = alter_p1a_mask(copies["--ref-p1a"])
    print(f"eye_shade_proof_test: mask-change sclera_L before={before:.4f} "
          f"after={after:.4f} delta={after - before:+.4f}")
    assert abs(after - before) > 0.01, (before, after)
    assert verify_refs(copies["--ref-p1a"], copies["--ref-p1b"], CAM) == 2


def test_main_refuses_before_clauses():
    """Run the real CLI (main) with an altered p1a mask: exit 2 and no
    per-clause PASS/FAIL lines (the pre-computation refusal fires first)."""
    pins = pinned_dirs()
    missing = [a for a in ("--ref-p1a", "--ref-p1b")
               if not os.path.isdir(pins[a]["expectedDir"])]
    if missing:
        print(f"eye_shade_proof_test: SKIP main-refusal test (store absent: {missing})")
        return
    _tmp, f0, control, preset, _refs, _mask = layout(dict(GOOD_RB), None)
    _rtmp, copies = copy_pinned_refs()
    before, after = alter_p1a_mask(copies["--ref-p1a"])
    assert abs(after - before) > 0.01, (before, after)
    proof = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "eye_shade_proof.py")
    p = subprocess.run(
        [sys.executable, "-I", proof,
         "--f0", f0, "--control", control, "--preset", preset,
         "--ref-p1a", copies["--ref-p1a"], "--ref-p1b", copies["--ref-p1b"],
         "--cam", CAM],
        capture_output=True, text=True)
    out = (p.stdout or "") + "\n" + (p.stderr or "")
    print(f"eye_shade_proof_test: main-refusal rc={p.returncode} "
          f"before={before:.4f} after={after:.4f}")
    assert p.returncode == 2, out
    for line in out.splitlines():
        assert not line.startswith("eye_shade_proof: PASS"), line
        assert not line.startswith("eye_shade_proof: FAIL"), line


if __name__ == "__main__":
    test_good_pair_passes()
    test_missing_readback_fails()
    test_temp_ref_dir_refuses()
    test_mask_change_moves_sclera_refuses()
    test_main_refuses_before_clauses()
    print("eye_shade_proof_test: 5/5 GREEN")
