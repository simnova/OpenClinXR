#!/usr/bin/env python3
"""CMA-ES driver for the persistent Blender evaluator."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / ".openclinxr/venv/hair-search"))
sys.path.insert(0, str(OUT))
import cma  # type: ignore
from fitness import breakdown, fitness

NAMES = ("key_elev_deg", "key_size_m", "fill_W", "fill_elev_deg", "rim_W",
         "melanin", "redness", "roughness", "trim")
BOUNDS = ((25, 70), (.8, 2.8), (20, 140), (0, 50), (0, 80),
          (.3, 1.0), (.2, .9), (.12, .5), (.85, 1.20))
BASELINE_METRICS = {"p10": .068, "p50": .192, "p90": .319, "rb": 1.48,
                    "face": .578, "bg": .462, "faceLR": .832, "volume": .225,
                    "lengthBelowChinFrac": .26, "maskPx": 100000,
                    "meanRBSpread": .05}


def denormalize(vector):
    return {name: lo + float(x) * (hi-lo) for name, x, (lo, hi) in zip(NAMES, vector, BOUNDS)}


def json_from_blender(proc):
    while True:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("Blender evaluator exited before a JSON result")
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue


def make_progress(rows, generation_best):
    from PIL import Image, ImageDraw
    width, thumb, graph_h = 2048, 512, 260
    sheet = Image.new("RGB", (width, graph_h + thumb), (22, 22, 22))
    draw = ImageDraw.Draw(sheet)
    if generation_best:
        vals = generation_best
        lo, hi = min(vals), max(vals)
        points = []
        for i, value in enumerate(vals):
            x = 30 + i * (width-60) / max(1, len(vals)-1)
            y = 20 + (value-lo) / max(1e-9, hi-lo) * (graph_h-50)
            points.append((x, y))
        if len(points) > 1:
            draw.line(points, fill=(65, 190, 255), width=4)
        for p in points:
            draw.ellipse((p[0]-4, p[1]-4, p[0]+4, p[1]+4), fill=(255, 210, 40))
        draw.text((30, 5), "best fitness per generation (lower is better)", fill="white")
    ranked = sorted(rows, key=lambda r: r["fitness"])
    panels = [("baseline", ROOT / "tools/openclinxr/evidence/hair-image/front-fill.png")]
    panels += [(label, Path(row["beautyPath"])) for label, row in zip(("best", "second", "third"), ranked[:3])]
    for i, (label, path) in enumerate(panels):
        panel = Image.open(path).convert("RGB").resize((thumb, thumb), Image.Resampling.LANCZOS)
        sheet.paste(panel, (i*thumb, graph_h))
        draw.rectangle((i*thumb, graph_h, i*thumb+190, graph_h+24), fill=(0, 0, 0))
        draw.text((i*thumb+6, graph_h+5), label, fill=(255, 255, 0))
    sheet.save(OUT / "search-progress.png")


def main():
    lineage = OUT / "lineage.jsonl"
    resume = "--resume" in sys.argv
    existing = []
    if resume and lineage.exists() and lineage.read_text().strip():
        existing = [json.loads(line) for line in lineage.read_text().splitlines() if line.strip()]
    else:
        lineage.write_text("")
    env = os.environ.copy()
    env["MISE_TRUSTED_CONFIG_PATHS"] = str(ROOT)
    cmd = ["blender", "--background", "--python", str(OUT / "search.py")]
    proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    ready = json_from_blender(proc)
    if not ready.get("ready"):
        raise RuntimeError(ready.get("error", "Blender setup failed"))
    include_length = bool(ready.get("trimSupported"))
    rng = np.random.RandomState(0)
    es = cma.CMAEvolutionStrategy([.5]*len(NAMES), .25,
        {"seed": 1, "randn": rng.randn, "popsize": 8, "bounds": [0, 1], "verbose": -9})
    git_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    rows, gen_best = list(existing), []
    index = (max((row["index"] for row in existing), default=-1) + 1)
    complete_generations = len(existing) // 8
    for generation in range(complete_generations):
        prior = [row for row in existing if row["generation"] == generation]
        if len(prior) != 8:
            raise RuntimeError("cannot resume incomplete generation %d" % generation)
        es.ask()  # advance the deterministic sampler before replaying tell()
        vectors = [[(row["params"][name]-lo)/(hi-lo) for name, (lo,hi) in zip(NAMES,BOUNDS)] for row in prior]
        es.tell(vectors, [row["fitness"] for row in prior])
        gen_best.append(min(row["fitness"] for row in prior))
    for generation in range(complete_generations, 12):
        vectors = es.ask()
        partial = [row for row in existing if row["generation"] == generation]
        if partial:
            for row, vector in zip(partial, vectors):
                expected = denormalize(vector)
                if any(abs(row["params"][name] - expected[name]) > 1e-8 for name in NAMES):
                    raise RuntimeError("partial generation %d does not match deterministic replay" % generation)
        scores = [row["fitness"] for row in partial]
        for vector in vectors[len(partial):]:
            params = denormalize(vector)
            request = {"index": index, "generation": generation, "params": params,
                       "size": 512, "samples": 32, "stem": "eval-%04d" % index}
            sent = time.monotonic()
            proc.stdin.write(json.dumps(request) + "\n")
            proc.stdin.flush()
            result = json_from_blender(proc)
            if not result.get("ok"):
                raise RuntimeError(result.get("error", "unknown evaluator error"))
            score = fitness(result["metrics"], include_length)
            row = {"index": index, "generation": generation, "params": params,
                   "metrics": result["metrics"], "fitness": score,
                   "renderSeconds": result["renderSeconds"],
                   "wallSeconds": result.get("wallSeconds", time.monotonic()-sent),
                   "gitSha": git_sha, "seed": 0, "beautyPath": result["beautyPath"],
                   "idPath": result["idPath"], "strandsAfter": result["strandsAfter"],
                   "trimReadBack": result.get("trimReadBack")}
            with lineage.open("a") as handle:
                handle.write(json.dumps(row, sort_keys=True) + "\n")
            rows.append(row)
            scores.append(score)
            index += 1
        es.tell(vectors, scores)
        gen_best.append(min(scores))
        make_progress(rows, gen_best)
        if len(gen_best) >= 4 and (gen_best[-4] - min(gen_best[-3:])) / max(gen_best[-4], 1e-9) < .01:
            break
    best = min(rows, key=lambda row: row["fitness"])
    shutil.copy2(best["beautyPath"], OUT / "best-512.png")
    shutil.copy2(best["idPath"], OUT / "best-512-id.png")
    final_req = {"index": 1000000, "generation": "final", "params": best["params"],
                 "size": 1024, "samples": 64, "stem": "best-1024"}
    proc.stdin.write(json.dumps(final_req) + "\n")
    proc.stdin.flush()
    final = json_from_blender(proc)
    proc.stdin.write('{"quit":true}\n')
    proc.stdin.flush()
    best_doc = dict(best)
    best_doc.update({"ok": best["fitness"] < fitness(BASELINE_METRICS, include_length),
                     "baselineFitness": fitness(BASELINE_METRICS, include_length),
                     "fitnessBreakdown": breakdown(best["metrics"], include_length),
                     "best512Png": "best-512.png", "best512IdPng": "best-512-id.png",
                     "best1024Png": "best-1024.png"})
    (OUT / "best.json").write_text(json.dumps(best_doc, indent=2, sort_keys=True) + "\n")
    hit_bounds = [name for name, (lo, hi) in zip(NAMES, BOUNDS)
                  if abs(best["params"][name]-lo) < (hi-lo)*.01 or abs(best["params"][name]-hi) < (hi-lo)*.01]
    report = {"ok": best_doc["ok"] and bool(final.get("ok")),
              "error": "" if best_doc["ok"] else "best fitness is not below baseline fitness",
              "evaluations": len(rows), "generations": len(gen_best), "seed": 0,
              "population": 8, "sigma0": .25, "meanRenderSeconds": sum(r["renderSeconds"] for r in rows)/len(rows),
              "trimSupported": include_length, "lengthIncludedInFitness": include_length,
              "bestParams": best["params"], "boundHits": hit_bounds,
              "baseline": {"metrics": BASELINE_METRICS, "fitness": best_doc["baselineFitness"]},
              "best": {"metrics": best["metrics"], "fitness": best["fitness"]},
              "finalRender": final, "pinned": {"profileRadius": .0003, "amount": 4,
                  "exposure": -.375, "viewTransform": "Standard", "seed": 0}}
    (OUT / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
