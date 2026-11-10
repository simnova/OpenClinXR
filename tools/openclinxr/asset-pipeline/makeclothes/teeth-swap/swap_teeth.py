#!/usr/bin/env python3
"""Append-only transplant of fitted CC0 teeth and tongue into a shipped MPFB GLB."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import struct
from pathlib import Path
from typing import Any

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[5]
TOOL = "tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/swap_teeth.py"
SCHEMA = "openclinxr-teeth-swap-report.v1"
EXPECTED_IMAGE_SHA256 = {
    # materialize_mpfb_humanoid_candidate.py:317-337 declares these staged CC0 assets.
    "teeth": "d0afb57869c6fbb56b98f5efc4aec629ee7593e70d8dd2bfb9de923acfb65f43",
    "tongue": "3150be398e48e8ba1feac164c3143c16c0b2e959d9ffb6155f0171f59cfb4ea9",
}
SHIPPED_TOKEN = {
    "teeth": "openclinxr_hm08_teeth",
    "tongue": "openclinxr_hm08_tongue",
}
DONOR_TOKEN = {
    "teeth": "openclinxr_fitted_teeth",
    "tongue": "openclinxr_fitted_tongue",
}


def _load_glb_helpers():
    """Reuse the repo's existing GLB surgery helpers; do not fork their parser."""
    helper_path = (
        REPO_ROOT
        / "tools/openclinxr/asset-pipeline/makeclothes/transplant_fitted_brow.py"
    )
    spec = importlib.util.spec_from_file_location("openclinxr_glb_transplant_helpers", helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load GLB helper module: {helper_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GLB = _load_glb_helpers()


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


def misaligned_accessor_count(document: dict[str, Any]) -> int:
    """Accessors whose start breaks glTF 2.0 3.6.2.4 (offset % component size != 0)."""
    views = document.get("bufferViews", [])

    def start(ref: dict[str, Any]) -> int:
        return int(views[int(ref["bufferView"])].get("byteOffset", 0)) + int(ref.get("byteOffset", 0))

    count = 0
    for accessor in document.get("accessors", []):
        size = COMPONENT_BYTES[int(accessor["componentType"])]
        if "bufferView" in accessor and start(accessor) % size:
            count += 1
        sparse = accessor.get("sparse")
        if sparse:
            if start(sparse["indices"]) % COMPONENT_BYTES[int(sparse["indices"]["componentType"])]:
                count += 1
            if start(sparse["values"]) % size:
                count += 1
    return count


def relayout_aligned(
    document: dict[str, Any], binary: bytes
) -> tuple[dict[str, Any], bytes, dict[str, Any] | None]:
    """Copy every bufferView to a 4-byte-aligned start when the input breaks alignment.

    Runs only on a misaligned input (e.g. the physician since 20f073984); an aligned input
    is returned unchanged so its output stays byte-identical to the append-only path.
    Bytes inside each view are copied verbatim, so decoded accessor values do not move.
    """
    views = document.get("bufferViews", [])
    misaligned_views = sum(1 for view in views if int(view.get("byteOffset", 0)) % 4)
    misaligned_before = misaligned_accessor_count(document)
    if misaligned_views == 0 and misaligned_before == 0:
        return document, binary, None
    if any(int(view.get("buffer", 0)) != 0 for view in views):
        raise RuntimeError("aligned relayout supports a single GLB BIN buffer only")
    out_document = copy.deepcopy(document)
    out = bytearray()
    for view in out_document["bufferViews"]:
        while len(out) % 4:
            out.append(0)
        begin = int(view.get("byteOffset", 0))
        payload = binary[begin : begin + int(view["byteLength"])]
        if len(payload) != int(view["byteLength"]):
            raise RuntimeError("bufferView runs past the BIN chunk; refusing relayout")
        view["byteOffset"] = len(out)
        out.extend(payload)
    while len(out) % 4:
        out.append(0)
    misaligned_after = misaligned_accessor_count(out_document)
    if misaligned_after:
        raise RuntimeError(f"aligned relayout left {misaligned_after} misaligned accessors")
    out_document["buffers"][0]["byteLength"] = len(out)
    record = {
        "applied": True,
        "inputBinSha256": sha256(binary),
        "misalignedViewsBefore": misaligned_views,
        "misalignedAccessorsBefore": misaligned_before,
        "misalignedAccessorsAfter": 0,
        "relaidBinBytes": len(out),
    }
    return out_document, bytes(out), record


def _feature_match(
    document: dict[str, Any], token: str, label: str
) -> tuple[int, dict[str, Any], int, dict[str, Any]]:
    matches = [
        (index, mesh)
        for index, mesh in enumerate(document.get("meshes", []))
        if token in str(mesh.get("name", "")).lower()
    ]
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one {token} mesh for {label}, found {len(matches)}")
    mesh_index, mesh = matches[0]
    nodes = [node for node in document.get("nodes", []) if node.get("mesh") == mesh_index]
    if len(nodes) != 1 or "skin" not in nodes[0]:
        raise RuntimeError(f"{label} mesh must occupy exactly one skinned node slot")
    return mesh_index, mesh, int(nodes[0]["skin"]), nodes[0]


def _mouth_mesh_counts(document: dict[str, Any]) -> dict[str, dict[str, int]]:
    return {
        feature: {
            "hm08": sum(
                SHIPPED_TOKEN[feature] in str(mesh.get("name", "")).lower()
                for mesh in document.get("meshes", [])
            ),
            "fitted": sum(
                DONOR_TOKEN[feature] in str(mesh.get("name", "")).lower()
                for mesh in document.get("meshes", [])
            ),
        }
        for feature in ("teeth", "tongue")
    }


def _mouth_input_state(document: dict[str, Any]) -> tuple[str, dict[str, dict[str, int]]]:
    counts = _mouth_mesh_counts(document)
    if all(counts[feature] == {"hm08": 1, "fitted": 0} for feature in counts):
        return "swap", counts
    if all(counts[feature] == {"hm08": 0, "fitted": 1} for feature in counts):
        return "already-fitted", counts
    detail = ", ".join(
        f"{feature} hm08={values['hm08']} fitted={values['fitted']}"
        for feature, values in counts.items()
    )
    raise RuntimeError(
        "shipped mouth must contain either exactly one hm08 pair or exactly one fitted pair "
        f"with no mixed meshes; found {detail}"
    )


def _primitive_accessor_rows(mesh: dict[str, Any]) -> list[tuple[str, int]]:
    rows: list[tuple[str, int]] = []
    for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
        if "indices" in primitive:
            rows.append((f"primitive[{primitive_index}].indices", int(primitive["indices"])))
        for semantic, accessor_index in sorted(primitive.get("attributes", {}).items()):
            rows.append((f"primitive[{primitive_index}].attributes.{semantic}", int(accessor_index)))
        for target_index, target in enumerate(primitive.get("targets", [])):
            for semantic, accessor_index in sorted(target.items()):
                rows.append(
                    (f"primitive[{primitive_index}].targets[{target_index}].{semantic}", int(accessor_index))
                )
    return rows


def _accessor_payload(document: dict[str, Any], binary: bytes, accessor_index: int) -> bytes:
    accessor = document["accessors"][accessor_index]
    if accessor.get("sparse"):
        sparse = accessor["sparse"]
        index_code = GLB.COMPONENT_FORMAT[int(sparse["indices"]["componentType"])]
        index_bytes = GLB.slice_view_range(
            document,
            binary,
            sparse["indices"],
            int(sparse["count"]) * struct.calcsize("<" + index_code),
        )
        value_bytes = GLB.slice_view_range(
            document,
            binary,
            sparse["values"],
            int(sparse["count"]) * GLB.element_width(accessor),
        )
        base = b"" if "bufferView" not in accessor else GLB.dense_accessor_bytes(document, binary, accessor)
        return b"SPARSE\0" + base + b"\0" + index_bytes + b"\0" + value_bytes
    if "bufferView" not in accessor:
        # glTF 2.0 3.6.2.3: an accessor with neither bufferView nor sparse is all zeros (gltf-transform
        # writes all-zero morph-target deltas this way). The descriptor hashed beside it carries count/type.
        return b"ZERO\0"
    return GLB.dense_accessor_bytes(document, binary, accessor)


def _accessor_hash(document: dict[str, Any], binary: bytes, accessor_index: int) -> str:
    accessor = document["accessors"][accessor_index]
    descriptor = {
        key: value
        for key, value in accessor.items()
        if key not in {"bufferView", "byteOffset", "sparse", "min", "max"}
    }
    return sha256(
        json.dumps(descriptor, sort_keys=True, separators=(",", ":")).encode()
        + b"\0"
        + _accessor_payload(document, binary, accessor_index)
    )


def _protected_accessor_hashes(
    document: dict[str, Any], binary: bytes, excluded_meshes: set[int]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for mesh_index, mesh in enumerate(document.get("meshes", [])):
        if mesh_index in excluded_meshes:
            continue
        for slot, accessor_index in _primitive_accessor_rows(mesh):
            rows.append(
                {
                    "meshIndex": mesh_index,
                    "meshName": str(mesh.get("name", "")),
                    "slot": slot,
                    "accessorIndex": accessor_index,
                    "sha256": _accessor_hash(document, binary, accessor_index),
                }
            )
    return rows


class Appender:
    def __init__(self, output_document: dict[str, Any], original_binary: bytes):
        self.document = output_document
        self.binary = bytearray(original_binary)
        self.accessor_cache: dict[tuple[int, bool], int] = {}
        self.image_cache: dict[int, int] = {}
        self.sampler_cache: dict[int, int] = {}
        self.texture_cache: dict[int, int] = {}
        self.material_cache: dict[int, int] = {}

    def append_view(self, payload: bytes, template: dict[str, Any] | None = None) -> int:
        while len(self.binary) % 4:
            self.binary.append(0)
        view: dict[str, Any] = {
            "buffer": 0,
            "byteOffset": len(self.binary),
            "byteLength": len(payload),
        }
        if template and "target" in template:
            view["target"] = template["target"]
        self.binary.extend(payload)
        self.document.setdefault("bufferViews", []).append(view)
        return len(self.document["bufferViews"]) - 1

    def clone_accessor(
        self,
        donor_document: dict[str, Any],
        donor_binary: bytes,
        accessor_index: int,
        source_joint_names: list[str],
        target_joint_names: list[str],
        remap_joints: bool = False,
    ) -> int:
        cache_key = (accessor_index, remap_joints)
        if cache_key in self.accessor_cache:
            return self.accessor_cache[cache_key]
        accessor = copy.deepcopy(donor_document["accessors"][accessor_index])
        if remap_joints and accessor.get("sparse"):
            raise RuntimeError("sparse JOINTS_0 is not supported; refusing an ambiguous remap")
        if accessor.get("sparse"):
            sparse = accessor["sparse"]
            index_code = GLB.COMPONENT_FORMAT[int(sparse["indices"]["componentType"])]
            index_payload = GLB.slice_view_range(
                donor_document,
                donor_binary,
                sparse["indices"],
                int(sparse["count"]) * struct.calcsize("<" + index_code),
            )
            value_payload = GLB.slice_view_range(
                donor_document,
                donor_binary,
                sparse["values"],
                int(sparse["count"]) * GLB.element_width(accessor),
            )
            sparse["indices"]["bufferView"] = self.append_view(index_payload)
            sparse["indices"].pop("byteOffset", None)
            sparse["values"]["bufferView"] = self.append_view(value_payload)
            sparse["values"].pop("byteOffset", None)
            if "bufferView" in accessor:
                base_payload = GLB.dense_accessor_bytes(donor_document, donor_binary, accessor)
                template = donor_document["bufferViews"][int(accessor["bufferView"])]
                accessor["bufferView"] = self.append_view(base_payload, template)
                accessor.pop("byteOffset", None)
        elif "bufferView" not in accessor:
            pass  # all-zero accessor (glTF 2.0 3.6.2.3): copied as a descriptor with no bytes
        else:
            payload = GLB.dense_accessor_bytes(donor_document, donor_binary, accessor)
            if remap_joints:
                payload = GLB.remap_joint_bytes(
                    payload, accessor, source_joint_names, target_joint_names
                )
            template = donor_document["bufferViews"][int(accessor["bufferView"])]
            accessor["bufferView"] = self.append_view(payload, template)
            accessor.pop("byteOffset", None)
        self.document.setdefault("accessors", []).append(accessor)
        result = len(self.document["accessors"]) - 1
        self.accessor_cache[cache_key] = result
        return result

    def clone_sampler(self, donor_document: dict[str, Any], sampler_index: int) -> int:
        if sampler_index in self.sampler_cache:
            return self.sampler_cache[sampler_index]
        sampler = copy.deepcopy(donor_document.get("samplers", [])[sampler_index])
        self.document.setdefault("samplers", []).append(sampler)
        result = len(self.document["samplers"]) - 1
        self.sampler_cache[sampler_index] = result
        return result

    def clone_image(
        self, donor_document: dict[str, Any], donor_binary: bytes, image_index: int
    ) -> int:
        if image_index in self.image_cache:
            return self.image_cache[image_index]
        image = copy.deepcopy(donor_document["images"][image_index])
        if "bufferView" in image:
            view_index = int(image["bufferView"])
            image["bufferView"] = self.append_view(
                GLB.view_bytes(donor_document, donor_binary, view_index),
                donor_document["bufferViews"][view_index],
            )
        self.document.setdefault("images", []).append(image)
        result = len(self.document["images"]) - 1
        self.image_cache[image_index] = result
        return result

    def clone_texture(
        self, donor_document: dict[str, Any], donor_binary: bytes, texture_index: int
    ) -> int:
        if texture_index in self.texture_cache:
            return self.texture_cache[texture_index]
        texture = copy.deepcopy(donor_document["textures"][texture_index])
        if "sampler" in texture:
            texture["sampler"] = self.clone_sampler(donor_document, int(texture["sampler"]))
        if "source" in texture:
            texture["source"] = self.clone_image(
                donor_document, donor_binary, int(texture["source"])
            )
        basisu = texture.get("extensions", {}).get("KHR_texture_basisu")
        if isinstance(basisu, dict) and "source" in basisu:
            basisu["source"] = self.clone_image(
                donor_document, donor_binary, int(basisu["source"])
            )
        self.document.setdefault("textures", []).append(texture)
        result = len(self.document["textures"]) - 1
        self.texture_cache[texture_index] = result
        return result

    def _clone_texture_infos(
        self, value: Any, donor_document: dict[str, Any], donor_binary: bytes
    ) -> Any:
        if isinstance(value, list):
            return [self._clone_texture_infos(item, donor_document, donor_binary) for item in value]
        if not isinstance(value, dict):
            return copy.deepcopy(value)
        result: dict[str, Any] = {}
        for key, child in value.items():
            if (
                isinstance(child, dict)
                and "index" in child
                and "texture" in key.lower()
            ):
                cloned = copy.deepcopy(child)
                cloned["index"] = self.clone_texture(
                    donor_document, donor_binary, int(child["index"])
                )
                result[key] = cloned
            else:
                result[key] = self._clone_texture_infos(child, donor_document, donor_binary)
        return result

    def clone_material(
        self, donor_document: dict[str, Any], donor_binary: bytes, material_index: int
    ) -> int:
        if material_index in self.material_cache:
            return self.material_cache[material_index]
        material = self._clone_texture_infos(
            donor_document["materials"][material_index], donor_document, donor_binary
        )
        self.document.setdefault("materials", []).append(material)
        result = len(self.document["materials"]) - 1
        self.material_cache[material_index] = result
        return result


def _clone_mesh(
    appender: Appender,
    donor_document: dict[str, Any],
    donor_binary: bytes,
    donor_mesh: dict[str, Any],
    source_joint_names: list[str],
    target_joint_names: list[str],
) -> dict[str, Any]:
    mesh = copy.deepcopy(donor_mesh)
    for primitive in mesh.get("primitives", []):
        if "indices" in primitive:
            primitive["indices"] = appender.clone_accessor(
                donor_document,
                donor_binary,
                int(primitive["indices"]),
                source_joint_names,
                target_joint_names,
            )
        primitive["attributes"] = {
            semantic: appender.clone_accessor(
                donor_document,
                donor_binary,
                int(accessor_index),
                source_joint_names,
                target_joint_names,
                remap_joints=semantic == "JOINTS_0",
            )
            for semantic, accessor_index in primitive.get("attributes", {}).items()
        }
        primitive["targets"] = [
            {
                semantic: appender.clone_accessor(
                    donor_document,
                    donor_binary,
                    int(accessor_index),
                    source_joint_names,
                    target_joint_names,
                )
                for semantic, accessor_index in target.items()
            }
            for target in primitive.get("targets", [])
        ]
        if not primitive["targets"]:
            primitive.pop("targets", None)
        if "material" in primitive:
            primitive["material"] = appender.clone_material(
                donor_document, donor_binary, int(primitive["material"])
            )
    return mesh


def _accessor_numpy(
    document: dict[str, Any], binary: bytes, accessor_index: int
) -> np.ndarray:
    accessor = document["accessors"][accessor_index]
    if accessor.get("sparse"):
        raise RuntimeError("weight report refuses sparse mouth accessors")
    component = int(accessor["componentType"])
    dtype_by_component = {
        5120: np.dtype("<i1"),
        5121: np.dtype("<u1"),
        5122: np.dtype("<i2"),
        5123: np.dtype("<u2"),
        5125: np.dtype("<u4"),
        5126: np.dtype("<f4"),
    }
    dtype = dtype_by_component[component]
    width = GLB.TYPE_COMPONENTS[str(accessor["type"])]
    payload = GLB.dense_accessor_bytes(document, binary, accessor)
    return np.frombuffer(payload, dtype=dtype).reshape(int(accessor["count"]), width).copy()


def _weight_split(
    document: dict[str, Any], binary: bytes, mesh: dict[str, Any], skin_index: int
) -> dict[str, Any]:
    names = GLB.skin_joint_names(document, skin_index)
    totals: dict[str, float] = {}
    lower: dict[str, float] = {}
    vertex_count = 0
    for primitive in mesh.get("primitives", []):
        attributes = primitive.get("attributes", {})
        for required in ("POSITION", "JOINTS_0", "WEIGHTS_0"):
            if required not in attributes:
                raise RuntimeError(f"fitted mouth primitive lacks {required}")
        positions = _accessor_numpy(document, binary, int(attributes["POSITION"])).astype(float)
        joints = _accessor_numpy(document, binary, int(attributes["JOINTS_0"])).astype(int)
        weights_accessor = document["accessors"][int(attributes["WEIGHTS_0"])]
        weights = _accessor_numpy(document, binary, int(attributes["WEIGHTS_0"])).astype(float)
        if weights_accessor.get("normalized") and int(weights_accessor["componentType"]) != 5126:
            maximum = {5121: 255.0, 5123: 65535.0}.get(int(weights_accessor["componentType"]))
            if maximum is None:
                raise RuntimeError("unsupported normalized WEIGHTS_0 component type")
            weights /= maximum
        if not (len(positions) == len(joints) == len(weights)):
            raise RuntimeError("mouth POSITION/JOINTS_0/WEIGHTS_0 counts differ")
        # glTF is Y-up; match rebind-head-locked-teeth.ts, which splits on position.y.
        y_mid = float(np.median(positions[:, 1]))
        for row, (joint_row, weight_row) in enumerate(zip(joints, weights, strict=True)):
            for joint_index, weight in zip(joint_row, weight_row, strict=True):
                if weight <= 0:
                    continue
                name = names[int(joint_index)]
                totals[name] = totals.get(name, 0.0) + float(weight)
                if positions[row, 1] <= y_mid:
                    lower[name] = lower.get(name, 0.0) + float(weight)
        vertex_count += len(positions)

    def grouped(values: dict[str, float]) -> dict[str, float]:
        denominator = sum(values.values()) or 1.0
        buckets = {"jaw": 0.0, "head": 0.0, "tongue": 0.0, "other": 0.0}
        for name, value in values.items():
            lowered = name.lower()
            key = next((candidate for candidate in ("jaw", "head", "tongue") if candidate in lowered), "other")
            buckets[key] += value
        return {key: round(value / denominator, 8) for key, value in buckets.items()}

    return {
        "vertexCount": vertex_count,
        "allVertices": grouped(totals),
        "lowerHalfByPositionY": grouped(lower),
        "topBones": [
            {"name": name, "fraction": round(value / (sum(totals.values()) or 1.0), 8)}
            for name, value in sorted(totals.items(), key=lambda item: item[1], reverse=True)[:8]
        ],
    }


def _material_image_shas(
    document: dict[str, Any], binary: bytes, mesh: dict[str, Any]
) -> list[str]:
    material_indices = {
        int(primitive["material"])
        for primitive in mesh.get("primitives", [])
        if "material" in primitive
    }
    texture_indices: set[int] = set()

    def visit(value: Any, key: str = "") -> None:
        if isinstance(value, dict):
            for child_key, child in value.items():
                if isinstance(child, dict) and "index" in child and "texture" in child_key.lower():
                    texture_indices.add(int(child["index"]))
                visit(child, child_key)
        elif isinstance(value, list):
            for child in value:
                visit(child, key)

    for material_index in material_indices:
        visit(document["materials"][material_index])
    image_indices: set[int] = set()
    for texture_index in texture_indices:
        texture = document["textures"][texture_index]
        if "source" in texture:
            image_indices.add(int(texture["source"]))
        basisu = texture.get("extensions", {}).get("KHR_texture_basisu")
        if isinstance(basisu, dict) and "source" in basisu:
            image_indices.add(int(basisu["source"]))
    result: list[str] = []
    for image_index in sorted(image_indices):
        image = document["images"][image_index]
        if "bufferView" not in image:
            raise RuntimeError("mouth texture image must be embedded in the scratch GLB")
        result.append(sha256(GLB.view_bytes(document, binary, int(image["bufferView"]))))
    return result


def inspect_scratch(path: Path) -> dict[str, Any]:
    document, binary, _ = GLB.parse_glb(path)
    result: dict[str, Any] = {}
    for feature, token in DONOR_TOKEN.items():
        _, mesh, skin_index, _ = _feature_match(document, token, feature)
        result[feature] = {
            "mesh": mesh.get("name"),
            "images": _material_image_shas(document, binary, mesh),
            "weights": _weight_split(document, binary, mesh, skin_index),
        }
    return result


def protected_hashes_of(path: Path) -> list[dict[str, Any]]:
    """Protected non-mouth accessor rows of an already-swapped GLB (fitted teeth/tongue excluded).

    Post-steps (teeth-rest-clearance, tongue-forward-place, couple) rewrite the GLB through
    gltf-transform, which renumbers accessors; derive_sidecar.ts re-pins the swap report's rows
    to the final accessor indices only when every row's sha256 is unchanged.
    """
    document, binary, _ = GLB.parse_glb(path)
    excluded = {_feature_match(document, token, feature)[0] for feature, token in DONOR_TOKEN.items()}
    return _protected_accessor_hashes(document, binary, excluded)


def swap(
    shipped_path: Path,
    scratch_path: Path,
    output_path: Path,
    report_path: Path,
    expected_image_sha256: dict[str, str] | None = None,
) -> dict[str, Any]:
    expected = expected_image_sha256 or EXPECTED_IMAGE_SHA256
    shipped_document, shipped_binary, shipped_raw = GLB.parse_glb(shipped_path)
    input_state, _ = _mouth_input_state(shipped_document)
    if input_state == "already-fitted":
        record = {
            "$schema": "report.schema.json",
            "schema": SCHEMA,
            "tool": TOOL,
            "status": "already-fitted",
            "input": {
                "path": str(shipped_path),
                "sha256": sha256(shipped_raw),
                "bytes": len(shipped_raw),
            },
        }
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return record
    scratch_document, scratch_binary, scratch_raw = GLB.parse_glb(scratch_path)
    base_document, base_binary, relayout = relayout_aligned(shipped_document, shipped_binary)
    output_document = copy.deepcopy(base_document)
    appender = Appender(output_document, base_binary)

    shipped_matches: dict[str, tuple[int, dict[str, Any], int, dict[str, Any]]] = {}
    donor_matches: dict[str, tuple[int, dict[str, Any], int, dict[str, Any]]] = {}
    for feature in ("teeth", "tongue"):
        shipped_matches[feature] = _feature_match(
            output_document, SHIPPED_TOKEN[feature], feature
        )
        donor_matches[feature] = _feature_match(
            scratch_document, DONOR_TOKEN[feature], feature
        )

    excluded = {match[0] for match in shipped_matches.values()}
    protected_before = _protected_accessor_hashes(
        shipped_document, shipped_binary, excluded
    )
    feature_report: dict[str, Any] = {}
    for feature in ("teeth", "tongue"):
        shipped_mesh_index, _, shipped_skin, shipped_node = shipped_matches[feature]
        _, donor_mesh, donor_skin, _ = donor_matches[feature]
        source_joint_names = GLB.skin_joint_names(scratch_document, donor_skin)
        target_joint_names = GLB.skin_joint_names(output_document, shipped_skin)
        missing = sorted(set(source_joint_names) - set(target_joint_names))
        if missing:
            raise RuntimeError(
                f"{feature}: scratch joints unmapped by NAME onto shipped skin: {missing}"
            )
        source_images = _material_image_shas(scratch_document, scratch_binary, donor_mesh)
        if source_images != [expected[feature]]:
            raise RuntimeError(
                f"{feature}: scratch texture image sha256 {source_images} != staged CC0 {[expected[feature]]}"
            )
        cloned_mesh = _clone_mesh(
            appender,
            scratch_document,
            scratch_binary,
            donor_mesh,
            source_joint_names,
            target_joint_names,
        )
        output_document["meshes"][shipped_mesh_index] = cloned_mesh
        shipped_node["mesh"] = shipped_mesh_index
        output_weights = _weight_split(
            output_document, bytes(appender.binary), cloned_mesh, shipped_skin
        )
        feature_report[feature] = {
            "replacedMeshIndex": shipped_mesh_index,
            "nodeSlotName": shipped_node.get("name"),
            "scratchMeshName": donor_mesh.get("name"),
            "outputMeshName": cloned_mesh.get("name"),
            "vertexCount": output_weights["vertexCount"],
            "boneWeightSplit": output_weights,
            "textureImageSha256": source_images,
            "scratchAccessorHashes": [
                {
                    "slot": slot,
                    "sha256": _accessor_hash(scratch_document, scratch_binary, accessor_index),
                }
                for slot, accessor_index in _primitive_accessor_rows(donor_mesh)
            ],
            "outputAccessorHashes": [
                {
                    "slot": slot,
                    "sha256": _accessor_hash(
                        output_document, bytes(appender.binary), accessor_index
                    ),
                }
                for slot, accessor_index in _primitive_accessor_rows(cloned_mesh)
            ],
            "jointRemap": {
                "sourceJointCount": len(source_joint_names),
                "targetJointCount": len(target_joint_names),
                "unmapped": [],
            },
        }

    output_binary = bytes(appender.binary)
    if output_binary[: len(base_binary)] != base_binary:
        raise RuntimeError("CW1 failed: original shipped BIN is not an unchanged prefix")
    output_document["buffers"][0]["byteLength"] = len(output_binary)
    output_raw = GLB.encode_glb(output_document, output_binary)
    # The imported helper parses paths, so serialized verification is done after the atomic write below.
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(output_raw)
    reparsed_document, reparsed_binary, reparsed_raw = GLB.parse_glb(output_path)
    if reparsed_binary[: len(base_binary)] != base_binary:
        raise RuntimeError("CW1 failed after serialization: original BIN prefix moved")
    if misaligned_accessor_count(reparsed_document):
        raise RuntimeError("output breaks glTF 2.0 3.6.2.4 accessor alignment")
    protected_after = _protected_accessor_hashes(reparsed_document, reparsed_binary, excluded)
    if protected_after != protected_before:
        raise RuntimeError("T3 failed: a protected non-mouth primitive accessor changed")

    record = {
        "$schema": "report.schema.json",
        "schema": SCHEMA,
        "tool": TOOL,
        "status": "swapped",
        "input": {
            "path": str(shipped_path),
            "sha256": sha256(shipped_raw),
            "bytes": len(shipped_raw),
        },
        "scratch": {
            "path": str(scratch_path),
            "sha256": sha256(scratch_raw),
            "bytes": len(scratch_raw),
        },
        "output": {
            "path": str(output_path),
            "sha256": sha256(reparsed_raw),
            "bytes": len(reparsed_raw),
        },
        "cw1OriginalBinPrefix": {
            "unchanged": True,
            "prefixBytes": len(base_binary),
            "sha256": sha256(base_binary),
        },
        "features": feature_report,
        "protectedAccessorHashes": protected_before,
    }
    if relayout is not None:
        record["alignedRelayout"] = relayout
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--scratch", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--check-scratch", type=Path)
    parser.add_argument("--protected-hashes", type=Path)
    args = parser.parse_args()
    if args.protected_hashes:
        print(json.dumps(protected_hashes_of(args.protected_hashes)))
        return
    if args.check_scratch:
        print(json.dumps(inspect_scratch(args.check_scratch), indent=2))
        return
    required = {"--input": args.input, "--scratch": args.scratch, "--output": args.output, "--report": args.report}
    missing = [flag for flag, value in required.items() if value is None]
    if missing:
        parser.error("required in swap mode: " + ", ".join(missing))
    record = swap(args.input, args.scratch, args.output, args.report)
    if record["status"] == "already-fitted":
        print(f"TEETH_SWAP_SKIP {args.input.stem} already-fitted")
        return
    print(json.dumps({"changed": record["input"]["sha256"] != record["output"]["sha256"], "report": str(args.report)}, indent=2))


if __name__ == "__main__":
    main()
