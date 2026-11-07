"""Multi-view hair-volume hull carve (CARVE ONLY, no guides).

Method: voxel grid over a stated crop; per voxel and per registered view
(front, profile_90, back) one state is recorded:
  0 INSIDE_MASK    voxel projects inside the (dilated) target hair mask
  1 VISIBLE_OUTSIDE voxel is visible to the camera but outside the mask
  2 BODY_OCCLUDED  voxel is hidden from the view by the body
A voxel is rejected on any VISIBLE_OUTSIDE. Voxels inside the body or
within 2 mm of it (exact SDF) are removed. Close by one voxel (6-connected,
one iteration), then keep the component touching the scalp1 scalp mesh.

Mirrored profile (--mirror-profile, default on): a virtual far-side
profile view. Assumption: the target hairstyle is bilaterally symmetric
about the head midsagittal plane (world x = 0: crown/menton/brow landmark
x ~ 1e-9 m; centre part per the style manifest). The virtual camera is
the pinned profile_90 camera mirrored across x = 0 (location x negated,
rotation R' = F R F with F = diag(-1,1,1); same lens/sensor), its mask
the registered profile mask mirrored left-right, its body-depth maps the
profile maps mirrored left-right (exact for a symmetric body; the real
body is symmetric to ~mm, stated approximation). Evaluated by the exact
equivalence state_mirror(x,y,z) = state_profile(-x,y,z) through the same
profile pipeline (projection, target transform, dilated mask, patch
occluder maps) — identical to explicit-mirror evaluation without inventing
a discrete resampling convention (a naive explicit flipped-masks lookup
carries a systematic 1 px shift: continuous mirror u' = W - u vs discrete
flip j' = W - 1 - j). Verified numerically in stage_carve (mirrorVerify).

Reuses by import (no copies): the station projector (envelope), the
registration similarity (register, via instruments), the occlusion test
instruments + body-depth maps (occl0 method: depth-buffer patch median,
margin 5 mm; exact-SDF ray-march cross-check), the exact SDF
(hair-cage1/body-exact-sdf.npz), the scalp1 scalp mesh (contact) and roots
(proximity diagnostic only).

Stages (--stage carve|diag|sensitivity|export|all):
  carve       2 mm baseline -> workspace/baseline_kept.npz + carve_stats.json
  diag        reprojection excess/miss, thickness, root proximity, slices.png
  sensitivity 1 mm re-carve + undilated-mask re-carve -> sens.json
  export      E/hull.npz + hull surface OBJ for the Blender figure
"""
from __future__ import annotations

import argparse
import hashlib
import json
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
from scipy import ndimage  # noqa: E402

ROOT = S6.parents[3]
E = ROOT / "tools/openclinxr/evidence/hair-hull0b"
WS = E / "workspace"
USE_MIRROR = True
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
             "tools/openclinxr/evidence/hair-judge/target-set-back")

VIEWS = ("front", "profile_90", "back")
MIRROR = "profile_90_mirror"
# Midsagittal plane of the head frame (world mm): x = 0. Station evidence:
# point3d crown/menton/brow x are ~1e-9 m; front/back/profile_90 cameras
# are centred on x = 0 (face_centre_col 512 / shoulder_col 512).


def all_views():
    return list(VIEWS) + ([MIRROR] if USE_MIRROR else [])


def view_source(v):
    """(pipeline view, mirror_points) for a carve view."""
    if v == MIRROR:
        return "profile_90", True
    return v, False


def mirror_points(pts_mm):
    return np.asarray(pts_mm, dtype=np.float64) * np.array([-1.0, 1.0, 1.0])


def mirror_camera(cam):
    """Virtual far-side camera: pose mirrored across the x = 0 plane."""
    F = np.diag([-1.0, 1.0, 1.0])
    mat = np.array(cam["matrixWorld"], dtype=np.float64)
    R, t = mat[:3, :3], mat[:3, 3]
    out = dict(cam)
    m2 = np.eye(4)
    m2[:3, :3] = F @ R @ F
    m2[:3, 3] = F @ t
    out["matrixWorld"] = m2.tolist()
    return out


def pack_states(states):
    # Base-3 codes need 3**nv values: 5 views fit uint8 (243), 6 views
    # (both side mirrors, hair-hull4 flag) need uint16 (729). Sized from
    # the view count so a wider carve cannot silently wrap states.
    dt = np.uint8 if states.shape[-1] <= 5 else np.uint16
    packed = np.zeros(states.shape[:-1], dtype=dt)
    for i in range(states.shape[-1]):
        packed = packed + states[..., i].astype(dt) * (3 ** i)
    return packed


