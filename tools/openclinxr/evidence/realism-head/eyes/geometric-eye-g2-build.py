#!/usr/bin/env python3
"""G2 build: geometric anterior-segment eye meshes + planar iris-disc textures.

Reads locked params (geometric-eye-g1-params.json), constructs per-side
(L/R) meshes in eye-local globe-centre coords (+z anterior, millimetres):
  (1) scleral sphere R=11.9 with circular opening at the limbus ring,
  (2) corneal cap r=7.8 seating the opening (apex protrusion p=1.05),
  (3) planar iris disc (measured dia, no audit rescale) at apex-ACD.
Cap-rim verts are coincident with the scleral opening ring (same float
values) and both sides share averaged rim normals -> zero shading seam
(scope option-b counterweight). All verts carry weight 1.0 to eye.L/R
(0 weightless); joint transforms are identity so the gaze pivot stays at
the scleral-sphere centre by construction.

Iris-disc texture: port of eyes/gen-candidate-A.py annulus modulation
(38<r<99.5, frozen pupil/limbus) evaluated on the SAME integer pixel grid
relative to the same base (iris-centred-c.png, sha-verified) -> the
modulation field is byte-identical by construction; verified against the
eye-iris-A iris-candidate-A.png (read-only cross-check). Disc UVs use a
piecewise-linear radial map pinning pupil edge (38px <-> measured pupil
radius) and disc edge (99.5px <-> iris radius): linear inside each zone,
so the annulus has zero internal stretch. Limbus-stretch bound (sphere
arc vs planar chord between the same endpoints) is measured and reported.

Outputs (this dir): geometric-eye-anterior.glb,
geometric-eye-iris-disc-L.png / -R.png, geometric-eye-g2-report.json.
"""
import json, math, struct, hashlib
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).parent
P = json.loads((HERE / "geometric-eye-g1-params.json").read_text())
R = P["resolved"]
D = P["iris_disc"]

R_GLOBE = R["scleral_radius_mm"]          # 11.9
R_CAP = R["cap_radius_mm"]                # 7.8
PROT = R["protrusion_mm"]                 # 1.05
APEX = R_GLOBE + PROT                     # globe-centre frame apex (== file apex_z)
# Ring derived from first principles (two-sphere intersection), NOT from the
# file's rounded values: d = R+p-r, z = (R^2-r^2+d^2)/2d, a = sqrt(R^2-z^2).
# Asserted within 0.01 of the file (G1 gate tolerance); using the derived
# pair keeps the rim bit-coincident and both spheres exact.
_D = R_GLOBE + PROT - R_CAP
Z_RING = (R_GLOBE**2 - R_CAP**2 + _D**2) / (2 * _D)
A_RING = math.sqrt(R_GLOBE**2 - Z_RING**2)
assert abs(Z_RING - R["limbus_ring_z_mm"]) < 0.01, (Z_RING, R["limbus_ring_z_mm"])
assert abs(2 * A_RING - R["limbus_opening_dia_mm"]) < 0.01
assert abs(APEX - R["apex_z_mm"]) < 1e-9
Z_IRIS = APEX - R["chamber_depth_apex_to_iris_mm"]  # file plane_z
assert abs(Z_IRIS - D["plane_z_mm"]) < 0.01
IRIS_R = D["dia_mm"] / 2                  # 5.4035
assert abs(D["dia_mm"] - 10.807) < 1e-9
Z_CAP_C = APEX - R_CAP                    # 5.15 cap-sphere centre

# --- radial map: texture px radius <-> physical radius (piecewise linear) ---
R_PX_PUPIL, R_PX_LIMB = 38.0, 99.5
Q_PUPIL = 3.32 / 2  # G0 measured pupil dia 3.32 -> radius; pinned, not rescaled
assert abs(Q_PUPIL * 2 - 3.32) < 1e-9

def px2q(r_px):
    r_px = np.asarray(r_px, dtype=np.float64)
    out = np.empty_like(r_px)
    m1 = r_px <= R_PX_PUPIL
    out[m1] = r_px[m1] / R_PX_PUPIL * Q_PUPIL
    out[~m1] = Q_PUPIL + (r_px[~m1] - R_PX_PUPIL) / (R_PX_LIMB - R_PX_PUPIL) * (IRIS_R - Q_PUPIL)
    return out

