"""STEP 1b (Blender): back-project the frontal hairline arc onto the head.

CORRECTION 1: only hair LYING ON THE SCALP is back-projected (frontal arc
between the departure points, part band interpolated). Temple/sideburn/
ear-front lines are PRIOR anatomical rules, not target observations.

Reads (read-only): manifest, pinned cameras file, station register.py (via
scalp/common.py), E/hairline_2d.json, body GLB. The library hair object is
hidden from renders and asserted excluded.

Per kept arc pixel: target frame -> render frame (inverse station similarity
from register.py) -> world ray (pinned front camera) -> head BVH hit
(spiral fallback to 6px, recorded). Part-band span is interpolated in 3D
between the nearest surviving neighbours (source TARGET-interp).

Sanity checks on every TARGET point (dropped + counted):
 (a) above the brow plane by >= 15mm (brow = MPFB anatomy vertex rule);
 (b) within 25mm of the anatomical scalp/forehead boundary: parabola
     z(x) = crown - 0.048 - 0.030*(x/0.065)^2, |x| <= 0.065, y taken on the
     skin by front raycast (+y from y=-1), +0.5mm proud. This is a gross-error
     guard (mis-registered curtain pixels, background grazes), not precision.
PRIOR temple rule (stated): per side from the departure 3D point, azimuth
sweep azD -> 62deg (20 steps); z(t) = lerp(zD, earTop+5mm, smoothstep(t)) +
12mm*sin(pi*t) (temporal peak); seed radius 85mm about the head axis, all
snapped to skin (+0.3mm). Temple bottom feeds the sideburn; ear-front
sideburn, under-lobe pass, behind-ear rise, nape: geometric rules anchored
to measured ear extent (as before), snapped to skin.

Writes: E/hairline.json, E/render_<view>.png (front/three_quarter/profile).
Usage: Blender --background --python hairline_cast.py -- <outdir-E>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))
import common as C

E = Path(sys.argv[sys.argv.index("--") + 1])
RES = 512


def load_body(glb):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    head = max(meshes, key=lambda o: len(o.data.vertices))
    hair_objs = [o for o in meshes if "hair" in o.name.lower()]
    if not hair_objs:
        raise RuntimeError("ASSERT FAIL: no library hair object found to exclude")
    for o in hair_objs:
        o.hide_render = True
        o.hide_viewport = True
    if [o.name for o in meshes if "hair" in o.name.lower() and not o.hide_render]:
        raise RuntimeError("ASSERT FAIL: hair object still visible")
    return head, meshes, [o.name for o in hair_objs]


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def main():
    doc, _ = C.load_manifest()
    cams, _ = C.load_cameras(doc)
    reg = C.load_register()
    pts2d = json.loads((E / "hairline_2d.json").read_text())

    body_path = C.ROOT / doc["body"]["glb"]
    C.log_open(body_path)
    head, meshes, hair_names = load_body(str(body_path))

    world = [head.matrix_world @ v.co for v in head.data.vertices]
    xs = [p.x for p in world]
    crown_i = max(range(len(world)), key=lambda i: (world[i].z, -i))
    crown = world[crown_i]
    cz = float(crown.z)
    cx = (min(xs) + max(xs)) * 0.5
    want_chin = cz - 0.2106
    menton_i = None
    for i, p in enumerate(world):
        if abs(p.x - cx) <= 0.002 and p.y < 0.0 and p.z > cz - 0.35:
            key = (abs(p.z - want_chin), i)
            if menton_i is None or key < menton_i[0]:
                menton_i = (key, i)
    menton = world[menton_i[1]]
    want_brow = cz - 0.0882
    brow_i = min((i for i, p in enumerate(world) if abs(p.x - cx) <= 0.002 and p.y < 0.0),
                 key=lambda i: (abs(world[i].z - want_brow), i))
    brow_z = float(world[brow_i].z)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.light = "STUDIO"

    cam_data = bpy.data.cameras.new("S2CAST_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    camera = bpy.data.objects.new("S2CAST_cam", cam_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    deps = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(head, deps)
    inv = head.matrix_world.inverted()

    def setcam(view):
        rec = cams["views"][view]
        cam_data.lens = float(rec["lensMm"])
        camera.matrix_world = Matrix(rec["matrixWorld"])
        bpy.context.view_layer.update()

    setcam("front")
    view = "front"
    t = reg.similarity_from_triples(
        *[float(v) for v in cams["registrationRenderTriples"][view]],
        *[float(v) for v in cams["registrationTargetTriples"][view]])
    s_fwd = float(t["scale"])

    # mm scale: local projection derivative at the crown, / registration scale
    n0 = world_to_camera_view(scene, camera, crown)
    n1 = world_to_camera_view(scene, camera, crown - Vector((0.0, 0.0, 0.005)))
    rows_per_m = abs(float(n0.y - n1.y)) * C.FRAME / 0.005
    mm_per_target_px = (1.0 / rows_per_m) * 1000.0 / s_fwd

    def cast_ray_render(col_r, row_r):
        rec = cams["views"]["front"]
        origin, direction = C.camera_ray(col_r, row_r, rec, float(cams["sensorWidthMm"]))
        o2 = inv @ Vector(origin)
        d2 = (inv.to_3x3() @ Vector(direction)).normalized()
        hit = tree.ray_cast(o2, d2, 10.0)
        if hit[0] is None:
            return None
        return head.matrix_world @ hit[0]

    def cast_one(col_t, row_t):
        col_r, row_r = C.target_to_render(col_t, row_t, "front", cams, reg)
        w = cast_ray_render(col_r, row_r)
        if w is not None:
            return w, 0.0, "direct"
        for rad in (1, 2, 3, 4, 5, 6):
            for dx in range(-rad, rad + 1):
                for dy in range(-rad, rad + 1):
                    if max(abs(dx), abs(dy)) != rad:
                        continue
                    w = cast_ray_render(col_r + dx, row_r + dy)
                    if w is not None:
                        return w, float(np.hypot(dx, dy)) * s_fwd, "spiral"
        return None, None, "miss"

    cast = []
    miss_rows = []
    for pt in pts2d["arc"]:
        if pt["inPartBand"]:
            continue
        w, res, method = cast_one(pt["col"], pt["row"])
        if w is None:
            miss_rows.append(pt["row"])
            continue
        cast.append({"tcol": pt["col"], "trow": pt["row"],
                     "xyz": [float(v) for v in w], "residPx": res, "method": method})

    # anatomical scalp/forehead boundary (gross-error guard reference)
    anat = []
    for x in np.linspace(-0.065, 0.065, 27):
        z = cz - 0.048 - 0.030 * (x / 0.065) ** 2
        o2 = inv @ Vector((float(x), -1.0, float(z)))
        d2 = (inv.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
        hit = tree.ray_cast(o2, d2, 5.0)
        if hit[0] is None:
            continue
        w = head.matrix_world @ hit[0]
        n = (inv.to_3x3().inverted().transposed() @ Vector(hit[1])).normalized()
        anat.append(np.array(w) + np.array(n) * 0.0005)
    anat = np.array(anat)
    if len(anat) < 20:
        raise RuntimeError("anatomical boundary raycast failed")

    def snap(points):
        out = []
        for p in points:
            hit = tree.find_nearest(inv @ Vector(p), 0.05)
            if hit[0] is None:
                raise RuntimeError("waypoint >50mm from skin: %r" % (p,))
            w = head.matrix_world @ hit[0]
            n = (inv.to_3x3().inverted().transposed() @ Vector(hit[1])).normalized()
            out.append((Vector(w) + n * 0.0003)[:])
        return [[float(v) for v in q] for q in out]

    ax, ay = float(cx), float(crown.y)

    def az_el(p):
        dx, dy = p[0] - ax, p[1] - ay
        az = float(np.arctan2(dx, -dy))
        el = float(np.arctan2(p[2] - cz + 0.10, np.hypot(dx, dy)))
        return az, el

    # sanity checks (a) brow plane (b) anatomical boundary; drop + count
    kept = []
    n_drop_brow, n_drop_anat = 0, []
    for c in cast:
        p = np.array(c["xyz"])
        if p[2] < brow_z + 0.015:
            n_drop_brow += 1
            continue
        d = float(np.linalg.norm(anat - p, axis=1).min())
        if d > 0.025:
            n_drop_anat.append(round(d * 1000.0, 1))
            continue
        kept.append(c)

    # part-band interpolation in 3D between surviving neighbours
    band = pts2d["part"]["bandCols"]
    # order kept by column, split at band, bridge
    kept.sort(key=lambda c: c["tcol"])
    left = [c for c in kept if c["tcol"] < band[0]]
    right = [c for c in kept if c["tcol"] > band[1]]
    mid = [c for c in kept if band[0] <= c["tcol"] <= band[1]]
    assert left and right, "part band empties one side of the arc"
    a, b = np.array(left[-1]["xyz"]), np.array(right[0]["xyz"])
    n_bridge = max(2, int(round(float(np.linalg.norm(b - a)) / 0.002)))
    bridge = [(a + (b - a) * (k / n_bridge)).tolist() for k in range(1, n_bridge)]
    fore = (
        [(p["xyz"], "TARGET-front") for p in left]
        + [(q, "TARGET-interp") for q in bridge]
        + [(p["xyz"], "TARGET-front") for p in right]
    )

    # PRIOR temple curves per side from the departure (arc end) points
    warr = np.array([[v.x, v.y, v.z] for v in world])
    head_only = warr[warr[:, 2] > cz - 0.25]
    earband = head_only[(np.abs(head_only[:, 0]) > 0.075)]
    ear_top = float(earband[:, 2].max())
    ear_bot = float(earband[:, 2].min())
    nape_z = ear_bot

    def temple_curve(dep_xyz, sign):
        azD = az_el(dep_xyz)[0]
        azE = sign * np.deg2rad(62.0)
        zD = float(dep_xyz[2])
        zE = ear_top + 0.005
        pts = []
        NN = 20
        for k in range(NN + 1):
            f = k / NN
            az = azD + (azE - azD) * f
            z = zD + (zE - zD) * float(smoothstep(np.array(f))) + 0.012 * float(np.sin(np.pi * f))
            pts.append([ax + 0.085 * float(np.sin(az)), ay - 0.085 * float(np.cos(az)), float(z)])
        return snap(pts)

    tA = temple_curve(np.array(fore[0][0]), -1.0)    # -X side from left departure
    tB = temple_curve(np.array(fore[-1][0]), +1.0)   # +X side from right departure

    def sideburn(tb_xyz, sign):
        y0, z0 = float(tb_xyz[1]), float(tb_xyz[2])
        knee_z = ear_bot - 0.008
        if not (z0 > knee_z + 0.005):
            raise RuntimeError("temple bottom below sideburn knee")
        way = [([float(tb_xyz[0]), y0, z0], [sign * 0.066, -0.078, z0 - 0.015]),
               ([sign * 0.066, -0.078, z0 - 0.015], [sign * 0.064, -0.068, knee_z]),
               ([sign * 0.064, -0.068, knee_z], [sign * 0.060, -0.040, 1.500]),
               ([sign * 0.060, -0.040, 1.500], [sign * 0.056, -0.005, 1.508]),
               ([sign * 0.056, -0.005, 1.508], [sign * 0.055, 0.025, nape_z + 0.010])]
        pts = [way[0][0]]
        for (a, b) in way:
            seg = float(np.linalg.norm(np.array(b) - np.array(a)))
            nn = max(1, int(round(seg / 0.003)))
            for k in range(1, nn + 1):
                f = k / nn
                pts.append((np.array(a) + (np.array(b) - np.array(a)) * f).tolist())
        return snap(pts)

    sA = sideburn(tA[-1], -1.0)
    sB = sideburn(tB[-1], +1.0)
    span = 0.110
    nn = max(2, int(round(span / 0.003)))
    nape = []
    for k in range(nn + 1):
        x = 0.055 - 0.110 * k / nn
        nape.append([float(x), 0.025, nape_z + 0.010 - 0.004 * (1 - (x / 0.055) ** 2)])
    nape = snap(nape)

    # stitched loop, continuous order: sideA departure -> down -> nape corner
    # -X -> nape +X -> sideB up -> departure +X -> forehead +X -> -X -> close
    # at sideA departure (zero gap by construction: fA[-1] reversed ends at
    # the -X departure which is tA[0], the loop start).
    fA = [p for (p, _s) in fore]
    fS = [s for (_p, s) in fore]
    loop_pts = tA + sA + nape[::-1] + sB[::-1] + tB[::-1] + fA[::-1]
    loop_src = (["PRIOR-temple"] * len(tA) + ["PRIOR-sideburn"] * len(sA)
                + ["PRIOR-nape"] * len(nape) + ["PRIOR-sideburn"] * len(sB)
                + ["PRIOR-temple"] * len(tB) + fS[::-1])

    # per-point visibility from each beauty view (camera->point raycast)
    loop_vis = {}
    for v in ("front", "three_quarter", "profile_90"):
        setcam(v)
        rec = cams["views"][v]
        origin = np.array(rec["location"], dtype=np.float64)
        flags = []
        for p in loop_pts:
            p = np.array(p, dtype=np.float64)
            d = p - origin
            dist = float(np.linalg.norm(d))
            d = d / dist
            o2 = inv @ Vector(origin)
            d2 = (inv.to_3x3() @ Vector(d)).normalized()
            hit = tree.ray_cast(o2, d2, 100.0)
            if hit[0] is None:
                flags.append(False)
                continue
            w = np.array(head.matrix_world @ hit[0], dtype=np.float64)
            flags.append(bool(abs(float(np.linalg.norm(w - origin)) - dist) < 0.0015))
        loop_vis[v] = flags

    res_all = np.array([c["residPx"] for c in cast])
    methods = {}
    for c in cast:
        methods[c["method"]] = methods.get(c["method"], 0) + 1
    out = {
        "correction": 1,
        "headObject": head.name,
        "libraryHairHidden": hair_names,
        "crown": [float(v) for v in crown],
        "menton": [float(v) for v in menton],
        "browZ": brow_z,
        "axis": {"x": ax, "y": ay, "crownZ": cz, "elevCentreZ": cz - 0.10,
                 "note": "az=atan2(dx,-dy): 0=front, +=+X side, seam +-pi at back midline"},
        "mmPerTargetPx": {"front": mm_per_target_px, "unit": "mm",
                          "method": "local projection derivative (rows per mm) at the crown through the pinned front camera, divided by the registration scale"},
        "nCast": len(cast),
        "nMiss": len(miss_rows),
        "missedTargetRows": miss_rows,
        "castMethods": methods,
        "residualsPx": {"p50": float(np.median(res_all)), "p95": float(np.percentile(res_all, 95)),
                        "max": float(res_all.max()), "n": int(len(res_all)),
                        "note": "target-frame distance between requested pixel and the pixel whose ray hit the head (0 = direct hit; >0 = spiral fallback offset)"},
        "sanity": {"browPlaneZ": brow_z + 0.015,
                   "nDropBrow": n_drop_brow,
                   "anatRef": "parabola z(x)=crown-0.048-0.030*(x/0.065)^2 |x|<=0.065, y on skin by front raycast",
                   "nDropAnat": len(n_drop_anat),
                   "dropAnatMm": n_drop_anat},
        "segments": {
            "forehead": {"source": "TARGET", "detail": "TARGET-front arc + TARGET-interp bridge across part band",
                         "n": len(fA), "points": fA, "pointSource": fS,
                         "nInterp": sum(1 for s in fS if s == "TARGET-interp")},
            "templeA": {"source": "PRIOR", "detail": "azimuth sweep from -X departure to -62deg, +12mm temporal peak, bottom at earTop+5mm, skin-snapped",
                        "n": len(tA), "points": tA},
            "templeB": {"source": "PRIOR", "detail": "mirror rule from +X departure (own anchor)", "n": len(tB), "points": tB},
            "sideburnA": {"source": "PRIOR", "detail": "forward of ear groove, under lobe, behind-ear rise; anchored to measured ear extent",
                          "n": len(sA), "points": sA},
            "sideburnB": {"source": "PRIOR", "detail": "mirror rule", "n": len(sB), "points": sB},
            "nape": {"source": "PRIOR", "detail": "line y=0.025 across back at ear-lobe level with 4mm centre dip",
                     "n": len(nape), "points": nape},
        },
        "priorRules": {"earTop": ear_top, "earBottom": ear_bot, "napeZ": nape_z,
                       "note": "no anatomical vertex groups survive in the exported GLB (rig groups only); PRIOR lines are geometric rules anchored to measured ear extent"},
        "loop": {"points": loop_pts, "source": loop_src, "n": len(loop_pts),
                 "visible": {v: [bool(f) for f in flags] for v, flags in loop_vis.items()}},
        "markers": {"departureL": pts2d["departure"]["left"], "departureR": pts2d["departure"]["right"],
                    "partBandCols": pts2d["part"]["bandCols"]},
        "partPx": pts2d["part"],
    }
    (E / "hairline.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")

    for v in ("front", "three_quarter", "profile_90"):
        rec = cams["views"][v]
        cam_data.lens = float(rec["lensMm"])
        camera.matrix_world = Matrix(rec["matrixWorld"])
        bpy.context.view_layer.update()
        scene.render.filepath = str(E / ("render_%s.png" % v))
        bpy.ops.render.render(write_still=True)
    C.write_opened(E / "inputs-opened.txt")
    print("CAST_DONE n=%d miss=%d drops brow=%d anat=%d" % (len(cast), len(miss_rows), n_drop_brow, len(n_drop_anat)))


main()
