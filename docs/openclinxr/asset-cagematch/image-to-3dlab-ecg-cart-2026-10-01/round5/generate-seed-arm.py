#!/usr/bin/env python3
"""Round-5 single-view TRELLIS.2 seed arm with retained pre-export mesh.

Evidence-only runner. The caller must place this process behind GpuJobService.
It uses the repository's installed TRELLIS.2 Apple pipeline and performs the
requested decimate-before-UV/bake export through ``o_voxel.postprocess.to_glb``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--steps", type=int, choices=(6, 12), required=True)
    parser.add_argument("--texture-size", type=int, default=512)
    parser.add_argument("--decimation-target", type=int, default=40_000)
    parser.add_argument(
        "--trellis-root",
        type=Path,
        default=Path.home() / ".openclinxr-tools/trellis2-apple/src",
    )
    parser.add_argument(
        "--weights-path", type=Path, default=Path.home() / "ComfyUI/models/trellis2"
    )
    parser.add_argument(
        "--dinov3-path", type=Path, default=Path.home() / "ComfyUI/models/dinov3"
    )
    args = parser.parse_args()

    started = time.time()
    args.out.mkdir(parents=True, exist_ok=True)
    input_path = args.input.resolve()
    sys.path.insert(0, str(args.trellis_root.resolve()))
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

    import torch
    from PIL import Image
    from mlx_backend.pipeline import create_mlx_pipeline

    pipeline = create_mlx_pipeline(
        weights_path=str(args.weights_path), dinov3_local_path=str(args.dinov3_path)
    )
    load_seconds = time.time() - started
    defaults = {
        key: dict(getattr(pipeline, key, {}) or {})
        for key in (
            "sparse_structure_sampler_params",
            "shape_slat_sampler_params",
            "tex_slat_sampler_params",
        )
    }
    effective = {key: {**value, "steps": args.steps} for key, value in defaults.items()}
    image = Image.open(input_path).convert("RGB")
    sampled = time.time()
    outputs = pipeline.run(
        image,
        num_samples=1,
        seed=args.seed,
        preprocess_image=True,
        pipeline_type="1024_cascade",
        **effective,
    )
    sample_seconds = time.time() - sampled
    if len(outputs) != 1:
        raise RuntimeError(f"expected one output, got {len(outputs)}")
    mesh = outputs[0]

    checkpoint = args.out / "decoded-mesh.pt"
    torch.save(
        {
            "vertices": mesh.vertices.detach().cpu(),
            "faces": mesh.faces.detach().cpu(),
            "attrs": mesh.attrs.detach().cpu(),
            "coords": mesh.coords.detach().cpu(),
            "layout": mesh.layout,
            "voxel_size": mesh.voxel_size,
            "seed": args.seed,
            "steps": args.steps,
            "input": str(input_path),
        },
        checkpoint,
    )
    raw_faces = int(mesh.faces.shape[0])

    import o_voxel

    exported = time.time()
    glb = o_voxel.postprocess.to_glb(
        vertices=mesh.vertices,
        faces=mesh.faces,
        attr_volume=mesh.attrs,
        coords=mesh.coords,
        attr_layout=mesh.layout,
        voxel_size=mesh.voxel_size,
        aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=args.decimation_target,
        texture_size=args.texture_size,
        remesh=False,
        verbose=True,
    )
    output = args.out / "ecg-cart.glb"
    glb.export(output)
    export_seconds = time.time() - exported

    import trimesh

    loaded = trimesh.load(output, force="scene")
    triangles = sum(len(geom.faces) for geom in loaded.geometry.values())
    report = {
        "schemaVersion": "openclinxr.ecg-cart-round5-seed-arm.v1",
        "input": str(input_path),
        "inputSha256": sha256(input_path),
        "conditioning": "single_view",
        "seed": args.seed,
        "samplerTier": "vendor_default" if args.steps == 12 else "fast_6_step",
        "effectiveSamplerParams": effective,
        "pipelineType": "1024_cascade",
        "rawFaces": raw_faces,
        "pipelineOrder": "decode -> to_glb decimation -> UV unwrap -> 512px PBR bake",
        "remesh": False,
        "decimationTarget": args.decimation_target,
        "textureSize": args.texture_size,
        "triangles": triangles,
        "bytes": output.stat().st_size,
        "sha256": sha256(output),
        "checkpoint": {"path": str(checkpoint), "bytes": checkpoint.stat().st_size},
        "timingsSeconds": {
            "pipelineLoad": load_seconds,
            "samplingAndDecode": sample_seconds,
            "decimateUvBakeExport": export_seconds,
            "total": time.time() - started,
        },
        "claimScope": "one ECG-cart Round-5 seed/sampler arm on the local M1 Max",
        "notEvidenceFor": ["Quest readiness", "clinical accuracy", "runtime adoption"],
    }
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