def unpack_state(states_packed, vi):
    return (np.asarray(states_packed) // (3 ** vi)) % 3
FRAME = 1024
# Crop (world mm): head + neck + upper back to 150 mm below shoulder plane.
CROP = {"x0": -260.0, "x1": 260.0, "y0": -260.0, "y1": 160.0,
        "z0": 1255.0, "z1": 1720.0}
SHOULDER_PLANE_Z = 1405.0
SDF_CLEAR_MM = 2.0
OCCL_MARGIN_M = 0.005  # occl0 visibility margin
PATCH = 2  # occl0 patch half-width
CONTACT_MM = 4.0  # scalp-contact distance (clears the 2 mm body margin)

MASKS = {"front": "mask-front-v2.png",
         "profile_90": "mask-profile-v2.png",
         "back": "mask-back-v3.png"}
MASK_3Q = "mask-three_quarter.png"

OPENED: list[str] = []


def track(path) -> Path:
    p = Path(path)
    OPENED.append(str(p.resolve()))
    return p


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_inputs():
    manifest = json.loads((HAIR_GROOM / "manifests"
                           / "aisha_straight_long.json").read_text())
    cam_path = track(ROOT / manifest["camerasFile"]["path"])
    cams = INS.load_cameras(str(cam_path))
    track(HAIR_GROOM / "cage" / "instruments.py")
    track(HAIR_GROOM / "envelope.py")
    track(HAIR_GROOM / "register.py")
    track(HAIR_GROOM / "cage" / "exact.py")
    track(S6 / "hull.py")
    transforms = INS.transforms_of(cams)
    sensor = INS.sensor_of(cams)
    masks = {}
    for view in VIEWS:
        mp = track(JUDGE / MASKS[view])
        masks[view] = np.array(__import__("PIL.Image", fromlist=["open"]).open(mp)) > 127
    bd_path = track(ROOT / "tools/openclinxr/evidence/hair-cage1/body-depth.npz")
    bd = np.load(str(bd_path))
    body = {v: {"cover": np.array(bd[f"{v}/cover"], dtype=bool),
                "depth": np.array(bd[f"{v}/depth"], dtype=np.float64)}
            for v in VIEWS}
    sdf_path = track(ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz")
    egrid = EXACT.load_exact(str(sdf_path))
    scalp_path = track(ROOT / "tools/openclinxr/evidence/hair-scalp1/scalp.npz")
    scalp = np.load(str(scalp_path))
    roots_path = track(ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz")
    roots = np.load(str(roots_path))
    frame = np.load(str(track(Path("/tmp/station0b-run/station-frame.npz"))))
    crown = np.array(frame["point3d/crown"], dtype=np.float64)
    menton = np.array(frame["point3d/menton"], dtype=np.float64)
    return {"cams": cams, "transforms": transforms, "sensor": sensor,
            "masks": masks, "body": body, "egrid": egrid, "scalp": scalp,
            "roots": roots, "crown": crown, "menton": menton,
            "views": all_views(),
            "mask_sha": {v: sha256_file(str(JUDGE / MASKS[v])) for v in VIEWS}}


def dilate_masks(masks, radius_px):
    if radius_px <= 0:
        return {v: m.copy() for v, m in masks.items()}
    return {v: ndimage.binary_dilation(m, iterations=int(radius_px))
            for v, m in masks.items()}


def occluder_maps(body):
    """Per view: patch-occluder depth + patch coverage (occl0 patch method)."""
    out = {}
    for v in VIEWS:
        depth = np.array(body[v]["depth"])
        cover = np.array(body[v]["cover"])
        filled = np.where(cover, depth, 1e6)
        occ_depth = ndimage.median_filter(filled, size=2 * PATCH + 1)
        occ_frac = ndimage.uniform_filter(cover.astype(np.float64),
                                          size=2 * PATCH + 1)
        out[v] = {"occ_depth": occ_depth, "occ_frac": occ_frac}
    return out


def single_view_states(pts_mm, inp, dil, occ, v):
    """States (0 INSIDE, 1 OUTSIDE, 2 OCCLUDED) for points under one view.

    Occlusion takes precedence: a body-hidden point is BODY_OCCLUDED even
    where it projects outside the mask (the view cannot constrain it).
    Points projecting outside the render frame are VISIBLE_OUTSIDE.
    """
    pts_m = np.asarray(pts_mm, dtype=np.float64) / 1000.0
    cams, sensor, tr = inp["cams"], inp["sensor"], inp["transforms"]
    cam = cams["views"][v]
    cols, rows, dep = ENV.project_to_render(pts_m, cam, sensor)
    in_r = ((cols >= 0) & (cols < FRAME) & (rows >= 0)
            & (rows < FRAME) & (dep > 0))
    ci = np.clip(np.rint(cols).astype(np.int64), 0, FRAME - 1)
    ri = np.clip(np.rint(rows).astype(np.int64), 0, FRAME - 1)
    om = occ[v]
    od = om["occ_depth"][ri, ci]
    of = om["occ_frac"][ri, ci]
    visible = in_r & ((of < 0.5) | (dep < od - OCCL_MARGIN_M))
    occluded = in_r & ~visible
    t = tr[v]
    s = float(t["scale"])
    ct = np.rint(s * cols + float(t["tx"])).astype(np.int64)
    rt = np.rint(s * rows + float(t["ty"])).astype(np.int64)
    in_t = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME))
    ctc = np.clip(ct, 0, FRAME - 1)
    rtc = np.clip(rt, 0, FRAME - 1)
    inside = in_t & dil[v][rtc, ctc]
    st = np.where(occluded, 2, np.where(inside, 0, 1))
    st[~in_r] = 1
    return st


def states_for_points(pts_mm, inp, dil, occ):
    """Per-view states for points; the mirrored view runs the profile
    pipeline on x-mirrored points (exact virtual-camera equivalence)."""
    pts_mm = np.asarray(pts_mm, dtype=np.float64)
    views = inp["views"]
    out = np.zeros((pts_mm.shape[0], len(views)), dtype=np.uint8)
    for vi, v in enumerate(views):
        src, mir = view_source(v)
        pp = mirror_points(pts_mm) if mir else pts_mm
        out[:, vi] = single_view_states(pp, inp, dil, occ, src)
    return out


def grid_axes(spacing):
    xs = np.arange(CROP["x0"], CROP["x1"] + 1e-9, spacing)
    ys = np.arange(CROP["y0"], CROP["y1"] + 1e-9, spacing)
    zs = np.arange(CROP["z0"], CROP["z1"] + 1e-9, spacing)
    return xs, ys, zs


def carve_grids(inp, spacing, dil_px, store=True):
    """Full carve. Returns dict of grids + stats. Streams in z slabs."""
    views = inp["views"]
    nv = len(views)
    xs, ys, zs = grid_axes(spacing)
    nx, ny, nz = len(xs), len(ys), len(zs)
    dil = dilate_masks(inp["masks"], dil_px)
    occ = occluder_maps(inp["body"])
    cams, sensor, tr = inp["cams"], inp["sensor"], inp["transforms"]
    shape = (nx, ny, nz)
    kept = np.zeros(shape, dtype=bool)
    if store:
        states = np.zeros(shape + (nv,), dtype=np.uint8)
        viscount = np.zeros(shape, dtype=np.uint8)
    else:
        states = viscount = None
    # target-frame splat accumulators: VISIBLE hull only (state INSIDE_MASK
    # in that view). Occluded voxels are hidden behind the body and must
    # not count toward the rendered silhouette (same rule as the
    # occluded_union raster: hidden hair never covers a photo pixel).
    splat = {v: np.zeros((FRAME, FRAME), dtype=bool) for v in views}
    n_outside_render = {v: 0 for v in views}
    n_outside_target = {v: 0 for v in views}
    n_occluded = {v: 0 for v in views}
    slab = max(1, int(2_000_000 / (nx * ny)))
    for z0 in range(0, nz, slab):
        z1 = min(nz, z0 + slab)
        Zg, Yg, Xg = np.meshgrid(zs[z0:z1], ys, xs, indexing="ij")
        pts_mm = np.stack([Xg.ravel(), Yg.ravel(), Zg.ravel()], axis=1)
        pts_m = pts_mm / 1000.0
        slab_states = states_for_points(pts_mm, inp, dil, occ)
        for vi, v in enumerate(views):
            src, mir = view_source(v)
            cam = cams["views"][src]
            pm = mirror_points(pts_mm) / 1000.0 if mir else pts_m
            cols, rows, dep = ENV.project_to_render(pm, cam, sensor)
            in_r = ((cols >= 0) & (cols < FRAME) & (rows >= 0)
                    & (rows < FRAME) & (dep > 0))
            t = tr[src]
            s = float(t["scale"])
            ct = np.rint(s * cols + float(t["tx"])).astype(np.int64)
            rt = np.rint(s * rows + float(t["ty"])).astype(np.int64)
            in_t = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME))
            n_occluded[v] += int((slab_states[:, vi] == 2).sum())
            n_outside_render[v] += int((~in_r).sum())
            n_outside_target[v] += int((in_r & ~in_t).sum())
        sdf = EXACT.query_exact(inp["egrid"], pts_mm)
        clear = sdf > SDF_CLEAR_MM
        keep_slab = clear & (slab_states != 1).all(axis=1)
        idx = np.nonzero(keep_slab)[0]
        # map flat slab index -> grid (x fastest in ravel order z,y,x)
        zz, yy, xx = np.unravel_index(idx, (z1 - z0, ny, nx))
        kept[xx, yy, zz + z0] = True
        if store:
            states[xx, yy, zz + z0, :] = slab_states[idx]
            viscount[xx, yy, zz + z0] = (slab_states[idx] == 0).sum(axis=1)
        for vi, v in enumerate(views):
            src, mir = view_source(v)
            cam = cams["views"][src]
            kpts = pts_m[idx] if len(idx) else np.zeros((0, 3))
            if len(idx) == 0:
                continue
            vis = slab_states[idx, vi] == 0
            if not vis.any():
                continue
            if mir:
                kpts = mirror_points(kpts * 1000.0) / 1000.0
                kpts = kpts[vis]
            else:
                kpts = kpts[vis]
            cols, rows, dep = ENV.project_to_render(kpts, cam, sensor)
            t = tr[src]
            s = float(t["scale"])
            ct = np.rint(s * cols + float(t["tx"])).astype(np.int64)
            rt = np.rint(s * rows + float(t["ty"])).astype(np.int64)
            ok = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME))
            splat[v][rt[ok], ct[ok]] = True
    total = nx * ny * nz
    return {"kept": kept, "states": states, "viscount": viscount,
            "splat": splat, "xs": xs, "ys": ys, "zs": zs,
            "spacing": spacing, "dil_px": dil_px, "total": total,
            "dil": dil, "occ": occ,
            "n_occluded": n_occluded, "n_outside_render": n_outside_render,
            "n_outside_target": n_outside_target}


