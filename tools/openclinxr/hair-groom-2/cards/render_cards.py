"""Card result as a rubric round dir + the donor GLB for transplant (Blender 5.2 headless).

    Blender --background --factory-startup --python render_cards.py -- \
        --body <actor.glb> --groom-round <dir> --cards <cards.npz> --atlas <strand-atlas.png> \
        --out-dir <round dir> --bake-glb <donor.glb> [--views front,three_quarter_left,side,back] [--samples 128]

1. Card mesh from cards.npz. UV: atlas cell = cards.npz card_cell (v1 `_blender_build_render.py`
   used the card id, so every card past id 3 sampled outside the atlas and rendered empty);
   v = 0 (root) at the image top.
2. Material, the same in the Cycles render and the export: Principled BSDF, base colour = atlas
   RGB (sRGB), alpha = atlas A, roughness = recipe shading.roughness, no other input. In the Cycles
   render alpha is thresholded at --alpha-cutoff (0.2, the MASK value the transplant writes) so the
   render matches what the runtime draws; the export carries plain alpha and the transplant sets
   MASK.
3. Signed clearance of every card vertex to the body (groom.Collider: BVH nearest + face normal),
   red-team V4(a): cards.py's own MeshIndex distance is unsigned.
4. Renders with groom.py's camera rig, recipe lighting, world and samples, so grade.py's canonical
   frame applies unchanged (identity frame).
5. Round files for grade.py: recipe.json (copy), stats.json, strands.npz with one polyline per
   card (the card centreline) so A3/I7 reads card tip heights.
6. Donor GLB: the actor's library-hair object keeps its name, armature modifier and skin; its mesh
   becomes the cards, weighted 100% to the vertex group that carries most of the library hair's
   weight (the head bone; library hair ships 100% head-weighted). Long-hair neck/spine weighting
   (DESIGN S6) is NOT done.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "groom"))
import groom  # noqa: E402


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--body", required=True)
    p.add_argument("--groom-round", required=True)
    p.add_argument("--cards", required=True)
    p.add_argument("--atlas", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--bake-glb", default=None)
    p.add_argument("--views", default="front,three_quarter_left,side,back")
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--alpha-cutoff", type=float, default=0.2)
    p.add_argument("--alpha-mode", choices=("mask", "blend"), default="mask",
                   help="Cycles render alpha: mask = (A > cutoff), the runtime MASK; blend = A where A > cutoff, else 0 "
                        "(coverage-faded card edges; cards-r3)")
    p.add_argument("--roughness", type=float, default=None,
                   help="card Principled roughness (calibration record); default = recipe shading.roughness")
    p.add_argument("--specular", type=float, default=None,
                   help="Principled Specular IOR Level (calibration record); default = Blender's 0.5")
    p.add_argument("--shadow-alpha", type=float, default=1.0,
                   help="blend mode: the card's alpha as seen by shadow rays, x this factor")
    p.add_argument("--card-shadow", choices=("on", "off"), default="on",
                   help="off: the card object casts no Cycles shadow (the atlas already carries the members' occlusion)")
    p.add_argument("--hide-cards", action="store_true",
                   help="render the body without hair (calibration base); no donor GLB, no strands.npz")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def card_mesh(cards, name):
    V = cards["card_verts"]
    F = cards["card_tris"]
    uv = cards["card_uv"]
    vc = cards["vert_card"]
    cell = cards["card_cell"]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], [tuple(int(i) for i in f) for f in F])
    me.update()
    ul = me.uv_layers.new(name="UVMap")
    li = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", li)
    if "card_atlas_uv" in cards.files:   # cards-r3: one unique atlas cell per card (cards_from_strands.py)
        auv = cards["card_atlas_uv"][li]
    else:
        c = cell[vc[li]]
        cx, cy = c % 2, c // 2
        auv = np.stack([(cx + uv[li, 0]) / 2.0, 1.0 - (cy + uv[li, 1]) / 2.0], 1)
    ul.data.foreach_set("uv", auv.ravel().astype(np.float32))
    for poly in me.polygons:
        poly.use_smooth = True
    return me


def card_material(atlas, roughness, cutoff, specular=None, mode="mask", shadow_alpha=1.0):
    m = bpy.data.materials.new("hair_cards" if cutoff is None else "hair_cards_render")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(str(atlas), check_existing=True)
    t.image.colorspace_settings.name = "sRGB"
    t.interpolation = "Linear"
    p.inputs["Roughness"].default_value = roughness
    p.inputs["Metallic"].default_value = 0.0
    if specular is not None:
        p.inputs["Specular IOR Level"].default_value = specular
    nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    if cutoff is None:
        nt.links.new(t.outputs["Alpha"], p.inputs["Alpha"])
    else:
        g = nt.nodes.new("ShaderNodeMath")
        g.operation = "GREATER_THAN"
        g.inputs[1].default_value = cutoff
        nt.links.new(t.outputs["Alpha"], g.inputs[0])
        if mode == "blend":
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            nt.links.new(g.outputs[0], mul.inputs[0])
            nt.links.new(t.outputs["Alpha"], mul.inputs[1])
            if shadow_alpha != 1.0:
                # shadow rays see the card at shadow_alpha x its alpha (Light Path Is Shadow Ray)
                lp = nt.nodes.new("ShaderNodeLightPath")
                f = nt.nodes.new("ShaderNodeMath")
                f.operation = "MULTIPLY_ADD"     # 1 + is_shadow x (shadow_alpha - 1)
                f.inputs[1].default_value = shadow_alpha - 1.0
                f.inputs[2].default_value = 1.0
                nt.links.new(lp.outputs["Is Shadow Ray"], f.inputs[0])
                m2 = nt.nodes.new("ShaderNodeMath")
                m2.operation = "MULTIPLY"
                nt.links.new(mul.outputs[0], m2.inputs[0])
                nt.links.new(f.outputs[0], m2.inputs[1])
                nt.links.new(m2.outputs[0], p.inputs["Alpha"])
            else:
                nt.links.new(mul.outputs[0], p.inputs["Alpha"])
        else:
            nt.links.new(g.outputs[0], p.inputs["Alpha"])
    nt.links.new(p.outputs["BSDF"], o.inputs["Surface"])
    return m


def main():
    a = cli()
    t0 = time.time()
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    gr = Path(a.groom_round)
    rc = json.loads((gr / "recipe.json").read_text())
    shutil.copyfile(gr / "recipe.json", out / "recipe.json")
    cards = np.load(a.cards)
    body, garments, rig, hidden = groom.load_body(Path(a.body))
    lib = [o for o in bpy.data.objects if o.type == "MESH" and groom.LIB_HAIR_TAG in o.name]
    if len(lib) != 1:
        raise RuntimeError("expected one library hair object, got %s" % [o.name for o in lib])
    lib = lib[0]
    bbm = groom.world_bmesh(body)
    origin, R, centre, ztop = groom.head_frame(rig, bbm)
    bbm.free()

    # 1-2: render object (world space, unparented)
    me = card_mesh(cards, "cards_render")
    ob = bpy.data.objects.new("cards_render", me)
    bpy.context.scene.collection.objects.link(ob)
    rough = float(rc["shading"]["roughness"]) if a.roughness is None else a.roughness
    me.materials.append(card_material(Path(a.atlas), rough, a.alpha_cutoff, a.specular, a.alpha_mode,
                                    a.shadow_alpha))
    ob.visible_shadow = a.card_shadow == "on"

    # 3: signed clearance to the body
    col = groom.Collider([body])
    sd = np.array([col.signed(Vector(v))[0] for v in cards["card_verts"]])

    # 5: one polyline per card for grade.py (centreline = mean of the two edge rows)
    n = int(cards["n_cards"])
    starts = np.searchsorted(cards["vert_card"], np.arange(n))
    P = (starts[1] - starts[0]) // 2
    cl = np.concatenate([0.5 * (cards["card_verts"][s:s + 2 * P:2] + cards["card_verts"][s + 1:s + 2 * P:2])
                         for s in starts])
    loc = (np.array(R) @ (cl - np.array(origin)).T).T     # groom.py head-local frame (grade.py E1)
    if not a.hide_cards:
        np.savez_compressed(out / "strands.npz", positions=cl, offsets=np.arange(0, n * P + 1, P),
                            localPositions=loc, signedBodyM=sd, note=np.array("card centrelines, not strands"))
    else:
        ob.hide_render = True

    stats = {
        "kind": "hair-cards", "body": str(a.body), "bodySha256": sha(a.body),
        "groomRound": str(gr), "recipeSha256": sha(gr / "recipe.json"),
        "cards": str(a.cards), "cardsSha256": sha(a.cards), "atlas": str(a.atlas), "atlasSha256": sha(a.atlas),
        "cardCount": n, "triangles": int(len(cards["card_tris"])), "vertices": int(len(cards["card_verts"])),
        "cardsLayout": {k: float(cards[k]) for k in ("min_clearance_mm", "garment_prox_min_mm", "twist_max_deg",
                                                     "push_max_mm")} | {"push_count": int(cards["push_count"])},
        "clearance": {"minSignedMmBody": float(sd.min() * 1000), "negativePointsBody": int((sd < 0).sum()),
                      "rule": "every card vertex, groom.Collider([body]).signed (BVH nearest, face-normal sign)"},
        "material": {"model": "Principled BSDF", "baseColor": "atlas RGB (sRGB)", "alpha": "atlas A",
                     "roughness": rough, "renderAlphaCutoff": a.alpha_cutoff, "renderAlphaMode": a.alpha_mode, "cardShadow": a.card_shadow, "shadowAlpha": a.shadow_alpha,
                     "specularIorLevel": 0.5 if a.specular is None else a.specular},
        "hiddenObjects": hidden,
    }

    # 4: renders through groom.py's rig
    views = [v for v in a.views.split(",") if v]
    devs = groom.setup_render(a.samples)
    if a.alpha_mode == "blend":   # stacked fractional-alpha cards: default 8 transparent bounces end paths early
        bpy.context.scene.cycles.transparent_max_bounces = 128
    place, cam = groom.camera_rig(origin, R, centre, ztop, groom.eye_height(), rc.get("lighting"))
    stats["render"] = {"engine": "CYCLES", "devices": devs, "samples": a.samples, "denoise": True,
                       "lighting": rc.get("lighting"), "resolution": groom.RES, "camera": cam, "views": {}}
    for v in views:
        place(groom.VIEW_AZIMUTH_DEG[v])
        bpy.context.scene.render.filepath = str(out / (v + ".png"))
        t1 = time.time()
        bpy.ops.render.render(write_still=True)
        stats["render"]["views"][v] = {"seconds": time.time() - t1}
        print("VIEW_DONE", v, round(time.time() - t1, 1), flush=True)

    if a.hide_cards or not a.bake_glb:
        stats["seconds"] = time.time() - t0
        (out / "stats.json").write_text(json.dumps(stats, indent=2, sort_keys=True))
        print("CARDS_RENDER_DONE", "no donor", flush=True)
        return
    # 6: donor GLB
    bpy.data.objects.remove(ob)
    weights = {}
    for vg in lib.vertex_groups:
        weights[vg.name] = 0.0
    for v in lib.data.vertices:
        for g in v.groups:
            weights[lib.vertex_groups[g.group].name] += g.weight
    head = max(weights, key=weights.get)
    share = weights[head] / max(sum(weights.values()), 1e-12)
    lib_world = lib.matrix_world.copy()
    dme = card_mesh(cards, lib.data.name)
    dme.transform(lib_world.inverted())
    old = lib.data
    lib.data = dme
    bpy.data.meshes.remove(old)
    lib.vertex_groups.clear()
    vg = lib.vertex_groups.new(name=head)
    vg.add(list(range(len(dme.vertices))), 1.0, "REPLACE")
    dme.materials.append(card_material(Path(a.atlas), rough, None, a.specular))
    lib.hide_render = False
    lib.hide_viewport = False
    lib.hide_set(False)
    Path(a.bake_glb).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(a.bake_glb), export_format="GLB", export_skins=True,
                              export_animations=False, export_morph=False, export_image_format="AUTO",
                              export_yup=True, export_apply=False)
    stats["donor"] = {"glb": str(a.bake_glb), "sha256": sha(a.bake_glb), "object": lib.name,
                      "weightGroup": head, "libraryHairWeightShareOfThatGroup": share,
                      "note": "100% one group; DESIGN S6 neck01/spine05 weighting for long recipes not done"}
    stats["seconds"] = time.time() - t0
    (out / "stats.json").write_text(json.dumps(stats, indent=2, sort_keys=True))
    print("CARDS_RENDER_DONE", json.dumps({k: stats[k] for k in ("cardCount", "triangles", "clearance")}), flush=True)


main()