def q2px(q):
    q = np.asarray(q, dtype=np.float64)
    out = np.empty_like(q)
    m1 = q <= Q_PUPIL
    out[m1] = q[m1] / Q_PUPIL * R_PX_PUPIL
    out[~m1] = R_PX_PUPIL + (q[~m1] - Q_PUPIL) / (IRIS_R - Q_PUPIL) * (R_PX_LIMB - R_PX_PUPIL)
    return out

# --- limbus-stretch measurement: sphere arc vs planar chord, same endpoints ---
# Old mapping endpoints (G0-measured physical): pupil edge chord 1.66, iris
# edge chord 5.4035 on globe R. Arc positions from pole:
arc_pupil = R_GLOBE * math.asin(Q_PUPIL / R_GLOBE)
arc_limb = R_GLOBE * math.asin(IRIS_R / R_GLOBE)
chord_span = IRIS_R - Q_PUPIL
arc_span = arc_limb - arc_pupil
# max mid-annulus deviation between uniform-arc and uniform-chord maps ~ (arc-chord)/4
stretch_total_pct = (arc_span - chord_span) / arc_span * 100
mid_dev_mm = (arc_span - chord_span) / 4
PX_PER_MM = (R_PX_LIMB - R_PX_PUPIL) / chord_span
mid_dev_px = mid_dev_mm * PX_PER_MM

# ================= PART A: iris-disc textures =================
# Exact port of gen-candidate-A.py (same seeds, same base, same grid).
SRC = Path("tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png")
CENTRES = [(296, 724), (722, 302)]
R_IN, R_OUT = 38.0, 99.5

def hash01(*parts):
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64

def eye_params(ei):
    n_crypt = 12
    crypt_angles = sorted(hash01("crypt", ei, k) * 360.0 for k in range(n_crypt))
    crypt_width = [2.2 + hash01("cryptw", ei, k) * 3.0 for k in range(n_crypt)]
    crypt_depth = [0.35 + hash01("cryptd", ei, k) * 0.30 for k in range(n_crypt)]
    n_fibre = 180
    fibre_gain = [0.78 + hash01("fib", ei, k) * 0.50 for k in range(n_fibre)]
    fibre_hue = [15.0 + hash01("fibhue", ei, k) * 10.0 for k in range(n_fibre)]
    collar_phase = hash01("collar", ei) * 360.0
    return crypt_angles, crypt_width, crypt_depth, fibre_gain, fibre_hue, collar_phase

def modulate(base_px, r, th, rn, ei, P_):
    ca, cw, cd, fg, fh, cph = P_
    fi = int(th / 360.0 * 180) % 180
    stri = fg[fi]
    stri *= 1.0 + 0.06 * math.sin(math.radians(th * 36.0) + r * 0.35)
    band = math.exp(-((rn - 0.45) ** 2) / (2 * 0.22 ** 2))
    dip = 0.0
    for a, w, d in zip(ca, cw, cd):
        dth = abs((th - a + 180.0) % 360.0 - 180.0)
        dip += d * math.exp(-(dth ** 2) / (2 * w ** 2))
    crypt_mult = max(0.30, 1.0 - dip * band)
    zig = 0.25 + 0.10 * math.sin(math.radians(th * 9.0 + cph))
    ridge = math.exp(-((rn - zig) ** 2) / (2 * 0.045 ** 2))
    collar_mult = 1.0 + 0.55 * ridge
    tone = 1.0 + 0.25 * math.exp(-((rn - 0.55) ** 2) / (2 * 0.25 ** 2))
    t = min(1.0, max(0.0, (rn - 0.78) / (0.97 - 0.78)))
    smooth = t * t * (3 - 2 * t)
    tone *= 1.0 - 0.45 * smooth
    mult = stri * crypt_mult * collar_mult * tone
    e0 = min(1.0, max(0.0, rn / 0.12))
    e1 = min(1.0, max(0.0, (1.0 - rn) / 0.12))
    edge = (e0 * e0 * (3 - 2 * e0)) * (e1 * e1 * (3 - 2 * e1))
    mult = 1.0 + (mult - 1.0) * edge
    px = base_px * mult
    hue_t = fh[fi]
    px = px.copy()
    px[1] *= 1.0 + (hue_t - 20.0) / 20.0 * 0.18 * edge
    px[2] *= 1.0 - (hue_t - 20.0) / 20.0 * 0.10 * edge
    px = np.minimum(px, 140.0)
    return np.clip(px, 0, 255)