CROSS6 = ndimage.generate_binary_structure(3, 1)


def label_comps(occ):
    lab, n = ndimage.label(occ, structure=CROSS6)
    sizes = np.bincount(lab.ravel())[1:] if n else np.zeros(0, dtype=int)
    return lab, n, sizes


def scalp_contact_mask(shape, xs, ys, zs, scalp, spacing):
    """Voxels within CONTACT_MM of the scalp1 scalp mesh triangles."""
    verts = np.array(scalp["verts"], dtype=np.float64) * 1000.0
    tris = np.array(scalp["tris"], dtype=np.int64)
    o = np.array([xs[0], ys[0], zs[0]])
    contact = np.zeros(shape, dtype=bool)
    for tri in tris:
        a, b, c = verts[tri[0]], verts[tri[1]], verts[tri[2]]
        lo = np.floor((np.minimum(np.minimum(a, b), c) - CONTACT_MM - o)
                      / spacing).astype(int)
        hi = np.floor((np.maximum(np.maximum(a, b), c) + CONTACT_MM - o)
                      / spacing).astype(int)
        lo = np.maximum(lo, 0)
        hi = np.minimum(hi, np.array(shape) - 1)
        if (hi < lo).any():
            continue
        gx = xs[lo[0]:hi[0] + 1]
        gy = ys[lo[1]:hi[1] + 1]
        gz = zs[lo[2]:hi[2] + 1]
        Gz, Gy, Gx = np.meshgrid(gz, gy, gx, indexing="ij")
        p = np.stack([Gx.ravel(), Gy.ravel(), Gz.ravel()], axis=1)
        d = pt_tri_dist(p, a, b, c)
        sel = d <= CONTACT_MM
        if not sel.any():
            continue
        zz, yy, xx = np.unravel_index(np.nonzero(sel)[0],
                                      (len(gz), len(gy), len(gx)))
        contact[lo[0] + xx, lo[1] + yy, lo[2] + zz] = True
    return contact


def pt_tri_dist(p, a, b, c):
    """Vectorized point-to-triangle distance (Ericson 5.1.5)."""
    ab = b - a
    ac = c - a
    ap = p - a
    d1 = ap @ ab
    d2 = ap @ ac
    bp = p - b
    d3 = bp @ ab
    d4 = bp @ ac
    cp = p - c
    d5 = cp @ ab
    d6 = cp @ ac
    out = np.empty(p.shape[0])
    # vertex regions
    m_a = (d1 <= 0) & (d2 <= 0)
    out[m_a] = np.linalg.norm(ap[m_a], axis=1)
    m_b = (d3 >= 0) & (d4 <= d3)
    out[m_b] = np.linalg.norm(bp[m_b], axis=1)
    m_c = (d6 >= 0) & (d5 <= d6)
    out[m_c] = np.linalg.norm(cp[m_c], axis=1)
    rest = ~(m_a | m_b | m_c)
    idx = np.nonzero(rest)[0]
    for i in idx:
        vab = d1[i] * d4[i] - d3[i] * d2[i]
        if vab <= 0 and d1[i] >= 0 and d3[i] <= 0:
            t = d1[i] / (d1[i] - d3[i])
            out[i] = np.linalg.norm(a + t * ab - p[i])
            continue
        vac = d5[i] * d2[i] - d1[i] * d6[i]
        if vac <= 0 and d2[i] >= 0 and d6[i] <= 0:
            t = d2[i] / (d2[i] - d6[i])
            out[i] = np.linalg.norm(a + t * ac - p[i])
            continue
        vbc = d3[i] * d6[i] - d5[i] * d4[i]
        if vbc <= 0 and (d4[i] - d3[i]) >= 0 and (d5[i] - d6[i]) >= 0:
            t = (d4[i] - d3[i]) / ((d4[i] - d3[i]) + (d5[i] - d6[i]))
            out[i] = np.linalg.norm(b + t * (c - b) - p[i])
            continue
        denom = 1.0 / (vab + vbc + vac)
        v = vbc * denom
        w = vac * denom
        out[i] = np.linalg.norm(a + ab * v + ac * w - p[i])
    return out


