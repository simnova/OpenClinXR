#!/usr/bin/env python3
"""
Anny rest-skeleton export + collapse to OpenClinXR runtime subset.

Proven path (Anny / MakeHuman community):
  - Author rest pose in Anny model space (FK + LBS)
  - Emit bind landmarks / mapped runtime subset for consumers
  - Do NOT invent bbox-only armatures when Anny rest is available

Coordinate rewrite matches generate_mesh.build_real_anny_body:
  Anny Z-up (x, y_depth, z_height) → Blender mesh local Y-up:
    x' = x * scale
    y' = (z - min_z) * scale
    z' = -y * scale
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

_MAP_PATH = Path(__file__).resolve().parent / "runtime_bone_map.json"


def load_runtime_bone_map(path: Optional[str] = None) -> Dict[str, Any]:
    p = Path(path) if path else _MAP_PATH
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def _as_xyz(v: Sequence[float]) -> Tuple[float, float, float]:
    return (float(v[0]), float(v[1]), float(v[2]))


def transform_anny_z_up_to_y_up(
    points: Sequence[Sequence[float]],
    min_z: float,
    scale: float,
) -> List[Tuple[float, float, float]]:
    out: List[Tuple[float, float, float]] = []
    for p in points:
        x, y, z = float(p[0]), float(p[1]), float(p[2])
        out.append((x * scale, (z - min_z) * scale, -y * scale))
    return out


def compute_bind_offset_from_skin(
    bone_heads: Sequence[Sequence[float]],
    bone_names: Sequence[str],
    mesh_vertices: Sequence[Sequence[float]],
    vertex_bone_indices: Sequence[Sequence[int]],
    vertex_bone_weights: Sequence[Sequence[float]],
    *,
    weight_threshold: float = 0.4,
    min_samples: int = 8,
) -> Dict[str, Any]:
    """
    Empirical bind snap: Anny rest_bone_heads can sit ~0.25–0.30 m above the mesh
    regions they skin after Z-up→Y-up (≈12\"). Median (bone − skinned-centroid)
    is the correction applied to all joints so SkeletonHelper and LBS rest match.
    """
    name_to_i = {str(n): i for i, n in enumerate(bone_names)}
    dys: List[float] = []
    dxs: List[float] = []
    dzs: List[float] = []
    per_bone: Dict[str, float] = {}
    n_mesh = len(mesh_vertices)
    for bi, bname in enumerate(bone_names):
        if bi >= len(bone_heads):
            continue
        pts: List[Tuple[float, float, float]] = []
        for vi in range(min(n_mesh, len(vertex_bone_indices))):
            ii = vertex_bone_indices[vi]
            ww = vertex_bone_weights[vi]
            for j, b in enumerate(ii):
                if int(b) == bi and float(ww[j]) >= weight_threshold:
                    v = mesh_vertices[vi]
                    pts.append((float(v[0]), float(v[1]), float(v[2])))
                    break
        if len(pts) < min_samples:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        cz = sum(p[2] for p in pts) / len(pts)
        bh = bone_heads[bi]
        dx = float(bh[0]) - cx
        dy = float(bh[1]) - cy
        dz = float(bh[2]) - cz
        dxs.append(dx)
        dys.append(dy)
        dzs.append(dz)
        per_bone[str(bname)] = dy

    def _med(vals: List[float]) -> float:
        if not vals:
            return 0.0
        s = sorted(vals)
        return s[len(s) // 2]

    return {
        "sampleBones": len(dys),
        "offset": [_med(dxs), _med(dys), _med(dzs)],
        "offsetYInches": round(_med(dys) * 39.3701, 2),
        "medianDY": _med(dys),
        "perBoneDY": per_bone,
        "method": "median_bone_minus_skinned_centroid",
        "weightThreshold": weight_threshold,
    }


def apply_bind_offset_to_bones(
    bones: List[Dict[str, Any]],
    offset: Sequence[float],
) -> None:
    """Subtract offset from every head/tail (in place)."""
    ox, oy, oz = float(offset[0]), float(offset[1]), float(offset[2])
    if abs(ox) < 1e-9 and abs(oy) < 1e-9 and abs(oz) < 1e-9:
        return
    for b in bones:
        for key in ("head", "tail"):
            p = b.get(key)
            if not p or len(p) < 3:
                continue
            b[key] = [
                round(float(p[0]) - ox, 6),
                round(float(p[1]) - oy, 6),
                round(float(p[2]) - oz, 6),
            ]


def _avg(points: Sequence[Tuple[float, float, float]]) -> Tuple[float, float, float]:
    n = max(len(points), 1)
    return (
        sum(p[0] for p in points) / n,
        sum(p[1] for p in points) / n,
        sum(p[2] for p in points) / n,
    )


def build_anny_to_runtime_index(
    anny_labels: Sequence[str],
    anny_parents: Sequence[int],
    runtime_map: Dict[str, Any],
) -> Dict[int, str]:
    """Map every Anny bone index → runtime bone name (parent-walk fallback → pelvis)."""
    label_to_runtime: Dict[str, str] = {}
    for rb in runtime_map["runtimeBones"]:
        rt = rb["name"]
        for src in rb.get("weightSources") or [rb.get("primary")]:
            if src and src not in label_to_runtime:
                label_to_runtime[str(src)] = rt

    name_to_i = {str(l): i for i, l in enumerate(anny_labels)}
    out: Dict[int, str] = {}
    for i, lab in enumerate(anny_labels):
        lab_s = str(lab)
        if lab_s in label_to_runtime:
            out[i] = label_to_runtime[lab_s]
            continue
        j = i
        found = None
        for _ in range(32):
            p = int(anny_parents[j]) if j < len(anny_parents) else -1
            if p is None or p < 0:
                break
            pl = str(anny_labels[p])
            if pl in label_to_runtime:
                found = label_to_runtime[pl]
                break
            j = p
        out[i] = found or "pelvis"
    # ensure all runtime primaries exist in label space when present
    for rb in runtime_map["runtimeBones"]:
        prim = rb.get("primary")
        if prim and prim in name_to_i:
            out[name_to_i[prim]] = rb["name"]
    return out


def collapse_weights_to_runtime(
    vertex_bone_indices: Any,
    vertex_bone_weights: Any,
    anny_to_runtime: Dict[int, str],
    runtime_names: Sequence[str],
    max_influences: int = 4,
) -> Tuple[List[List[int]], List[List[float]]]:
    """Collapse Anny (V,K) indices/weights into runtime bone indices (V, max_influences)."""
    import numpy as np

    idx = np.asarray(vertex_bone_indices)
    w = np.asarray(vertex_bone_weights, dtype=float)
    name_to_ri = {n: i for i, n in enumerate(runtime_names)}
    vcount = idx.shape[0]
    out_i: List[List[int]] = []
    out_w: List[List[float]] = []
    for vi in range(vcount):
        acc: Dict[int, float] = {}
        for k in range(idx.shape[1]):
            bi = int(idx[vi, k])
            if bi < 0:
                continue
            wt = float(w[vi, k])
            if wt <= 1e-8:
                continue
            rt = anny_to_runtime.get(bi, "pelvis")
            ri = name_to_ri.get(rt, name_to_ri["pelvis"])
            acc[ri] = acc.get(ri, 0.0) + wt
        if not acc:
            acc[name_to_ri["pelvis"]] = 1.0
        items = sorted(acc.items(), key=lambda t: -t[1])[:max_influences]
        total = sum(v for _, v in items) or 1.0
        row_i = [i for i, _ in items]
        row_w = [v / total for _, v in items]
        while len(row_i) < max_influences:
            row_i.append(row_i[0] if row_i else 0)
            row_w.append(0.0)
        # renormalize after pad zeros
        s = sum(row_w) or 1.0
        row_w = [x / s for x in row_w]
        out_i.append(row_i)
        out_w.append(row_w)
    return out_i, out_w


def export_rest_skeleton_from_anny_model(
    model: Any,
    phenotype_kwargs: Dict[str, Any],
    local_changes_kwargs: Optional[Dict[str, Any]],
    pose_parameters: Any,
    min_z: float,
    scale: float,
    runtime_map: Optional[Dict[str, Any]] = None,
    include_weights: bool = True,
) -> Dict[str, Any]:
    """
    Run Anny forward (rest pose) and emit full 163 + runtime subset in Y-up mesh space.
    """
    import torch

    runtime_map = runtime_map or load_runtime_bone_map()
    labels = [str(x) for x in model.bone_labels]
    parents = [int(x) for x in model.bone_parents]

    with torch.no_grad():
        output = model(
            pose_parameters=pose_parameters,
            phenotype_kwargs=phenotype_kwargs,
            local_changes_kwargs=local_changes_kwargs or {},
            return_bone_ends=True,
        )
    heads_z = output["rest_bone_heads"].squeeze(0).cpu().tolist()
    tails_z = output["rest_bone_tails"].squeeze(0).cpu().tolist()
    heads = transform_anny_z_up_to_y_up(heads_z, min_z, scale)
    tails = transform_anny_z_up_to_y_up(tails_z, min_z, scale)
    label_to_i = {n: i for i, n in enumerate(labels)}

    full_bones = []
    for i, lab in enumerate(labels):
        p = parents[i]
        full_bones.append(
            {
                "index": i,
                "name": lab,
                "parent": labels[p] if p is not None and p >= 0 else None,
                "parentIndex": p if p is not None and p >= 0 else -1,
                "head": [round(heads[i][0], 6), round(heads[i][1], 6), round(heads[i][2], 6)],
                "tail": [round(tails[i][0], 6), round(tails[i][1], 6), round(tails[i][2], 6)],
            }
        )

    runtime_bones = []
    for rb in runtime_map["runtimeBones"]:
        name = rb["name"]
        head_from = rb.get("headFrom") or [rb["primary"]]
        if rb.get("headCombine") == "average":
            pts = []
            for src in head_from:
                if src in label_to_i:
                    pts.append(heads[label_to_i[src]])
            head = _avg(pts) if pts else (0.0, 0.0, 0.0)
        else:
            prim = rb["primary"]
            hi = label_to_i.get(prim)
            head = heads[hi] if hi is not None else (0.0, 0.0, 0.0)

        tail_src = rb.get("tailFrom") or rb["primary"]
        if isinstance(tail_src, list):
            tail_src = tail_src[0]
        ti = label_to_i.get(str(tail_src))
        if ti is not None:
            # Prefer head of tail bone (joint) when different from primary; else primary tail
            if str(tail_src) != rb["primary"]:
                tail = heads[ti]
            else:
                tail = tails[ti]
        else:
            tail = (head[0], head[1] + 0.05, head[2])

        if rb.get("tailOffsetY"):
            tail = (tail[0], tail[1] + float(rb["tailOffsetY"]), tail[2])

        # Degenerate length guard
        dx, dy, dz = tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]
        if (dx * dx + dy * dy + dz * dz) ** 0.5 < 1e-4:
            tail = (head[0], head[1] + 0.05, head[2])

        runtime_bones.append(
            {
                "name": name,
                "parent": rb.get("parent"),
                "primary": rb.get("primary"),
                "weightSources": rb.get("weightSources") or [rb.get("primary")],
                "head": [round(head[0], 6), round(head[1], 6), round(head[2], 6)],
                "tail": [round(tail[0], 6), round(tail[1], 6), round(tail[2], 6)],
            }
        )

    anny_to_runtime = build_anny_to_runtime_index(labels, parents, runtime_map)
    runtime_names = [b["name"] for b in runtime_bones]

    payload: Dict[str, Any] = {
        "schemaVersion": "openclinxr.anny-rest-skeleton.v1",
        "coordinateBasis": "blender_mesh_local_y_height",
        "sourceRig": "anny.create_fullbody_model",
        "sourceBoneCount": len(labels),
        "runtimeBoneCount": len(runtime_bones),
        "scale": scale,
        "minZ": min_z,
        "mapSchema": runtime_map.get("schemaVersion"),
        "annyBones": full_bones,
        "runtimeBones": runtime_bones,
        "annyIndexToRuntime": {str(k): v for k, v in anny_to_runtime.items()},
        "claimScope": "anny_rest_skeleton_for_runtime_subset_not_clinical_validity",
        "notEvidenceFor": [
            "clinical_validity",
            "scoring_validity",
            "production_asset_readiness",
            "b_plus_visual_realism_gate",
        ],
    }

    if include_weights and hasattr(model, "vertex_bone_indices") and hasattr(model, "vertex_bone_weights"):
        vi = model.vertex_bone_indices.detach().cpu().numpy()
        vw = model.vertex_bone_weights.detach().cpu().numpy()
        # Full 163 weights for full-armature retarget consumers
        payload["fullSkinning"] = {
            "vertexCount": int(vi.shape[0]),
            "maxInfluences": int(vi.shape[1]) if vi.ndim == 2 else 4,
            "boneNames": labels,
            "vertexBoneIndices": vi.astype(int).tolist(),
            "vertexBoneWeights": [[round(float(x), 6) for x in row] for row in vw.tolist()],
            "source": "anny.vertex_bone_* full 163",
        }
        ri, rw = collapse_weights_to_runtime(vi, vw, anny_to_runtime, runtime_names, max_influences=4)
        payload["skinning"] = {
            "vertexCount": int(vi.shape[0]),
            "maxInfluences": 4,
            "runtimeBoneNames": runtime_names,
            "vertexBoneIndices": ri,
            "vertexBoneWeights": [[round(float(x), 6) for x in row] for row in rw],
            "source": "anny.vertex_bone_* collapsed via runtime_bone_map",
        }

        # Snap joints down to skinned mesh (fixes ~12" elevated rest bones).
        try:
            mesh_verts = transform_anny_z_up_to_y_up(
                output["vertices"].squeeze(0).cpu().tolist(),
                min_z,
                scale,
            )
            snap = compute_bind_offset_from_skin(
                [b["head"] for b in full_bones],
                labels,
                mesh_verts,
                vi.astype(int).tolist(),
                vw.tolist(),
            )
            apply_bind_offset_to_bones(full_bones, snap["offset"])
            apply_bind_offset_to_bones(runtime_bones, snap["offset"])
            payload["annyBones"] = full_bones
            payload["runtimeBones"] = runtime_bones
            payload["bindSnap"] = {
                "offset": snap["offset"],
                "offsetYInches": snap["offsetYInches"],
                "sampleBones": snap["sampleBones"],
                "method": snap["method"],
                "note": "subtracted from bone head/tail so joints sit in skinned mesh",
            }
        except Exception as snap_exc:
            payload["bindSnap"] = {
                "error": f"{snap_exc.__class__.__name__}: {snap_exc}",
                "applied": False,
            }

    # Landmarks for lab align (after snap)
    lm = {}
    for b in runtime_bones:
        if b["name"] in (
            "pelvis",
            "head",
            "hand.L",
            "hand.R",
            "foot.L",
            "foot.R",
            "upper_arm.L",
            "upper_arm.R",
        ):
            lm[b["name"]] = b["head"]
    payload["bindLandmarks"] = lm
    return payload


def write_rest_skeleton_sidecar(payload: Dict[str, Any], mesh_or_glb_path: str) -> str:
    """Write `<stem>.anny_rest_skeleton.json` next to mesh/glb."""
    base, _ = os.path.splitext(mesh_or_glb_path)
    # Prefer stripping double extensions carefully
    if base.endswith(".anny_base"):
        out = base + ".anny_rest_skeleton.json"
    else:
        out = base + ".anny_rest_skeleton.json"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    return out
