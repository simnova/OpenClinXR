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

Multi-view (#255): pass repeated --input-image (e.g. front + side + two three-quarters).
  Each image is preprocessed and embedded; the N view embeddings are concatenated into
  ONE cross-attention sequence (1, N*L, C) — mirroring the training-time
  MultiImageConditionedMixin.encode_images — so the pipeline conditions on all views.
  Views are unposed; no camera poses are passed.
"""
import argparse, json, os, sys, time, traceback, zlib


def run_multiview(pipeline, images, num_samples, seed, preprocess_image=True,
                  pipeline_type=None, max_num_tokens=49152):
    """Mirror Trellis2ImageTo3DPipeline.run() but condition on N images.

    The vendored run() wraps ONE image in a list and passes it to get_cond
    (`self.get_cond([image], 512)`), which batch-stacks into (1, L, C). For N views
    that would produce a batch of N, which the flow-model cross-attention cannot
    consume with num_samples=1 (batch mismatch — see issue-255 pre-fix probe). The
    training-time MultiImageConditionedMixin.encode_images instead FLATTENS the N
    view embeddings along the sequence dim into (1, N*L, C). We mirror that here;
    run() itself is not edited (vendored tree).
    """
    import torch

    pipeline_type = pipeline_type or pipeline.default_pipeline_type
    if preprocess_image:
        images = [pipeline.preprocess_image(img) for img in images]
    torch.manual_seed(seed)
    cond_512 = pipeline.get_cond(images, 512)
    cond_1024 = pipeline.get_cond(images, 1024) if pipeline_type != '512' else None
    for c in (cond_512, cond_1024):
        if c is None:
            continue
        c['cond'] = c['cond'].reshape(1, -1, c['cond'].shape[-1]).contiguous()
        c['neg_cond'] = c['neg_cond'].reshape(1, -1, c['neg_cond'].shape[-1]).contiguous()

    ss_res = {'512': 32, '1024': 64, '1024_cascade': 32, '1536_cascade': 32}[pipeline_type]
    coords = pipeline.sample_sparse_structure(cond_512, ss_res, num_samples)

    if pipeline_type == '512':
        shape_slat = pipeline.sample_shape_slat(
            cond_512, pipeline.models['shape_slat_flow_model_512'], coords)
        tex_slat = pipeline.sample_tex_slat(
            cond_512, pipeline.models['tex_slat_flow_model_512'], shape_slat)
        res = 512
    elif pipeline_type == '1024':
        shape_slat = pipeline.sample_shape_slat(
            cond_1024, pipeline.models['shape_slat_flow_model_1024'], coords)
        tex_slat = pipeline.sample_tex_slat(
            cond_1024, pipeline.models['tex_slat_flow_model_1024'], shape_slat)
        res = 1024
    elif pipeline_type in ('1024_cascade', '1536_cascade'):
        res_hi = 1024 if pipeline_type == '1024_cascade' else 1536
        shape_slat, res = pipeline.sample_shape_slat_cascade(
            cond_512, cond_1024,
            pipeline.models['shape_slat_flow_model_512'],
            pipeline.models['shape_slat_flow_model_1024'],
            512, res_hi, coords,
            max_num_tokens=max_num_tokens,
        )
        tex_slat = pipeline.sample_tex_slat(
            cond_1024, pipeline.models['tex_slat_flow_model_1024'], shape_slat)
    else:
        raise ValueError(f"Invalid pipeline type: {pipeline_type}")

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    elif hasattr(torch, 'mps') and hasattr(torch.mps, 'empty_cache'):
        torch.mps.empty_cache()

    return pipeline.decode_latent(shape_slat, tex_slat, res)


def main():
    parser = argparse.ArgumentParser(description="TRELLIS single-subject isolated bake")
    parser.add_argument("--subject-id", required=True, help="Subject identifier")
    parser.add_argument("--display-name", default=None, help="Human-readable name")
    parser.add_argument("--input-image", required=True, action="append",
                        help="Path to input PNG (repeat for multi-view, e.g. front/side/¾ views)")
    parser.add_argument("--output-dir", required=True, help="Directory for bake-measure.json + GLB export")
    parser.add_argument("--seed", type=int, default=None,
                        help="Explicit seed (default: deterministic derivation from subject id)")
    parser.add_argument("--weights-path", default=os.path.expanduser("~/ComfyUI/models/trellis2"))
    parser.add_argument("--dinov3-path", default=os.path.expanduser("~/ComfyUI/models/dinov3"))
    parser.add_argument("--trellis-root",
                        default=os.path.expanduser("~/.openclinxr-tools/trellis2-apple/src"))
    args = parser.parse_args()

    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

    # Resolve all paths against the CALLER's cwd BEFORE chdir into the trellis root.
    subject_id = args.subject_id
    display_name = args.display_name or subject_id
    input_paths = [os.path.abspath(p) for p in args.input_image]
    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    trellis_root = args.trellis_root
    sys.path.insert(0, trellis_root)
    os.chdir(trellis_root)

    # Deterministic default seed: crc32 is stable across processes; the previous
    # `hash(subject_id)` varied with PYTHONHASHSEED, so two fresh bakes never shared
    # a seed (the same-seed A/B in #255 required fixing this).
    seed = args.seed if args.seed is not None else 237_000 + zlib.crc32(subject_id.encode("utf-8")) % 1000

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
        "inputImagePath": input_paths[0],
        "inputImagePaths": input_paths,
        "viewCount": len(input_paths),
        "seed": seed,
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

    # Check inputs
    for p in input_paths:
        if not os.path.exists(p):
            result["verdict"] = "blocked_build"
            result["verdictReason"] = f"Input image not found: {p}"
            result["wallClockS"] = time.time() - t_start
            write_result()
            return 1

    # Load images
    from PIL import Image
    try:
        images = [Image.open(p).convert("RGB") for p in input_paths]
        print(f"[ISOLATED:{subject_id}] Input images ({len(images)} views): "
              f"{[im.size for im in images]}", flush=True)
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
        print(f"[ISOLATED:{subject_id}] Running image→shape generation "
              f"({len(images)} view{'s' if len(images) > 1 else ''}, seed={seed})...", flush=True)
        t_shape = time.time()
        if len(images) == 1:
            # Unchanged single-view path — identical to the pre-#255 behavior.
            outputs = pipeline.run(
                images[0],
                num_samples=1,
                seed=seed,
                preprocess_image=True,
            )
        else:
            # Multi-view (#255): sequence-concatenated cond, mirroring run() internals.
            outputs = run_multiview(
                pipeline,
                images,
                num_samples=1,
                seed=seed,
                preprocess_image=True,
            )
        shape_time = time.time() - t_shape
        result["stages"]["shape_generation"] = "runs"
        result["stages"]["shape_generation_time_s"] = round(shape_time, 1)
        result["stages"]["view_count"] = len(images)
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
