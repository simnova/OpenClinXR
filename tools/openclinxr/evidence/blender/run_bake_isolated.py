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
                  pipeline_type=None, max_num_tokens=49152,
                  sampler_overrides=None, result=None):
    """Mirror Trellis2ImageTo3DPipeline.run() but condition on N images.

    The vendored run() wraps ONE image in a list and passes it to get_cond
    (`self.get_cond([image], 512)`), which batch-stacks into (1, L, C). For N views
    that would produce a batch of N, which the flow-model cross-attention cannot
    consume with num_samples=1 (batch mismatch — see issue-255 pre-fix probe). The
    training-time MultiImageConditionedMixin.encode_images instead FLATTENS the N
    view embeddings along the sequence dim into (1, N*L, C). We mirror that here;
    run() itself is not edited (vendored tree).

    #662: sampler_overrides ({sampler_key: {knob: value}}) are forwarded into each
    sample_* call; the vendored methods merge them over the pipeline defaults
    ({**self.<name>, **user}), so only explicitly passed values change. Effective
    merged params are recorded into `result` under effectiveSamplerParams.
    """
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

    # #662: per-sampler overrides, merged over pipeline defaults exactly like the
    # vendored sample_* methods do internally ({**self.<name>, **user}); the user dict
    # wins. Recorded into result["effectiveSamplerParams"] when a result sink is given.
    overrides = sampler_overrides or {}
    ss_user = overrides.get("sparse_structure_sampler_params", {})
    shape_user = overrides.get("shape_slat_sampler_params", {})
    tex_user = overrides.get("tex_slat_sampler_params", {})

    def _effective(name, user):
        merged = dict(getattr(pipeline, name, {}) or {})
        merged.update(user)
        return merged

    effective = {
        "sparse_structure_sampler_params": _effective("sparse_structure_sampler_params", ss_user),
        "shape_slat_sampler_params": _effective("shape_slat_sampler_params", shape_user),
        "tex_slat_sampler_params": _effective("tex_slat_sampler_params", tex_user),
    }
    if result is not None:
        result["effectiveSamplerParams"] = effective

    ss_res = {'512': 32, '1024': 64, '1024_cascade': 32, '1536_cascade': 32}[pipeline_type]
    coords = pipeline.sample_sparse_structure(cond_512, ss_res, num_samples,
                                              sampler_params=ss_user)

    if pipeline_type == '512':
        shape_slat = pipeline.sample_shape_slat(
            cond_512, pipeline.models['shape_slat_flow_model_512'], coords,
            sampler_params=shape_user)
        tex_slat = pipeline.sample_tex_slat(
            cond_512, pipeline.models['tex_slat_flow_model_512'], shape_slat,
            sampler_params=tex_user)
        res = 512
    elif pipeline_type == '1024':
        shape_slat = pipeline.sample_shape_slat(
            cond_1024, pipeline.models['shape_slat_flow_model_1024'], coords,
            sampler_params=shape_user)
        tex_slat = pipeline.sample_tex_slat(
            cond_1024, pipeline.models['tex_slat_flow_model_1024'], shape_slat,
            sampler_params=tex_user)
        res = 1024
    elif pipeline_type in ('1024_cascade', '1536_cascade'):
        res_hi = 1024 if pipeline_type == '1024_cascade' else 1536
        shape_slat, res = pipeline.sample_shape_slat_cascade(
            cond_512, cond_1024,
            pipeline.models['shape_slat_flow_model_512'],
            pipeline.models['shape_slat_flow_model_1024'],
            512, res_hi, coords,
            sampler_params=shape_user,
            max_num_tokens=max_num_tokens,
        )
        tex_slat = pipeline.sample_tex_slat(
            cond_1024, pipeline.models['tex_slat_flow_model_1024'], shape_slat,
            sampler_params=tex_user)
    else:
        raise ValueError(f"Invalid pipeline type: {pipeline_type}")

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    elif hasattr(torch, 'mps') and hasattr(torch.mps, 'empty_cache'):
        torch.mps.empty_cache()

    return pipeline.decode_latent(shape_slat, tex_slat, res)


