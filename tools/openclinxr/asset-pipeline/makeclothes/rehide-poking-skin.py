#!/usr/bin/env python3
"""rehide-poking-skin.py — e9-R1 chest fix on the SHIPPED GLB bytes.

Moves body-skin triangles that poke through the scrub shirt back under the
hide mask: for each SKIN primitive of the body mesh, the triangles the H1
rule (`body_hide_mask` in garment_coverage.py — the single rule definition,
imported, never copied) flags as poking are removed from that primitive's
indices, and ONE new primitive per affected skin primitive is appended that
reuses the source primitive's attribute accessors and morph targets (no
vertex duplication) with the body's hidden material (the first
openclinxr_hidden_* primitive's material). Index-only change: no
POSITION/NORMAL/TEXCOORD/JOINTS/WEIGHTS bytes and no morph-target bytes are
added or altered.

This is the reverse direction of unhide-neckline-opening.py (which moves
hidden V-opening triangles to skin); the mechanism (trim source indices,
append one reusing prim per affected source prim, only index accessors
appended) mirrors it. GLB byte helpers (read/write/decode/sha) and the
append-index writer live in glb_index_io.py, shared with unhide (F12).

REQUIRED INPUTS (no fallback): the posed gate needs all three —
  --rays-dir <dir>   (t2_rays.json + rays_full_{front,tq}_s2.bin),
  --poses-meta <dir>/meta.json (mesh table + frame list),
  --poses-dir <dir>  (the meta frame .bin files).
Missing any one is a loud refusal (exit 2, naming the regen command).
There is no bind-only and no rule-only mode: without the posed gate the
tool writes nothing. Regenerate inputs from shipped sources only with:
  tsx tools/openclinxr/asset-pipeline/makeclothes/sample-grade-poses.ts \\
    --in <input.glb> --out-dir <dir>

POSED GATE (F9): the frame set must be exactly the input GLB's shipped
animation clips x 8 frames each (names listed in meta.json); anything else
refuses. The nurse carries 3 clips (ClinicalIdleConversation,
ClinicalExpressionMicroTransition, openclinxr_retarget_walk_source) x 8 =
24 posed frames. Selection runs in two phases through
backface_hide_select.greedy_over_frames (the same function the evidence
greedy uses): phase 1 bind-only from the rule set, phase 2 bind + every
meta frame from the phase-1 set. No id list is embedded in the tool.

Run:
  python3 tools/openclinxr/asset-pipeline/makeclothes/rehide-poking-skin.py \\
    --in <glb> [--out <glb> | --in-place] [--report <json>] [--dry] \\
    --rays-dir <dir> --poses-meta <dir>/meta.json --poses-dir <dir> \\
    [--patch-prim-in-place]

Refuses (loudly, non-zero) when: any of --rays-dir/--poses-meta/--poses-dir
is missing; a named rays/poses file is absent; the meta frame set is not
exactly clips x 8; no/single body mesh with hidden prims is found; no
openclinxr_hidden_* primitive exists; no skin primitive exists; the rule
moves nothing; a trim would empty a skin primitive.
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
    COMP_SIZE,
    HIDDEN_PREFIX,
    NCOMP,
    append_index_arrays,
    decode,
    find_mesh,
    read_glb,
    sha256_file,
    write_glb,
)

SCHEMA = "openclinxr.rehide-poking-skin.v1"


def _accessor_abs_ranges(doc):
    """Yield (kind, acc_idx, view_idx, start, end) for every byte range an
    accessor reads: the dense payload plus sparse indices/values payloads."""
    for ai, a in enumerate(doc.get("accessors", [])):
        ncomp = NCOMP[a["type"]]
        size = COMP_SIZE[a["componentType"]]
        if "bufferView" in a:
            v = doc["bufferViews"][a["bufferView"]]
            stride = v.get("byteStride")
            length = a["count"] * (stride if stride else ncomp * size)
            start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
            yield ("dense", ai, a["bufferView"], start, start + length)
        for key in ("indices", "values"):
            s = a.get("sparse", {}).get(key, {})
            if "bufferView" not in s:
                continue
            v = doc["bufferViews"][s["bufferView"]]
            n = a["sparse"].get("count", 0)
            nc = 1 if key == "indices" else ncomp
            ct = s["componentType"] if key == "indices" else a["componentType"]
            length = n * nc * COMP_SIZE[ct]
            start = v.get("byteOffset", 0) + s.get("byteOffset", 0)
            yield (f"sparse-{key}", ai, s["bufferView"], start, start + length)


def repack_drop_ranges(doc, binary, dead_abs, skip_acc=()):
    """Excise dead absolute BIN intervals and repack (4-aligned).

    dead_abs: list of (start, end) absolute BIN offsets to remove.
    skip_acc: accessor indices allowed to contain a dead interval (patched
      source accessors whose tail is removed).
    Returns (binary, excised_total). Mutates doc (view offsets/lengths,
    in-view accessor offsets) in place.
    """
    dead_abs = sorted(dead_abs)
    skip_acc = set(skip_acc)
    views = doc["bufferViews"]
    voleft = [v.get("byteOffset", 0) for v in views]
    voright = [o + v["byteLength"] for o, v in zip(voleft, views)]
    # per-view dead intervals (view-relative)
    per_view_dead: dict[int, list] = {}
    for ds, de in dead_abs:
        owners = [i for i in range(len(views)) if voleft[i] <= ds and de <= voright[i]]
        assert len(owners) == 1, f"dead [{ds},{de}) must sit in exactly one view: {owners}"
        vi = owners[0]
        per_view_dead.setdefault(vi, []).append((ds - voleft[vi], de - voleft[vi]))
    image_views = {im.get("bufferView") for im in doc.get("images", []) if "bufferView" in im}
    for vi in per_view_dead:
        assert vi not in image_views, f"dead bytes in image view {vi}"
        for ai, a in enumerate(doc.get("accessors", [])):
            if a.get("bufferView") == vi:
                assert a["type"] == "SCALAR" and a["componentType"] in (5123, 5125), \
                    f"dead bytes share view {vi} with non-index accessor {ai}"
    for kind, ai, vi, s, e in _accessor_abs_ranges(doc):
        for ds, de in dead_abs:
            overlap = min(e, de) - max(s, ds)
            if overlap <= 0:
                continue
            if ai in skip_acc and kind == "dense" and s <= ds and de <= e:
                continue  # the patched accessor's own excised tail
            raise AssertionError(f"dead [{ds},{de}) overlaps {kind} range of accessor {ai}")
    # rebuild each view payload minus dead; shift in-view offsets
    new_payloads = []
    for vi, v in enumerate(views):
        old = binary[voleft[vi]:voright[vi]]
        cuts = sorted(per_view_dead.get(vi, []))
        pieces = []
        cur = 0
        for cs, ce in cuts:
            pieces.append(old[cur:cs])
            cur = ce
        pieces.append(old[cur:])
        new_payloads.append(b"".join(pieces))
        # shift accessors rooted in this view whose range sits after dead
        for ai, a in enumerate(doc.get("accessors", [])):
            if a.get("bufferView") == vi and "bufferView" in a:
                shift = sum(max(0, min(ce, a.get("byteOffset", 0)) - cs)
                            for cs, ce in cuts if a.get("byteOffset", 0) >= ce)
                if shift:
                    a["byteOffset"] = a.get("byteOffset", 0) - shift
            for key in ("indices", "values"):
                s = a.get("sparse", {}).get(key, {})
                if s.get("bufferView") == vi and "bufferView" in s:
                    shift = sum(max(0, min(ce, s.get("byteOffset", 0)) - cs)
                                for cs, ce in cuts if s.get("byteOffset", 0) >= ce)
                    if shift:
                        s["byteOffset"] = s.get("byteOffset", 0) - shift
    # re-lay the BIN with 4-byte view alignment
    new_bin = bytearray()
    for vi, v in enumerate(views):
        while len(new_bin) % 4:
            new_bin.append(0)
        v["byteOffset"] = len(new_bin)
        v["byteLength"] = len(new_payloads[vi])
        new_bin.extend(new_payloads[vi])
    excised = sum(de - ds for ds, de in dead_abs)
    return bytes(new_bin), excised


def compute_poking(doc: dict, binary: bytes, garment_token: str = "scrub_shirt") -> dict:
    """Run the H1 rule (garment_coverage.body_hide_mask) per skin prim.

    Returns per-prim flagged (poking) triangle ids in that prim's own index
    space, the shirt-AABB band used (the GLB analog of the bake band), and
    the sorted union of flagged ids. No id list lives here: the set is
    computed from the rule on the input bytes every run.
    """
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

    hidden_prims = [
        (i, p)
        for i, p in enumerate(body.get("primitives", []))
        if materials[p["material"]].startswith(HIDDEN_PREFIX)
    ]
    if not hidden_prims:
        raise ValueError(f"body mesh {body.get('name')} has no {HIDDEN_PREFIX}* primitive")

    skin_prims = [
        (i, p)
        for i, p in enumerate(body.get("primitives", []))
        if "hidden" not in materials[p["material"]]
    ]
    if not skin_prims:
        raise ValueError(f"body mesh {body.get('name')} has no skin primitive")

    garment = find_mesh(doc, garment_token)
    garment_p = garment["primitives"][0]
    garment_v = decode(doc, binary, garment_p["attributes"]["POSITION"]).astype(float)
    garment_f = np.asarray(decode(doc, binary, garment_p["indices"]).reshape(-1), dtype=np.int64).reshape(-1, 3)

    band_lo, band_hi = float(garment_v[:, 1].min()), float(garment_v[:, 1].max())

    per_prim = []
    for prim_index, prim in skin_prims:
        v = decode(doc, binary, prim["attributes"]["POSITION"]).astype(float)
        idx = np.asarray(decode(doc, binary, prim["indices"]).reshape(-1), dtype=np.int64).reshape(-1, 3)
        rule = gc.body_hide_mask(v, idx, garment_v, garment_f, band_lo, band_hi, height_axis=1, lateral_axis=0)
        flagged = sorted(int(t) for t in np.where(rule["hideMask"])[0].tolist())
        tris = idx.reshape(-1, 3)
        per_prim.append(
            {
                "primIndex": prim_index,
                "material": materials[prim["material"]],
                "materialIndex": int(prim["material"]),
                "skinTrisBefore": int(len(tris)),
                "flaggedTris": flagged,
                "flaggedCount": len(flagged),
                "regionFaceCount": int(rule["regionFaceCount"]),
                "hideEpsilonMeters": float(rule["hideEpsilonMeters"]),
            }
        )
    return {
        "body": str(body.get("name", "")),
        "garment": str(garment.get("name", "")),
        "band": [band_lo, band_hi],
        "perPrim": per_prim,
        "flaggedTotal": int(sum(len(e["flaggedTris"]) for e in per_prim)),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="input", required=True)
    ap.add_argument("--out", dest="output", default=None)
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument("--report", dest="report", default=None)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--rays-dir", dest="rays_dir", default=None,
                    help="REQUIRED: evidence dir with rays_full_front_s2.bin, "
                         "rays_full_tq_s2.bin, t2_rays.json (grade affine + origins).")
    ap.add_argument("--poses-meta", dest="poses_meta", default=None,
                    help="REQUIRED: poses meta.json (mesh table + frame list: exactly "
                         "the input GLB's clips x 8 frames).")
    ap.add_argument("--poses-dir", dest="poses_dir", default=None,
                    help="REQUIRED: dir holding the meta frame .bin files (read-only).")
    ap.add_argument("--patch-prim-in-place", dest="patch_prim_in_place",
                    action="store_true",
                    help="patch each trimmed source prim's index accessor in place "
                         "(overwrite its byte range with the kept payload, update "
                         "count/min/max, excise the dead tail from the BIN with offset "
                         "fixups) instead of appending a kept copy; only the moved "
                         "payload is appended. The output carries no orphaned index "
                         "bytes.")
    args = ap.parse_args(argv)

    if args.in_place:
        output = args.input
    elif args.output:
        output = args.output
    else:
        raise ValueError("give --out <glb> or --in-place")

    doc, binary = read_glb(args.input)
    materials = [m.get("name", "") for m in doc.get("materials", [])]

    computed = compute_poking(doc, binary)
    body_name = computed["body"]

    # F1/F8: the posed gate is mandatory — every missing posed/capture input
    # refuses loudly (exit 2, naming the regen command). There is no
    # bind-only and no rule-only fallback mode in the shipped tool.
    regen_hint = ("posed inputs are not shipped with the repo; regenerate them with: "
                  "tsx tools/openclinxr/asset-pipeline/makeclothes/sample-grade-poses.ts "
                  "--in <input.glb> --out-dir <dir>  (then pass that dir as --rays-dir, "
                  "its meta.json as --poses-meta and the dir as --poses-dir)")
    missing_args = [flag for flag, val in
                    (("--rays-dir", args.rays_dir),
                     ("--poses-meta", args.poses_meta),
                     ("--poses-dir", args.poses_dir)) if not val]
    if missing_args:
        print(f"REFUSED: the posed gate requires {' '.join(missing_args)}; "
              f"no bind-only or rule-only fallback exists.\n{regen_hint}",
              file=sys.stderr)
        sys.exit(2)

    from pathlib import Path as _P
    import backface_hide_select as _sel
    rd = _P(args.rays_dir)
    # grade affine + origins come from the e9-r1 capture sidecar (same cameras);
    # rays_dir must hold t2_rays.json + rays_full_{front,tq}_s2.bin
    need = ["t2_rays.json", "rays_full_front_s2.bin", "rays_full_tq_s2.bin"]
    absent = [fn for fn in need if not (rd / fn).is_file()]
    if absent:
        print(f"REFUSED: rays dir {rd} missing {absent}; regenerate with: "
              "tsx tools/openclinxr/asset-pipeline/makeclothes/sample-grade-poses.ts "
              "--in <input.glb> --out-dir <dir>  (then pass that dir as --rays-dir)",
              file=sys.stderr)
        sys.exit(2)
    side = json.loads((rd / "t2_rays.json").read_text())
    S = np.asarray(side["gradeNorm"]["scale"], dtype=float)
    OFF = np.asarray(side["gradeNorm"]["position"], dtype=float)
    origins = {"front": np.asarray(side["cap_front"]["origin"], dtype=float),
               "three_quarter": np.asarray(side["cap_tq"]["origin"], dtype=float)}
    # Posed selection (r1c C2): bind + every meta frame through the same
    # greedy_over_frames the evidence uses. Phase 1 bind-only from the
    # rule set; phase 2 bind + all frames from the phase-1 set.
    mp = _P(args.poses_meta)
    if not mp.is_file():
        print(f"REFUSED: poses meta not found: {mp}\n{regen_hint}", file=sys.stderr)
        sys.exit(2)
    pdir = _P(args.poses_dir)
    if not pdir.is_dir():
        print(f"REFUSED: poses dir not found (need a dir holding the frame bins): "
              f"{pdir}\n{regen_hint}", file=sys.stderr)
        sys.exit(2)
    meta = json.loads(mp.read_text())
    # F9 cardinality: the frame set must be exactly the input GLB's shipped
    # animation clips x 8 frames each (names listed in meta). Anything else
    # refuses — a missing walk clip or an extra clip is a different gate.
    clip_names = [str(a.get("name", "")) for a in doc.get("animations", [])]
    frames_table = meta.get("frames", {})
    if not clip_names:
        print("REFUSED: input GLB carries no animation clips; the posed gate "
              f"needs clips x 8 frames.\n{regen_hint}", file=sys.stderr)
        sys.exit(2)
    if set(frames_table) != set(clip_names):
        print(f"REFUSED: poses meta clips {sorted(frames_table)} != input GLB "
              f"clips {sorted(clip_names)}.\n{regen_hint}", file=sys.stderr)
        sys.exit(2)
    total_frames = sum(len(files) for files in frames_table.values())
    bad_counts = {c: len(files) for c, files in frames_table.items() if len(files) != 8}
    if bad_counts or total_frames != 8 * len(clip_names):
        print(f"REFUSED: every clip needs exactly 8 frames "
              f"(bad counts {bad_counts}, total {total_frames} != {8 * len(clip_names)}).\n"
              f"{regen_hint}", file=sys.stderr)
        sys.exit(2)
    want = sorted({fn for files in frames_table.values() for fn in files})
    missing = [fn for fn in want if not (pdir / fn).is_file()]
    if missing:
        print(f"REFUSED: {len(missing)}/{len(want)} pose frame bins missing under {pdir}"
              + (f" e.g. {missing[:3]}" if missing else "")
              + f"\n{regen_hint}", file=sys.stderr)
        sys.exit(2)
    # Posed-only selection (F1): no bind-only and no rule-only branch.
    doc_prims = []
    for m in doc.get("meshes", []):
        for pi, p in enumerate(m.get("primitives", [])):
            a = doc["accessors"][p["attributes"]["POSITION"]]
            doc_prims.append({"mesh": str(m.get("name", "")), "pi": pi,
                              "mat": materials[p["material"]],
                              "verts": a["count"]})
    meta_match = _sel.match_meta_to_glb(doc_prims, meta)
    meshes = meta["meshes"]
    raw_ordered = []
    for j, mm in enumerate(meshes):
        mname, pi = meta_match[j]
        dm = next(d for d in doc.get("meshes", [])
                  if str(d.get("name", "")) == mname)
        pp = dm["primitives"][pi]
        raw_ordered.append(
            np.asarray(decode(doc, binary, pp["attributes"]["POSITION"]),
                       dtype=float))
    total_v = sum(mm["verts"] for mm in meshes)
    bind_grade = np.concatenate(raw_ordered, axis=0) * S + OFF
    assert len(bind_grade) == total_v
    per_mesh_index = [np.asarray(mm["index"], dtype=np.int64).reshape(-1, 3)
                      for mm in meshes]
    voff, vcount = [], []
    _o = 0
    for mm in meshes:
        voff.append(_o)
        vcount.append(mm["verts"])
        _o += mm["verts"]
    body0_name = computed["body"]
    is_body = [n == body0_name or n.startswith(body0_name + "_")
               for n in [mm["name"] for mm in meshes]]
    is_shirt = [mm["name"] == "makeclothes_library_scrub_shirt"
                for mm in meshes]
    frames = [("bind", _sel.pregs_for_frame(
        meshes, voff, vcount, bind_grade, per_mesh_index, is_body, is_shirt))]
    for clip, files in meta["frames"].items():
        for fi, fn in enumerate(files):
            fg = np.fromfile(str(pdir / fn), dtype=np.float32).reshape(
                total_v, 3).astype(float) * S + OFF
            frames.append((f"{clip}/f{fi}", _sel.pregs_for_frame(
                meshes, voff, vcount, fg, per_mesh_index, is_body, is_shirt)))
    rays_full = {}
    for name, fn in (("front", "rays_full_front_s2.bin"),
                     ("three_quarter", "rays_full_tq_s2.bin")):
        rays_full[name] = np.fromfile(
            str(rd / fn), dtype=np.float32).reshape(-1, 3).astype(float)
    flagged = np.asarray(computed["perPrim"][0]["flaggedTris"], dtype=np.int64)

    def _plog(m):
        print(m, file=sys.stderr)
    safe_bind, _, rounds_bind = _sel.greedy_over_frames(
        [frames[0]], flagged, origins, rays_full, log=_plog)
    print(f"posed select phase1 (bind): safe={len(safe_bind)}", file=sys.stderr)
    safe, dropped, rounds_posed = _sel.greedy_over_frames(
        frames, flagged, origins, rays_full, start=safe_bind, log=_plog)
    safe_rounds = [{"phase": "bind", **r} for r in rounds_bind] + \
        [{"phase": "posed", **r} for r in rounds_posed]
    safe_by_prim = {0: [int(t) for t in safe]}
    print(f"posed select phase2 (bind+{len(frames) - 1} frames): "
          f"flagged={len(flagged)} safe={len(safe)} dropped={len(dropped)}",
          file=sys.stderr)


    hidden_prims = [
        (i, p)
        for i, p in enumerate(
            next(m for m in doc.get("meshes", []) if m.get("name") == body_name).get("primitives", [])
        )
        if materials[p["material"]].startswith(HIDDEN_PREFIX)
    ]
    hidden_material_index = int(hidden_prims[0][1]["material"])
    hidden_material = materials[hidden_material_index]

    moves: list[tuple[int, dict, np.ndarray, np.ndarray]] = []
    per_prim_report = []
    for entry in computed["perPrim"]:
        prim_index = entry["primIndex"]
        prim = next(m for m in doc.get("meshes", []) if m.get("name") == body_name)["primitives"][prim_index]
        idx = np.asarray(decode(doc, binary, prim["indices"]).reshape(-1), dtype=np.int64)
        tris = idx.reshape(-1, 3)
        use_ids = safe_by_prim.get(prim_index, entry["flaggedTris"])
        flagged = np.zeros(len(tris), dtype=bool)
        flagged[np.asarray(use_ids, dtype=np.int64)] = True
        kept = tris[~flagged].reshape(-1)
        moved = tris[flagged].reshape(-1)
        row = {
            "primIndex": prim_index,
            "material": entry["material"],
            "materialIndex": entry["materialIndex"],
            "skinTrisBefore": int(len(tris)),
            "movedTris": int(flagged.sum()),
            "skinTrisAfter": int((~flagged).sum()),
            "regionFaceCount": entry["regionFaceCount"],
        }
        per_prim_report.append(row)
        if flagged.any():
            if kept.size == 0:
                raise ValueError(f"refusing: trim would empty skin primitive {entry['material']}")
            moves.append((prim_index, prim, kept, moved))

    total_moved = int(sum(int(m[3].size // 3) for m in moves))
    report = {
        "schemaVersion": SCHEMA,
        "input": args.input,
        "output": output,
        "inputSha256": sha256_file(args.input),
        "dry": bool(args.dry),
        "body": body_name,
        "hiddenTargetMaterial": hidden_material,
        "hiddenTargetMaterialIndex": hidden_material_index,
        "band": computed["band"],
        "primitives": per_prim_report,
        "computedFlaggedTotal": computed["flaggedTotal"],
        "computedFlaggedByPrim": {str(e["primIndex"]): e["flaggedTris"] for e in computed["perPrim"]},
        "safeSelectedByPrim": {str(k): v for k, v in safe_by_prim.items()},
        "safeSelectedTotal": int(sum(len(v) for v in safe_by_prim.values())),
        "safeRounds": safe_rounds,
        "raysDir": args.rays_dir,
        "posesMeta": args.poses_meta,
        "posesDir": args.poses_dir,
        "patchedPrimInPlace": bool(args.patch_prim_in_place),
        "movedTrisTotal": total_moved,
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
        excised_total = 0
        if args.patch_prim_in_place:
            # Patch each trimmed source prim in place: overwrite its index
            # byte range with the kept payload, update the accessor, then
            # repack once to drop all dead tails (no orphaned index bytes).
            dead: list[tuple[int, int]] = []
            patched_acc: list[int] = []
            for prim_index, prim, kept, moved in moves:
                src_ctype = doc["accessors"][prim["indices"]]["componentType"]
                elem = 2 if src_ctype == 5123 else 4
                a = out_doc["accessors"][prim["indices"]]
                v = out_doc["bufferViews"][a["bufferView"]]
                start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
                old_len = a["count"] * elem
                payload = kept.astype(np.int64).astype("<u2" if src_ctype == 5123 else "<u4").tobytes()
                assert len(payload) <= old_len, "kept payload must fit the patched range"
                out_bin[start:start + len(payload)] = payload
                if start + len(payload) < start + old_len:
                    dead.append((start + len(payload), start + old_len))
                a["count"] = int(kept.size)
                a["min"] = [int(kept.min())]
                a["max"] = [int(kept.max())]
                patched_acc.append(prim["indices"])
                entry = next(e for e in per_prim_report if e["primIndex"] == prim_index)
                entry["patchedInPlace"] = True
                entry["excisedTailBytes"] = old_len - len(payload)
            if dead:
                out_bin, excised_total = repack_drop_ranges(
                    out_doc, bytes(out_bin), dead, skip_acc=patched_acc)
                out_bin = bytearray(out_bin)
        for prim_index, prim, kept, moved in moves:
            src_ctype = doc["accessors"][prim["indices"]]["componentType"]
            if args.patch_prim_in_place:
                index_arrays = {"moved": moved.astype(np.int64)}
            else:
                index_arrays = {"kept": kept.astype(np.int64), "moved": moved.astype(np.int64)}
            new_acc = append_index_arrays(out_doc, out_bin, index_arrays, src_ctype)
            out_prim = out_body["primitives"][prim_index]
            if not args.patch_prim_in_place:
                out_prim["indices"] = new_acc["kept"]
            fresh = {
                "attributes": dict(prim["attributes"]),
                "indices": new_acc["moved"],
                "material": hidden_material_index,
            }
            if prim.get("targets"):
                fresh["targets"] = copy.deepcopy(prim["targets"])
            out_body["primitives"].append(fresh)
            new_index = len(out_body["primitives"]) - 1
            entry = next(e for e in per_prim_report if e["primIndex"] == prim_index)
            entry["newPrimitiveIndex"] = new_index
            report["newPrimitives"].append(
                {
                    "fromPrimIndex": prim_index,
                    "fromMaterial": materials[prim["material"]],
                    "newPrimitiveIndex": new_index,
                    "material": hidden_material,
                    "materialIndex": hidden_material_index,
                    "movedTris": int(moved.size // 3),
                }
            )
        out_doc["buffers"][0]["byteLength"] = len(out_bin)
        write_glb(output, out_doc, bytes(out_bin))
        report["outputSha256"] = sha256_file(output)
        report["outputBytes"] = Path(output).stat().st_size
    else:
        for prim_index, _prim, _kept, moved in moves:
            entry = next(e for e in per_prim_report if e["primIndex"] == prim_index)
            entry["newPrimitiveIndex"] = (
                f"dry-run (would append at {len(next(m for m in doc.get('meshes', []) if m.get('name') == body_name).get('primitives', []))})"
            )

    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as e:
        print(f"rehide-poking-skin: {e}", file=sys.stderr)
        raise SystemExit(2)
