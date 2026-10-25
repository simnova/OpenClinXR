"""OWN coherent pore-only normal producer (ph20-normals, v6).

What this IS: a deterministic analytic heightfield (numpy/scipy) converted
to a tangent-space normal map. An artistic stylized skin texture.
What this is NOT: NOT a Blender bake; NOT baked from mesh-surface pixels;
NOT scientifically measured skin pores; NOT a photoreal claim.

Geometry relationship, stated precisely: mesh geometry normals are
preserved (no geometry edit, no macro bake, no curvature/pointiness, no
subdivision). The ADDED normal field carries low-frequency orange-peel
undulation plus sparse pits. "Macro preserved" below means only that the
source mesh's own normals keep doing the macro work; the added field is
low-frequency by construction (wavelengths 85..256px >> 4px sample step).

Mechanism (single physical mechanism):
  - base: 10 low-frequency sinusoid components, integer cycles 4..12 per
    1024px axis, per-actor seeded phases/amps (numpy default_rng(seed)).
    Carries most sd energy at wavelengths far above the 4px metric step,
    so row-MAD/sd stays low (coherent, not white noise).
  - pits: 2500 sparse Gaussian dents, radius 2..4.5px, depth 1..2 sigma,
    per-actor seeded; Gaussian blur sigma=3.0px bandlimits pit edges.
  - height normalized to unit variance before and after blur; slope gain
    STRENGTH=1.2 targets sd ~10-12 (above the 5-deg / sd>=8 bar with
    margin, gentle enough to avoid gravel/sandpaper look).
Per-actor uniqueness: seed from --seed (default map: family/gown/ob/child
-> 11/22/33/44); no map copy between actors. Output: 1024 RGB 8-bit
non-interlaced PNG + bake.json carrying the real input GLB SHA (used for
binding identity/UV slot ONLY), output PNG SHA, code SHA, and a truthful
runtime/derivationMode/generator record. No Blender involved.
CLI: explicit --actor-glb, --out-dir, --actor-short; --seed overrides.
Deps: python3.13 / numpy2.5 / scipy1.18 (versions recorded in bake.json).
"""
import argparse
import hashlib
import json
import os
import pathlib
import struct
import sys
import zlib

import numpy

try:
    from scipy.ndimage import gaussian_filter
except Exception:
    sys.exit("REFUSE: scipy missing")

import scipy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from region_balance import build_gain as _build_gain

SIZE = 1024
STRENGTH = 1.2
FMIN, FMAX = 4, 12
NCOMP = 10
PITS = 2500
BLUR = 3.0
SEEDS = {"family": 11, "gown": 22, "ob": 33, "child": 44}
BODIES = {"family": "mpfb_ed_chest_pain_spouse_adult_body",
          "gown": "mpfb_robert_reference_body",
          "ob": "mpfb_ob_patient_aisha_v1_body",
          "child": "mpfb_peds_patient_child_body"}
RECIPE = "coherent-pore-v6-orangepeel-sparsepits-bandlimited"
DERIVATION_MODE = ("procedural-stylized-analytic-heightfield: artistic texture; "
                   "NOT a mesh-surface bake; NOT measured skin pores; NOT photoreal")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def build_height(seed: int) -> numpy.ndarray:
    rng = numpy.random.default_rng(seed)
    y, x = numpy.mgrid[0:SIZE, 0:SIZE].astype(float)
    h = numpy.zeros((SIZE, SIZE))
    for _ in range(NCOMP):
        fx = int(rng.integers(FMIN, FMAX + 1))
        fy = int(rng.integers(FMIN, FMAX + 1))
        ph = float(rng.uniform(0, 2 * numpy.pi))
        amp = float(rng.uniform(0.5, 1.0))
        h += amp * numpy.sin(2 * numpy.pi * (fx * x / SIZE + fy * y / SIZE) + ph)
    h /= h.std()
    for _ in range(PITS):
        cx = int(rng.integers(0, SIZE))
        cy = int(rng.integers(0, SIZE))
        r = float(rng.uniform(2.0, 4.5))
        d = float(rng.uniform(1.0, 2.0))
        x0, x1 = max(0, cx - 16), min(SIZE, cx + 17)
        y0, y1 = max(0, cy - 16), min(SIZE, cy + 17)
        yy, xx = numpy.mgrid[y0:y1, x0:x1]
        h[y0:y1, x0:x1] -= d * numpy.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r))
    h = gaussian_filter(h, BLUR)
    h /= h.std()
    return h


def height_to_rgb(h: numpy.ndarray):
    dhdy, dhdx = numpy.gradient(h)
    nx = -dhdx * STRENGTH
    ny = -dhdy * STRENGTH
    inv = 1.0 / numpy.sqrt(nx * nx + ny * ny + 1.0)
    r = numpy.clip((nx * inv * 0.5 + 0.5) * 255, 0, 255).astype(numpy.uint8)
    g = numpy.clip((ny * inv * 0.5 + 0.5) * 255, 0, 255).astype(numpy.uint8)
    b = numpy.clip((inv * 0.5 + 0.5) * 255, 0, 255).astype(numpy.uint8)
    return r, g, b


