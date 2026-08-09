#!/usr/bin/env python3
"""TRELLIS Metal single-subject isolated bake — one fresh OS process per subject (#237).

Called by trellis-metal-subject-isolation.ts via child_process.execFile.
Each invocation bakes ONE subject and exits — no shared torch MPS context across subjects.

Usage:
  PYTHONUNBUFFERED=1 PYTORCH_ENABLE_MPS_FALLBACK=1 \
    python3 run_bake_isolated.py \
      --subject-id wall-clock \
      --input-image /path/to/front.png \
      --output-dir /path/to/evidence/issue-237/wall-clock \
      --weights-path ~/ComfyUI/models/trellis2 \
      --dinov3-path ~/ComfyUI/models/dinov3
"""
import argparse, json, os, sys, time, traceback


def main():
    parser = argparse.ArgumentParser(description="TRELLIS single-subject isolated bake")
    parser.add_argument("--subject-id", required=True, help="Subject identifier")
    parser.add_argument("--display-name", default=None, help="Human-readable name")
    parser.add_argument("--input-image", required=True, help="Path to input PNG (front view)")
    parser.add_argument("--output-dir", required=True, help="Directory for bake-measure.json + GLB export")
    parser.add_argument("--weights-path", default=os.path.expanduser("~/ComfyUI/models/trellis2"))
    parser.add_argument("--dinov3-path", default=os.path.expanduser("~/ComfyUI/models/dinov3"))
    parser.add_argument("--trellis-root",
                        default=os.path.expanduser("~/.openclinxr-tools/trellis2-apple/src"))
    args = parser.parse_args()

    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

    trellis_root = args.trellis_root
    sys.path.insert(0, trellis_root)
    os.chdir(trellis_root)

    subject_id = args.subject_id
    display_name = args.display_name or subject_id
    input_path = args.input_image
    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    t_start = time.time()

    # Build the result skeleton
    result = {
        "subjectId": subject_id,
        "displayName": display_name,
        "verdict": "inconclusive_blocked",
        "verdictReason": "",
        "stages": {},
        "rawTriangleCount": None,
        "exportPath": None,
        "exportBytes": None,
        "texturedPbr": "no",
        "inputImagePath": input_path,
        "wallClockS": 0,
        "processIsolation": "fresh_subprocess",
        "claimScope": [
            "TRELLIS Metal image→shape→mesh→GLB pipeline on Apple Silicon",
            "MIT model + MIT Metal packages + local DINOv3 (commercial-permitted)",
            "single-subject isolated bake — fresh OS process per subject (#237)",
            "per-subject raw triangle count recorded for MADR 0050 post-opt",
        ],
        "notEvidenceFor": [
            "Quest 3 readiness",
            "clinical accuracy or device equivalence",
            "production adoption into learner runtime",
            "mesh quality suitable for exam use",
            "replacement of parametric equipment builders",
        ],
    }

    def write_result():
        out_path = os.path.join(output_dir, "bake-measure.json")
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2, default=str)
        print(f"[ISOLATED:{subject_id}] Wrote {out_path}", flush=True)

    # Check input
    if not os.path.exists(input_path):
        result["verdict"] = "blocked_build"
        result["verdictReason"] = f"Input image not found: {input_path}"
        result["wallClockS"] = time.time() - t_start
        write_result()
        return 1

    # Load image
    from PIL import Image
    try:
        image = Image.open(input_path).convert("RGB")
        print(f"[ISOLATED:{subject_id}] Input image: {image.size}", flush=True)
    except Exception as e:
        result["verdict"] = "blocked_build"
        result["verdictReason"] = f"Failed to open input image: {e}"
        result["wallClockS"] = time.time() - t_start
        write_result()
        return 1

    # Load pipeline — this is the heavy init, done once per fresh process
    from mlx_backend.pipeline import create_mlx_pipeline
    print(f"[ISOLATED:{subject_id}] Loading MLX pipeline...", flush=True)
    t0 = time.time()
    try:
        pipeline = create_mlx_pipeline(
            weights_path=args.weights_path,
            dinov3_local_path=args.dinov3_path,
        )
        load_time = time.time() - t0
        result["stages"]["pipeline_load"] = "runs"
        result["stages"]["pipeline_load_time_s"] = round(load_time, 1)
        print(f"[ISOLATED:{subject_id}] Pipeline loaded in {load_time:.1f}s", flush=True)
    except Exception as e:
        result["stages"]["pipeline_load"] = f"throws: {type(e).__name__}"
        result["verdict"] = "blocked_build"
        result["verdictReason"] = f"Pipeline load failed: {type(e).__name__}: {str(e)[:300]}"
        tb = traceback.format_exc()
        print(f"[ISOLATED:{subject_id}] Pipeline load FAILED:\n{tb}", flush=True)
        result["wallClockS"] = time.time() - t_start
        write_result()
        return 1

    # Shape generation
    try:
        print(f"[ISOLATED:{subject_id}] Running image→shape generation...", flush=True)
        t_shape = time.time()
        outputs = pipeline.run(
            image,
            num_samples=1,
            seed=237_000 + hash(subject_id) % 1000,
            preprocess_image=True,
        )
        shape_time = time.time() - t_shape
        result["stages"]["shape_generation"] = "runs"
        result["stages"]["shape_generation_time_s"] = round(shape_time, 1)
        print(f"[ISOLATED:{subject_id}] Shape generation completed in {shape_time:.1f}s", flush=True)

        if not outputs or len(outputs) == 0:
            result["verdict"] = "blocked_build"
            result["verdictReason"] = "Shape generation produced no outputs"
            result["wallClockS"] = time.time() - t_start
            write_result()
            return 1

        mesh = outputs[0]
        print(f"[ISOLATED:{subject_id}] Output mesh type: {type(mesh).__name__}", flush=True)

    except Exception as e:
        result["stages"]["shape_generation"] = f"throws: {type(e).__name__}"
        result["verdict"] = "blocked_build"
        result["verdictReason"] = f"Shape generation failed: {type(e).__name__}: {str(e)[:300]}"
        tb = traceback.format_exc()
        print(f"[ISOLATED:{subject_id}] Shape generation FAILED:\n{tb}", flush=True)
        result["wallClockS"] = time.time() - t_start
        write_result()
        return 1

    # GLB export
    output_glb = os.path.join(output_dir, f"{subject_id}.glb")
    try:
        from mlx_backend.pipeline import to_glb

        print(f"[ISOLATED:{subject_id}] Exporting to GLB...", flush=True)
        t_export = time.time()
        to_glb(
            mesh,
            output_glb,
            decimation_target=1_000_000,  # minimal decimation — capture raw count
            texture_size=1024,
            verbose=True,
        )
        export_time = time.time() - t_export
        result["stages"]["glb_export"] = "runs"
        result["stages"]["glb_export_time_s"] = round(export_time, 1)
        result["exportPath"] = output_glb

        # Measure triangle count
        import trimesh
        loaded = trimesh.load(output_glb)
        total_tris = 0
        if hasattr(loaded, "geometry") and isinstance(loaded.geometry, dict):
            for _name, geom in loaded.geometry.items():
                if hasattr(geom, "faces"):
                    total_tris += len(geom.faces)
        elif hasattr(loaded, "faces"):
            total_tris = len(loaded.faces)
        result["rawTriangleCount"] = total_tris

        file_size = os.path.getsize(output_glb)
        result["exportBytes"] = file_size

        # PBR detection
        has_pbr = file_size > 500_000
        try:
            if hasattr(loaded, "visual") and hasattr(loaded.visual, "material"):
                mat = loaded.visual.material
                if hasattr(mat, "baseColorTexture") and mat.baseColorTexture is not None:
                    has_pbr = True
        except Exception:
            pass
        result["texturedPbr"] = "yes" if has_pbr else "no_texture_detected"

        print(f"[ISOLATED:{subject_id}] GLB exported: {output_glb}", flush=True)
        print(f"[ISOLATED:{subject_id}] Triangles: {total_tris}", flush=True)
        print(f"[ISOLATED:{subject_id}] File size: {file_size} bytes", flush=True)

        result["verdict"] = "mesh_exported"
        result["verdictReason"] = (
            f"TRELLIS Metal image→shape→mesh→GLB pipeline completed (fresh subprocess). "
            f"Mesh: {total_tris} tris, {file_size} bytes. "
            f"Shape gen: {shape_time:.1f}s, Export: {export_time:.1f}s."
        )

    except Exception as e:
        result["stages"]["glb_export"] = f"throws: {type(e).__name__}"
        result["verdict"] = "blocked_build"
        result["verdictReason"] = f"GLB export failed: {type(e).__name__}: {str(e)[:300]}"
        tb = traceback.format_exc()
        print(f"[ISOLATED:{subject_id}] GLB export FAILED:\n{tb}", flush=True)

    result["wallClockS"] = time.time() - t_start
    write_result()
    return 0


if __name__ == "__main__":
    sys.exit(main())
