#!/usr/bin/env python3
"""Transplant one fitted eyebrow mesh between two GLBs of the same actor.

Only the shipped eyebrow primitive's accessors are replaced.  Donor joint
indices are translated through skin-joint node names, and all retained source
bufferView payloads remain byte-identical.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import struct
from pathlib import Path
from typing import Any


STAGE = "actor_brow_transplant_post_export_v1"
TOOL = "tools/openclinxr/asset-pipeline/makeclothes/transplant_fitted_brow.py"
CAUSE_COMMIT = "0f1d0b9c6"
BROW_TOKEN = "openclinxr_fitted_eyebrow_"
ATTRIBUTES = ("POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0")
COMPONENT_FORMAT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
TYPE_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_glb(path: Path) -> tuple[dict[str, Any], bytes, bytes]:
    raw = path.read_bytes()
    if len(raw) < 28 or raw[:4] != b"glTF" or struct.unpack_from("<I", raw, 4)[0] != 2:
        raise RuntimeError(f"{path}: expected GLB v2")
    if struct.unpack_from("<I", raw, 8)[0] != len(raw):
        raise RuntimeError(f"{path}: GLB length header does not match file")
    json_length, json_type = struct.unpack_from("<II", raw, 12)
    if json_type != 0x4E4F534A:
        raise RuntimeError(f"{path}: first GLB chunk is not JSON")
    document = json.loads(raw[20 : 20 + json_length])
    bin_header = 20 + json_length
    bin_length, bin_type = struct.unpack_from("<II", raw, bin_header)
    if bin_type != 0x004E4942 or bin_header + 8 + bin_length != len(raw):
        raise RuntimeError(f"{path}: expected exactly one trailing BIN chunk")
    return document, raw[bin_header + 8 :], raw


def encode_glb(document: dict[str, Any], binary: bytes) -> bytes:
    json_bytes = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    return b"".join(
        (
            b"glTF",
            struct.pack("<II", 2, total),
            struct.pack("<II", len(json_bytes), 0x4E4F534A),
            json_bytes,
            struct.pack("<II", len(binary), 0x004E4942),
            binary,
        )
    )


def find_brow(document: dict[str, Any]) -> tuple[int, dict[str, Any], int]:
    matches = [
        (index, mesh)
        for index, mesh in enumerate(document.get("meshes", []))
        if BROW_TOKEN in str(mesh.get("name", ""))
    ]
    if len(matches) != 1:
        raise RuntimeError(f"expected one fitted eyebrow mesh, found {len(matches)}")
    mesh_index, mesh = matches[0]
    primitives = mesh.get("primitives", [])
    if len(primitives) != 1:
        raise RuntimeError("fitted eyebrow mesh must have exactly one primitive")
    nodes = [
        node for node in document.get("nodes", []) if node.get("mesh") == mesh_index
    ]
    if len(nodes) != 1 or "skin" not in nodes[0]:
        raise RuntimeError("fitted eyebrow mesh must have exactly one skinned node")
    return mesh_index, mesh, int(nodes[0]["skin"])


def brow_accessor_indices(mesh: dict[str, Any]) -> list[int]:
    primitive = mesh["primitives"][0]
    attributes = primitive.get("attributes", {})
    if set(attributes) != set(ATTRIBUTES):
        raise RuntimeError(f"unexpected eyebrow attributes: {sorted(attributes)}")
    result = [int(primitive["indices"]), *(int(attributes[name]) for name in ATTRIBUTES)]
    for target in primitive.get("targets", []):
        for name in sorted(target):
            result.append(int(target[name]))
    return result


def referenced_views(accessor: dict[str, Any]) -> set[int]:
    result: set[int] = set()
    if "bufferView" in accessor:
        result.add(int(accessor["bufferView"]))
    sparse = accessor.get("sparse")
    if sparse:
        result.add(int(sparse["indices"]["bufferView"]))
        result.add(int(sparse["values"]["bufferView"]))
    return result


def view_bytes(document: dict[str, Any], binary: bytes, view_index: int) -> bytes:
    view = document["bufferViews"][view_index]
    start = int(view.get("byteOffset", 0))
    end = start + int(view["byteLength"])
    if end > len(binary):
        raise RuntimeError(f"bufferView {view_index} exceeds BIN chunk")
    return binary[start:end]


def element_width(accessor: dict[str, Any]) -> int:
    try:
        return struct.calcsize("<" + COMPONENT_FORMAT[int(accessor["componentType"])]) * TYPE_COMPONENTS[str(accessor["type"])]
    except KeyError as error:
        raise RuntimeError(f"unsupported accessor layout: {accessor}") from error


def dense_accessor_bytes(document: dict[str, Any], binary: bytes, accessor: dict[str, Any]) -> bytes:
    if "bufferView" not in accessor:
        raise RuntimeError("accessor has no dense bufferView")
    view = document["bufferViews"][int(accessor["bufferView"])]
    width = element_width(accessor)
    stride = int(view.get("byteStride", width))
    if stride < width:
        raise RuntimeError("bufferView byteStride is smaller than accessor element")
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    count = int(accessor["count"])
    if count == 0:
        return b""
    end = start + (count - 1) * stride + width
    if end > len(binary):
        raise RuntimeError("accessor exceeds BIN chunk")
    return b"".join(binary[start + index * stride : start + index * stride + width] for index in range(count))


def slice_view_range(
    document: dict[str, Any], binary: bytes, reference: dict[str, Any], length: int
) -> bytes:
    view = document["bufferViews"][int(reference["bufferView"])]
    start = int(view.get("byteOffset", 0)) + int(reference.get("byteOffset", 0))
    end = start + length
    if end > int(view.get("byteOffset", 0)) + int(view["byteLength"]):
        raise RuntimeError("sparse accessor range exceeds bufferView")
    return binary[start:end]


def skin_joint_names(document: dict[str, Any], skin_index: int) -> list[str]:
    skin = document["skins"][skin_index]
    names: list[str] = []
    for node_index in skin.get("joints", []):
        name = str(document["nodes"][int(node_index)].get("name", ""))
        if not name:
            raise RuntimeError("skin joint node has no name")
        names.append(name)
    if len(names) != len(set(names)):
        raise RuntimeError("skin joint node names are not unique")
    return names


def remap_joint_bytes(
    payload: bytes, accessor: dict[str, Any], source_names: list[str], target_names: list[str]
) -> bytes:
    missing = sorted(set(source_names) - set(target_names))
    if missing:
        raise RuntimeError(f"bake skin joint names missing from shipped skin: {missing}")
    target_by_name = {name: index for index, name in enumerate(target_names)}
    mapping = [target_by_name[name] for name in source_names]
    component_type = int(accessor["componentType"])
    if component_type not in (5121, 5123):
        raise RuntimeError("JOINTS_0 must use unsigned byte or unsigned short components")
    code = COMPONENT_FORMAT[component_type]
    count = int(accessor["count"]) * TYPE_COMPONENTS[str(accessor["type"])]
    values = list(struct.unpack(f"<{count}{code}", payload))
    try:
        remapped = [mapping[int(value)] for value in values]
    except IndexError as error:
        raise RuntimeError("JOINTS_0 references a joint outside the bake skin") from error
    maximum = 255 if component_type == 5121 else 65535
    if any(value > maximum for value in remapped):
        raise RuntimeError("remapped joint index exceeds JOINTS_0 component capacity")
    return struct.pack(f"<{count}{code}", *remapped)


def remap_buffer_view_keys(value: Any, mapping: dict[int, int]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "bufferView":
                old = int(child)
                if old not in mapping:
                    raise RuntimeError(f"dropped bufferView {old} still has a non-brow reference")
                value[key] = mapping[old]
            else:
                remap_buffer_view_keys(child, mapping)
    elif isinstance(value, list):
        for child in value:
            remap_buffer_view_keys(child, mapping)


def body_target_names(document: dict[str, Any]) -> set[str]:
    candidates = []
    for mesh in document.get("meshes", []):
        names = mesh.get("extras", {}).get("targetNames", [])
        if names and "body" in str(mesh.get("name", "")).lower():
            candidates.append(set(str(name) for name in names))
    if len(candidates) != 1:
        raise RuntimeError(f"expected one body mesh with targetNames, found {len(candidates)}")
    return candidates[0]


def transplant(
    shipped_document: dict[str, Any],
    shipped_binary: bytes,
    bake_document: dict[str, Any],
    bake_binary: bytes,
) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    output = copy.deepcopy(shipped_document)
    shipped_mesh_index, shipped_mesh, shipped_skin_index = find_brow(output)
    source_brow_mesh_name = str(shipped_mesh["name"])
    _, bake_mesh, bake_skin_index = find_brow(bake_document)
    old_accessor_indices = brow_accessor_indices(shipped_mesh)

    donor_targets = bake_mesh["primitives"][0].get("targets", [])
    donor_target_names = [str(name) for name in bake_mesh.get("extras", {}).get("targetNames", [])]
    if len(donor_targets) != len(donor_target_names):
        raise RuntimeError("bake eyebrow targetNames do not match target count")
    missing_targets = sorted(set(donor_target_names) - body_target_names(output))
    carry_targets = bool(donor_targets) and not missing_targets

    donor_primitive = bake_mesh["primitives"][0]
    donor_refs = [
        int(donor_primitive["indices"]),
        *(int(donor_primitive["attributes"][name]) for name in ATTRIBUTES),
    ]
    donor_target_shapes: list[dict[str, int]] = []
    if carry_targets:
        for target in donor_targets:
            donor_target_shapes.append({name: int(target[name]) for name in sorted(target)})
            donor_refs.extend(donor_target_shapes[-1].values())

    while len(old_accessor_indices) < len(donor_refs):
        output.setdefault("accessors", []).append({})
        old_accessor_indices.append(len(output["accessors"]) - 1)
    replacement_slots = old_accessor_indices[: len(donor_refs)]
    brow_slots = set(replacement_slots)
    old_brow_views = set().union(
        *(referenced_views(output["accessors"][index]) for index in brow_slots)
    )
    for index in brow_slots:
        output["accessors"][index] = {}

    retained_views: list[dict[str, Any]] = []
    retained_payloads: list[bytes] = []
    view_mapping: dict[int, int] = {}
    identity_rows: list[dict[str, Any]] = []
    for old_index, view in enumerate(output.get("bufferViews", [])):
        payload = view_bytes(shipped_document, shipped_binary, old_index)
        if old_index in old_brow_views:
            # A candidate view is dropped only if the document has no remaining reference.
            sentinel_mapping = {index: index for index in range(len(output["bufferViews"])) if index != old_index}
            probe = copy.deepcopy(output)
            probe["bufferViews"] = []
            try:
                remap_buffer_view_keys(probe, sentinel_mapping)
            except RuntimeError:
                pass
            else:
                continue
        new_index = len(retained_views)
        view_mapping[old_index] = new_index
        retained_views.append(copy.deepcopy(view))
        retained_payloads.append(payload)
        identity_rows.append(
            {"oldIndex": old_index, "newIndex": new_index, "bytes": len(payload), "sha256": sha256(payload)}
        )

    output["bufferViews"] = retained_views
    remap_buffer_view_keys(output, view_mapping)
    appended_payloads: list[bytes] = []

    def append_view(payload: bytes, template: dict[str, Any] | None = None) -> int:
        view: dict[str, Any] = {"buffer": 0, "byteLength": len(payload)}
        if template and "target" in template:
            view["target"] = template["target"]
        index = len(output["bufferViews"])
        output["bufferViews"].append(view)
        appended_payloads.append(payload)
        return index

    source_joint_names = skin_joint_names(bake_document, bake_skin_index)
    target_joint_names = skin_joint_names(output, shipped_skin_index)

    for source_index, target_index in zip(donor_refs, replacement_slots, strict=True):
        source_accessor = copy.deepcopy(bake_document["accessors"][source_index])
        if source_accessor.get("sparse"):
            sparse = source_accessor["sparse"]
            index_code = COMPONENT_FORMAT[int(sparse["indices"]["componentType"])]
            index_length = int(sparse["count"]) * struct.calcsize("<" + index_code)
            value_length = int(sparse["count"]) * element_width(source_accessor)
            index_payload = slice_view_range(bake_document, bake_binary, sparse["indices"], index_length)
            value_payload = slice_view_range(bake_document, bake_binary, sparse["values"], value_length)
            sparse["indices"]["bufferView"] = append_view(index_payload)
            sparse["indices"].pop("byteOffset", None)
            sparse["values"]["bufferView"] = append_view(value_payload)
            sparse["values"].pop("byteOffset", None)
            source_accessor.pop("bufferView", None)
            source_accessor.pop("byteOffset", None)
        else:
            payload = dense_accessor_bytes(bake_document, bake_binary, source_accessor)
            if source_index == int(donor_primitive["attributes"]["JOINTS_0"]):
                payload = remap_joint_bytes(payload, source_accessor, source_joint_names, target_joint_names)
            template = bake_document["bufferViews"][int(source_accessor["bufferView"])]
            source_accessor["bufferView"] = append_view(payload, template)
            source_accessor.pop("byteOffset", None)
        output["accessors"][target_index] = source_accessor

    primitive = output["meshes"][shipped_mesh_index]["primitives"][0]
    primitive["indices"] = replacement_slots[0]
    primitive["attributes"] = dict(zip(ATTRIBUTES, replacement_slots[1:6], strict=True))
    primitive["material"] = shipped_mesh["primitives"][0]["material"]
    if carry_targets:
        cursor = 6
        primitive["targets"] = []
        for shape in donor_target_shapes:
            target: dict[str, int] = {}
            for name in shape:
                target[name] = replacement_slots[cursor]
                cursor += 1
            primitive["targets"].append(target)
        output["meshes"][shipped_mesh_index]["weights"] = copy.deepcopy(bake_mesh.get("weights", [0] * len(donor_targets)))
        output["meshes"][shipped_mesh_index]["extras"] = {"targetNames": donor_target_names}
    else:
        primitive.pop("targets", None)
        output["meshes"][shipped_mesh_index].pop("weights", None)
        output["meshes"][shipped_mesh_index].pop("extras", None)
    output["meshes"][shipped_mesh_index]["name"] = bake_mesh["name"]

    binary_parts: list[bytes] = []
    for view, payload in zip(output["bufferViews"], [*retained_payloads, *appended_payloads], strict=True):
        padding = -sum(len(part) for part in binary_parts) % 4
        if padding:
            binary_parts.append(b"\0" * padding)
        view["byteOffset"] = sum(len(part) for part in binary_parts)
        binary_parts.append(payload)
    output_binary = b"".join(binary_parts)
    output["buffers"][0]["byteLength"] = len(output_binary)
    report = {
        "sourceBrowMesh": source_brow_mesh_name,
        "bakeBrowMesh": bake_mesh["name"],
        "carriedMorphTargets": donor_target_names if carry_targets else [],
        "droppedMorphTargets": donor_target_names if missing_targets else [],
        "missingBodyTargetNames": missing_targets,
        "nonBrowBufferViews": identity_rows,
        "nonBrowBufferViewsIdentical": len(identity_rows),
        "droppedBrowOnlyBufferViews": sorted(set(range(len(shipped_document["bufferViews"]))) - set(view_mapping)),
        "jointRemap": {"sourceJoints": len(source_joint_names), "targetJoints": len(target_joint_names)},
    }
    return output, output_binary, report


def write_provenance(
    source_path: Path,
    output_path: Path,
    output_glb: Path,
    record: dict[str, Any],
    output_sha: str,
    output_bytes: int,
) -> None:
    provenance = json.loads(source_path.read_text(encoding="utf-8"))
    provenance["outputSha256"] = output_sha
    provenance["outputBytes"] = output_bytes
    provenance["actorBrowTransplantPostExport"] = record
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(provenance, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--bake", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--provenance", type=Path)
    parser.add_argument("--output-provenance", type=Path)
    parser.add_argument("--style", required=True)
    parser.add_argument("--budget", type=int, required=True)
    parser.add_argument("--cells", type=int, required=True)
    parser.add_argument("--ink", type=float, required=True)
    parser.add_argument("--no-provenance", action="store_true")
    args = parser.parse_args()

    shipped_document, shipped_binary, shipped_raw = parse_glb(args.input)
    bake_document, bake_binary, bake_raw = parse_glb(args.bake)
    output_document, output_binary, report = transplant(
        shipped_document, shipped_binary, bake_document, bake_binary
    )
    output_raw = encode_glb(output_document, output_binary)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output_raw)
    record = {
        "stage": STAGE,
        "tool": TOOL,
        "inputGlbSha256": sha256(shipped_raw),
        "bakeGlbSha256": sha256(bake_raw),
        "outputGlbSha256": sha256(output_raw),
        "outputBytes": len(output_raw),
        "style": args.style,
        "budget": args.budget,
        "cells": args.cells,
        "ink": args.ink,
        "causeCommit": CAUSE_COMMIT,
        "contract": report,
    }
    if not args.no_provenance:
        provenance = args.provenance or args.input.with_suffix(".provenance.json")
        output_provenance = args.output_provenance or args.output.with_suffix(".provenance.json")
        write_provenance(
            provenance,
            output_provenance,
            args.output,
            record,
            sha256(output_raw),
            len(output_raw),
        )
    print(json.dumps({"changed": output_raw != shipped_raw, "stage": record, "output": str(args.output)}, indent=1))


if __name__ == "__main__":
    main()
