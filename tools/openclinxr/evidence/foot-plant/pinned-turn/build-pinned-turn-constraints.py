#!/usr/bin/env python3
"""Pinned-turn constraint builder (pass 1 frame-0 + root2d turn; pass 2 per-window foot pins).

Reuses the transition-table directed MPFB -> SOMA inverse (one direction only):
- MPFB bone -> canonical: asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json
- SOMA joint -> canonical: asset-pipeline/makeclothes/known-rigs/kimodo-soma-skeleton30.json
- Bind math mirrored: motion_bind_from_positions_stage.py SWING_SEGMENTS + hip-height scale.
- glTF -> Blender (x,-z,y) mapping VERIFIED bit-exact against headless-Blender import.
The inverse math (nrm/rot_diff/basis_from_hips/seg_dirs + constants) is IMPORTED from
tools/openclinxr/evidence/foot-plant/transition-table/build-frame0-constraints.py
(single source of truth, not a fork); only the constraint ASSEMBLY is new here.

Take frame: origin under the frame-0 root, +Z = model forward at heading 0.
- root2d: dense, root XZ CONSTANT (in-place turn), global_root_heading cosine-ramped
  0 -> turn over [stand0End, turnEnd], then held through the hold.
- frame-0 EE: generic "end-effector" at frame 0 pinning Hips/LeftFoot/RightFoot/
  LeftHand/RightHand (+ chains) with solve locals+root.
- pass-2 window pins (--pass1-npz + --windows): for each contact window of foot F,
  a foot-subclass dict over exactly those clip frames pinning F at its window-start
  npz-native position. Construction: frame-0 standing locals frozen, root rigidly
  translated by (windowStartFoot - frame0Foot) so FK lands EXACTLY on the target
  (FK is rigid in root translation; verified below per window). Positions are
  already SOMA-native on both sides (npz posed_joints native Y-up; solve native),
  so no frame conversion enters. Known tension, stated: the pin's EE side-effect
  holds smooth_root_2d at the shifted root while root2d holds the unshifted root;
  both are soft guides and the harness judges the outcome.

Sign: --turn-degrees is the CONSTRAINT request. The motion-bind rotation path is
EXACTLY yaw-negating (approach-take calibration: bound pelvis yaw = -source pelvis
yaw to 0.01 deg), so pass --negate-turn to land +turn on the bound take. The sign
is VERIFIED after the bind (score-turn-take.ts), not assumed here.

Usage (Kimodo venv python, which has torch + kimodo importable):
  .venv-official/bin/python3 build-pinned-turn-constraints.py --rest-pose .../rest-pose-physician.json \
      --out-dir .../constraints --kimodo-repo ~/.openclinxr-tools/kimodo/kimodo \
      --turn-degrees 62.67 --negate-turn
"""

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[5]
INVERSE_SCRIPT = (
    REPO_ROOT
    / "tools/openclinxr/evidence/foot-plant/transition-table/build-frame0-constraints.py"
)

FPS = 30


