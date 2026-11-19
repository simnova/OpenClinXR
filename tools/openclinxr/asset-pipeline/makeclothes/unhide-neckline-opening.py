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
primitive is appended with the body SKIN material.

Two write paths (kevin-collar S5):

- legacy (no --openings-spec): index-only. The new primitive reuses the
  source primitive's attribute accessors and morph targets (no vertex
  duplication). Frozen: reproduces the physician 2faef74a -> 8c3ab05c bytes.
- openings-spec (e.g. neckline-sleeves): index-only as well, with the
  same shared-accessor append as the legacy path; only the moved SET is
  wider (base pass plus the opening-edge pass). Moved triangles keep
  their ORIGINAL hidden-prim UVs: no vertex duplication, no UV repair.

S7 select (--select-tris <json>): the JSON maps
hidden-prim index (str) to the kept src-face list (face indices within that
primitive). Faces outside the rule's moved set are REFUSED (loudly): the
selection may only narrow, never widen. Prims with an empty selection keep
their hidden primitive untouched (no appended prim).

S9 deletion note (cap41 S9-5): the S8 --recess-plan branch was deleted
here (it moved main's own hidden-prim verts, failing the index-only
ship-superset gate by design; RESULT-s8 + its plan stay in the asset
store only). The tool is index-only again on every path.

  The atlas texels they land on are filled from neighbouring skin by
  the stage-23 skin-footprint inpaint (inpaint_hide_footprint.py). The
  S4 per-tri soup + two-phase UV repair is deleted: it pinned 133 moved
  tris to one texel each, rendering a flat-shaded facet patchwork.
  Without the atlas fill, hidden-prim UVs that land
  in the atlas black padding render solid black lit despite the skin
  material (S4 D1c/D2: up to 100% of moved centroids on Kevin).

Run:
  python3 tools/openclinxr/asset-pipeline/makeclothes/unhide-neckline-opening.py \\
    --in <glb> [--out <glb> | --output <glb> | --in-place] [--report <json>] [--dry]
    [--openings-spec <openings.json>]

  --openings-spec selects garment openings (schema
  openclinxr.openings-spec.v1): {"openings": [...], "edgeViews": [...]},
  openings ⊆ {"neckline", "sleeves"}. Absent = legacy neckline-only pass
  (the physician behaviour, byte-identical). "sleeves" runs the base pass
  plus the opening-edge pass: kept in-band triangles with a clear ray to a
  grading-camera position (sleeve-hem and V rims the fixed axes graze).
  Camera positions come from the file's own bounds; no body-specific input.

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


OPENINGS_SPEC_SCHEMA = "openclinxr.openings-spec.v1"
KNOWN_OPENINGS = ("neckline", "sleeves")


def load_openings_spec(path: str | None) -> dict:
    """Openings selection for the unhide pass.

    None (flag absent) means the legacy neckline-only pass: byte-identical to
    the pre-openings tool. A spec file selects {"openings": [...]} where
    "neckline" is the base V-band pass and "sleeves" ADDS the opening-edge
    pass (kept in-band triangles with a clear ray to a grading camera —
    sleeve-hem and V rims the fixed axes graze). "sleeves" implies the base
    pass (it partitions moved/kept); valid sets are non-empty subsets of
    {"neckline", "sleeves"}.
    """
    if path is None:
        return {"openings": ["neckline"], "edgeViews": ["front", "three_quarter"], "default": True}
    raw = json.loads(Path(path).read_text())
    if raw.get("schemaVersion") != OPENINGS_SPEC_SCHEMA:
        raise ValueError(f"openings spec schema want {OPENINGS_SPEC_SCHEMA}, saw {raw.get('schemaVersion')!r}")
    openings = raw.get("openings")
    if not isinstance(openings, list) or not openings or any(o not in KNOWN_OPENINGS for o in openings):
        raise ValueError(f"openings spec openings want a non-empty subset of {list(KNOWN_OPENINGS)}, saw {openings!r}")
    views = raw.get("edgeViews", ["front", "three_quarter"])
    if not isinstance(views, list) or not views or any(v not in gc.EDGE_KNOWN_VIEWS for v in views):
        raise ValueError(f"openings spec edgeViews want a non-empty subset of {list(gc.EDGE_KNOWN_VIEWS)}, saw {views!r}")
    return {"openings": list(openings), "edgeViews": list(views), "default": False}




