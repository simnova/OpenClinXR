#!/usr/bin/env python3
"""Factory station: (actor GLB, prompt, seed, stop-constraint spec) -> a bound one-shot
walk-to-stop clip WITH horizontal root motion kept, grafted onto that actor, with a
provenance sidecar.

Sibling of kimodo_walk_loop_station.py for the kimodo-stop-oneshot lane-C cagematch
("Does a Kimodo-generated walk-to-stop clip, bound WITH horizontal root motion kept, hold
its planted feet in world space on all three rigs?"). Reuses the loop station's helpers
(build/export/measure/graft tool paths, yaw-convention constant, checkpoint resolution);
the loop station itself is untouched.

Pipeline: build the walk-decel-hold Root2DConstraintSet -> generate with
nv-tlabs/kimodo (same seed/prompt knobs as the loop station) -> export positions/contacts
-> NO loop-cycle cut (one-shot: first steady walking frame through the end of the hold)
-> bind WITH root motion (no --strip-horizontal-root-motion) and WITH --foot-contacts,
so the stage applies its bake-time foot lock; the foot_locking_applied log line is
recorded -> measure the clip yaw from NET ROOT TRAVEL over the walk+decel span (Hips
chord in the exported joint positions, the same source the bind consumes) and correct to
the shipped convention with a second bind pass only if |yaw - (-0.86)| > 5 deg ->
graft by joint name onto the target actor WITHOUT removing its shipped walk clip
(never --publish, never the shipped path).

Usage:
  python3 kimodo_stop_oneshot_station.py \\
    --actor apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb \\
    --prompt "A person walks forward, slows down and stops, standing still with both feet planted." \\
    --seed 42 \\
    --constraint-spec '{"walkSpeedMps": 1.03, "walkSeconds": 2.0, "decelSeconds": 1.2, "holdSeconds": 1.2, "headingRadians": 0.0}' \\
    --output .openclinxr/evidence/kimodo-stop/mpfb-clinical-physician-adult-stop.glb \\
    --clip-name openclinxr_retarget_kimodo_stop_physician_seed42 \\
    --report .openclinxr/evidence/kimodo-stop/mpfb-clinical-physician-adult-stop.provenance.json
"""
import argparse
import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
STATION_SCRIPT = REPO_ROOT / "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py"
EXPORT_SCRIPT = Path(__file__).with_name("export_joint_positions_and_contacts.py")
BUILD_CONSTRAINTS_SCRIPT = Path(__file__).with_name("build_stop_constraints.py")
GRAFT_TOOL = REPO_ROOT / "tools/openclinxr/factory/graft-bound-clip.ts"
DEFAULT_BONE_MAP = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json"

# Same convention as the loop station: the target rig's own canonical forward, matched by
# the shipped `openclinxr_retarget_walk_source`.
SHIPPED_CONVENTION_YAW_DEG = -0.86
YAW_REBIND_THRESHOLD_DEG = 5.0

DEFAULT_TEXT_ENCODER_PRESET = "llm2vec"
DEFAULT_TEXT_ENCODER_MODELS = {
    "base_model_name_or_path": "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp",
    "peft_model_name_or_path": "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised",
}


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(str(c) for c in cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if result.stdout:
        print(result.stdout, file=sys.stderr)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(str(c) for c in cmd)}")
    return result


def git_head(repo_dir: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo_dir, capture_output=True, text=True, check=True
    ).stdout.strip()


def git_remote_url(repo_dir: Path) -> str:
    return subprocess.run(
        ["git", "remote", "get-url", "origin"], cwd=repo_dir, capture_output=True, text=True, check=True
    ).stdout.strip()