def load_inverse():
    spec = importlib.util.spec_from_file_location("frame0_inverse", INVERSE_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def wrap_pi(a: float) -> float:
    return ((a + math.pi) % (2.0 * math.pi)) - math.pi


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rest-pose", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--kimodo-repo", required=True)
    ap.add_argument("--turn-degrees", type=float, required=True)
    ap.add_argument("--negate-turn", action="store_true")
    ap.add_argument("--stand0-seconds", type=float, default=0.5)
    ap.add_argument("--turn-seconds", type=float, default=1.8)
    ap.add_argument("--hold-seconds", type=float, default=1.2)
    ap.add_argument("--pass1-npz", default=None)
    ap.add_argument("--windows", default=None,
                    help="JSON list of {foot: 'L'|'R', start: int, end: int} clip-frame windows.")
    args = ap.parse_args(argv)

    inv = load_inverse()
    sys.path.insert(0, args.kimodo_repo)
    import torch
    from kimodo.constraints import (
        EndEffectorConstraintSet,
        LeftFootConstraintSet,
        RightFootConstraintSet,
        Root2DConstraintSet,
    )
    from kimodo.geometry import matrix_to_axis_angle
    from kimodo.skeleton import SOMASkeleton30

    if args.hold_seconds < 0.8:
        print(f"REFUSE hold_too_short: {args.hold_seconds}s < 0.8s", flush=True)
        return 2

    turn_req = math.radians(args.turn_degrees)
    if args.negate_turn:
        turn_req = -turn_req

    skel = SOMASkeleton30(load=True)
    names = skel.bone_order_names
    bi = {nm: i for i, nm in enumerate(names)}
    parents = {nm: skel.bone_parents[nm] for nm in names}
    neutral = skel.neutral_joints.numpy().astype(np.float64)
    RB = {nm: neutral[bi[nm]] for nm in names}

    def rest_len(a, b):
        return float(np.linalg.norm(RB[b] - RB[a]))

    def rest_dir(a, b):
        d = inv.nrm(RB[b] - RB[a])
        if d is None:
            raise ValueError(f"degenerate SOMA rest segment {a}->{b}")
        return d

    B_rest = inv.basis_from_hips(RB["RightLeg"], RB["LeftLeg"])
    rest_links = {
        ("Hips", "Spine1"): rest_dir("Hips", "Spine1"),
        ("Hips", "LeftLeg"): rest_dir("Hips", "LeftLeg"),
        ("Hips", "RightLeg"): rest_dir("Hips", "RightLeg"),
        ("Chest", "LeftShoulder"): rest_dir("Chest", "LeftShoulder"),
        ("Chest", "RightShoulder"): rest_dir("Chest", "RightShoulder"),
    }

    doc = json.loads(Path(args.rest_pose).read_text())
    P = {c: np.array(v, dtype=np.float64) for c, v in doc["bones"].items()}
    R = {c: np.array(v, dtype=np.float64) for c, v in doc["rest"].items()}

    # ---- frame asserts (both sides Y-up, Left +X, toe forward +Z) ----
    assert P["head"][1] > P["hips"][1], "head not above hips"
    assert max(P["toe.L"][1], P["toe.R"][1]) < min(P["head"][1], P["hips"][1]), "feet not lowest"
    assert P["thigh.L"][0] > P["thigh.R"][0], "lateral sign flipped"
    assert RB["LeftToeBase"][2] > RB["LeftFoot"][2], "SOMA neutral toe not forward"
    assert RB["LeftLeg"][0] > RB["RightLeg"][0], "SOMA neutral lateral sign flipped"

    D = inv.seg_dirs(P, rest_links)
    sway = np.array([P["hips"][0] - R["hips"][0], P["hips"][2] - R["hips"][2]]) / inv.HIP_HEIGHT_RATIO
    root = np.array([sway[0], inv.SOURCE_REST_HIPS_Y + (P["hips"][1] - R["hips"][1]), sway[1]])

    pos = {"Hips": root}
    for nm in names:
        if nm == "Hips":
            continue
        a = parents[nm]
        if (a, nm) in D:
            pos[nm] = pos[a] + D[(a, nm)] * rest_len(a, nm)
        else:
            pos[nm] = None

    def kabsch(adj):
        src = np.stack([RB[c] - RB[j] for (j, c) in adj])
        dst = np.stack([(pos[c] - pos[j]) / np.linalg.norm(pos[c] - pos[j])
                        * np.linalg.norm(RB[c] - RB[j]) for (j, c) in adj])
        h = src.T @ dst
        u, _, vt = np.linalg.svd(h)
        rr = vt.T @ u.T
        if np.linalg.det(rr) < 0:
            vt[-1] *= -1
            rr = vt.T @ u.T
        return rr

    glob = {}
    B_mpfb = inv.basis_from_hips(P["thigh.R"], P["thigh.L"])
    glob["Hips"] = B_mpfb @ B_rest.T
    assert abs(np.linalg.det(glob["Hips"]) - 1.0) < 1e-9, "root fit not a rotation"
    glob["Chest"] = kabsch([("Chest", "Neck1"), ("Chest", "LeftShoulder"), ("Chest", "RightShoulder")])
    for nm in names:
        if nm in glob:
            continue
        kids = [c for (j, c) in D if j == nm]
        if len(kids) == 1:
            glob[nm] = inv.rot_diff(rest_dir(nm, kids[0]), D[(nm, kids[0])])
        elif len(kids) == 0:
            a = parents[nm]
            glob[nm] = glob[a]
            pos[nm] = pos[a] + glob[a] @ (RB[nm] - RB[a])
        else:
            raise AssertionError(f"multi-child {nm} kids={kids}")
    assert set(glob) == set(names), "unfilled globals"

    local = {}
    for nm in names:
        a = parents[nm]
        local[nm] = glob[nm] if a is None else glob[a].T @ glob[nm]

    L = np.stack([local[nm] for nm in names])[None]
    Lt = torch.from_numpy(L).float()
    rt = torch.from_numpy(root).float().reshape(1, 3)
    _, pj, _ = skel.fk(Lt, rt)
    pj0 = pj[0].numpy().astype(np.float64)
    errs = {}
    for nm in names:
        if pos[nm] is None:
            raise AssertionError(f"unfilled {nm}")
        errs[nm] = float(np.linalg.norm(pj0[bi[nm]] - pos[nm]))
    worst = max(errs.values())
    mean = sum(errs.values()) / len(errs)
    assert worst < 0.12, f"FK reconstruction error {worst}"

    aa = matrix_to_axis_angle(Lt)
    assert tuple(aa.shape) == (1, 30, 3)
    local_aa = aa[0].tolist()

    # ---- take timeline ----
    t0, tt, th = args.stand0_seconds, args.turn_seconds, args.hold_seconds
    duration = t0 + tt + th
    nframes = int(round(duration * FPS))
    stand0_end = int(round(t0 * FPS))
    turn_end = int(round((t0 + tt) * FPS))

    def heading_at(i: int) -> float:
        t = i / FPS
        if t <= t0:
            return 0.0
        if t <= t0 + tt:
            u = (t - t0) / tt if tt > 0 else 1.0
            return turn_req * 0.5 * (1.0 - math.cos(math.pi * u))
        return turn_req

    headings = [heading_at(i) for i in range(nframes)]
    root2d = {
        "type": "root2d",
        "frame_indices": list(range(nframes)),
        "smooth_root_2d": [[float(root[0]), float(root[2])] for _ in range(nframes)],
        "global_root_heading": [[math.cos(h), math.sin(h)] for h in headings],
    }
    c_root = Root2DConstraintSet.from_dict(skel, root2d)
    assert len(c_root.frame_indices) == nframes

    ee = {
        "type": "end-effector",
        "frame_indices": [0],
        "local_joints_rot": [local_aa],
        "root_positions": [root.tolist()],
        "smooth_root_2d": [[float(root[0]), float(root[2])]],
        "joint_names": list(inv.EE_JOINT_NAMES),
    }
    c = EndEffectorConstraintSet.from_dict(skel, ee)
    got = c.global_joints_positions.numpy().astype(np.float64)
    _rot_names, pos_names = skel.expand_joint_names(inv.EE_JOINT_NAMES)
    w2 = 0.0
    for jn in pos_names:
        w2 = max(w2, float(np.linalg.norm(got[0, skel.bone_index[jn]] - pj0[bi[jn]])))
    assert w2 < 1e-5, f"frame-0 loader round-trip error {w2}"

    dicts = [ee]
    pin_report = []

    # ---- pass-2 window pins ----
    if args.windows:
        if not args.pass1_npz:
            print("REFUSE windows_need_pass1_npz", flush=True)
            return 2
        d = np.load(args.pass1_npz)
        pj_npz = d["posed_joints"]  # (frames, 77, 3) native Y-up
        SOMA77 = {"LeftFoot": 69, "LeftToeBase": 70, "RightFoot": 74, "RightToeBase": 75}
        if pj_npz.shape[0] != nframes:
            print(f"REFUSE pass1_frames {pj_npz.shape[0]} != take_frames {nframes}", flush=True)
            return 2
        windows = json.loads(Path(args.windows).read_text())
        foot_names = {"L": ("LeftFoot", "LeftToeBase"), "R": ("RightFoot", "RightToeBase")}
        for w in windows:
            side = w["foot"]
            s, e = int(w["start"]), int(w["end"])
            assert 0 <= s <= e < nframes, f"window [{s},{e}] out of range"
            fbone, tjoint = foot_names[side]
            target = pj_npz[s, SOMA77[fbone]].astype(np.float64)
            toe_target = pj_npz[s, SOMA77[tjoint]].astype(np.float64)
            f0 = pos[fbone]
            t0pos = pos[tjoint]
            delta = target - f0
            toe_resid = float(np.linalg.norm((t0pos + delta) - toe_target))
            frames = list(range(s, e + 1))
            rshift = (root + delta).tolist()
            ftype = "left-foot" if side == "L" else "right-foot"
            fcls = LeftFootConstraintSet if side == "L" else RightFootConstraintSet
            fd = {
                "type": ftype,
                "frame_indices": frames,
                "local_joints_rot": [local_aa for _ in frames],
                "root_positions": [rshift for _ in frames],
                "smooth_root_2d": [[rshift[0], rshift[2]] for _ in frames],
            }
            cw = fcls.from_dict(skel, fd)
            gw = cw.global_joints_positions.numpy().astype(np.float64)
            w3 = 0.0
            chain = ["LeftFoot", "LeftToeBase"] if side == "L" else ["RightFoot", "RightToeBase"]
            for jn in chain:
                for k in range(len(frames)):
                    want = pj0[bi[jn]] + delta
                    w3 = max(w3, float(np.linalg.norm(gw[k, skel.bone_index[jn]] - want)))
            assert w3 < 1e-4, f"window [{s},{e}] {side} pin round-trip error {w3}"
            dicts.append(fd)
            pin_report.append({
                "foot": side, "start": s, "end": e,
                "shiftM": [round(float(v), 5) for v in delta],
                "shiftNormM": round(float(np.linalg.norm(delta)), 5),
                "toeResidualM": round(toe_resid, 5),
                "pinRoundTripMaxErrM": w3,
            })

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "constraints.json").write_text(json.dumps(dicts, indent=1) + "\n")
    (out_dir / "frame0-soma.json").write_text(json.dumps({
        "root": root.tolist(),
        "fkReconstructionMaxErrM": worst,
        "fkReconstructionMeanErrM": mean,
        "perJointErrM": {k: round(v, 6) for k, v in sorted(errs.items(), key=lambda kv: -kv[1])},
        "loaderRoundTripMaxErrM": w2,
        "hipHeightRatio": inv.HIP_HEIGHT_RATIO,
        "sourceRestHipsY": inv.SOURCE_REST_HIPS_Y,
        "positions": {nm: pos[nm].tolist() for nm in names},
    }, indent=1) + "\n")
    profile = {
        "takeFrame": "origin under frame-0 root, +Z model forward at heading 0",
        "turnRequestedDeg": args.turn_degrees,
        "turnConstrainedRad": turn_req,
        "bindYawMirrorCompensated": bool(args.negate_turn),
        "stand0Seconds": t0, "turnSeconds": tt, "holdSeconds": th,
        "durationSeconds": duration, "fps": FPS, "numFrames": nframes,
        "boundaries": {"stand0End": t0, "turnEnd": t0 + tt, "end": duration},
        "windowPins": pin_report,
    }
    (out_dir / "profile.json").write_text(json.dumps(profile, indent=1) + "\n")
    print(f"fkErr max={worst:.4f} mean={mean:.4f} loaderErr={w2:.2e} "
          f"frames={nframes} turnReq={math.degrees(turn_req):.2f}deg pins={len(pin_report)}")
    print(f"OK -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
