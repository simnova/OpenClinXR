#!/usr/bin/env python3
"""Create local source-space UV masks from an Anny OBJ.

The masks are cagematch inputs for later StableGen/Comfy or direct texture
projection. They are generated from the source mesh's vertices and UVs, not
from detached face markers or screenshot-space guesses.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw


NOT_EVIDENCE_FOR = [
    "stablegen_texture_success",
    "b_plus_visual_realism_gate",
    "scene_placement_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
]


def main() -> None:
    args = parse_args()
    vertices, uvs, faces = read_obj(Path(args.source_obj))
    if not vertices or not uvs or not faces:
        raise SystemExit("source OBJ must contain vertices, UVs, and faces")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    bounds = mesh_bounds(vertices)
    masks = {
        "head": Image.new("L", (args.size, args.size), 0),
        "face_front": Image.new("L", (args.size, args.size), 0),
        "eye_region": Image.new("L", (args.size, args.size), 0),
        "scalp": Image.new("L", (args.size, args.size), 0),
    }
    draws = {name: ImageDraw.Draw(image) for name, image in masks.items()}
    counts = {name: 0 for name in masks}

    height = max(bounds["max_y"] - bounds["min_y"], 1e-6)
    depth = max(bounds["max_z"] - bounds["min_z"], 1e-6)
    width = max(bounds["max_x"] - bounds["min_x"], 1e-6)
    head_min_y = bounds["min_y"] + height * 0.72
    scalp_min_y = bounds["min_y"] + height * 0.88
    face_front_z = bounds["min_z"] + depth * 0.52
    eye_center_y = bounds["max_y"] - height * 0.124
    eye_half_y = height * 0.034
    eye_spacing = max(0.038, min(0.065, width * 0.075))
    eye_half_x = max(0.026, width * 0.033)

    for face in faces:
        pts = [vertices[index] for index in face]
        uv_pts = [uvs[index] for index in face]
        center = tuple(sum(point[axis] for point in pts) / len(pts) for axis in range(3))
        polygon = uv_polygon(uv_pts, args.size)
        if center[1] >= head_min_y:
            draw_polygon(draws["head"], polygon)
            counts["head"] += 1
            if center[1] >= scalp_min_y:
                draw_polygon(draws["scalp"], polygon)
                counts["scalp"] += 1
            if center[2] <= face_front_z:
                draw_polygon(draws["face_front"], polygon)
                counts["face_front"] += 1
                for side in (-1, 1):
                    eye_x = side * eye_spacing
                    if abs(center[0] - eye_x) <= eye_half_x and abs(center[1] - eye_center_y) <= eye_half_y:
                        draw_polygon(draws["eye_region"], polygon)
                        counts["eye_region"] += 1
                        break

    outputs = {}
    for name, image in masks.items():
        path = output_dir / f"{name}_mask.png"
        image.save(path)
        outputs[name] = {"path": str(path), "sha256": sha256(path), "faceCount": counts[name]}

    report = {
        "schemaVersion": "openclinxr.anny-source-uv-masks.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceObjPath": args.source_obj,
        "outputDir": str(output_dir),
        "size": args.size,
        "mesh": {
            "vertexCount": len(vertices),
            "uvCount": len(uvs),
            "faceCount": len(faces),
            "bounds": bounds,
        },
        "maskCoordinateBasis": "source_obj_x_width_y_height_z_depth_with_planar_review_uvs",
        "heuristics": {
            "headMinY": head_min_y,
            "scalpMinY": scalp_min_y,
            "faceFrontZMax": face_front_z,
            "eyeCenterY": eye_center_y,
            "eyeHalfY": eye_half_y,
            "eyeSpacing": eye_spacing,
            "eyeHalfX": eye_half_x,
        },
        "outputs": outputs,
        "providerBoundary": {
            "localOnly": True,
            "externalNetworkUsed": False,
            "paidApiUsed": False,
            "credentialsUsed": False,
            "runtimePromotionAllowed": False,
            "productionAssetReadinessClaimed": False,
        },
        "claimScope": "source_space_uv_mask_cagematch_input_not_texture_generation_or_realism_evidence",
        "notEvidenceFor": NOT_EVIDENCE_FOR,
    }
    report_path = Path(args.report) if args.report else output_dir / "anny-source-uv-masks.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


def read_obj(path: Path) -> tuple[list[tuple[float, float, float]], list[tuple[float, float]], list[list[int]]]:
    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    faces: list[list[int]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "v" and len(parts) >= 4:
            vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
        elif parts[0] == "vt" and len(parts) >= 3:
            uvs.append((float(parts[1]), float(parts[2])))
        elif parts[0] == "f":
            indices = []
            for ref in parts[1:]:
                vertex_ref = ref.split("/")[0]
                indices.append(int(vertex_ref) - 1)
            if len(indices) >= 3:
                faces.append(indices)
    return vertices, uvs, faces


def mesh_bounds(vertices: Iterable[tuple[float, float, float]]) -> dict[str, float]:
    verts = list(vertices)
    xs = [item[0] for item in verts]
    ys = [item[1] for item in verts]
    zs = [item[2] for item in verts]
    return {
        "min_x": min(xs),
        "max_x": max(xs),
        "min_y": min(ys),
        "max_y": max(ys),
        "min_z": min(zs),
        "max_z": max(zs),
    }


def uv_polygon(uvs: Iterable[tuple[float, float]], size: int) -> list[tuple[int, int]]:
    return [(round(u * (size - 1)), round((1.0 - v) * (size - 1))) for u, v in uvs]


def draw_polygon(draw: ImageDraw.ImageDraw, polygon: list[tuple[int, int]]) -> None:
    draw.polygon(polygon, fill=255)


def sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    argv = [item for item in sys.argv[1:] if item != "--"]
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-obj", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--report")
    parser.add_argument("--size", type=int, default=1024)
    return parser.parse_args(argv)


if __name__ == "__main__":
    main()
