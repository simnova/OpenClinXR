#!/usr/bin/env python3
"""G2 gate: geometric-eye meshes + disc-UV remap conform to G1 params.

Cheapest pass refused: a pretty render on wrong geometry, or an exact
texture file sampled by wrong UVs. Every check re-derives from the shipped
artifacts (GLB, PNGs, render), not from the build report. Exit 0 = GREEN.
Reads this dir: geometric-eye-anterior.glb, geometric-eye-iris-disc-*.png,
geometric-eye-g2-render.png, geometric-eye-g1-params.json.
Writes: geometric-eye-g2-sheet.png (render | prior crop), prints verdicts.
"""
import json, math, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).parent
EYE_STORE = Path("/Volumes/files/openclinxr-assets/store/geometric-eye")


def eye_glb(name):
    """Store-first GLB resolution (large binaries live outside git)."""
    p = EYE_STORE / name / f"{name}.glb"
    if p.exists():
        return p
    local = HERE / f"{name}.glb"
    if local.exists():
        return local
    raise SystemExit(f"missing {name}.glb: store {p} absent and no local copy")
fails = []
def check(name, cond, detail):
    print(("PASS" if cond else "FAIL"), name, "-", detail)
    if not cond:
        fails.append(name)

P = json.loads((HERE / "geometric-eye-g1-params.json").read_text())
R, D = P["resolved"], P["iris_disc"]

# ---- GLB parse (minimal): meshes, joints/weights, positions ----
raw = eye_glb("geometric-eye-anterior").read_bytes()
magic, ver, length = struct.unpack("<III", raw[:12])
assert magic == 0x46546C67, "not a GLB"
jl, jt = struct.unpack("<II", raw[12:20])
gltf = json.loads(raw[20:20 + jl])
# chunk0 json then chunk1 bin: re-walk properly
off = 12
chunks = {}
while off < len(raw):
    cl, ct = struct.unpack("<II", raw[off:off + 8])
    chunks[ct] = raw[off + 8:off + 8 + cl]
    off += 8 + cl
gltf = json.loads(chunks[0x4E4F534A])
buf = chunks[0x004E4942]
def acc(i):
    a = gltf["accessors"][i]
    bv = gltf["bufferViews"][a["bufferView"]]
    bo = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4,
         "MAT4": 16}[a["type"]] * a["count"]
    fmt = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I",
           5126: "f"}[a["componentType"]]
    import array
    arr = array.array(fmt, buf[bo:bo + n * array.array(fmt).itemsize])
    return np.asarray(arr, dtype=np.float64).reshape(a["count"], -1)

names = [m["name"] for m in gltf["meshes"]]
check("six_meshes", len(names) == 6, f"{names}")
for want in ("eye_geo_sclera_L", "eye_geo_cap_L", "eye_geo_disc_L",
             "eye_geo_sclera_R", "eye_geo_cap_R", "eye_geo_disc_R"):
    check(f"mesh_{want}", want in names, "present")

# skins/weights: every vert weight 1.0 on exactly one joint; joints at origin
skin = gltf["skins"][0]
jnodes = [gltf["nodes"][j]["name"] for j in skin["joints"]]
check("joints_eye_LR", jnodes == ["eye.L", "eye.R"], f"{jnodes}")
allpos = []
for mi, m in enumerate(gltf["meshes"]):
    pr = m["primitives"][0]
    J = acc(pr["attributes"]["JOINTS_0"])
    W = acc(pr["attributes"]["WEIGHTS_0"])
    check(f"weights_{m['name']}_unit",
          bool(((W.sum(axis=1) == 1.0) & ((W == 1.0).sum(axis=1) == 1)).all()),
          "all verts 1.0 on exactly one joint")
    side = "L" if m["name"].endswith("_L") else "R"
    want_j = 0 if side == "L" else 1
    check(f"weights_{m['name']}_side",
          bool((J[:, 0] == want_j).all() & (J[:, 1:] == 0).all()),
          f"bound to joint {want_j} ({side})")
    allpos.append((m["name"], acc(pr["attributes"]["POSITION"])))

