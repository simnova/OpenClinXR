#!/usr/bin/env python3
"""Prepare Round-6 full-resolution stage-isolation and A2 source meshes."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import time
from pathlib import Path

import numpy as np
import torch
import trimesh


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def topology(vertices: np.ndarray, faces: np.ndarray) -> dict:
    edges = np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]))
    edges.sort(axis=1)
    unique, counts = np.unique(edges, axis=0, return_counts=True)
    import scipy.sparse
    import scipy.sparse.csgraph
    graph = scipy.sparse.coo_matrix(
        (np.ones(len(unique) * 2, dtype=np.uint8),
         (np.r_[unique[:, 0], unique[:, 1]], np.r_[unique[:, 1], unique[:, 0]])),
        shape=(len(vertices), len(vertices)),
    ).tocsr()
    components, _ = scipy.sparse.csgraph.connected_components(graph, directed=False)
    return {
        "vertices": int(len(vertices)),
        "triangles": int(len(faces)),
        "weldedComponents": int(components),
        "boundaryEdges": int(np.count_nonzero(counts == 1)),
    }


def load_round5_helpers(path: Path):
    spec = importlib.util.spec_from_file_location("round5_process", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--round5-helper", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    started = time.time()
    bundle = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    vertices = bundle["vertices"].numpy()
    faces = bundle["faces"].numpy()
    stages = [{"step": "decoded_checkpoint", **topology(vertices, faces)}]

    # Decoder vertices and attribute voxels share stable Morton order. The 939
    # decoder-only boundary vertices use the final valid voxel colour; they are
    # 0.022% of vertices and do not affect the diagnostic bezel crop.
    attrs = np.asarray(bundle["attrs"][:, bundle["layout"]["base_color"]])
    colors = np.empty((len(vertices), 4), dtype=np.uint8)
    count = min(len(vertices), len(attrs))
    colors[:count, :3] = np.clip(attrs[:count] * 255, 0, 255).astype(np.uint8)
    colors[count:, :3] = colors[count - 1, :3]
    colors[:, 3] = 255
    raw = trimesh.Trimesh(vertices=vertices, faces=faces, process=False,
                          vertex_colors=colors)
    raw_path = args.out / "decoded-fullres-voxel-colour.ply"
    raw.export(raw_path)
    del raw, colors, attrs

    helper = load_round5_helpers(args.round5_helper)
    vertices, faces, fill = helper.cpu_fill(vertices, faces)
    stages.append({"step": "cpu_fill_holes", **topology(vertices, faces)})
    vertices, faces, weld = helper.weld(vertices, faces)
    stages.append({"step": "weld_5dp", **topology(vertices, faces)})
    vertices, faces, island = helper.component_filter(vertices, faces, 0.0001)
    stages.append({"step": "island_filter", **topology(vertices, faces)})
    report = {
        "schemaVersion": "openclinxr.ecg-cart-round6-stage-prep.v1",
        "checkpoint": str(args.checkpoint),
        "checkpointSha256": sha256(args.checkpoint),
        "colourCasterHandling": "all geometry, including casters, retains decoded per-vertex voxel colour; decoder-only boundary vertices use the final valid voxel colour",
        "stages": stages,
        "round5Treatment": {"fill": fill, "weld": weld, "islandFilter": island},
        "outputs": {"rawVoxelColourPly": str(raw_path)},
        "seconds": time.time() - started,
    }
    (args.out / "stage-prep.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