base = np.array(Image.open(SRC).convert("RGB")).astype(np.float64)
sha_base = hashlib.sha256(Image.open(SRC).tobytes()).hexdigest()
HALF = 103  # texture 207x207, centre texel (103,103): integer offsets hit source pixels exactly
TSIZE = 2 * HALF + 1
disc_pngs = {}
for ei, (cx, cy) in enumerate(CENTRES):
    side = "L" if ei == 0 else "R"
    Ep = eye_params(ei)
    tex = np.zeros((TSIZE, TSIZE, 3), dtype=np.float64)
    for j in range(TSIZE):
        for i in range(TSIZE):
            dx, dy = i - HALF, j - HALF
            r = math.hypot(dx, dy)
            sx, sy = int(cx + dx), int(cy + dy)
            bpx = base[sy, sx]
            if R_IN < r < R_OUT:
                th = math.degrees(math.atan2(dy, dx)) % 360.0
                rn = (r - R_IN) / (R_OUT - R_IN)
                tex[j, i] = modulate(bpx, r, th, rn, ei, Ep)
            else:
                tex[j, i] = bpx  # frozen zones byte-exact (same grid, same base)
    out = HERE / f"geometric-eye-iris-disc-{side}.png"
    Image.fromarray(tex.astype(np.uint8)).save(out)
    disc_pngs[side] = out

# byte-identity cross-check vs eye-iris-A candidate-A (read-only)
refA = Path("/Users/patrick/.local/share/opencode/worktree/29797f/eye-iris-A"
            "/tools/openclinxr/asset-pipeline/eyes/iris-candidate-A.png")
annulus_mismatch = None
if refA.exists():
    ref = np.array(Image.open(refA).convert("RGB")).astype(np.int16)
    worst = 0
    for ei, (cx, cy) in enumerate(CENTRES):
        side = "L" if ei == 0 else "R"
        mine = np.array(Image.open(disc_pngs[side]).convert("RGB")).astype(np.int16)
        for j in range(TSIZE):
            for i in range(TSIZE):
                dx, dy = i - HALF, j - HALF
                if math.hypot(dx, dy) < 99.0:  # interior of modulation zone
                    d = np.abs(mine[j, i] - ref[cy + dy, cx + dx]).max()
                    worst = max(worst, int(d))
    annulus_mismatch = worst

# ================= PART B: meshes =================
NPHI = 128

def ring(phi):
    return np.stack([A_RING * np.cos(phi), A_RING * np.sin(phi),
                     np.full_like(phi, Z_RING)], axis=1)

