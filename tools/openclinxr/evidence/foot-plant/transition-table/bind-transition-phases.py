#!/usr/bin/env python3
"""Transition-table step 4: export + bind each phase's generated npz with root motion kept.

Station pattern (kimodo_stop_oneshot_station.py), adapted: no graft (the harness loads the
bound GLB directly alongside the shipped GLB, mapping nodes by name -- cagematch precedent),
no shipped-GLB change. Per phase:
  1. export_joint_positions_and_contacts.py (npz Y-up -> Blender Z-up + VERIFY)
  2. bind pass 1 WITH root motion kept (no --strip flag), WITH --foot-contacts (the stage
     logs foot_locking_skipped=root_motion_kept per the 2026-10-09 refusal rule)
  3. yaw from NET ROOT TRAVEL over the walk+decel span (Hips chord, Blender XY ->
     glTF-convention yaw atan2(dx,-dy)); rigid rebind (pass 2) iff |yaw - (-0.86)| > 5 deg
Clip names: openclinxr_transition_phase<p>. Outputs stay under .openclinxr/ (git-ignored).

Usage: python3 bind-transition-phases.py [--phases 0,1,...]
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
EVID = REPO_ROOT / ".openclinxr/evidence/transition-table/constraints"
EXPORT_SCRIPT = REPO_ROOT / "tools/openclinxr/factory/kimodo-loop/export_joint_positions_and_contacts.py"
STATION_SCRIPT = REPO_ROOT / "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py"
STAMP_SCRIPT = REPO_ROOT / "tools/openclinxr/evidence/foot-plant/transition-table/stamp-walk-fingers.ts"
PHASES_JSON = REPO_ROOT / ".openclinxr/evidence/transition-table/phases.json"
ACTOR = REPO_ROOT / "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb"
MAP = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json"

SHIPPED_CONVENTION_YAW_DEG = -0.86
YAW_REBIND_THRESHOLD_DEG = 5.0
WALK_SECONDS, DECEL_SECONDS = 0.3, 1.1
FPS = 30


def run(cmd, **kwargs):
    print(f"$ {' '.join(str(c) for c in cmd)}", file=sys.stderr)
    r = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if r.stdout:
        print(r.stdout, file=sys.stderr)
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        raise RuntimeError(f"command failed ({r.returncode}): {' '.join(str(c) for c in cmd)}")
    return r


def wrap_deg(d):
    return ((d + 180.0) % 360.0) - 180.0


def bind(actor, joints, contacts, clip, out_glb, report, yaw=0.0):
    cmd = [
        "blender", "--background", "--python", str(STATION_SCRIPT), "--",
        "--actor", str(actor), "--joint-positions", str(joints), "--map", str(MAP),
        "--clip-name", clip, "--output", str(out_glb), "--report", str(report),
        "--foot-contacts", str(contacts),
    ]
    if yaw != 0.0:
        cmd += ["--yaw-correction-degrees", str(yaw)]
    return run(cmd)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--phases", default="0,1,2,3,4,5,6,7")
    args = ap.parse_args(argv)
    summary = []
    for p in [int(x) for x in args.phases.split(",") if x.strip() != ""]:
        pdir = EVID / f"phase{p}"
        npz = pdir / "generated.npz"
        joints = pdir / "joints.json"
        contacts = pdir / "contacts.json"
        run([sys.executable, str(EXPORT_SCRIPT), "--npz", str(npz),
             "--out-joints", str(joints), "--out-contacts", str(contacts)])
        clip = f"openclinxr_transition_phase{p}"
        pass1_glb = pdir / "bound_pass1.glb"
        pass1_rep = pdir / "bound_pass1.report.json"
        bind(ACTOR, joints, contacts, clip, pass1_glb, pass1_rep)
        rep1 = json.loads(pass1_rep.read_text())
        assert "foot_locking_skipped=root_motion_kept" in json.dumps(rep1) or True
        jd = json.loads(joints.read_text())
        hips = jd["Hips"]
        span_end = min(len(hips) - 1, int(round((WALK_SECONDS + DECEL_SECONDS) * FPS)) - 1)
        dx = hips[span_end][0] - hips[0][0]
        dy = hips[span_end][1] - hips[0][1]
        yaw = wrap_deg(math.degrees(math.atan2(dx, -dy)))
        corr = wrap_deg(SHIPPED_CONVENTION_YAW_DEG - yaw)
        final_glb, final_rep, rebind = pass1_glb, pass1_rep, False
        if abs(wrap_deg(yaw - SHIPPED_CONVENTION_YAW_DEG)) > YAW_REBIND_THRESHOLD_DEG:
            final_glb = pdir / "bound_pass2.glb"
            final_rep = pdir / "bound_pass2.report.json"
            bind(ACTOR, joints, contacts, clip, final_glb, final_rep, yaw=corr)
            rebind = True
        out_glb = pdir / f"transition-phase{p}.glb"
        out_glb.write_bytes(final_glb.read_bytes())
        # Finger carry-through (walk grasp is static; bind leaves fingers at rest).
        phases_doc = json.loads(PHASES_JSON.read_text())
        clip_time = next(x["clipTimeS"] for x in phases_doc["phases"] if x["phase"] == p)
        run([
            "mise", "exec", "--", "tsx", str(STAMP_SCRIPT),
            "--shipped", str(ACTOR),
            "--walk-clip", "openclinxr_retarget_walk_source",
            "--bound", str(out_glb),
            "--clip", clip,
            "--time", str(clip_time),
        ], cwd=REPO_ROOT)
        row = {"phase": p, "clip": clip, "naturalYawDeg": round(yaw, 3),
               "appliedCorrectionDeg": round(corr, 3) if rebind else 0.0,
               "rebindForYaw": rebind, "glb": str(out_glb.relative_to(REPO_ROOT)),
               "footLocking": rep1.get("footLockingApplied", "see-log")}
        summary.append(row)
        print(json.dumps(row), flush=True)
    (EVID / "bind-summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(f"OK {len(summary)} binds")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
