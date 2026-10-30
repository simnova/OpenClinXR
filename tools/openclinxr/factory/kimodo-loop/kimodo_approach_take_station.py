#!/usr/bin/env python3
"""Factory station: (actor GLB, planned route polyline, arrival heading, prompt, seed) -> a bound
whole-approach take WITH horizontal root motion kept, grafted onto that actor, with a provenance
sidecar.

Sibling of kimodo_stop_oneshot_station.py for the whole-approach-take slice ("stand, walk the
planned route, stop" in ONE take, so no mid-walk walk-loop -> stop-clip switch drags the planted
foot). SHARES helpers with the stop station (run/git helpers/checkpoint/preset constants/stage
paths) by import -- do not fork them here.

Pipeline: route (world XZ, planner output for the case+room) + arrival heading -> take-frame
Root2DConstraintSet (build_approach_constraints.py: stand, cosine ease-in, cruise, cosine
ease-out, in-place turn to the arrival delta, hold) -> generate with nv-tlabs/kimodo (same
seed/prompt knobs as the sibling) -> export positions/contacts -> NO cut (the whole take is the
clip) -> bind WITH root motion (no --strip-horizontal-root-motion) and WITHOUT --foot-contacts
(no bake-time foot lock; the runtime stance lock pins) -> yaw from NET ROOT TRAVEL over the
translating span (Hips chord, the sibling's fixed method) with a second bind pass only if
|yaw - convention| > 5 deg -> graft by joint name onto the target actor WITHOUT removing its
shipped walk clip (never --publish, never the shipped path).

The clip name embeds the route hash: openclinxr_retarget_kimodo_approach_r<short16>_<rig>_seed<k>.
The runtime plays the take only when its recorded hash equals the hash of the route it planned;
anything else falls back to the legacy walk loop byte-for-byte.

Route-hash canonical form (MUST match dump_assay_route.ts and the runtime
bedside-approach-take-mod.ts byte-for-byte): points rounded to mm joined by `;`, `|`, heading
rounded to 1e-4 rad, sha256 hex. NOTE Math.round-bankers mismatch: JS Math.round(-1657.5) is
-1657 (half up) while Python round() is -1658 (half even), so this uses floor(v + 0.5).

Usage (job-owned outputs only -- never write canonical evidence paths or store URIs):
  JOB_TMP=$(mktemp -d "${TMPDIR:-/tmp}/openclinxr-approach-take-$$-XXXXXX")
  python3 kimodo_approach_take_station.py \\
    --actor apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb \\
    --route '[[-1.95,1.72],[-1.6575,1.575],[-1.365,1.43],[-1.0725,1.285],[-0.78,1.14]]' \\
    --arrival-heading-radians 3.141592653589793 \\
    --expected-hash b195b40700549c9977dcacb8caf538290bd09fa089976ad1bcd50d9fabd2af00 \\
    --walk-speed-mps 1.03 --rig physician --seed 1 \\
    --prompt "A person stands still, then walks forward, slows down and stops, turns in place, and stands still with both feet planted." \\
    --output "$JOB_TMP/physician-seed1.glb" \\
    --clip-name openclinxr_retarget_kimodo_approach_rb195b40700549c99_physician_seed1 \\
    --report "$JOB_TMP/physician-seed1.provenance.json"
  # Historical run wrote its take under the evidence root; the original local path is
  # historical only (no original-epoch authenticity claim) and the original preimage
  # original preimage archive is retained. Current immutable address:
  # store:4690ae15e3e690e5ff77fc76693cb87cddb9318ffbc3f5b6666bc4989af4a304/physician-seed1.glb
  # (see tools/openclinxr/evidence/asset-store/approach-take-retrieval-20261026.json);
  # future runs must use job-owned paths above.
"""
import argparse
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kimodo_stop_oneshot_station import (  # noqa: E402  (sibling share, not a fork)
    DEFAULT_BONE_MAP,
    DEFAULT_TEXT_ENCODER_MODELS,
    DEFAULT_TEXT_ENCODER_PRESET,
    EXPORT_SCRIPT,
    GRAFT_TOOL,
    REPO_ROOT,
    SHIPPED_CONVENTION_YAW_DEG,
    STATION_SCRIPT,
    YAW_REBIND_THRESHOLD_DEG,
    git_head,
    git_remote_url,
    resolve_checkpoint_hash,
    run,
)

