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
    p.add_argument("--bake-glb", required=True)
    p.add_argument("--views", default="front,three_quarter_left,side,back")
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--alpha-cutoff", type=float, default=0.2)
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
    c = cell[vc[li]]
    cx, cy = c % 2, c // 2
    u = (cx + uv[li, 0]) / 2.0
    v = 1.0 - (cy + uv[li, 1]) / 2.0
    ul.data.foreach_set("uv", np.stack([u, v], 1).ravel().astype(np.float32))
    for poly in me.polygons:
        poly.use_smooth = True
    return me


def card_material(atlas, roughness, cutoff):
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
    nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    if cutoff is None:
        nt.links.new(t.outputs["Alpha"], p.inputs["Alpha"])
    else:
        g = nt.nodes.new("ShaderNodeMath")
        g.operation = "GREATER_THAN"
        g.inputs[1].default_value = cutoff
        nt.links.new(t.outputs["Alpha"], g.inputs[0])
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
    rough = float(rc["shading"]["roughness"])
    me.materials.append(card_material(Path(a.atlas), rough, a.alpha_cutoff))

    # 3: signed clearance to the body
    col = groom.Collider([body])
    sd = np.array([col.signed(Vector(v))[0] for v in cards["card_verts"]])

    # 5: one polyline per card for grade.py (centreline = mean of the two edge rows)
    n = int(cards["n_cards"])
    starts = np.searchsorted(cards["vert_card"], np.arange(n))
    P = (starts[1] - starts[0]) // 2
    cl = np.concatenate([0.5 * (cards["card_verts"][s:s + 2 * P:2] + cards["card_verts"][s + 1:s + 2 * P:2])
                         for s in starts])
    np.savez_compressed(out / "strands.npz", positions=cl, offsets=np.arange(0, n * P + 1, P),
                        signedBodyM=sd, note=np.array("card centrelines, not strands"))

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
                     "roughness": rough, "renderAlphaCutoff": a.alpha_cutoff},
        "hiddenObjects": hidden,
    }

    # 4: renders through groom.py's rig
    views = [v for v in a.views.split(",") if v]
    devs = groom.setup_render(a.samples)
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
    dme.materials.append(card_material(Path(a.atlas), rough, None))
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
