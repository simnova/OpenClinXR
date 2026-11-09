"""Per-card station decimation of a cards.npz (cards-opt2 runtime cost).

    python3 simplify_cards.py <cards.npz> <out.npz> --tol-mm T [--inward-margin-mm M]

cards_from_strands.py places S stations on every card (24 at cards-r7/groom-r9), so a straight hanging
card spends as many triangles as one wrapping the crown. This drops interior stations with a
Douglas-Peucker pass over the station index: station j between kept stations a < j < b is dropped when
both of its edge vertices lie within T mm of the straight interpolation at (j - a) / (b - a). The card
UV v is j / (S - 1), linear in the station index, so the atlas maps onto the decimated strip exactly as
onto the interpolated points.

A chord across a convex bend moves toward the body. A drop is also refused when the inward move along
the stored outward normal (card_vnormal) exceeds the vertex's body clearance (signed_body_m) minus M mm.

Output keeps the fixed S-station layout every consumer reads (grade.py I19, transplant_donor.py): the
dropped stations' vertices are moved onto the interpolation (card_verts) with lerped normals
(card_vnormal), and card_tris spans kept stations only, so the dropped vertices are unreferenced and the
Blender glTF export leaves them out. card_keep (n, S) records the kept stations. card_local is not updated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def dp(P, Nrm, clear, tol, margin):
    """P (S, 2, 3) edge vertices, Nrm (S, 2, 3), clear (S, 2) signed body m. Returns kept station mask."""
    S = len(P)
    keep = np.zeros(S, bool)
    keep[0] = keep[-1] = True
    stack = [(0, S - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        j = np.arange(a + 1, b)
        t = ((j - a) / (b - a))[:, None, None]
        Q = P[a][None] * (1 - t) + P[b][None] * t
        d = P[j] - Q
        err = np.linalg.norm(d, axis=2).max(1)
        inward = (d * Nrm[j]).sum(2)                  # > 0: the chord sits inside the original vertex
        bad = err > tol
        bad |= (inward > np.maximum(clear[j] - margin, 0.0)).any(1)
        if bad.any():
            k = int(j[np.argmax(np.where(bad, err + 1.0, err))])
            keep[k] = True
            stack += [(a, k), (k, b)]
    return keep


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("cards")
    p.add_argument("out")
    p.add_argument("--tol-mm", type=float, required=True)
    p.add_argument("--inward-margin-mm", type=float, default=0.5)
    a = p.parse_args()
    c = dict(np.load(a.cards))
    n = int(c["n_cards"])
    V = c["card_verts"].copy()
    S = len(V) // n // 2
    Vr = V.reshape(n, S, 2, 3)
    Nr = c["card_vnormal"].reshape(n, S, 2, 3).copy()
    clear = c["signed_body_m"].reshape(n, S, 2)
    uv = c["card_uv"].reshape(n, S, 2, 2)
    if not np.allclose(uv[:, :, 0, 1], np.linspace(0, 1, S)[None]):
        raise SystemExit("card_uv v is not j/(S-1)")
    tol, margin = a.tol_mm / 1000.0, a.inward_margin_mm / 1000.0
    keep = np.zeros((n, S), bool)
    F = []
    for ci in range(n):
        k = dp(Vr[ci], Nr[ci], clear[ci], tol, margin)
        keep[ci] = k
        ks = np.flatnonzero(k)
        for a0, b0 in zip(ks[:-1], ks[1:]):
            t = ((np.arange(a0 + 1, b0) - a0) / (b0 - a0))[:, None, None]
            Vr[ci, a0 + 1:b0] = Vr[ci, a0][None] * (1 - t) + Vr[ci, b0][None] * t
            nn = Nr[ci, a0][None] * (1 - t) + Nr[ci, b0][None] * t
            Nr[ci, a0 + 1:b0] = nn / np.linalg.norm(nn, axis=2, keepdims=True)
            vo = 2 * S * ci
            A, B, C, D = vo + 2 * a0, vo + 2 * a0 + 1, vo + 2 * b0, vo + 2 * b0 + 1
            F.append((A, C, B))
            F.append((B, C, D))
    c["card_verts"] = Vr.reshape(-1, 3)
    c["card_vnormal"] = Nr.reshape(-1, 3)
    c["card_tris"] = np.array(F, np.int64)
    c["card_keep"] = keep
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    np.savez(a.out, **dict(sorted(c.items())))
    moved = np.linalg.norm(Vr.reshape(-1, 3) - np.load(a.cards)["card_verts"], axis=1)
    per = keep.sum(1)
    rec = {"tool": "tools/openclinxr/hair-groom-2/cards/simplify_cards.py", "in": a.cards,
           "inSha256": hashlib.sha256(Path(a.cards).read_bytes()).hexdigest(),
           "outSha256": hashlib.sha256(Path(a.out).read_bytes()).hexdigest(),
           "tolMm": a.tol_mm, "inwardMarginMm": a.inward_margin_mm, "cards": n, "stations": S,
           "trianglesIn": int(n * (S - 1) * 2), "trianglesOut": len(F),
           "keptStationsPerCard": {"min": int(per.min()), "median": float(np.median(per)), "max": int(per.max())},
           "vertexMoveMm": {"max": float(moved.max() * 1000), "p99": float(np.percentile(moved, 99) * 1000)}}
    Path(a.out).with_name("simplify-record.json").write_text(json.dumps(rec, indent=1) + "\n")
    print("SIMPLIFY_DONE", json.dumps(rec))


if __name__ == "__main__":
    main()
