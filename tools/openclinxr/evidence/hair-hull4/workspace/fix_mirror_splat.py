"""hair-hull4: honest mirror-profile silhouette + diag patch (E-side).

Subtlety (verified, see RESULT): H.view_source routes 'profile_90_mirror'
through the profile pipeline on x-mirrored points with the REAL camera and
the UNFLIPPED mask. For the carve rule that is exactly equivalent to the
explicit mirrored camera + flipped mask (mirror_verify(a): cols_mc(p) =
W - cols_real(mirror(p)) with 0.0 px error), so the carved occupancy/states
are correct. But splat_visible re-projects the mirrored points with the
real camera, which is NOT the mirror-frame silhouette (it re-lands on the
unflipped side); comparing it to the flipped mask reads exc p95 ~291 on a
volumetrically symmetric hull (mirror IoU 0.985).

Fix here (no re-carve: occupancy/states are already right): rebuild the
TRUE mirror-frame silhouette by projecting the state-0 voxels for the
mirror view with the EXPLICIT mirrored camera (H.mirror_camera, the same
construction the carve-equivalence rests on), overwrite
WS/splat_final_profile_90_mirror.npy with it, and recompute diag.json's
profile_90_mirror contour entry against the flipped mask. Must run BEFORE
sens (sensitivity reads its base contour from diag.json).
"""

import json
import sys
from pathlib import Path

import numpy as np

WORKTREE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom/hull"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom/cage"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/evidence/hair-hull4/workspace"))

import envelope as ENV  # noqa: E402
import hull as H  # noqa: E402
from work import apply_all, loader  # noqa: E402

apply_all()
inp = loader()
views = list(inp["views"])
assert views == ["front", "three_quarter", "three_quarter_mirror",
                 "profile_90", "back", "profile_90_mirror"], views

E4 = WORKTREE / "tools/openclinxr/evidence/hair-hull4"
WS4 = E4 / "workspace"
ws = np.load(str(WS4 / "baseline_kept.npz"))
final = np.array(ws["final"])
sp = np.array(ws["states_packed"])
xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]), np.array(ws["zs"]))
print("states dtype", sp.dtype, "max", int(sp.max()), "3^6-1 = 728")

Xg, Yg, Zg = np.meshgrid(xs, ys, zs, indexing="ij")
for vname, src, flip in (("profile_90_mirror", "profile_90", True),):
    vi = views.index(vname)
    st = H.unpack_state(sp, vi)
    sel = final & (st == 0)
    print(vname, "state-0 vox", int(sel.sum()))
    pts = np.stack([Xg[sel], Yg[sel], Zg[sel]], axis=1) / 1000.0
    mc = H.mirror_camera(inp["cams"]["views"][src])
    cols, rows, _ = ENV.project_to_render(pts, mc, inp["sensor"])
    t = inp["transforms"][vname]
    assert t["scale"] == 1.0 and t["tx"] == 0.0 and t["ty"] == 0.0
    ct = np.rint(cols).astype(np.int64)
    rt = np.rint(rows).astype(np.int64)
    ok = (ct >= 0) & (ct < H.FRAME) & (rt >= 0) & (rt < H.FRAME)
    m = np.zeros((H.FRAME, H.FRAME), dtype=bool)
    m[rt[ok], ct[ok]] = True
    print(vname, "true silhouette px", int(m.sum()))
    np.save(str(WS4 / ("splat_final_%s.npy" % vname)), m)
    splat_all = {v: np.load(str(WS4 / ("splat_final_%s.npy" % v)))
                 for v in views}
    cm = H.contour_metrics(splat_all, inp["masks"])
    print(vname, "contour vs flipped mask:", json.dumps(cm[vname]))
    dp = WS4 / "diag.json"
    d = json.loads(dp.read_text())
    d["contour"][vname] = cm[vname]
    d["mirrorSplatNote"] = (
        "splat_final_profile_90_mirror.npy is the TRUE mirror-frame "
        "silhouette (state-0 voxels projected with the explicit mirrored "
        "camera H.mirror_camera(profile_90)); the legacy splat_visible "
        "mirror branch re-projects mirrored points with the real camera "
        "and must NOT be compared to the flipped mask (see RESULT).")
    dp.write_text(json.dumps(d, indent=1))
    print("patched diag.json contour[%s]" % vname)
