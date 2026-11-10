"""Cycles strand-tile atlas from a strand-groom recipe (Blender 5.2 headless).

    Blender --background --factory-startup --python atlas_bake.py -- \
        --round <groom round dir> --cards <cards.npz> --out-dir <dir> [--samples 128]

Replaces v1 textures.py for this lane (procedural numpy strands, SEED = 7 regardless of the
recipe: red-team V1 seed; ignores clump/frizz: V7). Each 2x2 atlas cell (v1 layout, card_cell =
card id % 4) is a Cycles render of a flat strand patch groomed by the SAME child chain as the
head groom (groom.groom_tree: bundled Interpolate -> Clump -> Frizz -> Trim node groups, every
parameter from the recipe), seed = recipe seed + cell:
  1. patch size from the card layout: root width W = median cards.py card width, length
     L = median card centreline length; the patch is 3W wide and only its centre W is framed,
     so the clump/interpolate edge falloff stays off the tile;
  2. root strip depth d = scalp area / (layer-0 card count x W): one card's share of the scalp,
     so children (recipe densityPerM2 on that strip) give the strand count one card stands for;
  3. guides: straight, vertical, 32 points, root spacing = the groom's Poisson radius (stats.json);
  4. the evaluated strands are mapped into the unit tile (x = (x + W/2) / W, y = 1 + z / L: root
     at the image top) with radii from recipe strand.root/tipRadiusMm divided by W, shaded with
     groom.hair_material(recipe) (HUANG, melanin from the recipe), lit by a uniform white world
     of strength 1.0, orthographic, film transparent, Standard view transform:
     RGB = reflectance under uniform light, A = coverage.
The earlier variant (real head strands flattened per card) was dropped: card twist and bundle
drift, already carried by the card geometry, showed up a second time as cross-card sweeps.
No colour, coordinate or strand is chosen by hand. Writes strand-atlas.png (2048 RGBA),
tiles/*.png, atlas-record.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "groom"))
import groom  # noqa: E402  (helpers only; main() is guarded)

# --factory-startup drops the user module path where Pillow 11.3.0 is installed (lane handoff)
sys.path.append(bpy.utils.user_resource("SCRIPTS", path="modules"))

CELL = 1024
TILES = 4
PATCH_WIDTHS = 3


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--round", required=True)
    p.add_argument("--cards", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--samples", type=int, default=128)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def card_lengths(cards):
    V, vc, n = cards["card_verts"], cards["vert_card"], int(cards["n_cards"])
    starts = np.searchsorted(vc, np.arange(n))
    P = (starts[1] - starts[0]) // 2
    out = []
    for c in range(n):
        blk = V[starts[c]:starts[c] + 2 * P]
        C = 0.5 * (blk[0::2] + blk[1::2])
        out.append(np.linalg.norm(np.diff(C, axis=0), axis=1).sum())
    return np.array(out)


def patch(W, d, L, prad, P, along=False):
    me = bpy.data.meshes.new("patch")
    bm = bmesh.new()
    x0, x1 = -PATCH_WIDTHS * W / 2, PATCH_WIDTHS * W / 2
    if along:   # root strip in the card plane, running down the card: roots staggered in v
        vs = [bm.verts.new(c) for c in ((x0, 0, 0), (x1, 0, 0), (x1, 0, -d), (x0, 0, -d))]
    else:
        vs = [bm.verts.new(c) for c in ((x0, 0, 0), (x1, 0, 0), (x1, d, 0), (x0, d, 0))]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new(groom.SCALP_UV)
    for lp in f.loops:
        co = lp.vert.co
        lp[uvl].uv = ((co.x - x0) / (x1 - x0), (-co.z if along else co.y) / d)
    bm.to_mesh(me)
    bm.free()
    surf = bpy.data.objects.new("patch", me)
    bpy.context.scene.collection.objects.link(surf)
    surf.hide_render = True
    gx = np.arange(x0 + prad / 2, x1, prad)
    roots = (np.stack([gx, np.zeros_like(gx), np.full_like(gx, -d / 2)], 1) if along
             else np.stack([gx, np.full_like(gx, d / 2), np.zeros_like(gx)], 1))
    t = np.linspace(0.0, 1.0, P)
    guides = roots[:, None, :] + np.stack([np.zeros_like(t), np.zeros_like(t), -L * t], 1)[None]
    uv = np.stack([(gx - x0) / (x1 - x0), np.full_like(gx, 0.5)], 1)
    return surf, guides, uv


def render_tile(rc, seed, W, d, L, prad, samples, path, along=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    groom.load_assets()
    P = rc["guides"]["pointsPerStrand"]
    surf, guides, uv = patch(W, d, L, prad, P, along)
    gob = groom.make_curves("patch_guides", [P] * len(guides), guides.reshape(-1, 3), uv=uv)
    gob.data.surface = surf
    gob.data.surface_uv_map = groom.SCALP_UV
    mod = gob.modifiers.new("children", "NODES")
    mod.node_group = groom.groom_tree(rc, seed)
    pos, off = groom.read_curves(gob)
    gob.hide_render = True
    sizes = np.diff(off)
    tile = np.stack([(pos[:, 0] + W / 2) / W, 1.0 + pos[:, 2] / L, pos[:, 1] / W], 1)
    rr, tr = rc["strand"]["rootRadiusMm"] / 1000.0, rc["strand"]["tipRadiusMm"] / 1000.0
    rad = np.concatenate([np.linspace(rr, tr, s) for s in sizes]) / W
    ob = groom.make_curves("tile", sizes, tile, radius=rad)
    mat, _ = groom.hair_material(rc)
    ob.data.materials.append(mat)
    sc = bpy.context.scene
    groom.setup_render(samples)
    # CPU only: the Metal GPU (+ hybrid CPU) tile renders differed run to run (cards-r2 s4 rerun:
    # 444,366 atlas px, max 149/255), so the atlas hash was not reproducible
    sc.cycles.device = "CPU"
    sc.render.resolution_x = sc.render.resolution_y = CELL
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    cd = bpy.data.cameras.new("tilecam")
    cd.type = "ORTHO"
    cd.ortho_scale = 1.0
    cd.clip_end = 20.0
    cam = bpy.data.objects.new("tilecam", cd)
    sc.collection.objects.link(cam)
    cam.location = (0.5, 0.5, 5.0)
    sc.camera = cam
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    inside = (tile[:, 0] >= 0) & (tile[:, 0] <= 1)
    return {"strandsPatch": int(len(sizes)), "pointsInTile": int(inside.sum())}


def main():
    a = cli()
    t0 = time.time()
    rd, out = Path(a.round), Path(a.out_dir)
    (out / "tiles").mkdir(parents=True, exist_ok=True)
    rc = json.loads((rd / "recipe.json").read_text())
    st = json.loads((rd / "stats.json").read_text())
    cards = np.load(a.cards)
    W = float(np.median(cards["card_width_mm"])) / 1000.0
    L = float(np.median(card_lengths(cards)))
    n0 = int((cards["card_layer"] == 0).sum())
    along = "card_root_depth_mm" in cards.files
    # cards from strands: the strip is the members' root extent along the card (median over cards),
    # laid down the card so the tile's roots are staggered in v; v1 layout: one card's scalp share
    d = (float(np.median(cards["card_root_depth_mm"])) / 1000.0 if along
         else st["scalp"]["areaM2"] / (n0 * W))
    prad = st["guides"]["poissonRadiusMm"] / 1000.0
    from PIL import Image
    atlas = np.zeros((2 * CELL, 2 * CELL, 4), np.uint8)
    tiles = []
    for cell in range(TILES):
        seed = int(rc["seed"]) + cell
        tp = out / "tiles" / ("cell%d-seed%d.png" % (cell, seed))
        info = render_tile(rc, seed, W, d, L, prad, a.samples, tp, along)
        im = np.asarray(Image.open(tp).convert("RGBA"))
        cx, cy = cell % 2, cell // 2
        atlas[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL] = im
        alpha = im[..., 3].astype(np.float64) / 255.0
        hair = alpha > 0.2
        tiles.append(dict(cell=cell, seed=seed, png=tp.name, sha256=sha(tp), **info,
                          maskFractionByVBand_cutoff0p2=[float(hair[r:r + CELL // 8].mean())
                                                         for r in range(0, CELL, CELL // 8)],
                          meanRgbInMask=im[..., :3][hair].mean(0).tolist() if hair.any() else None))
        print("TILE_DONE", cell, info, flush=True)
    ap = out / "strand-atlas.png"
    Image.fromarray(atlas, "RGBA").save(ap, compress_level=9)
    rec = {"tool": "tools/openclinxr/hair-groom-2/cards/atlas_bake.py", "round": str(rd),
           "recipeSha256": sha(rd / "recipe.json"), "cardsSha256": sha(a.cards),
           "seed": int(rc["seed"]), "samples": a.samples,
           "patch": {"rootWidthMm": W * 1000, "lengthMm": L * 1000, "stripDepthMm": d * 1000,
                     "guideSpacingMm": prad * 1000, "layer0Cards": n0,
                     "rootStripAlongCard": along,
                     "derivation": "W = median card_width_mm; L = median card centreline length; "
                                   + ("d = median card_root_depth_mm (member root extent along the card), strip laid down the card"
                                      if along else "d = stats.scalp.areaM2 / (layer-0 cards x W)")
                                   + "; spacing = stats.guides.poissonRadiusMm"},
           "tiles": tiles, "atlas": ap.name, "atlasSha256": sha(ap), "seconds": time.time() - t0,
           "lighting": "uniform white world strength 1.0, no lamps, Standard view transform, film transparent",
           "device": "CPU (determinism)",
           "material": "groom.hair_material(recipe)"}
    (out / "atlas-record.json").write_text(json.dumps(rec, indent=1))
    print("ATLAS_DONE", rec["atlasSha256"], flush=True)


main()
