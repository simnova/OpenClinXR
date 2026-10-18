"""Batch sclera_metrics over bisect full frames (eroded-polygon; relative metrics).

Usage: mise exec -C /Volumes/files/src/openclinxr -- python3 probe_batch_metrics.py
Writes bisect/measure_batch.json. Refusals recorded, never fatal.
"""
import json
import subprocess
import sys

SCRIPT = "/Users/patrick/.grok/worktrees/src-openclinxr/eyereal/tools/openclinxr/asset-pipeline/realism-head/sclera-shade/sclera_metrics.py"
STORE = "/Volumes/files/openclinxr-assets/store/eyes-realism-regression"

IMAGES = {
    "eevee-oct15": f"{STORE}/oct15-repro/sheet-body2-new-front-full.png",
    "eevee-run3": f"{STORE}/now-run3/sheet-body2-now-front-full.png",
    "eevee-oct15-irisC": f"{STORE}/bisect/f2-iris/sheet-body2-oct15-irisC-front-full.png",
    "eevee-run3-browneye": f"{STORE}/bisect/f2-iris/sheet-body2-run3-browneye-front-full.png",
    "eevee-repin": f"{STORE}/bisect/f4-lidgeo/sheet-body2-repin-front-full.png",
    "threejs-oct15": f"{STORE}/bisect/f1-renderer/threejs-oct15-front.png",
    "threejs-run3": f"{STORE}/bisect/f1-renderer/threejs-run3-front.png",
    "threejs-oct15-irisC": f"{STORE}/bisect/f2-iris/threejs-oct15-irisC-front.png",
    "threejs-run3-browneye": f"{STORE}/bisect/f2-iris/threejs-run3-browneye-front.png",
    "threejs-run3-env0": f"{STORE}/bisect/f3-lighting/threejs-run3-env0-front.png",
    "threejs-run3-env06": f"{STORE}/bisect/f3-lighting/threejs-run3-env06-front.png",
    "threejs-run3-tonemap-none": f"{STORE}/bisect/f3-lighting/threejs-run3-tonemap-none-front.png",
}

out = {}
for key, img in IMAGES.items():
    try:
        with open(img, "rb"):
            pass
    except OSError:
        out[key] = {"error": "missing file"}
        continue
    p = subprocess.run(
        [sys.executable, SCRIPT, "--image", img],
        capture_output=True, text=True, timeout=600,
    )
    try:
        out[key] = json.loads(p.stdout)
    except (json.JSONDecodeError, ValueError):
        out[key] = {"error": f"exit={p.returncode} stderr={p.stderr[-500:]} stdout={p.stdout[-500:]}"}
    if isinstance(out.get(key), dict) and "error" not in out[key]:
        print(f"OK {key} M1={out[key]['M1']} M2b={out[key]['M2b']} scleraL={out[key]['scleraMedianL']} iris={out[key]['irisMeanRGB']}")
    else:
        print(f"REFUSED {key} {out[key]}")

with open(f"{STORE}/bisect/measure_batch.json", "w") as f:
    json.dump(out, f, indent=1)
print("wrote measure_batch.json")