def fit_sphere(V):
    A = np.column_stack([V, np.ones(len(V))])
    b = (V ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    c = sol[:3] / 2
    return c, math.sqrt(sol[3] + (c ** 2).sum())

for name, V in allpos:
    if "sclera" in name:
        c, r = fit_sphere(V)
        check(f"census_{name}_r", abs(r - R["scleral_radius_mm"]) / R["scleral_radius_mm"] < 0.05,
              f"R {r:.4f} vs {R['scleral_radius_mm']}")
        check(f"census_{name}_centre", float(np.abs(c).max()) < 0.01,
              f"centre {c} (gaze pivot bookkeeping: pivot == scleral centre)")
    if "cap" in name:
        cc = np.array([0.0, 0.0, R["apex_z_mm"] - R["cap_radius_mm"]])
        rr = np.linalg.norm(V - cc, axis=1)
        check(f"census_{name}_r", abs(rr.mean() - R["cap_radius_mm"]) / R["cap_radius_mm"] < 0.05,
              f"cap r mean {rr.mean():.4f} maxdev {abs(rr - rr.mean()).max():.2e}")
        check(f"census_{name}_apex", abs(V[:, 2].max() - R["apex_z_mm"]) < 0.05 * R["apex_z_mm"],
              f"apex {V[:, 2].max():.4f} vs {R['apex_z_mm']}")
    if "disc" in name:
        dia = V[:, 0].max() - V[:, 0].min()
        check(f"census_{name}_dia", abs(dia - D["dia_mm"]) / D["dia_mm"] < 0.05,
              f"disc dia {dia:.4f} vs {D['dia_mm']}")
        check(f"census_{name}_plane", abs(V[:, 2].mean() - D["plane_z_mm"]) < 0.05,
              f"plane {V[:, 2].mean():.4f} vs {D['plane_z_mm']} (ACD recess)")

# rim coincidence + shared normals between sclera row0 and cap last row
for side in ("L", "R"):
    sm = next(m for m in gltf["meshes"] if m["name"] == f"eye_geo_sclera_{side}")
    cm = next(m for m in gltf["meshes"] if m["name"] == f"eye_geo_cap_{side}")
    sp, sn = acc(sm["primitives"][0]["attributes"]["POSITION"]), acc(sm["primitives"][0]["attributes"]["NORMAL"])
    cp, cn = acc(cm["primitives"][0]["attributes"]["POSITION"]), acc(cm["primitives"][0]["attributes"]["NORMAL"])
    nphi = 128
    check(f"rim_coincident_{side}", float(abs(sp[:nphi] - cp[-nphi:]).max()) == 0.0,
          f"max dev {float(abs(sp[:nphi] - cp[-nphi:]).max()):.2e}")
    check(f"rim_normals_shared_{side}", float(abs(sn[:nphi] - cn[-nphi:]).max()) == 0.0,
          "zero shading seam by construction")

# ---- texture gates: centre + limbus on the new UVs ----
for side, (cx, cy) in (("L", (296, 724)), ("R", (722, 302))):
    tex = np.array(Image.open(HERE / f"geometric-eye-iris-disc-{side}.png").convert("RGB")).astype(float)
    H = tex.shape[0] // 2
    dark = tex.sum(axis=2) < 150
    ys, xs = np.nonzero(dark)
    # dark region = iris interior; centroid must sit at texture centre (disc UV centre)
    mx, my = xs.mean(), ys.mean()
    check(f"disc_{side}_centred", abs(mx - (H - 0.5)) <= 2.0 and abs(my - (H - 0.5)) <= 2.0,
          f"dark centroid ({mx:.2f},{my:.2f}) vs centre {(H - 0.5)}")
    # frozen ring (r 100.5..102.5, outside the R_OUT=99.5 modulation zone) must
    # equal the source base byte-exact: guards grid alignment (a half-pixel
    # shift breaks this). The annulus content's byte-identity vs the
    # independent iris-candidate-A artifact is proven in the build report
    # (mismatch 0); the modulation itself converges to identity at R_OUT.
    src = np.array(Image.open(
        "tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png").convert("RGB")).astype(float)
    worst = 0
    for j in range(tex.shape[0]):
        for i in range(tex.shape[1]):
            if 100.5 <= math.hypot(i - (H - 0.5), j - (H - 0.5)) <= 102.5:
                worst = max(worst, int(abs(tex[j, i] - src[cy + (j - H), cx + (i - H)]).max()))
    check(f"disc_{side}_frozen", worst == 0, f"frozen ring max byte diff {worst}")
    # modulation applied (annulus differs from base), not a plain copy
    sel = np.zeros((tex.shape[0], tex.shape[1]), bool)
    for j in range(tex.shape[0]):
        for i in range(tex.shape[1]):
            if 55 <= math.hypot(i - (H - 0.5), j - (H - 0.5)) <= 75:
                sel[j, i] = True
    mid = tex[sel].mean()
    mid0 = np.array([src[cy + (j - H), cx + (i - H)].mean()
                     for j in range(tex.shape[0]) for i in range(tex.shape[1])
                     if sel[j, i]]).mean()
    check(f"disc_{side}_modulated", abs(mid - mid0) > 1.0,
          f"annulus mean {mid:.1f} vs base {mid0:.1f}")

# ---- render grade: no regression vs prior look ----
ren = np.array(Image.open(HERE / "geometric-eye-g2-render.png").convert("RGB")).astype(float)
alpha = np.array(Image.open(HERE / "geometric-eye-g2-render.png").convert("RGBA"))[:, :, 3] > 0
g = ren.mean(axis=2)
dark = (g < 100) & alpha
ys, xs = np.nonzero(dark)
rcx, rcy = xs.mean(), ys.mean()
Hh, Hw = g.shape
check("render_iris_centred", abs(rcx - Hw / 2) <= 4 and abs(rcy - Hh / 2) <= 4,
      f"iris centroid ({rcx:.1f},{rcy:.1f}) vs frame centre ({Hw / 2},{Hh / 2})")
# iris diameter in px -> mm (ortho 30mm / 1024px)
dpx = max(xs.max() - xs.min(), ys.max() - ys.min())
dmm = dpx / 1024 * 30
check("render_iris_dia", abs(dmm - D["dia_mm"]) / D["dia_mm"] < 0.05,
      f"visible dia {dmm:.3f}mm vs {D['dia_mm']}")
# radial profile: rim band must be closed (no see-through gap to the
# transparent background -> exactly-0 pixels) and the sclera shading outside
# the rim must be smooth (a normal seam would step here; normals are shared
# by construction, this confirms no other rim artifact). The bright limbal
# highlight (cap specular at the 18.6deg crease) is expected physical
# behaviour, recorded informationally, not gated.
yy, xx = np.mgrid[0:Hh, 0:Hw]
rr = np.sqrt((xx - rcx) ** 2 + (yy - rcy) ** 2)
rim_r = D["dia_mm"] / 2 / 30 * 1024
rim_band = (rr >= rim_r - 2) & (rr <= rim_r + 2)
check("render_rim_closed", bool((g[rim_band] > 3).all()),
      f"rim band min {g[rim_band].min():.1f} (gap would read 0)")
nprof = int(rim_r) + 30
prof = []
for k in range(nprof):
    sel = g[(rr >= k - 0.5) & (rr < k + 0.5) & alpha]
    prof.append(float(sel.mean()) if sel.size else float("nan"))
prof = np.array(prof)
scl = prof[int(rim_r) + 6:int(rim_r) + 20]
step = float(np.abs(np.diff(scl)).max())
check("render_sclera_smooth", step < 8.0, f"max adjacent-ring step {step:.1f}")
hi = float(prof[int(rim_r) - 3:int(rim_r) + 3].max())
print(f"INFO limbal highlight peak {hi:.1f} (cap specular at crease; physical, not a seam)")

# sheet: render | prior L crop scaled to same iris px size
prior = Image.open("tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png").convert("RGB")
crop = prior.crop((296 - 104, 724 - 104, 296 + 103, 724 + 103)).resize((int(dpx), int(dpx)))
sheet = Image.new("RGB", (1024 + int(dpx) + 20, 1024), (20, 20, 20))
sheet.paste(Image.open(HERE / "geometric-eye-g2-render.png").convert("RGB"), (0, 0))
sheet.paste(crop, (1024 + 20, (1024 - int(dpx)) // 2))
sheet.save(HERE / "geometric-eye-g2-sheet.png")

print("GATE", "GREEN" if not fails else f"RED ({fails})")
sys.exit(1 if fails else 0)
