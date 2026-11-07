#!/usr/bin/env python3
"""Evidence-only: body depth maps + occlusion self-test for the cage fit.

Rasterizes the station0b bare-body mesh (body-verts.npz, topper excluded)
with the pinned cameras into per-view render-frame coverage + camera-space
depth (E/body-depth.npz). The cage fit depth-tests strip pixels against
these maps (instruments.occluded_union): the target masks are occluded
views, so the fitted raster must be occluded too — otherwise the back
sheet fills the face hole invisibly to every contour loss and the
face-opening gate is vacuous.

Self-test (E/occlusion-test.json):
  (a) the default cage's back family projects over the front face box
      (>0 raw px) but its occluded count there is 0 (head hides it);
  (b) the temple curtain keeps >0 occluded px in the front chest band
      (hair in front of the torso stays visible);
  (c) body depth at the projected scalp point matches the camera distance
      within 5 mm (projection sanity).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/cage"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom"))
import cage as CAGE  # noqa: E402
import instruments as INS  # noqa: E402
import envelope as ENV  # noqa: E402

OPENED = []


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def main():
    for name in ("cage.py", "instruments.py"):
        track(ROOT / "tools/openclinxr/hair-groom/cage" / name)
    manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                           / "aisha_straight_long.json").read_text())
    cams_path = track(ROOT / manifest["camerasFile"]["path"])
    cams = INS.load_cameras(str(cams_path))
    sensor = INS.sensor_of(cams)
    body = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-station0b/body-verts.npz")))
    verts = np.array(body["vertices"], dtype=np.float64)
    faces = np.array(body["faces"], dtype=np.int64)

    maps = INS.body_depth_maps(verts, faces, cams)
    payload = {}
    for v in INS.VIEWS:
        cover, depth = maps[v]
        payload["%s/cover" % v] = np.ascontiguousarray(cover)
        depth32 = np.where(cover, depth, np.inf).astype(np.float32)
        payload["%s/depth" % v] = np.ascontiguousarray(depth32)
        print("BODYDEPTH %s coverPx=%d" % (v, int(cover.sum())), flush=True)
    np.savez_compressed(str(E / "body-depth.npz"), **payload)

    # --- self-test on the spec-default cage (spec inits, not a fit) ---
    spec = json.loads(track(E / "cage-spec.json").read_text())
    cage = CAGE.build_cage(CAGE.default_values(), spec)
    grids = {f: cage[f]["grid_w"] for f in cage}
    transforms = INS.transforms_of(cams)
    render_cov = INS.render_depth(grids, cams)
    occ = INS.occluded_union(render_cov, maps, transforms)  # target frame
    land_path = track(Path(manifest["targets"]["landmarks"]["path"]))
    landmarks = json.loads(land_path.read_text())
    guards = INS.guard_definitions(landmarks)
    # (a) back sheet over the face: raw render-frame cover inside the
    # render-frame eye box vs occluded target-frame count in the
    # target-frame eye box (head must hide it -> 0).
    rbox = ctx_boxes_render_front_eyes = INS.guard_boxes_render(
        guards, transforms)["front"]["eyes"]
    rr0, rr1, rc0, rc1 = (int(rbox[0]), int(rbox[1]),
                          int(rbox[2]), int(rbox[3]))
    back_only = INS.render_depth({"back": grids["back"]}, cams,
                                 views=("front",))["front"]
    raw_face = int(back_only[0][rr0:rr1, rc0:rc1].sum())
    tbox = guards["front"]["eyes"]
    face_zone = _box(*[int(v) for v in tbox])
    occ_back = INS.occluded_union(
        {"front": back_only}, maps, transforms, views=("front",))["front"]
    occ_back_face = int((occ_back & face_zone).sum())
    # (b) temple curtain stays visible over the chest band (target frame):
    # hair in front of the torso is genuinely visible.
    temple_only = INS.render_depth(
        {"temple_L": grids["temple_L"], "temple_R": grids["temple_R"]},
        cams, views=("front",))
    occ_temple = INS.occluded_union(
        temple_only, maps, transforms, views=("front",))["front"]
    chest = np.zeros((INS.FRAME, INS.FRAME), dtype=bool)
    chin = landmarks["front"]["chin_row"]
    chest[chin + 10:chin + 200, :] = True
    temple_vis = int((occ_temple & chest).sum())
    # projection sanity: the brow point faces the front camera, so the map
    # depth at its pixel must match its camera distance within 5 mm.
    frame = np.load(str(track(Path("/tmp/station0b-run/station-frame.npz"))))
    brow_m = np.array(frame["point3d/brow"], dtype=np.float64)[None, :]
    cols, rows, dep = ENV.project_to_render(
        brow_m, cams["views"]["front"], sensor)
    ci, ri = int(round(cols[0])), int(round(rows[0]))
    lo_r, hi_r = max(ri - 3, 0), min(ri + 4, INS.FRAME)
    lo_c, hi_c = max(ci - 3, 0), min(ci + 4, INS.FRAME)
    patch = maps["front"][1][lo_r:hi_r, lo_c:hi_c]
    patch = patch[np.isfinite(patch)]
    proj_err = (float(np.median(patch)) - float(dep[0])) * 1000.0 \
        if patch.size else float("nan")
    tests = {
        "a_back_occluded_over_face": {
            "rawBackPxInFaceBox": raw_face,
            "occBackPxInFaceBox": occ_back_face,
            "pass": bool(raw_face > 0 and occ_back_face == 0),
        },
        "b_curtain_visible_over_chest": {
            "occPxChestBand": temple_vis,
            "pass": bool(temple_vis > 0),
        },
        "c_scalp_depth_agrees": {
            "errMm": round(proj_err, 2),
            "pass": bool(abs(proj_err) <= 5.0),
        },
    }
    tests["pass"] = bool(all(t["pass"] for t in tests.values()
                             if isinstance(t, dict)))
    (E / "occlusion-test.json").write_text(
        json.dumps(tests, indent=2, sort_keys=True) + "\n")
    for k, v in tests.items():
        print("OCCLUSION %s %s" % (k, v), flush=True)
    CAGE.append_inputs(E, OPENED)
    if not tests["pass"]:
        raise SystemExit(1)
    print("OCCLUSION_PASS")


def _box(r0, r1, c0, c1):
    rows, cols = np.mgrid[0:INS.FRAME, 0:INS.FRAME]
    return ((rows >= r0) & (rows < r1) & (cols >= c0) & (cols < c1))


if __name__ == "__main__":
    main()