def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="input", required=True)
    ap.add_argument("--out", "--output", dest="output", default=None)
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument("--report", dest="report", default=None)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument(
        "--openings-spec",
        dest="openings_spec",
        default=None,
        help="JSON openings spec (schema " + OPENINGS_SPEC_SCHEMA + "); absent = legacy neckline-only pass",
    )
    ap.add_argument(
        "--select-tris",
        dest="select_tris",
        default=None,
        help="JSON file mapping hidden-prim index (str) to kept src-face list "
        "(kevin-collar S7 visibility selection; intersects the rule moved set)",
    )
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

    openings = load_openings_spec(args.openings_spec)
    want_edge = "sleeves" in openings["openings"]
    cam_positions: dict = {}
    if want_edge:
        # Grading-camera positions from the file's own POSITION bounds (no
        # body-specific constants); the base rule's occluder set is reused.
        all_verts = []
        for m in doc.get("meshes", []):
            for p in m.get("primitives", []):
                attrs = p.get("attributes", {})
                if "POSITION" in attrs:
                    all_verts.append(decode(doc, binary, attrs["POSITION"]).astype(float))
        cam_positions = gc.grading_camera_positions(all_verts, tuple(openings["edgeViews"]))

    upper = [
        (i, p, materials[p["material"]])
        for i, p in enumerate(body.get("primitives", []))
        if materials[p["material"]].startswith(HIDDEN_PREFIX)
    ]
    if not upper:
        raise ValueError(f"body mesh {body_name} has no {HIDDEN_PREFIX}* primitive")

    per_prim = []
    moves: list[tuple[int, dict, np.ndarray, np.ndarray, np.ndarray]] = []
    masks: dict[int, tuple] = {}
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
        base_moved_count = int(uncovered.sum())
        edge_moved_count = 0
        edge_info: dict = {}
        if want_edge:
            edge_rule = gc.uncovered_edge_hidden_triangles(
                v,
                idx,
                uncovered,
                rule["info"]["shirtFrontCentreFloorM"],
                shirt_v,
                shirt_f,
                visible,
                cam_positions,
                lab_coat_verts=coat_v,
                lab_coat_faces=coat_f,
            )
            edge = np.asarray(edge_rule["uncovered"], dtype=bool)
            edge_moved_count = int(edge.sum())
            edge_info = {"perViewClearCount": edge_rule["perViewClearCount"], "info": edge_rule["info"]}
            uncovered = uncovered | edge
        masks[prim_index] = (prim, mat_name, v, tris, uncovered, base_moved_count, edge_moved_count, edge_info, rule)

    # S7 select: intersect the rule moved set with the visibility selection.
    # The selection may only narrow (outside faces and unknown prims refuse);
    # prims with an empty selection keep their hidden primitive untouched.
    select_report: dict = {"selectPath": None, "selectKeptTrisTotal": None,
                           "selectDroppedTrisTotal": None}
    select_dropped_src: dict[int, list[int]] = {}
    if args.select_tris is not None:
        try:
            sel_raw = json.loads(Path(str(args.select_tris)).read_text())
        except (OSError, ValueError) as e:
            raise ValueError(f"unhide-neckline-opening: --select-tris unreadable: {e}")
        if not isinstance(sel_raw, dict):
            raise ValueError("unhide-neckline-opening: --select-tris JSON must map prim index to face list")
        sel: dict[int, set[int]] = {}
        for k, faces in sel_raw.items():
            try:
                pi = int(k)
            except (TypeError, ValueError):
                raise ValueError(f"unhide-neckline-opening: --select-tris bad prim key {k!r}")
            if pi not in masks:
                raise ValueError(f"unhide-neckline-opening: --select-tris prim {pi} is not a hidden prim")
            if not isinstance(faces, list) or any(not isinstance(f, int) for f in faces):
                raise ValueError(f"unhide-neckline-opening: --select-tris prim {pi} faces must be a list of ints")
            sel[pi] = set(faces)
        kept_total = 0
        dropped_total = 0
        for pi in masks:
            prim, mat_name, vv, ttris, mm, base_c, edge_c, einfo, rrule = masks[pi]
            moved_idx = set(int(i) for i in np.where(mm)[0])
            want = sel.get(pi, set())
            outside = sorted(want - moved_idx)
            if outside:
                raise ValueError(
                    f"unhide-neckline-opening: --select-tris prim {pi} names {len(outside)} "
                    f"faces outside the rule moved set (e.g. {outside[:8]}): refusing"
                )
            final = np.zeros(len(ttris), dtype=bool)
            if want:
                idxs = np.asarray(sorted(want), dtype=np.int64)
                final[idxs] = True
            masks[pi] = (prim, mat_name, vv, ttris, final, base_c, edge_c, einfo, rrule)
            kept_total += int(final.sum())
            dropped_here = sorted(moved_idx - want)
            dropped_total += len(dropped_here)
            select_dropped_src[pi] = dropped_here
        select_report = {
            "selectPath": str(args.select_tris),
            "selectKeptTrisTotal": kept_total,
            "selectDroppedTrisTotal": dropped_total,
        }

    for prim_index, prim, mat_name in upper:
        (prim, mat_name, v, tris, uncovered, base_moved_count, edge_moved_count, edge_info, rule) = masks[prim_index]
        kept = tris[~uncovered].reshape(-1)
        moved = tris[uncovered].reshape(-1)
        entry: dict = {
            "primIndex": prim_index,
            "material": mat_name,
            "materialIndex": int(prim["material"]),
            "hiddenTrisBefore": int(len(tris)),
            "movedTris": int(uncovered.sum()),
            "baseMovedTris": base_moved_count,
            "edgeMovedTris": edge_moved_count,
            "hiddenTrisAfter": int((~uncovered).sum()),
            "inBandTris": int(rule["inBandCount"]),
            "ownClearTris": int(rule["ownClearCount"]),
            "frontClearTris": int(rule["frontClearCount"]),
            "tqOnlyTris": int(rule["tqOnlyCount"]),
            "ruleInfo": rule["info"],
            "edgeInfo": edge_info,
        }
        if args.select_tris is not None:
            entry["selectKeptTris"] = int(uncovered.sum())
            entry["selectDroppedSrcFaces"] = select_dropped_src.get(prim_index, [])
        per_prim.append(entry)
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
        "openings": openings["openings"],
        "openingsSpec": args.openings_spec,
        "edgeViews": openings["edgeViews"],
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
        "select": select_report,
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
        # Single index-only construction for BOTH paths (S5): the appended
        # prim reuses the source primitive's attribute accessors and morph
        # targets -- no vertex duplication, no UV repair. The legacy default
        # path keeps the frozen physician behaviour (byte-identical output
        # for 2faef74a -> 8c3ab05c); the --openings-spec path only selects
        # a wider moved set (base + edge passes). Moved triangles keep
        # their original UVs; the atlas texels they land on are filled
        # from neighbouring skin by the stage-23 skin-footprint inpaint.
        for prim_index, prim, kept, moved, _info in moves:
            src_ctype = doc["accessors"][prim["indices"]]["componentType"]
            moved_flat = np.asarray(moved, dtype=np.int64).reshape(-1)
            index_arrays = {"kept": np.asarray(kept, dtype=np.int64).reshape(-1),
                            "moved": moved_flat}
            new_acc = append_index_arrays(out_doc, out_bin, index_arrays, src_ctype)
            out_prim = out_body["primitives"][prim_index]
            out_prim["indices"] = new_acc["kept"]
            fresh_attrs: dict = dict(prim["attributes"])
            fresh_targets = None
            if prim.get("targets"):
                fresh_targets = copy.deepcopy(prim["targets"])
            fresh = {
                "attributes": fresh_attrs,
                "indices": new_acc["moved"],
                "material": skin_material_index,
            }
            if fresh_targets:
                fresh["targets"] = fresh_targets
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
                    "movedTris": int(moved_flat.size // 3),
                }
            )
        report["vertexDuplication"] = False
        if openings.get("default", False):
            report["uvRepair"] = {"enabled": False, "reason": "legacy default path (physician byte-equality)"}
        else:
            report["uvRepair"] = {
                "enabled": False,
                "reason": "S5 index-only: original UVs kept; atlas fill is the stage-23 skin-footprint inpaint",
            }
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
