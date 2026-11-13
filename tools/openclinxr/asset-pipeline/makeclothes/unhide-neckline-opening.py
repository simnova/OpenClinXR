#!/usr/bin/env python3
"""unhide-neckline-opening.py — phys-neck Route B post-stage (h4).

Moves the scrub-shirt V opening from the hide mask back to skin on the
SHIPPED GLB bytes: for each openclinxr_hidden_* primitive of the body mesh
(upper, orphan, any variant — h5 C1; lower/foot exclusion follows from the
rule's V-band height, never from a prefix list), the
triangles the H1 rule
(`uncovered_neckline_hidden_triangles` in garment_coverage.py — the single
rule definition, imported, never copied) reports as uncovered are removed
from that primitive's indices, and ONE new primitive per affected hidden
primitive is appended that reuses the source primitive's attribute
accessors and morph targets (no vertex duplication) with the body SKIN
material. Index-only change: no POSITION/NORMAL/TEXCOORD/JOINTS/WEIGHTS
bytes and no morph-target bytes are added or altered.

Run:
  python3 tools/openclinxr/asset-pipeline/makeclothes/unhide-neckline-opening.py \\
    --in <glb> [--out <glb> | --in-place] [--report <json>] [--dry]

Refuses (loudly, non-zero) when: no/single body mesh with hidden prims is
found; no openclinxr_hidden_* primitive exists; no skin primitive exists; the rule
moves nothing; a trim would empty a hidden primitive.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import garment_coverage as gc
from glb_index_io import (
    HIDDEN_PREFIX,
    append_index_arrays,
    decode,
    find_mesh,
    read_glb,
    sha256_file,
    write_glb,
)

SCHEMA = "openclinxr.unhide-neckline-opening.v1"




def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="input", required=True)
    ap.add_argument("--out", dest="output", default=None)
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument("--report", dest="report", default=None)
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args(argv)

    if args.in_place:
        output = args.input
    elif args.output:
        output = args.output
    else:
        raise ValueError("give --out <glb> or --in-place")

    doc, binary = read_glb(args.input)
    materials = [m.get("name", "") for m in doc.get("materials", [])]

    body_meshes = [
        m
        for m in doc.get("meshes", [])
        if str(m.get("name", "")).endswith("_body")
        and any("hidden" in materials[p["material"]] for p in m.get("primitives", []))
    ]
    if len(body_meshes) != 1:
        raise ValueError(f"expected one body mesh with hidden prims, found {len(body_meshes)}")
    body = body_meshes[0]
    body_name = str(body.get("name", ""))

    skin_prims = [
        (i, p)
        for i, p in enumerate(body.get("primitives", []))
        if "hidden" not in materials[p["material"]]
    ]
    if not skin_prims:
        raise ValueError(f"body mesh {body_name} has no skin primitive")
    skin_material_index = int(skin_prims[0][1]["material"])
    visible = []
    for _, p in skin_prims:
        v = decode(doc, binary, p["attributes"]["POSITION"]).astype(float)
        f = np.asarray(decode(doc, binary, p["indices"]).reshape(-1), dtype=np.int64)
        visible.append((v, f))

    shirt = find_mesh(doc, "scrub_shirt")
    shirt_p = shirt["primitives"][0]
    shirt_v = decode(doc, binary, shirt_p["attributes"]["POSITION"]).astype(float)
    shirt_f = np.asarray(decode(doc, binary, shirt_p["indices"]).reshape(-1), dtype=np.int64)
    try:
        coat = find_mesh(doc, "lab_coat")
        coat_p = coat["primitives"][0]
        coat_v = decode(doc, binary, coat_p["attributes"]["POSITION"]).astype(float)
        coat_f = np.asarray(decode(doc, binary, coat_p["indices"]).reshape(-1), dtype=np.int64)
    except ValueError:
        coat_v = coat_f = None

    lash = find_mesh(doc, "eyelash")
    lash_v = decode(doc, binary, lash["primitives"][0]["attributes"]["POSITION"]).astype(float)
    teeth = find_mesh(doc, "fitted_teeth_mpfb")
    teeth_v = decode(doc, binary, teeth["primitives"][0]["attributes"]["POSITION"]).astype(float)

    upper = [
        (i, p, materials[p["material"]])
        for i, p in enumerate(body.get("primitives", []))
        if materials[p["material"]].startswith(HIDDEN_PREFIX)
    ]
    if not upper:
        raise ValueError(f"body mesh {body_name} has no {HIDDEN_PREFIX}* primitive")

    per_prim = []
    moves: list[tuple[int, dict, np.ndarray, np.ndarray, np.ndarray]] = []
    for prim_index, prim, mat_name in upper:
        v = decode(doc, binary, prim["attributes"]["POSITION"]).astype(float)
        n = decode(doc, binary, prim["attributes"]["NORMAL"]).astype(float)
        idx = np.asarray(decode(doc, binary, prim["indices"]).reshape(-1), dtype=np.int64)
        tris = idx.reshape(-1, 3)
        rule = gc.uncovered_neckline_hidden_triangles(
            v,
            idx,
            n,
            shirt_v,
            shirt_f,
            visible,
            lab_coat_verts=coat_v,
            lab_coat_faces=coat_f,
            eyelash_zc=float(lash_v[:, 2].mean()),
            teeth_zc=float(teeth_v[:, 2].mean()),
        )
        uncovered = np.asarray(rule["uncovered"], dtype=bool)
        kept = tris[~uncovered].reshape(-1)
        moved = tris[uncovered].reshape(-1)
        per_prim.append(
            {
                "primIndex": prim_index,
                "material": mat_name,
                "materialIndex": int(prim["material"]),
                "hiddenTrisBefore": int(len(tris)),
                "movedTris": int(uncovered.sum()),
                "hiddenTrisAfter": int((~uncovered).sum()),
                "inBandTris": int(rule["inBandCount"]),
                "ownClearTris": int(rule["ownClearCount"]),
                "frontClearTris": int(rule["frontClearCount"]),
                "tqOnlyTris": int(rule["tqOnlyCount"]),
                "ruleInfo": rule["info"],
            }
        )
        if uncovered.any():
            if kept.size == 0:
                raise ValueError(f"refusing: trim would empty hidden primitive {mat_name}")
            moves.append((prim_index, prim, kept, moved, rule["info"]))

    total_moved = int(sum(int(m[3].size // 3) for m in moves))
    report = {
        "schemaVersion": SCHEMA,
        "input": args.input,
        "output": output,
        "inputSha256": sha256_file(args.input),
        "dry": bool(args.dry),
        "body": body_name,
        "skinMaterial": materials[skin_material_index],
        "skinMaterialIndex": skin_material_index,
        "hiddenUpperPrefix": HIDDEN_PREFIX,
        "primitives": per_prim,
        "movedTrisTotal": total_moved,
        # h5 C1: the V band must admit no lower/foot triangle — exclusion
        # follows from height (band floor), never from the prefix list.
        "lowerFootInBandTris": int(
            sum(
                e["inBandTris"]
                for e in per_prim
                if "lower" in e["material"] or "foot" in e["material"]
            )
        ),
        "newPrimitives": [],
        "notEvidenceFor": ["clinical_validity", "production_asset_readiness"],
    }

    if total_moved == 0:
        if args.report:
            Path(args.report).write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        raise ValueError("refusing: rule moved nothing; no output written")

    if not args.dry:
        out_doc = copy.deepcopy(doc)
        out_bin = bytearray(binary)
        out_body = next(m for m in out_doc["meshes"] if m.get("name") == body_name)
        for prim_index, prim, kept, moved, _info in moves:
            src_ctype = doc["accessors"][prim["indices"]]["componentType"]
            index_arrays = {"kept": kept.astype(np.int64), "moved": moved.astype(np.int64)}
            new_acc = append_index_arrays(out_doc, out_bin, index_arrays, src_ctype)
            out_prim = out_body["primitives"][prim_index]
            out_prim["indices"] = new_acc["kept"]
            fresh = {
                "attributes": dict(prim["attributes"]),
                "indices": new_acc["moved"],
                "material": skin_material_index,
            }
            if prim.get("targets"):
                fresh["targets"] = copy.deepcopy(prim["targets"])
            out_body["primitives"].append(fresh)
            new_index = len(out_body["primitives"]) - 1
            entry = next(e for e in per_prim if e["primIndex"] == prim_index)
            entry["newPrimitiveIndex"] = new_index
            report["newPrimitives"].append(
                {
                    "fromPrimIndex": prim_index,
                    "fromMaterial": materials[prim["material"]],
                    "newPrimitiveIndex": new_index,
                    "material": materials[skin_material_index],
                    "materialIndex": skin_material_index,
                    "movedTris": int(moved.size // 3),
                }
            )
        out_doc["buffers"][0]["byteLength"] = len(out_bin)
        write_glb(output, out_doc, bytes(out_bin))
        report["outputSha256"] = sha256_file(output)
        report["outputBytes"] = Path(output).stat().st_size
    else:
        for prim_index, _prim, _kept, moved, _info in moves:
            entry = next(e for e in per_prim if e["primIndex"] == prim_index)
            entry["newPrimitiveIndex"] = f"dry-run (would append at {len(body.get('primitives', []))})"

    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as e:
        print(f"unhide-neckline-opening: {e}", file=sys.stderr)
        raise SystemExit(2)
