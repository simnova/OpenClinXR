"""Guide cage: spec -> centrelines -> ribbons.

Each family (part L/R, temple-curtain L/R, side L/R, back, nape) owns one
centreline: a 6-control-point clamped cubic B-spline rooted at an
attachment row on the head surface. The centreline is swept into a ribbon
with a width profile given at 3 arc stations (top s=0, mid s=0.5,
hem s=1.0; mid is the mean of top/hem unless a family fixes all three)
and a shared thickness.

Head frame (mm): X lateral, U anterior+, D drop below crown.
World (m): (X/1000, crown_y - U/1000, crown_z - D/1000).

Temple curtains take the fitted anterior offset at shoulder height (the
curtain_front_sh bound spans behind [-100] to front [+120] of the shoulder
plane; the fit, not the spec, decides); back and nape pass BEHIND it
(posterior offset). Side curtains clear the shoulder laterally. Mirrored
families (L/R) share every parameter; mirroring is exact (X -> -X).

Imports numpy only. Projection and SDF live in hair-groom (envelope,
register) and are imported by instruments.py, never here.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

FRAME = 1024
CENTRE_N = 61  # B-spline samples per centreline
SHOULDER_DROP = 255.0  # z = 1.405 m judge plane for crown_z = 1659.9 mm
CROWN_SPHERE_R = 90.0  # crown cap sphere radius (mm) for part roots/drape
SIDE_R = 80.0  # head-side cylinder radius (mm) for drape sagitta

# fixed width axes per family base, in (X, U) head-frame directions:
# part spans the crown across X; temple wraps the face corner (front-
# lateral, so front views see a band); side drapes the max-width plane
# (width along U, edge-on in front, full band in profile); back/nape
# span X behind the head.
WIDTH_AXIS = {
    "part": (1.0, 0.0),
    "temple": (0.8, 0.6),
    "side": (0.0, 1.0),
    "back": (1.0, 0.0),
    "nape": (1.0, 0.0),
}

# name: (init, lo, hi, unit). 22 parameters, max 24 (spec v4).
PARAM_ORDER = (
    "crown_lift",
    "part_angle",
    "cap_span",
    "part_w_top",
    "part_w_hem",
    "curtain_hem_drop",
    "curtain_front_sh",
    "curtain_ear_u",
    "curtain_w_top",
    "curtain_w_hem",
    "side_hem_drop",
    "side_out_sh",
    "side_w_top",
    "side_w_hem",
    "back_hem_drop",
    "back_post_sh",
    "back_w_top",
    "back_w_hem",
    "nape_hem_drop",
    "nape_post_sh",
    "nape_width",
    "thickness",
)
DEFAULTS = {
    # Anatomy-chosen defaults (documented in the spec; not tuned to masks):
    # crown_lift ~ scalp-to-hair standoff above the crown sphere; part_angle
    # ~ centre-part splay; cap_span ~ half head width at crown; hem drops put
    # the curtain ends just below the shoulder plane (drop 255), the back
    # sheet mid-back, and the side pieces AT the shoulder (length is carried
    # by curtain/back, which pass in front of / behind the shoulder while a
    # mid-side sheet would cross the torso and arms); curtain U (60 at the
    # temple, 46 at the shoulder) hangs the lock beside the cheek, clear of
    # the brow plane (U~95) and the chest front (+20); shoulder offsets clear
    # the torso surface read off body slabs (front +20 mm / back -77 mm at
    # drop 255; chest front reaches +60 by drop 350, midline back -110) by
    # >15 mm; widths match a full straight style (narrow part strips,
    # angled temple bands, wide back sheet).
    # SPEC V4 changes (cage1; diff in hair-cage1/RESULT.txt): part families
    # widened into crown sheets (cap_span init/hi, part widths) so the
    # cranium can be covered (cage0 crown miss 20-28 px); curtain_front_sh
    # lo extended behind the shoulder plane (fit decides front vs behind);
    # curtain_hem_drop lo shortened for the short target front (F2 row 344)
    # and back_hem_drop hi lengthened for the long target back (row ~870);
    # crown_lift re-anchored to the root-standoff rule (every root 1-3 mm
    # off the scalp by the exact field).
    "crown_lift": (2.0, 0.5, 8.0, "mm"),
    "part_angle": (25.0, 0.0, 60.0, "deg"),
    "cap_span": (75.0, 40.0, 120.0, "mm"),
    "part_w_top": (36.0, 10.0, 80.0, "mm"),
    "part_w_hem": (32.0, 10.0, 80.0, "mm"),
    "curtain_hem_drop": (320.0, 180.0, 480.0, "mm"),
    "curtain_front_sh": (46.0, -100.0, 120.0, "mm"),
    "curtain_ear_u": (60.0, 20.0, 110.0, "mm"),
    "curtain_w_top": (44.0, 20.0, 90.0, "mm"),
    "curtain_w_hem": (40.0, 20.0, 110.0, "mm"),
    "side_hem_drop": (250.0, 230.0, 480.0, "mm"),
    "side_out_sh": (10.0, 0.0, 120.0, "mm"),
    "side_w_top": (70.0, 30.0, 120.0, "mm"),
    "side_w_hem": (80.0, 30.0, 120.0, "mm"),
    "back_hem_drop": (380.0, 280.0, 600.0, "mm"),
    "back_post_sh": (-110.0, -160.0, -10.0, "mm"),
    "back_w_top": (110.0, 60.0, 180.0, "mm"),
    "back_w_hem": (150.0, 80.0, 220.0, "mm"),
    "nape_hem_drop": (340.0, 280.0, 480.0, "mm"),
    "nape_post_sh": (-115.0, -140.0, -5.0, "mm"),
    "nape_width": (80.0, 40.0, 140.0, "mm"),
    "thickness": (3.0, 1.0, 8.0, "mm"),
}

# attachment rows: (drop_mm, signed_azimuth_deg from anterior +U, +X right).
# Mirrored families resolve +az then mirror X. Elevation is implied by the
# drop (recorded per row in the spec as -atan(drop / radial)).
ATTACH_ROWS = {
    "part": (10.0, 12.0),
    "temple": (70.0, 55.0),
    "side": (90.0, 85.0),
    "back": (60.0, 180.0),
    "nape": (150.0, 180.0),
}

FAMILIES = (
    "part_L", "part_R",
    "temple_L", "temple_R",
    "side_L", "side_R",
    "back", "nape",
)
# family -> display group for renders (mirrors share one colour)
FAMILY_GROUP = {
    "part_L": "part", "part_R": "part",
    "temple_L": "temple", "temple_R": "temple",
    "side_L": "side", "side_R": "side",
    "back": "back", "nape": "nape",
}


def default_values():
    return [float(DEFAULTS[n][0]) for n in PARAM_ORDER]


def _deboor_point(ctrl, knots, u, p=3):
    n = len(ctrl) - 1
    if u >= knots[n + 1]:
        i = n
    else:
        i = max(k for k in range(p, n + 1) if knots[k] <= u)
    d = [np.array(ctrl[j], dtype=np.float64) for j in range(i - p, i + 1)]
    for r in range(1, p + 1):
        for j in range(p, r - 1, -1):
            denom = knots[i + 1 + j - r] - knots[i - p + j]
            a = 0.0 if denom == 0.0 else (u - knots[i - p + j]) / denom
            d[j] = (1.0 - a) * d[j - 1] + a * d[j]
    return d[p]


def bspline(ctrl, n=CENTRE_N):
    """Clamped uniform cubic B-spline through 6 control points -> (n,3)."""
    ctrl = [np.asarray(c, dtype=np.float64) for c in ctrl]
    assert len(ctrl) == 6, "cage centrelines use exactly 6 control points"
    knots = [0.0, 0.0, 0.0, 0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0, 1.0, 1.0, 1.0]
    out = np.zeros((n, 3), dtype=np.float64)
    for k, u in enumerate(np.linspace(0.0, 1.0, n)):
        out[k] = _deboor_point(ctrl, knots, float(u))
    return out


def interp_anchor(anchors, drop, col):
    drops = np.array([row[0] for row in anchors], dtype=np.float64)
    vals = np.array([row[col] for row in anchors], dtype=np.float64)
    return float(np.interp(drop, drops, vals))


def control_points(family, p, attach, anchors):
    """Six (X, U, D) head-frame control points for one family centreline.

    attach: dict family-base -> (X, U, D) resolved surface point.
    anchors: head-section table for lateral half-width lookup.
    P0 (the root) sits on the measured attachment raised by crown_lift,
    so the root inherits an on-scalp position and the lift sets the
    1-3 mm exact-field standoff (verified, not assumed). Drape rules
    from P1 on: part rides the crown sphere (drop = r^2/2R + lift);
    temple/side stand off the max-width line (surfX + offset) so the
    sheet grazes the surface instead of crossing it; back/nape run the
    posterior midline behind the surface; below-shoulder points hold the
    shoulder planform (anchors stop at drop 260).
    """
    base = FAMILY_GROUP[family]
    side = -1.0 if family.endswith("_L") else 1.0
    lift = p["crown_lift"]
    surfX = lambda d: interp_anchor(anchors, min(d, 260.0), 1)  # noqa: E731

    def root_lift(pts):
        pts = [list(q) for q in pts]
        pts[0][2] -= lift
        pts[1][2] -= lift
        pts[2][2] -= 0.5 * lift
        return pts

    if base == "part":
        xa, ua, da = attach["part"]
        k = 0.5 + p["part_angle"] / 45.0
        cap = p["cap_span"]
        f = (0.13, 0.33, 0.50, 0.60, 0.63, 0.63)
        uu = (ua, 0.6 * ua, 0.1 * ua, -12.0, -25.0, -38.0)
        pts = [[xa, ua, da]]  # P0: measured attachment + lift (standoff)
        for i in range(1, 6):
            x = side * cap * f[i] * k
            r = float(np.hypot(x, uu[i]))
            pts.append([x, uu[i], r * r / (2.0 * CROWN_SPHERE_R) + lift])
        pts = root_lift(pts)
        pts[0] = [xa, ua, da - lift]
        return pts
    if base == "temple":
        xa, ua, da = attach["temple"]
        fs, eu = p["curtain_front_sh"], p["curtain_ear_u"]
        hem = p["curtain_hem_drop"]
        mid = 255.0 + 0.6 * (hem - 255.0)
        sched = [(70.0, eu), (110.0, eu), (170.0, 0.5 * (eu + fs)),
                 (255.0, fs), (mid, fs + 12.0), (hem, fs + 15.0)]
        pts = [(side * (surfX(d) + 14.0), u, d) for d, u in sched]
        pts = root_lift(pts)
        pts[0] = [side * abs(xa), ua, da - lift]  # P0: attachment + lift
        return pts
    if base == "side":
        _, ua, _ = attach["side"]
        os = p["side_out_sh"]
        hem = p["side_hem_drop"]
        sched = [(90.0, ua), (130.0, 0.7 * ua), (170.0, 0.4 * ua),
                 (220.0, -8.0), (0.5 * (220.0 + hem), -12.0), (hem, -15.0)]
        pts = [(side * (surfX(d) + os), u, d) for d, u in sched]
        return root_lift(pts)
    if base == "back":
        xa, ua, da = attach["back"]
        ps = p["back_post_sh"]
        hem = p["back_hem_drop"]
        mid = 255.0 + 0.6 * (hem - 255.0)
        sched = [(60.0, ua), (110.0, ua - 8.0), (170.0, 0.5 * (ua + ps)),
                 (255.0, ps), (mid, ps - 12.0), (hem, ps - 20.0)]
        pts = [(0.0, u, d) for d, u in sched]
        pts = root_lift(pts)
        pts[0] = [xa, ua, da - lift]  # P0: attachment + lift
        return pts
    if base == "nape":
        xa, ua, da = attach["nape"]
        ps = p["nape_post_sh"]
        hem = p["nape_hem_drop"]
        mid = 255.0 + 0.6 * (hem - 255.0)
        sched = [(150.0, ua - 18.0), (190.0, ua - 20.0),
                 (230.0, 0.5 * (ua + ps)), (255.0, ps),
                 (mid, ps - 8.0), (hem, ps - 12.0)]
        pts = [(0.0, u, d) for d, u in sched]
        pts = root_lift(pts)
        pts[0] = [xa, ua, da - lift]  # P0: attachment + lift
        return pts
    raise ValueError("unknown family %r" % family)


def family_widths(base, p):
    """(w_top, w_mid, w_hem) mm at arc stations s = 0, 0.5, 1.0."""
    if base == "part":
        wt, wh = p["part_w_top"], p["part_w_hem"]
    elif base == "temple":
        wt, wh = p["curtain_w_top"], p["curtain_w_hem"]
    elif base == "side":
        wt, wh = p["side_w_top"], p["side_w_hem"]
    elif base == "back":
        wt, wh = p["back_w_top"], p["back_w_hem"]
    elif base == "nape":
        wt = wh = p["nape_width"]
    else:
        raise ValueError(base)
    return (float(wt), 0.5 * (float(wt) + float(wh)), float(wh))


def head_to_world(pts_head, crown):
    pts = np.asarray(pts_head, dtype=np.float64)
    world = np.empty_like(pts)
    world[:, 0] = pts[:, 0] / 1000.0
    world[:, 1] = float(crown[1]) - pts[:, 1] / 1000.0
    world[:, 2] = float(crown[2]) - pts[:, 2] / 1000.0
    return world


def build_ribbon(centre_head, widths, thickness, crown, width_axis):
    """Sweep a centreline into a closed ribbon solid (world metres).

    Frame: the ribbon width lies along the family's fixed horizontal axis
    (head frame (ax_X, ax_U), D-component 0), projected perpendicular to
    the tangent so the sheet never twists: side = normalize(axis -
    tangent*(axis.tangent)). The head->world map (X, U, D) -> (x, -y, -z)
    carries the axis to world. Solid = +/- thickness/2 along the ribbon
    normal. Returns dict with centre/left/right (head mm), world grid,
    verts/faces, arc lengths.
    """
    wt, wm, wh = widths
    centre = np.asarray(centre_head, dtype=np.float64)
    n = centre.shape[0]
    world_c = head_to_world(centre, crown)
    tan = np.gradient(world_c, axis=0)
    norm = np.linalg.norm(tan, axis=1, keepdims=True)
    norm[norm == 0.0] = 1.0
    tan = tan / norm
    ax = np.array([float(width_axis[0]), -float(width_axis[1]), 0.0])
    ax = ax / max(np.linalg.norm(ax), 1e-9)
    dot = (tan * ax[None, :]).sum(axis=1, keepdims=True)
    side = ax[None, :] - tan * dot
    snorm = np.linalg.norm(side, axis=1, keepdims=True)
    snorm[snorm < 1e-9] = 1.0
    side = side / snorm
    normal = np.cross(tan, side)
    # width profile over arc stations
    seg = np.linalg.norm(np.diff(world_c, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)]) * 1000.0
    total = arc[-1] if arc[-1] > 0 else 1.0
    s = arc / total
    w = np.where(s <= 0.5, wt + (wm - wt) * (s / 0.5),
                 wm + (wh - wm) * ((s - 0.5) / 0.5))
    half = (w / 1000.0 / 2.0)[:, None] * side
    left_w = world_c - half
    right_w = world_c + half
    t2 = float(thickness) / 1000.0 / 2.0
    nvec = normal / np.maximum(
        np.linalg.norm(normal, axis=1, keepdims=True), 1e-9)
    top = np.vstack([left_w, right_w]) + np.vstack([nvec, nvec]) * t2
    bot = np.vstack([left_w, right_w]) - np.vstack([nvec, nvec]) * t2
    verts = np.vstack([top, bot])
    faces = []
    for k in range(n - 1):
        for base, flip in ((0, False), (2 * n, True)):
            a, b = base + k, base + k + 1
            c, d = base + n + k, base + n + k + 1
            if not flip:
                faces += [[a, b, d], [a, d, c]]
            else:
                faces += [[a, d, b], [a, c, d]]
    # side walls: left TL->BL, right TR->BR
    for k in range(n - 1):
        faces.append([k, k + 1, 2 * n + k + 1])
        faces.append([k, 2 * n + k + 1, 2 * n + k])
        faces.append([n + k, 3 * n + k, 3 * n + k + 1])
        faces.append([n + k, 3 * n + k + 1, n + k + 1])
    # end caps: start (TL0, TR0, BR0, BL0), end (TL1, TR1, BR1, BL1)
    faces.append([0, n, 3 * n])
    faces.append([0, 3 * n, 2 * n])
    faces.append([n - 1, 3 * n - 1, 4 * n - 1])
    faces.append([n - 1, 4 * n - 1, 2 * n - 1])
    def world_to_head(pts):
        pts = np.asarray(pts, dtype=np.float64)
        out = np.empty_like(pts)
        out[:, 0] = pts[:, 0] * 1000.0
        out[:, 1] = (float(crown[1]) - pts[:, 1]) * 1000.0
        out[:, 2] = (float(crown[2]) - pts[:, 2]) * 1000.0
        return out

    return {
        "centre_head": centre,
        "left_head": world_to_head(left_w),
        "right_head": world_to_head(right_w),
        "widths_mm": [wt, wm, wh],
        "arc_mm": arc,
        "verts_world": verts,
        "faces": np.array(faces, dtype=np.int64),
        "surf_top": (top[:n], top[n:2 * n]),
        "grid_w": (left_w, right_w),
        "thickness_mm": float(thickness),
    }


def build_cage(values, spec):
    """values: param vector in PARAM_ORDER. spec: cage-spec dict.

    Returns {family: ribbon_dict} with world verts/faces per ribbon.
    """
    p = dict(zip(PARAM_ORDER, [float(v) for v in values]))
    crown = spec["crown"]
    anchors = spec["anchors"]
    attach = {k: tuple(v) for k, v in spec["attachments"].items()}
    out = {}
    for family in FAMILIES:
        base = FAMILY_GROUP[family]
        ctrl = control_points(family, p, attach, anchors)
        centre = bspline(ctrl, CENTRE_N)
        if family.endswith("_L"):
            centre[:, 0] = -np.abs(centre[:, 0])
        elif base in ("part", "temple", "side"):
            centre[:, 0] = np.abs(centre[:, 0])
        widths = family_widths(base, p)
        axis = WIDTH_AXIS[base]
        if family.endswith("_L"):
            axis = (-axis[0], axis[1])
        out[family] = build_ribbon(centre, widths, p["thickness"], crown,
                                   axis)
        out[family]["control_head"] = np.array(ctrl, dtype=np.float64)
    return out


def cage_hash(cage):
    import hashlib
    digest = hashlib.sha256()
    for family in sorted(cage):
        digest.update(family.encode())
        digest.update(np.ascontiguousarray(
            cage[family]["verts_world"]).tobytes())
    return digest.hexdigest()


def save_cage(path, cage):
    payload = {}
    for family in sorted(cage):
        rib = cage[family]
        payload["%s/verts" % family] = np.asarray(
            rib["verts_world"], dtype=np.float64)
        payload["%s/faces" % family] = np.asarray(
            rib["faces"], dtype=np.int64)
        payload["%s/centre_head" % family] = np.asarray(
            rib["centre_head"], dtype=np.float64)
        payload["%s/control_head" % family] = np.asarray(
            rib["control_head"], dtype=np.float64)
        payload["%s/arc" % family] = np.asarray(
            rib["arc_mm"], dtype=np.float64)
    np.savez(str(path), **dict(sorted(payload.items())))


def default_spec(attachments, anchors, crown, pins):
    params = [
        {"name": n, "init": DEFAULTS[n][0], "lo": DEFAULTS[n][1],
         "hi": DEFAULTS[n][2], "unit": DEFAULTS[n][3]}
        for n in PARAM_ORDER
    ]
    return {
        "schemaVersion": "openclinxr.cage-spec.v2",
        "v2Changes": [
            "part families widened into crown sheets (cap_span 60/40-95 "
            "-> 75/40-120; part_w_top 24/10-50 -> 36/10-80; part_w_hem "
            "20/10-50 -> 32/10-80) so the cranium can be covered",
            "curtain_front_sh lo -20 -> -100 (behind-shoulder positions "
            "in bound; fit decides, not spec)",
            "curtain_hem_drop lo 280 -> 180 (short target front); "
            "back_hem_drop hi 520 -> 600 (long target back)",
            "crown_lift 10.0/2-30 -> 2.0/0.5-6 (root-standoff rule: "
            "every root 1-3 mm off the scalp by the exact field)",
            "temple-curtain routing no longer fixed front-of-shoulder",
        ],
        "frame": "head mm: X lateral, U anterior+ rel crown, D drop below "
        "crown; world(m) = (X/1000, crown_y - U/1000, crown_z - D/1000)",
        "families": [
            {"name": "part", "mirror": "L/R",
             "attachRow": {"dropMm": 10.0, "azimuthDeg": 12.0}},
            {"name": "temple-curtain", "mirror": "L/R",
             "attachRow": {"dropMm": 70.0, "azimuthDeg": 55.0},
             "routing": "fitted anterior offset at z = 1.405 m "
             "(bound spans behind to front of the shoulder plane)"},
            {"name": "side", "mirror": "L/R",
             "attachRow": {"dropMm": 90.0, "azimuthDeg": 85.0},
             "routing": "clears the shoulder laterally"},
            {"name": "back", "mirror": None,
             "attachRow": {"dropMm": 60.0, "azimuthDeg": 180.0},
             "routing": "passes BEHIND the shoulder"},
            {"name": "nape", "mirror": None,
             "attachRow": {"dropMm": 150.0, "azimuthDeg": 180.0},
             "routing": "passes BEHIND the shoulder"},
        ],
        "centreline": "6-control-point clamped cubic B-spline, 61 samples; "
        "P0 of every family sits on its measured attachment raised by "
        "crown_lift (drop direction), so roots inherit the on-scalp "
        "attachment position and the lift sets the 1-3 mm standoff; "
        "crown_lift raises P1 fully and P2 halfway; "
        "part rides the crown sphere (drop = r^2/2R + lift, R=90 mm) with "
        "lateral splay k = 0.5 + part_angle/45; temple/side stand off the "
        "max-width line (surfX + 14 / + side_out_sh); back/nape run the "
        "posterior midline (nape roots pushed 18/20 mm posterior); "
        "below-shoulder points hold the shoulder planform",
        "ribbon": "width profile at 3 arc stations (top s=0, mid s=0.5 mean, "
        "hem s=1.0) along a fixed per-family horizontal axis (part X, "
        "temple face-corner diagonal (0.8, 0.6), side U, back/nape X), "
        "projected perpendicular to the tangent so sheets never twist; "
        "closed solid +/- thickness/2 along the ribbon normal",
        "requiredControls": {
            "curtainEndHeight": "curtain_hem_drop (drop mm below crown)",
            "backSheetEndHeight": "back_hem_drop (drop mm below crown)",
            "curtainAnteriorOffsetAtShoulder":
                "curtain_front_sh (U mm at z = 1.405 m plane)",
            "backSheetPosteriorOffsetAtShoulder":
                "back_post_sh (U mm at z = 1.405 m plane)",
            "crownLift": "crown_lift (mm)",
            "partDepartureAngle": "part_angle (deg)",
        },
        "rootStandoff": "every family root (centreline P0) sits 1-3 mm "
        "off the scalp by the EXACT field (positive = outside); enforced "
        "as a fit penalty and a gate, verified by exact.root_standoff",
        "collisionField": "exact signed distance to the bare-body mesh "
        "(Blender BVHTree closest point + ray-parity sign, 2 mm grid; "
        "negative inside), tolerance 0.0 mm",
        "judgePlaneZm": 1.405,
        "params": params,
        "attachments": attachments,
        "anchors": anchors,
        "crown": [float(v) for v in crown],
        "pins": pins,
    }


def spec_path_of(station):
    return Path(station) / "cage-spec.json"


def append_inputs(evidence_dir, paths):
    """Merge runtime input paths into E/inputs-opened.txt (sorted unique)."""
    dest = Path(evidence_dir) / "inputs-opened.txt"
    seen = set()
    if dest.exists():
        seen.update(l.strip() for l in dest.read_text().splitlines()
                    if l.strip())
    seen.update(str(p) for p in paths)
    dest.write_text("\n".join(sorted(seen)) + "\n")
    return dest
