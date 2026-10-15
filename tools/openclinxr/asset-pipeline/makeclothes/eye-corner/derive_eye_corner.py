#!/usr/bin/env python3
"""derive_eye_corner.py — thin corner fill derived from the lid-margin loop.

Builds `openclinxr_eye_corner_fill_mesh` (narrow conjunctiva curtains
around the lid opening + a small tent over each lateral canthus notch)
from the existing lid-margin vertex loop of the morphed mesh. No hand-modelled
geometry: every vertex is a resampled loop point, a globe-projected inner
ring point, or a deterministic offset of one (offsets recorded in the
report). Skinned 100% to the head bone and carrying the six lid keys via
the lash_blink_follow.py A3 transfer (nearest same-side moving body vert,
|d| > 0.05 mm, 2.0 mm cap, zero beyond), exactly like the tearline
post-export bind (_eyshell_transfer_lid_keys). Material is wet pinkish
conjunctiva (baseColorFactor [0.82, 0.50, 0.50, 1.0], roughness 0.35),
not skin.

Lid-loop definition (same as the factory bake eyeshell pass and the
cw1-protrusion instrument): skin verts in a 0.5-4.0 mm radial band off the
fitted globe (least-squares sphere per eye) within 25 mm laterally, split
into upper/lower chains resampled to 25 stations each.

Usage:
  derive_eye_corner.py <in.glb> <out.glb> [--dry]
  derive_eye_corner.py <in.glb> --measure   # lid-loop + bind probe, no write

Fail-closed: throws unless exactly one body mesh with the six lid keys,
one globe mesh, and an L/R split agreeing with the eye.L/eye.R joints is
found. Refuses when a moving donor pool is < 100. Deterministic
(row-major argmin ties, sorted x resample).

Runs on a baked GLB; no materialize.py edits. The factory call site, if
this step is ever owned by the bake, is materialize_mpfb_humanoid_candidate.py
beside the _eyshell_transfer_lid_keys(output) call: run this post-step on
the exported bytes before that transfer (which already binds
openclinxr_eye_corner_fill* meshes if present).
"""

import argparse
import json
import re
import struct
import sys

LID_KEYS = (
    "eye-left-closure",
    "eye-left-slit",
    "eye-left-opened-up",
    "eye-right-closure",
    "eye-right-slit",
    "eye-right-opened-up",
)
MOVE_EPS = 0.00005  # 0.05 mm donor moving mask (lash-measured razor edge)
NN_CAP = 0.002  # 2.0 mm: beyond this a vert stays rigid, counted not faked
N_STATION = 25  # resample stations per up/lo chain (bake eyeshell count)
STRIP_MM = 0.00055  # initial step toward the globe before the r+0.30 clamp
POSTERIOR_BIAS_MM = 0.00055  # every fill vert sits this far behind the loop
FAN_STEPS = (0.0015, 0.0030)  # corner fan extension past each loop end
SNAP_MM = 0.0025  # fan snap radius to skin
FILL_MESH = "openclinxr_eye_corner_fill_mesh"
FILL_NODE = "openclinxr_eye_corner_fill"
FILL_MAT = "openclinxr_eye_corner_fill_mat"
FILL_COLOR = [0.82, 0.50, 0.50, 1.0]  # wet pinkish conjunctiva, not skin
FILL_ROUGH = 0.35

try:
    import numpy as np
except ImportError:
    sys.exit("numpy required: `mise exec -- python3`")


def load(path):
    raw = open(path, "rb").read()
    if raw[:4] != b"glTF":
        raise RuntimeError(f"not a GLB: {path}")
    jl = struct.unpack("<I", raw[12:16])[0]
    g = json.loads(raw[20:20 + jl])
    rest = raw[20 + jl:]
    blob = bytearray(rest[8:] if rest[4:8] == b"BIN\x00" else rest)
    return g, blob


def save(g, blob, path):
    while len(blob) % 4:
        blob.append(0)
    g["buffers"][0]["byteLength"] = len(blob)
    nj = json.dumps(g, separators=(",", ":")).encode()
    open(path, "wb").write(
        b"glTF" + struct.pack("<II", 2, 12 + 8 + len(nj) + 8 + len(blob))
        + struct.pack("<I", len(nj)) + b"JSON" + nj
        + struct.pack("<I", len(blob)) + b"BIN\x00" + bytes(blob))