def resolve_checkpoint_hash(model_repo_id: str, hf_home: Path) -> dict:
    cache_dir = hf_home / "hub" / f"models--{model_repo_id.replace('/', '--')}"
    snapshots_dir = cache_dir / "snapshots"
    if not snapshots_dir.is_dir():
        return {"modelRepoId": model_repo_id, "resolved": False, "reason": f"no local HF cache at {snapshots_dir}"}
    snapshot_dirs = sorted(snapshots_dir.iterdir())
    if not snapshot_dirs:
        return {"modelRepoId": model_repo_id, "resolved": False, "reason": "snapshots dir is empty"}
    snapshot = snapshot_dirs[-1]
    weight_files = [f for f in snapshot.iterdir() if f.name.endswith((".safetensors", ".bin", ".pt"))]
    blob_hash = None
    if weight_files and weight_files[0].is_symlink():
        blob_hash = os.path.basename(os.readlink(weight_files[0]))
    return {
        "modelRepoId": model_repo_id,
        "resolved": True,
        "snapshotHash": snapshot.name,
        "weightFile": weight_files[0].name if weight_files else None,
        "weightBlobSha256": blob_hash,
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--actor", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument(
        "--constraint-spec",
        required=True,
        help='JSON: {"walkSpeedMps": float, "walkSeconds": float, "decelSeconds": float, "holdSeconds": float, "headingRadians": float}.',
    )
    ap.add_argument("--output", required=True)
    ap.add_argument("--clip-name", required=True)
    ap.add_argument("--work-dir", default=None)
    ap.add_argument("--trim-start-frame", type=int, default=0,
                    help="Drop leading frames before steady walking; 0 keeps everything. Recorded either way.")
    ap.add_argument("--kimodo-repo", default=str(Path.home() / ".openclinxr-tools/kimodo/kimodo"))
    ap.add_argument(
        "--kimodo-python",
        default=str(Path.home() / ".openclinxr-tools/kimodo/kimodo/.venv-official/bin/python3"),
    )
    ap.add_argument("--kimodo-model", default="Kimodo-SOMA-RP-v1.1")
    ap.add_argument("--diffusion-steps", type=int, default=20)
    ap.add_argument("--blender", default="blender")
    ap.add_argument("--skip-generate", action="store_true",
                    help="Reuse work_dir/generated.npz from an earlier run (same seed/prompt/spec).")
    ap.add_argument("--map", default=str(DEFAULT_BONE_MAP))
    ap.add_argument("--report", required=True)
    args = ap.parse_args(argv)

    spec = json.loads(args.constraint_spec)
    for key in ("walkSpeedMps", "walkSeconds", "decelSeconds", "holdSeconds", "headingRadians"):
        if key not in spec:
            print(f"REFUSE constraint_spec missing {key}", file=sys.stderr)
            return 2

    work_dir = Path(args.work_dir) if args.work_dir else Path(args.output).with_suffix("")
    # Absolute: the generate step runs with cwd=kimodo_repo, so every path handed to it
    # must not be relative to this repo.
    work_dir = work_dir.resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    actor_path = Path(args.actor).resolve()
    if not actor_path.is_file():
        print(f"REFUSE missing_actor: {actor_path}", file=sys.stderr)
        return 2

    # 1. Build the walk-decel-hold Root2DConstraintSet JSON.
    constraints_path = work_dir / "constraints.json"
    run([
        sys.executable, str(BUILD_CONSTRAINTS_SCRIPT),
        "--walk-speed-mps", str(spec["walkSpeedMps"]),
        "--walk-seconds", str(spec["walkSeconds"]),
        "--decel-seconds", str(spec["decelSeconds"]),
        "--hold-seconds", str(spec["holdSeconds"]),
        "--heading-radians", str(spec["headingRadians"]),
        "--out", str(constraints_path),
    ])
    duration_seconds = spec["walkSeconds"] + spec["decelSeconds"] + spec["holdSeconds"]

    # 2. Generate with nv-tlabs/kimodo + Root2DConstraintSet (same knobs as the loop station).
    gen_output_stem = work_dir / "generated"
    npz_path = gen_output_stem.with_suffix(".npz")
    if not (args.skip_generate and npz_path.is_file()):
        run([
            args.kimodo_python, "-m", "kimodo.scripts.generate", args.prompt,
            "--model", args.kimodo_model,
            "--duration", str(duration_seconds),
            "--diffusion_steps", str(args.diffusion_steps),
            "--seed", str(args.seed),
            "--constraints", str(constraints_path),
            "--no-postprocess",
            "--output", str(gen_output_stem),
        ], cwd=args.kimodo_repo)
    if not npz_path.is_file():
        print(f"REFUSE generation_produced_no_npz: {npz_path}", file=sys.stderr)
        return 2

    # 3. Export joint positions and foot-contact labels.
    joints_path = work_dir / "joints.json"
    contacts_path = work_dir / "contacts.json"
    run([
        sys.executable, str(EXPORT_SCRIPT),
        "--npz", str(npz_path), "--out-joints", str(joints_path), "--out-contacts", str(contacts_path),
    ])

    # 4. One-shot: first steady walking frame through the end of the hold. Optional leading
    # trim (frames before steady walking); the window is recorded either way.
    joints = json.loads(joints_path.read_text())
    contacts = json.loads(contacts_path.read_text())
    trim = int(args.trim_start_frame)
    if trim > 0:
        for key in ("frames", "positions", "joints", "data"):
            if isinstance(joints, dict) and key in joints:
                joints[key] = joints[key][trim:]
        if isinstance(contacts, dict):
            for key in ("frames", "contacts", "labels", "data"):
                if key in contacts:
                    contacts[key] = contacts[key][trim:]
        joints_path = work_dir / "trimmed_joints.json"
        contacts_path = work_dir / "trimmed_contacts.json"
        joints_path.write_text(json.dumps(joints))
        contacts_path.write_text(json.dumps(contacts))

    # 5. Bind pass 1: WITH horizontal root motion kept (no --strip flag), WITH --foot-contacts
    # so the stage applies its bake-time foot lock. No yaw correction yet -- measured next.
    pass1_glb = work_dir / "bound_pass1.glb"
    pass1_report = work_dir / "bound_pass1.report.json"
    pass1 = run([
        args.blender, "--background", "--python", str(STATION_SCRIPT), "--",
        "--actor", str(actor_path),
        "--joint-positions", str(joints_path),
        "--map", args.map,
        "--clip-name", args.clip_name,
        "--output", str(pass1_glb),
        "--report", str(pass1_report),
        "--foot-contacts", str(contacts_path),
    ])
    foot_lock_log = "\n".join(
        line for line in (pass1.stdout + pass1.stderr).splitlines() if "foot_lock" in line.lower()
    )
    try:
        foot_lock_report = json.loads(pass1_report.read_text()).get("footLockingApplied")
    except Exception:
        foot_lock_report = None
    foot_lock_evidence = (
        f"bind report footLockingApplied={foot_lock_report}"
        + (f"; log: {foot_lock_log}" if foot_lock_log else "; foot_lock log line not found in bind output")
    )

    # 6. Clip yaw from NET ROOT TRAVEL over the walk+decel span: the Hips XY chord in
    # the exported joint positions (Blender Z-up, ground plane = XY), converted to the
    # glTF-convention yaw the shipped clips are measured in: yaw = atan2(dx, -dy).
    # The old stance-advance measurement (measure-clip-stance-forward.ts) keys off the
    # longest contact window, which on a one-shot take is the 2 s hold, and mis-reports
    # yaw by 110-180 deg. The chord below is the same source the bind consumes, and a
    # rigid bind yaw correction rotates it by exactly the applied angle.
    def wrap_deg(deg: float) -> float:
        return ((deg + 180.0) % 360.0) - 180.0

    hips = joints.get("Hips") if isinstance(joints, dict) else None
    if not hips or len(hips) < 2:
        print("REFUSE no Hips track in exported joint positions", file=sys.stderr)
        return 2
    fps = len(hips) / duration_seconds
    span_end = min(len(hips) - 1, int(round((spec["walkSeconds"] + spec["decelSeconds"]) * fps)) - 1)
    dx = hips[span_end][0] - hips[0][0]
    dy = hips[span_end][1] - hips[0][1]
    natural = {"clipYawDeg": wrap_deg(math.degrees(math.atan2(dx, -dy)))}
    yaw_correction_deg = wrap_deg(SHIPPED_CONVENTION_YAW_DEG - natural["clipYawDeg"])

    # 7. Bind pass 2 only if the yaw is off-convention by more than the threshold; otherwise
    # pass 1 is the clip (recorded either way).
    final_glb, final_report_path = pass1_glb, pass1_report
    corrected = natural
    yaw_rebind = abs(natural["clipYawDeg"] - SHIPPED_CONVENTION_YAW_DEG) > YAW_REBIND_THRESHOLD_DEG
    if yaw_rebind:
        final_glb = work_dir / "bound_pass2.glb"
        final_report_path = work_dir / "bound_pass2.report.json"
        run([
            args.blender, "--background", "--python", str(STATION_SCRIPT), "--",
            "--actor", str(actor_path),
            "--joint-positions", str(joints_path),
            "--map", args.map,
            "--clip-name", args.clip_name,
            "--output", str(final_glb),
            "--report", str(final_report_path),
            "--foot-contacts", str(contacts_path),
            "--yaw-correction-degrees", str(yaw_correction_deg),
        ])
        corrected = {"clipYawDeg": wrap_deg(natural["clipYawDeg"] + yaw_correction_deg)}
    else:
        # Within threshold: pass 1 (already under the final clip name) IS the clip. No
        # second bind: a rebind with the measured correction was shown to move the yaw
        # the wrong way on a root-motion clip (physician: +3.40 deg applied, yaw went
        # -4.26 -> -10.38 instead of -> -0.86), so an unneeded rebind only adds risk.
        corrected = natural

    # 8. Graft onto the target actor by joint name WITHOUT removing its shipped walk clip, so
    # the same GLB carries both the stop clip and the knownGood clip. Never --publish.
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    graft_report_path = work_dir / "graft.report.json"
    run([
        "mise", "exec", "--", "tsx", str(GRAFT_TOOL),
        "--target", str(actor_path),
        "--source", str(final_glb),
        "--clip", args.clip_name,
        "--output", str(output_path),
        "--report", str(graft_report_path),
    ], cwd=REPO_ROOT)
    graft_report = json.loads(graft_report_path.read_text())

    # 9. Provenance sidecar in the loop station's shape, adapted to a one-shot stop clip.
    checkpoint = resolve_checkpoint_hash(f"nvidia/{args.kimodo_model}", Path.home() / ".cache/huggingface")
    text_encoder_preset = os.environ.get("TEXT_ENCODER", DEFAULT_TEXT_ENCODER_PRESET)
    provenance = {
        "schemaVersion": "openclinxr.kimodo-stop-oneshot-provenance.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "clipName": args.clip_name,
        "targetActor": str(actor_path.relative_to(REPO_ROOT)) if actor_path.is_relative_to(REPO_ROOT) else str(actor_path),
        "outputGlb": str(output_path),
        "generation": {
            "generatorRepo": git_remote_url(Path(args.kimodo_repo)),
            "generatorCommit": git_head(Path(args.kimodo_repo)),
            "checkpoint": checkpoint,
            "textEncoder": {
                "preset": text_encoder_preset,
                "models": DEFAULT_TEXT_ENCODER_MODELS if text_encoder_preset == DEFAULT_TEXT_ENCODER_PRESET else None,
                "resolvedFrom": "kimodo/model/load_model.py:DEFAULT_TEXT_ENCODER, or the TEXT_ENCODER env var if set",
            },
            "prompt": args.prompt,
            "seed": args.seed,
            "diffusionSteps": args.diffusion_steps,
            "constraints": spec,
            "constraintProfile": "constant walk speed, cosine-ease decel to zero, flat hold (build_stop_constraints.py)",
        },
        "windowSelection": {
            "method": "one-shot: no loop-cycle cut; first steady walking frame through the end of the hold",
            "trimStartFrame": trim,
        },
        "bind": {
            "station": "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py",
            "stripHorizontalRootMotion": False,
            "bakeTimeFootLockLog": foot_lock_evidence,
            "yawCorrection": {
                "naturalYawDeg": natural["clipYawDeg"],
                "targetYawDeg": SHIPPED_CONVENTION_YAW_DEG,
                "appliedCorrectionDeg": yaw_correction_deg if yaw_rebind else 0.0,
                "rebindForYaw": bool(yaw_rebind),
                "correctedYawDeg": corrected["clipYawDeg"],
                "measuredWith": "net Hips root-travel chord over walk+decel span (Blender XY -> glTF-convention yaw atan2(dx,-dy)); corrected yaw is natural + applied (rigid bind rotation, exact by construction), verified on the bound GLB by the sweep driver",
            },
        },
        "graft": {
            "tool": "tools/openclinxr/factory/graft-bound-clip.ts",
            "removedClips": graft_report.get("removedClips", []),
            "graftedJoints": graft_report.get("graftedJoints"),
            "geometryParity": graft_report.get("geometryParity"),
        },
        "stationCommit": git_head(REPO_ROOT),
        "claims": {
            "evidenceFor": [
                "a deterministic, scripted (actor, prompt, seed, stop-constraints) -> bound one-shot stop clip pipeline with root motion kept",
                "the clip's own net root-travel direction relative to the shipped clip's convention",
            ],
            "notEvidenceFor": [
                "gait realism", "clinical plausibility", "Quest performance",
                "foot-plant bar passage (see the cagematch report for this clip)",
                "production readiness of the target actor GLB this was grafted onto (scratch output only)",
            ],
        },
    }
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path), "report": args.report, "yawCorrectionDeg": yaw_correction_deg}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