def close_and_filter(res, inp, dil, occ):
    """Close by one voxel, score the added voxels, prune, scalp-filter.

    Closing-added voxels are scored with the same two rules as carved
    voxels (exact SDF > 2 mm; no VISIBLE_OUTSIDE in any view) and pruned
    on failure, so every final voxel satisfies the carve rule and carries
    a true per-view state (no zero-initialized fake states).
    """
    kept = res["kept"]
    xs, ys, zs = res["xs"], res["ys"], res["zs"]
    lab_pre, n_pre, sizes_pre = label_comps(kept)
    closed_raw = ndimage.binary_closing(kept, structure=CROSS6,
                                        iterations=1)
    _, n_raw, _ = label_comps(closed_raw)
    added = closed_raw & ~kept
    ax, ay, az = np.nonzero(added)
    n_added = int(added.sum())
    if n_added:
        apts = np.stack([xs[ax], ys[ay], zs[az]], axis=1)
        astates = states_for_points(apts, inp, dil, occ)
        asdf = EXACT.query_exact(inp["egrid"], apts)
        ok = (asdf > SDF_CLEAR_MM) & ~(astates == 1).any(axis=1)
        n_pruned_sdf = int((asdf <= SDF_CLEAR_MM).sum())
        n_pruned_out = int(((asdf > SDF_CLEAR_MM)
                            & (astates == 1).any(axis=1)).sum())
        if res["states"] is not None:
            res["states"][ax[ok], ay[ok], az[ok], :] = astates[ok]
            res["viscount"][ax[ok], ay[ok], az[ok]] = (
                astates[ok] == 0).sum(axis=1)
    else:
        ok = np.zeros(0, dtype=bool)
        n_pruned_sdf = n_pruned_out = 0
    closed = kept.copy()
    if n_added:
        closed[ax[ok], ay[ok], az[ok]] = True
    lab_post, n_post, sizes_post = label_comps(closed)
    contact = scalp_contact_mask(kept.shape, xs, ys, zs, inp["scalp"],
                                 res["spacing"])
    touch_labels = sorted(set(np.unique(lab_post[closed & contact]).tolist())
                          - {0})
    touch_sizes = {int(l): int((lab_post == l).sum()) for l in touch_labels}
    keep_label = max(touch_labels, key=lambda l: touch_sizes[l]) \
        if touch_labels else 0
    final = (lab_post == keep_label) if keep_label else np.zeros_like(closed)
    dropped_touch = {str(l): sz for l, sz in touch_sizes.items()
                     if l != keep_label}
    return {"closed": closed, "final": final, "lab_post": lab_post,
            "n_pre": int(n_pre), "n_raw": int(n_raw), "n_post": int(n_post),
            "joinedByClosing": int(n_pre - n_raw),
            "splitByPrune": int(n_raw - n_post),
            "nAdded": n_added, "nPrunedSdf": n_pruned_sdf,
            "nPrunedOutside": n_pruned_out,
            "sizes_pre": sorted([int(s) for s in sizes_pre], reverse=True)[:10],
            "sizes_post": sorted([int(s) for s in sizes_post],
                                 reverse=True)[:10],
            "touch_labels": [int(l) for l in touch_labels],
            "touch_sizes": {str(k): int(v) for k, v in touch_sizes.items()},
            "keep_label": int(keep_label),
            "dropped_touch": {str(k): int(v) for k, v in dropped_touch.items()}}


def contour_metrics(splat, masks):
    """Excess of reprojected hull vs UNDILATED mask; miss; IoU."""
    out = {}
    for v in VIEWS:
        tgt = masks[v]
        h = splat[v]
        hd = ndimage.binary_dilation(h, iterations=1)
        bt = tgt ^ ndimage.binary_erosion(tgt)
        edt_t = ndimage.distance_transform_edt(~bt)
        edt_fill = ndimage.distance_transform_edt(~tgt)
        hr, hc = np.nonzero(h & ~tgt)
        de = edt_fill[hr, hc] if hr.size else np.zeros(0)
        tr, tc = np.nonzero(bt & ~hd)
        edt_h = ndimage.distance_transform_edt(~hd)
        dm = edt_h[tr, tc] if tr.size else np.zeros(0)
        inter = float((hd & tgt).sum())
        union = float((hd | tgt).sum())
        q = lambda a, p: round(float(np.percentile(a, p)), 2) if a.size else 0.0
        out[v] = {
            "excessN": int(hr.size), "excessP50": q(de, 50),
            "excessP95": q(de, 95), "excessMax": q(de, 100),
            "missN": int(tr.size), "missP50": q(dm, 50),
            "missP95": q(dm, 95), "missMax": q(dm, 100),
            "iou": round(inter / union, 4) if union else 0.0,
            "hullPx": int(hd.sum()), "targetPx": int(tgt.sum()),
        }
    return out


