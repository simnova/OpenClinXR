#!/usr/bin/env python3
"""Measure position-welded components and boundary edges for Round-5 GLBs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import scipy.sparse
import scipy.sparse.csgraph
import trimesh


def measure(path: Path) -> dict:
    scene = trimesh.load(path, force="scene")
    merged = trimesh.util.concatenate(tuple(scene.geometry.values()))
    vertices = np.asarray(merged.vertices, dtype=np.float64)
    faces = np.asarray(merged.faces, dtype=np.int64)

    # Repo convention: position weld to five decimals before connectivity.
    rounded = np.round(vertices, 5)
    _, inverse = np.unique(rounded, axis=0, return_inverse=True)
    welded_faces = inverse[faces]
    nondegenerate = (
        (welded_faces[:, 0] != welded_faces[:, 1])
        & (welded_faces[:, 1] != welded_faces[:, 2])
        & (welded_faces[:, 2] != welded_faces[:, 0])
    )
    welded_faces = welded_faces[nondegenerate]
    node_count = int(inverse.max()) + 1

    edges = np.concatenate(
        (welded_faces[:, [0, 1]], welded_faces[:, [1, 2]], welded_faces[:, [2, 0]]),
        axis=0,
    )
    edges.sort(axis=1)
    unique_edges, edge_counts = np.unique(edges, axis=0, return_counts=True)
    boundary_edges = int(np.count_nonzero(edge_counts == 1))
    graph = scipy.sparse.coo_matrix(
        (np.ones(len(unique_edges) * 2, dtype=np.uint8),
         (np.concatenate((unique_edges[:, 0], unique_edges[:, 1])),
          np.concatenate((unique_edges[:, 1], unique_edges[:, 0])))),
        shape=(node_count, node_count),
    ).tocsr()
    component_count, vertex_labels = scipy.sparse.csgraph.connected_components(
        graph, directed=False, return_labels=True
    )
    face_labels = vertex_labels[welded_faces[:, 0]]
    face_counts = np.bincount(face_labels, minlength=component_count)
    face_counts = face_counts[face_counts > 0]
    face_counts.sort()
    face_counts = face_counts[::-1]
    total_faces = int(len(welded_faces))
    return {
        "path": str(path),
        "triangles": int(len(faces)),
        "weldedTriangles": total_faces,
        "verticesBeforeWeld": int(len(vertices)),
        "verticesAfterWeld": node_count,
        "weldedComponents": int(len(face_counts)),
        "largestComponentFaces": int(face_counts[0]),
        "largestShare": float(face_counts[0] / total_faces),
        "boundaryEdges": boundary_edges,
        "componentFaceCounts": [int(value) for value in face_counts],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("glbs", type=Path, nargs="+")
    args = parser.parse_args()
    payload = {"weldDecimals": 5, "assets": [measure(path) for path in args.glbs]}
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
