"""hair-hull4 STEP 1+2: mask/target/source symmetry + right-curtain rejection attribution.

Reads (never writes outside E): v4 manifest masks in aisha-v3 VDIR, hull3
baseline_kept.npz + body-depth-3q cache (read-only), cage1 body maps, SDF,
station0b verts. Writes E/sidediag.json + E/asym.png.
"""

import json
import sys
from pathlib import Path

import numpy as np

WORKTREE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
S6 = WORKTREE / "tools/openclinxr/hair-groom/hull"
HAIR_GROOM = S6.parent
sys.path.insert(0, str(S6))
sys.path.insert(0, str(HAIR_GROOM / "cage"))
sys.path.insert(0, str(HAIR_GROOM))

import envelope as ENV  # noqa: E402
import exact as EXACT  # noqa: E402
import hull as H  # noqa: E402
import hull1 as H1  # noqa: E402
import hull2 as H2  # noqa: E402
from PIL import Image as PILImage  # noqa: E402

ROOT = WORKTREE
E = ROOT / "tools/openclinxr/evidence/hair-hull4"
WS = E / "workspace"
E3 = ROOT / "tools/openclinxr/evidence/hair-hull3"
WS3 = E3 / "workspace"
VDIR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
FRAME = 1024
MID = FRAME // 2

H1.MANIFEST = "aisha_straight_long_v4.json"
H1.WS = WS3  # read-only reuse of the deterministic 3q body-depth cache
H2.MANIFEST = "aisha_straight_long_v4.json"
H2.VDIR = VDIR
H2.E = E3
H2.WS = WS3
H2.use_final()
inp = H.load_inputs()
views = list(inp["views"])
assert views == ["front", "three_quarter", "profile_90", "back"], views

out = {"views": views}

# ---- STEP 1a: mask L/R area + lowest row per side of image midline col 512
masks = {}
for v, mp in (("front", "mask-front.png"),
              ("three_quarter", "mask-three_quarter.png"),
              ("profile_90", "mask-profile.png"),
              ("back", "mask-back.png")):
    m = np.array(PILImage.open(VDIR / mp).convert("L")) > 127
    masks[v] = m
    L, R = m[:, :MID], m[:, MID:]
    rowsL = np.nonzero(L.any(axis=1))[0]
    rowsR = np.nonzero(R.any(axis=1))[0]
    out.setdefault("maskSym", {})[v] = {
        "file": mp, "totalPx": int(m.sum()),
        "areaL": int(L.sum()), "areaR": int(R.sum()),
        "L_over_R": round(float(L.sum()) / max(1, int(R.sum())), 4),
        "lowestRowL": int(rowsL.max()) if len(rowsL) else None,
        "lowestRowR": int(rowsR.max()) if len(rowsR) else None,
    }
    print("MASK %s tot=%d L=%d R=%d L/R=%.4f lowL=%s lowR=%s" % (
        v, m.sum(), L.sum(), R.sum(),
        L.sum() / max(1, R.sum()),
        rowsL.max() if len(rowsL) else None,
        rowsR.max() if len(rowsR) else None), flush=True)

# ---- STEP 1b: bald body symmetry from the station0b mesh (metres -> mm)
bv = np.load(str(ROOT / "tools/openclinxr/evidence/hair-station0b/body-verts.npz"))
vv = np.array(bv["vertices"], dtype=np.float64) * 1000.0
bod = {}
for nm, sel in (("shoulderSlab_xneg", (np.abs(vv[:, 0]) > 120) & (np.abs(vv[:, 0]) < 220)
                 & (vv[:, 1] > -50) & (vv[:, 1] < 100) & (vv[:, 0] < 0)),
                ("shoulderSlab_xpos", (np.abs(vv[:, 0]) > 120) & (np.abs(vv[:, 0]) < 220)
                 & (vv[:, 1] > -50) & (vv[:, 1] < 100) & (vv[:, 0] >= 0)),
                ("arm_xneg", vv[:, 0] < -220),
                ("arm_xpos", vv[:, 0] >= 220)):
    bod[nm] = {"n": int(sel.sum()),
               "zmax": round(float(vv[sel, 2].max()), 1) if sel.any() else None,
               "zmin": round(float(vv[sel, 2].min()), 1) if sel.any() else None,
               "centroidMm": [round(float(a), 1) for a in vv[sel].mean(axis=0)]
               if sel.any() else None}
