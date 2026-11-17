#!/usr/bin/env python3
"""nurse-vneck-6tri-unhide.py — P2e-C tracked 6-tri un-hide (factory stage).

Moves EXACTLY prim7 tris {2,3,4,5,6,53} from the hide mask back to skin on
the nurse GLB bytes: index-only trim of the hidden prim + ONE appended prim
reusing the source prim's attribute accessors and morph targets with the body
SKIN material; no POSITION/NORMAL/TEXCOORD/JOINTS/WEIGHTS/morph bytes added or
altered. Selection is the position-keyed faces-from fixture
(fixtures/nurse-vneck-6tri.json): each wanted tri's rest positions must match
the fixture key — no hand bytes. No selector, no depth guard, no other tri.

Run:
  python3 tools/openclinxr/evidence/skin-footprint-inpaint/scripts/nurse-vneck-6tri-unhide.py \\
    --in <glb> --out <glb> --faces-from <fixture.json> [--report <json>]

Refuses (nonzero = STOP) when: fixture is not exactly the 6 T tris; any
position-key mismatch; moved != 6; prim7 not hidden; no skin primitive; trim
would empty prim7.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "asset-pipeline" / "makeclothes"))
from glb_index_io import (  # noqa: E402
    HIDDEN_PREFIX,
    append_index_arrays,
    decode,
    read_glb,
    sha256_file,
    write_glb,
)

SCHEMA = "openclinxr.p2e-c-prod.6tri-unhide.v1"


def poskey(verts: np.ndarray) -> str:
    # Row-lexsort key (F2): the three vertex TUPLES are sorted
    # lexicographically (x, then y, then z), so a coordinate permutation
    # across vertices yields a different key. The previous per-column sort
    # was a lossy multiset key: e.g. (x1,y2,z3),(x2,y3,z1),(x3,y1,z2)
    # collided with (x1,y1,z1),(x2,y2,z2),(x3,y3,z3).
    a = np.ascontiguousarray(np.asarray(verts, dtype="<f4"))
    order = np.lexsort((a[:, 2], a[:, 1], a[:, 0]))
    return a[order].tobytes().hex()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="input", required=True)
    ap.add_argument("--out", dest="output", required=True)
    ap.add_argument("--faces-from", dest="faces_from", required=True)
    ap.add_argument("--report", dest="report", default=None)
    args = ap.parse_args(argv)

    fixture = json.loads(Path(args.faces_from).read_text())
    faces = fixture.get("faces", [])
    want = sorted(int(f["tri"]) for f in faces if int(f.get("prim", -1)) == 7)
    if want != [2, 3, 4, 5, 6, 53] or len(faces) != 6:
        print(json.dumps({"STOP": "fixture is not exactly the 6 T tris", "want": want}))
        return 1
    ref_keys = {(int(f["prim"]), int(f["tri"])): f["key"] for f in faces}
    prim_index = int(fixture.get("primIndex", 7))
    if prim_index != 7:
        print(json.dumps({"STOP": "fixture primIndex != 7"}))
        return 1

    doc, binary = read_glb(args.input)
    materials = [m.get("name", "") for m in doc.get("materials", [])]
    bodies = [m for m in doc.get("meshes", [])
              if str(m.get("name", "")).endswith("_body")
              and any("hidden" in materials[p["material"]] for p in m["primitives"])]
    if len(bodies) != 1:
        print(json.dumps({"STOP": "body mesh ambiguous", "n": len(bodies)}))
        return 1
    body = bodies[0]
    body_name = str(body.get("name", ""))
    prims = body["primitives"]
    if prim_index >= len(prims):
        print(json.dumps({"STOP": "prim out of range", "n": len(prims)}))
        return 1
    prim = prims[prim_index]
    mat = materials[prim["material"]]
    if not mat.startswith(HIDDEN_PREFIX):
        print(json.dumps({"STOP": "prim7 not hidden", "mat": mat}))
        return 1
    skin_prims = [(i, p) for i, p in enumerate(prims) if "hidden" not in materials[p["material"]]]
    if not skin_prims:
        print(json.dumps({"STOP": "no skin primitive"}))
        return 1
    skin_material_index = int(skin_prims[0][1]["material"])

    v = decode(doc, binary, prim["attributes"]["POSITION"]).astype(float)
    idx = np.asarray(decode(doc, binary, prim["indices"]).reshape(-1), dtype=np.int64)
    tris = idx.reshape(-1, 3)
    if max(want) >= len(tris):
        print(json.dumps({"STOP": "tri out of range", "n": len(tris)}))
        return 1
    for t in want:
        k = poskey(v[tris[t]])
        if k != ref_keys[(7, t)]:
            print(json.dumps({"STOP": "position-key mismatch", "prim": 7, "tri": t}))
            return 1
    want_arr = np.array(sorted(want), dtype=np.int64)
    mask = np.zeros(len(tris), dtype=bool)
    mask[want_arr] = True
    kept = tris[~mask].reshape(-1)
    moved = tris[mask].reshape(-1)
    if kept.size == 0:
        print(json.dumps({"STOP": "trim would empty prim7"}))
        return 1
    if int(mask.sum()) != 6:
        print(json.dumps({"STOP": "moved != 6", "moved": int(mask.sum())}))
        return 1

    out_doc = copy.deepcopy(doc)
    out_bin = bytearray(binary)
    out_body = next(m for m in out_doc["meshes"] if m.get("name") == body_name)
    src_ctype = doc["accessors"][prim["indices"]]["componentType"]
    new_acc = append_index_arrays(out_doc, out_bin,
                                  {"kept": kept.astype(np.int64),
                                   "moved": moved.astype(np.int64)}, src_ctype)
    out_prim = out_body["primitives"][prim_index]
    out_prim["indices"] = new_acc["kept"]
    fresh = {"attributes": dict(prim["attributes"]),
             "indices": new_acc["moved"],
             "material": skin_material_index}
    if prim.get("targets"):
        fresh["targets"] = copy.deepcopy(prim["targets"])
    out_body["primitives"].append(fresh)
    out_doc["buffers"][0]["byteLength"] = len(out_bin)
    write_glb(args.output, out_doc, bytes(out_bin))
    rep = {"schemaVersion": SCHEMA,
           "input": args.input, "inputSha256": sha256_file(args.input),
           "facesFrom": args.faces_from, "keysMatchFixture": True,
           "bodyMesh": body_name, "primIndex": prim_index,
           "movedTris": sorted(want), "movedCount": 6,
           "newPrimitiveIndex": len(out_body["primitives"]) - 1,
           "output": args.output, "outputSha256": sha256_file(args.output),
           "outputBytes": Path(args.output).stat().st_size}
    if args.report:
        Path(args.report).write_text(json.dumps(rep, indent=1) + "\n")
    print(json.dumps(rep))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
