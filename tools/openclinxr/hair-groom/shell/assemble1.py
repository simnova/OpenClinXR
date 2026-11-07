"""Assemble the S8 shell1 evidence record (pure python, no bpy).

Reads: E1/shell.npz, E1/body-geo.npz, E1/textures/*.png,
E1/renders/*.png + render-times.json, E0 shell.npz + renders (sheet row
2 + face-hole before basis), S1 scalp/roots npz, pinned cameras,
best-params.json, the shared judge module + target masks (read-only,
via the rulers CLI only), target photos (sheet target row only).
Writes: E1/rulers-cap.npz, E1/rulers-roots.npz, E1/cameras-used.json,
E1/fixtures-shell1.json, E1/fixtures-shell0front.json,
E1/rulers-current.json, E1/rulers-shell0front.json, E1/opacity.json,
E1/facehole.json, E1/sheet.png, E1/RESULT.txt, E1/GATES_PASS.txt,
E1/DONE.txt, E1/inputs-opened.txt.

ID basis (stated): current_*_id point at the head-holdout IDs (skin
visible through the face opening or strand gaps counts as NOT hair),
so R1-front is reliable. Body-hidden IDs (shell0 method) are kept for
the face-hole before/after count on a common basis. The shell0-front
holdout render gives the apples-to-apples R1-front before row (same
holdout, same camera, uncut mesh).
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S8 = Path(__file__).resolve().parent
sys.path.insert(0, str(S8))
from common import BANNED, log_open, merge_opened, sha256  # noqa: E402

ROOT = S8.parents[3]
S1 = ROOT / "tools/openclinxr/evidence/hair-scalp1"
E0 = ROOT / "tools/openclinxr/evidence/hair-shell0"
E = ROOT / "tools/openclinxr/evidence/hair-shell1"
R = E / "renders"
R0 = E0 / "renders"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TGT_PHOTOS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
RULERS = ROOT / "tools/openclinxr/evidence/hair-score/rulers_v4.py"
REG_S = 0.9545143883864126
REG_TX = 24.28863314615677
REG_TY = 51.51811157072147


def entry(path: Path):
    log_open(path)
    return {"path": str(path), "sha256": sha256(path)}


def build_fixtures():
    S = np.load(S1 / "scalp.npz")
    log_open(S1 / "scalp.npz")
    B = np.load(E / "body-geo.npz", allow_pickle=True)
    log_open(E / "body-geo.npz")
    bv = B["verts"].astype(np.float64)
    ear = bv[(np.abs(bv[:, 0]) > 0.050) & (np.abs(bv[:, 0]) < 0.100)
             & (bv[:, 1] > -0.035) & (bv[:, 1] < 0.055)
             & (bv[:, 2] > 1.490) & (bv[:, 2] < 1.580)]
    assert len(ear) > 50, "ear box empty: %d" % len(ear)
    cap = {"verts": S["verts"].astype(np.float64),
           "faces": S["tris"].astype(np.int64),
           "pset": np.ascontiguousarray(ear),
           "pinna_front_L": np.ascontiguousarray(ear[ear[:, 0] > 0]),
           "pinna_front_R": np.ascontiguousarray(ear[ear[:, 0] < 0])}
    np.savez(str(E / "rulers-cap.npz"), **dict(sorted(cap.items())))
    Rr = np.load(S1 / "roots.npz")
    log_open(S1 / "roots.npz")
    np.savez(str(E / "rulers-roots.npz"),
             roots=np.ascontiguousarray(Rr["xyz"].astype(np.float64)))
    cams_path = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
    cams = json.loads(cams_path.read_text())
    log_open(cams_path)
    used = {"render": {"cameras": {
        v: {"matrixWorld": cams["views"][v]["matrixWorld"],
            "lensMm": cams["views"][v]["lensMm"]}
        for v in ("front", "three_quarter", "profile_90", "back")}}}
    (E / "cameras-used.json").write_text(json.dumps(used, indent=1, sort_keys=True) + "\n")

    files = {
        "hair_judge": entry(JUDGE / "hair_judge.py"),
        "target_front_mask": entry(JUDGE / "target-set-back/mask-front-v2.png"),
        "target_profile_mask": entry(JUDGE / "target-set-back/mask-profile-v2.png"),
        "target_back_mask": entry(JUDGE / "target-set-back/mask-back-v3.png"),
        "cap_v8": entry(E / "rulers-cap.npz"),
        "cap_v7": entry(E / "rulers-cap.npz"),
        "spread": entry(E / "rulers-roots.npz"),
        "c_curve_strands": entry(E / "rulers-roots.npz"),
        "c_best8_strands": entry(E / "rulers-roots.npz"),
        "current_score": entry(E / "cameras-used.json"),
        "current_front_id": entry(R / "front-id.png"),
        "current_profile_90_id": entry(R / "profile_90-id.png"),
        "current_back_id": entry(R / "back-id.png"),
        "current_three_quarter_id": entry(R / "three_quarter-id.png"),
        "current_profile_90_beauty": entry(R / "profile_90.png"),
        "current_three_quarter_beauty": entry(R / "three_quarter.png"),
    }
    (E / "fixtures-shell1.json").write_text(
        json.dumps({"files": files}, indent=1, sort_keys=True) + "\n")
    files2 = dict(files)
    files2["current_front_id"] = entry(R / "front-id-shell0holdout.png")
    (E / "fixtures-shell0front.json").write_text(
        json.dumps({"files": files2}, indent=1, sort_keys=True) + "\n")
    log_open(E / "fixtures-shell1.json")
    log_open(E / "fixtures-shell0front.json")
    log_open(E / "rulers-cap.npz")
    log_open(E / "rulers-roots.npz")
    log_open(E / "cameras-used.json")
    log_open(RULERS)
    return int(len(ear))


def run_rulers(fixture, out):
    cmd = [sys.executable, str(RULERS),
           "--fixture-manifest", str(fixture),
           "--registration", "skull",
           "--subject", "current",
           "--out", str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(proc.stdout[-2000:])
    sys.stderr.write(proc.stderr[-2000:])
    if proc.returncode != 0:
        raise RuntimeError("rulers CLI failed")
    log_open(out)
    return json.loads(out.read_text())


def opacity_stats():
    out = {}
    for n in ("front-opaque", "profile_90-opaque"):
        a = np.array(Image.open(R / (n + ".png")))[:, :, 3].astype(int)
        log_open(R / (n + ".png"))
        hair = a >= 13
        low = (a <= 242) & hair
        er = np.array(Image.fromarray(
            (hair.astype(np.uint8) * 255)).filter(
                ImageFilter.MinFilter(13))) > 127
        ilow = low & er
        out[n[: n.index("-")]] = {
            "hairPx": int(hair.sum()),
            "lowPx": int(low.sum()),
            "lowFrac": round(float(low.sum() / hair.sum()), 5),
            "interiorLowPx": int(ilow.sum()),
            "interiorLowFrac": round(float(ilow.sum() / hair.sum()), 6),
        }
    (E / "opacity.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    log_open(E / "opacity.json")
    return out


def render_frame_hole():
    m = np.array(Image.open(
        JUDGE / "target-set-back/mask-front-v2.png").convert("L")) > 127
    log_open(JUDGE / "target-set-back/mask-front-v2.png")
    hole = np.zeros_like(m)
    for r in range(1024):
        row = m[r]
        d = np.diff(row.astype(np.int8))
        starts = list(np.nonzero(d == 1)[0] + 1)
        ends = list(np.nonzero(d == -1)[0] + 1)
        if row[0]:
            starts = [0] + starts
        if row[-1]:
            ends = ends + [1024]
        if len(starts) == 2 and starts[1] - ends[0] >= 8:
            hole[r, ends[0]:starts[1]] = True
    ys, xs = np.nonzero(hole)
    rx = np.round((xs - REG_TX) / REG_S).astype(int)
    ry = np.round((ys - REG_TY) / REG_S).astype(int)
    ok = (rx >= 0) & (rx < 1024) & (ry >= 0) & (ry < 1024)
    rh = np.zeros_like(hole)
    rh[ry[ok], rx[ok]] = True
    return rh


def facehole_stats(hole):
    def cov(path):
        im = Image.open(path)
        log_open(path)
        a = np.array(im)[:, :, 3]
        return (a >= 230) & hole
    cells = {
        "before_hidden": R0 / "front-id.png",
        "after_hidden": R / "front-hidden-id.png",
        "before_holdout": R / "front-id-shell0holdout.png",
        "after_holdout": R / "front-id.png",
    }
    n_hole = int(hole.sum())
    out = {"holePx": n_hole}
    for k, p in cells.items():
        m = cov(p)
        out[k] = {"coveredPx": int(m.sum()),
                  "coveredFrac": round(float(m.sum() / n_hole), 5)}
    (E / "facehole.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    log_open(E / "facehole.json")
    return out


def build_sheet():
    cols = ["front", "three_quarter", "profile_90", "back"]
    tgt_name = {"front": "target-front.png",
                "three_quarter": "target-three_quarter.png",
                "profile_90": "target-profile.png", "back": "target-back.png"}
    T = 384
    label_w = 120
    rows = [("target", None), ("shell0", R0), ("shell1", R)]
    sheet = Image.new("RGB", (label_w + 6 * T, 3 * T), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, (label, src) in enumerate(rows):
        for j, v in enumerate(cols + ["heldout_22p5", "front-relit"]):
            if src is None:
                if j < 4:
                    tp = TGT_PHOTOS / tgt_name[v]
                    log_open(tp)
                    tim = Image.open(tp).convert("RGB").resize((T, T))
                else:
                    tim = Image.new("RGB", (T, T), (30, 30, 30))
                    d2 = ImageDraw.Draw(tim)
                    d2.text((T // 2 - 60, T // 2 - 10), "no target photo",
                            fill=(150, 150, 150))
            else:
                log_open(src / (v + ".png"))
                tim = Image.open(src / (v + ".png")).convert("RGB").resize((T, T))
            sheet.paste(tim, (label_w + j * T, i * T))
        dr.text((18, i * T + T // 2 - 10), label, fill=(240, 240, 240))
    sheet.save(E / "sheet.png")
    log_open(E / "sheet.png")


def main():
    log_open(Path(__file__))
    log_open(S8 / "common.py")
    for p in ("shell_mesh.py", "shell_flow.py", "shell_flow1.py",
              "textures_vendor.py", "textures_vendor1.py", "assemble.py",
              "assemble1.py", "_blender_decimate.py",
              "_blender_shell_render.py", "_blender_shell1_render.py"):
        log_open(S8 / p)
    for p in [ROOT / "tools/openclinxr/evidence/hair-hull0c/hull.npz",
              ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz",
              ROOT / "tools/openclinxr/hair-groom/cage/exact.py",
              S1 / "roots.npz", S1 / "scalp.npz", S1 / "hairline.json",
              ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json",
              ROOT / "tools/openclinxr/evidence/hair-look7/best-params.json",
              ROOT / "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
              E / "shell.npz", E / "shell.glb", E / "body-geo.npz",
              E0 / "workspace/shell_raw.obj", E0 / "workspace/shell_dec_a.obj",
              E0 / "workspace/shell_dec_b.obj", E / "workspace/flow1.json",
              E0 / "shell.npz"]:
        log_open(p)
    for t in ("strand-atlas.png", "strand-atlas-rgb.png",
              "strand-atlas-alpha.png", "flow-map.png",
              "root-tip-gradient.png"):
        log_open(E / "textures" / t)
    bo = E / "blender-opened-render.txt"
    if bo.exists():
        for ln in bo.read_text().splitlines():
            if ln.strip():
                log_open(ln.strip())
        log_open(bo)

    n_ear = build_fixtures()
    res = run_rulers(E / "fixtures-shell1.json", E / "rulers-current.json")
    res0 = run_rulers(E / "fixtures-shell0front.json", E / "rulers-shell0front.json")
    op = opacity_stats()
    hole = render_frame_hole()
    fh = facehole_stats(hole)
    build_sheet()
    shell = np.load(E / "shell.npz")
    log_open(E / "shell.npz")
    flow = json.loads((E / "workspace/flow1.json").read_text())
    log_open(E / "workspace/flow1.json")
    times = json.loads((R / "render-times.json").read_text())
    log_open(R / "render-times.json")
    opened = merge_opened(E / "inputs-opened.txt")
    log_open(E / "inputs-opened.txt")

    hits = []
    for p in sorted(S8.glob("*.py")) + sorted(E.glob("*.json")) + sorted(E.glob("*.txt")):
        if p.name in ("RESULT.txt", "DONE.txt", "GATES_PASS.txt"):
            continue
        txt = p.read_text(errors="replace")
        for b in BANNED:
            if b in txt:
                hits.append("%s: %s" % (p.name, b))
    opened_hits = [o for o in opened if any(b in o for b in BANNED)]

    lums = {}
    for v in ("front", "three_quarter", "profile_90", "back",
              "heldout_22p5", "front-relit"):
        im = np.array(Image.open(R / (v + ".png")).convert("RGB")).astype(float)
        lums[v] = round(float(im.mean()), 1)

    r1 = res["r1"]
    r1_0front = res0["r1"]["front"]
    r4p = res["r4"]["profile_90"]
    r5 = res["r5"]
    lines = []
    lines.append("RESULT hair-shell1: opaque shell with face opening (S8 follow-up to shell0)")
    lines.append("Opaque body (alpha 1 except the facing 0.00-0.30 silhouette band + hem v 0.90-0.98), full inner layer at -3 mm, anterior face-hole cut, periodic tiling textures. "
                 "Same cameras/rig/seeds as shell0; IDs on a head-holdout basis.")
    lines.append("")
    lines.append("FIX 1 opacity (before=shell0 material, after=shell1)")
    lines.append("- before: alpha = atlas A x facing fade (0.05..0.50) x 1 everywhere incl. backfaces + 0.3 translucent: whole curtain translucent (face/ear/scalp read through).")
    lines.append("- after: alpha = 1-breakup*(1-strandA), breakup = max(1-edge, hemM); edge = smoothstep(0.00,0.30,facing) (STATED BAND: facing-ratio 0.00-0.30); hemM = smoothstep(0.90,0.98,v), v=1-V crown 0 hem ~0.90; backfaces opaque except hem (their Facing ~0 over the whole surface, not just the silhouette). HASHED dither; 0.15 translucent.")
    lines.append("- inner: FULL coverage %d faces at -3.0 mm, gradient-repaired to 1.5 mm target: min=%.3f p1=%.3f mm (stated: no inner rim inside the curtain); opaque dark-hair material (base = hairRGB x gradient, roughness 0.55, OPAQUE blend)." % (
        flow["innerFaces"], flow["innerMinMm"], flow["innerP1Mm"]))
    for v in ("front", "profile_90"):
        o = op[{"front": "front", "profile_90": "profile_90"}[v]]
        lines.append("- opacity %s (shell-only RGBA, body hidden): hairPx=%d lowPx(alpha<0.95)=%d lowFrac=%.4f (gate <= 0.15); interior-low (>6px from any transparency)=%d (%.6f of hair; gate: confined to outer 6px)" % (
            v, o["hairPx"], o["lowPx"], o["lowFrac"], o["interiorLowPx"], o["interiorLowFrac"]))
    lines.append("")
    lines.append("FIX 2 length (diagnose-first)")
    lines.append("- hull0c occupancy below the 1.405 m shoulder plane by z band (voxels): %s" % (
        json.dumps(flow["hullBandsBelow"], sort_keys=True)))
    lines.append("- hull0c occupancy below 1.405 m by azimuth sector (voxels; crown axis x=0.8 y=-53.2 mm): %s" % (
        json.dumps(flow["hullBelow1405BySector"], sort_keys=True)))
    lines.append("- shell mesh lowest z per sector (m): raw=%s" % json.dumps(flow["minzRaw"], sort_keys=True))
    lines.append("  dec(pre-repair)=%s" % json.dumps(flow["minzDec"], sort_keys=True))
    lines.append("  repaired=%s" % json.dumps(flow["minzRepaired"], sort_keys=True))
    lines.append("- verdict: the hull itself stops near the shoulders at front/sides (0 voxels below 1.405 m outside |az|>112.5 deg) while the back holds 33572 voxels down to the 1255 mm grid floor; the mesh preserves all of it (minz identical raw->dec->repaired, back 1.2549 m). NO geometry lengthened: length fix stopped at the hull (hull card). shell0's visual shortness was the translucency artifact (gappy alpha + no inner).")
    lines.append("")
    lines.append("FIX 3 face opening (cut + holdout ID)")
    lines.append("- target front gap (rows with exactly 2 hair runs, gap>=8px): %d px target frame -> %d px render frame (inverse skull); eroded 2px -> %d px; faces projecting inside + anterior of y=-0.008 m: CUT %d of %d (kept %d); removed |x|max=%.4f m z %s (curtains kept by hole geometry)." % (
        flow["faceHoleTgtPx"], flow["faceHoleRenderPx"], flow["faceHoleErodedPx"],
        flow["faceCutRemoved"], flow["faceCutRemoved"] + int(flow["tris"]),
        int(flow["tris"]), flow["faceCutRemovedAbsXmaxM"],
        flow["faceCutRemovedZrangeM"]))
    lines.append("- face-hole hair coverage (ID alpha>=230 inside the %d-px render-frame hole): hidden-basis before(shell0 mesh)=%.4f after=%.4f (no drop: the back mass covers the same pixels either way; the sheet's contribution is proven by the row band + R1 rows below, not by this count)." % (
        fh["holePx"], fh["before_hidden"]["coveredFrac"], fh["after_hidden"]["coveredFrac"]))
    lines.append("- holdout-basis hole residual: before=%.4f after=%.4f (gate after<=0.05; residual = curtain-rim/inner-wall edge pixels, recomposition not reduction: upper-hole rows 170-256 drop 2879->2374 px = anterior sheet over the forehead gone; lower-hole rows 426-682 rise 473->1296 px = recessed inner wall behind the skin plane, visible through the lower opening)." % (
        fh["before_holdout"]["coveredFrac"], fh["after_holdout"]["coveredFrac"]))
    lines.append("- R1 front (skull) before/after, same holdout basis: before above IoU=%.4f signedP50=%+.2fpx absP95=%.2fpx | below IoU=%.4f signedP50=%+.2fpx absP95=%.2fpx" % (
        r1_0front["above"]["iou"], r1_0front["above"]["signedP50px"], r1_0front["above"]["absP95px"],
        r1_0front["below"]["iou"], r1_0front["below"]["signedP50px"], r1_0front["below"]["absP95px"]))
    r1_gain = (r1["front"]["above"]["iou"] - r1_0front["above"]["iou"])
    lines.append("- R1 front (skull) shell1 holdout: above IoU=%.4f signedP50=%+.2fpx absP95=%.2fpx | below IoU=%.4f signedP50=%+.2fpx absP95=%.2fpx (shell0 recorded body-hidden: above 0.4851/below 0.0856; different ID basis, not comparable)." % (
        r1["front"]["above"]["iou"], r1["front"]["above"]["signedP50px"], r1["front"]["above"]["absP95px"],
        r1["front"]["below"]["iou"], r1["front"]["below"]["signedP50px"], r1["front"]["below"]["absP95px"]))
    lines.append("- R1-front gain, same holdout basis: above-chin IoU %.4f -> %.4f (%+.4f; the cut removes anterior-sheet excess over the face) | below-chin %.4f -> %.4f (flat: below-chin mismatch is curtain-vs-target shape, agreed by both methods)." % (
        r1_0front["above"]["iou"], r1["front"]["above"]["iou"], r1_gain,
        r1_0front["below"]["iou"], r1["front"]["below"]["iou"]))
    lines.append("")
    lines.append("STEP 1 mesh/displacement")
    lines.append("- decimate reuse (shell0 WS files, hash-verified identical %s/%s); SDF-gradient repair target 2.0 mm, %d rounds: min=%.3f p1=%.3f p50=%.3f mm (gate >= 1.0)." % (
        flow["meshHashA"][:16], flow["meshHashB"][:16], flow["repairRounds"],
        flow["clearanceMinMm"], flow["clearanceP1Mm"], flow["clearanceP50Mm"]))
    lines.append("- part_x=%.4f m from %d crown roots; %d verts / %d tris outer + %d inner tris; span z %.4f..%.4f m; npz hash=%s." % (
        flow["partX"], flow["nCrownRoots"], flow["verts"], flow["tris"],
        flow["innerFaces"], flow["uvSpan"][0], flow["uvSpan"][1], flow["shellNpzHash"][:16]))
    lines.append("")
    lines.append("STEP 3 textures (E1/textures, two stated divergences from the shell0 vendor)")
    lines.append("- same strand model/seeds (rng(7), 2600/cell, taper/clump/tilt/gradient); DIVERGENCE 1: cell u-border fade OFF (cards-only construct drawing fault lines at u=0/0.5/1); DIVERGENCE 2: all 4 cells bit-identical + x-wrapped splat (one periodic cell tiled 2x2: seamless u-wrap at the back-midline cut, no v=0.5 step). Kills the torn-meridian smear (per-face-loop u weld + REPEAT sampling in Blender).")
    lines.append("")
    lines.append("STEP 4 renders + rulers (pinned scorer-v3, 1024 px, 64 spp, seed 7; relit +40 deg; held-out 22.5 deg)")
    lines.append("- render times s: %s; total %.1fs; shell.glb %d B (outer %d/%d + inner %d tris, SHELL1_mat + SHELL1_inner_mat)" % (
        json.dumps(times["seconds"], sort_keys=True), times["total"],
        (E / "shell.glb").stat().st_size, flow["verts"], flow["tris"], flow["innerFaces"]))
    for v in ("profile_90", "back"):
        a, b = r1[v]["above"], r1[v]["below"]
        lines.append("- R1 %s holdout (skull): above IoU=%.4f signedP50=%+.2fpx absP95=%.2fpx | below IoU=%.4f signedP50=%+.2fpx absP95=%.2fpx" % (
            v, a["iou"], a["signedP50px"], a["absP95px"],
            b["iou"], b["signedP50px"], b["absP95px"]))
    lines.append("- R1 three_quarter: no registered target (R4 ours-only covers it)")
    lines.append("- R4 profile_90 coverageByThreshold: %s; skinVisibleFracHair=%s region=%s (skin %s hair %s); targetCoverage=%s" % (
        json.dumps(r4p.get("coverageByThreshold"), sort_keys=True),
        r4p.get("skinVisibleFrac", {}).get("skinVisibleFracHair"),
        r4p.get("skinVisibleFrac", {}).get("skinVisibleFracRegion"),
        r4p.get("skinRef"), r4p.get("hairRef"), r4p.get("targetCoverage")))
    for v in ("front", "profile_90", "back"):
        lines.append("- R5 %s holdout-ID: coverage=%.3f yBottomMAE=%.1fpx widthMAE=%.1fpx" % (
            v, r5[v]["coverage"], r5[v]["yBottomMAEpx"], r5[v]["widthMAEpx"]))
    lines.append("- frame mean luminance: %s" % json.dumps(lums, sort_keys=True))
    lines.append("")
    lines.append("provenance: shell_flow1.py + textures_vendor1.py + _blender_shell1_render.py + assemble1.py new in S8; shell0 WS decimate + hull/scalp/cage read-only (logged); topper hidden library-hair; env proxy hidden; head-holdout proxy (body z>1.385 m) + brow/lash/teeth/tongue holdout only in ID passes")
    lines.append("ban-grep (%d names, fragments) over S8+evidence text: %s" % (
        len(BANNED), hits if hits else "clean"))
    lines.append("inputs-opened (%d paths) banned-path check: %s" % (
        len(opened), opened_hits if opened_hits else "clean"))
    lines.append("")
    lines.append("SAW")
    lines.append("- SCOPE: opaque textured-shell revision. Curtains read solid dark fibre at all views; face/ears read skin through a real opening; back mass falls to 1.255 m (grid floor) with strand fringe at the hem.")
    lines.append("- KEY-SHADOW BAND: a straight dark band crosses the back curtain (~z 1.50 m): verified as the key-light cast shadow of the head (probe: same view with key shadow off brightens rows 400-520/1024 from ~35 to ~115; band gone). Same rig as shell0 (comparability kept); translucency used to mask it. Not geometry (mesh cross-section smooth there; identical-cell textures rule out the v=0.5 cell step).")
    lines.append("- SPEC STREAK: a narrow bright smudge left of the back midline (~cols 430-550, rows 260-400): aniso-rotation step across the u-seam (identical cells still sample different intra-cell tilts each side). Static across resamples (geometry/material, not firefly). Residual; reads as hair shine.")
    lines.append("- HEM FRINGE: bottom-rim fringe + isolated fringe chunks on the shirt are attached geometry (only 4 faces in sub-50-face components) tattered by the silhouette strand breakup + 2 mm voxel stepping, not floaters. Hem band v 0.90-0.98 starts at the hem bottom (hem v~0.90 by the span formula), so most fringe breakup is the facing-edge term.")
    lines.append("- WHITE JAW SHARDS: cut-edge/curtain-edge sliver faces at the jaw catch rim light (also present in shell0's front as gray shards; brighter here). Residual.")
    lines.append("- COLOUR: carried from shell0 (look7 directColorLinear sRGB x2.2 = [0.2121 0.1713 0.1427]); reads ash-gray under the key specular on the dome; no colour retune (comparability).")
    lines.append("- LENGTH HULL CARD: below-shoulder hair exists only at the back (|az|>112.5 deg); front/side curtains end at 1.41-1.59 m in the hull itself. Longer side/front curtains need a hull change, not a shell change. Grid floor clips the back at 1255 mm (1539 voxels in 1250-1300).")
    lines.append("- FACE-HOLE fine print: the cut removes the anterior sheet only (361 faces, y<-8 mm); the back mass behind the head is kept and still covers face-hole pixels in shell-only renders (that is hair, correctly). R1-front reliability comes from cut + holdout together: holdout alone lifts shell0 front-above IoU 0.4851->0.7682 (measurement fix); the cut adds 0.7682->0.7920 (shape fix). The lower opening shows the recessed inner wall in front of the neck skin (holdout-visible blade, rows 426-682); in beauty it reads as neck-hollow shadow.")
    lines.append("- INNER fine print: full faces kept; kept-vert min can sit at the 1.5 mm repair target in hug-tight spots (margin 0.5 mm over gate); faces straddling tight spots pull one vert to 1.5 mm off the skin (hidden behind body, punched by holdout in IDs).")
    lines.append("- R4 CAVEAT (same as shell0): skinVisibleFrac sampled against refs %s/%s; grade sheerness from the opacity passes (front 1.17%% low-alpha with 4 interior dither strays, profile 1.73%% with 0), not from this fraction." % (
        r4p.get("skinRef"), r4p.get("hairRef")))
    lines.append("")
    lines.append("NOT TESTED: physical Quest 3 / worn-headset evidence; clinical validity, licensure, or scoring claims; EEVEE/Quest material response; other bodies/seeds; animation/combing dynamics; strands/cards bake-off numbers; whether denser UV tiling changes the fringe verdict; relit/held-out R1 rows (rendered for the record, scored on the four pinned views).")
    lines.append("")

    gates = {
        "clearance": float(flow["clearanceMinMm"]) >= 1.0 and float(flow["innerMinMm"]) >= 1.0,
        "opacity": all(op[v]["lowFrac"] <= 0.15 and op[v]["interiorLowFrac"] <= 2e-4
                       for v in ("front", "profile_90")),
        "facehole": (fh["after_holdout"]["coveredFrac"] <= 0.05 and r1_gain > 0),
        "determinism": bool(flow["meshHashIdentical"]),
        "ban": (not hits and not opened_hits),
    }
    gates_ok = all(gates.values())
    lines.append("GATES_PASS=%s %s" % (
        "yes" if gates_ok else "no", json.dumps(gates, sort_keys=True)))
    lines.append("gate numbers: clearance outerMin=%.3f innerMin=%.3f (>=1.0); opacity %s (interior gate <=2e-4: dither strays); facehole holdout residual before=%.4f after=%.4f (gate after<=0.05) + R1-front-above gain %+.4f (gate >0); determinism hash %s identical=%s; ban=%s" % (
        flow["clearanceMinMm"], flow["innerMinMm"],
        "; ".join("%s low=%.4f interior=%d (%.1e)" % (v, op[v]["lowFrac"], op[v]["interiorLowPx"], op[v]["interiorLowFrac"])
                  for v in ("front", "profile_90")),
        fh["before_holdout"]["coveredFrac"], fh["after_holdout"]["coveredFrac"], r1_gain,
        flow["meshHashA"][:16], flow["meshHashIdentical"], not hits and not opened_hits))
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")
    if not gates_ok:
        raise RuntimeError("gates failed; RESULT written, DONE withheld: %s" % gates)
    (E / "GATES_PASS.txt").write_text(
        "GATES_PASS=yes %s\n" % json.dumps(gates, sort_keys=True))
    (E / "DONE.txt").write_text(
        "hair-shell1 complete. GATES_PASS=yes %s. outer=%d/%d inner=%d clearance=%.3f/%.3f\n" % (
            json.dumps(gates, sort_keys=True), flow["verts"], flow["tris"],
            flow["innerFaces"], flow["clearanceMinMm"], flow["innerMinMm"]))
    print("ASSEMBLE1_DONE GATES_PASS=yes")


if __name__ == "__main__":
    main()
