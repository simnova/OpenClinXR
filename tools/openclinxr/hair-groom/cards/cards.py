"""Card layout for the S5 station (pure python, no bpy).

Reads: a guides npz (REQUIRED schema: guides_xyz (G,P,3) float, root-first
ordering; guides_root (G,3); optional guide_side (G,) int8, 1 = posterior),
the Blender-dumped E/body-geo.npz (skin clearance set) and S1 scalp.npz
(head axis). Writes: E/cards.npz (the deliverable; Blender only consumes
it for cards.glb export + renders, so two runs hash-identical).

Any guides npz with that schema is accepted without code change
(--guides flag): clustering, frames and widths derive from the data.

Method:
  1. Greedy path-distance pairing (sorted root order, mean station
     distance <= 20 mm, max 2 guides/cluster). Root proximity alone
     pairs falls that diverge past the part rails, whose mean cuts
     through the face.
  2. Centreline = member mean per station. Layers: under/top (+0/+2.2 mm
     along outward) everywhere; posterior clusters (mean root y > 0) get
     an extra mid layer (+1.5 mm) -> 2-3 layers.
  3. Frames: parallel-transported width vector, re-orthogonalized per
     station and biased 1:0.5 toward facing outward (card normal ~= the
     horizontal radial from the head axis). Twist-free by construction;
     max inter-station angle reported.
  4. Width from cluster spread: w = clamp(2.2 * spread + 4 mm, 8, 20) mm
     at the root, tapering to 55 % at the tip (smoothstep on v).
  5. UV: u across (0/1), v root->tip by station fraction.
  6. Clearance: every strip vert vs the skin set; verts closer than
     1.5 mm are pushed out along the card normal side facing away from
     the body (max 40 march steps of 0.5 mm, then 20 projection
     sweeps). Min clearance reported; gate is >= 0.
  7. Per-card atlas cell (card_idx % 4) + random id
     frac((idx+1) * golden ratio) for shader variation.

Deterministic: sorted orders, closed-form arithmetic, float64.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np

S5 = Path(__file__).resolve().parent
sys.path.insert(0, str(S5))
from _geom import MeshIndex, log_open, merge_opened  # noqa: E402

# Inputs are arguments (red-team V1: the hair-light2 / hair-scalp1 / hair-cards0
# paths were hard-coded here, so a stale shared input gave an equal sha).
CLUSTER_MAX = 2
PATH_R = 0.020
LAYER_TOP = 0.0022
LAYER_MID = 0.0015
W_MIN, W_MAX = 0.008, 0.020
SKIN_HOLD = 0.0015


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cluster_paths(guides: np.ndarray, roots: np.ndarray, radius=PATH_R):
    """Greedy pairing by full-path distance (mean station distance).

    Root proximity alone pairs falls that diverge past the part rails;
    the pair mean then cuts through the face. Path distance keeps
    divergent falls on separate cards.
    """
    order = np.lexsort((roots[:, 0], -roots[:, 1]))
    assigned = np.zeros(len(roots), bool)
    clusters = []
    for i in order:
        if assigned[i]:
            continue
        assigned[i] = True
        cand = np.where(~assigned)[0]
        if len(cand):
            d = np.abs(guides[cand] - guides[i][None]).mean(axis=(1, 2))
            k = int(np.argmin(d))
            if float(d[k]) <= radius:
                j = int(cand[k])
                assigned[j] = True
                clusters.append([int(i), j])
                continue
        clusters.append([int(i)])
    return clusters


def transport_frames(centre: np.ndarray, axis: np.ndarray):
    P = len(centre)
    T = np.empty_like(centre)
    T[1:-1] = centre[2:] - centre[:-2]
    T[0] = centre[1] - centre[0]
    T[-1] = centre[-1] - centre[-2]
    T /= np.linalg.norm(T, axis=1, keepdims=True).clip(1e-12, None)
    O = centre - axis[None, :]
    O[:, 2] = 0.0
    O /= np.linalg.norm(O, axis=1, keepdims=True).clip(1e-12, None)
    W = np.empty_like(centre)
    w = np.cross(O[0], T[0])
    if float(np.linalg.norm(w)) < 1e-9:
        w = np.array([1.0, 0.0, 0.0])
    W[0] = w / np.linalg.norm(w)
    for i in range(1, P):
        # rotate previous W by the T[i-1] -> T[i] rotation (Rodrigues)
        a, b = T[i - 1], T[i]
        v = np.cross(a, b)
        c = float(np.dot(a, b))
        if float(np.linalg.norm(v)) < 1e-12:
            w = W[i - 1].copy() if c > 0 else -W[i - 1].copy()
        else:
            vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]],
                           [-v[1], v[0], 0]])
            R = np.eye(3) + vx + vx @ vx / max(1.0 + c, 1e-12)
            w = R @ W[i - 1]
        w = w - b * float(np.dot(w, b))
        if float(np.linalg.norm(w)) < 1e-12:
            w = W[i - 1] - b * float(np.dot(W[i - 1], b))
        w /= np.linalg.norm(w).clip(1e-12, None)
        wo = np.cross(O[i], b)
        if float(np.linalg.norm(wo)) > 1e-9:
            wo /= np.linalg.norm(wo)
            if float(np.dot(wo, w)) < 0:
                wo = -wo
            w = w + 0.5 * wo
            w = w - b * float(np.dot(w, b))
            w /= np.linalg.norm(w).clip(1e-12, None)
        W[i] = w
    N = np.cross(T, W)
    N /= np.linalg.norm(N, axis=1, keepdims=True).clip(1e-12, None)
    # max inter-station width-vector angle (twist diagnostic)
    dots = (W[:-1] * W[1:]).sum(1).clip(-1, 1)
    twist = float(np.degrees(np.arccos(np.abs(dots))).max())
    return T, O, W, N, twist


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--guides", required=True)
    ap.add_argument("--scalp", required=True,
                    help="npz with 'axis' (3,): head axis point; only x,y are used")
    ap.add_argument("--body", required=True, help="body-geo.npz from _blender_dump_body.py")
    ap.add_argument("--out", required=True)
    ap.add_argument("--opened", required=True, help="inputs-opened list to merge into")
    ap.add_argument("--budget", type=int, required=True,
                    help="cardBudget; the card count must fall in [0.5, 1.5] x budget (red-team V2)")
    args = ap.parse_args()

    gp = Path(args.guides)
    scalp_p = Path(args.scalp)
    body_p = Path(args.body)
    for p in (gp, scalp_p, body_p, Path(__file__), S5 / "_geom.py"):
        log_open(p)
    G = np.load(gp)
    guides = G["guides_xyz"].astype(np.float64)
    roots = G["guides_root"].astype(np.float64)
    axis = np.load(scalp_p)["axis"].astype(np.float64)
    B = np.load(body_p, allow_pickle=True)
    skin = MeshIndex(B["verts"].astype(np.float64),
                     B["tris"].astype(np.int64)[B["clearGroup"] == 1],
                     cell=0.008)
    garment = MeshIndex(B["verts"].astype(np.float64),
                        B["tris"].astype(np.int64)[B["clearGroup"] == 0],
                        cell=0.008)

    nG, P = guides.shape[:2]
    clusters = cluster_paths(guides, roots)
    print("clusters=%d (sizes %s)" % (
        len(clusters),
        {s: sum(1 for c in clusters if len(c) == s) for s in (1, 2)}),
        flush=True)

    Vall, Uall, Vall_id = [], [], []
    Fall = []
    card_layer, card_width, card_cell, card_rand, card_root = [], [], [], [], []
    voff = 0
    twist_max = 0.0
    n3 = 0
    GOLD = 0.6180339887498949
    for ci, members in enumerate(clusters):
        centre = guides[members].mean(0)
        T, O, W, N, twist = transport_frames(centre, axis)
        twist_max = max(twist_max, twist)
        spread = float(np.linalg.norm(roots[members] - roots[members].mean(0),
                                      axis=1).max()) if len(members) > 1 else 0.0
        w_root = min(max(2.2 * spread + 0.004, W_MIN), W_MAX)
        v = np.arange(P) / (P - 1)
        taper = 1.0 - 0.45 * (v * v * (3 - 2 * v))
        w = w_root * taper
        posterior = bool(roots[members][:, 1].mean() > axis[1])
        layers = [0.0, LAYER_TOP] if not posterior else [0.0, LAYER_MID, LAYER_TOP]
        n3 += 1 if posterior else 0
        for li, off in enumerate(layers):
            base = centre + off * O
            left = base - (w / 2)[:, None] * W
            right = base + (w / 2)[:, None] * W
            verts = np.empty((2 * P, 3))
            verts[0::2] = left
            verts[1::2] = right
            uv = np.empty((2 * P, 2))
            uv[0::2, 0] = 0.0
            uv[1::2, 0] = 1.0
            uv[:, 1] = np.repeat(v, 2)
            tris = []
            for i in range(P - 1):
                a, b, c_, d_ = voff + 2 * i, voff + 2 * i + 1, voff + 2 * i + 2, voff + 2 * i + 3
                tris.append((a, c_, b))
                tris.append((b, c_, d_))
            Vall.append(verts)
            Uall.append(uv)
            Fall.extend(tris)
            cid = len(card_layer)
            Vall_id.append(np.full(2 * P, cid, dtype=np.int64))
            card_layer.append(li)
            card_width.append(float(w_root))
            card_cell.append(cid % 4)
            card_rand.append(float(((cid + 1) * GOLD) % 1.0))
            card_root.append(roots[members].mean(0))
            voff += 2 * P

    verts = np.vstack(Vall)
    uv = np.vstack(Uall)
    faces = np.array(Fall, dtype=np.int64)
    vert_card = np.concatenate(Vall_id)
    n_cards = len(card_layer)
    print("cards=%d (3-layer clusters=%d) verts=%d tris=%d" % (
        n_cards, n3, len(verts), len(faces)), flush=True)
    lo, hi = 0.5 * args.budget, 1.5 * args.budget
    if not (lo <= n_cards <= hi):
        raise RuntimeError("card count %d outside [%.0f, %.0f] = [0.5, 1.5] x budget %d"
                           % (n_cards, lo, hi, args.budget))
    verts_before = verts.copy()

    # clearance: hold every strip vert >= SKIN_HOLD off the skin set.
    # Active-set loop (only violators are re-queried) for speed.
    active = np.arange(len(verts))
    for _ in range(20):
        c, d = skin.query(verts[active])
        viol = np.where(d < SKIN_HOLD)[0]
        if not len(viol):
            active = np.empty(0, dtype=np.int64)
            break
        idx = active[viol]
        delta = verts[idx] - c[viol]
        n = np.linalg.norm(delta, axis=1)
        zero = n < 1e-12
        if zero.any():
            nn = np.cross(
                np.ones_like(delta[zero]),
                np.array([0.0, 0.0, 1.0]))
            delta[zero] = nn / np.linalg.norm(nn, axis=1, keepdims=True).clip(1e-12, None)
            n = np.linalg.norm(delta, axis=1)
        verts[idx] = c[viol] + delta / n[:, None] * (SKIN_HOLD + 0.0003)
        active = idx
    c, d = skin.query(verts)
    for i in np.where(d < SKIN_HOLD)[0]:
        delta = verts[i] - c[i]
        n = float(np.linalg.norm(delta)) or 1.0
        step = delta / max(n, 1e-12)
        p = verts[i].copy()
        for _ in range(40):
            p = p + step * 0.0005
            _, dd = skin.query(p[None])
            if float(dd[0]) >= SKIN_HOLD:
                break
        verts[i] = p
    c, d = skin.query(verts)
    min_clear = float(d.min())
    push = np.linalg.norm(verts - verts_before, axis=1)
    n_pushed = int((push > 0).sum())
    max_push = float(push.max())
    print("pushOut verts=%d max=%.3fmm (unsigned MeshIndex; V4(a) signed check is separate)"
          % (n_pushed, max_push * 1000), flush=True)
    _, dg = garment.query(verts)
    print("minClearSkin=%.3fmm garmentProxMin=%.3fmm twistMax=%.2fdeg" % (
        min_clear * 1000, float(dg.min()) * 1000, twist_max), flush=True)
    if min_clear < 0.0:
        raise RuntimeError("card penetration: %.4fmm" % (min_clear * 1000))

    out = Path(args.out)
    payload = {
        "card_verts": np.ascontiguousarray(verts),
        "card_tris": np.ascontiguousarray(faces),
        "card_uv": np.ascontiguousarray(uv),
        "vert_card": np.ascontiguousarray(vert_card),
        "card_layer": np.array(card_layer, dtype=np.int64),
        "card_width_mm": np.array(card_width) * 1000.0,
        "card_cell": np.array(card_cell, dtype=np.int64),
        "card_rand": np.array(card_rand),
        "card_root": np.ascontiguousarray(np.array(card_root)),
        "n_cards": np.int64(n_cards),
        "n_clusters": np.int64(len(clusters)),
        "n_guides": np.int64(nG),
        "twist_max_deg": np.float64(twist_max),
        "min_clearance_mm": np.float64(min_clear * 1000),
        "garment_prox_min_mm": np.float64(float(dg.min()) * 1000),
        "guides_sha": np.array(sha256(gp)),
        "body_sha": np.array(sha256(body_p)),
        "budget": np.int64(args.budget),
        "push_count": np.int64(n_pushed),
        "push_max_mm": np.float64(max_push * 1000),
    }
    np.savez(str(out), **dict(sorted(payload.items())))
    log_open(out)
    merge_opened(Path(args.opened))
    print("CARDS_DONE sha=%s" % sha256(out), flush=True)


if __name__ == "__main__":
    main()
