"""P3 strand reference: a groom's strands rendered in the target scene (DESIGN-realism.md P3, T4).

The scene is `tools/openclinxr/evidence/hair-target2/make_sources.py` (the scene that rendered the Imagine inputs):
Cycles 64 samples + OIDN, 1024x1024, world grey .5, 12 m backdrop plane (.72,.72,.74) at (0, 2.2, 1.0), KEY/FILL/RIM
Area lights, pink matte shirt, cameras from cameras-scorer-v3.json. Copied here because make_sources.py runs at
import; any change there must be mirrored (the constants below are the check).

The body comes from a runtime GLB (default: the shipped cards GLB), so strand and card renders share one body and
its albedo. Removed before render: every mesh whose name carries 'hair' (except brow/lash), the 2 m environment
Icosphere and the low-poly proxy. The strands come from groom.py's strands.npz (world positions, offsets) and are
shaded with groom.py's hair_material() from the recipe; the per-strand radius scale of cut_children() is not saved
in strands.npz, so radius is the recipe root->tip taper without it.

Usage (background):
  Blender --background --python strands_in_target_scene.py -- --body-glb <glb> --strands <strands.npz>
      --recipe <recipe.json> --cameras <cameras-scorer-v3.json> --out-dir <dir> [--views front,...] [--bald] [--matte]
      [--samples 64]
Writes strands-<view>.png (bald-<view>.png with --bald, matte-<view>.png with --matte), report.json (root-to-skin distances, removed objects).
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

VIEWS = ("front", "three_quarter", "profile_90", "back")
SHIRT_TAG = "toigo_t_shirt"
DROP_EXACT = {"icosphere"}
DROP_SUFFIX = (".low-poly",)


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--body-glb", required=True)
    p.add_argument("--strands", required=True)
    p.add_argument("--recipe", required=True)
    p.add_argument("--cameras", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--views", default=",".join(VIEWS))
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--bald", action="store_true", help="also render each view without the strands")
    p.add_argument("--matte", action="store_true",
                   help="also render matte-<view>.png: every other object a holdout, film transparent, 16 samples; "
                        "alpha = hair coverage (the diff mask against the bald render also catches shirt and skin "
                        "whose shading the hair changes)")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def hair_material(rc):
    """groom.py hair_material(), same inputs."""
    sh = rc["shading"]
    m = bpy.data.materials.new("groom_hair")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    h = nt.nodes.new("ShaderNodeBsdfHairPrincipled")
    h.model = sh["model"]
    h.parametrization = "MELANIN"
    h.inputs["Melanin"].default_value = sh["melanin"]
    h.inputs["Melanin Redness"].default_value = sh["melaninRedness"]
    h.inputs["Roughness"].default_value = sh["roughness"]
    if "Radial Roughness" in h.inputs:
        h.inputs["Radial Roughness"].default_value = sh["radialRoughness"]
    if "Coat" in h.inputs:
        h.inputs["Coat"].default_value = sh["coat"]
    h.inputs["Random Color"].default_value = sh["randomColor"]
    h.inputs["Random Roughness"].default_value = sh["randomRoughness"]
    if "tint" in sh:
        h.inputs["Tint"].default_value = tuple(sh["tint"]) + (1.0,)
    for k, name in (("lobeReflection", "Reflection"), ("lobeTransmission", "Transmission"),
                    ("lobeSecondaryReflection", "Secondary Reflection")):
        if k in sh and name in h.inputs:
            h.inputs[name].default_value = sh[k]
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(h.outputs[0], o.inputs["Surface"])
    return m


def scene_setup(samples):
    """make_sources.py scene, verbatim values."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    bpy.ops.mesh.primitive_plane_add(size=12.0, location=(0.0, 2.2, 1.0))
    backdrop = bpy.context.active_object
    backdrop.rotation_euler[0] = 0.0
    bmat = bpy.data.materials.new("AISHA_BACKDROP")
    bmat.use_nodes = True
    b = bmat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.72, 0.72, 0.74, 1.0)
    b.inputs["Roughness"].default_value = 1.0
    backdrop.data.materials.append(bmat)
    for name, loc, energy, size in (("KEY", (-1.5, -2.0, 2.2), 100.0, 2.0), ("FILL", (1.5, -2.0, 1.8), 40.0, 2.0),
                                    ("RIM", (0.0, 2.0, 2.6), 60.0, 1.5)):
        bpy.ops.object.light_add(type="AREA", location=loc)
        lamp = bpy.context.active_object
        lamp.name = name
        lamp.data.energy = energy
        lamp.data.size = size
        lamp.data.color = (1.0, 1.0, 1.0)
    return scene


