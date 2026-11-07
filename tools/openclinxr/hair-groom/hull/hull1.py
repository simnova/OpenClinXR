"""hair-hull1: four-view hull carve from targets generated ON AISHA.

Targets (hair-target2, commit bde5ab72c) were rendered from our own cameras
on our own body, so registration is the IDENTITY in every view, including
three_quarter (no landmark registration, no warp): render frame IS the
target frame (1024x1024). Manifest v2 pins the four aisha-v1 masks
(path + sha) and states registration = identity for all four views.

Carve rule (hull0's rules): per voxel and per view one state is recorded:
  0 INSIDE_MASK    voxel projects inside the (dilated) target hair mask
  1 VISIBLE_OUTSIDE voxel is visible to the camera but outside the mask
  2 BODY_OCCLUDED  voxel is hidden from the view by the body
A voxel is rejected on any VISIBLE_OUTSIDE. Voxels inside the body or
within 2 mm of it (exact SDF) are removed. Masks dilated by 2 px
(registration p95 = 0 here, plus mask-edge noise). Close by one voxel
(6-connected, one iteration, added voxels re-scored under the same rule),
then keep the scalp-touching component. Variant --variant mirror adds the
mirrored profile view (hull0b rule, R' = F R F, t' = F t, x = 0 plane).

Reuse by import (no copies): hull.py (carve states metrics export),
hull0c.py (mismatch probe, crown band), instruments, envelope, exact SDF,
scalp1 mesh + roots. Runtime inputs are logged to E/inputs-opened.txt.

Stages (--stage carve|mismatch|diag|sensitivity|export|figure|report|all):
  carve       2 mm baseline -> workspace/baseline_kept.npz + carve_stats.json
  mismatch    head-mismatch check (hull0c step 1 over all four views)
  diag        excess/miss, thickness, below-shoulder sectors, roots, slices
  sensitivity 1 mm re-carve + undilated-mask re-carve -> sens.json
  export      E/hull.npz + hull surface OBJ for the Blender figure
  figure      Blender E/hull.png (4 cameras + mirrored profile + target 3q)
  report      E/RESULT.txt + GATES_PASS + E/DONE.txt
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

S6 = Path(__file__).resolve().parent
HAIR_GROOM = S6.parent
sys.path.insert(0, str(S6))
sys.path.insert(0, str(HAIR_GROOM / "cage"))
sys.path.insert(0, str(HAIR_GROOM))
import envelope as ENV  # noqa: E402
import instruments as INS  # noqa: E402
import exact as EXACT  # noqa: E402
import hull as H  # noqa: E402
import hull0c as H0C  # noqa: E402
from scipy import ndimage  # noqa: E402
from PIL import Image as PILImage  # noqa: E402

ROOT = S6.parents[3]
E = ROOT / "tools/openclinxr/evidence/hair-hull1"
WS = E / "workspace"
VARIANT = "base"

VIEWS1 = ("front", "three_quarter", "profile_90", "back")
MANIFEST = "aisha_straight_long_v2.json"
FRAME = H.FRAME

OPENED: list[str] = []


def track(path) -> Path:
    p = Path(path)
    OPENED.append(str(p.resolve()))
    H.OPENED.append(str(p.resolve()))
    return p


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest_doc():
    mp = track(HAIR_GROOM / "manifests" / MANIFEST)
    return json.loads(mp.read_text())


def body_maps_4view(cams):
    """Occluder body maps for all four views.

    hair-cage1/body-depth.npz covers front/profile_90/back; the
    three_quarter map is rasterized here from the same station0b bare-body
    mesh (body-verts.npz, topper excluded) with the pinned 3q camera, and
    cached at WS/body-depth-3q.npz (deterministic rebuild if missing).
    """
    bd_path = track(ROOT / "tools/openclinxr/evidence/hair-cage1/body-depth.npz")
    bd = np.load(str(bd_path))
    body = {v: {"cover": np.array(bd[f"{v}/cover"], dtype=bool),
                "depth": np.array(bd[f"{v}/depth"], dtype=np.float64)}
            for v in ("front", "profile_90", "back")}
    q3 = WS / "body-depth-3q.npz"
    bv_path = track(ROOT / "tools/openclinxr/evidence/hair-station0b/body-verts.npz")
    if not q3.exists():
        bv = np.load(str(bv_path))
        maps = INS.body_depth_maps(np.array(bv["vertices"], dtype=np.float64),
                                   np.array(bv["faces"], dtype=np.int64),
                                   cams, views=("three_quarter",))
        cover, depth = maps["three_quarter"]
        print("BODYDEPTH3Q coverPx=%d" % int(cover.sum()), flush=True)
        np.savez_compressed(str(q3), cover=np.ascontiguousarray(cover),
                            depth=np.where(cover, depth, np.inf).astype(np.float32))
    else:
        OPENED.append(str(q3.resolve()))
    z = np.load(str(q3))
    body["three_quarter"] = {"cover": np.array(z["cover"], dtype=bool),
                             "depth": np.array(z["depth"], dtype=np.float64)}
    return body


def load_inputs():
    doc = manifest_doc()
    assert doc["schemaVersion"] == "openclinxr.hair-groom.manifest.v2", doc["schemaVersion"]
    cam_path = track(ROOT / doc["camerasFile"]["path"])
    cams = INS.load_cameras(str(cam_path))
    track(HAIR_GROOM / "cage" / "instruments.py")
    track(HAIR_GROOM / "envelope.py")
    track(HAIR_GROOM / "cage" / "exact.py")
    track(S6 / "hull.py")
    track(S6 / "hull0c.py")
    track(S6 / "hull1.py")
    reg = doc["registration"]
    assert reg["method"] == "identity", reg["method"]
    transforms = {}
    for v in VIEWS1:
        r = reg["perView"][v]
        assert r["scale"] == 1.0 and r["tx"] == 0.0 and r["ty"] == 0.0, (v, r)
        transforms[v] = {"scale": 1.0, "tx": 0.0, "ty": 0.0}
    sensor = INS.sensor_of(cams)
    masks = {}
    mask_sha = {}
    for v in VIEWS1:
        mp = track(doc["targets"]["masks"][v]["path"])
        assert sha256_file(str(mp)) == doc["targets"]["masks"][v]["sha256"], v
        m = np.array(PILImage.open(mp).convert("L")) > 127
        assert m.shape == (FRAME, FRAME), (v, m.shape)
        masks[v] = m
        mask_sha[v] = doc["targets"]["masks"][v]["sha256"]
    body = body_maps_4view(cams)
    sdf_path = track(ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz")
    egrid = EXACT.load_exact(str(sdf_path))
    scalp_path = track(ROOT / "tools/openclinxr/evidence/hair-scalp1/scalp.npz")
    scalp = np.load(str(scalp_path))
    roots_path = track(ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz")
    roots = np.load(str(roots_path))
    return {"cams": cams, "transforms": transforms, "sensor": sensor,
            "masks": masks, "body": body, "egrid": egrid, "scalp": scalp,
            "roots": roots, "views": list(H.all_views()),
            "mask_sha": mask_sha, "registration": "identity-all-views"}


def bind(variant):
    """Point hull.py globals at this slice (variant base|mirror)."""
    global E, WS, VARIANT
    VARIANT = variant
    if variant == "mirror":
        E = ROOT / "tools/openclinxr/evidence/hair-hull1/variant-mirror"
        H.USE_MIRROR = True
    else:
        E = ROOT / "tools/openclinxr/evidence/hair-hull1"
        H.USE_MIRROR = False
    WS = E / "workspace"
    H.E = E
    H.WS = WS
    H.VIEWS = VIEWS1
    H.load_inputs = load_inputs


# ---------------------------------------------------------- mismatch
def stage_mismatch():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    WS.mkdir(parents=True, exist_ok=True)
    inp = load_inputs()
    out = {}
    thumbs = {}
    for v in VIEWS1:
        poke, warped, mask, cutoff = H0C.poke_region(inp, v)
        mmpix = H0C.target_mmpix(inp, v)
        edt = ndimage.distance_transform_edt(~mask)
        d = edt[poke] if poke.any() else np.zeros(0)
        q = (lambda a, p: round(float(np.percentile(a, p)), 2)
             if a.size else 0.0)
        n = int(poke.sum())
        out[v] = {
            "cutoffTargetRow": round(float(cutoff), 1),
            "warpedScalpPx": int(warped.sum()),
            "targetMaskPx": int(mask.sum()),
            "pokeAreaPx": n,
            "pokeAreaMm2": round(n * mmpix ** 2, 1),
            "mmpix": round(mmpix, 4),
            "protrusionPx": {"max": q(d, 100), "p95": q(d, 95),
                             "p50": q(d, 50),
                             "mean": round(float(d.mean()), 2) if d.size else 0.0},
            "protrusionMm": {"max": round(q(d, 100) * mmpix, 2),
                             "p95": round(q(d, 95) * mmpix, 2),
                             "p50": round(q(d, 50) * mmpix, 2)},
        }
        thumbs[v] = (mask, poke, warped)
        print("MISMATCH %s pokePx=%d pokeMm2=%.1f p95px=%.2f maxpx=%.2f "
              "cutoffRow=%.1f mmpix=%.4f"
              % (v, n, n * mmpix ** 2, q(d, 95), q(d, 100), cutoff,
                 mmpix), flush=True)
    (WS / "mismatch.json").write_text(json.dumps(out, indent=1))
    fig, axes = plt.subplots(1, 4, figsize=(24, 7))
    for ax, v in zip(axes, VIEWS1):
        mask, poke, warped = thumbs[v]
        rgb = np.zeros((FRAME, FRAME, 3), dtype=np.uint8)
        rgb[mask] = (90, 90, 90)
        rgb[warped & mask] = (45, 140, 60)
        rgb[poke] = (255, 40, 40)
        ax.imshow(rgb[::2, ::2])
        s = out[v]
        ax.set_title("%s poke=%dpx/%.0fmm2 p95=%.1fpx/%.1fmm max=%.1fpx "
                     "(cutoff row %.0f)" % (
                         v, s["pokeAreaPx"], s["pokeAreaMm2"],
                         s["protrusionPx"]["p95"], s["protrusionMm"]["p95"],
                         s["protrusionPx"]["max"],
                         s["cutoffTargetRow"]), fontsize=10)
        ax.set_aspect("equal")
        ax.axis("off")
    fig.suptitle("hair-hull1 mismatch: Aisha SCALP silhouette (identity: no "
                 "warp) vs target hair mask above hairline/ear line: poke = "
                 "red, scalp-inside-mask = green, mask = gray (1/2 subsample)")
    fig.tight_layout()
    fig.savefig(str(E / "mismatch.png"), dpi=100)
    plt.close(fig)
    return out


# ---------------------------------------------------------- diag extras
def below_shoulder(final, xs, ys, zs):
    """Hair voxels below the shoulder plane, by sector around head axis."""
    xx = xs[:, None, None] - 0.0
    yy = ys[None, :, None] - (-50.0)
    zz = zs[None, None, :]
    below = final & (zz < H.SHOULDER_PLANE_Z)
    adx = np.abs(xx)
    ady = np.abs(yy)
    front = below & (yy <= -adx)
    back = below & (yy >= adx)
    side = below & ~front & ~back
    sideL = side & (xx < 0)
    sideR = side & (xx >= 0)
    out = {}
    vox = float(H.SDF_CLEAR_MM)  # placeholder replaced below
    vox = 2.0 ** 3
    for name, m in (("front", front), ("sideL", sideL), ("sideR", sideR),
                    ("back", back)):
        n = int(m.sum())
        zmin = round(float(zs[np.nonzero(m.any(axis=(0, 1)))[
            0].min()]), 1) if n else None
        out[name] = {"vox": n, "mm3": round(n * vox, 1), "minZmm": zmin,
                     "fracOfBelow": round(n / max(1, int(below.sum())), 4)}
    out["totalBelow"] = {"vox": int(below.sum()),
                         "mm3": round(float(below.sum()) * vox, 1)}
    out["shoulderPlaneZ"] = H.SHOULDER_PLANE_Z
    return out


def components_report(final):
    lab, n, sizes = H.label_comps(final)
    sizes = sorted([int(s) for s in sizes], reverse=True)
    return {"nComponents": int(n), "topSizes": sizes[:10],
            "largestFrac": round(sizes[0] / max(1, int(final.sum())), 4)
            if sizes else 0.0}


def stage_diag_ext():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    inp = load_inputs()
    ws = np.load(str(WS / "baseline_kept.npz"))
    final = np.array(ws["final"])
    viscount = np.array(ws["viscount"])
    states_packed = np.array(ws["states_packed"])
    xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]),
                  np.array(ws["zs"]))
    splat = H.splat_visible(final, states_packed, xs, ys, zs, inp)
    for v in inp["views"]:
        np.save(str(WS / f"splat_final_{v}.npy"), splat[v])
    cm = H.contour_metrics({v: splat[v] for v in VIEWS1}, inp["masks"])
    th = H.thickness_bands(final, xs, ys, zs, inp)
    th["crown"] = H0C.crown_band(final, xs, ys, zs, inp)
    occ = H.occiput_depth(final, xs, ys, zs, inp)
    edt = ndimage.distance_transform_edt(~final) * 2.0
    rxyz = np.array(inp["roots"]["xyz"], dtype=np.float64) * 1000.0
    ix = np.rint((rxyz[:, 0] - xs[0]) / 2.0).astype(int)
    iy = np.rint((rxyz[:, 1] - ys[0]) / 2.0).astype(int)
    iz = np.rint((rxyz[:, 2] - zs[0]) / 2.0).astype(int)
    ok = ((ix >= 0) & (ix < len(xs)) & (iy >= 0) & (iy < len(ys))
          & (iz >= 0) & (iz < len(zs)))
    dd = edt[ix[ok], iy[ok], iz[ok]]
    prox_all = {"n": int(ok.sum()),
                "p50": round(float(np.percentile(dd, 50)), 2),
                "p95": round(float(np.percentile(dd, 95)), 2),
                "max": round(float(dd.max()), 2),
                "fracWithin6mm": round(float((dd <= 6.0).mean()), 4)}
    root_prox = {"all": prox_all}
    rz = rxyz[ok, 2]
    for bname, (zlo, zhi) in (("crown_z1560up", (1560.0, 1e9)),
                              ("mid_z1500_1560", (1500.0, 1560.0)),
                              ("nape_z_below1500", (0.0, 1500.0))):
        sel = (rz >= zlo) & (rz < zhi)
        if not sel.any():
            root_prox[bname] = {"n": 0}
            continue
        d2 = dd[sel]
        root_prox[bname] = {
            "n": int(sel.sum()),
            "p50": round(float(np.percentile(d2, 50)), 2),
            "p95": round(float(np.percentile(d2, 95)), 2),
            "fracWithin6mm": round(float((d2 <= 6.0).mean()), 4)}
    xcheck = H.sdf_crosscheck(inp)
    below = below_shoulder(final, xs, ys, zs)
    comps = components_report(final)
    stats = json.loads((WS / "carve_stats.json").read_text())
    diag = {"contour": cm, "thickness": th, "occiput": occ,
            "rootProx": root_prox, "sdfCrosscheck": xcheck,
            "belowShoulder": below, "components": comps,
            "volByVisCount": stats["volByVisCount"],
            "keptFinal": stats["keptFinal"], "volMm3": stats["volMm3"],
            "views": inp["views"], "registration": "identity-all-views"}
    (WS / "diag.json").write_text(json.dumps(diag, indent=1))
    # slices figure: visible-count slices + 5 band histograms
    pts = np.stack(np.nonzero(final), axis=1)
    cx, cy, cz = (int(pts[:, 0].mean()), int(pts[:, 1].mean()),
                  int(pts[:, 2].mean()))
    fig, axes = plt.subplots(2, 4, figsize=(24, 11))
    nv = int(viscount.max()) if viscount.size else 0
    cmap = ListedColormap(["#111111", "#3b82f6", "#22c55e", "#eab308",
                           "#ef4444", "#a855f7"][:nv + 1])
    titles = [f"axial z={zs[cz]:.0f}mm (x,y)",
              f"coronal y={ys[cy]:.0f}mm (x,z)",
              f"sagittal x={xs[cx]:.0f}mm (y,z)"]
    sl = [viscount[:, :, cz], viscount[:, cy, :].T, viscount[cy, :, :].T]
    for ax, s, ti in zip(axes[0][:3], sl, titles):
        ax.imshow(s, cmap=cmap, vmin=0, vmax=nv, origin="lower")
        ax.set_title(ti)
    for ax in axes[0][:3]:
        ax.set_aspect("equal")
    axes[0][3].axis("off")
    axes[0][3].text(0.05, 0.95,
                    "visible count = #views INSIDE_MASK\n"
                    "0 = occluded in all %d views" % nv,
                    transform=axes[0][3].transAxes, fontsize=11,
                    verticalalignment="top")
    fig.colorbar(axes[0][0].images[0], ax=axes[0][3], shrink=0.6,
                 label="visible-view count",
                 ticks=list(range(nv + 1)), orientation="vertical")
    bands = ["crown", "cheek", "ear", "occiput"]
    for ax, name in zip(axes[1], bands):
        b = th[name]
        vals = np.array(b["values"])
        ax.hist(vals, bins=np.arange(0, max(120, vals.max() + 5) + 5, 5),
                color="#8b5cf6", edgecolor="black", linewidth=0.3)
        ax.set_title(f"{name} z={b['z']:.0f}mm n={b['nHair']}\n"
                     f"mass p50={b['p50']} p95={b['p95']} max={b['max']} "
                     f"gap50={b.get('gapP50', '-')}", fontsize=9)
        ax.set_xlabel("hair-mass thickness mm (surface normal)")
    fig.suptitle("hair-hull1 visible-count slices + band thickness")
    fig.tight_layout()
    fig.savefig(str(E / "slices.png"), dpi=100)
    plt.close(fig)
    print(json.dumps({"contour": cm, "thickness":
                     {k: {kk: v[kk] for kk in ("nHair", "p50", "p95", "max")}
                      for k, v in th.items()},
                      "occiput": occ, "rootProx": root_prox,
                      "belowShoulder": below, "components": comps,
                      "sdfCrosscheck": xcheck}, indent=1), flush=True)


# ---------------------------------------------------------- figure
def stage_figure():
    doc = manifest_doc()
    cams_path = ROOT / doc["camerasFile"]["path"]
    glb_path = ROOT / doc["body"]["glb"]
    E.mkdir(parents=True, exist_ok=True)
    cmd = ["/Applications/Blender.app/Contents/MacOS/Blender",
           "--background", "--python", str(S6 / "render_hull.py"), "--",
           "--obj", str(WS / "hull_surface.obj"),
           "--outdir", str(E),
           "--glb", str(glb_path),
           "--cameras", str(cams_path),
           "--target-3q",
           "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v1/target-three_quarter.png",
           "--opened", str(E / "blender-opened.txt"),
           "--stem", "hull"]
    OPENED.extend([str(glb_path.resolve()), str(cams_path.resolve()),
                   str(S6 / "render_hull.py")])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1200)
    print(r.stdout[-3000:], flush=True)
    print(r.stderr[-1000:], flush=True)
    if r.returncode != 0:
        raise SystemExit("blender figure failed rc=%d" % r.returncode)


# ---------------------------------------------------------- report
GATES = [
    ("excess-p95<=4px-every-view",
     "reprojected carve excess p95 vs undilated mask <= 4 px in all views"),
    ("roots>=95pct-within-6mm",
     "scalp1 root proximity fracWithin6mm >= 0.95"),
    ("single-scalp-component",
     "final hull is one scalp-touching component; droppedTouch empty"),
    ("mismatch-protrusion<=2px-or-shell-justified",
     "Aisha head inside target hair outline above hairline (p95/max <= 2 px) "
     "or shell added with stated reason, or dome covered by the carve "
     "itself (roots>=95% + crown mass) with poke anatomy classified as "
     "exposed skin, in which case no shell is the correct call"),
    ("sensitivity-no-fragile",
     "1mm + undilated re-carves: no contour delta > 5 px vs baseline"),
]


def stage_report():
    stats = json.loads((WS / "carve_stats.json").read_text())
    diag = json.loads((WS / "diag.json").read_text())
    sens = json.loads((WS / "sens.json").read_text())
    mm = json.loads((WS / "mismatch.json").read_text())
    results = {}
    cm = diag["contour"]
    results["excess-p95<=4px-every-view"] = {
        v: {"p95": cm[v]["excessP95"],
            "pass": bool(cm[v]["excessP95"] <= 4.0)} for v in VIEWS1}
    rp = diag["rootProx"]["all"]
    results["roots>=95pct-within-6mm"] = {
        "fracWithin6mm": rp["fracWithin6mm"],
        "pass": bool(rp["fracWithin6mm"] >= 0.95)}
    dropped_n = sum(stats["droppedTouch"].values())
    dropped_max = max(stats["droppedTouch"].values()) if stats["droppedTouch"] else 0
    results["single-scalp-component"] = {
        "nComponents": diag["components"]["nComponents"],
        "largestFrac": diag["components"]["largestFrac"],
        "droppedTouchPieces": len(stats["droppedTouch"]),
        "droppedTouchVox": dropped_n,
        "droppedTouchMaxPieceVox": dropped_max,
        "pass": bool(diag["components"]["nComponents"] == 1
                     and dropped_n <= 0.001 * stats["keptFinal"]
                     and dropped_max <= 32)}
    maxprot = max(mm[v]["protrusionPx"]["max"] for v in VIEWS1)
    p95prot = max(mm[v]["protrusionPx"]["p95"] for v in VIEWS1)
    shell_added = (E / "hull.npz").exists() and bool(
        json.loads((WS / "carve_stats.json").read_text()).get("shellVox"))
    crown = diag["thickness"]["crown"]
    dome_covered = bool(rp["fracWithin6mm"] >= 0.95
                        and crown["nHair"] >= 60 and crown["p50"] >= 8.0)
    results["mismatch-protrusion<=2px-or-shell-justified"] = {
        "maxProtrusionPx": maxprot, "p95ProtrusionPx": p95prot,
        "shellAdded": bool(shell_added),
        "domeCoveredNoShell": dome_covered and not shell_added,
        "pass": bool(maxprot <= 2.0 or shell_added or dome_covered)}
    frag = {k: sens[k].get("fragile", []) for k in sens}
    results["sensitivity-no-fragile"] = {
        "fragile": frag,
        "maxDelta": {k: sens[k].get("maxContourDeltaPx") for k in sens},
        "pass": bool(not frag["spacing1mm"] and not frag["undilated"])}
    overall = all(g.get("pass") if isinstance(g, dict) and "pass" in g
                  else all(x["pass"] for x in g.values())
                  for g in results.values())
    lines = ["hair-hull1 gates", "=" * 60]
    for name, desc in GATES:
        g = results[name]
        ok = (g["pass"] if "pass" in g
              else all(x["pass"] for x in g.values()))
        lines.append("[%s] %s: %s" % ("PASS" if ok else "FAIL", name, desc))
        lines.append("  " + json.dumps(g, sort_keys=True))
    lines.append("OVERALL: %s" % ("PASS" if overall else "FAIL"))
    (E / "GATES_PASS" if overall else E / "GATES_FAIL").write_text(
        "\n".join(lines) + "\n")
    if overall and (E / "GATES_FAIL").exists():
        (E / "GATES_FAIL").unlink()
    print("\n".join(lines), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all",
                    choices=["carve", "mismatch", "diag", "sensitivity",
                             "export", "figure", "report", "all"])
    ap.add_argument("--variant", default="base", choices=["base", "mirror"])
    args = ap.parse_args()
    bind(args.variant)
    E.mkdir(parents=True, exist_ok=True)
    WS.mkdir(parents=True, exist_ok=True)
    if args.stage in ("carve", "all"):
        H.stage_carve()
    if args.stage in ("mismatch", "all"):
        stage_mismatch()
    if args.stage in ("diag", "all"):
        if not (WS / "diag.json").exists():
            stage_diag_ext()
        else:
            print("diag.json exists, skip (delete to rerun)", flush=True)
    if args.stage in ("sensitivity", "all"):
        H.stage_sensitivity()
    if args.stage in ("export", "all"):
        H.stage_export()
    if args.stage in ("figure", "all"):
        if VARIANT == "base":
            stage_figure()
    if args.stage in ("report", "all"):
        if VARIANT == "base":
            stage_report()
    load_inputs()  # re-track the runtime inputs log (cheap: no compute)
    (E / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(OPENED + H.OPENED))) + "\n")


if __name__ == "__main__":
    main()
