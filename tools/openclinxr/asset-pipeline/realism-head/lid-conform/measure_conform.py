"""Gate scorer for lid-conform (tsk_83147b9cfdf9ab03). Read-only on GLBs/PNGs.

G1 ring sits on globe: ring1 (margin loop, topological) signed gap vs the
  globe MESH surface within [0.3, 1.0] mm every vertex; ring2/ring3 report.
C1 globe byte-identical: eye mesh POSITION arrays equal to base exactly.
C2 fissure width/height within 1 mm of base; absolute vs 28-30 x 8-11.
C3 face normal flips in the lid band (ring1..ring3 faces) must be 0.
G2 neon aperture edge (probe_aperture from neon_count.py, eyeglobe spike)
  < base at front, +-25, +-40 (needs --neon-base/--neon-new dirs).
G3 CW1 globe outside the frozen lid ring <= base every view (runs
  cw1-protrusion.py --base-glb base on both GLBs via import, same frozen
  ring the eyeglobe grid used).
G4 blink closure 1.0 + slit 1.0: geometric eye-px outside the closed lid
  ring (cw1 rasterizer at full closure, front) must be 0; dark-gap px with
  the shipped-blink-closure darkDef on eye-sheet blink PNGs
  (--blink-base/--blink-new PNG paths) must be <= base.

Usage:
  mise exec -- python3 measure_conform.py --base <base.glb> \\
    --new <aisha-lidconform.glb> --out conform-report.json \\
    [--neon-base DIR --neon-new DIR] [--blink-base PNG --blink-new PNG] \\
    [--bake-argv "..."] [--cw1-tool PATH]
"""
import argparse
import hashlib
import importlib.util
import json
import struct
import subprocess
import sys
import zlib
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import lid_conform_core as core  # noqa: E402

NEON_VIEWS = ["front", "yaw25", "yaw-25", "yaw40", "yaw-40"]


