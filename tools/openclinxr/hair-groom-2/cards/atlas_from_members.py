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
    p.add_argument("--min-region-px", type=int, default=4,
                   help="cards-r4 M4: minimum render rows per card region; a 15 mm sideburn card got 12 rows "
                        "(1.8 mm each) stretched over its 202-row cell, so its strands ended as blocky blades")
    p.add_argument("--alpha-k-depth", action="store_true",
                   help="cards-r4 M4: per-card k = 1 + (k - 1) x clip(card member depth spread / median spread, 0, 1); "
                        "a card whose members lie flat (sideburn, spread p5) shows its coverage at normal incidence")
    p.add_argument("--alpha-k-min", type=float, default=1.0,
                   help="--alpha-k-depth floor (cards-r5: sideburn cards at k 1 ended above the ear top, S2 -7 mm)")
    p.add_argument("--short-k", default="",
                   help="cards-r6: 'MM:K' - cards whose arc is under MM mm use alpha power K (1 = raw coverage)")
    p.add_argument("--drift-sigma", type=float, default=DRIFT_SIGMA_PTS, help="0 keeps the raw member u")
    p.add_argument("--anchor", choices=("root", "mean", "spread"), default="root",
                   help="u each member runs down from after the drift is removed. r13 spread: the member's root rank "
                        "across its card (root u between the card members' p2..p98 u at the root v) mapped onto the "
                        "members' p2..p98 u at every v, so the drawn bundle fills the card where its members spread "
                        "and stays straight in order (root: r13 probe, card 852 transparent at u 0.68 v 0.48 where "
                        "its members lie, S3 R550 edge 3 px inside the strands')")
    # cards-r4 M2 (strand value contrast): defaults reproduce the cards-r3 atlas byte for byte
    p.add_argument("--filter-width", type=float, default=None,
                   help="Cycles pixel filter width (px); default = Blender's 1.5")
    p.add_argument("--random-color", type=float, default=None,
                   help="HUANG Random Color for the bake (per-strand melanin spread); default = recipe shading.randomColor")
    p.add_argument("--strand-thin", type=int, default=1,
                   help="draw every k-th member (by member index within its card) at k x radius: same coverage, "
                        "~k x fewer strands per texel, so per-strand shading survives the texel average")
    p.add_argument("--thin-min-keep", type=int, default=0,
                   help="per-card thinning k_c = clip(members // this, 1, --strand-thin): a card keeps at least "
                        "this many strands (s3: sideburn cards of 28-56 members drew 4-7 fat strands, comb blades)")
    p.add_argument("--cut-tip-spread", type=float, default=0.0,
                   help="cards-r10: a member that runs past the card end (v > 1: card cut at the shoulder, or the "
                        "--min-reach end) ends at v = 1 - spread x r (r uniform, seeded by member index) instead of "
                        "at v = 1, and its radius tapers to the recipe tip radius over its last --cut-tip-taper of v. "
                        "0 = off (flush cut line at the card end: side stepped tips, flat back tail bottom)")
    p.add_argument("--cut-tip-taper", type=float, default=0.1)
    p.add_argument("--tip-spread-all", action="store_true",
                   help="cards-r10: --cut-tip-spread also ends members whose own tip lies past the seeded v (runtime MASK "
                        "0.85 drew the tail bottom flat: half the tail cells' texels stay above 0.85 to v = 0.95)")
    p.add_argument("--depth-gain", type=float, default=1.0,
                   help="member depth spread x this (inter-strand self-shadow depth in the bake)")
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


SPREAD_BINS, SPREAD_Q, SPREAD_MIN = 24, (2.0, 98.0), 6   # --anchor spread: v bins, u quantiles, points per bin


