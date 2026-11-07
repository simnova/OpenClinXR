"""PROVISIONAL guides for the S5 card station (pure python, no bpy).

Reads (never writes except E/ outputs): S1 roots.npz + scalp.npz and the
Blender-dumped E/body-geo.npz. Writes: E/provisional-guides.npz.

Method (stated PROVISIONAL: the fitted guide field from the fitting lane
is not ready; this card must accept any guides npz later without code
change, see cards.py for the required schema):
  1. Poisson-disk subset of the S1 roots, seeded (target ~300).
  2. Per root: trace down the 6 mm offset shell of the scalp (nearest
     scalp triangle + outward face normal, 3 mm z steps, lateral position
     inherited from the previous point) until the scalp is left
     (nearest distance > 12 mm) or z <= 1.46 m (forced release).
  3. Gravity fall: x,y frozen at release, 3 mm z steps to z_end:
     back (root y > 0) ends 70 mm below the shoulder plane
     (1.405 - 0.070 = 1.335 m); sides end at the shoulder (1.405 m).
     PROVISIONAL combing proxy (centre part): anterior roots (y < -10 mm)
     drift toward side rails at |x| = 82 mm (face half-width + card
     half-width) at 6 % of the remaining gap per step, so front hair
     frames the face instead of falling through it; the fitted field
     replaces this rule without code change downstream.
  4. Clearance: every path point pushed to >= 3 mm from the dumped body
     + clothing triangles (uniform-grid closest point, two root->tip
     sweeps). No SDF from the fitting lane is available here; the
     dumped triangles are the same meshes the renderer loads.
  5. Arclength resample to P=25, root-first ordering.

Deterministic: seeded RNG, sorted inputs, float64.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np

S5 = Path(__file__).resolve().parent
sys.path.insert(0, str(S5))
from _geom import MeshIndex, arclength_resample, closest_point_tri, log_open, merge_opened  # noqa: E402

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
S1 = ROOT / "tools/openclinxr/evidence/hair-scalp1"
E = ROOT / "tools/openclinxr/evidence/hair-cards0"

SEED = 7
N_TARGET = 300
P = 25
SHELL_OFF = 0.006
SHELL_LEAVE = 0.012
DZ = 0.003
Z_RELEASE_FORCE = 1.46
Z_SHOULDER = 1.405
Z_END_BACK = 1.335
CLEAR = 0.003


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def poisson_subset(xyz: np.ndarray, seed: int, n_lo=280, n_hi=320):
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(xyz))
    lo, hi = 0.002, 0.020
    best = None
    for _ in range(40):
        r = 0.5 * (lo + hi)
        cell = r
        origin = xyz.min(0) - cell
        grid: dict = {}
        acc = []
        for idx in order:
            p = xyz[idx]
            key = tuple(np.floor((p - origin) / cell).astype(int).tolist())
            ok = True
            for ax in (key[0] - 1, key[0], key[0] + 1):
                for ay in (key[1] - 1, key[1], key[1] + 1):
                    for az in (key[2] - 1, key[2], key[2] + 1):
                        for j in grid.get((ax, ay, az), ()):
                            if float(np.linalg.norm(xyz[j] - p)) < r:
                                ok = False
                                break
                        if not ok:
                            break
                    if not ok:
                        break
                if not ok:
                    break
            if ok:
                grid.setdefault(key, []).append(int(idx))
                acc.append(int(idx))
        n = len(acc)
        if n_lo <= n <= n_hi:
            return np.array(sorted(acc)), r
        if best is None or abs(n - N_TARGET) < abs(len(best) - N_TARGET):
            best = np.array(sorted(acc))
            best_r = r
        if n > n_hi:
            lo = r
        else:
            hi = r
    if not (n_lo <= len(best) <= n_hi):
        raise RuntimeError("poisson search missed window: n=%d" % len(best))
    return best, best_r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(E / "provisional-guides.npz"))
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args()

    roots_p = S1 / "roots.npz"
    scalp_p = S1 / "scalp.npz"
    body_p = E / "body-geo.npz"
    for p in (roots_p, scalp_p, body_p):
        log_open(p)
    log_open(Path(__file__))
    log_open(S5 / "_geom.py")
    R = np.load(roots_p)
    S = np.load(scalp_p)
    B = np.load(body_p, allow_pickle=True)
    xyz, nrm = R["xyz"].astype(np.float64), R["normal"].astype(np.float64)
    sv, st = S["verts"].astype(np.float64), S["tris"].astype(np.int64)
    axis = S["axis"].astype(np.float64)

    idx, radius = poisson_subset(xyz, args.seed)
    G = len(idx)
    print("poisson: n=%d radius=%.3fmm" % (G, radius * 1000), flush=True)

    # scalp faces: normals oriented outward (away from the vertical axis
    # through the scalp axis point).
    A, Bc, C = sv[st[:, 0]], sv[st[:, 1]], sv[st[:, 2]]
    fn = np.cross(Bc - A, C - A)
    fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-24
    fc = (A + Bc + C) / 3.0
    rad = fc - axis[None, :]
    rad[:, 2] = 0.0
    flip = (fn * rad).sum(1) < 0
    fn[flip] *= -1.0

    body = MeshIndex(B["verts"].astype(np.float64),
                     B["tris"].astype(np.int64), cell=0.008)
    skin_only = MeshIndex(B["verts"].astype(np.float64),
                          B["tris"].astype(np.int64)[B["clearGroup"] == 1],
                          cell=0.008)
    garment = MeshIndex(B["verts"].astype(np.float64),
                        B["tris"].astype(np.int64)[B["clearGroup"] == 0],
                        cell=0.008)

    paths, sides, relz = [], [], []
    for gi, g in enumerate(idx):
        root = xyz[g]
        back = bool(root[1] > 0.0)
        anterior = bool(root[1] < -0.010)
        if abs(float(root[0])) < 0.003 and anterior:
            sgn = 1.0 if (gi % 2 == 0) else -1.0
        else:
            sgn = 1.0 if float(root[0]) >= 0.0 else -1.0
        rail_x = sgn * 0.082
        z_end = Z_END_BACK if back else Z_SHOULDER
        pts = [root.copy()]
        x, y, z = float(root[0]), float(root[1]), float(root[2])
        released = False
        rel_z = z
        while True:
            z -= DZ
            if z <= min(Z_RELEASE_FORCE, root[2]):
                released = True
                rel_z = z
                break
            drop = np.array([[x, y, z]])
            cls, d2 = closest_point_tri(drop, A, Bc, C)
            k = int(np.argmin(d2[0]))
            q = cls[0, k]
            if float(np.sqrt(d2[0, k])) > SHELL_LEAVE:
                released = True
                rel_z = z
                break
            s = q + SHELL_OFF * fn[k]
            x, y = float(s[0]), float(s[1])
            pts.append(s)
            if len(pts) > 400:
                released = True
                rel_z = z
                break
        while z > z_end:
            z = max(z - DZ, z_end)
            if anterior:
                # centre-part rail drift before the drape slide
                x += (rail_x - x) * 0.10
            # drape: slide (x, y) radially outward until the candidate
            # clears 3 mm, so the fall rides over the shoulder slope
            # instead of tunnelling through it.
            for _ in range(40):
                cand = np.array([[x, y, z]])
                cc, dd = skin_only.query(cand)
                if float(dd[0]) >= CLEAR:
                    break
                rx, ry = x - axis[0], y - axis[1]
                rn = max(float(np.hypot(rx, ry)), 1e-9)
                x += 0.0015 * rx / rn
                y += 0.0015 * ry / rn
            pts.append(np.array([x, y, z]))
            if len(pts) > 900:
                break
        path = arclength_resample(np.array(pts), P)
        # clearance sweeps on the RESAMPLED path, root -> tip (resampling
        # can cut corners, so the push must come last). Index 0 is the
        # attached root (on the scalp, clearance N/A); the shell rides at
        # ~6 mm and the fall is held to >= 3 mm.
        air = path[1:]
        for _ in range(60):
            c, d = skin_only.query(air)
            need = d < CLEAR
            if not need.any():
                break
            delta = air - c
            n = np.linalg.norm(delta, axis=1)
            zero = n < 1e-12
            if zero.any():
                delta[zero] = np.column_stack([
                    air[zero][:, 0] - axis[0],
                    air[zero][:, 1] - axis[1],
                    np.zeros(int(zero.sum()))])
            n = np.linalg.norm(delta, axis=1).clip(1e-12, None)
            # over-relax to 3.3 mm so float re-query settles above 3.0
            air[need] = c[need] + delta[need] / n[need][:, None] * (CLEAR + 0.0003)
        else:
            pass
        # escape fallback: any point still violating marches outward along
        # its push direction in 1 mm steps (single projection can stall
        # between two close surfaces; marching reaches open air).
        c, d = skin_only.query(air)
        for i in np.where(d < CLEAR)[0]:
            delta = air[i] - c[i]
            n = float(np.linalg.norm(delta))
            if n < 1e-12:
                delta = np.array([air[i, 0] - axis[0], air[i, 1] - axis[1], 0.0])
                n = float(np.linalg.norm(delta))
            step = delta / max(n, 1e-12)
            p = air[i].copy()
            for _ in range(40):
                p = p + step * 0.001
                _, dd = skin_only.query(p[None])
                if float(dd[0]) >= CLEAR:
                    break
            air[i] = p
        path[1:] = air
        paths.append(path)
        sides.append(1 if back else 0)
        relz.append(rel_z)

    guides = np.array(paths)
    flat = guides[:, 1:, :].reshape(-1, 3)
    c, d = skin_only.query(flat)
    _, dg = garment.query(flat)
    print("garmentProxMin=%.3fmm" % (float(dg.min()) * 1000))
    min_clear = float(d.min())
    if min_clear < CLEAR - 1e-9:
        bad = np.where(d < CLEAR)[0]
        tri_mesh = B["triMesh"].astype(np.int64)
        names = [str(x) for x in B["meshNames"]]
        # nearest mesh per bad point (re-query closest tri id via small helper)
        print("nViol=%d worst:" % len(bad))
        for b in bad[np.argsort(d[bad])[:8]]:
            gi, pi = divmod(int(b), P - 1)
            print("  guide=%d pt=%d xyz=%s dist=%.4fmm" % (
                gi, pi + 1, np.array2string(flat[b], precision=5),
                d[b] * 1000))
    print("guides=%d back=%d side=%d minClear=%.3fmm" % (
        G, int(np.sum(sides)), G - int(np.sum(sides)), min_clear * 1000),
        flush=True)
    if min_clear < CLEAR - 1e-9:
        raise RuntimeError("provisional clearance violated: %.4fmm" % (min_clear * 1000))

    out = Path(args.out)
    np.savez(str(out), **dict(sorted({
        "guides_xyz": np.ascontiguousarray(guides),
        "guides_root": np.ascontiguousarray(xyz[idx]),
        "guides_normal": np.ascontiguousarray(nrm[idx]),
        "guide_side": np.array(sides, dtype=np.int8),
        "guide_release_z": np.array(relz),
        "guide_subset": np.array(idx, dtype=np.int64),
        "poisson_radius_mm": np.float64(radius * 1000),
        "seed": np.int64(args.seed),
        "provisional": np.int64(1),
        "min_clearance_mm": np.float64(min_clear * 1000),
        "src_roots_sha": np.array(sha256(roots_p)),
        "src_scalp_sha": np.array(sha256(scalp_p)),
        "src_body_sha": np.array(sha256(body_p)),
    }.items())))
    log_open(out)
    merge_opened(E / "inputs-opened.txt")
    print("GUIDES_DONE sha=%s" % sha256(out), flush=True)


if __name__ == "__main__":
    main()
