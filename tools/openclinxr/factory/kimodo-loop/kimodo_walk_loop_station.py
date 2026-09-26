#!/usr/bin/env python3
"""Factory station: (actor GLB, prompt, seed, constraint spec) -> a bound, in-place,
yaw-corrected walk-loop clip grafted onto that actor, with a provenance sidecar.

One scripted, deterministic command replacing the kimodo cagematch's own hand-run, multi-round
pipeline (docs/openclinxr/kimodo-mlx-bedside-approach-cagematch-2026-09-26.md, rounds 10-13):
generate with Root2DConstraintSet -> export positions/contacts -> find one clean loop cycle from
the steady middle -> bind in-place (round 11: strip horizontal root motion, fix vertical height;
round 13: skip the bake-time foot lock so the runtime's own stance lock plants the feet, matching
the shipped clip's convention) -> MEASURE the clip's own natural stepping direction (offline, via
the same production function the runtime uses) and correct it with a second bind pass, rather than
assume a fixed correction (round 12's finding: a fixed number does not generalize, since the
natural offset depends on which stance window the retarget produces) -> graft the corrected clip
onto the target actor via the existing `graft-bound-clip.ts` (by joint name, no Blender re-export
of the actor, so its own mesh/material bytes are untouched) -> write a provenance sidecar.

Orchestrates three runtimes as subprocesses, deliberately kept as separate processes rather than
merged into one: `kimodo_gen` (the nv-tlabs/kimodo venv, its own torch/transformers stack),
Blender's `bpy` (the retarget math, in `motion_bind_from_positions_stage.py`, unchanged), and
`tsx`/node (the production TypeScript measurement and graft tools this repo already ships).

Weights (the Kimodo checkpoint, HF text-encoder weights) stay outside git, in the standard HF cache
and the kimodo venv this cagematch already documented setting up; this script only reads their
identity (repo id, resolved HF snapshot hash) for the provenance record, never copies them.

Usage:
  python3 kimodo_walk_loop_station.py \\
    --actor apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb \\
    --prompt "An adult woman walks briskly and steadily, a clinical pace." \\
    --seed 42 \\
    --constraint-spec '{"distanceMeters": 3.6, "durationSeconds": 3.5, "headingRadians": 0.0}' \\
    --output /tmp/kimodo-loop/nurse-walk-loop.glb \\
    --clip-name openclinxr_retarget_kimodo_loop_nurse_seed42
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
STATION_SCRIPT = REPO_ROOT / "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py"
EXPORT_SCRIPT = Path(__file__).with_name("export_joint_positions_and_contacts.py")
FIND_CYCLE_SCRIPT = Path(__file__).with_name("find_walk_cycle.py")
BUILD_CONSTRAINTS_SCRIPT = Path(__file__).with_name("build_walk_constraints.py")
MEASURE_YAW_TOOL = REPO_ROOT / "tools/openclinxr/factory/measure-clip-stance-forward.ts"
GRAFT_TOOL = REPO_ROOT / "tools/openclinxr/factory/graft-bound-clip.ts"
DEFAULT_BONE_MAP = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json"

# Coordinator-established convention (round 12-13, measured on the shipped clip, not assumed): the
# target rig's own canonical forward, matched by the shipped `openclinxr_retarget_walk_source`.
SHIPPED_CONVENTION_YAW_DEG = -0.86

# nv-tlabs/kimodo's own default text encoder (kimodo/model/load_model.py:DEFAULT_TEXT_ENCODER and
# TEXT_ENCODER_PRESETS["llm2vec"], read from source 2026-09-26) -- recorded here as the KNOWN
# default, overridable at runtime by the TEXT_ENCODER env var, which this script reads and records
# rather than assuming the default always applies.
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
    """Resolve the checkpoint's HF snapshot hash and blob sha256 from the local HF cache -- no
    re-hashing of a multi-GB file, since HF's own cache already names blobs by their hash."""
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
    ap.add_argument("--actor", required=True, help="Path to the target actor GLB (never modified in place).")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument(
        "--constraint-spec",
        required=True,
        help='JSON: {"distanceMeters": float, "durationSeconds": float, "headingRadians": float}.',
    )
    ap.add_argument("--output", required=True, help="Final grafted GLB path (scratch; never the shipped path).")
    ap.add_argument("--clip-name", required=True)
    ap.add_argument("--work-dir", default=None, help="Scratch dir for intermediates. Default: alongside --output.")
    ap.add_argument("--kimodo-repo", default=str(Path.home() / ".openclinxr-tools/kimodo/kimodo"))
    ap.add_argument(
        "--kimodo-python",
        default=str(Path.home() / ".openclinxr-tools/kimodo/kimodo/.venv-official/bin/python3"),
    )
    ap.add_argument("--kimodo-model", default="Kimodo-SOMA-RP-v1.1")
    ap.add_argument("--diffusion-steps", type=int, default=20)
    ap.add_argument("--blender", default="blender")
    ap.add_argument("--map", default=str(DEFAULT_BONE_MAP))
    ap.add_argument("--report", required=True, help="Provenance sidecar output path.")
    args = ap.parse_args(argv)

    constraint_spec = json.loads(args.constraint_spec)
    for key in ("distanceMeters", "durationSeconds", "headingRadians"):
        if key not in constraint_spec:
            print(f"REFUSE constraint_spec missing {key}", file=sys.stderr)
            return 2

    work_dir = Path(args.work_dir) if args.work_dir else Path(args.output).with_suffix("")
    work_dir.mkdir(parents=True, exist_ok=True)
    actor_path = Path(args.actor).resolve()
    if not actor_path.is_file():
        print(f"REFUSE missing_actor: {actor_path}", file=sys.stderr)
        return 2

    # 1. Build the Root2DConstraintSet JSON from the small constraint spec.
    constraints_path = work_dir / "constraints.json"
    run([
        sys.executable, str(BUILD_CONSTRAINTS_SCRIPT),
        "--distance-meters", str(constraint_spec["distanceMeters"]),
        "--duration-seconds", str(constraint_spec["durationSeconds"]),
        "--heading-radians", str(constraint_spec["headingRadians"]),
        "--out", str(constraints_path),
    ])

    # 2. Generate with nv-tlabs/kimodo + Root2DConstraintSet.
    gen_output_stem = work_dir / "generated"
    run([
        args.kimodo_python, "-m", "kimodo.scripts.generate", args.prompt,
        "--model", args.kimodo_model,
        "--duration", str(constraint_spec["durationSeconds"]),
        "--diffusion_steps", str(args.diffusion_steps),
        "--seed", str(args.seed),
        "--constraints", str(constraints_path),
        "--no-postprocess",
        "--output", str(gen_output_stem),
    ], cwd=args.kimodo_repo)
    npz_path = gen_output_stem.with_suffix(".npz")
    if not npz_path.is_file():
        print(f"REFUSE generation_produced_no_npz: {npz_path}", file=sys.stderr)
        return 2

    # 3. Export joint positions (Y-up -> Z-up, verified) and foot-contact labels.
    joints_path = work_dir / "joints.json"
    contacts_path = work_dir / "contacts.json"
    run([
        sys.executable, str(EXPORT_SCRIPT),
        "--npz", str(npz_path), "--out-joints", str(joints_path), "--out-contacts", str(contacts_path),
    ])

    # 4. Find one clean, loopable two-step cycle from the steady middle, using the clip's own
    # foot-contact labels; slice both joints and contacts to it.
    cycle_joints_path = work_dir / "cycle_joints.json"
    cycle_contacts_path = work_dir / "cycle_contacts.json"
    cycle_window_path = work_dir / "cycle_window.json"
    run([
        sys.executable, str(FIND_CYCLE_SCRIPT),
        "--joints", str(joints_path), "--contacts", str(contacts_path),
        "--out-joints", str(cycle_joints_path), "--out-contacts", str(cycle_contacts_path),
        "--out-window", str(cycle_window_path),
    ])
    cycle_window = json.loads(cycle_window_path.read_text())

    # 5. Bind pass 1: in-place (root stripped, bake-time foot lock skipped per round 13), no yaw
    # correction yet -- this is what gets MEASURED next, not assumed.
    pass1_glb = work_dir / "bound_pass1.glb"
    pass1_report = work_dir / "bound_pass1.report.json"
    run([
        args.blender, "--background", "--python", str(STATION_SCRIPT), "--",
        "--actor", str(actor_path),
        "--joint-positions", str(cycle_joints_path),
        "--map", args.map,
        "--clip-name", f"{args.clip_name}__pass1",
        "--output", str(pass1_glb),
        "--report", str(pass1_report),
        "--foot-contacts", str(cycle_contacts_path),
        "--strip-horizontal-root-motion",
    ])

    # 6. Measure the clip's own natural stepping direction, offline, with the SAME production
    # function the runtime uses (measure-clip-stance-forward.ts -> measureStanceGroundAdvance) --
    # not assumed, not reused from a different seed or a different bind configuration (round 12's
    # finding: the natural offset depends on which stance window this specific bind produces).
    measure_result = run([
        "mise", "exec", "--", "tsx", str(MEASURE_YAW_TOOL), str(pass1_glb), f"{args.clip_name}__pass1",
    ], cwd=REPO_ROOT)
    natural = json.loads(measure_result.stdout.strip().splitlines()[-1])
    yaw_correction_deg = SHIPPED_CONVENTION_YAW_DEG - natural["clipYawDeg"]

    # 7. Bind pass 2: the same in-place cycle, now with the measured rigid yaw correction (a true
    # rigid rotation of the computed per-bone orientations, never the raw source positions --
    # round 12's own finding on why the first, wrong attempt at this broke floor contact).
    pass2_glb = work_dir / "bound_pass2.glb"
    pass2_report = work_dir / "bound_pass2.report.json"
    run([
        args.blender, "--background", "--python", str(STATION_SCRIPT), "--",
        "--actor", str(actor_path),
        "--joint-positions", str(cycle_joints_path),
        "--map", args.map,
        "--clip-name", args.clip_name,
        "--output", str(pass2_glb),
        "--report", str(pass2_report),
        "--foot-contacts", str(cycle_contacts_path),
        "--strip-horizontal-root-motion",
        "--yaw-correction-degrees", str(yaw_correction_deg),
    ])
    corrected = json.loads(run([
        "mise", "exec", "--", "tsx", str(MEASURE_YAW_TOOL), str(pass2_glb), args.clip_name,
    ], cwd=REPO_ROOT).stdout.strip().splitlines()[-1])

    # 8. Graft onto the target actor by joint name (no Blender re-export of the actor -- its own
    # mesh/material bytes are untouched), removing the actor's existing `openclinxr_retarget_*`
    # clip so ours is the sole match for the runtime's own prefix-based clip selection. Never
    # --publish: this never writes to the actor's own shipped path.
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    graft_report_path = work_dir / "graft.report.json"
    run([
        "mise", "exec", "--", "tsx", str(GRAFT_TOOL),
        "--target", str(actor_path),
        "--source", str(pass2_glb),
        "--clip", args.clip_name,
        "--output", str(output_path),
        "--remove-clip", "openclinxr_retarget_walk_source",
        "--remove-reason", "kimodo-walk-loop-station: replaced by the generated loop clip for this scratch output",
        "--report", str(graft_report_path),
    ], cwd=REPO_ROOT)
    graft_report = json.loads(graft_report_path.read_text())

    # 9. Provenance sidecar, in the shape this repo's other provenance JSONs use (schemaVersion,
    # a derivation/sourceOriginChain-style block, claims/notEvidenceFor), tailored to a generated
    # motion clip rather than a full humanoid.
    checkpoint = resolve_checkpoint_hash(f"nvidia/{args.kimodo_model}", Path.home() / ".cache/huggingface")
    text_encoder_preset = os.environ.get("TEXT_ENCODER", DEFAULT_TEXT_ENCODER_PRESET)
    provenance = {
        "schemaVersion": "openclinxr.kimodo-walk-loop-provenance.v1",
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
            "constraints": constraint_spec,
        },
        "cycleSelection": {
            "method": "left-heel-strike to left-heel-strike closest to the clip's own midpoint (find_walk_cycle.py)",
            "window": cycle_window,
            "frameRange": {"start": 1, "end": cycle_window["frames"], "count": cycle_window["frames"]},
        },
        "bind": {
            "station": "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py",
            "stripHorizontalRootMotion": True,
            "bakeTimeFootLockSkipped": True,
            "yawCorrection": {
                "naturalYawDeg": natural["clipYawDeg"],
                "targetYawDeg": SHIPPED_CONVENTION_YAW_DEG,
                "appliedCorrectionDeg": yaw_correction_deg,
                "correctedYawDeg": corrected["clipYawDeg"],
                "measuredWith": "tools/openclinxr/factory/measure-clip-stance-forward.ts (offline, gltf-transform FK, no browser)",
            },
            "rateOneStanceAdvanceMetersPerSecond": corrected["metersPerSecond"],
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
                "a deterministic, scripted (actor, prompt, seed, constraints) -> bound loop clip pipeline",
                "the clip's own measured stance-advance direction, corrected to the shipped clip's convention",
            ],
            "notEvidenceFor": [
                "gait realism", "clinical plausibility", "Quest performance",
                "walk/turn-quality bar passage (see the runtime capture report for this clip, if one was run)",
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