BUILD_CONSTRAINTS_SCRIPT = Path(__file__).with_name("build_approach_constraints.py")


def js_round(value: float) -> int:
    """JS Math.round semantics (half up), not Python bankers rounding."""
    return math.floor(value + 0.5)


def canonical_route_string(points: list[tuple[float, float]], arrival_heading: float) -> str:
    point_part = ";".join(f"{js_round(x * 1000)},{js_round(z * 1000)}" for x, z in points)
    return f"{point_part}|{js_round(arrival_heading * 10000)}"


def route_hash_hex(points: list[tuple[float, float]], arrival_heading: float) -> str:
    return hashlib.sha256(canonical_route_string(points, arrival_heading).encode("utf-8")).hexdigest()


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--actor", required=True)
    ap.add_argument("--route", required=True, help="JSON [[x, z], ...] world-frame planner output.")
    ap.add_argument("--arrival-heading-radians", type=float, required=True)
    ap.add_argument("--constraint-arrival-heading-radians", type=float, default=None,
                    help="Arrival heading baked into the CONSTRAINTS (heading conditioning). Defaults "
                         "to --arrival-heading-radians. Pass the route travel heading here for a NO-BAKED-TURN "
                         "take (ends standing facing down the route; the runtime settling turn owns the "
                         "residual). The route HASH always uses --arrival-heading-radians (the true target), "
                         "so the hash gate is unaffected.")
    ap.add_argument("--expected-hash", default=None,
                    help="REFUSE when the computed route hash differs (canonical drift catch).")
    ap.add_argument("--walk-speed-mps", type=float, required=True)
    ap.add_argument("--constraint-scale", type=float, default=1.0,
                    help="Uniform scale applied to the route (relative to its start) AND the walk "
                         "speed before building constraints. Compensates the bind stage's deterministic "
                         "hip-height root-translation scale (bind report hipHeightRatio, ~0.92 on the "
                         "physician pilot) so the BOUND take covers the world route: pass 1/ratio, "
                         "measured from a pilot bind of the same rig. Recorded in provenance.")
    ap.add_argument("--rig", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--clip-name", required=True)
    ap.add_argument("--work-dir", default=None)
    ap.add_argument("--stand0-seconds", type=float, default=1.0)
    ap.add_argument("--easein-seconds", type=float, default=0.8)
    ap.add_argument("--decel-seconds", type=float, default=1.0)
    ap.add_argument("--turn-seconds", type=float, default=0.0)
    ap.add_argument("--hold-seconds", type=float, default=1.5)
    ap.add_argument("--bind-yaw-mirror", action="store_true",
                    help="Pass --negate-arrival-delta to the constraint builder (bind rotation path "
                         "is exactly yaw-negating; see build_approach_constraints.py). Recorded.")
    ap.add_argument("--kimodo-repo", default=str(Path.home() / ".openclinxr-tools/kimodo/kimodo"))
    ap.add_argument("--kimodo-python",
                    default=str(Path.home() / ".openclinxr-tools/kimodo/kimodo/.venv-official/bin/python3"))
    ap.add_argument("--kimodo-model", default="Kimodo-SOMA-RP-v1.1")
    ap.add_argument("--diffusion-steps", type=int, default=20)
    ap.add_argument("--blender", default="blender")
    ap.add_argument("--skip-generate", action="store_true")
    ap.add_argument("--map", default=str(DEFAULT_BONE_MAP))
    ap.add_argument("--report", required=True)
    args = ap.parse_args(argv)

    route = [(float(p[0]), float(p[1])) for p in json.loads(args.route)]
    arrival = float(args.arrival_heading_radians)
    constraint_arrival = float(args.constraint_arrival_heading_radians) \
        if args.constraint_arrival_heading_radians is not None else arrival
    route_hash = route_hash_hex(route, arrival)
    if args.expected_hash and route_hash != args.expected_hash:
        print(f"REFUSE route_hash_mismatch: computed {route_hash} != expected {args.expected_hash}",
              file=sys.stderr)
        return 2
    # Constraint-scale compensation (see --constraint-scale help): scale the route relative to
    # its start and the walk speed by the same factor, so profile TIMES are unchanged while
    # distances grow. The route HASH is computed on the unscaled world route above and is
    # unaffected: the hash names the world route, not the constraint means of covering it.
    scale = float(args.constraint_scale)
    x0, z0 = route[0]
    scaled_route = [(x0 + (x - x0) * scale, z0 + (z - z0) * scale) for x, z in route]
    scaled_speed = float(args.walk_speed_mps) * scale
    short = route_hash[:16]
    if f"_r{short}_" not in args.clip_name and not args.clip_name.endswith(f"_r{short}"):
        print(f"REFUSE clip_name_missing_hash: {args.clip_name} does not embed _r{short}_",
              file=sys.stderr)
        return 2

    work_dir = Path(args.work_dir) if args.work_dir else Path(args.output).with_suffix("")
    work_dir = work_dir.resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    actor_path = Path(args.actor).resolve()
    if not actor_path.is_file():
        print(f"REFUSE missing_actor: {actor_path}", file=sys.stderr)
        return 2

    # 1. Build the take-frame Root2DConstraintSet + phase profile.
    constraints_path = work_dir / "constraints.json"
    profile_path = work_dir / "profile.json"
    build_cmd = [
        sys.executable, str(BUILD_CONSTRAINTS_SCRIPT),
        "--route", json.dumps([[x, z] for x, z in scaled_route]),
        "--arrival-heading-radians", str(constraint_arrival),
        "--walk-speed-mps", str(scaled_speed),
        "--stand0-seconds", str(args.stand0_seconds),
        "--easein-seconds", str(args.easein_seconds),
        "--decel-seconds", str(args.decel_seconds),
        "--turn-seconds", str(args.turn_seconds),
        "--hold-seconds", str(args.hold_seconds),
        "--out", str(constraints_path),
        "--profile-out", str(profile_path),
    ]
    if args.bind_yaw_mirror:
        build_cmd.append("--negate-arrival-delta")
    run(build_cmd)
    profile = json.loads(profile_path.read_text())
    duration_seconds = float(profile["durationSeconds"])

    # 2. Generate with nv-tlabs/kimodo (same knobs as the sibling station).
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
    joints = json.loads(joints_path.read_text())

    # 4. Bind pass 1: WITH horizontal root motion kept (no --strip flag), WITHOUT --foot-contacts
    # (no bake-time foot lock; the runtime stance lock pins). No yaw correction yet.
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
    ])
    foot_lock_log = "\n".join(
        line for line in (pass1.stdout + pass1.stderr).splitlines() if "foot_lock" in line.lower()
    )

    # 5. Clip yaw from NET ROOT TRAVEL over the translating span (stand0 through decel end):
    # the Hips XY chord in the exported joint positions (Blender Z-up, ground plane = XY),
    # glTF-convention yaw atan2(dx, -dy) -- the sibling's fixed method.
    def wrap_deg(deg: float) -> float:
        return ((deg + 180.0) % 360.0) - 180.0

    hips = joints.get("Hips") if isinstance(joints, dict) else None
    if not hips or len(hips) < 2:
        print("REFUSE no Hips track in exported joint positions", file=sys.stderr)
        return 2
    fps = len(hips) / duration_seconds
    bounds = profile["boundaries"]
    span_start = min(len(hips) - 1, int(round(float(bounds["stand0End"]) * fps)))
    span_end = min(len(hips) - 1, int(round(float(bounds["decelEnd"]) * fps)) - 1)
    dx = hips[span_end][0] - hips[span_start][0]
    dy = hips[span_end][1] - hips[span_start][1]
    natural = {"clipYawDeg": wrap_deg(math.degrees(math.atan2(dx, -dy)))}
    yaw_correction_deg = wrap_deg(SHIPPED_CONVENTION_YAW_DEG - natural["clipYawDeg"])

    # 6. Bind pass 2 only if off-convention by more than the sibling's threshold.
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
            "--yaw-correction-degrees", str(yaw_correction_deg),
        ])
        corrected = {"clipYawDeg": wrap_deg(natural["clipYawDeg"] + yaw_correction_deg)}

    # 7. Graft onto the target actor by joint name WITHOUT removing its shipped walk clip
    # (the take is selected by route hash at runtime; the walk loop stays for fallback).
    # Never --publish, never the shipped path.
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

    # 8. Provenance sidecar: route hash + seed + speeds + generator identities.
    checkpoint = resolve_checkpoint_hash(f"nvidia/{args.kimodo_model}", Path.home() / ".cache/huggingface")
    text_encoder_preset = os.environ.get("TEXT_ENCODER", DEFAULT_TEXT_ENCODER_PRESET)
    provenance = {
        "schemaVersion": "openclinxr.kimodo-approach-take-provenance.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "clipName": args.clip_name,
        "targetActor": str(actor_path.relative_to(REPO_ROOT)) if actor_path.is_relative_to(REPO_ROOT) else str(actor_path),
        "outputGlb": str(output_path),
        "routeHash": route_hash,
        "routeHashShort": short,
        "route": {"points": [[x, z] for x, z in route], "arrivalHeadingRadians": arrival},
        "constraintArrivalHeadingRadians": constraint_arrival,
        "noBakedTurn": float(profile.get("turnSeconds", 0.0)) == 0.0,
        "constraintScale": {
            "factor": scale,
            "scaledRouteLengthM": float(profile["routeLengthM"]),
            "scaledWalkSpeedMps": scaled_speed,
            "derivation": "1/hipHeightRatio from the same rig's pilot bind report (unscaled seed-1 take), or 1.0 when unscaled",
        },
        "bindYawMirrorCompensated": bool(args.bind_yaw_mirror),
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
            "constraintProfile": "stand, cosine ease-in, cruise, cosine ease-out, in-place turn to arrival delta, hold (build_approach_constraints.py)",
            "constraintProfileDetail": profile,
        },
        "bind": {
            "station": "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py",
            "stripHorizontalRootMotion": False,
            "bakeTimeFootLock": False,
            "bakeTimeFootLockLog": foot_lock_log if foot_lock_log else "no foot_lock log line (no --foot-contacts passed, as specified)",
            "yawCorrection": {
                "naturalYawDeg": natural["clipYawDeg"],
                "targetYawDeg": SHIPPED_CONVENTION_YAW_DEG,
                "appliedCorrectionDeg": yaw_correction_deg if yaw_rebind else 0.0,
                "rebindForYaw": bool(yaw_rebind),
                "correctedYawDeg": corrected["clipYawDeg"],
                "measuredWith": "net Hips root-travel chord over stand0->decelEnd (Blender XY -> glTF-convention yaw atan2(dx,-dy))",
                "spanSeconds": [float(bounds["stand0End"]), float(bounds["decelEnd"])],
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
                "a deterministic, scripted (actor, route, heading, prompt, seed) -> bound whole-approach take pipeline with root motion kept",
                "the take's recorded route hash (sha256 of the mm-rounded polyline + arrival heading)",
            ],
            "notEvidenceFor": [
                "gait realism", "clinical plausibility", "Quest performance",
                "foot-plant bar passage (see the assay report for this take)",
                "whether Kimodo honored the arrival heading (see the sweep row endFacingErrorDeg)",
                "production readiness of the target actor GLB this was grafted onto (scratch output only)",
            ],
        },
    }
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path), "report": args.report,
                      "routeHash": route_hash, "yawCorrectionDeg": yaw_correction_deg}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
