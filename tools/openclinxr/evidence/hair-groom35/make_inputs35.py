"""hair-groom35 STEP 1: symmetric ear inputs (E driver, no prior-script copy).

Writes (store/, NOT git):
  /Volumes/files/openclinxr-assets/store/hair-groom35/ear_pinna-mirror35.npz
    xyz: original 15949 verts + 174 appended EXACT mirrors
         (168 mirrored idx_earXpos + 6 mirrored concha-fill verts);
    idx_earXpos: 168 file verts + groom34's 6 concha fill verts (see below);
    idx_earXneg: the 174 appended mirrors (exact: max|mirror diff| == 0).
Writes (E/, git):
  earframe-mirror35.json: sides.xneg = sides.xpos with x negated
    (|x| boxes, y/z identical by construction); non-sides content
    carried through unchanged (cheekIdx/bandIdx are root-index lists
    unused by interp_children).
  inputs-mirror35.png: per-side ear close-up plots, both sets overlaid.
  inputs-mirror35.json: counts, sha, symmetry numbers (provenance).

The 6 concha fill verts are groom34's ear_proxy.py --fill-bowl set
(imported, not copied): neighbourhood skin verts inside the +x outer
boundary loop. Asserted == 6 (ear-proxy.json fillBowl.nAdded).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
STRANDS = E.parents[2] / "openclinxr" / "hair-groom" / "strands"
sys.path.insert(0, str(STRANDS))
import ear_proxy as EP  # noqa: E402 (import, no copy)

STORE = Path("/Volumes/files/openclinxr-assets/store/hair-groom35")
PINNA_SRC = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2"
    "/tools/openclinxr/evidence/hair-hull4/workspace/ear_pinna.npz")
FRAME_SRC = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2"
    "/tools/openclinxr/evidence/hair-groom4/tucked/earframe.json")


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def main():
    STORE.mkdir(parents=True, exist_ok=True)
    p = np.load(str(PINNA_SRC), allow_pickle=True)
    xyz = np.asarray(p["xyz"], dtype=np.float64)
    idx_pos = np.asarray(p["idx_earXpos"], dtype=np.int64)
    assert len(idx_pos) == 168, len(idx_pos)

    # groom34's 6 concha fill verts: ear_proxy --fill-bowl logic (imported).
    m = np.load(str(EP.MESHES), allow_pickle=True)
    bv = np.asarray(m["body_v"], dtype=np.float64)
    bf = np.asarray(m["body_f"], dtype=np.int64)
    assert abs(float(np.abs(xyz - bv).max()) * 1000.0) < 0.01, \
        "pinna xyz vs body_v mismatch"
    uverts, pfaces = EP.patch_from_idx(bf, idx_pos)
    glo_faces = uverts[pfaces]
    _, loops = EP.boundary_loops(glo_faces)
    outer = max(loops, key=len)
    poly = bv[np.array(outer)][:, 1:3]
    from matplotlib.path import Path as _Path
    side_nb = np.nonzero(
        (bv[:, 0] > 0.04) & (bv[:, 0] < 0.10)
        & (bv[:, 1] > -0.14) & (bv[:, 1] < -0.03)
        & (bv[:, 2] > 1.48) & (bv[:, 2] < 1.57))[0]
    inside = _Path(poly).contains_points(bv[side_nb][:, 1:3])
    add = np.array([i for i in side_nb[inside]
                    if i not in set(idx_pos.tolist())], dtype=np.int64)
    assert len(add) == 6, ("fill verts != groom34's 6", len(add))
    print("fill verts (body-mesh idx):", add.tolist())

    idx_pos174 = np.concatenate([idx_pos, add])
    mir = xyz[idx_pos174].copy()
    mir[:, 0] *= -1.0
    xyz2 = np.vstack([xyz, mir])
    idx_neg174 = np.arange(len(xyz), len(xyz) + len(mir), dtype=np.int64)
    out = STORE / "ear_pinna-mirror35.npz"
    np.savez_compressed(str(out), xyz=xyz2,
                        idx_earXpos=idx_pos174, idx_earXneg=idx_neg174)

    # symmetry proof: -x set vs mirrored +x set (exact IEEE: (-a)*-1 == a)
    a = xyz2[idx_neg174]
    b = xyz2[idx_pos174].copy()
    b[:, 0] *= -1.0
    maxdiff_mm = float(np.abs(a - b).max() * 1000.0)
    print("max|mirror diff| mm:", maxdiff_mm)
    assert maxdiff_mm == 0.0, maxdiff_mm

    # mirrored earframe: -x side = +x side with x negated
    frame = json.loads(FRAME_SRC.read_text())
    xp = frame["sides"]["xpos"]
    xn = json.loads(json.dumps(xp))
    xn["xEarMm"] = -float(xp["xEarMm"])
    xn["helixTopMm"] = [-float(xp["helixTopMm"][0]),
                        float(xp["helixTopMm"][1]),
                        float(xp["helixTopMm"][2])]
    xn["lobeBottomMm"] = [-float(xp["lobeBottomMm"][0]),
                          float(xp["lobeBottomMm"][1]),
                          float(xp["lobeBottomMm"][2])]
    frame["sides"]["xneg"] = xn
    frame["provenance"] = {
        "src": str(FRAME_SRC),
        "rule": "sides.xneg = deepcopy(sides.xpos) with x-negated "
                "xEarMm/helixTopMm[0]/lobeBottomMm[0]; |x| boxes and all "
                "y/z carried verbatim (symmetric by construction)",
        "cheekBandNote": "cheekIdx/bandIdx/nCheek/nBand carried through "
                         "unchanged: root-index lists from the asymmetric "
                         "scalp, unread by interp_children (gates/stages "
                         "use sides.*BoxMm only)",
    }
    fderiv = {k: v for k, v in xn.items() if k != "provenance"}
    xporig = {k: v for k, v in xp.items()}
    assert fderiv.keys() == xporig.keys()
    (E / "earframe-mirror35.json").write_text(
        json.dumps(frame, indent=1) + "\n")

    # plots: per side, own set + other side mirrored onto it (must coincide)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 2, figsize=(12, 6))
    px = xyz2[idx_pos174]
    nx = xyz2[idx_neg174]
    nx_back = nx.copy()
    nx_back[:, 0] *= -1.0
    px_over = px.copy()
    px_over[:, 0] *= -1.0
    for ai, (own, other, nm) in enumerate(
            ((px, nx_back, "xpos"), (nx, px_over, "xneg"))):
        a = ax[ai]
        a.scatter(own[:, 1] * 1000, own[:, 2] * 1000, s=4, c="orange",
                  label="own set")
        a.scatter(other[:, 1] * 1000, other[:, 2] * 1000, s=2, c="blue",
                  label="other side mirrored")
        a.set_title("%s (y-z mm) maxdiff %.1f mm" % (nm, maxdiff_mm))
        a.set_aspect("equal")
        a.legend(markerscale=3, fontsize=8)
    fig.tight_layout()
    fig.savefig(E / "inputs-mirror35.png", dpi=100)
    print("wrote", E / "inputs-mirror35.png")

    meta = {
        "pinnaSrc": str(PINNA_SRC),
        "pinnaSrcSha256": sha256(str(PINNA_SRC)),
        "pinnaOut": str(out),
        "pinnaOutSha256": sha256(str(out)),
        "idxEarXposN": int(len(idx_pos174)),
        "idxEarXnegN": int(len(idx_neg174)),
        "fillIdx": [int(i) for i in add],
        "maxMirrorDiffMm": maxdiff_mm,
        "frameSrc": str(FRAME_SRC),
        "frameOut": str(E / "earframe-mirror35.json"),
        "frameXnegMirrorOfXpos": {
            "xEarMm": xn["xEarMm"], "helixTopMm": xn["helixTopMm"],
            "lobeBottomMm": xn["lobeBottomMm"]},
    }
    (E / "inputs-mirror35.json").write_text(
        json.dumps(meta, indent=1) + "\n")
    print(json.dumps(meta, indent=1))
    print("WROTE STEP1 INPUTS")


if __name__ == "__main__":
    main()