def main():
    a = cli()
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rc = json.loads(Path(a.recipe).read_text())
    cams = json.loads(Path(a.cameras).read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(a.body_glb))
    removed = []
    for obj in list(bpy.data.objects):
        low = obj.name.lower()
        if obj.type != "MESH":
            continue
        if ("hair" in low and "brow" not in low and "lash" not in low) or low in DROP_EXACT \
                or low.endswith(DROP_SUFFIX):
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    pink = bpy.data.materials.new("AISHA_PINK_SHIRT")
    pink.use_nodes = True
    pb = pink.node_tree.nodes["Principled BSDF"]
    pb.inputs["Base Color"].default_value = (0.91, 0.55, 0.64, 1.0)
    pb.inputs["Roughness"].default_value = 0.9
    shirts = []
    for obj in bpy.data.objects:
        if obj.type == "MESH" and SHIRT_TAG in obj.name.lower():
            obj.data.materials.clear()
            obj.data.materials.append(pink)
            shirts.append(obj.name)
    body = [o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("_body")]
    if len(body) != 1:
        raise RuntimeError("expected one *_body mesh, got %s" % [o.name for o in body])
    body = body[0]

    z = np.load(a.strands)
    pos, off = z["positions"].astype(np.float64), z["offsets"].astype(np.int64)
    sizes = np.diff(off)
    # root seating against this body (the groom was built on its own body version)
    dg = bpy.context.evaluated_depsgraph_get()
    me = body.evaluated_get(dg).to_mesh()
    mw = body.matrix_world
    bvh = BVHTree.FromPolygons([mw @ v.co for v in me.vertices], [p.vertices[:] for p in me.polygons])
    roots = pos[off[:-1]]
    d = []
    for r in roots[:: max(1, len(roots) // 4000)]:
        loc, nrm, _, dist = bvh.find_nearest(Vector(r))
        d.append(dist * (1.0 if (Vector(r) - loc).dot(nrm) >= 0 else -1.0))
    d = np.array(d) * 1000.0
    rr, tr = rc["strand"]["rootRadiusMm"] / 1000.0, rc["strand"]["tipRadiusMm"] / 1000.0
    rad = np.concatenate([np.linspace(rr, tr, s) for s in sizes])
    hc = bpy.data.hair_curves.new("groom_hair")
    hc.add_curves([int(s) for s in sizes])
    hc.position_data.foreach_set("vector", pos.astype(np.float32).ravel())
    ra = hc.attributes["radius"] if "radius" in hc.attributes else hc.attributes.new("radius", "FLOAT", "POINT")
    ra.data.foreach_set("value", rad.astype(np.float32))
    hob = bpy.data.objects.new("groom_hair", hc)
    bpy.context.scene.collection.objects.link(hob)
    hob.data.materials.append(hair_material(rc))

    scene = scene_setup(a.samples)
    cam_data = bpy.data.cameras.new("P3_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    cam = bpy.data.objects.new("P3_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    rep = {"bodyGlb": str(a.body_glb), "strands": str(a.strands), "recipe": str(a.recipe), "removed": sorted(removed),
           "pinkShirt": shirts, "body": body.name, "curves": int(len(sizes)), "points": int(len(pos)),
           "rootSignedMm": {"n": int(len(d)), "p5": float(np.percentile(d, 5)), "median": float(np.median(d)),
                            "p95": float(np.percentile(d, 95)), "negFrac": float((d < 0).mean())},
           "samples": a.samples, "renders": []}
    print("P3_REPORT", json.dumps(rep), flush=True)
    for view in a.views.split(","):
        rec = cams["views"][view]
        cam_data.lens = float(rec["lensMm"])
        cam.matrix_world = Matrix(rec["matrixWorld"])
        passes = [("strands", False)] + ([("bald", True)] if a.bald else [])
        for tag, hide in passes:
            hob.hide_render = hide
            bpy.context.view_layer.update()
            scene.render.filepath = str(out / ("%s-%s.png" % (tag, view)))
            bpy.ops.render.render(write_still=True)
            rep["renders"].append(scene.render.filepath)
            print("WROTE", scene.render.filepath, flush=True)
        if a.matte:
            others = [o for o in scene.objects if o.type == "MESH" and o is not hob]
            keep = (scene.render.film_transparent, scene.cycles.samples, scene.cycles.use_denoising,
                    scene.render.image_settings.color_mode)
            hob.hide_render = False
            for o in others:
                o.is_holdout = True
            scene.render.film_transparent = True
            scene.cycles.samples = 16
            scene.cycles.use_denoising = False
            scene.render.image_settings.color_mode = "RGBA"
            scene.render.filepath = str(out / ("matte-%s.png" % view))
            bpy.ops.render.render(write_still=True)
            rep["renders"].append(scene.render.filepath)
            print("WROTE", scene.render.filepath, flush=True)
            for o in others:
                o.is_holdout = False
            (scene.render.film_transparent, scene.cycles.samples, scene.cycles.use_denoising,
             scene.render.image_settings.color_mode) = keep
    (out / "report.json").write_text(json.dumps(rep, indent=1))


main()
