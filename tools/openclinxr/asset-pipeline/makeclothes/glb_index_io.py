#!/usr/bin/env python3
"""glb_index_io.py — shared GLB index-only helpers for the hide/unhide pair.

Single definition of the byte-level GLB read/write/decode used by
rehide-poking-skin.py and unhide-neckline-opening.py (which previously
carried identical copies), plus the append-index primitive writer both
index-only moves share: append each flat index array as its own 4-aligned
bufferView + SCALAR accessor, return {key: accessor_index}.

Index-only contract (both callers): no POSITION/NORMAL/TEXCOORD/JOINTS/
WEIGHTS bytes and no morph-target bytes are added or altered; only index
accessors/views are appended.
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import numpy as np

GLB_MAGIC = 0x46546C67
COMP_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMP_FMT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "i", 5126: "f"}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4,
         "MAT2": 4, "MAT3": 9, "MAT4": 16}
HIDDEN_PREFIX = "openclinxr_hidden_"


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_glb(path: str) -> tuple[dict, bytes]:
    raw = Path(path).read_bytes()
    if struct.unpack("<I", raw[0:4])[0] != GLB_MAGIC:
        raise ValueError(f"not a GLB: {path}")
    json_len = struct.unpack("<I", raw[12:16])[0]
    doc = json.loads(raw[20 : 20 + json_len].decode("utf8"))
    bin_len = struct.unpack("<I", raw[20 + json_len : 24 + json_len])[0]
    binary = raw[28 + json_len : 28 + json_len + bin_len]
    if len(binary) != bin_len:
        raise ValueError(f"truncated BIN chunk in {path}")
    return doc, binary


def write_glb(path: str, doc: dict, binary: bytes) -> None:
    json_bytes = json.dumps(doc, separators=(",", ":")).encode("utf8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    pad = (-len(binary)) % 4
    binary = binary + b"\x00" * pad
    header = struct.pack("<III", GLB_MAGIC, 2, 12 + 8 + len(json_bytes) + 8 + len(binary))
    out = (
        header
        + struct.pack("<II", len(json_bytes), 0x4E4F534A)
        + json_bytes
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )
    Path(path).write_bytes(out)


def decode(doc: dict, binary: bytes, accessor_index: int) -> np.ndarray:
    a = doc["accessors"][accessor_index]
    view = doc["bufferViews"][a["bufferView"]]
    base = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    fmt, ncomp, n = COMP_FMT[a["componentType"]], NCOMP[a["type"]], a["count"]
    size = COMP_SIZE[a["componentType"]]
    stride = view.get("byteStride")
    if stride is None or stride == ncomp * size:
        arr = np.frombuffer(binary, dtype=np.dtype("<" + fmt), count=n * ncomp, offset=base)
        return np.array(arr).reshape(n, ncomp)
    raw = np.frombuffer(binary, dtype=np.uint8, count=n * stride, offset=base).reshape(n, stride)
    out = np.empty((n, ncomp), dtype=np.float64 if fmt == "f" else np.int64)
    for c in range(ncomp):
        out[:, c] = raw[:, c * size : (c + 1) * size].copy().view(np.dtype("<" + fmt)).reshape(n)
    return out


def find_mesh(doc: dict, token: str) -> dict:
    matches = [m for m in doc.get("meshes", []) if token in str(m.get("name", ""))]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one mesh containing {token!r}, found {len(matches)}")
    return matches[0]


def append_index_arrays(out_doc: dict, out_bin: bytearray,
                        index_arrays: dict[str, np.ndarray],
                        src_ctype: int) -> dict[str, int]:
    """Append each flat index array as its own 4-aligned index view+accessor.

    Mutates out_doc (bufferViews/accessors) and out_bin in place. Returns
    {key: new accessor index}. Byte-identical to the inline writer both
    hide/unhide tools carried before the F12 dedup.
    """
    new_acc: dict[str, int] = {}
    for key, flat in index_arrays.items():
        while len(out_bin) % 4:
            out_bin.append(0)
        payload = flat.astype(np.int64).astype("<u2" if src_ctype == 5123 else "<u4").tobytes()
        byte_offset = len(out_bin)
        out_bin.extend(payload)
        view_index = len(out_doc["bufferViews"])
        out_doc["bufferViews"].append(
            {"buffer": 0, "byteOffset": byte_offset, "byteLength": len(payload), "target": 34963}
        )
        acc_index = len(out_doc["accessors"])
        out_doc["accessors"].append(
            {
                "bufferView": view_index,
                "byteOffset": 0,
                "componentType": src_ctype,
                "count": int(flat.size),
                "type": "SCALAR",
                "min": [int(flat.min())],
                "max": [int(flat.max())],
            }
        )
        new_acc[key] = acc_index
    return new_acc
