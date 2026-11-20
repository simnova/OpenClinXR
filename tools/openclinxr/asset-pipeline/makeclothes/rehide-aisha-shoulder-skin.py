#!/usr/bin/env python3
"""rehide-aisha-shoulder-skin.py — AISHA-SWEATER-POKE-THROUGH lever stage.

Moves the posed-converged body-skin triangles showing through Aisha's green
sweater at both shoulders back under the hide mask (E9 precedent c1da76fb4:
rehide-poking-skin.py, patch-prim-in-place).

Unlike the E9 tool, the selection is PINNED, not recomputed: S2 measured the
hide set as the union over 8 evenly spaced times of ClinicalIdleConversation
(t_k = k*duration/8, k=0..7; held-out t_h=0.5 never used for selection) of
body-skin faces (prim of mpfb_skin_ob_patient_aisha_v1) visible at the learner
camera, under the t-shirt at the two shoulders, within poke distance
(clearance < garment_coverage.HIDE_EPSILON_M = 5mm, the H1 rule's own
epsilon). The 20-face union lives in store SELECTION.json (--select-faces);
the tool hides exactly those faces and nothing else. CW-A (V-neck opening
band superset) and CW-B (every newly hidden face in a shirt-covered shoulder
region) are enforced by the stage test
(packages/openclinxr/asset-registry/src/aisha-sweater-stage.test.ts), which
shares the kept/hidden split predicate with this tool's report pins.

Mechanism (E9, reused never copied): trim the pinned triangles from the skin
prim's indices, append ONE new primitive reusing the source prim's attribute
accessors and morph targets (no vertex duplication) with the body's hidden
material (the first openclinxr_hidden_* primitive's material). Index-only
change: no POSITION/NORMAL/TEXCOORD/JOINTS/WEIGHTS bytes and no morph-target
bytes are added or altered. GLB byte helpers live in glb_index_io.py;
patch-prim-in-place repack lives in rehide-poking-skin.py (imported, the F12
single definition is in glb_index_io.py and the repack single definition is
in rehide-poking-skin.py).

Run:
  python3 tools/openclinxr/asset-pipeline/makeclothes/rehide-aisha-shoulder-skin.py \\
    --in <glb> --out <glb> [--report <json>] [--dry] \\
    [--select-faces <SELECTION.json>] [--patch-prim-in-place]

Refuses (loudly, non-zero) when: the input is not the pinned pre-image
(sha256 37e905ea...; an already-staged 4148864b... input is named as such);
the select-faces file is missing, not a JSON array of distinct ints, or not
exactly 20 faces (count only; mutation probes pass
--allow-noncanonical-selection); a face id is out of range; no single body
mesh with hidden prims is found; no openclinxr_hidden_* primitive exists; no
skin primitive exists; the trim would empty the skin primitive; the post-move
union check fails.
"""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glb_index_io import (  # noqa: E402
    HIDDEN_PREFIX,
    append_index_arrays,
    decode,
    read_glb,
    sha256_file,
    write_glb,
)

_REHIDE = importlib.util.spec_from_file_location(
    "aisha_rehide_impl",
    str(Path(__file__).resolve().parent / "rehide-poking-skin.py"),
)
assert _REHIDE is not None and _REHIDE.loader is not None
_rehide_mod = importlib.util.module_from_spec(_REHIDE)
_REHIDE.loader.exec_module(_rehide_mod)
repack_drop_ranges = _rehide_mod.repack_drop_ranges

SCHEMA = "openclinxr.rehide-aisha-shoulder-skin.v1"

SKIN_MATERIAL = "mpfb_skin_ob_patient_aisha_v1"

# Pinned pre-image (git f772d0c26 .../mpfb-ob-patient-aisha.glb): the only
# input this stage accepts. Face ordinals are tri ids of THIS byte stream; any
# other input (reordered, foreign, or already staged) is refused loudly.
EXPECTED_INPUT_SHA256 = "37e905ea9fa0d4f3664d95a1c34ab45219a77ed63a46b4976b0bb1a063443ce9"
# Output of this stage on the pinned pre-image (= the shipped GLB): naming it
# lets the refusal say "already staged" instead of hiding 20 more faces.
STAGED_OUTPUT_SHA256 = "4148864b18186c788c8a30f16f7fb7d924752f3c53fb4ede24d767278656e99c"
# Canonical S2 union size: production replay hides exactly these faces.
# Mutation probes (plants) pass --allow-noncanonical-selection explicitly.
CANONICAL_SELECTION_COUNT = 20

# Pinned S2 union (r1/SELECTION.json): L (image-right shoulder) 761..768, 777,
# 778; R (image-left shoulder) 4300..4307, 4313, 4314. Face ids are tris of the
# skin prim in the pre-stage GLB (7060 tris). Overridden only by --select-faces.
PINNED_SELECTION = [761, 762, 763, 764, 765, 766, 767, 768, 777, 778,
                    4300, 4301, 4302, 4303, 4304, 4305, 4306, 4307, 4313, 4314]

