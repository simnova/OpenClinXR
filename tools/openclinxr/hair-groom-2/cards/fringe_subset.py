"""Triangle subset for the runtime BLEND fringe pass (cards-opt1).

    python3 fringe_subset.py <donor.glb> <cards.npz> <out.json> [--rule outer]

transplant_library_hair.py --fringe-blend draws every hair triangle twice (MASK core + BLEND fringe).
The fringe is only seen where a card edge is not covered by another card. Rule `outer`: drop the
inner card of every two-layer cluster (cards_from_strands writes a cluster's cards consecutively,
layer 0 then layer 1; an inner card is layer 0 followed by layer 1), keep single-layer and outer
cards. Each donor triangle is assigned to its card through the atlas cell its UV centroid falls in
(one unique cell per card, cards.npz card_atlas_cell_px), so the subset does not depend on the
exporter's triangle order. --inner-root-frac F keeps an inner card's triangles whose centroid lies in
the root fraction F of the card (cell row offset / cell height): at the crown the inner cards' roots
form the part edge, and dropping their fringe there leaves a jagged part (opt1 frouter, front). Output: {"triangles": [...]} for --fringe-triangles, plus counts.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "asset-pipeline" / "makeclothes"))
from transplant_fitted_brow import parse_glb, view_bytes  # noqa: E402

HAIR = "makeclothes_library_hair_"
FMT = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor(doc, binary, i):
    a = doc["accessors"][i]
    n, k, f = int(a["count"]), NCOMP[a["type"]], FMT[int(a["componentType"])]
    raw = view_bytes(doc, binary, int(a["bufferView"]))[int(a.get("byteOffset", 0)):]
    return np.array(struct.unpack_from("<%d%s" % (n * k, f), raw)).reshape(n, k) if k > 1 else \
        np.array(struct.unpack_from("<%d%s" % (n, f), raw))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("donor")
    p.add_argument("cards")
    p.add_argument("out")
    p.add_argument("--rule", choices=("outer",), default="outer")
    p.add_argument("--inner-root-frac", type=float, default=0.0)
    a = p.parse_args()
    doc, binary, _ = parse_glb(Path(a.donor))
    mesh = [m for m in doc["meshes"] if HAIR in str(m.get("name", ""))]
    if len(mesh) != 1 or len(mesh[0]["primitives"]) != 1:
        raise SystemExit("expected one hair mesh with one primitive")
    prim = mesh[0]["primitives"][0]
    uv = accessor(doc, binary, int(prim["attributes"]["TEXCOORD_0"]))
    idx = accessor(doc, binary, int(prim["indices"])).reshape(-1, 3)
    c = np.load(a.cards)
    cell, layer = c["card_atlas_cell_px"], c["card_layer"]
    px = int(c["atlas_px"])
    cen = uv[idx].mean(1) * px                      # glTF UV origin top-left = image row 0
    owner = np.full(len(idx), -1)
    vfrac = np.zeros(len(idx))
    for ci, (x0, y0, w, h) in enumerate(cell):
        hit = (cen[:, 0] >= x0) & (cen[:, 0] < x0 + w) & (cen[:, 1] >= y0) & (cen[:, 1] < y0 + h)
        owner[hit] = ci
        vfrac[hit] = (cen[hit, 1] - y0) / h
    if (owner < 0).any():
        raise SystemExit("%d triangles outside every atlas cell" % int((owner < 0).sum()))
    inner = np.zeros(len(layer), bool)
    inner[:-1] = (layer[:-1] == 0) & (layer[1:] == 1)
    keep = np.flatnonzero(~inner[owner] | (vfrac < a.inner_root_frac))
    rec = {"triangles": [int(t) for t in keep], "rule": a.rule, "innerRootFrac": a.inner_root_frac, "trianglesKept": int(len(keep)),
           "trianglesTotal": int(len(idx)), "cardsDropped": int(inner.sum()), "cards": int(len(layer)),
           "trianglesPerCard": sorted(set(np.bincount(owner, minlength=len(layer)).tolist()))}
    Path(a.out).write_text(json.dumps(rec) + "\n")
    print("FRINGE_SUBSET", json.dumps({k: v for k, v in rec.items() if k != "triangles"}))


if __name__ == "__main__":
    main()