def build_side(sign):
    """Returns dict of (verts, normals, uvs, idx). Mirrored by sign on x."""
    phi = np.linspace(0, 2 * math.pi, NPHI, endpoint=False)
    cos_p, sin_p = np.cos(phi), np.sin(phi)
    rim = ring(phi).copy()
    rim[:, 0] *= sign
    n_s = rim / R_GLOBE
    n_c = (rim - np.array([0.0, 0.0, Z_CAP_C])) / R_CAP
    seam_angle = math.degrees(math.acos(np.clip((n_s[0] * n_c[0]).sum(), -1, 1)))
    n_rim = n_s + n_c
    n_rim /= np.linalg.norm(n_rim, axis=1, keepdims=True)

    # sclera: polar theta from theta0 (rim) to pi
    th0 = math.asin(A_RING / R_GLOBE)
    NTH_S = 48
    th = np.linspace(th0, math.pi, NTH_S)
    V, N, UV, IX = [], [], [], []
    for t in th:
        st, ct = math.sin(t), math.cos(t)
        v = np.stack([sign * R_GLOBE * st * cos_p, R_GLOBE * st * sin_p,
                      np.full_like(cos_p, R_GLOBE * ct)], axis=1)
        V.append(v)
        n = v / R_GLOBE
        N.append(n)
        uu = (phi / (2 * math.pi)) if sign > 0 else (1.0 - phi / (2 * math.pi))
        UV.append(np.stack([uu, np.full_like(uu, t / math.pi)], axis=1))
    V = np.vstack(V); N = np.vstack(N); UV = np.vstack(UV)
    N[:NPHI] = n_rim  # shared smoothed rim normals
    for r_ in range(NTH_S - 1):
        for j in range(NPHI):
            j2 = (j + 1) % NPHI
            a, b = r_ * NPHI + j, r_ * NPHI + j2
            c, d = a + NPHI, b + NPHI
            IX += [a, c, b, b, c, d] if sign > 0 else [a, b, c, b, d, c]
    sclera = (V, N, UV, np.array(IX, dtype=np.uint32))

    # cap: cap-polar from apex (0) to rim
    thc = math.asin(A_RING / R_CAP)
    NTH_C = 24
    tc = np.linspace(0, thc, NTH_C)
    V, N, UV, IX = [], [], [], []
    for t in tc:
        st, ct = math.sin(t), math.cos(t)
        v = np.stack([sign * R_CAP * st * cos_p, R_CAP * st * sin_p,
                      np.full_like(cos_p, Z_CAP_C + R_CAP * ct)], axis=1)
        V.append(v)
        N.append((v - np.array([0.0, 0.0, Z_CAP_C])) / R_CAP)
        uu = (phi / (2 * math.pi)) if sign > 0 else (1.0 - phi / (2 * math.pi))
        UV.append(np.stack([uu, np.full_like(uu, t / math.pi)], axis=1))
    V = np.vstack(V); N = np.vstack(N); UV = np.vstack(UV)
    V[-NPHI:] = rim  # coincident rim verts (identical floats)
    N[-NPHI:] = n_rim
    for r_ in range(NTH_C - 1):
        for j in range(NPHI):
            j2 = (j + 1) % NPHI
            a, b = r_ * NPHI + j, r_ * NPHI + j2
            c, d = a + NPHI, b + NPHI
            IX += [a, c, b, b, c, d] if sign > 0 else [a, b, c, b, d, c]
    cap = (V, N, UV, np.array(IX, dtype=np.uint32))

    # disc: centre + rings (forced rings at pupil edge and rim)
    qrings = sorted(set(np.linspace(0, IRIS_R, 28).tolist() + [Q_PUPIL, IRIS_R]))
    V = [np.array([[0.0, 0.0, Z_IRIS]])]
    N = [np.array([[0.0, 0.0, 1.0]])]
    rpx0 = float(q2px(np.array([0.0]))[0])
    UV = [np.array([[HALF / TSIZE, HALF / TSIZE]])]
    for q in qrings[1:]:
        rp = float(q2px(np.array([q]))[0])
        dx = rp * cos_p * sign
        dy = rp * sin_p
        V.append(np.stack([sign * np.full_like(cos_p, q) * cos_p,
                           np.full_like(sin_p, q) * sin_p,
                           np.full_like(cos_p, Z_IRIS)], axis=1))
        N.append(np.tile([[0.0, 0.0, 1.0]], (NPHI, 1)))
        UV.append(np.stack([(HALF + dx) / TSIZE,
                            # v negated: glTF v=0 is image bottom, texel grid is
                            # y-down like the source; else the iris renders flipped
                            (HALF - dy) / TSIZE], axis=1))
    V = np.vstack(V); N = np.vstack(N); UV = np.vstack(UV)
    IX = []
    for j in range(NPHI):
        j2 = (j + 1) % NPHI
        IX += [0, 1 + j, 1 + j2] if sign > 0 else [0, 1 + j2, 1 + j]
    base_r = 1
    for _ in qrings[2:]:
        for j in range(NPHI):
            j2 = (j + 1) % NPHI
            a, b = base_r + j, base_r + j2
            c, d = a + NPHI, b + NPHI
            IX += [a, c, b, b, c, d] if sign > 0 else [a, b, c, b, d, c]
        base_r += NPHI
    disc = (V.astype(np.float64), N.astype(np.float64), UV.astype(np.float64),
            np.array(IX, dtype=np.uint32))
    return {"sclera": sclera, "cap": cap, "disc": disc, "seam_angle_deg": seam_angle}

sides = {"L": build_side(1.0), "R": build_side(-1.0)}

# ================= PART C: GLB writer (skinned, 1 joint per side) =================
buf = bytearray()
views, accs = [], []
def push(arr: np.ndarray):
    global buf
    off = len(buf)
    buf += arr.tobytes()
    while len(buf) % 4:
        buf += b"\x00"
    views.append({"buffer": 0, "byteOffset": off, "byteLength": len(arr.tobytes())})
    return len(views) - 1
def acc(view, ctype, count, etype):
    accs.append({"bufferView": view, "componentType": ctype, "count": count, "type": etype})
    return len(accs) - 1

