#!/usr/bin/env python3
"""Evidence-only: STEP 5 figures + end-height report for the cage fit.

Reads the all-view best fit (E/fit-all.json), writes:
  E/fit-cage.npz ........ fitted cage ribbons (Blender reads this)
  E/fit.png ............. per view: occluded fit raster (red), target
                          outline (green), region boxes, guard boxes
  E/heights.json ........ curtain/back end heights (mm vs shoulder plane
                          z = 1.405 m and vs chin/menton z) + curtain/back
                          offsets at shoulder height + erosion/landmark
                          noise floor (printed only, never gated)
Blender Workbench render -> E/fit-cage.png is launched separately (the
same binary + script as cage0, --stem fit-cage).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/cage"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom"))
import cage as CAGE  # noqa: E402
import instruments as INS  # noqa: E402
from PIL import Image as _I  # noqa: E402,F401

OPENED = []
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
REGION_COLOURS = {
    "crown": (80, 220, 255),
    "face_opening": (255, 235, 80),
    "side_curtain_L": (255, 120, 220),
    "side_curtain_R": (255, 120, 220),
    "hem": (255, 140, 40),
}
SHOULDER_Z_MM = 1405.0


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def draw_panel(view, union, target, regions, guards):
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
    ImageDraw.Draw(panel).text((8, 7), view, fill=(255, 255, 255))
    return panel


def main():
    for name in ("cage.py", "instruments.py", "exact.py", "fit_cage.py"):
        track(ROOT / "tools/openclinxr/hair-groom/cage" / name)
    manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                           / "aisha_straight_long.json").read_text())
    cams = INS.load_cameras(str(track(ROOT / manifest["camerasFile"][
        "path"])))
    transforms = INS.transforms_of(cams)
    land = json.loads(track(Path(manifest["targets"]["landmarks"][
        "path"])).read_text())
    targets = {}
    for v, f in (("front", "mask-front-v2.png"),
                 ("profile_90", "mask-profile-v2.png"),
                 ("back", "mask-back-v3.png")):
        p = track(Path("/Users/patrick/.grok/worktrees/src-openclinxr/"
                       "hair-judge/tools/openclinxr/evidence/hair-judge/"
                       "target-set-back/" + f))
        targets[v] = np.asarray(Image.open(p).convert("L")) > 127
    bdepth = np.load(str(track(E / "body-depth.npz")))
    body_maps = {v: (np.array(bdepth["%s/cover" % v], dtype=bool),
                     np.array(bdepth["%s/depth" % v], dtype=np.float64))
                 for v in INS.VIEWS}
    spec = json.loads(track(E / "cage-spec.json").read_text())
    fit = json.loads(track(E / "fit-all.json").read_text())
    values = np.array(fit["best"]["values"])
    cage = CAGE.build_cage(values, spec)
    CAGE.save_cage(E / "fit-cage.npz", cage)

    render_cov = INS.render_depth(
        {f: cage[f]["grid_w"] for f in cage}, cams)
    union = INS.occluded_union(render_cov, body_maps, transforms)
    regions = INS.region_definitions(land)
    guards = INS.guard_definitions(land)
    panels = [draw_panel(v, union[v], targets[v], regions, guards)
              for v in INS.VIEWS]
    frame = Image.new("RGB", (512 * 3, 540 + 22), (0, 0, 0))
    for i, panel in enumerate(panels):
        frame.paste(panel, (512 * i, 0))
    ImageDraw.Draw(frame).text(
        (8, 540 + 6),
        "red=OCCLUDED fit raster green=target outline boxes=regions "
        "white=eye/mouth guard",
        fill=(200, 200, 200))
    frame.save(E / "fit.png")
    print("FIGURE %s %s" % (E / "fit.png", frame.size), flush=True)

    # --- end heights vs shoulder plane and chin; offsets at shoulder ---
    frame0 = np.load(str(track(Path("/tmp/station0b-run/station-frame.npz"
                                    ))))
    chin_z = float(np.array(frame0["point3d/menton"])[2]) * 1000.0
    crown_z = float(np.array(spec["crown"])[2]) * 1000.0
    drop_sh = crown_z - SHOULDER_Z_MM
    out = {"shoulderPlaneZmm": SHOULDER_Z_MM, "chinZmm": round(chin_z, 1),
           "crownZmm": round(crown_z, 1)}
    for fam in ("temple_L", "temple_R", "back"):
        ch = np.asarray(cage[fam]["centre_head"], dtype=np.float64)
        end = CAGE.head_to_world(ch[-1][None, :], spec["crown"])[0]
        z = float(end[2]) * 1000.0
        u_end = float((spec["crown"][1] - end[1]) * 1000.0)
        # offset at shoulder height: interp (X, U) at drop_sh (ascending)
        drops = ch[:, 2]
        order = np.argsort(drops)
        ds, xs, us = drops[order], ch[order, 0], ch[order, 1]
        x_sh = float(np.interp(drop_sh, ds, xs))
        u_sh = float(np.interp(drop_sh, ds, us))
        out[fam] = {
            "endZmm": round(z, 1),
            "endVsShoulderMm": round(z - SHOULDER_Z_MM, 1),
            "endVsChinMm": round(z - chin_z, 1),
            "endUMm": round(u_end, 1),
            "shoulderXmm": round(x_sh, 1),
            "shoulderUMm": round(u_sh, 1),
        }
        print("HEIGHT %s end z=%.1f (sh %+.1f, chin %+.1f) endU=%.1f "
              "sh@1405 (X=%.1f, U=%.1f)" % (
                  fam, z, z - SHOULDER_Z_MM, z - chin_z, u_end, x_sh, u_sh),
              flush=True)
    # erosion noise floor (printed only, never gated): target vs 1px-eroded
    noise = {}
    for v in INS.VIEWS:
        er = ndimage.binary_erosion(targets[v])
        bf = INS.boundary(targets[v])
        be = INS.boundary(er)
        edt = ndimage.distance_transform_edt(~be)
        fr, fc = np.nonzero(bf)
        dd = edt[fr, fc][~er[fr, fc]] if fr.size else np.zeros(0)
        noise[v] = {"p50": round(float(np.median(dd)), 2) if dd.size else 0.0,
                    "p95": round(float(np.quantile(dd, 0.95)), 2)
                    if dd.size else 0.0, "n": int(dd.size)}
        print("EROSION-noise %s p50=%.2f p95=%.2f (PRINT ONLY, not gated)"
              % (v, noise[v]["p50"], noise[v]["p95"]), flush=True)
    out["erosionNoisePx"] = noise
    out["landmarkConfidencePx"] = land["front"].get("confidence_px", {})
    (E / "heights.json").write_text(
        json.dumps(out, indent=2, sort_keys=True) + "\n")

    # --- Blender Workbench render of the fitted cage on Aisha ---
    body_path = track(ROOT / manifest["body"]["glb"])
    blender_opened = E / "blender-opened.txt"
    cmd = [BLENDER, "--background", "--python",
           str(ROOT / "tools/openclinxr/hair-groom/cage/blender_render.py"),
           "--", "--cage-npz", str(E / "fit-cage.npz"),
           "--outdir", str(E), "--glb", str(body_path),
           "--cameras", str(ROOT / manifest["camerasFile"]["path"]),
           "--opened", str(blender_opened), "--stem", "fit-cage"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(proc.stdout[-3000:])
    sys.stderr.write(proc.stderr[-1000:])
    if proc.returncode != 0:
        raise RuntimeError("blender fit render failed")
    track(blender_opened)
    for line in blender_opened.read_text().split():
        OPENED.append(line)
    CAGE.append_inputs(E, OPENED)
    print("FIGS_DONE")


if __name__ == "__main__":
    main()