def spread_anchor(U, V, C, n):
    """--anchor spread: (members, K) low-frequency u = q_lo(v) + r x (q_hi(v) - q_lo(v)), r = the member's root u
    between q_lo and q_hi at its root v; q = SPREAD_Q quantiles of the card's member points per v bin (bins with
    fewer than SPREAD_MIN points take the nearest filled bin)."""
    K = U.shape[1]
    ok = (V >= 0.0) & (V <= 1.0) & (U >= U_KEEP[0]) & (U <= U_KEEP[1])
    b = np.clip((V * SPREAD_BINS).astype(np.int64), 0, SPREAD_BINS - 1)
    order = np.argsort(C, kind="stable")
    starts = np.searchsorted(C[order], np.arange(n + 1))
    out = U[:, :1].repeat(K, 1).astype(np.float64)
    centres = (np.arange(SPREAD_BINS) + 0.5) / SPREAD_BINS
    for c in range(n):
        mi = order[starts[c]:starts[c + 1]]
        if len(mi) == 0:
            continue
        uu, bb, kk = U[mi], b[mi], ok[mi]
        lo = np.full(SPREAD_BINS, np.nan)
        hi = np.full(SPREAD_BINS, np.nan)
        for j in range(SPREAD_BINS):
            x = uu[kk & (bb == j)]
            if len(x) >= SPREAD_MIN:
                lo[j], hi[j] = np.percentile(x, SPREAD_Q)
        g = np.flatnonzero(~np.isnan(lo))
        if len(g) == 0:
            continue
        near = g[np.abs(np.arange(SPREAD_BINS)[:, None] - g[None]).argmin(1)]
        lo, hi = lo[near], hi[near]
        hi = np.maximum(hi, lo + 1e-3)
        vv = np.clip(V[mi], 0.0, 1.0)
        qlo, qhi = np.interp(vv, centres, lo), np.interp(vv, centres, hi)
        r = (uu[:, 0] - qlo[:, 0]) / (qhi[:, 0] - qlo[:, 0])
        out[mi] = qlo + np.clip(r, -0.25, 1.25)[:, None] * (qhi - qlo)
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
    hreg = np.maximum(np.ceil(arcm * scale / px_v).astype(np.int64), a.min_region_px)
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

    # member depth spread per card (p10..p90 of each member's median depth), for --alpha-k-depth
    md = np.nanmedian(D, 1)
    spread = np.zeros(n)
    for c in range(n):
        x = md[C == c]
        if len(x) > 2:
            spread[c] = float(np.percentile(x, 90) - np.percentile(x, 10))
    spread_med = float(np.median(spread))
    k_card = np.full(n, a.alpha_k)
    if a.alpha_k_depth:
        k_card = 1.0 + (a.alpha_k - 1.0) * np.clip(spread / max(spread_med, 1e-9), 0.0, 1.0)
        k_card = np.maximum(k_card, a.alpha_k_min)
    if a.short_k:
        # cards-r6: a short card (sideburn, nape wisps) lies flat on the skin and stands for no depth volume, so
        # the power that thickens a hanging card's coverage double counts where the short cards overlap
        # (cards-r5/s6: 15 short cards stack to composite alpha 0.9 at rows 365-385 where the strands read as skin)
        mm, kk = (float(x) for x in a.short_k.split(":"))
        k_card = np.where(arcm * 1000.0 < mm, kk, k_card)

    # 1b. drift removal (u only)
    if a.drift_sigma > 0:
        r = int(math.ceil(3 * a.drift_sigma))
        kern = np.exp(-0.5 * (np.arange(-r, r + 1) / a.drift_sigma) ** 2)
        kern /= kern.sum()
        Up = np.pad(U.astype(np.float64), ((0, 0), (r, r)), mode="edge")
        low = np.stack([Up[:, j:j + 2 * r + 1] @ kern for j in range(U.shape[1])], 1)
        if a.anchor == "spread":
            base = spread_anchor(U, V, C, n)
        else:
            base = U[:, :1] if a.anchor == "root" else U.mean(1, keepdims=True)
        U = base + (U - low)
    # strands: first contiguous run of points inside the card from the root end
    K = U.shape[1]
    inside = (U >= U_KEEP[0]) & (U <= U_KEEP[1]) & (V >= 0.0) & (V <= 1.0)
    idx = np.arange(K)[None]
    first = np.argmax(inside, 1)
    after = (~inside) & (idx > first[:, None])
    end = np.where(after.any(1), np.argmax(after, 1), K)
    keep = inside.any(1) & ((end - first) >= 2)
    if a.strand_thin > 1:
        # rank of each member within its card (stable, member order of card-members.npz)
        order = np.argsort(C, kind="stable")
        rank = np.empty(len(C), np.int64)
        starts_c = np.searchsorted(C[order], C[order])
        rank[order] = np.arange(len(C)) - starts_c
        k_thin = np.full(n, a.strand_thin, np.int64)
        if a.thin_min_keep > 0:
            k_thin = np.clip(np.bincount(C, minlength=n) // a.thin_min_keep, 1, a.strand_thin)
        keep &= (rank % k_thin[C]) == 0
    rr, tr = rc["strand"]["rootRadiusMm"] / 1000.0, rc["strand"]["tipRadiusMm"] / 1000.0
    radk = rr + (tr - rr) * np.arange(K) / (K - 1)
    sizes, pos, rad = [], [], []
    n_cut = 0
    for i in np.where(keep)[0]:
        c = int(C[i])
        s = scale[c]
        k0, k1 = int(first[i]), int(end[i])
        Ui, Vi, Di, Ri = U[i, k0:k1], V[i, k0:k1], D[i, k0:k1], radk[k0:k1]
        cut = k1 < K and V[i, k1] > 1.0
        if a.cut_tip_spread > 0 and (cut or a.tip_spread_all):
            # cut by the card end, not by its own tip: end it at a seeded v in the last spread of the card;
            # --tip-spread-all: a member whose own tip lies past that v ends there too
            vc = 1.0 - a.cut_tip_spread * float(np.random.default_rng(1000003 + int(i)).random())
            j = int(np.searchsorted(Vi, vc, side="right"))      # V rises along a member inside the card
            if j >= 2 and (j < len(Vi) or cut):
                nxt = k0 + j                                     # < K: inside the run, or the first point past v = 1
                t = min(max((vc - Vi[j - 1]) / max(V[i, nxt] - Vi[j - 1], 1e-12), 0.0), 1.0)
                Ui = np.append(Ui[:j], Ui[j - 1] + t * (U[i, nxt] - Ui[j - 1]))
                Di = np.append(Di[:j], Di[j - 1] + t * (D[i, nxt] - Di[j - 1]))
                Ri = np.append(Ri[:j], Ri[j - 1])
                Vi = np.append(Vi[:j], vc)
                taper = np.clip((vc - Vi) / max(a.cut_tip_taper, 1e-6), 0.0, 1.0)
                Ri = tr + (Ri - tr) * taper
                n_cut += 1
        X = (reg[c, 0] + Ui * cw_in) * px_u
        Y = -(reg[c, 1] + Vi * reg[c, 2]) * px_v
        Z = Di * s * a.depth_gain
        sizes.append(len(Vi))
        pos.append(np.stack([X, Y, Z], 1))
        rad.append(Ri * s * (k_thin[c] if a.strand_thin > 1 else 1))
    pos = np.concatenate(pos)
    rad = np.concatenate(rad)

    # 3. scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ob = groom.make_curves("members", sizes, pos, radius=rad)
    if a.random_color is not None:
        rc = json.loads(json.dumps(rc))
        rc["shading"]["randomColor"] = a.random_color
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
    if a.filter_width is not None:
        sc.cycles.filter_width = a.filter_width
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
    for c, (cy0, cx0, cell) in enumerate(cells_out):
        if a.alpha_norm == "power":
            cell[..., 3] = 1.0 - (1.0 - cell[..., 3]) ** k_card[c]
        else:
            cell[..., 3] = np.clip(cell[..., 3] / a_ref, 0.0, 1.0)
        atlas[cy0:cy0 + cell.shape[0], cx0:cx0 + cell.shape[1]] = cell
    out_png = np.concatenate([srgb(atlas[..., :3]), atlas[..., 3:]], 2)
    ap = out / "strand-atlas.png"
    Image.fromarray(np.round(out_png * 255).astype(np.uint8), "RGBA").save(ap, compress_level=9)
    leak = float(alpha_r[~in_reg].sum() / max(alpha_r.sum(), 1e-9))
    rec = {"tool": "tools/openclinxr/hair-groom-2/cards/atlas_from_members.py", "round": str(rd),
           "recipeSha256": sha(rd / "recipe.json"), "cardsSha256": sha(a.cards), "membersSha256": sha(a.members),
           "samples": a.samples, "m2": {"filterWidth": a.filter_width, "randomColor": a.random_color,
                                        "depthGain": a.depth_gain, "strandThin": a.strand_thin, "minRegionPx": a.min_region_px, "thinMinKeep": a.thin_min_keep,
                                        **({"cutTipSpread": a.cut_tip_spread, "cutTipTaper": a.cut_tip_taper,
                                            "cutTipMembers": n_cut, "tipSpreadAll": a.tip_spread_all} if a.cut_tip_spread > 0 else {})}, "driftSigmaPts": a.drift_sigma, "anchor": a.anchor, "device": "CPU (determinism), seed 0, no denoise",
           "atlasPx": A, "cellPx": [int(cells[0, 2]), int(cells[0, 3])], "cellInnerPx": [cw_in, int(cells[0, 3]) - 2],
           "cards": n, "strandsDrawn": int(keep.sum()), "strandsTotal": int(len(U)),
           "render": {"px": [resx, resy], "pixelAspect": a.aspect, "pxAcrossMm": px_u * 1000,
                      "pxAlongMm": px_v * 1000, "WREFmm": WREF * 1000, "scaleClampedCards": int(((WREF / wm) != scale).sum()), "seconds": t_render,
                      "alphaOutsideRegions": leak, "sha256": sha(rp)},
           "regionAlongPx": {"min": int(hreg.min()), "median": float(np.median(hreg)), "max": int(hreg.max())},
           "lighting": {"world": "groom.setup_render grey", "suns": suns,
                        "rule": "rig area light P/(pi d^2) at the head, elevation toward the card root, azimuth dropped"},
           "alphaNorm": {"mode": a.alpha_norm, "AREF": a_ref, "k": a.alpha_k, "kDepth": a.alpha_k_depth,
                         "depthSpreadMedianMm": spread_med * 1000,
                         "shortK": a.short_k or None, "kCard": {"min": float(k_card.min()), "p10": float(np.percentile(k_card, 10)),
                                   "median": float(np.median(k_card))}},
           "cellAlphaRaw": {"meanMedian": float(np.median(cs[:, 0])), "edgeColsMedian": float(np.median(cs[:, 1])),
                         "centreColsMedian": float(np.median(cs[:, 2]))},
           "material": "groom.hair_material(recipe)", "atlas": ap.name, "atlasSha256": sha(ap),
           "seconds": time.time() - t0}
    (out / "atlas-record.json").write_text(json.dumps(rec, indent=1))
    print("ATLAS_DONE", rec["atlasSha256"], json.dumps({k: rec[k] for k in ("render", "alphaNorm", "cellAlphaRaw", "cellPx")}), flush=True)


main()