def sha256_file(path):
    h = hashlib.sha256()
    with open(str(path), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_png_rgb(path):
    with open(str(path), "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    off, w, h, depth, ctype, idat = 8, None, None, None, None, []
    while off + 8 <= len(data):
        (ln,) = struct.unpack(">I", data[off:off + 4])
        typ = data[off + 4:off + 8]
        if typ == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", data[off + 8:off + 18])
        elif typ == b"IDAT":
            idat.append(data[off + 8:off + 8 + ln])
        elif typ == b"IEND":
            break
        off += 12 + ln
    chans = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    assert depth == 8
    raw = zlib.decompress(b"".join(idat))
    stride = w * chans
    out = bytearray(stride * h)
    mv = memoryview(out)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        cur = mv[y * stride:(y + 1) * stride]
        for x in range(stride):
            rb = raw[p + x]
            a = cur[x - chans] if x >= chans else 0
            b = prev[x]
            cc = prev[x - chans] if x >= chans else 0
            if f == 0:
                v = rb
            elif f == 1:
                v = rb + a
            elif f == 2:
                v = rb + b
            elif f == 3:
                v = rb + ((a + b) >> 1)
            else:
                pa, pb, pc = abs(b - cc), abs(a - cc), abs(a + b - 2 * cc)
                v = rb + (a if pa <= pb and pa <= pc else (b if pb <= pc else cc))
            cur[x] = v & 0xFF
        p += stride
        prev = bytearray(cur)
    import numpy as np  # noqa: E402

    arr = np.frombuffer(bytes(out), dtype=np.uint8).reshape(h, w, chans)
    return arr[:, :, :3].astype(float)


def is_magenta(px):
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    return (r > 150) & (b > 150) & (g < 120) & (abs(r - b) < 120)


def is_blue(px):
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    return (b > 150) & (r < 120) & (g < 120)


def is_cyan(px):
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    return (g > 150) & (b > 150) & (r < 120)


def probe_aperture(img):
    """neon_count.py probe_aperture ported to arrays (same predicate set)."""
    import numpy as np  # noqa: E402

    h, w, _ = img.shape
    mag = is_magenta(img)
    mag_cols = np.nonzero(mag.any(axis=0))[0]
    if not len(mag_cols):
        return {"magentaPx": 0, "blueInside": 0}
    total_mag = int(mag.sum())
    gaps = np.diff(mag_cols)
    bi = int(np.argmax(gaps)) if len(gaps) else -1
    clusters = [mag_cols[:bi + 1], mag_cols[bi + 1:]] if bi >= 0 else [mag_cols]
    ys, _xs = np.nonzero(mag)
    y_lo = max(0, int(ys.min()) - 40)
    y_hi = min(h - 1, int(ys.max()) + 40)
    cyan = is_cyan(img)
    row_span = {}
    for y in range(y_lo, y_hi + 1):
        xs_c = np.nonzero(cyan[y])[0]
        if len(xs_c) and xs_c.max() - xs_c.min() >= 8:
            row_span[y] = (int(xs_c.min()), int(xs_c.max()))
    col_span = {}
    for x in range(w):
        ys_c = np.nonzero(cyan[y_lo:y_hi + 1, x])[0]
        if len(ys_c) and ys_c.max() - ys_c.min() >= 8:
            col_span[x] = (y_lo + int(ys_c.min()), y_lo + int(ys_c.max()))
    blue = is_blue(img)
    total_blue = 0
    per = {}
    for tag, cl in zip(("c0", "c1"), clusters):
        if not len(cl):
            per[tag] = 0
            continue
        x0, x1 = int(cl.min()) - 30, int(cl.max()) + 30
        n = 0
        for y, rs in row_span.items():
            xa, xb = max(x0, rs[0]), min(x1, rs[1])
            if xb < xa:
                continue
            for x in range(xa, xb + 1):
                cs = col_span.get(x)
                if cs is None or not (cs[0] < y < cs[1]):
                    continue
                if blue[y, x]:
                    n += 1
        per[tag] = n
        total_blue += n
    return {"magentaPx": total_mag, "blueInside": int(total_blue),
            "perCluster": per}


def dark_gap_px(png_path):
    """shipped-blink-closure darkDef on the eye band (x.30-.70 y.47-.60).

    darkDef (closure-report.json darkDef): luminance < 0.35 * skinMedian
    (same frame band) AND local 5x5 std < 6.0.
    """
    import numpy as np  # noqa: E402

    img = read_png_rgb(png_path)
    h, w, _ = img.shape
    x0, x1 = int(w * 0.30), int(w * 0.70)
    y0, y1 = int(h * 0.47), int(h * 0.60)
    band = img[y0:y1, x0:x1]
    lum = 0.2126 * band[..., 0] + 0.7152 * band[..., 1] + 0.0722 * band[..., 2]
    med = float(np.median(lum))
    from numpy.lib.stride_tricks import sliding_window_view

    win = sliding_window_view(lum, (5, 5))
    std = np.zeros_like(lum)
    std[2:-2, 2:-2] = win.std(axis=(-2, -1))
    dark = (lum < 0.35 * med) & (std < 6.0)
    return {"darkPx": int(dark.sum()), "skinMedian": round(med, 2),
            "bandPx": int(band.shape[0] * band.shape[1])}


def load_cw1(path):
    spec = importlib.util.spec_from_file_location("cw1_mod", str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_cw1(cw1, glb, base_glb, out_path, res_mm=0.12, box_mm=130.0):
    """CW1 + CW3 via the cw1-protrusion instrument (same frozen ring).

    Default res 0.12 mm/px = the eyeglobe grid reference (globe-fit
    report thresholds); the gate compares base vs new at equal res.
    """
    import numpy as np  # noqa: E402

    js, blob = cw1.load_glb(str(glb))
    worlds = cw1.node_worlds(js)
    body_name = "mpfb_ob_patient_aisha_body"
    eye_names = [
        "makeclothes_library_eyes_high_poly_globe_mpfb_ob_patient_aisha_mesh",
        "openclinxr_eye_cornea_high_poly_left_mpfb_ob_patient_aisha_mesh",
        "openclinxr_eye_cornea_high_poly_right_mpfb_ob_patient_aisha_mesh",
    ]
    body, body_idx = cw1.skin_mesh(js, blob, worlds, body_name)
    eyes = [cw1.skin_mesh(js, blob, worlds, n) for n in eye_names]
    cornea = {m: pts for m, (pts, _) in zip(eye_names[1:], eyes[1:])}
    cen = {m: pts.mean(axis=0) for m, pts in cornea.items()}
    left_name = min(cen, key=lambda m: cen[m][0])
    globe_pts = eyes[0][0]
    d = {m: np.linalg.norm(globe_pts - cen[m], axis=1) for m in cen}
    sides = {}
    for m in cen:
        o = [k for k in cen if k != m][0]
        sides["L" if m == left_name else "R"] = np.concatenate(
            [cornea[m], globe_pts[d[m] < d[o]]])
    centres, radii = {}, {}
    for tag, pts in sides.items():
        c, r = cw1.fit_sphere(pts)
        centres[tag], radii[tag] = c, r
    head = (centres["L"] + centres["R"]) / 2.0
    res = res_mm
    W = H = int(box_mm / res)
    origin = np.array([-box_mm / 2.0, -box_mm / 2.0])
    views = {"front": 0.0, "yaw25": 25.0, "yaw-25": -25.0,
             "yaw40": 40.0, "yaw-40": -40.0}

    def frame(body_pts, rings):
        out = {}
        up = np.array([0.0, 1.0, 0.0])
        for vname, deg in views.items():
            th = np.radians(deg)
            v = np.array([-np.sin(th), 0.0, -np.cos(th)])
            u = np.cross(v, up)
            u = u / np.linalg.norm(u)
            w = np.cross(u, v)
            b_uv = cw1.project(body_pts, u, w, v, head)
            e_uv = [cw1.project(e[0], u, w, v, head) for e in eyes]
            e_idx = [e[1] for e in eyes]
            depth = np.full((H, W), -np.inf)
            ids = np.zeros((H, W), dtype=np.int8)
            keep = np.linalg.norm(body_pts - head, axis=1) < 0.045
            btris = b_uv[body_idx.reshape(-1, 3)]
            cull = keep[body_idx.reshape(-1, 3)].all(axis=1)
            cw1.rasterize(btris[cull], res, origin, (W, H), depth, ids, 1)
            for uv, ix in zip(e_uv, e_idx):
                cw1.rasterize(uv[ix.reshape(-1, 3)], res, origin, (W, H),
                              depth, ids, 2)

            def ring_mask(band_world):
                proj = cw1.project(band_world, u, w, v, head)[:, :2]
                ec = cw1.project(centres[tag][None, :], u, w, v,
                                 head)[0][:2]
                ang = np.arctan2(proj[:, 1] - ec[1], proj[:, 0] - ec[0])
                return cw1.fill_polygon(proj[np.argsort(ang)], res, origin,
                                        (W, H))

            per = {}
            for tag in ("L", "R"):
                mask = ring_mask(rings[tag])
                per[tag] = {"openingPx": int(mask.sum()),
                            "cw1Px": 0,
                            "edgeRPx": int(((ids == 1) & mask).sum())}
            ys, xss = np.nonzero(ids == 2)
            if len(xss):
                cLu = float((centres["L"] - head) @ u) * 1000.0
                cRu = float((centres["R"] - head) @ u) * 1000.0
                xu = xss * res + origin[0]
                side = np.where(np.abs(xu - cLu) < np.abs(xu - cRu),
                                "L", "R")
                for tag in ("L", "R"):
                    m = ring_mask(rings[tag])
                    sel = side == tag
                    per[tag]["cw1Px"] = int((~m[ys[sel], xss[sel]]).sum())
            out[vname] = per
        return out

    bjs, bblob = cw1.load_glb(str(base_glb))
    bworlds = cw1.node_worlds(bjs)
    bbody, _ = cw1.skin_mesh(bjs, bblob, bworlds, body_name)
    beyes = [cw1.skin_mesh(bjs, bblob, bworlds, n) for n in eye_names]
    bcornea = {m: pts for m, (pts, _) in zip(eye_names[1:], beyes[1:])}
    bcen = {m: pts.mean(axis=0) for m, pts in bcornea.items()}
    bleft = min(bcen, key=lambda m: bcen[m][0])
    bglobe = beyes[0][0]
    bd = {m: np.linalg.norm(bglobe - bcen[m], axis=1) for m in bcen}
    bring_idx = {}
    for m in bcen:
        o = [k for k in bcen if k != m][0]
        tag = "L" if m == bleft else "R"
        pts = np.concatenate([bcornea[m], bglobe[bd[m] < bd[o]]])
        c, r = cw1.fit_sphere(pts)
        _, idx = cw1.lid_loop(bbody, c, r)
        bring_idx[tag] = idx
    rings_neutral = {tag: body[bring_idx[tag]] for tag in ("L", "R")}
    frames = frame(body, rings_neutral)
    morph = {"eye-left-closure": 0.5, "eye-right-closure": 0.5}
    body_blink, _ = cw1.skin_mesh(js, blob, worlds, body_name,
                                  morph_weights=morph)
    rings_blink = {tag: body_blink[bring_idx[tag]] for tag in ("L", "R")}
    blink = frame(body_blink, rings_blink)
    # G4 geometric: full closure 1.0 + slit 1.0, front view only.
    closed = {"eye-left-closure": 1.0, "eye-right-closure": 1.0,
              "eye-left-slit": 1.0, "eye-right-slit": 1.0}
    body_closed, _ = cw1.skin_mesh(js, blob, worlds, body_name,
                                   morph_weights=closed)
    rings_closed = {tag: body_closed[bring_idx[tag]] for tag in ("L", "R")}
    full = frame(body_closed, rings_closed)
    mesh = next(m for m in js["meshes"] if m.get("name") == body_name)
    names = mesh.get("extras", {}).get("targetNames", [])
    prim = mesh["primitives"][0]
    pool = np.zeros(len(body), dtype=bool)
    for tname in ("eye-left-closure", "eye-right-closure"):
        if tname in names:
            tgt = prim["targets"][names.index(tname)]
            dd = cw1.accessor(js, blob, tgt["POSITION"]).astype(float)
            pool |= np.abs(dd).max(axis=1) > 1e-9
    lid_plane_z = float(body_closed[pool][:, 2].mean())
    apex = {tag: float(sides[tag][:, 2].max()) for tag in ("L", "R")}
    cw3max = max((apex[t] - lid_plane_z) * 1000.0 for t in ("L", "R"))
    cw1sum = {v: sum(frames[v][t]["cw1Px"] for t in ("L", "R"))
              for v in views}
    cw1sum["blink0.5"] = sum(blink["front"][t]["cw1Px"] for t in ("L", "R"))
    full_closed = sum(full["front"][t]["cw1Px"] for t in ("L", "R"))
    rep = {"cw1": cw1sum, "cw3maxMm": round(float(cw3max), 3),
           "closed10FrontGlobePx": int(full_closed),
           "edge": {v: sum(frames[v][t]["edgeRPx"] for t in ("L", "R"))
                    for v in views}}
    with open(str(out_path), "w") as f:
        json.dump(rep, f, indent=1)
    return rep


def main():
    import numpy as np  # noqa: E402

    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--neon-base", default=None)
    ap.add_argument("--neon-new", default=None)
    ap.add_argument("--blink-base", default=None)
    ap.add_argument("--blink-new", default=None)
    ap.add_argument("--bake-argv", default="")
    ap.add_argument("--cw1-tool", required=True)
    ap.add_argument("--cw1-res", type=float, default=0.12)
    ap.add_argument("--target-width", type=float, default=27.7)
    ap.add_argument("--c4-radius", type=float, default=8.0)
    ap.add_argument("--store-dir", default="")
    args = ap.parse_args()

    report = {"tool": str(Path(__file__).name),
              "bakeArgv": args.bake_argv,
              "baseGlb": {"path": args.base,
                          "sha256": sha256_file(args.base)},
              "newGlb": {"path": args.new,
                         "sha256": sha256_file(args.new)}}

    loaded = {}
    for tag, path in (("base", args.base), ("new", args.new)):
        js, blob = core.load_glb(path)
        worlds = core.node_worlds(js)
        body, body_idx = core.skin_mesh(js, blob, worlds, core.BODY_NAME)
        tris = body_idx.reshape(-1, 3)
        sides = core.eye_sides(js, blob, worlds)
        centres = {}
        for t, pts in sides.items():
            c, r, rms = core.fit_sphere_kasa(pts)
            centres[t] = (c, r, rms)
        # per-side eye surface soup (globe + nearer cornea)
        globe_all, globe_idx = core.skin_mesh(js, blob, worlds,
                                              core.GLOBE_NAME)
        gtris = globe_idx.reshape(-1, 3)
        cor = [core.skin_mesh(js, blob, worlds, n)
               for n in core.CORNEA_NAMES]
        soup = {}
        for t in ("L", "R"):
            parts = [globe_all[gtris][
                np.linalg.norm(
                    globe_all[gtris].mean(axis=1) - centres[t][0],
                    axis=1)
                < np.linalg.norm(
                    globe_all[gtris].mean(axis=1)
                    - centres["R" if t == "L" else "L"][0], axis=1)]]
            for cpts, cidx in cor:
                dc = np.linalg.norm(cpts.mean(axis=0) - centres[t][0])
                do = np.linalg.norm(
                    cpts.mean(axis=0) - centres["R" if t == "L" else "L"][0])
                if dc < do:
                    parts.append(cpts[cidx.reshape(-1, 3)])
            soup[t] = np.concatenate(parts)
        loaded[tag] = {"js": js, "blob": blob, "body": body, "tris": tris,
                       "sides": sides, "centres": centres, "soup": soup}

    base, new = loaded["base"], loaded["new"]
    assert base["body"].shape == new["body"].shape, \
        "body vert count differs base vs new"
    assert base["tris"].shape == new["tris"].shape, \
        "body tri count differs base vs new"

    # G1 + ring reports on the NEW bake.
    g1, rings_new = {}, {}
    for t in ("L", "R"):
        c = new["centres"][t][0]
        rings = core.derive_eye_rings(new["body"], new["tris"], c)
        rings_new[t] = rings
        for rname in ("ring1", "ring2", "ring3"):
            gap = core.signed_gap_to_mesh(new["body"][rings[rname]], c,
                                          new["soup"][t])
            finite = gap[np.isfinite(gap)]
            assert len(finite) == len(rings[rname]), \
                f"{t} {rname}: {len(rings[rname])-len(finite)} ray misses"
            g1[f"{t}.{rname}"] = {
                "n": len(finite), "min": round(float(finite.min()), 3),
                "med": round(float(np.median(finite)), 3),
                "max": round(float(finite.max()), 3)}
    g1pass = all(g1[f"{t}.ring1"][k] >= 0.3 and g1[f"{t}.ring1"][k] <= 1.0
                 for t in ("L", "R") for k in ("min", "med", "max"))
    report["g1"] = {"gapsMm": g1, "pass": bool(g1pass)}

    # C1: eye POSITION arrays exactly equal.
    c1 = {}
    for name in (core.GLOBE_NAME,) + core.CORNEA_NAMES:
        for tag, ld in (("base", base), ("new", new)):
            mesh = next(m for m in ld["js"]["meshes"]
                        if m.get("name") == name)
            prim = mesh["primitives"][0]
            pos = core.accessor(
                ld["js"], ld["blob"], prim["attributes"]["POSITION"])
            c1.setdefault(name, {})[tag] = hashlib.sha256(
                np.ascontiguousarray(pos).tobytes()).hexdigest()
    c1pass = all(v["base"] == v["new"] for v in c1.values())
    report["c1"] = {"positionSha256": c1, "pass": bool(c1pass)}

    # C2 (H1): fissure width within 1 mm of TARGET, height in [8, 11].
    c2 = {}
    for t in ("L", "R"):
        for tag, ld in (("base", base), ("new", new)):
            c = ld["centres"][t][0]
            rings = core.derive_eye_rings(ld["body"], ld["tris"], c)
            fis = core.fissure_dims(ld["body"][rings["ring1"]])
            c2.setdefault(t, {})[tag] = fis
    c2pass = all(abs(c2[t]["new"]["widthMm"] - args.target_width) <= 1.0
                 and 8.0 <= c2[t]["new"]["heightMm"] <= 11.0
                 for t in ("L", "R"))
    report["c2"] = {"fissureMm": c2, "targetWidthMm": args.target_width,
                    "pass": bool(c2pass)}

    # C3/C4 (H1): the exported body is fragmented into islands (measured
    # 48 components), so no BFS depth reaches the canthus patches -- the
    # lid band is SPATIAL: verts within c4-radius mm of either bake's
    # ring1. C3 counts flips on band faces; C4 demands everything outside
    # byte-identical (brow/cheek unmoved). The lash mesh is reported
    # separately (permitted to follow the margin).
    ringU = []
    for t in ("L", "R"):
        for ld in (base, new):
            c = ld["centres"][t][0]
            rings = core.derive_eye_rings(ld["body"], ld["tris"], c)
            ringU.append(ld["body"][rings["ring1"]])
    ringU = np.concatenate(ringU)
    dmin = np.linalg.norm(
        base["body"][:, None, :] - ringU[None, :, :], axis=2).min(axis=1)
    c4band = set(int(v) for v in np.nonzero(
        dmin * 1000.0 <= args.c4_radius)[0])
    # C3 over the SPATIAL band faces (BFS misses disconnected islands).
    flips, nfaces = core.count_flips(base["body"], new["body"],
                                     base["tris"], c4band)
    report["c3"] = {"flips": flips, "bandFaces": nfaces,
                    "pass": flips == 0}
    out_idx = np.array([i for i in range(len(base["body"]))
                        if i not in c4band])
    outside_moved = (base["body"][out_idx] != new["body"][out_idx]).any(
        axis=1)
    c4pass = not bool(outside_moved.any())
    lash_name = ("openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_"
                 "ob_patient_aisha_mesh")

    def _lash_pos(ld):
        mesh = next(m for m in ld["js"]["meshes"]
                    if m.get("name") == lash_name)
        prim = mesh["primitives"][0]
        return np.asarray(core.accessor(
            ld["js"], ld["blob"], prim["attributes"]["POSITION"]),
            dtype=float)

    _lp = {tag: _lash_pos(ld) for tag, ld in (("base", base),
                                              ("new", new))}
    _ld = np.linalg.norm(_lp["new"] - _lp["base"], axis=1) * 1000.0
    lash_stat = {
        "n": int(_lp["base"].shape[0]),
        "baseSha256": hashlib.sha256(
            np.ascontiguousarray(_lp["base"]).tobytes()).hexdigest(),
        "maxMoveMm": round(float(_ld.max()), 3),
        "medMoveMm": round(float(np.median(_ld)), 3)}
    report["c4"] = {"bandVerts": len(c4band),
                    "bandRadiusMm": args.c4_radius,
                    "bodyVerts": int(len(base["body"])),
                    "outsideMovedVerts": int(outside_moved.sum()),
                    "lash": lash_stat, "pass": bool(c4pass)}

    # G3 (+CW3 + closed-1.0 geometry): cw1 instrument on both.
    cw1 = load_cw1(args.cw1_tool)
    cw1b = run_cw1(cw1, args.base, args.base, Path(args.out).parent
                   / "cw1-lidconform-base.json", res_mm=args.cw1_res)
    cw1n = run_cw1(cw1, args.new, args.base, Path(args.out).parent
                   / "cw1-lidconform-new.json", res_mm=args.cw1_res)
    views = list(NEON_VIEWS) + ["blink0.5"]
    g3pass = all(cw1n["cw1"][v] <= cw1b["cw1"][v] * 1.01 for v in views)
    report["g3"] = {"base": cw1b, "new": cw1n, "pass": bool(g3pass),
                    "resMm": args.cw1_res}

    # G2: neon aperture edge.
    if args.neon_base and args.neon_new:
        g2 = {}
        for v in NEON_VIEWS:
            rb = probe_aperture(read_png_rgb(
                Path(args.neon_base) / f"neon-base-{v}-full.png"))
            rn = probe_aperture(read_png_rgb(
                Path(args.neon_new) / f"neon-new-{v}-full.png"))
            g2[v] = {"base": rb["blueInside"], "new": rn["blueInside"]}
        report["g2"] = {"edgePx": g2,
                        "pass": bool(all(g2[v]["new"] < g2[v]["base"]
                                         for v in NEON_VIEWS))}
    else:
        report["g2"] = {"edgePx": {}, "pass": None}

    # G4: closed-1.0 geometry (0 globe px) + dark gap vs base.
    g4geom = cw1n["closed10FrontGlobePx"] == 0
    report["g4"] = {"closed10FrontGlobePx": cw1n["closed10FrontGlobePx"],
                    "geometricPass": bool(g4geom)}
    if args.blink_base and args.blink_new:
        db = dark_gap_px(args.blink_base)
        dn = dark_gap_px(args.blink_new)
        report["g4"]["darkBase"] = db
        report["g4"]["darkNew"] = dn
        report["g4"]["darkPass"] = bool(dn["darkPx"] <= db["darkPx"])
        report["g4"]["pass"] = bool(g4geom and dn["darkPx"] <= db["darkPx"])
    else:
        report["g4"]["pass"] = None

    with open(args.out, "w") as f:
        json.dump(report, f, indent=1)
    print(json.dumps({
        "g1": report["g1"]["pass"], "c1": report["c1"]["pass"],
        "c2": report["c2"]["pass"],
        "c4": report["c4"]["pass"],
        "c3": report["c3"], "g3": report["g3"]["pass"],
        "g2": report["g2"]["pass"], "g4": report["g4"]["pass"]}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