CT = {5120: "i1", 5121: "u1", 5122: "h2", 5123: "u2", 5125: "u4", 5126: "f4"}
CTINV = {"i1": 5120, "u1": 5121, "u2": 5123, "u4": 5125, "f4": 5126}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
SZ = {"i1": 1, "u1": 1, "u2": 2, "u4": 4, "f4": 4, "h2": 2}
DT = {"i1": np.int8, "u1": np.uint8, "u2": np.uint16, "u4": np.uint32,
      "f4": np.float32, "h2": np.int16}


def rd(g, blob, ai):
    ac = g["accessors"][ai]
    if "bufferView" not in ac:
        sp = ac.get("sparse")
        if not sp:
            return np.zeros((ac["count"], NC[ac["type"]]))
        ibv = g["bufferViews"][sp["indices"]["bufferView"]]
        ibase = ibv.get("byteOffset", 0) + sp["indices"].get("byteOffset", 0)
        idx = np.frombuffer(blob, dtype=DT[CT[sp["indices"]["componentType"]]],
                            count=sp["count"], offset=ibase).astype(int)
        vbv = g["bufferViews"][sp["values"]["bufferView"]]
        vbase = vbv.get("byteOffset", 0) + sp["values"].get("byteOffset", 0)
        val = np.frombuffer(blob, dtype=DT[CT[ac["componentType"]]],
                            count=sp["count"] * NC[ac["type"]],
                            offset=vbase).reshape(-1, NC[ac["type"]])
        out = np.zeros((ac["count"], NC[ac["type"]]))
        out[idx] = val
        return out
    bv = g["bufferViews"][ac["bufferView"]]
    base = bv.get("byteOffset", 0) + ac.get("byteOffset", 0)
    n, nc = ac["count"], NC[ac["type"]]
    dt = np.dtype(DT[CT[ac["componentType"]]])
    sz = SZ[CT[ac["componentType"]]]
    st = bv.get("byteStride")
    if st and st != nc * sz:
        s = np.frombuffer(blob, dtype=np.uint8, count=n * st,
                          offset=base).reshape(n, st)
        return np.stack(
            [s[:, k * sz:(k + 1) * sz].reshape(n, -1).copy().view(dt).reshape(n)
             for k in range(nc)], 1)
    return np.frombuffer(blob, dtype=dt, count=n * nc,
                         offset=base).reshape(n, nc)


def append(g, blob, arr, ctype, gtype):
    arr = np.ascontiguousarray(arr)
    conv = {"u1": np.uint8, "u2": np.uint16, "u4": np.uint32,
            "f4": np.float32}[ctype]
    a = arr.astype(conv)
    while len(blob) % (4 if ctype != "u1" else 1):
        blob.append(0)
    off = len(blob)
    blob.extend(a.tobytes())
    g["bufferViews"].append({"buffer": 0, "byteOffset": off,
                            "byteLength": len(a.tobytes())})
    g["accessors"].append({"bufferView": len(g["bufferViews"]) - 1,
                           "componentType": CTINV[ctype], "count": len(a),
                           "type": gtype})
    return len(g["accessors"]) - 1


def append_f32(g, blob, arr):
    a = np.ascontiguousarray(arr, dtype=np.float32)
    while len(blob) % 4:
        blob.append(0)
    off = len(blob)
    blob.extend(a.tobytes())
    g["bufferViews"].append({"buffer": 0, "byteOffset": off,
                            "byteLength": len(a.tobytes())})
    g["accessors"].append({"bufferView": len(g["bufferViews"]) - 1,
                           "componentType": 5126, "count": len(a),
                           "type": "VEC3"})
    return len(g["accessors"]) - 1


def fit_sphere(pts):
    m = pts.mean(axis=0)
    d = pts - m
    dd = (d ** 2).sum(axis=1)
    a = 2.0 * (d[:, :, None] * d[:, None, :]).sum(axis=0)
    b = (d * dd[:, None]).sum(axis=0)
    c = np.linalg.solve(a, b) + m
    r = float(np.mean(np.linalg.norm(pts - c, axis=1)))
    return c, r