# CW-B shoulder regions (bind metres, from shirt anatomy; mirrored pair):
# outboard of the neck halfwidth 0.098, above cuff tops 1.2656, inboard of
# cuff outer 0.293, below shirt top 1.4058.
def region_of(x: float, y: float) -> str:
    if 0.10 <= x <= 0.30 and 1.27 <= y <= 1.45:
        return "shoulderR"
    if -0.30 <= x <= -0.10 and 1.27 <= y <= 1.45:
        return "shoulderL"
    return "other"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="input", required=True)
    ap.add_argument("--out", dest="output", default=None)
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument("--report", dest="report", default=None)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--select-faces", dest="select_faces", default=None,
                    help="SELECTION.json pinning the hidden tri ids "
                         "(default: the embedded S2 20-face union).")
    ap.add_argument("--patch-prim-in-place", dest="patch_prim_in_place",
                    action="store_true",
                    help="patch the trimmed source prim's index accessor in "
                         "place instead of appending a kept copy (E9).")
    ap.add_argument("--allow-noncanonical-selection", dest="allow_noncanonical",
                    action="store_true",
                    help="permit a selection whose size != the canonical "
                         "20-face S2 union (mutation probes only; production "
                         "replay never passes this).")
    args = ap.parse_args(argv)

    if args.in_place:
        output = args.input
    elif args.output:
        output = args.output
    else:
        raise ValueError("give --out <glb> or --in-place")

    if args.select_faces:
        sel_raw = json.loads(Path(args.select_faces).read_text())
        faces_raw = sel_raw["faces"]
        if not isinstance(faces_raw, list):
            raise ValueError(f"refusing: {args.select_faces} faces is not a JSON array")
        for t in faces_raw:
            # Strict ints: bool is an int subclass, floats and numeric
            # strings coerce silently under int() and are refused here.
            if not isinstance(t, int) or isinstance(t, bool):
                raise ValueError(
                    f"refusing: {args.select_faces} faces must be a JSON array "
                    f"of distinct ints, got {t!r}")
        selected = sorted(faces_raw)
        select_src = args.select_faces
    else:
        selected = sorted(PINNED_SELECTION)
        select_src = "<embedded S2 union>"
    if len(selected) != len(set(selected)):
        raise ValueError(f"refusing: duplicate face ids in {select_src}")
    if not selected:
        raise ValueError("refusing: rule moved nothing; no output written")
    if len(selected) != CANONICAL_SELECTION_COUNT and not args.allow_noncanonical:
        raise ValueError(
            f"refusing: selection has {len(selected)} faces, the enforced count "
            f"is {CANONICAL_SELECTION_COUNT} faces; mutation probes pass "
            "--allow-noncanonical-selection explicitly")

    doc, binary = read_glb(args.input)
    input_sha = sha256_file(args.input)
    if input_sha == STAGED_OUTPUT_SHA256:
        raise ValueError(
            f"refusing: input {args.input} is already staged "
            f"(sha256 {input_sha}); this stage applies once to the pinned "
            f"pre-image {EXPECTED_INPUT_SHA256}")
    if input_sha != EXPECTED_INPUT_SHA256:
        raise ValueError(
            f"refusing: input {args.input} sha256 {input_sha} != pinned "
            f"pre-image {EXPECTED_INPUT_SHA256}; face ordinals are tri ids of "
            "that byte stream, so a reordered or foreign input is refused")
    materials = [m.get("name", "") for m in doc.get("materials", [])]

    body_meshes = [
        m for m in doc.get("meshes", [])
        if str(m.get("name", "")).endswith("_body")
        and any("hidden" in materials[p["material"]] for p in m.get("primitives", []))
    ]
    if len(body_meshes) != 1:
        raise ValueError(f"expected one body mesh with hidden prims, found {len(body_meshes)}")
    body = body_meshes[0]
    body_name = str(body.get("name", ""))

    hidden_prims = [
        (i, p) for i, p in enumerate(body.get("primitives", []))
        if materials[p["material"]].startswith(HIDDEN_PREFIX)
    ]
    if not hidden_prims:
        raise ValueError(f"body mesh {body_name} has no {HIDDEN_PREFIX}* primitive")
    hidden_material_index = int(hidden_prims[0][1]["material"])
    hidden_material = materials[hidden_material_index]

    skin_entries = [
        (i, p) for i, p in enumerate(body.get("primitives", []))
        if materials[p["material"]] == SKIN_MATERIAL
    ]
    if not skin_entries:
        raise ValueError(f"body mesh {body_name} has no {SKIN_MATERIAL} primitive")
    if len(skin_entries) != 1:
        raise ValueError(f"expected one {SKIN_MATERIAL} prim, found {len(skin_entries)}")
    prim_index, prim = skin_entries[0]

    idx = np.asarray(decode(doc, binary, prim["indices"]).reshape(-1), dtype=np.int64)
    n_tris = len(idx) // 3
    bad = [t for t in selected if t < 0 or t >= n_tris]
    if bad:
        raise ValueError(f"refusing: {len(bad)} selected faces out of range "
                         f"(skin prim has {n_tris} tris), e.g. {bad[:5]}")
    tris = idx.reshape(-1, 3)
    flagged = np.zeros(len(tris), dtype=bool)
    flagged[np.asarray(selected, dtype=np.int64)] = True
    kept = tris[~flagged].reshape(-1)
    moved = tris[flagged].reshape(-1)
    if kept.size == 0:
        raise ValueError("refusing: trim would empty the skin primitive")

    # CW-B classification (printed; enforced by the stage test CW-B).
    pos = np.asarray(decode(doc, binary, prim["attributes"]["POSITION"]), dtype=float)
    centroids = pos[moved.reshape(-1, 3)].mean(axis=1)
    counts = {"shoulderL": 0, "shoulderR": 0, "other": 0}
    for cx, cy, _cz in centroids:
        counts[region_of(float(cx), float(cy))] += 1

    def raw_sha_of_index_array(flat: np.ndarray, ctype: int) -> str:
        import hashlib
        h = hashlib.sha256()
        h.update(flat.astype(np.int64).astype("<u2" if ctype == 5123 else "<u4").tobytes())
        return h.hexdigest()

    src_ctype = doc["accessors"][prim["indices"]]["componentType"]
    report = {
        "schemaVersion": SCHEMA,
        "input": args.input,
        "output": output,
        "inputSha256": sha256_file(args.input),
        "dry": bool(args.dry),
        "body": body_name,
        "skinMaterial": SKIN_MATERIAL,
        "skinPrimIndex": prim_index,
        "skinTrisBefore": int(n_tris),
        "hiddenTargetMaterial": hidden_material,
        "hiddenTargetMaterialIndex": hidden_material_index,
        "selectionSource": select_src,
        "selectedFaces": selected,
        "selectedCount": len(selected),
        "regionCounts": counts,
        "patchedPrimInPlace": bool(args.patch_prim_in_place),
        "movedTrisTotal": int(moved.size // 3),
        "skinTrisAfter": int(kept.size // 3),
        "newPrimitives": [],
        "notEvidenceFor": ["clinical_validity", "production_asset_readiness"],
    }

    if not args.dry:
        out_doc = copy.deepcopy(doc)
        out_bin = bytearray(binary)
        out_body = next(m for m in out_doc["meshes"] if m.get("name") == body_name)
        if args.patch_prim_in_place:
            elem = 2 if src_ctype == 5123 else 4
            a = out_doc["accessors"][prim["indices"]]
            v = out_doc["bufferViews"][a["bufferView"]]
            start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
            old_len = a["count"] * elem
            payload = kept.astype(np.int64).astype("<u2" if src_ctype == 5123 else "<u4").tobytes()
            assert len(payload) <= old_len, "kept payload must fit the patched range"
            out_bin[start:start + len(payload)] = payload
            dead = []
            if start + len(payload) < start + old_len:
                dead = [(start + len(payload), start + old_len)]
            a["count"] = int(kept.size)
            a["min"] = [int(kept.min())]
            a["max"] = [int(kept.max())]
            if dead:
                out_bin, _excised = repack_drop_ranges(
                    out_doc, bytes(out_bin), dead, skip_acc={prim["indices"]})
                out_bin = bytearray(out_bin)
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
        report["newPrimitives"].append(
            {
                "fromPrimIndex": prim_index,
                "fromMaterial": SKIN_MATERIAL,
                "newPrimitiveIndex": new_index,
                "material": hidden_material,
                "materialIndex": hidden_material_index,
                "movedTris": int(moved.size // 3),
            }
        )
        # E9 union invariant: sorted(kept + hidden) == sorted(baseline).
        live_kept = out_prim["indices"]
        live_hidden = new_acc["moved"]
        lk = np.asarray(decode(out_doc, bytes(out_bin), live_kept).reshape(-1))
        lh = np.asarray(decode(out_doc, bytes(out_bin), live_hidden).reshape(-1))
        merged = np.sort(np.concatenate([lk, lh]))
        if not np.array_equal(merged, np.sort(idx)):
            raise ValueError("refusing: post-move union != baseline "
                             "(a triangle was lost or added)")
        out_doc["buffers"][0]["byteLength"] = len(out_bin)
        write_glb(output, out_doc, bytes(out_bin))
        report["keptIndicesSha256"] = raw_sha_of_index_array(kept, src_ctype)
        report["hiddenIndicesSha256"] = raw_sha_of_index_array(moved, src_ctype)
        report["outputSha256"] = sha256_file(output)
        report["outputBytes"] = Path(output).stat().st_size
    else:
        report["keptIndicesSha256"] = raw_sha_of_index_array(kept, src_ctype)
        report["hiddenIndicesSha256"] = raw_sha_of_index_array(moved, src_ctype)

    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as e:
        print(f"rehide-aisha-shoulder-skin: {e}", file=sys.stderr)
        raise SystemExit(2)
