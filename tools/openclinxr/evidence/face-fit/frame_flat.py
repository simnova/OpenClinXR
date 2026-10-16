"""Face-framed flat render driver (card tsk_2c547dda8753bba0 h1).

Renders an identity flat at ortho 0.55, detects the render interocular px
(MediaPipe outer eye corners 33/263), then re-renders with ortho scaled by
render/goal until the render interocular is within 10% of the goal's detected
interocular px. The 10% band is justified by the 0.8x-rescale redetection probe
(20% scale change shifts M2 by <= measured noise; value recorded in
identity-report.json).

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/evidence/face-fit/frame_flat.py \
    --glb <shipped.glb> --goal-npy <pts_target_<case>_front.npy> --out <flat.png>
"""

import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fit_facefit2 as ff  # noqa: E402

BLENDER = os.environ.get("OPENCLINXR_BLENDER", "/opt/homebrew/bin/blender")
SCRIPT = os.path.join(HERE, "flat_render_identity.py")


def render(glb, out, ortho):
    r = subprocess.run(
        [BLENDER, "--background", "--python", SCRIPT, "--",
         "--glb", glb, "--out", out, "--ortho-scale", "%.4f" % ortho],
        capture_output=True, text=True, timeout=1200)
    if r.returncode != 0 or not os.path.isfile(out):
        raise SystemExit("frame_flat refuse: blender failed:\n%s\n%s" % (r.stdout[-3000:], r.stderr[-3000:]))
    for line in r.stdout.splitlines():
        if line.startswith("IDENTITY_FLAT_HIDDEN"):
            print(line)
    return r.stdout


def interocular(png):
    pts = ff.detect_points(png)
    if pts is None or pts.shape != (478, 2):
        raise SystemExit("frame_flat refuse: no 478-point face in %s" % png)
    return float(np.linalg.norm(pts[33] - pts[263]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--goal-npy", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    goal = np.load(a.goal_npy)
    goal_ioc = float(np.linalg.norm(goal[33] - goal[263]))
    ortho = 0.55
    tried = []
    for _ in range(4):
        render(a.glb, a.out, ortho)
        got = interocular(a.out)
        ratio = got / goal_ioc
        tried.append({"ortho": round(ortho, 4), "renderIoc": round(got, 1), "ratio": round(ratio, 4)})
        print("FRAME try ortho=%.4f renderIoc=%.1f goalIoc=%.1f ratio=%.4f" % (ortho, got, goal_ioc, ratio))
        if 0.9 <= ratio <= 1.1:
            print("FRAME_OK %s" % json.dumps({"out": a.out, "goalIoc": round(goal_ioc, 1), "tries": tried}))
            return
        ortho = ortho * ratio
    raise SystemExit("frame_flat refuse: not within 10% after %s" % json.dumps(tried))


main()
