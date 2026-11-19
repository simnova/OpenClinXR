#!/usr/bin/env python3
"""I7b lever proof (cap42 condition): the p2h-f0 eyeShade lever records values it applies.

Reads two capture dirs + masks (no browser). Every clause is evaluated
(no short-circuit); per-clause PASS/FAIL is logged; exit 0 iff ALL pass.
Readback and the sclera_L margin are checked TOGETHER: a readback alone
passes a lever that records values it never applies.

Clauses (cam defaults to head_front):
  A  f0 evidence.json carries an eyeShade readback
     (cameras/<cam>/evidence/parity/physical/eyeShade, non-null).
  B  readback resolved values equal the preset's physical.eyeShade
     (scleraAtten, lidBandM, lidDarken).
  C  >= 1 installed globe material (len(readback.matched) >= 1).
  D  >= 2 lid margins (2 * readback.margins >= 2; the readback counts
     per-mesh L/R margin pairs).
  E  control evidence.json has NO eyeShade readback (null or absent).
  F  sclera_L(f0) < sclera_L(control) - 2*F_sclera, where
     F_sclera = |sclera_L(p1a-nohair) - sclera_L(p1b-nohair)| on <cam>,
     each image measured through the ref mask of its own registration
     contract (f0/control through --mask; refs through their own masks).

Usage:
  python3 -I eye_shade_proof.py --f0 E/cap/p2h-f0-nohair --control E/cap/p2b-e2-nohair \
      --preset P/src/presets/p2h-f0.json --ref-p1a STORE/p1a-nohair \
      --ref-p1b STORE/p1b/nohair [--cam head_front]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import load_rgb  # noqa: E402
from eye_detail import analyze  # noqa: E402


def load_evidence(capdir, cam):
    with open(os.path.join(capdir, "evidence.json")) as fh:
        d = json.load(fh)
    return d["cameras"][cam]["evidence"]["parity"]["physical"].get("eyeShade")


def sclera_L(imgpath, maskpath):
    img, mask = load_rgb(imgpath), load_rgb(maskpath)
    assert img.shape == mask.shape, (imgpath, img.shape, mask.shape)
    return analyze(img, mask)["sclera_L"]


def check(f0, control, preset_path, ref_p1a, ref_p1b, mask_p1b, cam):
    """Evaluate every clause; return (results, ok). results: list of (name, passed, detail)."""
    with open(preset_path) as fh:
        want = json.load(fh)["physical"]["eyeShade"]
    results = []

    try:
        rb = load_evidence(f0, cam)
    except Exception as e:  # missing file / bad shape counts as clause-A FAIL, not a crash
        rb = None
        results.append(("A:readback-present", False, f"unreadable: {e}"))
    if not any(n.startswith("A:") for n, _, _ in results):
        results.append(("A:readback-present", rb is not None,
                        f"readback={json.dumps(rb)[:200] if rb else None}"))
    if rb is not None:
        vals_ok = all(rb.get(k) == want[k] for k in ("scleraAtten", "lidBandM", "lidDarken"))
        results.append(("B:readback-values-match-preset", vals_ok,
                        f"got scleraAtten={rb.get('scleraAtten')} lidBandM={rb.get('lidBandM')} "
                        f"lidDarken={rb.get('lidDarken')} want={json.dumps(want)}"))
        matched = rb.get("matched") or []
        results.append(("C:>=1-globe-material", len(matched) >= 1,
                        f"matched={len(matched)} {json.dumps(matched)[:160]}"))
        margins = rb.get("margins")
        lid = 2 * margins if isinstance(margins, (int, float)) else -1
        results.append(("D:>=2-lid-margins", lid >= 2,
                        f"marginPairs={margins} -> lidMargins={lid}"))
    else:
        results.append(("B:readback-values-match-preset", False, "no readback"))
        results.append(("C:>=1-globe-material", False, "no readback"))
        results.append(("D:>=2-lid-margins", False, "no readback"))

    try:
        crb = load_evidence(control, cam)
    except Exception as e:
        crb = f"unreadable: {e}"
    results.append(("E:control-has-no-readback", crb is None,
                    f"control readback={json.dumps(crb)[:160] if crb else None}"))

    try:
        f0_L = sclera_L(os.path.join(f0, f"{cam}.png"), mask_p1b)
        c_L = sclera_L(os.path.join(control, f"{cam}.png"), mask_p1b)
        a_L = sclera_L(os.path.join(ref_p1a, "beauty", f"{cam}.png"),
                       os.path.join(ref_p1a, "masks", f"{cam}.png"))
        b_L = sclera_L(os.path.join(ref_p1b, "beauty", f"{cam}.png"),
                       os.path.join(ref_p1b, "masks", f"{cam}.png"))
        F = abs(a_L - b_L)
        margin = c_L - 2 * F - f0_L
        results.append(("F:sclera-margin", f0_L < c_L - 2 * F,
                        f"sclera_L f0={f0_L:.2f} control={c_L:.2f} "
                        f"F=|{a_L:.2f}-{b_L:.2f}|={F:.2f} 2F={2*F:.2f} "
                        f"gap-2F={margin:+.2f}"))
    except Exception as e:
        results.append(("F:sclera-margin", False, f"unreadable: {e}"))

    return results, all(ok for _, ok, _ in results)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--f0", required=True)
    a.add_argument("--control", required=True)
    a.add_argument("--preset", required=True)
    a.add_argument("--ref-p1a", required=True)
    a.add_argument("--ref-p1b", required=True)
    a.add_argument("--mask", default=None,
                   help="mask for f0/control images (default: <ref-p1b>/masks/<cam>.png)")
    a.add_argument("--cam", default="head_front")
    args = a.parse_args()
    mask = args.mask or os.path.join(args.ref_p1b, "masks", f"{args.cam}.png")
    results, ok = check(args.f0, args.control, args.preset,
                        args.ref_p1a, args.ref_p1b, mask, args.cam)
    for name, passed, detail in results:
        print(f"eye_shade_proof: {'PASS' if passed else 'FAIL'} {name} :: {detail}")
    print(f"eye_shade_proof: {'PASS' if ok else 'FAIL'} overall ({sum(1 for _, p, _ in results if p)}/{len(results)} clauses)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
