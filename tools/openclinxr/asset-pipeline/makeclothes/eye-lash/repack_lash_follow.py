#!/usr/bin/env python3
"""Patch shipped MPFB GLBs with same-own-region lash seat/follow targets.

This is intentionally a narrow GLB surgery tool.  It imports the same
``lash_follow_core`` used by the Blender materializer, appends three dedicated
float32 accessors to the BIN chunk, and changes only the lash primitive's
POSITION/targets plus its mesh targetNames/weights.  Morph NORMAL deltas are
omitted: the treatment is a rigid translation per connected card, so normals
are unchanged at rest and through closure.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import struct
import subprocess
from collections import Counter
from pathlib import Path

import numpy as np

from lash_follow_core import (
    LID_MOVE_EPS_M,
    MAX_SNAP_M,
    bind_lash_cards,
    build_lid_regions,
    connected_cards,
    eye_horizontal_axis,
    select_eye_margin_loop,
    welded_boundary_loops,
)


ACTORS = (
    "mpfb-clinical-nurse-adult.glb",
    "mpfb-clinical-physician-adult.glb",
    "mpfb-family-partner-adult.glb",
    "mpfb-gown-adult-patient.glb",
    "mpfb-gown-ed-robert-hayes.glb",
    "mpfb-gown-inspect.glb",
    "mpfb-ob-patient-aisha.glb",
    "mpfb-peds-nurse-kevin.glb",
    "mpfb-peds-parent-aisha.glb",
    "mpfb-peds-patient-child.glb",
    "mpfb-street-adult-male.glb",
    "mpfb-viseme-inspect.glb",
)
CLOSURES = ("eye-left-closure", "eye-right-closure")
TOOL_PATH = "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/repack_lash_follow.py"
CORE_PATH = Path(__file__).with_name("lash_follow_core.py")
COMPONENT = {
    5120: ("b", np.int8),
    5121: ("B", np.uint8),
    5122: ("h", np.int16),
    5123: ("H", np.uint16),
    5125: ("I", np.uint32),
    5126: ("f", np.float32),
}
TYPE_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
WELD_TOLERANCE_M = 1.0e-6


def parse_glb(raw: bytes):
    if len(raw) < 20 or raw[:4] != b"glTF":
        raise ValueError("not a binary glTF")
    version, declared = struct.unpack_from("<II", raw, 4)
    if version != 2 or declared != len(raw):
        raise ValueError(f"unsupported GLB header version={version} length={declared}/{len(raw)}")
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    if json_type != 0x4E4F534A:
        raise ValueError("first GLB chunk is not JSON")
    json_start, json_end = 20, 20 + json_len
    doc = json.loads(raw[json_start:json_end])
    bin_len, bin_type = struct.unpack_from("<II", raw, json_end)
    if bin_type != 0x004E4942 or json_end + 8 + bin_len != len(raw):
        raise ValueError("GLB must contain exactly one terminal BIN chunk")
    return doc, bytearray(raw[json_end + 8:])


def accessor_array(doc, binary: bytearray, accessor_index: int) -> np.ndarray:
    accessor = doc["accessors"][accessor_index]
    component_type = accessor["componentType"]
    if component_type not in COMPONENT or accessor["type"] not in TYPE_WIDTH:
        raise ValueError(f"unsupported accessor {accessor_index} encoding")
    _, dtype = COMPONENT[component_type]
    width = TYPE_WIDTH[accessor["type"]]
    item_bytes = np.dtype(dtype).itemsize * width
    count = accessor["count"]
    if "bufferView" not in accessor:
        out = np.zeros((count, width), dtype=dtype)
    else:
        view = doc["bufferViews"][accessor["bufferView"]]
        if view.get("buffer", 0) != 0:
            raise ValueError(f"accessor {accessor_index} is not in GLB buffer 0")
        stride = view.get("byteStride", item_bytes)
        offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        if stride == item_bytes:
            out = np.frombuffer(binary, dtype=np.dtype(dtype).newbyteorder("<"), count=count * width, offset=offset).reshape(count, width).copy()
        else:
            out = np.empty((count, width), dtype=dtype)
            for row in range(count):
                out[row] = np.frombuffer(
                    binary,
                    dtype=np.dtype(dtype).newbyteorder("<"),
                    count=width,
                    offset=offset + row * stride,
                )
    sparse = accessor.get("sparse")
    if sparse:
        index_spec = sparse["indices"]
        index_component = index_spec["componentType"]
        if index_component not in (5121, 5123, 5125):
            raise ValueError(f"accessor {accessor_index} sparse index type {index_component}")
        _, index_dtype = COMPONENT[index_component]
        index_view = doc["bufferViews"][index_spec["bufferView"]]
        index_offset = index_view.get("byteOffset", 0) + index_spec.get("byteOffset", 0)
        sparse_indices = np.frombuffer(
            binary,
            dtype=np.dtype(index_dtype).newbyteorder("<"),
            count=sparse["count"],
            offset=index_offset,
        ).astype(np.int64)
        value_spec = sparse["values"]
        value_view = doc["bufferViews"][value_spec["bufferView"]]
        value_offset = value_view.get("byteOffset", 0) + value_spec.get("byteOffset", 0)
        sparse_values = np.frombuffer(
            binary,
            dtype=np.dtype(dtype).newbyteorder("<"),
            count=sparse["count"] * width,
            offset=value_offset,
        ).reshape(sparse["count"], width)
        out[sparse_indices] = sparse_values
    return out


def matched(doc, actor: str):
    bodies, lashes = [], []
    for node_index, node in enumerate(doc.get("nodes", [])):
        if "mesh" not in node:
            continue
        mesh = doc["meshes"][node["mesh"]]
        names = mesh.get("extras", {}).get("targetNames", [])
        label = f"{node.get('name', '')} {mesh.get('name', '')}".lower()
        if "eyelash" not in label and all(name in names for name in CLOSURES):
            bodies.append((node_index, node["mesh"], mesh))
        if "eyelash" in label:
            lashes.append((node_index, node["mesh"], mesh))
    if len(bodies) != 1:
        raise ValueError(f"CW3 {actor}: body match count {len(bodies)}")
    if len(lashes) != 1:
        raise ValueError(f"CW3 {actor}: lash match count {len(lashes)}")
    for kind, match in (("body", bodies[0]), ("lash", lashes[0])):
        node = doc["nodes"][match[0]]
        if any(key in node for key in ("matrix", "translation", "rotation", "scale")):
            raise ValueError(f"CW3 {actor}: {kind} node has a transform; common local glTF frame required")
        if kind == "lash" and len(match[2].get("primitives", [])) != 1:
            raise ValueError(f"CW3 {actor}: lash primitive count is not one")
    return bodies[0], lashes[0]


def eye_shell_geometry(doc, binary, actor: str) -> tuple[np.ndarray, np.ndarray]:
    matches, faces, offset = [], [], 0
    for node in doc.get("nodes", []):
        if "mesh" not in node:
            continue
        mesh = doc["meshes"][node["mesh"]]
        label = f"{node.get('name', '')} {mesh.get('name', '')}".lower()
        if "eye" in label and "eyelash" not in label and "eyebrow" not in label \
                and not mesh.get("extras", {}).get("targetNames"):
            for primitive in mesh.get("primitives", []):
                points = accessor_array(
                    doc, binary, primitive["attributes"]["POSITION"]
                ).astype(float)
                matches.append(points)
                faces.append(triangles(doc, binary, primitive, actor, "eye") + offset)
                offset += len(points)
    if not matches:
        raise ValueError(f"CW3 {actor}: eyeball/cornea mesh not found")
    return np.concatenate(matches), np.concatenate(faces)


def aggregate_body_geometry(doc, binary, mesh, actor: str):
    names = mesh.get("extras", {}).get("targetNames", [])
    positions, faces = [], []
    deltas = {side: [] for side in ("left", "right")}
    offset = 0
    for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
        points = accessor_array(doc, binary, primitive["attributes"]["POSITION"]).astype(float)
        positions.append(points)
        faces.append(triangles(doc, binary, primitive, actor, f"body[{primitive_index}]") + offset)
        for side, target_name in (("left", CLOSURES[0]), ("right", CLOSURES[1])):
            target_index = names.index(target_name)
            targets = primitive.get("targets", [])
            if target_index >= len(targets) or "POSITION" not in targets[target_index]:
                raise ValueError(f"CW3 {actor}: body[{primitive_index}] target {target_name} missing POSITION")
            deltas[side].append(accessor_array(
                doc, binary, targets[target_index]["POSITION"]
            ).astype(float))
        offset += len(points)
    return np.concatenate(positions), np.concatenate(faces), {
        side: np.concatenate(rows) for side, rows in deltas.items()
    }


def triangles(doc, binary, primitive, actor: str, label: str) -> np.ndarray:
    if "indices" not in primitive:
        count = doc["accessors"][primitive["attributes"]["POSITION"]]["count"]
        indices = np.arange(count, dtype=np.int64)
    else:
        indices = accessor_array(doc, binary, primitive["indices"]).reshape(-1).astype(np.int64)
    if len(indices) % 3:
        raise ValueError(f"CW3 {actor}: {label} index count {len(indices)} is not triangles")
    return indices.reshape(-1, 3)


def append_vec3_accessor(doc, binary: bytearray, values: np.ndarray) -> int:
    values = np.asarray(values, dtype="<f4")
    if values.ndim != 2 or values.shape[1] != 3:
        raise ValueError(f"new accessor must be Nx3, got {values.shape}")
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    payload = values.tobytes(order="C")
    binary.extend(payload)
    view_index = len(doc.setdefault("bufferViews", []))
    doc["bufferViews"].append({
        "buffer": 0,
        "byteOffset": offset,
        "byteLength": len(payload),
        "target": 34962,
    })
    accessor = {
        "bufferView": view_index,
        "componentType": 5126,
        "count": len(values),
        "type": "VEC3",
    }
    accessor["max"] = [float(value) for value in values.max(axis=0)]
    accessor["min"] = [float(value) for value in values.min(axis=0)]
    accessor_index = len(doc.setdefault("accessors", []))
    doc["accessors"].append(accessor)
    return accessor_index


def encode_glb(doc, binary: bytearray) -> bytes:
    doc["buffers"][0]["byteLength"] = len(binary)
    json_bytes = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary.extend(b"\0" * ((-len(binary)) % 4))
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    return (
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<II", len(json_bytes), 0x4E4F534A)
        + json_bytes
        + struct.pack("<II", len(binary), 0x004E4942)
        + bytes(binary)
    )


def verify_narrow_patch(before_doc, before_binary: bytes, after_doc, after_binary: bytes, lash_mesh_index: int):
    """Fail closed unless the mutation is exactly the permitted lash append."""
    if after_binary[: len(before_binary)] != before_binary:
        raise ValueError("CW1/CW2 original BIN prefix changed")
    if len(after_doc["bufferViews"]) != len(before_doc["bufferViews"]) + 3:
        raise ValueError("expected exactly three appended bufferViews")
    if len(after_doc["accessors"]) != len(before_doc["accessors"]) + 3:
        raise ValueError("expected exactly three appended accessors")
    if after_doc["bufferViews"][: len(before_doc["bufferViews"])] != before_doc["bufferViews"]:
        raise ValueError("CW1/CW2 original bufferView JSON changed")
    if after_doc["accessors"][: len(before_doc["accessors"])] != before_doc["accessors"]:
        raise ValueError("CW1/CW2 original accessor JSON changed")
    for key in (
        "asset", "extensions", "extensionsRequired", "extensionsUsed", "materials",
        "images", "textures", "samplers", "skins", "animations", "nodes", "scenes",
        "scene", "cameras",
    ):
        if after_doc.get(key) != before_doc.get(key):
            raise ValueError(f"CW1/CW2 protected glTF subtree changed: {key}")
    for index, mesh in enumerate(before_doc["meshes"]):
        if index != lash_mesh_index and after_doc["meshes"][index] != mesh:
            raise ValueError(f"CW2 non-lash mesh JSON changed at {index}")
    if len(after_doc["meshes"]) != len(before_doc["meshes"]):
        raise ValueError("CW2 mesh count changed")
    expected_lash = copy.deepcopy(before_doc["meshes"][lash_mesh_index])
    first_accessor = len(before_doc["accessors"])
    expected_lash["primitives"][0]["attributes"]["POSITION"] = first_accessor
    expected_lash["primitives"][0]["targets"] = [
        {"POSITION": first_accessor + 1}, {"POSITION": first_accessor + 2}
    ]
    expected_lash.setdefault("extras", {})["targetNames"] = list(CLOSURES)
    expected_lash["weights"] = [0.0, 0.0]
    if after_doc["meshes"][lash_mesh_index] != expected_lash:
        raise ValueError("lash mesh mutation exceeded POSITION/targets/targetNames/weights")
    new_views = list(range(len(before_doc["bufferViews"]), len(after_doc["bufferViews"])))
    new_accessors = after_doc["accessors"][-3:]
    if [accessor.get("bufferView") for accessor in new_accessors] != new_views:
        raise ValueError("new lash accessors do not each own a dedicated bufferView")
    for accessor in new_accessors:
        if not all(key in accessor for key in ("min", "max")):
            raise ValueError("new lash accessor lacks min/max")


def percentile(values, fraction: float) -> float:
    ordered = sorted(float(value) * 1000.0 for value in values)
    if not ordered:
        return 0.0
    return round(ordered[int(fraction * (len(ordered) - 1))], 6)


def patch_bytes(raw: bytes, actor: str):
    doc, binary = parse_glb(raw)
    before_doc = copy.deepcopy(doc)
    before_binary = bytes(binary)
    body_match, lash_match = matched(doc, actor)
    body_mesh, lash_mesh = body_match[2], lash_match[2]
    lash_primitive = lash_mesh["primitives"][0]
    if lash_primitive.get("targets") or lash_mesh.get("extras", {}).get("targetNames"):
        raise ValueError(f"CW3 {actor}: lash already has morph targets; refusing ambiguous repack")

    body, body_triangles, closure_deltas = aggregate_body_geometry(
        doc, binary, body_mesh, actor
    )
    lash = accessor_array(doc, binary, lash_primitive["attributes"]["POSITION"]).astype(float)
    lash_triangles = triangles(doc, binary, lash_primitive, actor, "lash")

    eye_vertices, eye_triangles = eye_shell_geometry(doc, binary, actor)
    eye_shell_ids = connected_cards(len(eye_vertices), eye_triangles)
    if len(eye_shell_ids) != 2:
        raise ValueError(f"CW3 {actor}: expected two connected eye shells, found {len(eye_shell_ids)}")
    eye_centres = {}
    eye_proof_aabbs = {}
    margin_topology = {}
    boundary_loops = welded_boundary_loops(
        body, body_triangles, WELD_TOLERANCE_M
    )
    for side in ("left", "right"):
        moving_ids = np.flatnonzero(
            np.linalg.norm(closure_deltas[side], axis=1) > LID_MOVE_EPS_M
        )
        side_sign = 1.0 if body[moving_ids, 0].mean() > 0 else -1.0
        matching_shells = [ids for ids in eye_shell_ids if eye_vertices[ids, 0].mean() * side_sign > 0]
        if len(matching_shells) != 1:
            raise ValueError(f"CW3 {actor} {side}: connected eye-shell side matches {len(matching_shells)}")
        own_eye = eye_vertices[matching_shells[0]]
        if len(own_eye) < 10:
            raise ValueError(f"CW3 {actor} {side}: eye-shell side has {len(own_eye)} verts")
        eye_centres[side] = own_eye.mean(axis=0)
        eye_proof_aabbs[side] = (own_eye.min(axis=0), own_eye.max(axis=0))
        margin_topology[side] = select_eye_margin_loop(
            body, boundary_loops, eye_centres[side], eye_proof_aabbs[side],
            up_axis=1, minimum_vertices=10,
        )
    horizontal_axis = eye_horizontal_axis(eye_centres, up_axis=1)

    regions = build_lid_regions(
        body,
        body_triangles,
        closure_deltas,
        eye_centres,
        eye_proof_aabbs,
        up_axis=1,  # glTF local coordinates are y-up.
        epsilon_m=LID_MOVE_EPS_M,
    )
    snapped, morphs, bindings = bind_lash_cards(
        lash,
        lash_triangles,
        regions,
        actor=actor,
        max_snap_m=MAX_SNAP_M,
    )
    # R7 widens ownership, but the 59 r6 F4 cards remain explicitly
    # unreviewed: do not silently turn a topology ruling into a fit approval.
    historical_regions = build_lid_regions(
        body, body_triangles, closure_deltas, eye_centres, eye_proof_aabbs,
        up_axis=1, epsilon_m=LID_MOVE_EPS_M, upper_any_moving=False,
    )
    _, _, historical_bindings = bind_lash_cards(
        lash, lash_triangles, historical_regions, actor=actor, max_snap_m=MAX_SNAP_M,
    )
    historical_by_card = {binding.card_index: binding for binding in historical_bindings}
    preserved = []
    for index, binding in enumerate(bindings):
        historical = historical_by_card[binding.card_index]
        if not historical.flagged_over_max_snap:
            continue
        snapped[binding.vertex_indices] = lash[binding.vertex_indices]
        morphs[CLOSURES[0]][binding.vertex_indices] = 0.0
        morphs[CLOSURES[1]][binding.vertex_indices] = 0.0
        bindings[index] = historical
        preserved.append(binding.card_index)
    components = connected_cards(len(lash), lash_triangles)
    histogram = dict(sorted(Counter(len(card) for card in components).items()))
    print(f"LASH_COMPONENTS {actor} count={len(components)} sizeHistogram={histogram}")

    old_position = lash_primitive["attributes"]["POSITION"]
    old_position_view = doc["accessors"][old_position]["bufferView"]
    old_view_users = sum(
        1
        for accessor in doc["accessors"]
        if accessor.get("bufferView") == old_position_view
    )
    position_accessor = append_vec3_accessor(doc, binary, snapped)
    left_accessor = append_vec3_accessor(doc, binary, morphs[CLOSURES[0]])
    right_accessor = append_vec3_accessor(doc, binary, morphs[CLOSURES[1]])
    lash_primitive["attributes"]["POSITION"] = position_accessor
    lash_primitive["targets"] = [
        {"POSITION": left_accessor},
        {"POSITION": right_accessor},
    ]
    lash_mesh.setdefault("extras", {})["targetNames"] = list(CLOSURES)
    lash_mesh["weights"] = [0.0, 0.0]

    sides = {}
    for side in ("left", "right"):
        own = [binding for binding in bindings if binding.side == side]
        snaps = [binding.snap_distance_m for binding in own]
        flagged = [int(binding.card_index) for binding in own if binding.flagged_over_max_snap]
        raw_upper = [binding.card_index for binding in own if binding.lid == "upper"]
        patched_lids = {
            binding.card_index: (
                "upper" if snapped[binding.root_indices, 1].mean() > eye_centres[side][1]
                else "lower"
            ) for binding in own
        }
        class_changes = [
            int(binding.card_index) for binding in own
            if patched_lids[binding.card_index] != binding.lid
        ]
        sides[side] = {
            "snap": {
                "p50": percentile(snaps, 0.5),
                "p90": percentile(snaps, 0.9),
                "max": percentile(snaps, 1.0),
            },
            "followBind": {
                "p50": 0.0,
                "p90": 0.0,
                "max": 0.0,
                "definition": "seatTri == followTri and follow is evaluated at the seat point",
            },
            "cardsKeep": len(own),
            "cardsBase": len(own),
            "rawUpperCards": len(raw_upper),
            "rawLowerCards": len(own) - len(raw_upper),
            "upperCards": sum(value == "upper" for value in patched_lids.values()),
            "lowerCards": sum(value == "lower" for value in patched_lids.values()),
            "classChangedCardIds": class_changes,
            "eyeCentre": [float(value) for value in eye_centres[side]],
            "lowerProofAabb": {
                "min": [float(value) for value in eye_proof_aabbs[side][0]],
                "max": [float(value) for value in eye_proof_aabbs[side][1]],
            },
            "bodyPrimitiveCount": len(body_mesh["primitives"]),
            "boundaryWeldToleranceM": WELD_TOLERANCE_M,
            "boundaryLoopCount": len(boundary_loops),
            "eyeOpeningLoopStatus": margin_topology[side]["status"],
            "eyeOpeningLoopVerts": len(margin_topology[side]["loop"]),
            "topologyMarginVerts": len(margin_topology[side]["margin"]),
            "horizontalAxis": [float(value) for value in horizontal_axis],
            "ownRegionTriCountR6": int(sum(
                np.all(np.linalg.norm(closure_deltas[side][triangle], axis=1) > LID_MOVE_EPS_M)
                for triangle in body_triangles
                if body[triangle, 1].mean() > eye_centres[side][1]
            )),
            "ownRegionTriCountR7": int(len(regions[(side, "upper")].triangles)),
            "flaggedOver4_55mmCount": len(flagged),
            "flaggedOver4_55mmCardIds": flagged,
        }
    metadata = {
        "components": {"count": len(components), "sizeHistogram": {str(k): v for k, v in histogram.items()}},
        "oldPositionBufferViewUsers": old_view_users,
        "sides": sides,
        "seatFollowMismatchCount": int(sum(
            binding.seat_triangle_index != binding.follow_triangle_index
            for binding in bindings
        )),
        "preservedR6F4CardIds": preserved,
    }
    verify_narrow_patch(before_doc, before_binary, doc, bytes(binary), lash_match[1])
    output = encode_glb(doc, binary)
    # Reparse the serialized transport, then prove the same narrow mutation.
    check_doc, check_binary = parse_glb(output)
    verify_narrow_patch(before_doc, before_binary, check_doc, bytes(check_binary), lash_match[1])
    return output, metadata


def update_sidecar_text(source: str, output_sha256: str, output_bytes: int, lash_follow: dict) -> bytes:
    first_indented = next(line for line in source.splitlines() if line.startswith(" "))
    indent = len(first_indented) - len(first_indented.lstrip())
    prefix = " " * indent
    sha_pattern = re.compile(rf'^{re.escape(prefix)}"outputSha256": "[0-9a-f]+",$', re.MULTILINE)
    bytes_pattern = re.compile(rf'^{re.escape(prefix)}"outputBytes": [0-9]+(,?)$', re.MULTILINE)
    source, sha_count = sha_pattern.subn(f'{prefix}"outputSha256": "{output_sha256}",', source)
    # Keep the field's own comma: a sidecar whose last field is outputBytes has none.
    source, bytes_count = bytes_pattern.subn(lambda m: f'{prefix}"outputBytes": {output_bytes}{m.group(1)}', source)
    if sha_count != 1 or bytes_count != 1:
        raise ValueError(f"top-level provenance output fields match counts sha={sha_count} bytes={bytes_count}")
    block_lines = json.dumps({"lashFollowR8": lash_follow}, indent=indent, ensure_ascii=True).splitlines()[1:-1]
    stripped = source.rstrip()
    if not stripped.endswith("}"):
        raise ValueError("provenance JSON has no final object close")
    payload = stripped[:-1].rstrip() + ",\n" + "\n".join(block_lines) + "\n}\n"
    json.loads(payload)
    return payload.encode("utf-8")


def sidecar_bytes(sidecar: Path, output: bytes, input_sha256: str, metadata: dict, source_text: str | None = None) -> bytes:
    source = source_text if source_text is not None else sidecar.read_text(encoding="utf-8")
    lash_follow = {
        "tool": TOOL_PATH,
        "coreSha256": hashlib.sha256(CORE_PATH.read_bytes()).hexdigest(),
        "inputSha256": input_sha256,
        "policy": "r8 eye-centroid raw class; moving-upper-lid body-vertex upper hull; upper any-moving/lower proof-AABB own region; same triangle seats and follows; flagged >4.55mm cards remain original with zero closure delta",
        "seatFollowMismatchCount": metadata["seatFollowMismatchCount"],
        "sides": metadata["sides"],
    }
    return update_sidecar_text(source, hashlib.sha256(output).hexdigest(), len(output), lash_follow)


def repair_sidecar_from_ref(glb: Path, sidecar: Path, ref: str):
    current = json.loads(sidecar.read_text(encoding="utf-8"))
    lash_follow = current.get("lashFollowR8")
    if not lash_follow:
        raise ValueError(f"{sidecar}: current sidecar has no lashFollowR8 block")
    lash_follow["coreSha256"] = hashlib.sha256(CORE_PATH.read_bytes()).hexdigest()
    relative = sidecar.resolve().relative_to(Path.cwd().resolve())
    source = subprocess.check_output(
        ["git", "show", f"{ref}:{relative.as_posix()}"], cwd=Path.cwd()
    ).decode("utf-8")
    output = glb.read_bytes()
    payload = update_sidecar_text(
        source, hashlib.sha256(output).hexdigest(), len(output), lash_follow
    )
    suffix = f".lash-r7-sidecar-{os.getpid()}.tmp"
    temporary = sidecar.with_name(sidecar.name + suffix)
    try:
        temporary.write_bytes(payload)
        os.replace(temporary, sidecar)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_pair(glb: Path, output: bytes, sidecar: Path, provenance: bytes):
    suffix = f".lash-r7-{os.getpid()}.tmp"
    glb_tmp = glb.with_name(glb.name + suffix)
    sidecar_tmp = sidecar.with_name(sidecar.name + suffix)
    try:
        glb_tmp.write_bytes(output)
        sidecar_tmp.write_bytes(provenance)
        os.replace(glb_tmp, glb)
        os.replace(sidecar_tmp, sidecar)
    finally:
        glb_tmp.unlink(missing_ok=True)
        sidecar_tmp.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--directory",
        type=Path,
        default=Path("apps/ui-xr/public/generated-humanoids"),
    )
    parser.add_argument("--actor", action="append", choices=ACTORS)
    parser.add_argument(
        "--source-ref",
        help="read pristine GLB and provenance inputs from this git ref while writing --directory",
    )
    parser.add_argument(
        "--repair-sidecars-from-ref",
        metavar="GIT_REF",
        help="restore each sidecar's exact historical indentation/order, then apply current lashFollowR8 hashes",
    )
    args = parser.parse_args()
    actors = tuple(args.actor) if args.actor else ACTORS
    failures = []
    for actor in actors:
        glb = args.directory / actor
        sidecar = glb.with_suffix(".provenance.json")
        source_sidecar_text = None
        if args.source_ref:
            glb_relative = glb.resolve().relative_to(Path.cwd().resolve()).as_posix()
            sidecar_relative = sidecar.resolve().relative_to(Path.cwd().resolve()).as_posix()
            raw = subprocess.check_output(["git", "show", f"{args.source_ref}:{glb_relative}"], cwd=Path.cwd())
            source_sidecar_text = subprocess.check_output(
                ["git", "show", f"{args.source_ref}:{sidecar_relative}"], cwd=Path.cwd()
            ).decode("utf-8")
        else:
            raw = glb.read_bytes()
        input_sha256 = hashlib.sha256(raw).hexdigest()
        try:
            if args.repair_sidecars_from_ref:
                repair_sidecar_from_ref(glb, sidecar, args.repair_sidecars_from_ref)
                print(f"LASH_SIDECAR_REPAIRED {actor} from={args.repair_sidecars_from_ref}")
                continue
            output, metadata = patch_bytes(raw, actor)
            provenance = sidecar_bytes(sidecar, output, input_sha256, metadata, source_sidecar_text)
            atomic_pair(glb, output, sidecar, provenance)
            print(
                f"LASH_REPACK {actor} {input_sha256[:12]}->"
                f"{hashlib.sha256(output).hexdigest()[:12]} bytes={len(raw)}->{len(output)} "
                f"oldPositionBufferViewUsers={metadata['oldPositionBufferViewUsers']}"
            )
        except Exception as exc:  # preserve this actor's GLB and sidecar
            failures.append((actor, str(exc)))
            print(f"LASH_REPACK_FAILED {actor}: {exc}")
    if failures:
        print("LASH_REPACK_FAILURES " + json.dumps(failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