bod["headSlabXmean_mm"] = round(float(vv[vv[:, 2] > 1500, 0].mean()), 3)
out["bodySymMesh"] = bod
print("BODY", json.dumps(bod), flush=True)

# ---- STEP 2: mirror kept left below-shoulder side curtain -> right, score
ws = np.load(str(WS3 / "baseline_kept.npz"))
final = np.array(ws["final"])
xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]), np.array(ws["zs"]))
Xg, Yg, Zg = np.meshgrid(xs, ys, zs, indexing="ij")
below = Zg < H.SHOULDER_PLANE_Z
adx = np.abs(Xg)
frontM = below & ((Yg + 50.0) <= -adx)
backM = below & ((Yg + 50.0) >= adx)
side = below & ~frontM & ~backM
sideL = side & (Xg < 0)
sideR = side & (Xg >= 0)
keptL = int((final & sideL).sum())
keptR = int((final & sideR).sum())
out["hull3BelowShoulderKept"] = {"sideL": keptL, "sideR": keptR,
                                 "L_over_R": round(keptL / max(1, keptR), 4)}
print("HULL3 kept sideL=%d sideR=%d L/R=%.4f" % (keptL, keptR, keptL / max(1, keptR)),
      flush=True)

idx = np.nonzero(final & sideL)
pts = np.stack([Xg[idx], Yg[idx], Zg[idx]], axis=1)
mir = pts.copy()
mir[:, 0] *= -1.0
dil = H.dilate_masks(inp["masks"], 2)
occ = H.occluder_maps(inp["body"])
st = H.states_for_points(mir, inp, dil, occ)
sdf = EXACT.query_exact(inp["egrid"], mir)
clear = sdf > H.SDF_CLEAR_MM
assert bool(clear.all()), "mirrored curtain must be clear of the body"
n = len(pts)
per_view = {}
for vi, v in enumerate(views):
    s = st[:, vi]
    per_view[v] = {"INSIDE": int((s == 0).sum()),
                   "VISIBLE_OUTSIDE": int((s == 1).sum()),
                   "BODY_OCCLUDED": int((s == 2).sum())}
rej = (st == 1).any(axis=1)
nrej = int(rej.sum())
sel = st[rej]
sole = (sel == 1).sum(axis=1) == 1
attr = {"nMirrored": n, "nRejectedAnyOutside": nrej,
        "rejectedFrac": round(nrej / max(1, n), 4),
        "nSole": int(sole.sum()), "nMulti": int((~sole).sum()),
        "perViewStates": per_view, "soleReject": {}, "anyReject": {}}
for vi, v in enumerate(views):
    attr["soleReject"][v] = int(((sel[:, vi] == 1) & sole).sum())
    attr["anyReject"][v] = int((sel[:, vi] == 1).sum())
attr["rejZmin"] = round(float(mir[rej, 2].min()), 1)
attr["rejZmax"] = round(float(mir[rej, 2].max()), 1)
out["rightCurtainAttribution"] = attr
print("ATTR " + json.dumps(attr, indent=1), flush=True)
np.savez_compressed(str(WS / "sidediag_pts.npz"),
                    mir_xyz=np.ascontiguousarray(mir),
                    rejected=np.ascontiguousarray(rej),
                    states=np.ascontiguousarray(st),
                    sole=np.ascontiguousarray(sole if nrej else np.zeros(0, bool)))

# ---- figure: row1 masks + midline + lowest rows; row2 rejected projections
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

