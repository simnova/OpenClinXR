"""Guide-cage instruments: strip raster, regional losses, guard, collision.

Reuses the station0b pinned-camera projector and the body SDF by import
from hair-groom (envelope, register); nothing is copied. Pure NumPy/PIL:
no renderer, no network.

Strip raster: every ribbon quad is projected and its TWO triangles are
filled individually and OR-ed into the mask (union of projected
triangles, never a polygon fill of the quad or of the union). The mask is
mapped into the registered target frame with the station similarity
transforms, same model as run.py.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

STATION = Path(__file__).resolve().parent
HAIR_GROOM = STATION.parent
sys.path.insert(0, str(HAIR_GROOM))
sys.path.insert(0, str(STATION))
import envelope as ENV  # noqa: E402
import register as REG  # noqa: E402
import exact as EXACT  # noqa: E402

FRAME = 1024
VIEWS = ("front", "profile_90", "back")
TOL_MM = 4.0  # body SDF tolerance: collision is penetration beyond this


def load_cameras(path):
    doc = json.loads(Path(path).read_text())
    return doc


def transforms_of(cams):
    out = {}
    for view in VIEWS:
        a_r, b_r, c_r = cams["registrationRenderTriples"][view]
        a_t, b_t, c_t = cams["registrationTargetTriples"][view]
        out[view] = REG.similarity_from_triples(a_r, b_r, c_r, a_t, b_t, c_t)
    return out


def sensor_of(cams):
    return float(cams["sensorWidthMm"])


def strip_raster(cage, cams, transforms, views=VIEWS):
    """Per-family bool masks in the registered target frame.

    cage: {family: {"grid_w": (left_w, right_w)}} world-metre strips.
    Each of the 60 quads contributes 2 individually filled triangles.
    """
    sensor = sensor_of(cams)
    out = {}
    for family, rib in sorted(cage.items()):
        left_w, right_w = rib["grid_w"]
        grid = np.stack([np.asarray(left_w), np.asarray(right_w)], axis=1)
        n = grid.shape[0]
        fam = {}
        for view in views:
            flat = np.ascontiguousarray(
                grid.reshape(-1, 3), dtype=np.float64)
            cols, rows, depth = ENV.project_to_render(
                flat, cams["views"][view], sensor)
            if bool((depth <= 0).any()):
                raise ValueError("cage behind camera in %s" % view)
            t = transforms[view]
            s = float(t["scale"])
            cols_t = (s * cols + float(t["tx"])).reshape(n, 2)
            rows_t = (s * rows + float(t["ty"])).reshape(n, 2)
            img = Image.new("L", (FRAME, FRAME), 0)
            draw = ImageDraw.Draw(img)
            for k in range(n - 1):
                a = (cols_t[k, 0], rows_t[k, 0])
                b = (cols_t[k, 1], rows_t[k, 1])
                c = (cols_t[k + 1, 0], rows_t[k + 1, 0])
                d = (cols_t[k + 1, 1], rows_t[k + 1, 1])
                draw.polygon([a, b, d], fill=1)
                draw.polygon([a, d, c], fill=1)
            fam[view] = np.asarray(img, dtype=bool)
        out[family] = fam
    return out


def union_mask(raster, families=None, view=None):
    acc = None
    for family in sorted(raster):
        if families is not None and family not in families:
            continue
        m = raster[family][view]
        acc = m.copy() if acc is None else (acc | m)
    return acc


def boundary(mask):
    return mask ^ ndimage.binary_erosion(mask)


def region_definitions(landmarks):
    """Region boxes per view in the target frame, from registered landmarks.

    crown: rows above crown_top + 0.15 H (H = chin - crown rows).
    face opening: eye-to-chin band around the face centre column.
    side curtain: ear-to-hem bands flanking the face box (front/back);
    in profile the ear-side mass behind the face box. Bands end where
    the hem band starts (regions are row-disjoint by construction).
    hem: rows below hem_row - 0.12 H.
    Back view has no face opening (empty box); profile boxes use the
    profile rows with fractions transferred from the front landmarks.
    """
    front = landmarks["front"]
    prof = landmarks["profile"]
    back = landmarks["back"]
    eye, chin, crown_f = (front["eye_row"], front["chin_row"],
                          front["crown_top_row"])
    centre = front["face_centre_col"]
    hem_f = front["front_hem_row"]
    hem_r0_f = hem_f - 0.12 * (chin - crown_f)
    hf = prof["forehead_front_col"]
    crown_p, chin_p = prof["crown_top_row"], prof["chin_row"]
    frac = lambda r: (r - crown_f) / (chin - crown_f)  # noqa: E731
    eye_p = crown_p + frac(eye) * (chin_p - crown_p)
    mouth_f = eye + 0.65 * (chin - eye)
    mouth_p = crown_p + frac(mouth_f) * (chin_p - crown_p)
    hem_p = 866.0  # profile hem row (landmarks targets_v5 profile_hem_row_v2)
    hem_r0_p = hem_p - 0.12 * (chin_p - crown_p)
    hem_b = 822.0  # back hem row (landmarks targets_v6 back_hem_row_v3)
    crown_b, sh_b = back["crown_top_row"], back["shoulder_row"]
    crown_r1_b = crown_b + 0.15 * (sh_b - crown_b)
    hem_r0_b = hem_b - 0.12 * (sh_b - crown_b)
    centre_b = back["hair_centre_col"]
    return {
        "front": {
            "crown": [0, crown_f + 0.15 * (chin - crown_f), 0, 1024],
            "face_opening": [eye - 15, chin + 15, centre - 90, centre + 90],
            "side_curtain_L": [eye, hem_r0_f, centre - 200, centre - 90],
            "side_curtain_R": [eye, hem_r0_f, centre + 90, centre + 200],
            "hem": [hem_r0_f, 1024, 0, 1024],
        },
        "profile_90": {
            "crown": [0, crown_p + 0.15 * (chin_p - crown_p), 0, 1024],
            "face_opening": [eye_p - 15, mouth_p + 30, hf - 80, hf + 25],
            "side_curtain_L": [eye_p, hem_r0_p, hf + 25, hf + 200],
            "side_curtain_R": [],
            "hem": [hem_r0_p, 1024, 0, 1024],
        },
        "back": {
            "crown": [0, crown_r1_b, 0, 1024],
            "face_opening": [],
            "side_curtain_L": [crown_r1_b, hem_r0_b, centre_b - 200,
                               centre_b - 90],
            "side_curtain_R": [crown_r1_b, hem_r0_b, centre_b + 90,
                               centre_b + 200],
            "hem": [hem_r0_b, 1024, 0, 1024],
        },
    }


def region_masks(regions):
    """Bool masks per view/region; empty box -> all-False mask."""
    out = {}
    rows, cols = np.mgrid[0:FRAME, 0:FRAME]
    for view, regs in regions.items():
        out[view] = {}
        for name, box in regs.items():
            if not box:
                out[view][name] = np.zeros((FRAME, FRAME), dtype=bool)
                continue
            r0, r1, c0, c1 = box
            out[view][name] = (
                (rows >= r0) & (rows < r1) & (cols >= c0) & (cols < c1))
    return out


def regional_loss(fitted, target, region):
    """Bidirectional contour loss inside one region mask.

    excess: fitted boundary px inside region and outside target (mean px
    distance to target boundary, + count). miss: target boundary px inside
    region and outside fitted. Zeros when the region matches.
    """
    bf = boundary(fitted) & region
    bt = boundary(target) & region
    edt_t = ndimage.distance_transform_edt(~boundary(target))
    edt_f = ndimage.distance_transform_edt(~boundary(fitted))
    fr, fc = np.nonzero(bf)
    tr, tc = np.nonzero(bt)
    outside_f = ~target[fr, fc] if fr.size else np.zeros(0, dtype=bool)
    outside_t = ~fitted[tr, tc] if tr.size else np.zeros(0, dtype=bool)
    de = edt_t[fr, fc][outside_f] if fr.size else np.zeros(0)
    dm = edt_f[tr, tc][outside_t] if tr.size else np.zeros(0)
    return {
        "excessMeanPx": round(float(de.mean()), 2) if de.size else 0.0,
        "excessMaxPx": round(float(de.max()), 2) if de.size else 0.0,
        "excessN": int(outside_f.sum()),
        "missMeanPx": round(float(dm.mean()), 2) if dm.size else 0.0,
        "missMaxPx": round(float(dm.max()), 2) if dm.size else 0.0,
        "missN": int(outside_t.sum()),
    }


def all_regional_losses(raster_union, targets, regions):
    masks = region_masks(regions)
    out = {}
    for view in VIEWS:
        out[view] = {}
        for name in regions[view]:
            out[view][name] = regional_loss(
                raster_union[view], targets[view], masks[view][name])
    return out


def guard_definitions(landmarks):
    """Eye/mouth boxes that must stay uncovered (target frame px)."""
    front = landmarks["front"]
    prof = landmarks["profile"]
    eye, chin, crown_f = (front["eye_row"], front["chin_row"],
                          front["crown_top_row"])
    centre = front["face_centre_col"]
    mouth_f = eye + 0.65 * (chin - eye)
    frac = lambda r: (r - crown_f) / (chin - crown_f)  # noqa: E731
    crown_p, chin_p = prof["crown_top_row"], prof["chin_row"]
    hf = prof["forehead_front_col"]
    eye_p = crown_p + frac(eye) * (chin_p - crown_p)
    mouth_p = crown_p + frac(mouth_f) * (chin_p - crown_p)
    return {
        "front": {
            "eyes": [eye - 10, eye + 10, centre - 70, centre + 70],
            "mouth": [mouth_f - 12, mouth_f + 12, centre - 50, centre + 50],
        },
        "profile_90": {
            "eyes": [eye_p - 10, eye_p + 10, hf - 60, hf + 15],
            "mouth": [mouth_p - 12, mouth_p + 12, hf - 55, hf + 20],
        },
        "back": {},
    }


def guard_masks(guards):
    out = {}
    rows, cols = np.mgrid[0:FRAME, 0:FRAME]
    for view, boxes in guards.items():
        acc = np.zeros((FRAME, FRAME), dtype=bool)
        for _, box in boxes.items():
            r0, r1, c0, c1 = box
            acc |= ((rows >= r0) & (rows < r1) & (cols >= c0) & (cols < c1))
        out[view] = acc
    return out


def guard_boxes_render(guards, transforms):
    """Map the target-frame guard boxes into each render frame.

    The station map is a similarity (scale + translation), so boxes stay
    axis-aligned; corners are mapped with the inverse transform.
    """
    out = {}
    for view, boxes in guards.items():
        t = transforms[view]
        s = float(t["scale"])
        inv = {}
        for name, box in boxes.items():
            r0, r1, c0, c1 = box
            inv[name] = [(r0 - float(t["ty"])) / s,
                         (r1 - float(t["ty"])) / s,
                         (c0 - float(t["tx"])) / s,
                         (c1 - float(t["tx"])) / s]
        out[view] = inv
    return out


def render_depth(grids, cams, views=VIEWS):
    """Per-view render-frame coverage + min-depth maps (numpy triangle scan).

    grids: {family: (left_w, right_w)} world-metre edge columns.
    Returns {view: (cover_bool, depthmap_m)}; depth is camera-space depth
    (same unit as the input verts) of the nearest ribbon triangle.
    """
    sensor = sensor_of(cams)
    out = {}
    for view in views:
        cover = np.zeros((FRAME, FRAME), dtype=bool)
        depth = np.full((FRAME, FRAME), np.inf)
        for family in sorted(grids):
            left_w, right_w = grids[family]
            left_w = np.asarray(left_w, dtype=np.float64)
            right_w = np.asarray(right_w, dtype=np.float64)
            n = left_w.shape[0]
            pts = np.empty((n * 2, 3))
            pts[0::2], pts[1::2] = left_w, right_w
            cols, rows, dep = ENV.project_to_render(
                pts, cams["views"][view], sensor)
            cols = cols.reshape(n, 2)
            rows = rows.reshape(n, 2)
            dep = dep.reshape(n, 2)
            for k in range(n - 1):
                quads = (
                    (cols[k, 0], rows[k, 0], dep[k, 0],
                     cols[k, 1], rows[k, 1], dep[k, 1],
                     cols[k + 1, 1], rows[k + 1, 1], dep[k + 1, 1]),
                    (cols[k, 0], rows[k, 0], dep[k, 0],
                     cols[k + 1, 1], rows[k + 1, 1], dep[k + 1, 1],
                     cols[k + 1, 0], rows[k + 1, 0], dep[k + 1, 0]),
                )
                for (x0, y0, d0, x1, y1, d1, x2, y2, d2) in quads:
                    xlo = max(int(np.floor(min(x0, x1, x2))), 0)
                    xhi = min(int(np.ceil(max(x0, x1, x2))), FRAME - 1)
                    ylo = max(int(np.floor(min(y0, y1, y2))), 0)
                    yhi = min(int(np.ceil(max(y0, y1, y2))), FRAME - 1)
                    if xhi < xlo or yhi < ylo:
                        continue
                    denom = ((y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2))
                    if abs(denom) < 1e-12:
                        continue
                    yy, xx = np.mgrid[ylo:yhi + 1, xlo:xhi + 1]
                    l0 = ((y1 - y2) * (xx - x2) + (x2 - x1) * (yy - y2)) \
                        / denom
                    l1 = ((y2 - y0) * (xx - x2) + (x0 - x2) * (yy - y2)) \
                        / denom
                    l2 = 1.0 - l0 - l1
                    inside = (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
                    if not inside.any():
                        continue
                    dd = l0 * d0 + l1 * d1 + l2 * d2
                    sub = np.zeros_like(inside, dtype=bool)
                    sub[inside] = dd[inside] < depth[ylo:yhi + 1,
                                                    xlo:xhi + 1][inside]
                    depth[ylo:yhi + 1, xlo:xhi + 1][sub] = dd[sub]
                    cover[ylo:yhi + 1, xlo:xhi + 1] |= inside
        out[view] = (cover, depth)
    return out


def scan_triangle(cover, depth, x0, y0, d0, x1, y1, d1, x2, y2, d2,
                  ox=0, oy=0):
    """Rasterize one world-space triangle into cover/depth buffers.

    (x, y) are render-frame px coords, d camera-space depth (metres).
    Buffers may be full-frame or a window with origin (ox, oy) px.
    """
    H, W = cover.shape
    xlo = max(int(np.floor(min(x0, x1, x2))), ox)
    xhi = min(int(np.ceil(max(x0, x1, x2))), ox + W - 1)
    ylo = max(int(np.floor(min(y0, y1, y2))), oy)
    yhi = min(int(np.ceil(max(y0, y1, y2))), oy + H - 1)
    if xhi < xlo or yhi < ylo:
        return
    denom = ((y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2))
    if abs(denom) < 1e-12:
        return
    yy, xx = np.mgrid[ylo:yhi + 1, xlo:xhi + 1]
    l0 = ((y1 - y2) * (xx - x2) + (x2 - x1) * (yy - y2)) / denom
    l1 = ((y2 - y0) * (xx - x2) + (x0 - x2) * (yy - y2)) / denom
    l2 = 1.0 - l0 - l1
    inside = (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
    if not inside.any():
        return
    dd = l0 * d0 + l1 * d1 + l2 * d2
    sl = (slice(ylo - oy, yhi + 1 - oy), slice(xlo - ox, xhi + 1 - ox))
    sub = np.zeros_like(inside, dtype=bool)
    cur = depth[sl]
    sub[inside] = dd[inside] < cur[inside]
    cur[sub] = dd[sub]
    depth[sl] = cur
    cov = cover[sl]
    cov |= inside
    cover[sl] = cov


def body_depth_maps(verts_m, faces, cams, views=VIEWS):
    """Per-view render-frame body coverage + camera-space depth (metres).

    verts_m: world-metre body vertices (topper excluded); faces: (M, 3).
    One-time cost; lets the cage raster depth-test strips against the body
    so occluded hair (back sheet over the face in front view) never counts.
    """
    sensor = sensor_of(cams)
    out = {}
    for view in views:
        cols, rows, dep = ENV.project_to_render(
            np.asarray(verts_m, dtype=np.float64), cams["views"][view],
            sensor)
        cover = np.zeros((FRAME, FRAME), dtype=bool)
        depth = np.full((FRAME, FRAME), np.inf)
        for tri in np.asarray(faces, dtype=np.int64):
            scan_triangle(
                cover, depth,
                cols[tri[0]], rows[tri[0]], dep[tri[0]],
                cols[tri[1]], rows[tri[1]], dep[tri[1]],
                cols[tri[2]], rows[tri[2]], dep[tri[2]])
        out[view] = (cover, depth)
    return out


OCCLUDE_MARGIN_M = 0.0005  # hair < 0.5 mm in front of body counts as visible


def occluded_union(render_cover, body_maps, transforms, views=VIEWS,
                   margin_m=OCCLUDE_MARGIN_M):
    """Visible-hair mask per view in the TARGET frame: strip cover where
    strip depth is in front of the body depth (minus margin), warped from
    the render frame with the station similarity transforms
    (nearest-neighbour). render_cover: {view: (cover, depth)} from
    render_depth; body_maps: {view: (cover, depth)} from body_depth_maps.
    The target masks are occluded views, so the fitted raster must be
    occluded too (else the back sheet fills the face hole invisibly to
    every contour loss and the face-opening gate is vacuous).
    """
    out = {}
    for view in views:
        cover, depth = render_cover[view]
        _, bdepth = body_maps[view]
        vis = cover & (depth < bdepth - margin_m)
        t = transforms[view]
        s = float(t["scale"])
        rr, cc = np.mgrid[0:FRAME, 0:FRAME]
        rs = np.rint((rr - float(t["ty"])) / s).astype(np.int64)
        cs = np.rint((cc - float(t["tx"])) / s).astype(np.int64)
        hit = ((rs >= 0) & (rs < FRAME) & (cs >= 0) & (cs < FRAME))
        warped = np.zeros((FRAME, FRAME), dtype=bool)
        warped[hit] = vis[rs[hit], cs[hit]]
        out[view] = warped
    return out


def face_guard_depth(render_cover, refs, boxes_render, margin_m=0.005):
    """Depth-aware face guard: a guard pixel counts only when ribbon lies
    in FRONT of the face surface (ribbon depth < face depth - margin).

    render_cover: {view: (cover_bool, depthmap_m)} in the render frame.
    refs: {view: {"eyes": face_depth_m, "mouth": face_depth_m}}.
    boxes_render: guard boxes in the render frame.
    Hair behind the head (back sheet in front view) never counts.
    """
    out = {}
    rows, cols = np.mgrid[0:FRAME, 0:FRAME]
    for view in VIEWS:
        cover, depth = render_cover[view]
        total, guarded = 0, 0
        per = {}
        for name, box in boxes_render[view].items():
            r0, r1, c0, c1 = box
            zone = ((rows >= r0) & (rows < r1)
                    & (cols >= c0) & (cols < c1))
            hit = zone & cover & (depth < refs[view][name] - margin_m)
            per[name] = {"coveredPx": int(hit.sum()),
                         "guardPx": int(zone.sum())}
            total += int(zone.sum())
            guarded += int(hit.sum())
        out[view] = {"coveredPx": guarded, "guardPx": total, **per}
    out["totalCoveredPx"] = int(sum(out[v]["coveredPx"] for v in VIEWS))
    return out


def face_ref_depths(points, cams, views=VIEWS):
    """Face-surface reference depths per view (render frame, metres).

    points: {"brow": xyz_m, "menton": xyz_m} (station 3D landmarks).
    eyes inherit the brow depth, mouth the menton depth.
    """
    sensor = sensor_of(cams)
    out = {}
    for view in views:
        _, _, db = ENV.project_to_render(
            np.asarray(points["brow"])[None, :], cams["views"][view],
            sensor)
        _, _, dm = ENV.project_to_render(
            np.asarray(points["menton"])[None, :], cams["views"][view],
            sensor)
        out[view] = {"eyes": float(db[0]), "mouth": float(dm[0])}
    return out


def face_guard(raster_union, guards):
    """Legacy projection-only guard (kept for reference, not scored)."""
    masks = guard_masks(guards)
    out = {}
    for view in VIEWS:
        g = masks[view]
        out[view] = {
            "coveredPx": int((raster_union[view] & g).sum()),
            "guardPx": int(g.sum()),
        }
    out["totalCoveredPx"] = int(sum(out[v]["coveredPx"] for v in VIEWS))
    return out


def resample_lines(lines_head, crown, step_mm=2.0):
    """Resample head-mm polylines at <= step_mm arc spacing -> world metres."""
    from cage import head_to_world
    pts = []
    for line in lines_head:
        line = np.asarray(line, dtype=np.float64)
        seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
        total = seg.sum()
        n = max(int(np.ceil(total / step_mm)) + 1, 2)
        t = np.linspace(0.0, 1.0, n)
        cum = np.concatenate([[0.0], np.cumsum(seg)])
        flat = cum / cum[-1] if cum[-1] > 0 else cum
        idx = np.clip(np.searchsorted(cum, t * total) - 1, 0, len(seg) - 1)
        frac = np.zeros_like(t)
        for k in range(n):
            lo, hi = cum[idx[k]], cum[idx[k] + 1]
            frac[k] = 0.0 if hi == lo else (t[k] * total - lo) / (hi - lo)
        pts.append(line[idx] * (1 - frac)[:, None]
                   + line[idx + 1] * frac[:, None])
    return head_to_world(np.vstack(pts), crown)


def collide(cage, spec, grid):
    """Sample every centreline + both edges at <= 2 mm; SDF in mm.

    Returns per-family and total max depth beyond the -4 mm tolerance
    plus violating counts, with a drop-band breakdown: the crown ball
    (drop < 60 mm) sits inside the SDF's conservative-voxel inflation
    (triangle-AABB mark +1 voxel on a coarse scalp mesh reads ~10 mm
    deep at a true 13 mm standoff), so the below-ball bands carry the
    actionable fit signal and the ball band is reported separately.
    """
    crown = spec["crown"]
    crown_mm = np.array(crown, dtype=np.float64) * 1000.0
    per, all_depths, all_viol = {}, [], 0
    bands = {"crownBall": [], "belowBall": []}
    for family in sorted(cage):
        rib = cage[family]
        lines = [rib["centre_head"], rib["left_head"], rib["right_head"]]
        pts = resample_lines(lines, crown, 2.0)
        head = pts * 1000.0
        drops = crown_mm[2] - head[:, 2]
        sdf = ENV.query_sdf(grid, head)
        depth = np.maximum(-sdf - TOL_MM, 0.0)
        ball = drops < 60.0
        bands["crownBall"].append(depth[ball].max() if ball.any() else 0.0)
        bands["belowBall"].append(depth[~ball].max() if (~ball).any()
                                  else 0.0)
        per[family] = {
            "maxDepthMm": round(float(depth.max()), 2),
            "violating": int((sdf < -TOL_MM).sum()),
            "samples": int(sdf.shape[0]),
            "minSdfMm": round(float(sdf.min()), 2),
            "belowBallMaxMm": round(float(bands["belowBall"][-1]), 2),
            "belowBallViol": int(((sdf < -TOL_MM) & ~ball).sum()),
        }
        all_depths.append(depth.max())
        all_viol += per[family]["violating"]
    return {"perFamily": per, "maxDepthMm": round(float(max(all_depths)), 2),
            "violating": int(all_viol), "tolMm": TOL_MM,
            "crownBallMaxMm": round(float(max(bands["crownBall"])), 2),
            "belowBallMaxMm": round(float(max(bands["belowBall"])), 2)}


def collide_exact(cage, spec, egrid, tol_mm=0.0):
    """Sample every centreline + both edges at <= 2 mm against the EXACT
    field (mm, negative inside). Violation = penetration beyond tol_mm
    (default 0.0: the exact field has no voxel inflation, so scalp-riding
    roots at +1..3 mm read clean). Keeps the drop<60 crown-ball vs
    below-ball breakdown for continuity with the cage0 report; the gate
    reads belowBall + the root-standoff rule (exact.root_standoff).
    """
    crown = spec["crown"]
    crown_mm = np.array(crown, dtype=np.float64) * 1000.0
    per, all_depths, all_viol = {}, [], 0
    bands = {"crownBall": [], "belowBall": []}
    for family in sorted(cage):
        rib = cage[family]
        lines = [rib["centre_head"], rib["left_head"], rib["right_head"]]
        pts = resample_lines(lines, crown, 2.0)
        head = pts * 1000.0
        drops = crown_mm[2] - head[:, 2]
        sdf = EXACT.query_exact(egrid, head)
        depth = np.maximum(-sdf - tol_mm, 0.0)
        ball = drops < 60.0
        bands["crownBall"].append(depth[ball].max() if ball.any() else 0.0)
        bands["belowBall"].append(depth[~ball].max() if (~ball).any()
                                   else 0.0)
        per[family] = {
            "maxDepthMm": round(float(depth.max()), 2),
            "violating": int((sdf < -tol_mm).sum()),
            "samples": int(sdf.shape[0]),
            "minSdfMm": round(float(sdf.min()), 2),
            "belowBallMaxMm": round(float(bands["belowBall"][-1]), 2),
            "belowBallViol": int(((sdf < -tol_mm) & ~ball).sum()),
        }
        all_depths.append(depth.max())
        all_viol += per[family]["violating"]
    return {"perFamily": per, "maxDepthMm": round(float(max(all_depths)), 2),
            "violating": int(all_viol), "tolMm": float(tol_mm),
            "field": "exact",
            "crownBallMaxMm": round(float(max(bands["crownBall"])), 2),
            "belowBallMaxMm": round(float(max(bands["belowBall"])), 2)}


def front_hems_perside(mask, centre_col=513.0):
    """Per-side curtain hems in a registered front mask (target frame px).

    The mask is split at centre_col into a left half (cols < centre) and
    a right half (cols >= centre). Each side's hem is measured on its own
    half only: hem row = lowest row with hair px in that half, hem col =
    median column of the hair px AT that lowest row.

    The two sides are NEVER averaged: averaging the lowest rows/columns
    of both curtains lands on the image midline (face/neck), which holds
    no curtain hair, so a ray through the averaged pixel cannot meet
    either curtain in 3D (cage1 split-hem artefact: column 512.8 =
    image centre, triangulated X = 0.0047 m = head midline).
    """
    mask = np.asarray(mask, dtype=bool)
    out = {}
    for side, half in (("L", mask[:, :int(centre_col)]),
                       ("R", mask[:, int(centre_col):])):
        rr, cc = np.nonzero(half)
        if rr.size == 0:
            out[side] = {"pixel": None, "nHalfPx": 0}
            continue
        hem_row = int(rr.max())
        at = np.nonzero(half[hem_row])[0]
        base = 0 if side == "L" else int(centre_col)
        hem_col = float(np.median(at + base))
        out[side] = {
            "pixel": [float(hem_row), round(hem_col, 1)],
            "nHalfPx": int(half.sum()),
            "nHemRowPx": int(at.size),
            "hemRowSpan": [int(at.min() + base), int(at.max() + base)],
        }
    return out


def pixel_ray(cam, col, row, sensor):
    """World-space ray (origin m, unit dir) through a render-frame pixel."""
    mat = np.array(cam["matrixWorld"], dtype=np.float64)
    rot = mat[:3, :3]
    origin = np.array(cam["location"], dtype=np.float64)
    focal = float(cam["lensMm"]) / float(sensor) * FRAME
    local = np.array([(col - FRAME / 2.0) / focal,
                      -(row - FRAME / 2.0) / focal, -1.0])
    direction = rot @ local
    return origin, direction / np.linalg.norm(direction)


def split_hem_rays(target_profile, cams, cage, transforms):
    """Separate curtain vs back-sheet hem pixels in the profile target mask.

    Rule: anterior band = columns within [menton_col-120, menton_col+40]
    where menton_col is the projected menton column in the render frame
    mapped to the target frame; posterior band = columns within
    [backhead_col-40, backhead_col+120] around the projected posterior
    head-surface column at drop 170. Hem pixel = median column of mask
    pixels in the lowest 5 rows present in the band, at the lowest row.
    Each hem pixel is unprojected along its pinned-camera ray; the report
    carries the pixel, the ray, and the matching cage hem endpoint (3D
    height z + U offset) with the ray-to-point distance.
    """
    from cage import head_to_world
    sensor = sensor_of(cams)
    cam = cams["views"]["profile_90"]
    t = transforms["profile_90"]
    s = float(t["scale"])
    # anchor columns from the station frame projections
    frame = np.load("/tmp/station0b-run/station-frame.npz")
    crown = np.array(frame["point3d/crown"], dtype=np.float64)
    menton = np.array(frame["point3d/menton"], dtype=np.float64)

    def to_target_col(pt):
        c, _, _ = ENV.project_to_render(pt[None, :], cam, sensor)
        return float(s * c[0] + t["tx"])

    menton_col = to_target_col(menton)
    post_head = crown + np.array([0.0, 0.130, -0.170])
    post_col = to_target_col(post_head)
    bands = {
        "curtain": (menton_col - 120.0, menton_col + 40.0),
        "back": (post_col - 40.0, post_col + 120.0),
    }
    rows_all = np.nonzero(target_profile)[0]
    out = {"rule": "anterior band [menton_col-120, menton_col+40], "
                   "posterior band [posthead_col-40, posthead_col+120]; "
                   "hem = median col of mask px in lowest 5 band rows",
           "mentonCol": round(menton_col, 1),
           "postHeadCol": round(post_col, 1)}
    for key, fam in (("curtain", "temple_L"), ("back", "back")):
        c0, c1 = bands[key]
        cc = np.arange(FRAME)
        inband = (cc >= c0) & (cc < c1)
        sub = target_profile[:, inband]
        rr, _ = np.nonzero(sub)
        if rr.size == 0:
            out[key] = {"nBandPx": 0}
            continue
        top = rr.max() - 5
        sel = sub & (np.arange(FRAME)[:, None] >= top)
        pr, pc = np.nonzero(sel)
        hem_row = float(pr.max())
        band_cols = np.nonzero(inband)[0]
        hem_col = float(np.median(band_cols[pc[pr == pr.max()]]))
        # render-frame coords for the ray (invert the similarity)
        rc = (hem_col - float(t["tx"])) / s
        rr_ = (hem_row - float(t["ty"])) / s
        origin, direction = pixel_ray(cam, rc, rr_, sensor)
        end_head = np.asarray(
            cage[fam]["centre_head"][-1], dtype=np.float64)
        end_world = head_to_world(end_head[None, :], crown.tolist())[0]
        rel = end_world - origin
        along = float(rel @ direction)
        dist = float(np.linalg.norm(rel - along * direction))
        out[key] = {
            "hemPixel": [round(hem_row, 1), round(hem_col, 1)],
            "rayOriginM": [round(float(v), 4) for v in origin],
            "rayDir": [round(float(v), 5) for v in direction],
            "cageEndM": [round(float(v), 4) for v in end_world],
            "cageEndHeightMm": round(float(end_world[2]) * 1000.0, 1),
            "cageEndUMm": round(
                float((crown[1] - end_world[1]) * 1000.0), 1),
            "rayToEndMm": round(dist * 1000.0, 1),
            "nBandPx": int(sub.sum()),
        }
    return out