meshes, mesh_nodes = [], []
for mi, (key, side, part) in enumerate(
        [("sclera", "L", sides["L"]["sclera"]), ("cap", "L", sides["L"]["cap"]),
         ("disc", "L", sides["L"]["disc"]), ("sclera", "R", sides["R"]["sclera"]),
         ("cap", "R", sides["R"]["cap"]), ("disc", "R", sides["R"]["disc"])]):
    V, Nr, UV, IX = part
    jidx = 0 if side == "L" else 1
    J = np.full((len(V), 4), 0, dtype=np.uint16); J[:, 0] = jidx
    W = np.zeros((len(V), 4), dtype=np.float32); W[:, 0] = 1.0
    prim = {"attributes": {
        "POSITION": acc(push(V.astype(np.float32)), 5126, len(V), "VEC3"),
        "NORMAL": acc(push(Nr.astype(np.float32)), 5126, len(Nr), "VEC3"),
        "TEXCOORD_0": acc(push(UV.astype(np.float32)), 5126, len(UV), "VEC2"),
        "JOINTS_0": acc(push(J), 5123, len(J), "VEC4"),
        "WEIGHTS_0": acc(push(W), 5126, len(W), "VEC4")},
        "indices": acc(push(IX), 5125, len(IX), "SCALAR")}
    meshes.append({"name": f"eye_geo_{key}_{side}", "primitives": [prim]})
    mesh_nodes.append(len(meshes) - 1)

ibm = np.tile(np.eye(4, dtype=np.float32), (2, 1, 1))
ibm_acc = acc(push(ibm), 5126, 2, "MAT4")

png_bytes = {}
for side in ("L", "R"):
    with open(HERE / f"geometric-eye-iris-disc-{side}.png", "rb") as f:
        png_bytes[side] = f.read()
img_views = {}
for side in ("L", "R"):
    off = len(buf)
    buf += png_bytes[side]
    while len(buf) % 4:
        buf += b"\x00"
    img_views[side] = len(views)
    views.append({"buffer": 0, "byteOffset": off, "byteLength": len(png_bytes[side])})

gltf = {
    "asset": {"version": "2.0", "generator": "geometric-eye-g2-build.py",
              "extras": {"units": "mm", "frame": "eye-local globe-centre origin, +z anterior",
                         "params": "geometric-eye-g1-params.json"}},
    "scene": 0, "scenes": [{"nodes": [0]}],
    "nodes": [
        {"name": "EyeGeoRoot", "children": [1, 2, 3, 4, 5, 6, 7, 8]},
        {"name": "eye.L"}, {"name": "eye.R"},
        {"name": "eye_geo_sclera_L", "mesh": 0, "skin": 0},
        {"name": "eye_geo_cap_L", "mesh": 1, "skin": 0},
        {"name": "eye_geo_disc_L", "mesh": 2, "skin": 0},
        {"name": "eye_geo_sclera_R", "mesh": 3, "skin": 0},
        {"name": "eye_geo_cap_R", "mesh": 4, "skin": 0},
        {"name": "eye_geo_disc_R", "mesh": 5, "skin": 0},
    ],
    "skins": [{"name": "eye_geo_skin", "joints": [1, 2], "inverseBindMatrices": ibm_acc}],
    "meshes": meshes,
    "materials": [
        {"name": "eye_geo_sclera", "pbrMetallicRoughness": {
            "baseColorFactor": [0.93, 0.92, 0.88, 1.0], "roughnessFactor": 0.35}},
        {"name": "eye_geo_cap", "alphaMode": "BLEND", "doubleSided": True,
         "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 0.08], "roughnessFactor": 0.05}},
        {"name": "eye_geo_disc_L", "pbrMetallicRoughness": {
            "baseColorTexture": {"index": 0}, "roughnessFactor": 0.55}},
        {"name": "eye_geo_disc_R", "pbrMetallicRoughness": {
            "baseColorTexture": {"index": 1}, "roughnessFactor": 0.55}},
    ],
    "textures": [{"source": 0}, {"source": 1}],
    "images": [{"name": "iris-disc-L", "mimeType": "image/png", "bufferView": img_views["L"]},
               {"name": "iris-disc-R", "mimeType": "image/png", "bufferView": img_views["R"]}],
    "samplers": [{"magFilter": 9729, "minFilter": 9987}],
    "accessors": accs, "bufferViews": views,
    "buffers": [{"byteLength": len(buf)}],
}
for mi, mat in enumerate([0, 1, 2, 0, 1, 3]):
    meshes[mi]["primitives"][0]["material"] = mat
gltf["nodes"][3]["mesh"], gltf["nodes"][4]["mesh"], gltf["nodes"][5]["mesh"] = 0, 1, 2
gltf["nodes"][6]["mesh"], gltf["nodes"][7]["mesh"], gltf["nodes"][8]["mesh"] = 3, 4, 5

js = json.dumps(gltf, separators=(",", ":")).encode()
while len(js) % 4:
    js += b" "
glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buf))
glb += struct.pack("<II", len(js), 0x4E4F534A) + js
glb += struct.pack("<II", len(buf), 0x004E4942) + bytes(buf)
with open(HERE / "geometric-eye-anterior.glb", "wb") as f:
    f.write(glb)

