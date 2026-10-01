#!/usr/bin/env python3
"""Measure welded full-resolution TRELLIS checkpoint topology."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import scipy.sparse
import scipy.sparse.csgraph
import torch


def analyze(vertices: np.ndarray, faces: np.ndarray) -> dict:
    rounded = np.round(vertices, 5)
    _, inverse = np.unique(rounded, axis=0, return_inverse=True)
    welded_faces = inverse[faces]
    keep = (
        (welded_faces[:, 0] != welded_faces[:, 1])
        & (welded_faces[:, 1] != welded_faces[:, 2])
        & (welded_faces[:, 2] != welded_faces[:, 0])
    )
    welded_faces = welded_faces[keep]
    edges = np.concatenate(
        (welded_faces[:, [0, 1]], welded_faces[:, [1, 2]], welded_faces[:, [2, 0]]),
        axis=0,
    )
    edges.sort(axis=1)
    unique_edges, counts = np.unique(edges, axis=0, return_counts=True)
    nodes = int(inverse.max()) + 1
    graph = scipy.sparse.coo_matrix(
        (np.ones(len(unique_edges) * 2, dtype=np.uint8),
         (np.concatenate((unique_edges[:, 0], unique_edges[:, 1])),
          np.concatenate((unique_edges[:, 1], unique_edges[:, 0])))),
        shape=(nodes, nodes),
    ).tocsr()
    _, labels = scipy.sparse.csgraph.connected_components(graph, directed=False)
    face_labels = labels[welded_faces[:, 0]]
    component_faces = np.bincount(face_labels)
    order = np.argsort(component_faces)[::-1]
    components = []
    total = int(len(welded_faces))
    for rank, label in enumerate(order):
        face_ids = np.flatnonzero(face_labels == label)
        if not len(face_ids):
            continue
        used = np.unique(welded_faces[face_ids].ravel())
        points = rounded[np.flatnonzero(np.isin(inverse, used))]
        lower = points.min(axis=0)
        upper = points.max(axis=0)
        components.append({
            "rank": rank,
            "label": int(label),
            "faces": int(len(face_ids)),
            "share": float(len(face_ids) / total),
            "center": ((lower + upper) / 2).tolist(),
            "diagonal": float(np.linalg.norm(upper - lower)),
        })
    return {
        "triangles": int(len(faces)),
        "weldedTriangles": total,
        "verticesBeforeWeld": int(len(vertices)),
        "verticesAfterWeld": nodes,
        "weldedComponents": len(components),
        "largestShare": components[0]["share"],
        "boundaryEdges": int(np.count_nonzero(counts == 1)),
        "components": components,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    bundle = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    result = analyze(bundle["vertices"].numpy(), bundle["faces"].numpy())
    result["checkpoint"] = str(args.checkpoint)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
