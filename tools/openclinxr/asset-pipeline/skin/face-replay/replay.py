"""Replay CLI: runs the hand-steps chain from manifest, verifying input SHAs.

Zero model calls, zero renders. Refuses on missing/mismatched input.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def verify_sha(path: Path, expected: str, label: str) -> None:
    actual = sha256_file(path)
    if actual != expected:
        raise RuntimeError(f"{label} SHA MISMATCH: actual {actual[:16]} != expected {expected[:16]}: refuse")


def run_stage(stage: dict, subject: str, store_dir: Path, inputs: dict, overrides: dict, stage_idx: int) -> dict:
    """Run a single stage, return updated inputs with outputs."""
    name = stage["name"]
    script = stage["script"]
    params = stage.get("parameters", {}).copy()
    input_kinds = stage.get("input_kinds", [])
    output_shas = stage.get("output_shas_aisha", {})
    output_paths = stage.get("output_paths", {})

    # Apply per-subject parameter overrides for this stage.
    params.update(overrides.get(subject, {}).get(name, {}))

    # A stage that records an output image but no parameters is not a
    # replayable script (known-bad manifest): refuse before running.
    if not stage.get("parameters"):
        raise RuntimeError(f"Stage {name} records no parameters: refuse")

    print(f"\n=== Stage {stage_idx}: {name} ===", flush=True)
    print(f"  script: {script}", flush=True)
    print(f"  params: {params}", flush=True)

    # Resolve inputs based on input_kinds
    resolved = {}
    for kind in input_kinds:
        if kind in inputs:
            resolved[kind] = inputs[kind]
        else:
            raise RuntimeError(f"Missing input kind '{kind}' for stage {name}")

    # Build command
    script_path = Path(__file__).parent / script
    if not script_path.exists():
        raise RuntimeError(f"Script not found: {script_path}")

    cmd = [sys.executable, str(script_path)]

    # Map input kinds to CLI args based on script
    def seed_derived(out_dir: Path) -> None:
        for key, out_name in output_paths.items():
            inputs[key] = out_dir / out_name
        inputs["ao_png"] = out_dir / "ao.png"
        inputs["occupancy_png"] = out_dir / "occupancy.png"
        inputs["lip_uv_npz"] = out_dir / "lipuv.npz"
        inputs["landmarks_uv_json"] = out_dir / "landmarks-uv.json"
        inputs["facecore_mask"] = out_dir / "mask-facecore.png"
        inputs["lips_mask"] = out_dir / "mask-lips.png"
        inputs["eyes_L_mask"] = out_dir / "mask-eyes-L.png"
        inputs["eyes_R_mask"] = out_dir / "mask-eyes-R.png"
        inputs["brows_L_mask"] = out_dir / "mask-brows-L.png"
        inputs["brows_R_mask"] = out_dir / "mask-brows-R.png"

    if name == "derive":
        out_dir = store_dir / f"{name}_out"
        if params.get("no_ao", False) and out_dir.exists() and all(
                (out_dir / out_name).exists()
                for out_name in output_paths.values()):
            print(f"  derive outputs already exist, skipping", flush=True)
            seed_derived(out_dir)
            return inputs
        cmd += [str(resolved["subject_glb"]), str(out_dir)]
        cmd += ["--size", str(params.get("size", 4096))]
        if params.get("no_ao", False):
            cmd += ["--no-ao"]
        seed_derived(out_dir)
    elif name == "occlusion":
        cmd += ["--in", str(resolved["albedo_png"])]
        cmd += ["--out", str(store_dir / output_paths["albedo_occ_png"])]
        cmd += ["--ao", str(resolved["ao_png"])]
        cmd += ["--occupancy", str(resolved["occupancy_png"])]
        cmd += ["--p", str(params["p"])]
        cmd += ["--k", str(params["k"])]
        inputs["albedo_occ_png"] = store_dir / output_paths["albedo_occ_png"]
        inputs["albedo_png"] = store_dir / output_paths["albedo_occ_png"]
    elif name == "roughness":
        cmd += ["--albedo", str(resolved["albedo_png"])]
        cmd += ["--out", str(store_dir / output_paths["roughness_png"])]
        cmd += ["--ao", str(resolved["ao_png"])]
        derive_out = store_dir / "derive_out"
        cmd += ["--lip-uv", str(derive_out / "lipuv.npz")]
        cmd += ["--landmarks", str(derive_out / "landmarks-uv.json")]
        cmd += ["--facecore-mask", str(derive_out / "mask-facecore.png")]
        cmd += ["--tcoef", str(params["tcoef"])]
        inputs["roughness_png"] = store_dir / output_paths["roughness_png"]
    elif name == "lips":
        cmd += [str(resolved["albedo_png"]), str(store_dir / output_paths["albedo_lips_png"])]
        cmd += ["--ratio", str(params["ratio"])]
        cmd += ["--lipuv", str(store_dir / "derive_out" / "lipuv.npz")]
        inputs["albedo_lips_png"] = store_dir / output_paths["albedo_lips_png"]
        inputs["albedo_png"] = store_dir / output_paths["albedo_lips_png"]
    elif name == "eye_corners":
        cmd += [str(resolved["albedo_png"]), str(store_dir / output_paths["albedo_corners_png"])]
        cmd += ["--socket-wall-L", str(store_dir / "derive_out" / "socket-wall-L.png")]
        cmd += ["--socket-wall-R", str(store_dir / "derive_out" / "socket-wall-R.png")]
        cmd += ["--landmarks", str(store_dir / "derive_out" / "landmarks-uv.json")]
        cmd += ["--inner-rgb", *[str(x) for x in params["inner_rgb"]]]
        cmd += ["--outer-rgb", *[str(x) for x in params["outer_rgb"]]]
        cmd += ["--feather-px", str(params["feather_px"])]
        inputs["albedo_corners_png"] = store_dir / output_paths["albedo_corners_png"]
        inputs["albedo_png"] = store_dir / output_paths["albedo_corners_png"]
    elif name == "symmetrise":
        cmd += [str(resolved["albedo_png"]), str(resolved["subject_glb"]), str(store_dir / output_paths["albedo_sym_png"])]
        cmd += ["--strength", str(params["strength"])]
        derive_out = store_dir / "derive_out"
        cmd += ["--facecore-mask", str(derive_out / "mask-facecore.png")]
        cmd += ["--lips-mask", str(derive_out / "mask-lips.png")]
        cmd += ["--eyes-L-mask", str(derive_out / "mask-eyes-L.png")]
        cmd += ["--eyes-R-mask", str(derive_out / "mask-eyes-R.png")]
        cmd += ["--brows-L-mask", str(derive_out / "mask-brows-L.png")]
        cmd += ["--brows-R-mask", str(derive_out / "mask-brows-R.png")]
        inputs["albedo_sym_png"] = store_dir / output_paths["albedo_sym_png"]
        inputs["albedo_png"] = store_dir / output_paths["albedo_sym_png"]
    elif name == "socket":
        cmd += [str(resolved["albedo_png"]), str(store_dir / output_paths["albedo_socket_png"])]
        from PIL import Image as _PI
        import numpy as _np
        derive_out = store_dir / "derive_out"
        _l = _np.array(_PI.open(derive_out / "mask-eyes-L.png").convert("L"))
        _r = _np.array(_PI.open(derive_out / "mask-eyes-R.png").convert("L"))
        _union = store_dir / "eye-mask-union.png"
        _PI.fromarray(_np.maximum(_l, _r)).save(_union)
        cmd += ["--eye-mask", str(_union)]
        cmd += ["--cheek-l", str(params["cheek_lab"][0])]
        cmd += ["--cheek-a", str(params["cheek_lab"][1])]
        cmd += ["--cheek-b", str(params["cheek_lab"][2])]
        cmd += ["--dilate-px", str(params["dilate_px"])]
        cmd += ["--feather-px", str(params["feather_px"])]
        inputs["albedo_socket_png"] = store_dir / output_paths["albedo_socket_png"]
        inputs["albedo_png"] = store_dir / output_paths["albedo_socket_png"]
    elif name == "beard_shadow":
        cmd += [str(resolved["albedo_png"]), str(store_dir / output_paths["albedo_beard_png"])]
        derive_out = store_dir / "derive_out"
        cmd += ["--landmarks", str(derive_out / "landmarks-uv.json")]
        cmd += ["--lips-mask", str(derive_out / "mask-lips.png")]
        cmd += ["--facecore-mask", str(derive_out / "mask-facecore.png")]
        cmd += ["--weight", str(params["weight"])]
        cmd += ["--seed", str(params["seed"])]
        cmd += ["--texels-per-mm", str(params["texels_per_mm"])]
        inputs["albedo_beard_png"] = store_dir / output_paths["albedo_beard_png"]
        inputs["albedo_png"] = store_dir / output_paths["albedo_beard_png"]
    elif name == "detail_bands":
        cmd += [str(resolved["albedo_png"]), str(store_dir / output_paths["albedo_detail_png"])]
        derive_out = store_dir / "derive_out"
        cmd += ["--facecore-mask", str(derive_out / "mask-facecore.png")]
        cmd += ["--lips-mask", str(derive_out / "mask-lips.png")]
        cmd += ["--texels-per-mm", str(params["texels_per_mm"])]
        cmd += ["--seed", str(params["seed"])]
        cmd += ["--crease-gain", str(params["crease_gain"])]
        cmd += ["--pore-gain", str(params["pore_gain"])]
        cmd += ["--pore-d-mm", str(params["pore_d_mm"])]
        cmd += ["--pore-density-per-mm2", str(params["pore_density_per_mm2"])]
        inputs["albedo_detail_png"] = store_dir / output_paths["albedo_detail_png"]
        inputs["albedo_png"] = store_dir / output_paths["albedo_detail_png"]
    else:
        raise RuntimeError(f"Unknown stage: {name}")

    # Run the stage
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Stage {name} failed:\n{result.stdout}\n{result.stderr}")
    print(result.stdout, flush=True)

    # Verify output SHAs if provided (for Aisha reference run)
    for out_key, expected_sha in output_shas.items():
        if expected_sha != "PLACEHOLDER_SHA256":
            out_path = inputs.get(out_key)
            if out_path and out_path.exists():
                verify_sha(out_path, expected_sha, f"{name}:{out_key}")

    return inputs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Replay face-replay hand-steps chain from manifest")
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--subject", type=str, required=True)
    ap.add_argument("--store", type=Path, required=True)
    ap.add_argument("--glb", type=Path, required=True)
    ap.add_argument("--albedo", type=Path, required=True)
    ap.add_argument("--skip-ao", action="store_true", help="Skip AO bake (use existing)")
    ap.add_argument("--skip-stages", type=str, default="",
                    help="Comma-separated stage names to pass through unchanged "
                         "(e.g. occlusion: clean albedo = pre-apply_occ output). "
                         "Inputs flow to the next stage untouched; logged as SKIP.")
    args = ap.parse_args(argv)

    manifest = json.loads(args.manifest.read_text())
    stages = manifest["stages"]
    subjects = manifest.get("subjects", {})
    overrides = {}
    for subj, data in subjects.items():
        overrides[subj] = data.get("overrides", {})

    store_dir = args.store
    store_dir.mkdir(parents=True, exist_ok=True)

    # Initial inputs
    inputs = {
        "subject_glb": args.glb,
        "albedo_png": args.albedo,
    }

    # Verify GLB SHA if in manifest
    if "glb_sha256" in subjects.get(args.subject, {}):
        expected_glb = subjects[args.subject]["glb_sha256"]
        if expected_glb != "PLACEHOLDER_GLB_SHA256":
            verify_sha(args.glb, expected_glb, "subject GLB")

    for i, stage in enumerate(stages):
        # Skip AO bake stage (human-run)
        if stage["name"] == "derive" and args.skip_ao:
            stage["parameters"]["no_ao"] = True

        skipped = {s.strip() for s in args.skip_stages.split(",") if s.strip()}
        if stage["name"] in skipped:
            print(f"\n=== Stage {i}: {stage['name']} SKIPPED (--skip-stages): "
                  f"inputs pass through unchanged ===", flush=True)
            continue

        inputs = run_stage(stage, args.subject, store_dir, inputs, overrides, i)

    print(f"\n=== Chain complete. Final outputs in {store_dir} ===", flush=True)
    for k, v in inputs.items():
        if isinstance(v, Path) and v.exists():
            print(f"  {k}: {v} (sha={sha256_file(v)[:16]})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())