def _add_sampler_args(parser):
    """#662: per-sampler knobs for the three FlowEulerGuidanceIntervalSampler samplers.

    Defaults are None = use the pipeline's own value from pipeline.json (measured
    2026-08-25: ss steps=12 gs=7.5 gr=0.7 gi=[0.6,1.0] rescale_t=5.0;
    shape ...gs=7.5 gr=0.5 gi=[0.6,1.0] rescale_t=3.0; tex ...gs=1.0 gr=0.0
    gi=[0.6,0.9] rescale_t=3.0). Only explicitly passed values are forwarded,
    so a no-flag bake behaves exactly as before (counterweight).
    Declared explicitly (no prefix loop) so every flag is literally greppable here.
    """
    parser.add_argument("--ss-steps", type=int, default=None,
                        help="sparse structure sampler steps")
    parser.add_argument("--ss-guidance-strength", type=float, default=None,
                        help="sparse structure sampler guidance strength")
    parser.add_argument("--ss-guidance-rescale", type=float, default=None,
                        help="sparse structure sampler guidance rescale")
    parser.add_argument("--ss-guidance-interval", nargs=2, type=float, metavar=("LO", "HI"),
                        default=None, help="sparse structure sampler guidance interval (default 0.6 1.0)")
    parser.add_argument("--ss-rescale-t", type=float, default=None,
                        help="sparse structure sampler t rescale (default 5.0)")
    parser.add_argument("--shape-steps", type=int, default=None,
                        help="shape slat sampler steps")
    parser.add_argument("--shape-guidance-strength", type=float, default=None,
                        help="shape slat sampler guidance strength")
    parser.add_argument("--shape-guidance-rescale", type=float, default=None,
                        help="shape slat sampler guidance rescale")
    parser.add_argument("--shape-guidance-interval", nargs=2, type=float, metavar=("LO", "HI"),
                        default=None, help="shape slat sampler guidance interval (default 0.6 1.0)")
    parser.add_argument("--shape-rescale-t", type=float, default=None,
                        help="shape slat sampler t rescale (default 3.0)")
    parser.add_argument("--tex-steps", type=int, default=None,
                        help="texture slat sampler steps")
    parser.add_argument("--tex-guidance-strength", type=float, default=None,
                        help="texture slat sampler guidance strength")
    parser.add_argument("--tex-guidance-rescale", type=float, default=None,
                        help="texture slat sampler guidance rescale")
    parser.add_argument("--tex-guidance-interval", nargs=2, type=float, metavar=("LO", "HI"),
                        default=None, help="texture slat sampler guidance interval (default 0.6 0.9)")
    parser.add_argument("--tex-rescale-t", type=float, default=None,
                        help="texture slat sampler t rescale (default 3.0)")