def write_png(path: str, r: numpy.ndarray, g: numpy.ndarray, b: numpy.ndarray) -> None:
    raw = bytearray()
    for yy in range(SIZE):
        raw.append(0)
        for xx in range(SIZE):
            raw += bytes((int(r[yy, xx]), int(g[yy, xx]), int(b[yy, xx])))
    comp = zlib.compress(bytes(raw), 6)

    def chunk(t: bytes, d: bytes) -> bytes:
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", comp) + chunk(b"IEND", b""))
    open(path, "wb").write(png)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--actor-short", default=os.environ.get("ACTOR_SHORT"))
    ap.add_argument("--actor-glb", default=os.environ.get("ACTOR_GLB"))
    ap.add_argument("--out-dir", default=os.environ.get("OUT_DIR"))
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--region-balance", action="store_true", default=False)
    ap.add_argument("--head-gain", type=float, default=1.0)
    ap.add_argument("--fore-gain", type=float, default=0.72)
    ap.add_argument("--region-blur", type=float, default=8.0)
    a = ap.parse_args()
    if not (a.actor_short and a.actor_glb and a.out_dir):
        sys.exit("REFUSE: --actor-short/--actor-glb/--out-dir required (or ACTOR_* env)")
    short, glb = a.actor_short, a.actor_glb
    seed = a.seed if a.seed is not None else SEEDS[short]
    outdir = pathlib.Path(a.out_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    h = build_height(seed)
    region = None
    if a.region_balance:
        _gain, _info = _build_gain(glb, size=SIZE, head_gain=a.head_gain,
                                   fore_gain=a.fore_gain, blur=a.region_blur)
        h = h * _gain
        _helper_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "region_balance.py")
        _helper_bytes = open(_helper_path, "rb").read()
        region = dict(_info)
        region["enabled"] = True
        region["helperFile"] = "region_balance.py"
        region["helperSha256"] = sha(_helper_bytes)
        region["note"] = ("smooth anatomically-derived UV/joint gain; head preserved, "
                          "forearm softened; blurred, no seams/dots/gravel")
    r, g, b = height_to_rgb(h)
    png_path = outdir / "normal.png"
    write_png(str(png_path), r, g, b)
    png = open(png_path, "rb").read()
    src = open(glb, "rb").read()
    code = open(os.path.abspath(__file__), "rb").read()
    # body mesh identity + vertex sha from source GLB bytes (binding
    # identity ONLY: proves per-actor slot, contributes zero pixels).
    jl, = struct.unpack("<I", src[12:16])
    gj = json.loads(src[20:20 + jl])
    off = 20 + jl
    cl, = struct.unpack("<I", src[off:off + 4])
    binary = src[off + 8:off + 8 + cl]
    bodysub = BODIES[short]
    cand = [m for m in gj["meshes"] if bodysub in (m.get("name") or "")]
    if len(cand) != 1:
        sys.exit("REFUSE: body mesh ambiguous for " + bodysub)
    bm = cand[0]
    acc_idx = bm["primitives"][0]["attributes"]["POSITION"]
    acc = gj["accessors"][acc_idx]
    bv = gj["bufferViews"][acc["bufferView"]]
    start = (bv.get("byteOffset", 0) or 0) + (acc.get("byteOffset", 0) or 0)
    pos = numpy.frombuffer(binary[start:start + acc["count"] * 12],
                            dtype=numpy.float32).reshape(-1, 3)
    vsha = hashlib.sha256(numpy.round(pos, 6).tobytes()).hexdigest()
    pyv = "%d.%d.%d" % sys.version_info[:3]
    rep = {
        "recipe": RECIPE,
        "derivationMode": DERIVATION_MODE,
        "generator": ("python%s/numpy%s/scipy%s analytic-heightfield "
                      "1024px RGB8, seed-controlled" % (pyv, numpy.__version__, scipy.__version__)),
        "meshSurfaceBake": False,
        "measuredSkinPores": False,
        "photorealClaim": False,
        "renderRecipe": (("heightfield[ncomp=%d freq=%d..%d pits=%d r=2..4.5 "
                          "blur=%.1f strength=%.1f] -> gradient normal" % (
                              NCOMP, FMIN, FMAX, PITS, BLUR, STRENGTH))
                         + ("" if region is None else
                            " + region-balance[headx%.2f forex%.2f blur%.1f helper:%s]" % (
                                a.head_gain, a.fore_gain, a.region_blur,
                                region["helperSha256"][:12]))),
        "bindingScope": ("source GLB used for binding identity/UV slot only; "
                          "mesh geometry normals preserved; detail carried only "
                          "by the added tangent-space normal field"),
        "actorShort": short,
        "seed": seed,
        "params": {"size": SIZE, "strength": STRENGTH, "freqRange": [FMIN, FMAX],
                   "components": NCOMP, "pits": PITS, "pitRadiusPx": [2.0, 4.5],
                   "blurSigmaPx": BLUR},
        "inputGlb": os.path.basename(glb),
        "inputGlbFullSha": sha(src),
        "bakeInputGlb": os.path.basename(glb),
        "bakeInputGlbFullSha": sha(src),
        "bodyMesh": bm.get("name"),
        "bodyMeshBase": bm.get("name"),
        "vsha": vsha,
        "vshaScope": "binding-identity-only, contributes zero map pixels",
        "outputPngSha": sha(png),
        "bakeCodeSha": sha(code),
        "runtime": (("python%s/numpy%s/scipy%s/analytic-heightfield/1024/"
                     "seed%d/strength%s/blur%s/NO-BLENDER/NO-MESH-BAKE" % (
                         pyv, numpy.__version__, scipy.__version__, seed, STRENGTH, BLUR))
                    + ("" if region is None else
                       "+region-balance/head%.2f/fore%.2f/blur%.1f" % (
                           a.head_gain, a.fore_gain, a.region_blur))),
        "pore": {"mechanism": "low-freq orange-peel + sparse gaussian pits, bandlimited",
                 "seed": seed, "strength": STRENGTH},
        "regionBalance": region,
    }
    (outdir / "bake.json").write_text(json.dumps(rep, indent=1))
    print("OWN_BAKE " + json.dumps({"actor": short, "pngSha": sha(png)[:16],
                                    "inputSha": sha(src)[:12], "recipe": RECIPE}))


if __name__ == "__main__":
    main()