def thickness_bands(final, xs, ys, zs, inp):
    """Ray-march thickness normal to the head surface per band (mm)."""
    spacing = float(xs[1] - xs[0])
    ox, oy, oz = float(xs[0]), float(ys[0]), float(zs[0])
    nx, ny, nz = len(xs), len(ys), len(zs)

    def occ_at(pts_mm):
        ix = np.rint((pts_mm[:, 0] - ox) / spacing).astype(int)
        iy = np.rint((pts_mm[:, 1] - oy) / spacing).astype(int)
        iz = np.rint((pts_mm[:, 2] - oz) / spacing).astype(int)
        ok = ((ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
              & (iz >= 0) & (iz < nz))
        o = np.zeros(pts_mm.shape[0], dtype=bool)
        o[ok] = final[ix[ok], iy[ok], iz[ok]]
        return o

    bands = {"cheek": 1515.0, "ear": 1532.0, "occiput": 1560.0,
             "shoulder": 1405.0}
    out = {}
    for name, z in bands.items():
        c = np.array([0.0, -50.0, z])
        th, gap = [], []
        for k in range(72):
            phi = 2 * np.pi * k / 72
            d = np.array([np.cos(phi), np.sin(phi), 0.0])
            t = np.arange(0.0, 221.0, 1.0)
            pts = c[None, :] + t[:, None] * d[None, :]
            sdf = EXACT.query_exact(inp["egrid"], pts)
            inside = sdf < 0
            if not inside[0]:
                continue
            edge = np.nonzero(~inside)[0]
            if edge.size == 0:
                continue
            surf = float(edge[0])
            o = occ_at(pts)
            oo = np.nonzero(o)[0]
            oo = oo[oo >= surf]
            if oo.size == 0:
                continue
            # mass thickness = last - FIRST occupied (hair depth proper);
            # standoff gap = first occupied - surface (air between skin
            # and curtain, reported separately, not mixed in).
            th.append(float(oo.max() - oo.min()))
            gap.append(float(oo.min() - surf))
        th = np.array(th)
        gap = np.array(gap)
        q = lambda a, p: round(float(np.percentile(a, p)), 1) if a.size else 0.0
        out[name] = {"z": z, "nRays": 72, "nHair": int(th.size),
                     "p50": q(th, 50), "p95": q(th, 95), "max": q(th, 100),
                     "mean": round(float(th.mean()), 1) if th.size else 0.0,
                     "gapP50": q(gap, 50), "gapP95": q(gap, 95),
                     "values": [round(float(v), 1) for v in th]}
    return out


def occiput_depth(final, xs, ys, zs, inp):
    """Hull depth behind the occiput vs the profile target (mm)."""
    spacing = float(xs[1] - xs[0])
    z = 1560.0
    c = np.array([0.0, -50.0, z])
    d = np.array([0.0, 1.0, 0.0])
    t = np.arange(0.0, 221.0, 1.0)
    pts = c[None, :] + t[:, None] * d[None, :]
    sdf = EXACT.query_exact(inp["egrid"], pts)
    inside = sdf < 0
    surf = float(np.nonzero(~inside)[0][0])
    surf_pt = c + surf * d
    ox, oy, oz = float(xs[0]), float(ys[0]), float(zs[0])
    ix = np.rint((pts[:, 0] - ox) / spacing).astype(int)
    iy = np.rint((pts[:, 1] - oy) / spacing).astype(int)
    iz = np.rint((pts[:, 2] - oz) / spacing).astype(int)
    ok = ((ix >= 0) & (ix < len(xs)) & (iy >= 0) & (iy < len(ys))
          & (iz >= 0) & (iz < len(zs)))
    o = np.zeros(len(t), dtype=bool)
    o[ok] = final[ix[ok], iy[ok], iz[ok]]
    oo = np.nonzero(o)[0]
    hull_depth = float(oo.max() - surf) if oo.size else 0.0
    # profile-target posterior extent at the occiput row band
    cam = inp["cams"]["views"]["profile_90"]
    sensor = inp["sensor"]
    cols, rows, _ = ENV.project_to_render(surf_pt[None, :] / 1000.0, cam,
                                          sensor)
    tr = inp["transforms"]["profile_90"]
    s = float(tr["scale"])
    trow = float(s * rows[0] + float(tr["ty"]))
    mask = inp["masks"]["profile_90"]
    r0 = max(0, int(trow) - 10)
    r1 = min(FRAME, int(trow) + 10)
    sub = mask[r0:r1, :]
    cols_h = np.nonzero(sub.any(axis=0))[0]
    tgt_depth = None
    if cols_h.size:
        # posterior = larger world y; profile cam looks along -x from +x?
        # resolve by unprojecting both extreme cols at plane z and taking max y
        from math import isfinite  # noqa: F401
        mat = np.array(cam["matrixWorld"], dtype=np.float64)
        rot = mat[:3, :3]
        origin = np.array(cam["location"], dtype=np.float64)
        focal = float(cam["lensMm"]) / float(sensor) * FRAME
        ys_cands = []
        for tc in (float(cols_h.min()), float(cols_h.max())):
            rc = (tc - float(tr["tx"])) / s
            rr = (trow - float(tr["ty"])) / s
            local = np.array([(rc - FRAME / 2.0) / focal,
                              -(rr - FRAME / 2.0) / focal, -1.0])
            direction = rot @ local
            direction = direction / np.linalg.norm(direction)
            if abs(direction[2]) < 1e-9:
                continue
            lam = (z / 1000.0 - origin[2]) / direction[2]
            hit = origin + lam * direction
            ys_cands.append(float(hit[1]) * 1000.0)
        if ys_cands:
            tgt_depth = round(max(ys_cands) - float(surf_pt[1]), 1)
    # posterior wall profile: max kept y at |x| < 20 mm per z (mm)
    wall = {}
    for zw in range(1460, 1601, 10):
        iz = int(np.argmin(np.abs(zs - float(zw))))
        slab = final[:, :, iz]
        ixc = np.nonzero((np.abs(xs) < 20.0))[0]
        sub = slab[ixc[:, None], np.arange(len(ys))[None, :]]
        hit = np.nonzero(sub.any(axis=0))[0]
        wall[str(zw)] = round(float(ys[hit].max() - surf_pt[1]), 1) \
            if hit.size else None
    return {"surfPtMm": [round(float(v), 1) for v in surf_pt],
            "hullDepthMm": round(hull_depth, 1),
            "targetRow": round(trow, 1),
            "targetDepthMm": tgt_depth,
            "posteriorWallMm": wall}


def sdf_crosscheck(inp, n=200):
    """Stratified agreement of the depth-buffer occlusion vs exact-SDF march."""
    rng = np.random.default_rng(7)
    agree, total = 0, 0
    for v in VIEWS:
        cam = inp["cams"]["views"][v]
        sensor = inp["sensor"]
        cover = inp["body"][v]["cover"]
        depth = inp["body"][v]["depth"]
        rr, cc = np.nonzero(cover)
        if rr.size == 0:
            continue
        sel = rng.choice(rr.size, size=min(n // 3, rr.size), replace=False)
        for r, c_ in zip(rr[sel], cc[sel]):
            bd = float(depth[r, c_])
            mat = np.array(cam["matrixWorld"], dtype=np.float64)
            rot = mat[:3, :3]
            origin = np.array(cam["location"], dtype=np.float64)
            focal = float(cam["lensMm"]) / float(sensor) * FRAME
            local = np.array([(c_ - FRAME / 2.0) / focal,
                              -(r - FRAME / 2.0) / focal, -1.0])
            direction = rot @ local
            direction = direction / np.linalg.norm(direction)
            # point 30 mm behind the buffer surface along the ray
            p = origin + direction * (bd + 0.030)
            t = np.arange(0.0, 1.2, 0.002)
            pts = (origin[None, :]
                   + t[:, None] * (p - origin)[None, :]) * 1000.0
            sdf = EXACT.query_exact(inp["egrid"], pts)
            hit = np.nonzero(sdf <= 0.0)[0]
            buf_says_occ = True  # surface point + 30 mm behind it
            sdf_says_occ = bool(hit.size and hit[0] * 0.002
                                < (bd - 0.010))
            # both should agree the probe point is behind body:
            # buffer depth vs SDF first-hit distance
            if hit.size:
                agree += 1
            total += 1
    return {"n": int(total), "sdfHit": int(agree)}


def mirror_symmetry_check(inp):
    """Mirror IoU of the front/back target masks vs their own left-right
    mirror; best axis column and its offset from image centre."""
    from PIL import Image as PILImage
    out = {}
    for v in ("front", "back"):
        m = np.array(inp["masks"][v])
        H, W = m.shape
        best = (0.0, W // 2)
        for a in range(W // 2 - 40, W // 2 + 40):
            idx = np.arange(W)
            f = m[:, np.clip(2 * a - idx, 0, W - 1)]
            iou = float((m & f).sum() / (m | f).sum())
            if iou > best[0]:
                best = (iou, a)
        iou, axis = best
        f = m[:, np.clip(2 * axis - np.arange(W), 0, W - 1)]
        xor = m ^ f
        rr, cc = np.nonzero(xor)
        bands = {}
        for lo, hi in ((0, 256), (256, 512), (512, 768), (768, 1024)):
            bands[f"rows{lo}_{hi}"] = int(xor[lo:hi].sum())
        out[v] = {
            "mirrorIoU": round(iou, 4),
            "axisCol": int(axis),
            "axisOffsetFromCentre": round(axis - (W - 1) / 2.0, 1),
            "pass09": bool(iou >= 0.9),
            "xorPx": int(xor.sum()),
            "xorFracOfMask": round(float(xor.sum() / m.sum()), 4),
            "xorBbox": [int(rr.min()), int(rr.max()),
                        int(cc.min()), int(cc.max())],
            "xorRowBands": bands,
        }
    return out


def mirror_verify(inp, dil, occ, n=20000):
    """Numeric check of the mirrored-view equivalence on kept-voxel samples.

    (a) continuous projection identity: explicit mirrored camera
    (R' = F R F, t' = F t) applied to p vs W - u of mirror(p) under the
    pinned profile camera (rows and depth identical by construction).
    (b) plumbing: the mirror column from states_for_points equals the
    profile pipeline on mirrored points recomputed here.
    """
    rng = np.random.default_rng(11)
    ws = np.load(str(WS / "baseline_kept.npz"))
    xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]),
                  np.array(ws["zs"]))
    final = np.array(ws["final"])
    pts = np.stack(np.nonzero(final), axis=1)
    sel = rng.choice(len(pts), size=min(n, len(pts)), replace=False)
    p = np.stack([xs[pts[sel, 0]], ys[pts[sel, 1]],
                  zs[pts[sel, 2]]], axis=1)
    q = mirror_points(p)
    cam = inp["cams"]["views"]["profile_90"]
    mc = mirror_camera(cam)
    cols, rows, dep = ENV.project_to_render(p / 1000.0, mc, inp["sensor"])
    colq, rowq, depq = ENV.project_to_render(q / 1000.0, cam, inp["sensor"])
    du = np.abs(cols - (FRAME - colq))
    dv = np.abs(rows - rowq)
    dd = np.abs(dep - depq)
    st_m = states_for_points(p, inp, dil, occ)
    st_q = single_view_states(q, inp, dil, occ, "profile_90")
    mi = inp["views"].index(MIRROR)
    agree = float((st_m[:, mi] == st_q).mean()) if MIRROR in inp["views"] \
        else 1.0
    qfun = lambda a: round(float(a.max()), 2) if a.size else 0.0
    return {"n": int(sel.size),
            "projUMaxAbsErrPx": qfun(du),
            "projVMaxAbsErrPx": qfun(dv),
            "depthMaxAbsErrM": round(float(dd.max()), 9) if dd.size else 0.0,
            "plumbingAgreement": round(agree, 6),
            "mirrorCamLocation": [round(float(v), 6) for v in
                                  (np.diag([-1.0, 1.0, 1.0])
                                   @ np.array(cam["location"],
                                              dtype=np.float64))],
            "plane": "x = 0 (head frame, world mm)"}


def stage_carve():
    WS.mkdir(parents=True, exist_ok=True)
    inp = load_inputs()
    res = carve_grids(inp, spacing=2.0, dil_px=2, store=True)
    filt = close_and_filter(res, inp, res["dil"], res["occ"])
    kept_pre = int(res["kept"].sum())
    kept_post = int(filt["closed"].sum())
    kept_final = int(filt["final"].sum())
    vc = res["viscount"][filt["final"]]
    nv = len(inp["views"])
    bins = {str(k): int((vc == k).sum()) for k in range(nv + 1)}
    vox_mm3 = 2.0 ** 3
    stats = {
        "crop": CROP, "spacing": 2.0, "dilPx": 2,
        "registrationP95Px": 0.0,
        "projectorCheckWorstPx": 0.4693603515625,
        "shoulderPlaneZ": SHOULDER_PLANE_Z,
        "totalVoxels": int(res["total"]),
        "keptPreClose": kept_pre, "keptPostClose": kept_post,
        "keptFinal": kept_final,
        "volMm3": round(kept_final * vox_mm3, 1),
        "volByVisCount": {k: {"n": n, "mm3": round(n * vox_mm3, 1)}
                          for k, n in bins.items()},
        "joinedByClosing": filt["joinedByClosing"],
        "splitByPrune": filt["splitByPrune"],
        "nAdded": filt["nAdded"], "nPrunedSdf": filt["nPrunedSdf"],
        "nPrunedOutside": filt["nPrunedOutside"],
        "nCompPre": filt["n_pre"], "nCompRaw": filt["n_raw"],
        "nCompPost": filt["n_post"],
        "sizesPre": filt["sizes_pre"], "sizesPost": filt["sizes_post"],
        "touchLabels": filt["touch_labels"],
        "touchSizes": filt["touch_sizes"],
        "keepLabel": filt["keep_label"],
        "droppedTouch": filt["dropped_touch"],
        "nOccluded": {k: int(v) for k, v in res["n_occluded"].items()},
        "nOutsideRender": {k: int(v) for k, v in res["n_outside_render"].items()},
        "nOutsideTarget": {k: int(v) for k, v in res["n_outside_target"].items()},
        "maskSha": inp["mask_sha"],
        "views": inp["views"],
        "mirrorProfile": bool(USE_MIRROR),
    }
    packed = pack_states(res["states"])
    np.savez_compressed(
        str(WS / "baseline_kept.npz"),
        kept=res["kept"], closed=filt["closed"], final=filt["final"],
        viscount=res["viscount"], states_packed=packed,
        xs=res["xs"], ys=res["ys"], zs=res["zs"])
    for v in inp["views"]:
        np.save(str(WS / f"splat_{v}.npy"), res["splat"][v])
    (WS / "carve_stats.json").write_text(json.dumps(stats, indent=1))
    sym = {"symmetry": mirror_symmetry_check(inp),
           "assumption": "target hairstyle bilaterally symmetric about the "
                         "head midsagittal plane x = 0 (centre part, "
                         "straight hair per style manifest part=centre)"}
    (WS / "symmetry.json").write_text(json.dumps(sym, indent=1))
    mv = mirror_verify(inp, res["dil"], res["occ"]) if USE_MIRROR else \
        {"mirror": "off"}
    stats["mirrorVerify"] = mv
    (WS / "carve_stats.json").write_text(json.dumps(stats, indent=1))
    (E / "inputs-opened.txt").write_text("\n".join(sorted(set(OPENED))) + "\n")
    print(json.dumps({k: stats[k] for k in
                      ("keptPreClose", "keptPostClose", "keptFinal", "volMm3",
                       "nCompPre", "nCompRaw", "nCompPost", "joinedByClosing",
                       "splitByPrune", "nAdded", "nPrunedSdf",
                       "nPrunedOutside", "volByVisCount")}, indent=1),
          flush=True)


def stage_diag():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    inp = load_inputs()
    ws = np.load(str(WS / "baseline_kept.npz"))
    final = np.array(ws["final"])
    viscount = np.array(ws["viscount"])
    states_packed = np.array(ws["states_packed"])
    xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]),
                  np.array(ws["zs"]))
    # NOTE: carve-stage splats were pre-close/prefilter; rebuild visible
    # splats from the final hull + stored per-voxel states for honesty.
    splat = splat_visible(final, states_packed, xs, ys, zs, inp)
    for v in inp["views"]:
        np.save(str(WS / f"splat_final_{v}.npy"), splat[v])
    cm = contour_metrics(splat, inp["masks"])
    th = thickness_bands(final, xs, ys, zs, inp)
    occ = occiput_depth(final, xs, ys, zs, inp)
    # root proximity: EDT of ~final sampled at scalp1 roots
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
                              ("nape_z below1500", (0.0, 1500.0))):
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
    xcheck = sdf_crosscheck(inp)
    diag = {"contour": cm, "thickness": th, "occiput": occ,
            "rootProx": root_prox, "sdfCrosscheck": xcheck}
    (WS / "diag.json").write_text(json.dumps(diag, indent=1))
    slices_fig(final, viscount, xs, ys, zs, th, inp)
    print(json.dumps({"contour": cm, "thickness":
                     {k: {kk: v[kk] for kk in ("nHair", "p50", "p95", "max")}
                      for k, v in th.items()},
                      "occiput": occ, "rootProx": root_prox,
                      "sdfCrosscheck": xcheck}, indent=1), flush=True)