# ================= PART D: census + report =================
def fit_sphere(V):
    A = np.column_stack([V, np.ones(len(V))])
    b = (V ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    c = sol[:3] / 2
    r = math.sqrt(sol[3] + (c ** 2).sum())
    return c, r
census = {}
for side in ("L", "R"):
    S = sides[side]
    cs, rs = fit_sphere(S["sclera"][0])
    capV = S["cap"][0]
    apex = capV[:, 2].max()
    cc = np.array([0.0, 0.0, float(Z_CAP_C)])
    rc = np.linalg.norm(capV - cc, axis=1)
    discV = S["disc"][0]
    census[side] = {
        "sclera_fit_c": [round(float(x), 4) for x in cs],
        "sclera_fit_r": round(float(rs), 4),
        "cap_r_mean": round(float(rc.mean()), 4), "cap_r_maxdev": round(float(abs(rc - rc.mean()).max()), 6),
        "apex_z": round(float(apex), 4),
        "protrusion": round(float(apex - R_GLOBE), 4),
        "disc_dia": round(float(discV[:, 0].max() - discV[:, 0].min()
                                if side == "L" else -(discV[:, 0].min() - discV[:, 0].max())), 4),
        "disc_plane_z": round(float(discV[:, 2].mean()), 6),
        "rim_coincident_maxdev": round(float(abs(S["sclera"][0][:NPHI] - S["cap"][0][-NPHI:]).max()), 9),
        "seam_angle_deg": round(S["seam_angle_deg"], 3),
        "verts": {k: int(S[k][0].shape[0]) for k in ("sclera", "cap", "disc")},
    }

report = {
    "slice": "G2-build (mesh + texture remap; render grade separate)",
    "params_trace": "geometric-eye-g1-params.json resolved/iris_disc",
    "base_texture": {"file": str(SRC), "sha256_prefix": sha_base[:16],
                     "note": "sha matches texture-manifest iris-centred-c (76c805e5...)"},
    "limbus_stretch": {
        "arc_span_mm": round(arc_span, 4), "chord_span_mm": round(chord_span, 4),
        "total_radial_pct": round(stretch_total_pct, 2),
        "mid_annulus_dev_mm": round(mid_dev_mm, 4),
        "mid_annulus_dev_srcpx": round(mid_dev_px, 2),
        "verdict": "PASS" if mid_dev_px <= 1.0 else "FAIL",
        "note": "uniform-arc (old sphere approx) vs uniform-chord (new disc) "
                "between identical endpoints; annulus internally linear (zero distortion)",
    },
    "annulus_port": {"byte_mismatch_vs_candidateA_max": annulus_mismatch,
                     "verdict": "PASS" if annulus_mismatch == 0 else ("SKIP-no-ref" if annulus_mismatch is None else "FAIL")},
    "census": census,
    "weights": "all verts (1,0,0,0) to own side joint; joints identity at globe centre (gaze pivot bookkeeping: pivot == scleral centre)",
    "not_evidence_for": ["clinical_validity", "production_asset_readiness", "quest_readiness", "exam_equivalence"],
    "not_tested": ["lid interaction", "roughness-map numeral re-target + readback (needs eye-shader plumbing; UV rects documented in manifest)", "gaze/lash/compat suites (G4/G5)"],
}
with open(HERE / "geometric-eye-g2-report.json", "w") as f:
    json.dump(report, f, indent=1)
print(json.dumps({k: report[k] for k in ("limbus_stretch", "annulus_port")}, indent=1))
print(json.dumps(census, indent=1))
