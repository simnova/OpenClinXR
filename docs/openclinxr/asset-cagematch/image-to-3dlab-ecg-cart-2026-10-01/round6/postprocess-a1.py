#!/usr/bin/env python3
"""Area-downsample A1 textures and split smooth normals at 35 degrees."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import resource
import sys
import time
from pathlib import Path

import numpy as np
import cv2
import torch
import trimesh
from PIL import Image


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def split_normals(mesh, angle_deg=35.0):
    faces = np.asarray(mesh.faces)
    parent = np.arange(len(faces), dtype=np.int32)
    def root(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for (a, b), angle in zip(mesh.face_adjacency, mesh.face_adjacency_angles):
        if angle <= np.radians(angle_deg):
            ra, rb = root(int(a)), root(int(b))
            if ra != rb:
                parent[rb] = ra
    groups = np.array([root(i) for i in range(len(faces))], dtype=np.int32)
    mapping = {}
    new_vertices, new_uv, new_faces = [], [], np.empty_like(faces)
    uv = np.asarray(mesh.visual.uv)
    for fi, face in enumerate(faces):
        group = int(groups[fi])
        for corner, vertex in enumerate(face):
            key = (int(vertex), group)
            index = mapping.get(key)
            if index is None:
                index = len(new_vertices)
                mapping[key] = index
                new_vertices.append(mesh.vertices[vertex])
                new_uv.append(uv[vertex])
            new_faces[fi, corner] = index
    vertices = np.asarray(new_vertices)
    uvs = np.asarray(new_uv)
    # Area-weighted normals within each smoothing group.
    normals = np.zeros_like(vertices)
    tri = vertices[new_faces]
    face_normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for corner in range(3):
        np.add.at(normals, new_faces[:, corner], face_normals)
    norms = np.linalg.norm(normals, axis=1)
    normals /= np.maximum(norms[:, None], 1e-12)
    return vertices, new_faces, uvs, normals, int(len(vertices) - len(mesh.vertices))


def resize(image, size=512):
    return Image.fromarray(np.asarray(image)).resize((size, size), Image.Resampling.BOX)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--trellis-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    started = time.time()
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
    sys.path.insert(0, str(args.trellis_root))
    import o_voxel.postprocess as post
    scene = trimesh.load(args.input, force="scene", process=False)
    if len(scene.geometry) != 1:
        raise RuntimeError("expected one geometry")
    mesh = next(iter(scene.geometry.values()))
    vertices, faces, uv, normals, duplicates = split_normals(mesh, 35.0)
    # A0 is already in GLB Z-up. Convert only sample positions back to the
    # decoder's Y-up frame; output geometry and A0 UVs remain byte-for-byte in
    # the same coordinate convention.
    bundle = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    source_vertices, source_faces = bundle["vertices"], bundle["faces"]
    bvh = post._BVH(source_vertices, source_faces)
    vertices_t = torch.from_numpy(vertices.astype(np.float32))
    faces_t = torch.from_numpy(faces.astype(np.int32))
    uv_t = torch.from_numpy(uv.astype(np.float32))
    uv_bake = uv_t.clone()
    uv_bake[:, 1] = 1 - uv_bake[:, 1]
    bake_size = 2048
    ctx = post.dr.MtlRasterizeContext()
    clip = torch.cat((uv_bake * 2 - 1, torch.zeros_like(uv_bake[:, :1]), torch.ones_like(uv_bake[:, :1])), dim=-1)[None]
    rast, _ = post.dr.rasterize(ctx, clip, faces_t, resolution=[bake_size, bake_size])
    mask = rast[0, ..., 3] > 0
    pos_glb = post.dr.interpolate(vertices_t[None], rast, faces_t)[0][0][mask]
    pos = torch.stack((pos_glb[:, 0], -pos_glb[:, 2], pos_glb[:, 1]), dim=-1)
    _, face_id, bary = bvh.unsigned_distance(pos, return_uvw=True)
    triangles = source_vertices[source_faces[face_id.long()]]
    snapped = (triangles * bary[..., None]).sum(1)
    attrs = torch.zeros(bake_size, bake_size, bundle["attrs"].shape[1])
    coords = bundle["coords"]
    attrs[mask] = post._grid_sample_3d(
        bundle["attrs"], torch.cat((torch.zeros_like(coords[:, :1]), coords), dim=-1),
        shape=torch.Size([1, bundle["attrs"].shape[1], 1024, 1024, 1024]),
        grid=((snapped + 0.5) / bundle["voxel_size"]).reshape(1, -1, 3), mode="trilinear")
    layout = bundle["layout"]
    mask_np = mask.numpy()
    inv = (~mask_np).astype(np.uint8)
    base = np.clip(attrs[..., layout["base_color"]].numpy() * 255, 0, 255).astype(np.uint8)
    metal = np.clip(attrs[..., layout["metallic"]].numpy() * 255, 0, 255).astype(np.uint8)
    rough = np.clip(attrs[..., layout["roughness"]].numpy() * 255, 0, 255).astype(np.uint8)
    alpha = np.clip(attrs[..., layout["alpha"]].numpy() * 255, 0, 255).astype(np.uint8)
    base = cv2.inpaint(base, inv, 3, cv2.INPAINT_TELEA)
    metal = cv2.inpaint(metal, inv, 1, cv2.INPAINT_TELEA)[..., None]
    rough = cv2.inpaint(rough, inv, 1, cv2.INPAINT_TELEA)[..., None]
    alpha = cv2.inpaint(alpha, inv, 1, cv2.INPAINT_TELEA)[..., None]
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=resize(Image.fromarray(np.concatenate((base, alpha), axis=-1))),
        metallicRoughnessTexture=resize(Image.fromarray(np.concatenate((np.zeros_like(metal), rough, metal), axis=-1))),
        baseColorFactor=np.array([255, 255, 255, 255], dtype=np.uint8),
        metallicFactor=1.0,
        roughnessFactor=1.0,
        alphaMode="OPAQUE",
        doubleSided=True,
    )
    out_mesh = trimesh.Trimesh(vertices=vertices, faces=faces, vertex_normals=normals,
                               process=False, visual=trimesh.visual.TextureVisuals(uv=uv, material=material))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    out_mesh.export(args.out)
    report = {
        "schemaVersion": "openclinxr.ecg-cart-round6-a1-post.v1",
        "input": str(args.input), "output": str(args.out),
        "checkpoint": str(args.checkpoint), "checkpointSha256": sha256(args.checkpoint),
        "triangles": int(len(faces)), "vertices": int(len(vertices)),
        "normalSplitAngleDegrees": 35,
        "casterHandling": "same 35-degree connected-face smoothing-group rule as every other component; no caster exception",
        "duplicatedVerticesForHardEdges": duplicates,
        "texture": "A0 UVs; one raster sample per 2048 texel; closest-point snap to frozen full-resolution mesh; trilinear voxel sample; Telea base colour r=3; area-downsample to 512 with Pillow BOX",
        "normalMap": False, "bytes": args.out.stat().st_size,
        "sha256": sha256(args.out), "seconds": time.time() - started,
        "peakRssBytes": int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss),
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
