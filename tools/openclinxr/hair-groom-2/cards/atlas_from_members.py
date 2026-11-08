"""Per-card atlas baked from each card's own member strands (Blender 5.2 headless, Cycles CPU).

    Blender --background --factory-startup --python atlas_from_members.py -- \
        --round <groom round dir> --cards <cards.npz> --members <card-members.npz> --out-dir <dir> \
        [--samples 64] [--aspect 3]

cards-r3. cards-r2 textured every card from one of four generic strand tiles (atlas_bake.py), so every
card carried the same strand pattern and opaque edges (D2 3.0 px vs strands 24 px). Here each card
gets its own atlas cell (cards_from_strands.py card_atlas_cell_px), rendered from the strands that
card replaces:

  1. members: cards_from_strands.py --members-out gives every child strand of the groom round in its
     card's frame: u (0..1 between the card edges), v (0..1 root..tip, the card_uv v), depth (m along
     the card normal). Each strand belongs to one card (a two-layer cluster splits its members at the
     midpoint of the two card planes).
  1b. drift: a member's u(v) also carries the card's twist and the bundle's sway across the card
     plane (the frame W turns along the card, so a round bundle rotates through the plane: r3 probe
     renders, bundles sweeping across whole cells at sigma 3 and 6), which the card geometry already
     carries. Each member runs down the card from its root u (--anchor root; its mean u put swept
     bundles in a narrow band mid-cell) with only its u detail above a gaussian of --drift-sigma
     points (1 of 32: the point-to-point jitter); the part below is dropped. Depth is kept as is.
  2. scene: each card's members are laid out flat in its own region of one orthographic render,
     isotropically scaled by s = WREF / card median width (strand radius x s too, recipe
     strand.root/tipRadiusMm), so the strand angles, overlaps and depth order are the groom's; card
     regions are packed in columns with gaps, the render's pixels are --aspect times taller than wide
     (Cycles pixel aspect) and each region is (cell width - 2) px wide. Points outside the card
     (u < -0.3 or > 1.3, v < 0 or > 1) end the strand: what lies past the card edge is not this card's.
  3. shading: groom.hair_material(recipe) (HUANG, the groom's melanin/roughness/lobes); world = the
     groom rig's grey (groom.setup_render); the rig's key, fill and rim area lights become suns in the
     card frame with the rig's irradiance at the head (P / (pi d^2)) and elevation (atan(z / horizontal
     distance)): elevation turns toward the card root, key and fill light the card's outer face, the rim
     its inner face; the lights' azimuth is dropped (a card's u axis has no fixed world direction).
     Baked = HUANG radiance of the member strands under that light: per-strand R/TT highlight,
     strand-on-strand occlusion and the strand colour, in one term. The card render relights it with the
     rig, and calib_search.py's albedo gain (global, per channel, measured against the strand round)
     takes out the double lighting; a separate albedo + lighting split would need the strands' lighting
     re-evaluated per card frame, which one Cycles render cannot do.
  4. alpha = Cycles film coverage of the members (transparent film, pixel filter), so a card edge with
     two strands is two strands of alpha, not a hard edge. 4b. thickness: a flat card shows its members'
     coverage seen along its normal; the strands it replaces are spread through depth (member p10..p90
     depth spread median 3.8 mm, cards-record) and seen at grazing angles on the crown cover more
     (s1: raw coverage, back crown scalp patch D5 53 px vs 11 px cards-r2). --alpha-norm divides the
     coverage by A_REF = the median over cards of the card's centre-two-column mean coverage, clipped to
     1: the median card centre is opaque, a lone strand at an edge keeps 1/A_REF of its coverage.
     s2 (median-centre): crown and sideburn read as opaque ribbons again with dark gaps between cards
     (F1 front 11.2%). Default --alpha-norm power: alpha = 1 - (1 - coverage)^k, k = 2 = the members'
     coverage over twice the path, i.e. the depth volume seen at 60 deg from the card normal (k = 1 is
     s1, normal incidence). A lone strand (coverage 0.14) -> 0.26, the median centre 0.41 -> 0.65.
     s3 (k = 2): side tips too translucent, A3 +25.7 mm (limit 25); kept k = 3 (s6, A3 +23.0 mm): a lone
     strand -> 0.36, the median centre -> 0.80.
  5. cell: the region is area-resampled along v to the cell's inner height (premultiplied, linear), the
     1 px cell border is left transparent; texels with alpha < 1/255 carry the card's mean colour (no
     dark fringe under bilinear filtering).
CPU only, seed 0, no denoise: the atlas hash is reproducible. Writes strand-atlas.png, atlas-render.png
(the raw packed render), atlas-record.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "groom"))
import groom  # noqa: E402

sys.path.append(bpy.utils.user_resource("SCRIPTS", path="modules"))   # Pillow (lane handoff)

GAP_X = 10          # px between card regions across (strands past the card edge stay out of the neighbour)
GAP_Y = 8           # px between card regions along
U_KEEP = (-0.3, 1.3)
SCALE_CLAMP = (0.25, 4.0)
DRIFT_SIGMA_PTS = 1.0   # gaussian (strand points) of the low-frequency u drift removed from each member, see 1b
# groom.camera_rig light offsets from the frame target (m) and the recipe lighting keys
RIG = {"key": ((-0.9, -1.4, 0.8), "keyW", +1), "fill": ((1.2, -1.2, 0.2), "fillW", +1),
       "rim": ((0.4, 1.3, 0.9), "rimW", -1)}


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--round", required=True)
    p.add_argument("--cards", required=True)
    p.add_argument("--members", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--aspect", type=float, default=3.0)
    p.add_argument("--alpha-norm", choices=("median-centre", "power", "none"), default="power")
    p.add_argument("--alpha-k", type=float, default=3.0, help="power mode: alpha = 1 - (1 - coverage)^k")
    p.add_argument("--drift-sigma", type=float, default=DRIFT_SIGMA_PTS, help="0 keeps the raw member u")
    p.add_argument("--anchor", choices=("root", "mean"), default="root",
                   help="u each member runs down from after the drift is removed")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def area_matrix(n_in, n_out):
    """(n_out, n_in) weights: output texel i averages the input rows it overlaps, by overlap length."""
    e_in = np.arange(n_in + 1, dtype=np.float64)
    e_out = np.linspace(0.0, n_in, n_out + 1)
    lo = np.maximum(e_out[:-1, None], e_in[None, :-1])
    hi = np.minimum(e_out[1:, None], e_in[None, 1:])
    w = np.clip(hi - lo, 0.0, None)
    return w / w.sum(1, keepdims=True)


def rig_suns(rc):
    lw = {"keyW": 220.0, "fillW": 90.0, "rimW": 160.0}
    lw.update(rc.get("lighting") or {})
    out = {}
    for name, (off, key, face) in RIG.items():
        off = np.array(off)
        d2 = float((off ** 2).sum())
        elev = math.atan2(off[2], math.hypot(off[0], off[1]))
        out[name] = {"irradianceWm2": lw[key] / (math.pi * d2), "elevationDeg": math.degrees(elev),
                     "face": "outer" if face > 0 else "inner",
                     "towardLight": [0.0, math.sin(elev), face * math.cos(elev)]}
    return out


def main():
    a = cli()
    t0 = time.time()
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rd = Path(a.round)
    rc = json.loads((rd / "recipe.json").read_text())
    cards = np.load(a.cards)
    mem = np.load(a.members)
    n = int(cards["n_cards"])
    A = int(cards["atlas_px"])
    cells = cards["card_atlas_cell_px"]
    cw_in = int(cells[0, 2]) - 2
    U, V, D, C = mem["u"], mem["v"], mem["depth_m"], mem["card"]
    wm, arcm = mem["card_width_m"], mem["card_arc_m"]
    WREF = float(np.median(wm))
    px_u = WREF / cw_in
    px_v = a.aspect * px_u
    # per-card isotropic scale, clamped to [1/4, 4]: one card is 0.22 mm wide (the width floor), which
    # unclamped would make its region 49x longer than the median card's
    scale = np.clip(WREF / wm, SCALE_CLAMP[0], SCALE_CLAMP[1])

    # 2. pack card regions in columns
    hreg = np.maximum(np.ceil(arcm * scale / px_v).astype(np.int64), 4)
    pitch_y = hreg + GAP_Y
    pitch_x = cw_in + GAP_X
    col_h = int(math.ceil(math.sqrt(float(pitch_y.sum()) * pitch_x)))
    col_h = max(col_h, int(pitch_y.max()))
    reg = np.zeros((n, 3), np.int64)                    # x0, y0 (px, image top), height
    x, y = 0, 0
    for c in range(n):
        if y + pitch_y[c] > col_h:
            x, y = x + 1, 0
        reg[c] = (GAP_X // 2 + x * pitch_x, GAP_Y // 2 + y, hreg[c])
        y += pitch_y[c]
    resx, resy = (x + 1) * pitch_x, col_h

    # 1b. drift removal (u only)
    if a.drift_sigma > 0:
        r = int(math.ceil(3 * a.drift_sigma))
        kern = np.exp(-0.5 * (np.arange(-r, r + 1) / a.drift_sigma) ** 2)
        kern /= kern.sum()
        Up = np.pad(U.astype(np.float64), ((0, 0), (r, r)), mode="edge")
        low = np.stack([Up[:, j:j + 2 * r + 1] @ kern for j in range(U.shape[1])], 1)
        U = (U[:, :1] if a.anchor == "root" else U.mean(1, keepdims=True)) + (U - low)
    # strands: first contiguous run of points inside the card from the root end
    K = U.shape[1]
    inside = (U >= U_KEEP[0]) & (U <= U_KEEP[1]) & (V >= 0.0) & (V <= 1.0)
    idx = np.arange(K)[None]
    first = np.argmax(inside, 1)
    after = (~inside) & (idx > first[:, None])
    end = np.where(after.any(1), np.argmax(after, 1), K)
    keep = inside.any(1) & ((end - first) >= 2)
    rr, tr = rc["strand"]["rootRadiusMm"] / 1000.0, rc["strand"]["tipRadiusMm"] / 1000.0
    radk = rr + (tr - rr) * np.arange(K) / (K - 1)
    sizes, pos, rad = [], [], []
    for i in np.where(keep)[0]:
        c = int(C[i])
        s = scale[c]
        k0, k1 = int(first[i]), int(end[i])
        X = (reg[c, 0] + U[i, k0:k1] * cw_in) * px_u
        Y = -(reg[c, 1] + V[i, k0:k1] * reg[c, 2]) * px_v
        Z = D[i, k0:k1] * s
        sizes.append(k1 - k0)
        pos.append(np.stack([X, Y, Z], 1))
        rad.append(radk[k0:k1] * s)
    pos = np.concatenate(pos)
    rad = np.concatenate(rad)

    # 3. scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ob = groom.make_curves("members", sizes, pos, radius=rad)
    mat, _ = groom.hair_material(rc)
    ob.data.materials.append(mat)
    sc = bpy.context.scene
    groom.setup_render(a.samples)
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = False
    sc.cycles.seed = 0
    sc.render.resolution_x, sc.render.resolution_y = resx, resy
    sc.render.pixel_aspect_x, sc.render.pixel_aspect_y = 1.0, a.aspect
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    suns = rig_suns(rc)
    from mathutils import Vector
    for name, sp in suns.items():
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = sp["irradianceWm2"]
        ld.angle = 0.0
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = (-Vector(sp["towardLight"])).to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(lo)
    wx, wy = resx * px_u, resy * px_v
    cd = bpy.data.cameras.new("atlascam")
    cd.type = "ORTHO"
    cd.ortho_scale = max(wx, wy)
    cd.sensor_fit = "AUTO"
    cd.clip_start, cd.clip_end = 0.001, 10.0
    cam = bpy.data.objects.new("atlascam", cd)
    sc.collection.objects.link(cam)
    zt = float(pos[:, 2].max()) + 1.0
    cam.location = (wx / 2, -wy / 2, zt)
    sc.camera = cam
    rp = out / "atlas-render.png"
    sc.render.filepath = str(rp)
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    t_render = time.time() - t1

    # 5. cells
    from PIL import Image
    im = np.asarray(Image.open(rp).convert("RGBA"), dtype=np.float64) / 255.0
    if im.shape[:2] != (resy, resx):
        raise RuntimeError("render %s, expected %s" % (im.shape[:2], (resy, resx)))
    alpha_r = im[..., 3]
    prem = lin(im[..., :3]) * alpha_r[..., None]
    in_reg = np.zeros((resy, resx), bool)
    atlas = np.zeros((A, A, 4))
    cstats = []
    cells_out = []
    for c in range(n):
        x0, y0, h = reg[c]
        in_reg[y0:y0 + h, x0:x0 + cw_in] = True
        blk_a = alpha_r[y0:y0 + h, x0:x0 + cw_in]
        blk_p = prem[y0:y0 + h, x0:x0 + cw_in]
        cx0, cy0, cwp, chp = (int(v) for v in cells[c])
        M = area_matrix(h, chp - 2)
        aa = M @ blk_a
        pp = np.einsum("ij,jkc->ikc", M, blk_p)
        mean = pp.reshape(-1, 3).sum(0) / max(aa.sum(), 1e-9)
        rgb = np.where(aa[..., None] > 1.0 / 255.0, pp / np.maximum(aa, 1e-9)[..., None], mean[None, None])
        cell = np.zeros((chp, cwp, 4))
        cell[..., :3] = mean
        cell[1:-1, 1:-1, :3] = rgb
        cell[1:-1, 1:-1, 3] = aa
        cells_out.append((cy0, cx0, cell))
        cstats.append((float(aa.mean()), float(aa[:, [0, -1]].mean()), float(aa[:, cw_in // 2 - 1:cw_in // 2 + 1].mean())))
    cs = np.array(cstats)
    a_ref = float(np.median(cs[:, 2])) if a.alpha_norm == "median-centre" else 1.0
    for cy0, cx0, cell in cells_out:
        if a.alpha_norm == "power":
            cell[..., 3] = 1.0 - (1.0 - cell[..., 3]) ** a.alpha_k
        else:
            cell[..., 3] = np.clip(cell[..., 3] / a_ref, 0.0, 1.0)
        atlas[cy0:cy0 + cell.shape[0], cx0:cx0 + cell.shape[1]] = cell
    out_png = np.concatenate([srgb(atlas[..., :3]), atlas[..., 3:]], 2)
    ap = out / "strand-atlas.png"
    Image.fromarray(np.round(out_png * 255).astype(np.uint8), "RGBA").save(ap, compress_level=9)
    leak = float(alpha_r[~in_reg].sum() / max(alpha_r.sum(), 1e-9))
    rec = {"tool": "tools/openclinxr/hair-groom-2/cards/atlas_from_members.py", "round": str(rd),
           "recipeSha256": sha(rd / "recipe.json"), "cardsSha256": sha(a.cards), "membersSha256": sha(a.members),
           "samples": a.samples, "driftSigmaPts": a.drift_sigma, "anchor": a.anchor, "device": "CPU (determinism), seed 0, no denoise",
           "atlasPx": A, "cellPx": [int(cells[0, 2]), int(cells[0, 3])], "cellInnerPx": [cw_in, int(cells[0, 3]) - 2],
           "cards": n, "strandsDrawn": int(keep.sum()), "strandsTotal": int(len(U)),
           "render": {"px": [resx, resy], "pixelAspect": a.aspect, "pxAcrossMm": px_u * 1000,
                      "pxAlongMm": px_v * 1000, "WREFmm": WREF * 1000, "scaleClampedCards": int(((WREF / wm) != scale).sum()), "seconds": t_render,
                      "alphaOutsideRegions": leak, "sha256": sha(rp)},
           "regionAlongPx": {"min": int(hreg.min()), "median": float(np.median(hreg)), "max": int(hreg.max())},
           "lighting": {"world": "groom.setup_render grey", "suns": suns,
                        "rule": "rig area light P/(pi d^2) at the head, elevation toward the card root, azimuth dropped"},
           "alphaNorm": {"mode": a.alpha_norm, "AREF": a_ref, "k": a.alpha_k},
           "cellAlphaRaw": {"meanMedian": float(np.median(cs[:, 0])), "edgeColsMedian": float(np.median(cs[:, 1])),
                         "centreColsMedian": float(np.median(cs[:, 2]))},
           "material": "groom.hair_material(recipe)", "atlas": ap.name, "atlasSha256": sha(ap),
           "seconds": time.time() - t0}
    (out / "atlas-record.json").write_text(json.dumps(rec, indent=1))
    print("ATLAS_DONE", rec["atlasSha256"], json.dumps({k: rec[k] for k in ("render", "alphaNorm", "cellAlphaRaw", "cellPx")}), flush=True)


main()