def _collect_sampler_overrides(args):
    """Gather only the flags the caller actually set → {sampler_key: {knob: value}}."""
    overrides = {}
    for prefix, key in (("ss", "sparse_structure_sampler_params"),
                        ("shape", "shape_slat_sampler_params"),
                        ("tex", "tex_slat_sampler_params")):
        params = {}
        if getattr(args, f"{prefix}_steps") is not None:
            params["steps"] = getattr(args, f"{prefix}_steps")
        if getattr(args, f"{prefix}_guidance_strength") is not None:
            params["guidance_strength"] = getattr(args, f"{prefix}_guidance_strength")
        if getattr(args, f"{prefix}_guidance_rescale") is not None:
            params["guidance_rescale"] = getattr(args, f"{prefix}_guidance_rescale")
        if getattr(args, f"{prefix}_guidance_interval") is not None:
            lo, hi = getattr(args, f"{prefix}_guidance_interval")
            params["guidance_interval"] = [lo, hi]
        if getattr(args, f"{prefix}_rescale_t") is not None:
            params["rescale_t"] = getattr(args, f"{prefix}_rescale_t")
        if params:
            overrides[key] = params
    return overrides


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
    parser.add_argument("--hf-demo", action="store_true",
                        help="Record + pass HF Space demo sampler params (samplers already match pipeline defaults)")
    parser.add_argument("--remesh", action="store_true",
                        help="Space-order remesh: simplify(16_777_216) then to_glb(remesh=True, band=1, project=0)")
    parser.add_argument("--no-remesh", action="store_true",
                        help="Force remesh off (default)")
    parser.add_argument("--decimation-target", type=int, default=300_000,
                        help="Final decimation target faces (default 300000)")
    parser.add_argument("--texture-size", type=int, default=2048,
                        help="Baked texture resolution (default 2048)")
    _add_sampler_args(parser)
    args = parser.parse_args()
    sampler_overrides = _collect_sampler_overrides(args)

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
    remesh = args.remesh and not args.no_remesh
    hf_demo = args.hf_demo
    decimation_target = args.decimation_target
    texture_size = args.texture_size

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
        "samplerOverrides": sampler_overrides,
        "effectiveSamplerParams": {},
        "hfDemo": hf_demo,
        "remeshRequested": remesh,
        "remesh": "space_order_band1_project0" if remesh else "not_requested",
        "pipelineType": "1024_cascade",
        "decimationTarget": decimation_target,
        "textureSize": texture_size,
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

    # #662: record the EFFECTIVE sampler table (pipeline defaults + any user overrides)
    # for all three samplers, regardless of path. Distinct from --hf-demo's
    # samplerParams (which records only what that flag passes).
    result["effectiveSamplerParams"] = {
        key: dict(getattr(pipeline, key, {}) or {}) for key in (
            "sparse_structure_sampler_params",
            "shape_slat_sampler_params",
            "tex_slat_sampler_params",
        )
    }
    for key, params in sampler_overrides.items():
        result["effectiveSamplerParams"].setdefault(key, {}).update(params)

    # Shape generation
    try:
        print(f"[ISOLATED:{subject_id}] Running image→shape generation "
              f"({len(images)} view{'s' if len(images) > 1 else ''}, seed={seed})...", flush=True)
        t_shape = time.time()
        if len(images) == 1:
            # Unchanged single-view path — identical to the pre-#255 behavior.
            run_kwargs = {
                "num_samples": 1,
                "seed": seed,
                "preprocess_image": True,
            }
            if hf_demo:
                # HF Space demo sampler params — already the pipeline defaults,
                # passed explicitly so the conditioning matches the HF demo call
                # shape without changing the control bake's preprocess_image.
                run_kwargs.update({
                    "sparse_structure_sampler_params": getattr(pipeline, "sparse_structure_sampler_params", {}),
                    "shape_slat_sampler_params": getattr(pipeline, "shape_slat_sampler_params", {}),
                    "tex_slat_sampler_params": getattr(pipeline, "tex_slat_sampler_params", {}),
                    "pipeline_type": "1024_cascade",
                })
                result["samplerParams"] = {
                    "sparse_structure_sampler_params": getattr(pipeline, "sparse_structure_sampler_params", {}),
                    "shape_slat_sampler_params": getattr(pipeline, "shape_slat_sampler_params", {}),
                    "tex_slat_sampler_params": getattr(pipeline, "tex_slat_sampler_params", {}),
                }
            if sampler_overrides:
                # #662: user flags win over both defaults and --hf-demo (dict merge order).
                for key, params in sampler_overrides.items():
                    merged = dict(getattr(pipeline, key, {}) or {})
                    merged.update(params)
                    run_kwargs[key] = merged
                    result["effectiveSamplerParams"][key] = merged
            outputs = pipeline.run(images[0], **run_kwargs)
        else:
            # Multi-view (#255): sequence-concatenated cond, mirroring run() internals.
            outputs = run_multiview(
                pipeline,
                images,
                num_samples=1,
                seed=seed,
                preprocess_image=True,
                sampler_overrides=sampler_overrides,
                result=result,
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
        import o_voxel

        # Space order (#105/#92): the HF Space decodes then caps the raw extract at
        # the nvdiffrast/cumesh limit BEFORE remeshing — `mesh.simplify(16777216)`
        # immediately after decode. For a subject already under the cap this is a
        # no-op; for carts >=16M raw it keeps Dual Contouring from exploding.
        SIMPLIFY_LIMIT = 16_777_216
        raw_faces = int(mesh.faces.shape[0])
        result["rawFaceCount"] = raw_faces
        if hasattr(mesh, "simplify") and raw_faces > SIMPLIFY_LIMIT:
            mesh.simplify(SIMPLIFY_LIMIT)
            raw_faces = int(mesh.faces.shape[0])
        result["stages"]["simplify_before_to_glb"] = {
            "cap": SIMPLIFY_LIMIT,
            "facesBefore": result.get("rawFaceCount", None),
            "facesAfter": raw_faces,
        }

        print(f"[ISOLATED:{subject_id}] Exporting to GLB (remesh={remesh}, "
              f"raw_faces={raw_faces})...", flush=True)
        t_export = time.time()
        to_glb_kwargs = dict(
            vertices=mesh.vertices,
            faces=mesh.faces,
            attr_volume=mesh.attrs,
            coords=mesh.coords,
            attr_layout=mesh.layout,
            voxel_size=mesh.voxel_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=decimation_target,
            texture_size=texture_size,
            verbose=True,
        )
        # HF Space extract_glb passes remesh_band=1, remesh_project=0 (not the
        # postprocess.py default of 0.9). Match Space exactly when remeshing.
        to_glb_kwargs["remesh"] = remesh
        if remesh:
            to_glb_kwargs["remesh_band"] = 1
            to_glb_kwargs["remesh_project"] = 0

        glb = o_voxel.postprocess.to_glb(**to_glb_kwargs)
        glb.export(output_glb)
        export_time = time.time() - t_export
        result["stages"]["glb_export"] = "runs"
        result["stages"]["glb_export_time_s"] = round(export_time, 1)
        result["stages"]["remesh"] = "space_order_band1_project0" if remesh else "not_requested"
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