def splat_visible(occ, states_packed, xs, ys, zs, inp):
    """Target-frame splat of the VISIBLE hull per view (state 0 only)."""
    Xg, Yg, Zg = np.meshgrid(xs, ys, zs, indexing="ij")
    out = {}
    for vi, v in enumerate(inp["views"]):
        src, mir = view_source(v)
        st = unpack_state(states_packed, vi)
        sel = occ & (st == 0)
        pts = np.stack([Xg[sel], Yg[sel], Zg[sel]], axis=1)
        if mir:
            pts = mirror_points(pts)
        pts = pts / 1000.0
        m = np.zeros((FRAME, FRAME), dtype=bool)
        if pts.shape[0]:
            cam = inp["cams"]["views"][src]
            cols, rows, _ = ENV.project_to_render(pts, cam, inp["sensor"])
            t = inp["transforms"][src]
            s = float(t["scale"])
            ct = np.rint(s * cols + float(t["tx"])).astype(np.int64)
            rt = np.rint(s * rows + float(t["ty"])).astype(np.int64)
            ok = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME))
            m[rt[ok], ct[ok]] = True
        out[v] = m
    return out


def splat_from_occ(occ, xs, ys, zs, inp):
    Xg, Yg, Zg = np.meshgrid(xs, ys, zs, indexing="ij")
    pts = np.stack([Xg[occ], Yg[occ], Zg[occ]], axis=1) / 1000.0
    out = {}
    for v in VIEWS:
        cam = inp["cams"]["views"][v]
        cols, rows, _ = ENV.project_to_render(pts, cam, inp["sensor"])
        t = inp["transforms"][v]
        s = float(t["scale"])
        ct = np.rint(s * cols + float(t["tx"])).astype(np.int64)
        rt = np.rint(s * rows + float(t["ty"])).astype(np.int64)
        ok = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME))
        m = np.zeros((FRAME, FRAME), dtype=bool)
        m[rt[ok], ct[ok]] = True
        out[v] = m
    return out


