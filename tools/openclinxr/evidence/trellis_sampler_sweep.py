#!/usr/bin/env python3
"""
#693 sampler sweep: measure welded component counts across TRELLIS sampler configs
on ONE subject (lowpoly-shoe-escape), the asset whose raw bake carries 47 outside-hull
fragments (76 position-welded components at 96.7% largest share, recorded by #661).

Metric is the DELTA across configs, never an absolute threshold (multi-component output
is the norm for this generator — o2-port ships at 51.5% largest share). Component counts
are a RECORD; they decide nothing about bake quality.

Configs (predicted directions declared BEFORE running):
  control-a                      control, current defaults (must reproduce #661's 293,808)
  control-b                      identical settings -> run-to-run variance / noise floor
  quality                        vendor quality tier: ss 20 steps cfg 9.0, shape 20 cfg 4.5
  fast                           vendor fast tier:   ss 6 steps cfg 7.5, shape 6 cfg 3.0
  interval-0.8-1.0               less early guidance (Kynkaanniemi: guidance harmful early)
  interval-0.3-1.0               MORE early guidance — PREDICTED-WORSE direction

All rows share seed 42, --hf-demo (passes the pipeline defaults explicitly; no-op by
construction per trellis-baking SKILL), --remesh (space-order band1/project0), the same
input image, decimation target 300000 and texture size 2048 — identical to the #661 bake
except for the knob under test, so any delta is attributable to that knob.

Modes:
  --bake     run all configs sequentially (fresh OS subprocess per bake, ~9.5 min each)
  --measure  analyze existing bakes and write sweep.json (no GPU)
  --measure-only GLB BAKEMEASURE   calibrate measurement on an existing bake (no sweep write)

Measurement: position-weld at 5 decimal places (an unwelded count is wrong by orders of
magnitude — 6605 vs 76 on this asset), then union-find over all triangles. Triangle count
per component -> largestComponentShare = max / total.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
VENV_PYTHON = Path(os.path.expanduser("~/.openclinxr-tools/trellis2-apple/venv/bin/python3"))
RUN_BAKE = REPO_ROOT / "tools/openclinxr/evidence/blender/run_bake_isolated.py"

SUBJECT_ID = "lowpoly-shoe-escape"
SEED = 42  # the #661 control bake ran at this explicit seed (bake-measure.json)
PACK_IMAGE = REPO_ROOT / ".openclinxr/evidence/trellis-packs/lowpoly-shoe-escape" / (
    "three_quarter_upper_alpha." + "png"
)
SWEEP_DIR = REPO_ROOT / ".openclinxr/evidence/trellis-sampler-sweep"
BAKES_DIR = SWEEP_DIR / "bakes"
SWEEP_JSON = SWEEP_DIR / "sweep.json"

# label -> extra run_bake_isolated.py args (knob deltas only; everything else constant)
CONFIGS = [
    ("control-a", [], "control"),
    ("control-b", [], "control-duplicate (noise floor)"),
    ("quality", ["--ss-steps", "20", "--ss-guidance-strength", "9.0",
                 "--shape-steps", "20", "--shape-guidance-strength", "4.5"],
     "vendor quality tier (published)"),
    ("fast", ["--ss-steps", "6", "--ss-guidance-strength", "7.5",
              "--shape-steps", "6", "--shape-guidance-strength", "3.0"],
     "vendor fast tier (published)"),
    ("interval-0.8-1.0", ["--ss-guidance-interval", "0.8", "1.0"],
     "less early guidance (predicted better)"),
    ("interval-0.3-1.0", ["--ss-guidance-interval", "0.3", "1.0"],
     "MORE early guidance (PREDICTED-WORSE)"),
]

PER_BAKE_TIMEOUT_S = 3600  # matches trellis-bake-cli.ts:615 (3.6Ms fails fast on wedged GPU)


def run_bake(label: str, extra_flags: list[str]) -> dict:
    out_dir = BAKES_DIR / label
    out_dir.mkdir(parents=True, exist_ok=True)
    argv = [
        str(VENV_PYTHON),
        str(RUN_BAKE),
        "--subject-id", SUBJECT_ID,
        "--display-name", "lowpoly-shoe",
        "--output-dir", str(out_dir),
        "--seed", str(SEED),
        "--hf-demo",
        "--remesh",
        "--input-image", str(PACK_IMAGE),
    ] + extra_flags
    t0 = time.time()
    try:
        proc = subprocess.run(argv, capture_output=True, text=True,
                              timeout=PER_BAKE_TIMEOUT_S, cwd=str(REPO_ROOT))
        wall = time.time() - t0
        return {
            "label": label,
            "exitCode": proc.returncode,
            "wallClockSeconds": round(wall, 1),
            "stdoutTail": proc.stdout.strip().splitlines()[-5:] if proc.stdout else [],
            "stderrTail": proc.stderr.strip().splitlines()[-5:] if proc.stderr else [],
        }
    except subprocess.TimeoutExpired:
        return {"label": label, "exitCode": "timeout",
                "wallClockSeconds": round(time.time() - t0, 1),
                "stdoutTail": [], "stderrTail": []}


def measure_glb(glb_path: Path) -> dict:
    """Position-weld (5dp) then union-find over all triangles across all primitives."""
    import trimesh

    loaded = trimesh.load(str(glb_path), force=None)
    geometries = []
    if isinstance(loaded, trimesh.Scene):
        geometries = [g for g in loaded.geometry.values()
                      if isinstance(g, trimesh.Trimesh)]
    elif isinstance(loaded, trimesh.Trimesh):
        geometries = [loaded]
    if not geometries:
        return {"error": "no trimesh geometries found"}

    welded_index = {}  # quantized (5dp) position -> global vertex id
    global_faces = []
    for geom in geometries:
        local_to_global = []
        for v in geom.vertices:
            key = (round(float(v[0]), 5), round(float(v[1]), 5), round(float(v[2]), 5))
            gid = welded_index.get(key)
            if gid is None:
                gid = len(welded_index)
                welded_index[key] = gid
            local_to_global.append(gid)
        for f in geom.faces:
            global_faces.append((local_to_global[int(f[0])],
                                 local_to_global[int(f[1])],
                                 local_to_global[int(f[2])]))

    total_tris = len(global_faces)
    if total_tris == 0:
        return {"error": "no faces", "rawTriangleCount": 0}

    parent = list(range(len(welded_index)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for a, b, c in global_faces:
        union(a, b)
        union(a, c)

    from collections import Counter
    comp_tris = Counter()
    for a, b, c in global_faces:
        comp_tris[find(a)] += 1

    sizes = sorted(comp_tris.values(), reverse=True)
    largest_share = sizes[0] / total_tris
    return {
        "rawTriangleCount": total_tris,
        "weldedComponentCount": len(sizes),
        "largestComponentShare": round(largest_share, 4),
        "componentTriangleCounts": sizes[:10],
    }


def bake_rows() -> tuple[list[dict], list[dict]]:
    """Analyze every bake dir and build sweep rows (skips failures, records them)."""
    rows = []
    failures = []
    for label, _, _desc in CONFIGS:
        out_dir = BAKES_DIR / label
        measure_path = out_dir / "bake-measure.json"
        glb_path = out_dir / f"{SUBJECT_ID}.glb"
        if not measure_path.exists():
            failures.append({"label": label, "error": "bake-measure.json missing"})
            continue
        bake = json.loads(measure_path.read_text())
        if bake.get("verdict") != "mesh_exported" or not glb_path.exists():
            failures.append({"label": label, "error": bake.get("verdict", "no verdict"),
                             "verdictReason": bake.get("verdictReason", "")})
            continue
        measure = measure_glb(glb_path)
        if "error" in measure:
            failures.append({"label": label, "error": measure["error"]})
            continue
        rows.append({
            "label": label,
            "sampler": bake.get("effectiveSamplerParams", {}),
            "rawTriangleCount": measure["rawTriangleCount"],
            "weldedComponentCount": measure["weldedComponentCount"],
            "largestComponentShare": measure["largestComponentShare"],
            "wallClockSeconds": bake.get("wallClockS"),
            "bakeVerdict": bake.get("verdict"),
            "bakeExitCode": None,
        })
    return rows, failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bake", action="store_true", help="run all configs sequentially")
    parser.add_argument("--measure", action="store_true", help="write sweep.json from existing bakes")
    parser.add_argument("--measure-only", nargs=2, metavar=("GLB", "BAKE_MEASURE"),
                        help="calibrate measurement on one bake without writing sweep.json")
    args = parser.parse_args()

    if args.measure_only:
        glb, _bm = args.measure_only
        print(json.dumps(measure_glb(Path(glb)), indent=2))
        return 0

    if args.bake:
        if not PACK_IMAGE.exists():
            print(f"FATAL: input image missing: {PACK_IMAGE}", flush=True)
            return 2
        results = []
        for label, extra, desc in CONFIGS:
            print(f"[sweep] baking {label} ({desc})...", flush=True)
            r = run_bake(label, extra)
            results.append(r)
            print(f"[sweep] {label} done exit={r['exitCode']} wall={r['wallClockSeconds']}s",
                  flush=True)
            if r["stderrTail"]:
                print(f"[sweep] {label} stderr tail: {r['stderrTail']}", flush=True)
        print("[sweep] bakes complete", flush=True)

    if args.measure:
        rows, failures = bake_rows()
        payload = {
            "subjectId": SUBJECT_ID,
            "seed": SEED,
            "inputImage": str(PACK_IMAGE),
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "controlRecorded": {
                "rawTriangleCount": 293808,
                "weldedComponentCount": 76,
                "source": "hatch-report.json (#661 bake)",
            },
            "failures": failures,
            "rows": rows,
        }
        SWEEP_DIR.mkdir(parents=True, exist_ok=True)
        SWEEP_JSON.write_text(json.dumps(payload, indent=2))
        print(f"[sweep] wrote {SWEEP_JSON} ({len(rows)} rows, {len(failures)} failures)",
              flush=True)
        for r in rows:
            print(f"[sweep] {r['label']}: tris={r['rawTriangleCount']} "
                  f"components={r['weldedComponentCount']} share={r['largestComponentShare']} "
                  f"wall={r['wallClockSeconds']}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