REJ_VIEWS = ("front", "three_quarter", "profile_90")
REJ_COLORS = {"front": (255, 70, 70), "three_quarter": (255, 170, 0),
              "profile_90": (70, 170, 255)}
TGT = {"front": "target-front.png", "three_quarter": "target-three_quarter.png",
       "profile_90": "target-profile.png", "back": "target-back.png"}
vi = {v: views.index(v) for v in views}

fig, axes = plt.subplots(2, 4, figsize=(24, 14))
for ax, v in zip(axes[0], views):
    m = masks[v]
    rgb = np.zeros((FRAME, FRAME, 3), dtype=np.uint8) + 25
    rgb[m] = (200, 200, 200)
    ms = out["maskSym"][v]
    ax.imshow(rgb[::2, ::2])
    ax.axvline(MID / 2, color="white", linewidth=1.0, linestyle="--")
    if ms["lowestRowL"] is not None:
        ax.hlines(ms["lowestRowL"] / 2, 0, MID / 2, colors="lime", linewidths=2)
    if ms["lowestRowR"] is not None:
        ax.hlines(ms["lowestRowR"] / 2, MID / 2, FRAME / 2, colors="cyan",
                  linewidths=2)
    ax.set_title("%s mask\nL=%d R=%d L/R=%.3f lowL=%s lowR=%s" % (
        v, ms["areaL"], ms["areaR"], ms["L_over_R"],
        ms["lowestRowL"], ms["lowestRowR"]), fontsize=10)
    ax.axis("off")

sensor = inp["sensor"]
cams = inp["cams"]
tr = inp["transforms"]
rej_pts = mir[rej] / 1000.0
rej_st = st[rej]
for ax, v in zip(axes[1], views):
    tgt = np.asarray(PILImage.open(VDIR / TGT[v]).convert("RGB"))
    rgb = (tgt[::2, ::2]).copy()
    cam = cams["views"][v]
    cols, rows, dep = ENV.project_to_render(rej_pts, cam, sensor)
    t = tr[v]
    ct = np.rint(float(t["scale"]) * cols + float(t["tx"])).astype(np.int64)
    rt = np.rint(float(t["scale"]) * rows + float(t["ty"])).astype(np.int64)
    ok = (ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME) & (dep > 0)
    n_multi = 0
    for c, r, srow in zip(ct[ok] // 2, rt[ok] // 2, rej_st[ok]):
        rejv = [vv for vv in REJ_VIEWS if srow[vi[vv]] == 1]
        col = (255, 0, 255) if len(rejv) != 1 else REJ_COLORS[rejv[0]]
        if len(rejv) != 1:
            n_multi += 1
        rgb[r, c] = col
    n_ok = int(ok.sum())
    ax.imshow(rgb)
    ax.set_title("%s: rejected right curtain\n(n=%d/%d in frame)" % (
        v, n_ok, nrej), fontsize=10)
    ax.axis("off")

fig.text(0.5, 0.97, "hair-hull4 STEP1/2: aisha-v3 masks L/R about image midline "
         "(top: green=L lowest row, cyan=R lowest, white dashed=midline) + "
         "hull3-rejected right-curtain voxels by rejecting view (bottom: "
         "red=front orange=3q blue=profile magenta=multi); hull3 kept "
         "below-shoulder sideL=%d sideR=%d L/R=%.2f" % (
             keptL, keptR, keptL / max(1, keptR)),
         ha="center", va="top", fontsize=11)
fig.subplots_adjust(top=0.88, bottom=0.03, left=0.02, right=0.98,
                    hspace=0.18, wspace=0.06)
fig.savefig(str(E / "asym.png"), dpi=100)
plt.close(fig)

(WS / "sidediag.json").write_text(json.dumps(out, indent=1))
(E / "sidediag.json").write_text(json.dumps(out, indent=1))
print("wrote E/sidediag.json + E/asym.png", flush=True)
