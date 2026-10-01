#!/usr/bin/env python3
"""Round-5 CPU topology treatment followed by TRELLIS pre-bake decimation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import scipy.sparse
import scipy.sparse.csgraph
import torch


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def edge_data(faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    edges = np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]), axis=0)
    edges.sort(axis=1)
    return np.unique(edges, axis=0, return_counts=True)


def boundary_edges(faces: np.ndarray) -> int:
    _, counts = edge_data(faces)
    return int(np.count_nonzero(counts == 1))


def weld(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict]:
    rounded = np.round(vertices, 5)
    unique, inverse = np.unique(rounded, axis=0, return_inverse=True)
    remapped = inverse[faces]
    keep = (
        (remapped[:, 0] != remapped[:, 1])
        & (remapped[:, 1] != remapped[:, 2])
        & (remapped[:, 2] != remapped[:, 0])
    )
    return unique.astype(np.float32), remapped[keep].astype(np.int32), {
        "verticesBefore": int(len(vertices)),
        "verticesAfter": int(len(unique)),
        "degenerateFacesDropped": int(np.count_nonzero(~keep)),
    }


def component_filter(
    vertices: np.ndarray, faces: np.ndarray, threshold_share: float
) -> tuple[np.ndarray, np.ndarray, dict]:
    unique_edges, _ = edge_data(faces)
    graph = scipy.sparse.coo_matrix(
        (np.ones(len(unique_edges) * 2, dtype=np.uint8),
         (np.concatenate((unique_edges[:, 0], unique_edges[:, 1])),
          np.concatenate((unique_edges[:, 1], unique_edges[:, 0])))),
        shape=(len(vertices), len(vertices)),
    ).tocsr()
    _, vertex_labels = scipy.sparse.csgraph.connected_components(graph, directed=False)
    face_labels = vertex_labels[faces[:, 0]]
    counts = np.bincount(face_labels)
    total = int(len(faces))
    main = int(np.argmax(counts))
    threshold_faces = max(1, int(np.ceil(total * threshold_share)))
    # Guardrail: every >=10% non-main component is always retained. The general
    # threshold is much lower and retains the three ~1.9% caster-sized parts.
    keep_labels = {
        int(label)
        for label, count in enumerate(counts)
        if count >= threshold_faces or label == main or count / total >= 0.10
    }
    dropped = []
    for label, count in enumerate(counts):
        if not count or label in keep_labels:
            continue
        face_ids = np.flatnonzero(face_labels == label)
        used = np.unique(faces[face_ids].ravel())
        points = vertices[used]
        lower, upper = points.min(axis=0), points.max(axis=0)
        dropped.append({
            "label": int(label),
            "faces": int(count),
            "share": float(count / total),
            "center": ((lower + upper) / 2).tolist(),
            "diagonal": float(np.linalg.norm(upper - lower)),
        })
    face_keep = np.isin(face_labels, np.fromiter(keep_labels, dtype=np.int64))
    kept_faces = faces[face_keep]
    used = np.unique(kept_faces.ravel())
    remap = np.full(len(vertices), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    kept_vertices = vertices[used]
    kept_faces = remap[kept_faces].astype(np.int32)
    kept_counts = sorted((int(counts[label]) for label in keep_labels), reverse=True)
    return kept_vertices, kept_faces, {
        "thresholdShare": threshold_share,
        "thresholdFaces": threshold_faces,
        "componentsBefore": int(np.count_nonzero(counts)),
        "componentsAfter": len(kept_counts),
        "keptComponentFaces": kept_counts,
        "multiPartGuardTriggered": any(
            count / total >= 0.10 for label, count in enumerate(counts) if label != main
        ),
        "dropped": sorted(dropped, key=lambda item: item["faces"], reverse=True),
    }


def cpu_fill(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict]:
    import trimesh

    before = boundary_edges(faces)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    fill_return = bool(trimesh.repair.fill_holes(mesh))
    next_vertices = np.asarray(mesh.vertices, dtype=np.float32)
    next_faces = np.asarray(mesh.faces, dtype=np.int32)
    after = boundary_edges(next_faces)
    return next_vertices, next_faces, {
        "backend": "trimesh.repair.fill_holes (TRELLIS CPU fallback / v1-style)",
        "fillReturnWatertight": fill_return,
        "changed": len(next_faces) != len(faces),
        "facesBefore": int(len(faces)),
        "facesAfter": int(len(next_faces)),
        "boundaryEdgesBefore": before,
        "boundaryEdgesAfter": after,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--mode", choices=("raw", "filter", "fill", "best"), required=True)
    parser.add_argument("--threshold-share", type=float, default=0.0001)
    parser.add_argument("--target-triangles", type=int, default=40_000)
    parser.add_argument("--texture-size", type=int, default=512)
    parser.add_argument("--trellis-root", type=Path,
                        default=Path.home() / ".openclinxr-tools/trellis2-apple/src")
    args = parser.parse_args()
    started = time.time()
    args.out.mkdir(parents=True, exist_ok=True)
    bundle = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    vertices = bundle["vertices"].numpy()
    faces = bundle["faces"].numpy()
    treatment: dict = {"mode": args.mode, "pipeline": []}

    if args.mode in ("fill", "best"):
        vertices, faces, fill_report = cpu_fill(vertices, faces)
        treatment["pipeline"].append("cpu_fill_holes")
        treatment["fill"] = fill_report
    if args.mode in ("filter", "best"):
        vertices, faces, weld_report = weld(vertices, faces)
        treatment["pipeline"].append("weld_5dp")
        treatment["weld"] = weld_report
        vertices, faces, filter_report = component_filter(vertices, faces, args.threshold_share)
        treatment["pipeline"].append("island_filter")
        treatment["filter"] = filter_report

    sys.path.insert(0, str(args.trellis_root.resolve()))
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
    import o_voxel

    treatment["preExportFaces"] = int(len(faces))
    exported = time.time()
    glb = o_voxel.postprocess.to_glb(
        vertices=torch.from_numpy(vertices),
        faces=torch.from_numpy(faces),
        attr_volume=bundle["attrs"],
        coords=bundle["coords"],
        attr_layout=bundle["layout"],
        voxel_size=bundle["voxel_size"],
        aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=args.target_triangles,
        texture_size=args.texture_size,
        remesh=False,
        verbose=True,
    )
    output = args.out / "ecg-cart.glb"
    glb.export(output)
    treatment["pipeline"].extend([
        f"to_glb_decimate_{args.target_triangles}",
        "uv_unwrap",
        f"pbr_bake_{args.texture_size}",
    ])

    import trimesh

    loaded = trimesh.load(output, force="scene")
    triangles = sum(len(geom.faces) for geom in loaded.geometry.values())
    report = {
        "schemaVersion": "openclinxr.ecg-cart-round5-treatment.v1",
        "sourceCheckpoint": str(args.checkpoint),
        "sourceSeed": int(bundle["seed"]),
        "sourceSteps": int(bundle["steps"]),
        "treatment": treatment,
        "remesh": False,
        "triangles": int(triangles),
        "decodedTextureMiB": 2 * (args.texture_size / 512) ** 2,
        "bytes": output.stat().st_size,
        "sha256": sha256(output),
        "timingsSeconds": {
            "export": time.time() - exported,
            "total": time.time() - started,
        },
        "claimScope": "one ECG-cart Round-5 CPU topology treatment and pre-bake decimation",
        "notEvidenceFor": ["Quest readiness", "clinical accuracy", "runtime adoption"],
    }
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