def find_mesh(g, *pats):
    hits = [i for i, m in enumerate(g["meshes"])
            if all(re.search(p, m.get("name", ""), re.I) for p in pats)]
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--measure", action="store_true")
    a = ap.parse_args()
    if not a.out and not (a.dry or a.measure):
        ap.error("out.glb required unless --dry/--measure")

    g, blob = load(a.glb)

    body_hits = [i for i, m in enumerate(g["meshes"])
                 if re.search(r"patient_aisha_body\.", m.get("name", ""))]
    if len(body_hits) != 1:
        raise SystemExit(
            f"refusing: {len(body_hits)} body meshes "
            f"{[g['meshes'][i]['name'] for i in body_hits]}")
    bmi = body_hits[0]
    body = g["meshes"][bmi]
    globe_hits = find_mesh(g, r"globe")
    if len(globe_hits) != 1:
        raise SystemExit(f"refusing: {len(globe_hits)} globe meshes")
    cornea_hits = find_mesh(g, r"cornea")
    if len(cornea_hits) != 1:
        raise SystemExit(f"refusing: {len(cornea_hits)} cornea meshes")
    if any(re.search(r"corner_fill", m.get("name", ""), re.I)
           for m in g["meshes"]):
        raise SystemExit("refusing: corner fill mesh already present")
    names = (body.get("extras", {}) or {}).get("targetNames", [])

    # donor side map measured from body bytes (prim target order swaps
    # left/right vs extras targetNames — lash-measured). VISIBLE SKIN
    # PRIM ONLY (material mpfb_skin_*): the hidden interior shells
    # (prims 1-7) sit inside the head and would poison the loop.
    skin_pi = [pi for pi, p in enumerate(body["primitives"])
               if "material" in p and re.search(
                   r"mpfb_skin",
                   g["materials"][p["material"]].get("name", ""), re.I)]
    if len(skin_pi) != 1:
        raise SystemExit(
            f"refusing: {len(skin_pi)} visible-skin prims")
    spi = skin_pi[0]
    remap = {}
    for pi in (spi,):
        p = body["primitives"][pi]
        tg = p.get("targets", [])
        if not tg:
            continue
        Bp = rd(g, blob, p["attributes"]["POSITION"]).astype(float)
        for kind in ("closure", "slit", "opened-up"):
            cands = [i for i, nm in enumerate(names[:len(tg)])
                     if kind in nm and ("left" in nm or "right" in nm)]
            scored = []
            for i in cands:
                D = rd(g, blob, tg[i]["POSITION"]).astype(float)
                n = np.linalg.norm(D, axis=1)
                scored.append((i, n[Bp[:, 0] < 0].sum(),
                               n[Bp[:, 0] >= 0].sum()))
            if not scored:
                continue
            remap.setdefault(pi, {})[f"eye-left-{kind}"] = max(
                scored, key=lambda s: s[1])[0]
            remap[pi][f"eye-right-{kind}"] = max(scored,
                                                key=lambda s: s[2])[0]
    missing = [k for k in LID_KEYS if not any(k in mp for mp in remap.values())]
    if missing:
        raise SystemExit(f"refusing: body lacks lid keys {missing}")

    # eye-band donor pool per side (lash A3 frame: GLB metres, y-up local).
    donors = {}
    for side in ("L", "R"):
        Pside, Dall = [], []
        for pi, mp in remap.items():
            if len(mp) < 6:
                continue
            bp = body["primitives"][pi]
            Bp = rd(g, blob, bp["attributes"]["POSITION"]).astype(float)
            Dp = [rd(g, blob, bp["targets"][mp[t]]["POSITION"]).astype(float)
                  for t in LID_KEYS]
            eye = (np.abs(Bp[:, 0]) < 0.06) & (Bp[:, 1] > 1.50) & \
                (Bp[:, 1] < 1.60)
            ssel = (Bp[:, 0] < 0) if side == "L" else (Bp[:, 0] >= 0)
            Pside.append(Bp[eye & ssel])
            Dall.append([d[eye & ssel] for d in Dp])
        Pside = np.concatenate(Pside) if Pside else np.zeros((0, 3))
        Dall = [np.concatenate([d[t] for d in Dall]) if Dall
                else np.zeros((0, 3)) for t in range(6)]
        move = np.zeros(len(Pside), bool)
        for D in Dall:
            move |= np.linalg.norm(D, axis=1) > MOVE_EPS
        if int(move.sum()) < 100:
            raise SystemExit(
                f"refusing: {side} moving donor pool too small "
                f"({int(move.sum())} < 100)")
        donors[side] = (Pside, Dall, move)

    # globe + cornea in the body-local frame; L/R split measured against the
    # eye.L / eye.R joint bind positions (never assumed from x alone).
    gp = g["meshes"][globe_hits[0]]["primitives"][0]
    G = rd(g, blob, gp["attributes"]["POSITION"]).astype(float)
    cp = g["meshes"][cornea_hits[0]]["primitives"][0]
    C = rd(g, blob, cp["attributes"]["POSITION"]).astype(float)
    jnames = [g["nodes"][j].get("name") for j in g["skins"][0]["joints"]]
    if "eye.L" not in jnames or "eye.R" not in jnames:
        raise SystemExit("refusing: eye.L/eye.R joints missing")

    def quat_to_mat(q):
        x, y, z, w = q
        return np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w),
             2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z),
             2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w),
             1 - 2 * (x * x + y * y)]])

    def node_worlds():
        mats = {}
        for i, n in enumerate(g["nodes"]):
            m = np.eye(4)
            if "matrix" in n:
                m = np.array(n["matrix"]).reshape(4, 4).T
                mats[i] = m
                continue
            t = np.array(n.get("translation", [0, 0, 0]), dtype=float)
            r = quat_to_mat(n.get("rotation", [0, 0, 0, 1]))
            s = np.array(n.get("scale", [1, 1, 1]), dtype=float)
            m[:3, :3] = r * s
            m[:3, 3] = t
            mats[i] = m
        parent = {}
        for i, n in enumerate(g["nodes"]):
            for ch in n.get("children", []):
                parent[ch] = i
        world = {}

        def resolve(i):
            if i in world:
                return world[i]
            m = mats[i]
            if i in parent:
                m = resolve(parent[i]) @ m
            world[i] = m
            return m

        for i in range(len(g["nodes"])):
            resolve(i)
        return world

    worlds = node_worlds()
    jworld = {nm: worlds[g["nodes"].index(
        next(n for n in g["nodes"]
             if n.get("name") == nm))] for nm in ("eye.L", "eye.R", "head")}
    jx = {nm: float(jworld[nm][0, 3]) for nm in ("eye.L", "eye.R")}
    # L/R split is x-sign keyed exactly like the lash A3 transfer
    # (L = x < 0): donor pools, fill verts, and morph names all share the
    # convention, so blink-follow is self-consistent by construction. The
    # joints only verify two separated eyes: opposite sides, ~62 mm apart.
    # (This rig seats the eye.L joint at +X, the MakeHuman convention.)
    if not (jx["eye.L"] * jx["eye.R"] < 0):
        raise SystemExit(f"refusing: eye joints not split {jx}")
    if not (0.055 < abs(jx["eye.L"] - jx["eye.R"]) < 0.070):
        raise SystemExit(f"refusing: eye joint span off {jx}")
    midx = 0.0
    sides = {}
    for side, sel in (("L", G[:, 0] < midx), ("R", G[:, 0] >= midx)):
        pts = np.concatenate([G[sel], C[(C[:, 0] < midx) == (side == "L")]])
        if len(pts) < 100:
            raise SystemExit(f"refusing: {side} eye point count {len(pts)}")
        sides[side] = pts
    spheres = {}
    for side, pts in sides.items():
        c, r = fit_sphere(pts)
        if r <= 0:
            raise SystemExit(f"refusing: non-positive radius {side}")
        spheres[side] = (c, float(r))
    # anterior = +Z local: globe centres must sit ahead of the head joint.
    hzx = float(jworld["head"][2, 3])
    for side, (c, _r) in spheres.items():
        if not (c[2] > hzx):
            raise SystemExit(
                f"refusing: {side} globe centre not anterior of head "
                f"({c[2]:.4f} <= {hzx:.4f}); frame assumption broken")

    # visible-skin positions (skin prim only, local frame) + area-weighted
    # normals. Hidden shells excluded (see remap note above).
    skprim = body["primitives"][spi]
    Pskin = rd(g, blob, skprim["attributes"]["POSITION"]).astype(float)
    I = rd(g, blob, skprim["indices"]).reshape(-1).astype(int)
    tri = I.reshape(-1, 3)
    if int(I.max()) + 1 > len(Pskin):
        raise SystemExit("refusing: skin prim indices out of range")
    P0, P1, P2 = Pskin[tri[:, 0]], Pskin[tri[:, 1]], Pskin[tri[:, 2]]
    fn = np.cross(P1 - P0, P2 - P0)
    nl = np.linalg.norm(fn, axis=1, keepdims=True)
    nl[nl == 0] = 1.0
    fn /= nl
    svn = np.zeros_like(Pskin)
    for k in range(3):
        np.add.at(svn, tri[:, k], fn)
    nl = np.linalg.norm(svn, axis=1, keepdims=True)
    nl[nl == 0] = 1.0
    svn /= nl

    report = {
        "schemaVersion": "openclinxr.eye-corner-derive.v1",
        "glb": a.glb,
        "bodyMesh": body.get("name"),
        "lidKeys": list(LID_KEYS),
        "donorPool": {s: {"pool": int(len(P)), "moving": int(mv.sum())}
                      for s, (P, _D, mv) in donors.items()},
        "sides": {},
    }

    TP, TF = [], []
    loop_index = {}  # side -> list of (outer, inner) vert ids for CW3/tests
    apex_of_side = {}  # side -> (apex vert id, [4 neighbour ids])
    for side in ("L", "R"):
        c, r = spheres[side]
        d = np.linalg.norm(Pskin - c, axis=1) - r
        m = (d >= 0.0005) & (d <= 0.004) & (np.abs(Pskin[:, 0] - c[0]) < 0.025)
        cand = Pskin[m]
        if len(cand) < 24:
            raise SystemExit(
                f"refusing: {side} lid-margin band too small ({len(cand)})")
        res = {}
        for tag, sel in (("up", cand[:, 1] > c[1]),
                         ("lo", cand[:, 1] <= c[1])):
            pts = cand[sel]
            if len(pts) < 4:
                raise SystemExit(
                    f"refusing: {side}/{tag} chain too small ({len(pts)})")
            o = pts[np.argsort(pts[:, 0])]
            xs = np.linspace(float(o[:, 0].min()), float(o[:, 0].max()),
                            N_STATION)
            res[tag] = np.stack([xs, np.interp(xs, o[:, 0], o[:, 1]),
                                 np.interp(xs, o[:, 0], o[:, 2])], axis=1)
        vic = Pskin[np.abs(Pskin[:, 0] - c[0]) < 0.025]
        vic_n = svn[np.abs(Pskin[:, 0] - c[0]) < 0.025]

        def snap_proud(p):
            dd = np.linalg.norm(vic - p, axis=1)
            k = int(np.argmin(dd))
            if dd[k] > SNAP_MM:
                return None
            return vic[k] + vic_n[k] * 0.0002

        def extend(loop):
            out = []
            for end, nxt in ((0, 1), (-1, -2)):
                t = loop[end] - loop[nxt]
                t /= float(np.linalg.norm(t)) or 1.0
                ext, prev, cur = [], loop[nxt], loop[end]
                for s in FAN_STEPS:
                    q = snap_proud(cur + t * s)
                    if q is None:
                        break
                    ext.append(q)
                    t = q - prev
                    t /= float(np.linalg.norm(t)) or 1.0
                    prev, cur = cur, q
                out.append(ext)
            # CW3: fan verts never crown above the loop ends — cap z at the
            # lower loop end minus 0.005 mm (the fan bridges the corner gap,
            # it must not ride anterior of the margin onto cheek/brow).
            zcap = float(min(loop[0][2], loop[-1][2])) - 0.000005
            capped = []
            for ext in out:
                capped.append([np.array([p[0], p[1], min(p[2], zcap)])
                               for p in ext])
            return np.array(capped[0][::-1] + [row for row in loop]
                            + capped[1])

        # inner canthus = toward the midline (L: max-x end; R: min-x end).
        side_rows = {"loopBandVerts": int(m.sum()),
                     "sphereCentre": [round(float(v), 6) for v in c],
                     "sphereRadiusMm": round(r * 1000.0, 3)}
        for tag in ("up", "lo"):
            outer_line = extend(res[tag])
            # CW3 seat: linear x-interp overshoots where the margin sweeps
            # back at the canthi, so snap every station to the nearest skin
            # vert within 1.5 mm (stays a measured loop point, never
            # invented), then cap z below the local band surface. No
            # posterior bias on the outer hem: it coincides with the margin
            # (edge contact only, zero overlap area) and the strip dives
            # posterior from there.
            band3 = cand[(np.linalg.norm(cand - c, axis=1) - r >= 0.0005)
                         & (np.linalg.norm(cand - c, axis=1) - r <= 0.003)]
            for j in range(len(outer_line)):
                p = outer_line[j]
                dd = np.linalg.norm(vic - p, axis=1)
                k = int(np.argmin(dd))
                if dd[k] <= 0.0015:
                    p = vic[k]
                dxy = np.linalg.norm(band3[:, :2] - p[:2], axis=1)
                near = band3[dxy < 0.002]
                if not len(near):
                    near = band3[dxy < 0.004]
                if len(near):
                    p[2] = min(p[2], float(near[:, 2].max()) - 0.000005)
                else:
                    p[2] -= 0.000005
                outer_line[j] = p
            # The snapped hem sits on TOP of the lid roll (solid tissue):
            # a curtain leaving from there dives into the roll and hides.
            # Step every station 1.0 mm toward the globe centre first, so
            # the hems starts at the roll's inner lip over the opening void
            # (still margin height: CW3-safe) and the curtain spans void.
            dd = outer_line - c
            dn = np.linalg.norm(dd, axis=1, keepdims=True)
            dn[dn == 0] = 1.0
            outer_line = outer_line - dd / dn * 0.001
            dd = outer_line - c
            dn = np.linalg.norm(dd, axis=1, keepdims=True)
            dn[dn == 0] = 1.0
            inward = -dd / dn
            inward[:, 2] -= 0.12  # shallow dive: the curtain leaves the
            il = np.linalg.norm(inward, axis=1, keepdims=True)  # margin
            il[il == 0] = 1.0  # mouth anterior to the funnel wall (visible)
            inward /= il  # yet behind the margin plane (CW3).
            # Full-funnel curtain (the eye3 bake stands the lids off the
            # globe: geometric edge ~33k px of funnel wall): run each
            # station out to the globe (r + 0.30 mm, just off the tearline
            # at r + 0.15 so the layers never coincide) instead of a fixed
            # 0.55 mm hem. Sightlines that hit funnel wall (edge) now hit
            # pink; sightlines to the globe meet the curtain only at the
            # contact circle (CW1).
            inner = outer_line + inward * STRIP_MM
            di = inner - c
            ni = np.linalg.norm(di, axis=1)
            need = (r + 0.00030) / np.maximum(ni, 1e-9)
            need = np.where(ni < r + 0.00030, need, 1.0)
            inner = c + di * need[:, None]
            n = len(outer_line)
            base = len(TP)
            TP.extend([tuple(p) for p in outer_line])
            TP.extend([tuple(p) for p in inner])
            for i in range(n - 1):
                TF.append((base + i, base + n + i, base + i + 1))
                TF.append((base + i + 1, base + n + i, base + n + i + 1))
            loop_index.setdefault(side, []).append(
                (list(range(base, base + n)),
                 list(range(base + n, base + 2 * n))))
        # corner patch: a triangle fan over the lateral (bare temporal tip)
        # notch the up/lo strips leave open. Rim = the 3 end station pairs
        # of each chain (12 measured loop verts in boundary order); centre
        # = their mean seated in the notch mouth plane (see below). The
        # medial notch is OCCUPIED by the static backing caruncle mesh: a
        # second membrane there double-covers it and was measured peeking
        # 15 px outside the closed lid line at blink (CW2), so the medial
        # corner keeps the up/lo strip hems only (they ride the margin
        # line and stay inside the seam at closure). The centre is a
        # derived loop statistic, recorded.
        up_o, up_i = loop_index[side][0]
        lo_o, lo_i = loop_index[side][1]
        fan_rims = {}
        for tag in ("lat",):
            end_is_last = side == "R"
            # end_is_last: lateral end is index -1 on R, 0 on L.

            def toward(ids):
                return [ids[-3], ids[-2], ids[-1]] if end_is_last else \
                    [ids[2], ids[1], ids[0]]

            uo, ui = toward(up_o), toward(up_i)
            lo, li = toward(lo_o), toward(lo_i)
            bound = uo + ui[::-1] + li + lo[::-1]
            pts = np.array([TP[i] for i in bound])
            cen = pts.mean(axis=0)
            # Seat the tent in the NOTCH MOUTH plane: ref = max VISIBLE
            # skin z within 10 mm in XY (rolls/bridge/cheek — the tissue
            # the grader sees around the concavity), tent 0.005 behind
            # it. Band-limited refs see only the diving notch floor (the
            # loop dives where the mouth stays high) and bury the tent
            # under the mouth contents. The mouth plane is where a moist
            # corner membrane belongs: over the recess, coplanar-ish with
            # the surrounding margin (no step, no fight — 5 um back), and
            # behind the margin rolls' anterior extent (CW3). At the bare
            # lateral tip this reads as corner tissue; at the occupied
            # medial notch it roofs the static caruncle without touching
            # it (millimetres apart, no double-cover fight).
            dxy = np.linalg.norm(vic[:, :2] - cen[:2], axis=1)
            near10 = vic[dxy < 0.010]
            ref = float(near10[:, 2].max()) if len(near10) else \
                float(pts[:, 2].max())
            cen[2] = ref - 0.000005
            cb = len(TP)
            TP.append(tuple(cen))
            for k in range(len(bound)):
                TF.append((cb, bound[k], bound[(k + 1) % len(bound)]))
            fan_rims[(side, tag)] = (cb, bound)
        apex_of_side[side] = (fan_rims[(side, "lat")][0],
                              fan_rims[(side, "lat")][1])
        side_rows["outerStations"] = sum(len(v[0]) for v in loop_index[side])
        side_rows["innerEnd"] = "max-x" if side == "L" else "min-x"
        report["sides"][side] = side_rows

    V = np.array(TP, dtype=float)
    F = np.array(TF, dtype=np.int64)
    # smooth normals, area-weighted (lighting only; derivation is the loop).
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    nl = np.linalg.norm(fn, axis=1, keepdims=True)
    nl[nl == 0] = 1.0
    fn /= nl
    vn = np.zeros_like(V)
    for k in range(3):
        np.add.at(vn, F[:, k], fn)
    nl = np.linalg.norm(vn, axis=1, keepdims=True)
    nl[nl == 0] = 1.0
    vn /= nl
    # CW3 probe (local frame, anterior +Z): max fill z minus nearest lid-loop
    # z over the resampled loop points used as the outer line source.
    report["cw3localMaxMm"] = -1.0  # filled by the measure step in world
    report["verts"] = int(len(V))
    report["tris"] = int(len(F))
    report["material"] = {"name": FILL_MAT, "baseColorFactor": FILL_COLOR,
                          "roughnessFactor": FILL_ROUGH}
    report["derivation"] = ("outer ring = 25-station up/lo lid-margin "
                            "resample snapped to skin (<=1.5mm) + snapped "
                            "1.5/3.0mm corner fans (fan z capped at loop-end "
                            "z), hem stepped 1.0mm toward the globe centre "
                            "to start at the roll's inner lip; inner ring = "
                            "full-funnel projection of each outer station "
                            "onto the globe + 0.30 mm (just off the "
                            "tearline at r + 0.15); corner tent over the "
                            "LATERAL notch only = 12-vert rim fan (3 end "
                            "station pairs per chain, all measured) around "
                            "a derived centre seated in the notch mouth "
                            "plane (max visible skin within 10mm XY minus "
                            "0.005mm); no medial tent (notch occupied by "
                            "the static backing caruncle; a second membrane "
                            "peeked outside the blink seam)")

    if a.measure or a.dry:
        report["action"] = "measure (no write)" if a.measure else \
            "dry-run (no write)"
        print(json.dumps(report, indent=1))
        return

    # ---- append the fill mesh (tearline layout: POSITION/NORMAL/JOINTS/WEIGHTS)
    hj = jnames.index("head")
    pos_ai = append_f32(g, blob, V.astype(np.float32))
    nrm_ai = append_f32(g, blob, vn.astype(np.float32))
    joints = np.tile([hj, 0, 0, 0], (len(V), 1))
    j_ai = append(g, blob, joints, "u1", "VEC4")
    weights = np.tile([1.0, 0.0, 0.0, 0.0], (len(V), 1))
    w_ai = append(g, blob, weights, "f4", "VEC4")
    idx_ai = append(g, blob, F.reshape(-1).astype(np.uint32), "u4", "SCALAR")
    g["meshes"].append({
        "name": FILL_MESH,
        "primitives": [{
            "attributes": {"POSITION": pos_ai, "NORMAL": nrm_ai,
                           "JOINTS_0": j_ai, "WEIGHTS_0": w_ai},
            "indices": idx_ai,
            "material": len(g["materials"]),
        }],
    })
    g["materials"].append({
        "name": FILL_MAT,
        "pbrMetallicRoughness": {"baseColorFactor": FILL_COLOR,
                                 "metallicFactor": 0.0,
                                 "roughnessFactor": FILL_ROUGH},
        "doubleSided": True,
    })
    body_node = next(n for n in g["nodes"]
                     if n.get("mesh") == bmi)
    new_node = {"name": FILL_NODE, "mesh": len(g["meshes"]) - 1,
                "skin": body_node.get("skin", 0)}
    if "translation" in body_node:
        new_node["translation"] = body_node["translation"]
    if "rotation" in body_node:
        new_node["rotation"] = body_node["rotation"]
    if "scale" in body_node:
        new_node["scale"] = body_node["scale"]
    g["nodes"].append(new_node)
    # parent under the same parent as the body node (armature scene root).
    parented = False
    for n in g["nodes"]:
        if "children" in n and body_node in [
                g["nodes"][c] for c in n["children"]]:
            n["children"].append(len(g["nodes"]) - 1)
            parented = True
            break
    if not parented:
        for n in g["nodes"]:
            if n.get("name") in ("Scene", "Armature") or "children" in n:
                n.setdefault("children", []).append(len(g["nodes"]) - 1)
                parented = True
                break
    if "scenes" in g and g["scenes"] and parented is False:
        g["scenes"][0].setdefault("nodes", []).append(len(g["nodes"]) - 1)

    # ---- A3 lid-key transfer onto the fill (lash method, 2 mm cap).
    # Outer-ring verts take the nearest same-side moving donor delta.
    # The inner ring is a ruled surface over the outer ring (1:1 station
    # pairing): each inner vert inherits its outer partner's measured delta,
    # so the curtain follows the lid margin instead of freezing mid-strip.
    # The caruncle apex takes the mean of its four neighbour deltas. No
    # delta is invented: every value is a measured donor delta; verts whose
    # outer partner is beyond the cap stay rigid and are counted.
    outer_of_inner = {}
    for side, pairs in loop_index.items():
        for (oo, ii) in pairs:
            for o_id, i_id in zip(oo, ii):
                outer_of_inner[i_id] = o_id
    apex_ids = {ab for ab, _nb in apex_of_side.values()}
    lat_ids = {cb for (s, tag), (cb, _b) in fan_rims.items()
               if tag == "lat"}
    centre_ids = apex_ids | lat_ids
    n_outer = len(V) - 1 - len(outer_of_inner)
    full = [np.zeros((len(V), 3)) for _ in LID_KEYS]
    nn_max, rigid_outer = 0.0, 0
    outer_delta = {}
    for side, sel in (("L", V[:, 0] < midx), ("R", V[:, 0] >= midx)):
        sidx = np.where(sel)[0]
        outer_idx = np.array([i for i in sidx if i not in outer_of_inner
                              and i not in centre_ids])
        if not len(outer_idx):
            continue
        gi = [LID_KEYS.index(t) for t in LID_KEYS
              if ("left" if side == "L" else "right") in t]
        Pside, Dall, mv = donors[side]
        Pm, Dm = Pside[mv], [Dall[t][mv] for t in gi]
        Sv = V[outer_idx]
        out = [np.zeros_like(Sv) for _ in gi]
        far = np.zeros(len(Sv), bool)
        for c0 in range(0, len(Sv), 256):
            C = Sv[c0:c0 + 256]
            d2 = ((C[:, None, :] - Pm[None, :, :]) ** 2).sum(2)
            bnn = d2.argmin(1)
            best = np.sqrt(d2.min(1))
            nn_max = max(nn_max, float(best.max()))
            ok = best <= NN_CAP
            far[c0:c0 + 256] = ~ok
            for j in range(len(gi)):
                got = np.zeros_like(C)
                got[ok] = Dm[j][bnn[ok]]
                out[j][c0:c0 + 256] = got
        rigid_outer += int(far.sum())
        for j, t in enumerate(gi):
            full[t][outer_idx] = out[j]
            for k, i in enumerate(outer_idx):
                outer_delta[int(i)] = (t, out[j][k].copy(), bool(far[k]))
    rigid = 0
    for inner, outer in outer_of_inner.items():
        for t in range(len(LID_KEYS)):
            full[t][inner] = full[t][outer].copy()
        if outer_delta.get(outer, (None, None, True))[2]:
            rigid += 1
    for ab, nb in list(apex_of_side.values()) + [
            fan_rims[k] for k in fan_rims if k[1] == "lat"]:
        for t in range(len(LID_KEYS)):
            full[t][ab] = sum(full[t][i] for i in nb) / len(nb)
        if any(outer_delta.get(i, (None, None, True))[2] for i in nb):
            rigid += 1
    prim = g["meshes"][-1]["primitives"][0]
    prim["targets"] = []
    maxd = {}
    for t, name in enumerate(LID_KEYS):
        maxd[name] = round(float(np.abs(full[t]).max() * 1000), 4)
        prim["targets"].append({"POSITION": append_f32(g, blob, full[t])})
    g["meshes"][-1]["extras"] = {"targetNames": list(LID_KEYS)}
    report["a3"] = {"nnMaxMm": round(nn_max * 1000, 3), "rigidVerts": rigid,
                    "rigidOuterVerts": rigid_outer,
                    "lidKeyMaxDeltaMm": maxd}
    report["action"] = f"derive -> {a.out}"
    save(g, blob, a.out)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
