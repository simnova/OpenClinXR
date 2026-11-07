#!/usr/bin/env python3
"""Default guide cage: build, render, measure -> E/default-*.

Builds the hand-set default cage (spec init values: anatomy choices,
documented in cage.py, NOT tuned to the masks), renders it in Blender
(Workbench, one colour per family, body without the library topper),
rasterizes it with the strip instruments, scores it against the real
target masks (regional losses, face guard, collision, split-hem rays),
and draws the raster-vs-target overlay with the region masks. Writes
E/default-cage.npz, E/default-cage.png, E/default-overlay.png,
E/regions.json, E/region-masks.npz, E/default-metrics.json.

Usage: make_default.py --evidence <E dir>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

STATION = Path(__file__).resolve().parent
ROOT = STATION.parents[3]
sys.path.insert(0, str(STATION))
import cage as CAGE  # noqa: E402
import instruments as INS  # noqa: E402

OPENED = []
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
             "tools/openclinxr/evidence/hair-judge/target-set-back")
MASKS = {"front": "mask-front-v2.png", "profile_90": "mask-profile-v2.png",
         "back": "mask-back-v3.png"}
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"

REGION_COLOURS = {
    "crown": (80, 220, 255),
    "face_opening": (255, 235, 80),
    "side_curtain_L": (255, 120, 220),
    "side_curtain_R": (255, 120, 220),
    "hem": (255, 140, 40),
}


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_mask(name):
    p = track(JUDGE / MASKS[name])
    assert sha256_file(p) == PINNED[name], "mask sha mismatch for %s" % name
    return np.asarray(Image.open(p).convert("L")) > 127


def draw_overlay(view, union, target, regions, guards):
    base = np.zeros((1024, 1024, 3), dtype=np.uint8) + 18
    base[union] = (0.55 * base[union]
                   + 0.45 * np.array([220.0, 40.0, 40.0])).astype(np.uint8)
    img = Image.fromarray(base).resize((512, 512), Image.NEAREST)
    draw = ImageDraw.Draw(img)
    b = INS.boundary(target)
    ys, xs = np.nonzero(b)
    for y, x in zip(ys[::3], xs[::3]):
        draw.rectangle([x // 2 - 1, y // 2 - 1, x // 2 + 1, y // 2 + 1],
                       fill=(60, 255, 90))
    for name, box in regions[view].items():
        if not box:
            continue
        r0, r1, c0, c1 = [v / 2 for v in box]
        draw.rectangle([c0, r0, c1, r1], outline=REGION_COLOURS[name],
                       width=2)
    for _, box in guards[view].items():
        r0, r1, c0, c1 = [v / 2 for v in box]
        draw.rectangle([c0, r0, c1, r1], outline=(255, 255, 255), width=1)
    panel = Image.new("RGB", (512, 512 + 28), (16, 16, 16))
    panel.paste(img, (0, 28))
    draw2 = ImageDraw.Draw(panel)
    draw2.text((8, 7), view, fill=(255, 255, 255))
    return panel


def main():
    global PINNED
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    args = ap.parse_args()
    evidence = Path(args.evidence)
    evidence.mkdir(parents=True, exist_ok=True)
    for name in ("cage.py", "instruments.py", "make_default.py",
                 "blender_render.py"):
        track(STATION / name)
    spec_path = track(evidence / "cage-spec.json")
    spec = json.loads(spec_path.read_text())
    spec_sha = sha256_file(spec_path)
    print("SPEC_SHA %s" % spec_sha, flush=True)

    manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                           / "aisha_straight_long.json").read_text())
    PINNED = {v: manifest["targets"]["masks"][v]["sha256"]
              for v in INS.VIEWS}
    cams_rel = manifest["camerasFile"]["path"]
    cams_path = track(ROOT / cams_rel)
    assert sha256_file(cams_path) == manifest["camerasFile"]["sha256"]
    cams = INS.load_cameras(str(cams_path))
    transforms = INS.transforms_of(cams)
    land_path = track(Path(manifest["targets"]["landmarks"]["path"]))
    assert sha256_file(land_path) == manifest["targets"]["landmarks"]["sha256"]
    landmarks = json.loads(land_path.read_text())
    targets = {v: load_mask(v) for v in INS.VIEWS}
    grid = INS.ENV.load_sdf(str(track(
        ROOT / "tools/openclinxr/evidence/hair-station0b/body-sdf.npz")))

    values = CAGE.default_values()
    cage = CAGE.build_cage(values, spec)
    CAGE.save_cage(evidence / "default-cage.npz", cage)
    print("CAGE_HASH %s" % CAGE.cage_hash(cage), flush=True)

    # Blender beauty render of the default cage on the bare body
    body_path = track(ROOT / manifest["body"]["glb"])
    assert sha256_file(body_path) == manifest["body"]["sha256"]
    blender_opened = evidence / "blender-opened.txt"
    cmd = [BLENDER, "--background", "--python",
           str(STATION / "blender_render.py"), "--",
           "--cage-npz", str(evidence / "default-cage.npz"),
           "--outdir", str(evidence),
           "--glb", str(body_path),
           "--cameras", str(cams_path),
           "--opened", str(blender_opened)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        raise RuntimeError("blender default render failed")
    track(blender_opened)
    for line in blender_opened.read_text().split():
        OPENED.append(line)

    strips = {f: {"grid_w": cage[f]["grid_w"]} for f in cage}
    raster = INS.strip_raster(strips, cams, transforms)
    union = {v: INS.union_mask(raster, view=v) for v in INS.VIEWS}
    regions = INS.region_definitions(landmarks)
    (evidence / "regions.json").write_text(
        json.dumps(regions, indent=2, sort_keys=True) + "\n")
    rmasks = INS.region_masks(regions)
    np.savez(str(evidence / "region-masks.npz"), **{
        "%s/%s" % (v, n): np.ascontiguousarray(rmasks[v][n])
        for v in INS.VIEWS for n in rmasks[v]})
    guards = INS.guard_definitions(landmarks)

    regional = INS.all_regional_losses(union, targets, regions)
    boxes_render = INS.guard_boxes_render(guards, transforms)
    render_cov = INS.render_depth(
        {f: cage[f]["grid_w"] for f in cage}, cams)
    frame = np.load(str(track(Path("/tmp/station0b-run/station-frame.npz"))))
    refs = INS.face_ref_depths(
        {"brow": np.array(frame["point3d/brow"]),
         "menton": np.array(frame["point3d/menton"])}, cams)
    guard = INS.face_guard_depth(render_cov, refs, boxes_render)
    coll = INS.collide(cage, spec, grid)
    hems = INS.split_hem_rays(targets["profile_90"], cams, cage, transforms)
    metrics = {
        "specSha": spec_sha,
        "values": {n: round(float(v), 3)
                   for n, v in zip(CAGE.PARAM_ORDER, values)},
        "areasPx": {v: int(union[v].sum()) for v in INS.VIEWS},
        "targetAreasPx": {v: int(targets[v].sum()) for v in INS.VIEWS},
        "regional": regional,
        "faceGuard": guard,
        "collision": coll,
        "splitHem": hems,
    }
    (evidence / "default-metrics.json").write_text(
        json.dumps(metrics, indent=2, sort_keys=True) + "\n")

    panels = [draw_overlay(v, union[v], targets[v], regions, guards)
              for v in INS.VIEWS]
    frame = Image.new("RGB", (512 * 3, 540 + 22), (0, 0, 0))
    for i, panel in enumerate(panels):
        frame.paste(panel, (512 * i, 0))
    ImageDraw.Draw(frame).text(
        (8, 540 + 6),
        "red=cage strip raster green=target outline boxes=regions "
        "white=eye/mouth guard",
        fill=(200, 200, 200))
    frame.save(evidence / "default-overlay.png")
    print("FIGURE %s %s" % (evidence / "default-overlay.png", frame.size),
          flush=True)

    for v in INS.VIEWS:
        print("DEFAULT %s area=%d target=%d guard=%d" % (
            v, metrics["areasPx"][v], metrics["targetAreasPx"][v],
            guard[v]["coveredPx"]), flush=True)
        for name, r in regional[v].items():
            print("  %-14s excess %6.1fpx n=%5d | miss %6.1fpx n=%5d" % (
                name, r["excessMeanPx"], r["excessN"], r["missMeanPx"],
                r["missN"]), flush=True)
    print("DEFAULT collision", coll["maxDepthMm"], coll["violating"],
          flush=True)
    print("DEFAULT guardTotal", guard["totalCoveredPx"], flush=True)
    for key in ("curtain", "back"):
        h = hems.get(key, {})
        print("DEFAULT hem-%s" % key,
              h.get("hemPixel"), "z=%s U=%s rayErr=%s" % (
                  h.get("cageEndHeightMm"), h.get("cageEndUMm"),
                  h.get("rayToEndMm")), flush=True)
    CAGE.append_inputs(evidence, OPENED)
    print("DEFAULT_DONE")


if __name__ == "__main__":
    main()