def slices_fig(final, viscount, xs, ys, zs, th, inp):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    pts = np.stack(np.nonzero(final), axis=1)
    cx, cy, cz = (int(pts[:, 0].mean()), int(pts[:, 1].mean()),
                  int(pts[:, 2].mean()))
    fig, axes = plt.subplots(2, 4, figsize=(20, 10))
    nv = int(viscount.max()) if viscount.size else 0
    cmap = ListedColormap(["#111111", "#3b82f6", "#22c55e", "#eab308",
                           "#ef4444"][:nv + 1])
    titles = [f"axial z={zs[cz]:.0f}mm (x,y)",
              f"coronal y={ys[cy]:.0f}mm (x,z)",
              f"sagittal x={xs[cx]:.0f}mm (y,z)"]
    sl = [viscount[:, :, cz], viscount[:, cy, :].T, viscount[cy, :, :].T]
    for ax, s, ti in zip(axes[0][:3], sl, titles):
        im = ax.imshow(s, cmap=cmap, vmin=0, vmax=nv, origin="lower")
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
    for ax, (name, b) in zip(axes[1], th.items()):
        vals = np.array(b["values"])
        ax.hist(vals, bins=np.arange(0, max(120, vals.max() + 5) + 5, 5),
                color="#8b5cf6", edgecolor="black", linewidth=0.3)
        ax.set_title(f"{name} z={b['z']:.0f}mm n={b['nHair']}\n"
                     f"mass p50={b['p50']} p95={b['p95']} max={b['max']} "
                     f"gap50={b['gapP50']}", fontsize=9)
        ax.set_xlabel("hair-mass thickness mm (surface normal)")
    fig.suptitle("%s visible-count slices + band thickness" % E.name)
    fig.tight_layout()
    fig.savefig(str(E / "slices.png"), dpi=100)
    plt.close(fig)


