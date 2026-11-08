"""Card material calibration under the groom rig: albedo gain per channel + specular level.

    <blender python> calib_search.py --blender <Blender> --body <glb> --groom-round <dir> \
        --cards <cards.npz> --atlas <uncalibrated atlas> --base <no-hair round> --out-dir <dir> \
        [--specular 0,0.05,0.1,0.15,0.2] [--roughness <r>] [--iters 3]

For each specular level on the grid, the albedo gain is solved by calib_colour.py's fixed point
(render_cards.py -> calib_colour.py, `iters` times, starting from the previous level's gain). The
level kept is the one whose converged round best matches the strand round's hair luminance in mean
AND median, every view weighted equally:
    E = sum over views of log(mean_lum_cards / mean_lum_strands)^2 + log(p50_cards / p50_strands)^2
The mean alone is matched by any level (the albedo absorbs it); the median separates a dark base with
bright specular glints (cards-r1 defect 3) from the strands' brighter base with a narrow highlight.
Writes <out-dir>/calibration.json and strand-atlas-cal.png (the kept level's atlas).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
LUM = np.array([0.2126, 0.7152, 0.0722])


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or ("render_cards.py" in cmd[4] and "CARDS_RENDER_DONE" not in r.stdout):
        sys.stderr.write(r.stdout[-3000:] + r.stderr[-3000:])
        raise RuntimeError("failed: %s" % " ".join(cmd[:4]))
    return r.stdout


E_P95 = False   # cards-r5: --e-p95 adds the highlight percentile to the criterion


def err(rec):
    e = 0.0
    for v, pv in rec["perView"].items():
        ms = float(np.dot(pv["strands"]["meanLin"], LUM))
        mc = float(np.dot(pv["cards"]["meanLin"], LUM))
        e += np.log(mc / ms) ** 2 + np.log(pv["cards"]["lumSrgbP50P95P99"][0] / pv["strands"]["lumSrgbP50P95P99"][0]) ** 2
        if E_P95:
            e += np.log(pv["cards"]["lumSrgbP50P95P99"][1] / pv["strands"]["lumSrgbP50P95P99"][1]) ** 2
    return float(e)


def main():
    ap = argparse.ArgumentParser()
    for k in ("blender", "body", "groom-round", "cards", "atlas", "base", "out-dir"):
        ap.add_argument("--" + k, required=True)
    ap.add_argument("--specular", default="0,0.05,0.1,0.15,0.2")
    ap.add_argument("--roughness", type=float, default=None)
    ap.add_argument("--iters", type=int, default=3)
    ap.add_argument("--render-args", default="", help="extra render_cards.py arguments, space separated (cards-r3: alpha mode)")
    ap.add_argument("--e-p95", action="store_true",
                    help="criterion also matches the p95 luminance (the highlight band) per view")
    a = ap.parse_args()
    global E_P95
    E_P95 = a.e_p95
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    py = sys.executable
    levels = [float(x) for x in a.specular.split(",")]
    gain_rec = None
    results = []
    for sp in levels:
        d = out / ("spec%.3f" % sp)
        d.mkdir(exist_ok=True)
        atlas = Path(a.atlas) if gain_rec is None else Path(gain_rec.replace(".json", ".png"))
        for it in range(a.iters + 1):
            rd = d / ("round%d" % it)
            cmd = [a.blender, "--background", "--factory-startup", "--python", str(HERE / "render_cards.py"), "--",
                   "--body", a.body, "--groom-round", a.groom_round, "--cards", a.cards, "--atlas", str(atlas),
                   "--out-dir", str(rd), "--specular", str(sp)]
            if a.roughness is not None:
                cmd += ["--roughness", str(a.roughness)]
            cmd += a.render_args.split()
            run(cmd)
            rec_p = d / ("calib%d.json" % it)
            cc = [py, str(HERE / "calib_colour.py"), "--strands", a.groom_round, "--base", a.base, "--cards", str(rd),
                  "--atlas-in", a.atlas, "--atlas-out", str(rec_p).replace(".json", ".png"), "--record", str(rec_p)]
            if gain_rec is not None:
                cc += ["--gain-in", gain_rec]
            run(cc)
            rec = json.loads(rec_p.read_text())
            print("SPEC", sp, "iter", it, "E=%.4f" % err(rec), np.round(rec["cardsOverStrandsGeoMeanOfViews"], 3), flush=True)
            if it == a.iters:
                break   # measure-only: the last round is rendered with the gain being judged
            gain_rec = str(rec_p)
            atlas = Path(str(rec_p).replace(".json", ".png"))
        results.append({"specular": sp, "E": err(rec), "record": str(rec_p), "atlas": str(atlas),
                        "gain": json.loads(Path(gain_rec).read_text())["gain"],
                        "cardsOverStrandsGeoMeanOfViews": rec["cardsOverStrandsGeoMeanOfViews"],
                        "p50": {v: [pv["cards"]["lumSrgbP50P95P99"][0], pv["strands"]["lumSrgbP50P95P99"][0]]
                                for v, pv in rec["perView"].items()}})
    best = min(results, key=lambda r: r["E"])
    shutil.copyfile(best["atlas"], out / "strand-atlas-cal.png")
    cal = {"tool": "tools/openclinxr/hair-groom-2/cards/calib_search.py", "roughness": a.roughness,
           "iters": a.iters, "renderArgs": a.render_args, "grid": results, "kept": best,
           "criterion": "min over specular levels of sum_views log(mean lum ratio)^2 + log(p50 lum ratio)^2"
                        + (" + log(p95 lum ratio)^2" if a.e_p95 else "")}
    (out / "calibration.json").write_text(json.dumps(cal, indent=1))
    print("CALIB_SEARCH_DONE", json.dumps({"specular": best["specular"], "E": best["E"], "gain": best["gain"]}))


if __name__ == "__main__":
    main()
