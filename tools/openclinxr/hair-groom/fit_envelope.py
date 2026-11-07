"""Station0b volume check: fit the frozen envelope, leave-one-view-out.

Reads E/envelope-spec.json (records its sha BEFORE fitting), the pinned
cameras + masks, the offline body SDF. Fits with scipy least_squares on
the contour loss from envelope.py, runs the three leave-one-view-out
fits + the all-view fit, scores held-out contours, runs the fixed-plane
probe, renders fit.png + the three_quarter validation, and writes
feasibility.json + inputs-opened.txt. No renderer, no network.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, optimize

STATION = Path(__file__).resolve().parent
sys.path.insert(0, str(STATION))
import envelope as ENV  # noqa: E402
import register as REG  # noqa: E402

VIEWS = ("front", "profile_90", "back")
FIT_VIEWS = {
    "all": ("front", "profile_90", "back"),
    "holdout-front": ("profile_90", "back"),
    "holdout-profile_90": ("front", "back"),
    "holdout-back": ("front", "profile_90"),
}
HELD = {
    "holdout-front": "front",
    "holdout-profile_90": "profile_90",
    "holdout-back": "back",
}
STARTS = {
    "spec": None,  # spec inits
    "long-wide": {
        "cap_top": 20.0, "crown_w": 70.0, "apex_front": 55.0, "apex_back": 55.0,
        "hairline_z": 80.0, "side_hl": 25.0, "back_hl": 25.0, "side_ear": 25.0,
        "back_ear": 25.0, "curtain_front_ear": 80.0, "side_jaw": 35.0,
        "jaw_front": 80.0, "back_jaw": 35.0, "hem_drop": 450.0,
        "hem_halfw": 130.0, "hem_front": 95.0, "hem_back": -120.0,
    },
    "narrow-short": {
        "cap_top": 10.0, "crown_w": 50.0, "apex_front": 30.0, "apex_back": 35.0,
        "hairline_z": 55.0, "side_hl": 8.0, "back_hl": 8.0, "side_ear": 10.0,
        "back_ear": 10.0, "curtain_front_ear": 70.0, "side_jaw": 15.0,
        "jaw_front": 70.0, "back_jaw": 15.0, "hem_drop": 300.0,
        "hem_halfw": 90.0, "hem_front": 60.0, "hem_back": -90.0,
    },
}
OPENED = []


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def load_mask(path):
    return np.asarray(Image.open(track(path)).convert("L")) > 127


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--station-run", required=True,
                        help="station0b run dir (registration + frame)")
    parser.add_argument("--max-nfev", type=int, default=200)
    parser.add_argument("--only", default=None,
                        help="run a single fit tag (default: all four)")
    args = parser.parse_args()
    evidence = Path(args.evidence)
    evidence.mkdir(parents=True, exist_ok=True)
    run_dir = Path(args.station_run)

    for name in ("envelope.py", "register.py", "fit_envelope.py",
                 "export_frame.py", "run.py"):
        track(STATION / name)

    spec_path = track(evidence / "envelope-spec.json")
    spec = json.loads(spec_path.read_text())
    spec_sha = sha256_file(spec_path)
    print("SPEC_SHA %s (recorded before fitting)" % spec_sha, flush=True)
    anchors = spec["anchors"]
    crown = spec["crown"]
    params_meta = spec["params"]
    names = [q["name"] for q in params_meta]
    assert names == list(ENV.PARAM_ORDER), "spec params != station order"
    x0 = np.array([q["init_mm"] for q in params_meta], dtype=np.float64)
    lo = np.array([q["lo_mm"] for q in params_meta], dtype=np.float64)
    hi = np.array([q["hi_mm"] for q in params_meta], dtype=np.float64)

    rel = spec["pins"]["camerasFile"]["path"]
    cams_path = track(STATION.parents[2] / rel)
    cams = json.loads(cams_path.read_text())
    sensor = float(cams["sensorWidthMm"])
    transforms = {}
    for view in VIEWS:
        a_r, b_r, c_r = cams["registrationRenderTriples"][view]
        a_t, b_t, c_t = cams["registrationTargetTriples"][view]
        transforms[view] = REG.similarity_from_triples(a_r, b_r, c_r, a_t, b_t, c_t)

    reg_path = track(run_dir / "registration.json")
    reg = json.loads(reg_path.read_text())
    reg_rms = max(
        reg["views"][v]["residuals"]["rms_px"] for v in VIEWS
    )
    threshold = max(2.0 * reg_rms, 12.0)

    mask_paths = {
        "front": "/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
        "tools/openclinxr/evidence/hair-judge/target-set-back/mask-front-v2.png",
        "profile_90": "/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
        "tools/openclinxr/evidence/hair-judge/target-set-back/mask-profile-v2.png",
        "back": "/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
        "tools/openclinxr/evidence/hair-judge/target-set-back/mask-back-v3.png",
    }
    targets = {view: load_mask(mask_paths[view]) for view in VIEWS}
    for view in VIEWS:
        assert targets[view].shape == (1024, 1024), view

    grid = ENV.load_sdf(track(evidence / "body-sdf.npz"))
    sdf_doc = np.load(str(evidence / "body-sdf.npz"))
    tol_mm = float(sdf_doc["tolMm"])
    pitch = {}
    for view in VIEWS:
        crown3 = np.array(crown, dtype=np.float64)[None, :]
        _, _, depth = ENV.project_to_render(
            crown3, cams["views"][view], sensor)
        focal = float(cams["views"][view]["lensMm"]) / sensor * ENV.FRAME
        pitch[view] = float(depth[0]) * 1000.0 / focal

    pre = {}
    for view in VIEWS:
        t = targets[view]
        bt = ENV.boundary(t)
        pre[view] = {
            "edt": ndimage.distance_transform_edt(~bt),
            "boundary": bt,
        }

    def fitted_masks(p):
        verts, faces = ENV.build_world_mesh(p, anchors, crown)
        out = {}
        for view in VIEWS:
            out[view] = ENV.render_mask(
                verts, faces, cams["views"][view], transforms[view])
        return verts, faces, out

    def residuals(p, views):
        verts, faces, masks = fitted_masks(p)
        parts = []
        for view in views:
            r = ENV.contour_residuals(
                masks[view], targets[view],
                delta=spec["loss"]["huberDeltaPx"])
            parts.append(r)
        sdf = ENV.query_sdf(grid, verts * 1000.0)
        pen = np.maximum(-(sdf) - tol_mm, 0.0)
        parts.append(
            spec["loss"]["collisionWeight"]
            * ENV.huber(pen, spec["loss"]["collisionDeltaMm"])
        )
        idx = {name: i for i, name in enumerate(names)}
        seqs = [
            ["side_hl", "side_ear", "side_jaw"],
            ["back_hl", "back_ear", "back_jaw"],
            ["curtain_front_ear", "jaw_front", "hem_front"],
        ]
        smooth = []
        for seq in seqs:
            v = np.array([p[idx[n]] for n in seq])
            smooth.append(v[2] - 2.0 * v[1] + v[0])
        parts.append(spec["loss"]["smoothWeight"] * np.array(smooth))
        return np.concatenate(parts)

    def contour_stats(fitted, view):
        t = targets[view]
        bf = ENV.boundary(fitted)
        bt = pre[view]["boundary"]
        edt_f = ndimage.distance_transform_edt(~bf)
        edt_t = pre[view]["edt"]
        fr, fc = np.nonzero(bf)
        tr, tc = np.nonzero(bt)
        d1 = edt_t[fr, fc].astype(np.float64)
        d2 = edt_f[tr, tc].astype(np.float64)
        pooled = np.concatenate([d1, d2])
        return {
            "nFitted": int(fr.shape[0]),
            "nTarget": int(tr.shape[0]),
            "p50px": round(float(np.median(pooled)), 2),
            "p95px": round(float(np.quantile(pooled, 0.95)), 2),
            "p50mm": round(float(np.median(pooled)) * pitch[view], 2),
            "p95mm": round(float(np.quantile(pooled, 0.95)) * pitch[view], 2),
            "pitchMmPx": round(pitch[view], 4),
        }

    def saturation(p):
        span = hi - lo
        gap = np.minimum(p - lo, hi - p) / span
        j = int(np.argmin(gap))
        return {
            "minGapFrac": round(float(gap[j]), 4),
            "minGapParam": names[j],
            "saturated": bool((gap < 0.01).any()),
            "saturatedParams": [names[i] for i in range(len(names))
                                if gap[i] < 0.01],
        }

    def collision(p):
        verts, _ = ENV.build_world_mesh(p, anchors, crown)
        sdf = ENV.query_sdf(grid, verts * 1000.0)
        pen = np.maximum(-(sdf) - tol_mm, 0.0)
        return {
            "maxPenMm": round(float(pen.max()), 2),
            "nViol": int((sdf < -tol_mm).sum()),
            "minSdfMm": round(float(sdf.min()), 2),
            "tolMm": tol_mm,
        }

    fits = {}
    masks_by_fit = {}
    scale = hi - lo
    tags = [args.only] if args.only else list(FIT_VIEWS)
    for tag in tags:
        views = FIT_VIEWS[tag]
        fun = lambda p: residuals(p, views)  # noqa: E731
        starts = {}
        best_cost, best_sol = float("inf"), None
        for sname, sdict in STARTS.items():
            xstart = (x0 if sdict is None else np.array(
                [sdict[n] for n in names], dtype=np.float64))
            assert bool(((xstart >= lo) & (xstart <= hi)).all()), sname
            sol = optimize.least_squares(
                fun, xstart, bounds=(lo, hi), method="trf",
                ftol=1e-10, xtol=1e-10, gtol=1e-10, max_nfev=args.max_nfev,
                x_scale=scale, diff_step=0.05 * scale,
            )
            starts[sname] = {
                "cost": round(float(sol.cost), 3),
                "nfev": int(sol.nfev),
                "status": int(sol.status),
            }
            print("  start %s cost=%.1f nfev=%d status=%d" % (
                sname, sol.cost, sol.nfev, sol.status), flush=True)
            if sdict is None or sol.cost < best_cost:
                best_cost, best_sol = float(sol.cost), sol
        sol = best_sol
        sol = best_sol
        p = np.array(sol.x, dtype=np.float64)
        verts, faces, masks = fitted_masks(p)
        masks_by_fit[tag] = masks
        entry = {
            "views": list(views),
            "starts": starts,
            "params": {n: round(float(v), 3) for n, v in zip(names, p)},
            "cost": round(float(sol.cost), 3),
            "nfev": int(sol.nfev),
            "optimality": round(float(sol.optimality), 4),
            "status": int(sol.status),
            "saturation": saturation(p),
            "collision": collision(p),
            "inSample": {v: contour_stats(masks[v], v) for v in views},
        }
        if tag in HELD:
            held = HELD[tag]
            entry["heldOut"] = {held: contour_stats(masks[held], held)}
        fits[tag] = entry
        print("FIT %s cost=%.1f nfev=%d sat=%s coll=%s" % (
            tag, sol.cost, sol.nfev, entry["saturation"]["saturatedParams"],
            entry["collision"]), flush=True)
        for v in views:
            print("  in %s p50/p95 %s/%s px" % (
                v, entry["inSample"][v]["p50px"], entry["inSample"][v]["p95px"]),
                flush=True)
        if tag in HELD:
            h = HELD[tag]
            print("  HELD %s p50/p95 %s/%s px" % (
                h, entry["heldOut"][h]["p50px"], entry["heldOut"][h]["p95px"]),
                flush=True)

    (evidence / "fits.json").write_text(
        json.dumps({"specSha": spec_sha, "thresholdPx": threshold,
                    "regRmsPx": reg_rms, "fits": fits},
                   indent=2, sort_keys=True) + "\n")

    if args.only:
        (evidence / "inputs-opened.txt").write_text(
            "\n".join(sorted(set(OPENED))) + "\n")
        return

    fixed = fixed_plane_probe(cams, sensor, targets, grid, tol_mm)
    (evidence / "fixed-plane.json").write_text(
        json.dumps(fixed, indent=2, sort_keys=True) + "\n")

    draw_fit_figure(evidence, targets, masks_by_fit)
    three_q = draw_three_quarter(evidence, cams, sensor, anchors, crown)

    verdict, reason = decide(fits, threshold)
    feasibility = {
        "specSha": spec_sha,
        "thresholdPx": threshold,
        "regRmsPx": reg_rms,
        "heldOut": {
            HELD[tag]: fits[tag]["heldOut"][HELD[tag]] for tag in HELD
        },
        "saturation": {tag: fits[tag]["saturation"] for tag in FIT_VIEWS},
        "collision": {tag: fits[tag]["collision"] for tag in FIT_VIEWS},
        "fixedPlane": fixed,
        "threeQuarter": three_q,
        "verdict": verdict,
        "reason": reason,
    }
    (evidence / "feasibility.json").write_text(
        json.dumps(feasibility, indent=2, sort_keys=True) + "\n")
    print("VERDICT %s: %s" % (verdict, reason), flush=True)

    (evidence / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(OPENED))) + "\n")


def decide(fits, threshold):
    problems = []
    for tag in HELD:
        held = HELD[tag]
        p95 = fits[tag]["heldOut"][held]["p95px"]
        if p95 > threshold:
            problems.append("%s p95 %.1fpx > %.1fpx" % (held, p95, threshold))
    for tag in FIT_VIEWS:
        sat = fits[tag]["saturation"]["saturatedParams"]
        if sat:
            problems.append("%s saturated %s" % (tag, sat))
        coll = fits[tag]["collision"]
        if coll["maxPenMm"] > 0:
            problems.append("%s collision %.1fmm" % (tag, coll["maxPenMm"]))
    if problems:
        return "STOP", "; ".join(problems)
    return "PASS", ("every held-out p95 <= %.1fpx, no bound saturates, "
                    "collision 0" % threshold)


def fixed_plane_probe(cams, sensor, targets, grid, tol_mm):
    """Descriptive Grok fixed-plane numbers: hem rays per view meet the
    plane 25 mm behind the body surface at that z; report medians."""
    out = {"views": {}, "note": "descriptive only; not part of the verdict"}
    medians_z, medians_y = [], []
    for view in VIEWS:
        t = targets[view]
        rows = np.nonzero(t)[0]
        hem_min = float(np.quantile(rows, 0.97))
        row_index = np.arange(1024)[:, None]
        rr, cc = np.nonzero(t & (row_index >= hem_min))
        sel = np.zeros(rr.shape[0], dtype=bool)
        sel[::5] = True
        rr, cc = rr[sel][:500], cc[sel][:500]
        cam = cams["views"][view]
        mat = np.array(cam["matrixWorld"], dtype=np.float64)
        rot = mat[:3, :3]
        c0 = np.array(cam["location"], dtype=np.float64) * 1000.0
        focal = float(cam["lensMm"]) / sensor * ENV.FRAME
        def ray(c, r):
            local = np.array([(c - 512.0) / focal, -(r - 512.0) / focal, -1.0])
            d = rot @ local
            return d / np.linalg.norm(d)
        dirs = np.stack([ray(c, r) for c, r in zip(cc, rr)])
        cen = np.stack([rr.mean(), cc.mean()])
        dc = ray(cen[1], cen[0])
        steps = np.arange(0.0, 3000.0, 2.0)
        line = c0[None, :] + steps[:, None] * dc[None, :]
        sdf = ENV.query_sdf(grid, line)
        j = int(np.argmin(sdf))
        surf = line[j]
        plane_q = surf + 25.0 * dc
        denom = dirs @ dc
        ok = denom > 1e-6
        dist = ((plane_q - c0) @ dc) / np.maximum(denom, 1e-6)
        pts = c0[None, :] + dist[:, None] * dirs
        pts = pts[ok]
        med_z = round(float(np.median(pts[:, 2])), 1)
        med_y = round(float(np.median(pts[:, 1])), 1)
        medians_z.append(med_z)
        medians_y.append(med_y)
        out["views"][view] = {
            "nHemRays": int(ok.sum()),
            "centralMinSdfMm": round(float(sdf[j]), 1),
            "medianHemZmm": med_z,
            "medianPosteriorYmm": med_y,
        }
    out["spreadMedianHemZmm"] = round(max(medians_z) - min(medians_z), 1)
    out["spreadMedianPosteriorYmm"] = round(max(medians_y) - min(medians_y), 1)
    return out


def draw_fit_figure(evidence, targets, masks_by_fit):
    panels = []
    for view in VIEWS:
        base = np.zeros((1024, 1024, 3), dtype=np.uint8) + 18
        fit = masks_by_fit["all"][view]
        base[fit] = (0.55 * base[fit]
                     + 0.45 * np.array([220.0, 40.0, 40.0])).astype(np.uint8)
        img = Image.fromarray(base)
        draw = ImageDraw.Draw(img)
        for name, mask, color in (
            ("target", targets[view], (60, 255, 90)),
            ("heldout", masks_by_fit["holdout-%s" % view][view], (255, 230, 60)),
        ):
            b = ENV.boundary(mask)
            ys, xs = np.nonzero(b)
            for y, x in zip(ys[::4], xs[::4]):
                draw.rectangle([x - 1, y - 1, x + 1, y + 1], fill=color)
        img = img.resize((512, 512), Image.NEAREST)
        panel = Image.new("RGB", (512, 512 + 28), (16, 16, 16))
        panel.paste(img, (0, 28))
        ImageDraw.Draw(panel).text((8, 7), view, fill=(255, 255, 255))
        panels.append(panel)
    frame = Image.new("RGB", (512 * 3, 540), (0, 0, 0))
    for i, panel in enumerate(panels):
        frame.paste(panel, (512 * i, 0))
    ImageDraw.Draw(frame).text(
        (8, 512 + 28 + 6),
        "red=all-view fit fill green=target outline yellow=held-out outline",
        fill=(200, 200, 200))
    frame.save(evidence / "fit.png")
    print("FIGURE", evidence / "fit.png", frame.size, flush=True)


def draw_three_quarter(evidence, cams, sensor, anchors, crown):
    fits = json.loads((evidence / "fits.json").read_text())
    pall = np.array([fits["fits"]["all"]["params"][n] for n in ENV.PARAM_ORDER])
    verts, faces = ENV.build_world_mesh(pall, anchors, crown)
    cam = cams["views"]["three_quarter"]
    cols, rows, _ = ENV.project_to_render(verts, cam, sensor)
    img = Image.new("L", (ENV.FRAME, ENV.FRAME), 0)
    draw = ImageDraw.Draw(img)
    for tri in faces:
        draw.polygon([(float(cols[k]), float(rows[k])) for k in tri], fill=1)
    left = np.asarray(img, dtype=bool)
    canvas = np.zeros((1024, 1024, 3), dtype=np.uint8) + 18
    canvas[left] = (70, 160, 255)
    left_img = Image.fromarray(canvas).resize((512, 512), Image.NEAREST)
    mask_path = ("/Users/patrick/.grok/worktrees/src-openclinxr/"
                 "hair-judge/tools/openclinxr/evidence/hair-judge/"
                 "target-set-back/mask-three_quarter.png")
    OPENED.append(str(Path(mask_path).resolve()))
    right_img = Image.open(mask_path).convert("RGB").resize((512, 512))
    frame = Image.new("RGB", (1024, 540), (0, 0, 0))
    for i, (im, label) in enumerate(
        ((left_img, "envelope render-frame (unregistered)"),
         (right_img, "target three_quarter (display only)"))):
        panel = Image.new("RGB", (512, 540), (16, 16, 16))
        panel.paste(im, (0, 28))
        ImageDraw.Draw(panel).text((8, 7), label, fill=(255, 255, 255))
        frame.paste(panel, (512 * i, 0))
    frame.save(evidence / "validation-three_quarter.png")
    print("FIGURE", evidence / "validation-three_quarter.png", frame.size,
          flush=True)
    return {
        "target": "mask-three_quarter.png (display only, never in the loss)",
        "targetSha256": sha256_file(mask_path),
        "note": "VALIDATION display; no registration triple exists for "
        "three_quarter so no overlay and no score",
    }


if __name__ == "__main__":
    main()
