"""hair-hull4 STEP 3 driver (E-side): 5-view re-carve with mirrored profile.

Binds the v4 inputs + hull3.MIRROR_PROFILE into the hull4 evidence root and
runs the hull3 stage chain (carve/mismatch/diag/sensitivity/export/ear/
report3). No Blender figure: STEP4's file list needs no hull.png (stated in
RESULT). Run: work.py --stage setup|carve|quick|mid|sens|export|ear|report|all
(all = everything after setup).
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np

WORKTREE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
S6 = WORKTREE / "tools/openclinxr/hair-groom/hull"
HAIR_GROOM = S6.parent
sys.path.insert(0, str(S6))
sys.path.insert(0, str(HAIR_GROOM / "cage"))
sys.path.insert(0, str(HAIR_GROOM))

import hull as H  # noqa: E402
import hull1 as H1  # noqa: E402
import hull2 as H2  # noqa: E402
import hull3 as H3  # noqa: E402
import envelope as ENV  # noqa: E402

ROOT = WORKTREE
E4 = ROOT / "tools/openclinxr/evidence/hair-hull4"
WS4 = E4 / "workspace"
E3 = ROOT / "tools/openclinxr/evidence/hair-hull3"
WS3 = E3 / "workspace"
V4 = ("front", "three_quarter", "profile_90", "back")
# H2.add_mirror_3q overwrites views with its own 5-list, so it runs first
# and add_mirror_profile (append-only) runs second.
V6 = ("front", "three_quarter", "three_quarter_mirror", "profile_90", "back",
      "profile_90_mirror")
BASE_LOADER = H1.load_inputs  # original 4-view v4 loader (saved before patch)
ORIG_SPLAT_VISIBLE = H.splat_visible  # saved before the E-side mirror patch


def splat_visible_fixed(occ, packed, xs, ys, zs, inp):
    """H.splat_visible + an honest profile-mirror entry (E-side patch).

    The legacy mirror branch re-projects x-mirrored points with the REAL
    camera, which re-lands on the unflipped side and must NOT be compared
    to the flipped mask (reads exc p95 ~291 on a symmetric hull). The carve
    rule itself is unaffected (W-u identity, see RESULT). Here the mirror
    entry is rebuilt as the TRUE mirror-frame silhouette: the mirror
    view's state-0 voxels projected with the EXPLICIT mirrored camera
    (H.mirror_camera, same construction the carve-equivalence rests on).
    No hull/ method code is copied: the original runs first, then one
    entry is replaced.
    """
    out = ORIG_SPLAT_VISIBLE(occ, packed, xs, ys, zs, inp)
    views = list(inp["views"])
    if "profile_90_mirror" not in views:
        return out
    Xg, Yg, Zg = np.meshgrid(xs, ys, zs, indexing="ij")
    vi = views.index("profile_90_mirror")
    st = H.unpack_state(np.asarray(packed), vi)
    sel = np.asarray(occ) & (st == 0)
    pts = np.stack([Xg[sel], Yg[sel], Zg[sel]], axis=1) / 1000.0
    mc = H.mirror_camera(inp["cams"]["views"]["profile_90"])
    cols, rows, _ = ENV.project_to_render(pts, mc, inp["sensor"]) \
        if pts.shape[0] else (np.zeros(0), np.zeros(0), np.zeros(0))
    t = inp["transforms"]["profile_90_mirror"]
    ct = np.rint(float(t["scale"]) * cols + float(t["tx"])).astype(np.int64)
    rt = np.rint(float(t["scale"]) * rows + float(t["ty"])).astype(np.int64)
    ok = (ct >= 0) & (ct < H.FRAME) & (rt >= 0) & (rt < H.FRAME)
    m = np.zeros((H.FRAME, H.FRAME), dtype=bool)
    if int(ok.sum()):
        m[rt[ok], ct[ok]] = True
    out["profile_90_mirror"] = m
    return out


def loader():
    # Base loader derives views from H.VIEWS via all_views(); hold it at the
    # 4-view set here (apply_all leaves the process global at V6 for the
    # carve-time consumers that iterate H.VIEWS: occluder/contour/sens).
    old = H.VIEWS
    H.VIEWS = V4
    try:
        inp = BASE_LOADER()
    finally:
        H.VIEWS = old
    assert inp["views"] == list(V4), inp["views"]
    if H3.MIRROR_3Q:
        inp = H2.add_mirror_3q(inp)
    if H3.MIRROR_PROFILE:
        inp = H3.add_mirror_profile(inp, WS4)
    return inp


def apply_all():
    H3.MIRROR_PROFILE = True
    H3.MIRROR_3Q = True
    H3.E = E4
    H3.WS = WS4
    H1.MANIFEST = "aisha_straight_long_v4.json"
    H1.E = E4
    H1.WS = WS4
    H2.MANIFEST = "aisha_straight_long_v4.json"
    H2.VDIR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/"
                   "target-views/aisha-v3")
    H2.E = E4
    H2.WS = WS4
    H2.FINAL = "base"
    H.E = E4
    H.WS = WS4
    H.VIEWS = V6
    H.USE_MIRROR = False
    H.load_inputs = loader
    H1.load_inputs = loader
    H.splat_visible = splat_visible_fixed
    E4.mkdir(parents=True, exist_ok=True)
    WS4.mkdir(parents=True, exist_ok=True)


def stage_setup():
    apply_all()
    for f in ("body-depth-3q.npz", "poke_anatomy.json", "ear_boxes.json"):
        src, dst = WS3 / f, WS4 / f
        assert src.exists(), src
        if not dst.exists():
            shutil.copy(src, dst)
            print("copied %s (read-only reuse: same v4 masks/sources)" % f,
                  flush=True)
    inp = loader()
    assert inp["views"] == list(V6), inp["views"]
    assert inp["masks"]["profile_90_mirror"].shape == (1024, 1024)
    assert inp["masks"]["three_quarter_mirror"].shape == (1024, 1024)
    base = np.array(inp["masks"]["profile_90"], dtype=bool)
    assert (np.array(inp["masks"]["profile_90_mirror"], dtype=bool)
            == np.fliplr(base)).all()
    base3q = np.array(inp["masks"]["three_quarter"], dtype=bool)
    assert (np.array(inp["masks"]["three_quarter_mirror"], dtype=bool)
            == np.fliplr(base3q)).all()
    print("inputs ok: 6 views, both mirror masks = fliplr(base)", flush=True)


def stage_carve():
    apply_all()
    H.stage_carve()
    inp = loader()
    dil = H.dilate_masks(inp["masks"], 2)
    occ = H.occluder_maps(inp["body"])
    mv = H.mirror_verify(inp, dil, occ)
    print("MIRRORVERIFY " + json.dumps(mv), flush=True)
    sp = WS4 / "carve_stats.json"
    st = json.loads(sp.read_text())
    st["mirrorVerify"] = mv
    st["mirrorProfileAdded"] = True
    st["mirror3qAdded"] = True
    st["views"] = list(V6)
    ms = st.get("maskSha", {})
    ms["three_quarter_mirror"] = {
        "fliplrOf": "three_quarter",
        "sha256": ms.get("three_quarter")}
    st["maskSha"] = ms
    sp.write_text(json.dumps(st, indent=1))


def side_ratio():
    ws = np.load(str(WS4 / "baseline_kept.npz"))
    final = np.array(ws["final"])
    xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]),
                  np.array(ws["zs"]))
    b = H1.below_shoulder(final, xs, ys, zs)
    L, R = b["sideL"]["vox"], b["sideR"]["vox"]
    return {"sideL": L, "sideR": R,
            "L_over_R": round(L / max(1, R), 4),
            "pass": bool(0.8 <= L / max(1, R) <= 1.25),
            "below": b}


def stage_quick():
    apply_all()
    print("SIDERATIO " + json.dumps(side_ratio(), indent=1), flush=True)


def stage_mid():
    apply_all()
    H2.stage_mismatch()
    if (WS4 / "diag.json").exists():
        print("diag.json exists, skip (delete to rerun)", flush=True)
    else:
        H2.stage_diag_ext()


def stage_sens():
    apply_all()
    H.stage_sensitivity()


def stage_export():
    apply_all()
    H.stage_export()


def stage_ear():
    apply_all()
    H3.stage_ear()


def stage_report():
    apply_all()
    H3.stage_report3()
    H2.write_opened()
    print("SIDERATIO " + json.dumps(side_ratio()["sideL"] and side_ratio(),
                                   indent=1), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all",
                    choices=["setup", "carve", "quick", "mid", "sens",
                             "export", "ear", "report", "all"])
    args = ap.parse_args()
    run = args.stage
    if run in ("setup", "all"):
        stage_setup()
    if run in ("carve", "all"):
        stage_carve()
    if run in ("quick", "all"):
        stage_quick()
    if run in ("mid", "all"):
        stage_mid()
    if run in ("sens", "all"):
        stage_sens()
    if run in ("export", "all"):
        stage_export()
    if run in ("ear", "all"):
        stage_ear()
    if run in ("report", "all"):
        stage_report()


if __name__ == "__main__":
    main()
