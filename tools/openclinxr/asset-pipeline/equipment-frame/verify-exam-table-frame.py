"""Strict fail-closed structural audit for the pure-wrapper frame candidate.

Checks (explicit if/raise, no assert):
- GLB magic b'glTF', version 2, header length == file size, chunk bounds,
  first chunk JSON, JSON 4-aligned, every chunk header in-bounds, chunk
  types in {JSON, BIN}, entire original post-JSON chunk stream byte-exact.
- Source SHA matches expected input SHA.
- Scene dict unchanged except nodes==[appendedIndex]; scene count 1, no
  extra scene keys beyond original.
- Original node dicts identical (deep equality); exactly one appended node
  with exact keys {children,name,rotation}, exact name, exact +90Y
  quaternion values, children == original roots.
- Every other original JSON subtree deep-exact (all top-level keys outside
  nodes/scenes, plus accessors/bufferViews/buffers/meshes/materials/images/
  textures/samplers/animations/skins/extensions*).

CLI: SRC_CAND? usage: verify-exam-table-frame.py SRC_GLB CAND_GLB OUT_JSON
"""
from __future__ import annotations
import hashlib
import json
import struct
import sys
from pathlib import Path

SRC_SHA = "a66a8fff1e2ff4a4662ba90554ca59eae6b375ab09263fe2e6ae862a6fd3f335"
WRAPPER_NAME = "frame_pure_wrapper_longZ_to_longX"
WRAPPER_ROTATION = [0.0, 0.7071067811865475, 0.0, 0.7071067811865476]


def fail(msg: str) -> None:
    raise SystemExit(f"FAIL: {msg}")


def parse_glb(raw: bytes):
    if len(raw) < 20:
        fail("GLB too short")
    if raw[:4] != b"glTF":
        fail("bad magic")
    if struct.unpack("<I", raw[4:8])[0] != 2:
        fail("unsupported version")
    if struct.unpack("<I", raw[8:12])[0] != len(raw):
        fail("header length mismatch")
    jlen = struct.unpack("<I", raw[12:16])[0]
    if raw[16:20] != b"JSON":
        fail("first chunk not JSON")
    if jlen % 4 != 0:
        fail("JSON chunk unaligned")
    if 20 + jlen > len(raw):
        fail("JSON chunk overruns file")
    js = json.loads(raw[20:20 + jlen].decode("utf-8"))
    off = 20 + jlen
    chunks = []
    while off < len(raw):
        if off + 8 > len(raw):
            fail("truncated chunk header")
        clen = struct.unpack("<I", raw[off:off + 4])[0]
        ctype = raw[off + 4:off + 8]
        if ctype not in (b"JSON", b"BIN\x00"):
            fail(f"unknown chunk type {ctype!r}")
        if off + 8 + clen > len(raw):
            fail("chunk overruns file")
        chunks.append((ctype, raw[off:off + 8 + clen]))
        off += 8 + clen
    return js, jlen, chunks, raw[20 + jlen:]


def main() -> None:
    src, cand, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    sraw = Path(src).read_bytes()
    craw = Path(cand).read_bytes()
    if hashlib.sha256(sraw).hexdigest() != SRC_SHA:
        fail("source SHA mismatch")
    sjs, _, _, srest = parse_glb(sraw)
    cjs, _, _, crest = parse_glb(craw)
    if srest != crest:
        fail("post-JSON chunk stream drift")
    if not isinstance(sjs.get("scenes"), list) or len(sjs["scenes"]) != 1:
        fail("source scene count != 1")
    if not isinstance(cjs.get("scenes"), list) or len(cjs["scenes"]) != 1:
        fail("candidate scene count != 1")
    ssc, csc = sjs["scenes"][0], cjs["scenes"][0]
    if set(csc.keys()) != set(ssc.keys()):
        fail(f"scene keys changed: {sorted(ssc)} vs {sorted(csc)}")
    for k in ssc:
        if k == "nodes":
            continue
        if csc[k] != ssc[k]:
            fail(f"scene extra {k} drift")
    if not isinstance(sjs.get("nodes"), list) or not isinstance(cjs.get("nodes"), list):
        fail("nodes not lists")
    if len(cjs["nodes"]) != len(sjs["nodes"]) + 1:
        fail("must append exactly one node")
    if cjs["nodes"][:-1] != sjs["nodes"]:
        fail("original node dicts changed")
    wrap = cjs["nodes"][-1]
    if set(wrap.keys()) != {"children", "name", "rotation"}:
        fail(f"wrapper extra keys: {sorted(wrap.keys())}")
    if wrap.get("name") != WRAPPER_NAME:
        fail("wrapper name wrong")
    if wrap.get("rotation") != WRAPPER_ROTATION:
        fail(f"wrapper rotation wrong: {wrap.get('rotation')!r}")
    if wrap.get("children") != list(ssc.get("nodes", [])):
        fail("wrapper children must equal original roots")
    if csc.get("nodes") != [len(sjs["nodes"])]:
        fail("scene roots must be [wrapperIndex]")
    for key in set(sjs) | set(cjs):
        if key in ("nodes", "scenes"):
            continue
        if cjs.get(key) != sjs.get(key):
            fail(f"top-level {key} drift")
    out = {"ok": True,
           "candidateSha": hashlib.sha256(craw).hexdigest(),
           "sourceSha": SRC_SHA,
           "binStreamBytes": len(srest),
           "origNodes": len(sjs["nodes"]), "newNodes": len(cjs["nodes"])}
    print(json.dumps(out))
    Path(outp).write_text(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