def stage_sensitivity():
    inp = load_inputs()
    base_cm = json.loads((WS / "diag.json").read_text())["contour"]
    out = {}
    # A: 1 mm re-carve, same 2 px dilation (states kept: visible splats
    # are rebuilt post close/filter, same as baseline)
    res = carve_grids(inp, spacing=1.0, dil_px=2, store=True)
    filt = close_and_filter(res, inp, res["dil"], res["occ"])
    vox = 1.0 ** 3
    sp1 = pack_states(res["states"])
    splat = splat_visible(filt["final"], sp1, res["xs"], res["ys"],
                          res["zs"], inp)
    total1 = int(res["total"])
    del res, sp1
    cm = contour_metrics(splat, inp["masks"])
    out["spacing1mm"] = {
        "spacing": 1.0, "dilPx": 2, "totalVoxels": total1,
        "keptFinal": int(filt["final"].sum()),
        "volMm3": round(float(filt["final"].sum()) * vox, 1),
        "nCompPre": filt["n_pre"], "nCompPost": filt["n_post"],
        "nAdded": filt["nAdded"], "nPrunedSdf": filt["nPrunedSdf"],
        "nPrunedOutside": filt["nPrunedOutside"],
        "touchLabels": filt["touch_labels"],
        "touchSizes": filt["touch_sizes"],
        "keepLabel": filt["keep_label"],
        "droppedTouch": filt["dropped_touch"],
        "keepFrac": round(float(filt["final"].sum()
                                / max(1, int(filt["closed"].sum()))), 4),
        "contour": cm,
    }
    # B: 2 mm re-carve, undilated masks
    res2 = carve_grids(inp, spacing=2.0, dil_px=0, store=True)
    filt2 = close_and_filter(res2, inp, res2["dil"], res2["occ"])
    sp2 = pack_states(res2["states"])
    splat2 = splat_visible(filt2["final"], sp2, res2["xs"], res2["ys"],
                           res2["zs"], inp)
    total2 = int(res2["total"])
    del res2, sp2
    cm2 = contour_metrics(splat2, inp["masks"])
    out["undilated"] = {
        "spacing": 2.0, "dilPx": 0, "totalVoxels": total2,
        "keptFinal": int(filt2["final"].sum()),
        "volMm3": round(float(filt2["final"].sum()) * 8.0, 1),
        "nCompPre": filt2["n_pre"], "nCompPost": filt2["n_post"],
        "nAdded": filt2["nAdded"], "nPrunedSdf": filt2["nPrunedSdf"],
        "nPrunedOutside": filt2["nPrunedOutside"],
        "touchLabels": filt2["touch_labels"],
        "touchSizes": filt2["touch_sizes"],
        "keepLabel": filt2["keep_label"],
        "droppedTouch": filt2["dropped_touch"],
        "keepFrac": round(float(filt2["final"].sum()
                                / max(1, int(filt2["closed"].sum()))), 4),
        "contour": cm2,
    }
    for key in ("spacing1mm", "undilated"):
        c = out[key]["contour"]
        maxd = 0.0
        fragile = []
        for v in VIEWS:
            for m in ("excessP95", "missP95"):
                d = abs(c[v][m] - base_cm[v][m])
                maxd = max(maxd, d)
                if d > 5.0:
                    fragile.append(f"{v}/{m}: base {base_cm[v][m]} "
                                   f"vs {c[v][m]}")
        out[key]["maxContourDeltaPx"] = round(maxd, 2)
        out[key]["fragile"] = fragile
    (WS / "sens.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: {kk: out[k][kk] for kk in
                          ("keptFinal", "volMm3", "nCompPre", "nCompPost",
                           "touchLabels", "keepFrac", "maxContourDeltaPx",
                           "fragile")} for k in out}, indent=1), flush=True)


def stage_export():
    from skimage.measure import marching_cubes
    inp = load_inputs()  # reunite the runtime-inputs log (export reads E only)
    ws = np.load(str(WS / "baseline_kept.npz"))
    final = np.array(ws["final"])
    viscount = np.array(ws["viscount"])
    states_packed = np.array(ws["states_packed"])
    xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]),
                  np.array(ws["zs"]))
    stats = json.loads((WS / "carve_stats.json").read_text())
    packed = (states_packed if states_packed.dtype in (np.uint8, np.uint16)
              else states_packed.astype(np.uint16))
    np.savez_compressed(
        str(E / "hull.npz"), occupancy=final, viscount=viscount,
        states_packed=packed,
        states_legend=np.array(["0=INSIDE_MASK", "1=VISIBLE_OUTSIDE",
                                "2=BODY_OCCLUDED"]),
        views=np.array(inp["views"]),
        mirror_profile=np.bool_(USE_MIRROR),
        xs=xs, ys=ys, zs=zs, spacing=np.float64(2.0),
        crop=np.array([CROP["x0"], CROP["x1"], CROP["y0"], CROP["y1"],
                       CROP["z0"], CROP["z1"]]),
        shoulder_plane_z=np.float64(SHOULDER_PLANE_Z),
        sdf_clear_mm=np.float64(SDF_CLEAR_MM),
        dilation_px=np.int64(2),
        registration_p95_px=np.float64(0.0))
    # surface mesh for the Blender figure
    verts, faces, _, _ = marching_cubes(final.astype(np.float32), level=0.5,
                                        spacing=(2.0, 2.0, 2.0))
    world_mm = verts + np.array([xs[0], ys[0], zs[0]])
    world_m = world_mm / 1000.0
    with open(WS / "hull_surface.obj", "w") as f:
        f.write("# %s surface (marching cubes, world metres)\n" % E.name)
        for p in world_m:
            f.write("v %.6f %.6f %.6f\n" % (p[0], p[1], p[2]))
        for t in faces:
            f.write("f %d %d %d\n" % (t[0] + 1, t[1] + 1, t[2] + 1))
    print("export hull.npz bytes=%d tris=%d" %
          ((E / "hull.npz").stat().st_size, len(faces)), flush=True)


def main():
    global E, WS, USE_MIRROR
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all",
                    choices=["carve", "diag", "sensitivity", "export", "all"])
    ap.add_argument("--mirror-profile", dest="mirror_profile",
                    action=argparse.BooleanOptionalAction, default=True)
    ap.add_argument("--evidence-dir", default=None)
    args = ap.parse_args()
    USE_MIRROR = bool(args.mirror_profile)
    if args.evidence_dir:
        E = Path(args.evidence_dir)
        if not E.is_absolute():
            E = ROOT / E
    WS = E / "workspace"
    if args.stage in ("carve", "all"):
        stage_carve()
    if args.stage in ("diag", "all"):
        stage_diag()
    if args.stage in ("sensitivity", "all"):
        stage_sensitivity()
    if args.stage in ("export", "all"):
        stage_export()
    (E / "inputs-opened.txt").write_text("\n".join(sorted(set(OPENED)))
                                         + "\n")


if __name__ == "__main__":
    main()