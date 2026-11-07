#!/usr/bin/env python3
"""hair-crown4 cell scorer: score.py v3 + TT 0.5 + liner variants + cap-green.

--liner {s50,fade_skin,fade_mid}: cap-copy liner (+20um, hidden in ID):
  s50       = flat s50 (0.011,0.0045,0.0025), crown2 best precedent.
  fade_skin = s50 interior -> forehead-skin tone over the outer 8mm of the
              cap boundary (mesh-edge Dijkstra distance, cutoff 10mm).
  fade_mid  = s50 interior -> skin*0.38 (shadow brown) over the same band.
  Fade applies at every boundary except the centre seam (part slit):
  temples/sideburn+nape included (crown3 precedent).
No part strip in crown4 (crown3's strip poked above the silhouette).

After scoring, renders capgreen_front.png: cap as flat green emission, all
other R4-visible meshes flat black, liner hidden, hair visible (front view,
16 samples). Green = first-surface scalp with no hair over it; pairs with
front-id.png (hair silhouette) for the exposed-cap metric.

Run inside Blender:
  Blender --background --python score_crown4.py -- \
    --strands STRANDS.npz --params PARAMS.json --out OUT \
    --liner s50 --crown-top
"""
from __future__ import annotations

import argparse
import heapq
import importlib.util
import json
import sys
from pathlib import Path

import bpy
import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"

LINER_NAME = "OCLX_body_mesh_scalp_liner"
STRIP_NAME = "OCLX_body_mesh_part_strip"
LINER_ROUGHNESS = 0.72
S50 = (0.011, 0.0045, 0.0025)
SKIN = (0.879, 0.537, 0.348)  # forehead skin sRGB(0.945,0.758,0.623) -> linear
MID = tuple(c * 0.38 for c in SKIN)
STRIP_COLOR = (0.0143, 0.00585, 0.00325)  # s50x1.3, v3: int1-full rendered 0.32 vs target 0.245
FADE_MM = 8.0


def load_score():
    spec = importlib.util.spec_from_file_location("hair_crown3_score_v3", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strands", required=True)
    parser.add_argument("--params", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--liner", required=True,
                        choices=("s50", "fade_skin", "fade_mid"))
    parser.add_argument("--crown-top", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def boundary_verts(mesh):
    from collections import Counter
    ec = Counter()
    for poly in mesh.polygons:
        vs = list(poly.vertices)
        for a, b in zip(vs, vs[1:] + vs[:1]):
            ec[(min(a, b), max(a, b))] += 1
    bnd = {v for (a, b), c in ec.items() if c == 1 for v in (a, b)}
    return bnd


def fade_weights(mesh, bnd, width_m: float, cutoff_m: float):
    """Multi-source Dijkstra from boundary; returns per-vert 0..1 weights."""
    n = len(mesh.vertices)
    V = np.empty((n, 3))
    for i, v in enumerate(mesh.vertices):
        V[i] = v.co
    adj = [[] for _ in range(n)]
    for e in mesh.edges:
        a, b = e.vertices
        w = float(np.linalg.norm(V[a] - V[b]))
        adj[a].append((b, w))
        adj[b].append((a, w))
    INF = float("inf")
    dist = np.full(n, INF)
    src = np.full(n, -1)
    heap = []
    for b in bnd:
        dist[b] = 0.0
        src[b] = b
        heap.append((0.0, b))
    heapq.heapify(heap)
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u] or d > cutoff_m:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v] and nd <= cutoff_m:
                dist[v] = nd
                src[v] = src[u]
                heapq.heappush(heap, (nd, v))
    weights = np.zeros(n)
    inner = dist <= width_m
    sxy = V[src[inner]]
    # fade from every boundary except the centre seam (part slit):
    # temples/sideburn AND nape included; the nape sits outside all
    # measured ruler bands. v2 (front-only, src y<5mm) left temple liner
    # dark and new temple strands shadowed it -> 60px dark-band residue.
    ok = np.abs(sxy[:, 0]) > 0.003
    idx = np.flatnonzero(inner)
    # LINEAR ramp over the 8mm band: brighter convex curves narrowed the
    # measured 10-90% transition (90% crossing happens earlier on a bright
    # ramp); linear mid-ramp keeps the climb long (tw~10) while staying
    # bright enough that soft strand shadows survive above hairP50.
    weights[idx[ok]] = 1.0 - dist[idx[ok]] / width_m
    print("FADE verts_in_band", int(inner.sum()), "faded", int(ok.sum()),
          "cutoff_reached", int((dist <= cutoff_m).sum()), flush=True)
    return weights


def liner_material(name: str, dark, light, use_fade: bool):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = LINER_ROUGHNESS
    if use_fade:
        vcol = nodes.new("ShaderNodeVertexColor")
        vcol.layer_name = "fade_w"
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["A"].default_value = (*dark, 1.0)
        mix.inputs["B"].default_value = (*light, 1.0)
        links.new(vcol.outputs["Color"], mix.inputs["Factor"])
        links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*dark, 1.0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def build_liner(state, mode: str):
    source = state["cap"]
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = LINER_NAME
    bpy.context.collection.objects.link(obj)
    for vertex in obj.data.vertices:
        vertex.co += vertex.normal * 0.00002
    mesh = obj.data
    if mode == "s50":
        mat = liner_material("OCLX_liner_crown3_s50", S50, S50, False)
    else:
        light = SKIN if mode == "fade_skin" else MID
        w = fade_weights(mesh, boundary_verts(mesh), FADE_MM / 1000.0, 0.010)
        layer = mesh.color_attributes.new("fade_w", "FLOAT_COLOR", "POINT")
        for i, val in enumerate(w):
            layer.data[i].color = (float(val), float(val), float(val), 1.0)
        mat = liner_material(f"OCLX_liner_crown3_{mode}", S50, light, True)
    mesh.materials.clear()
    mesh.materials.append(mat)
    obj.hide_render = obj.hide_viewport = False
    return obj


def build_strip(state):
    from mathutils import Vector
    cap = state["cap"]
    deps = bpy.context.evaluated_depsgraph_get()
    bvh = None
    try:
        from mathutils.bvhtree import BVHTree
        bvh = BVHTree.FromObject(cap, deps)
    except Exception as err:
        print("STRIP no BVH", err, flush=True)
    ys = np.arange(-0.150, 0.041, 0.001)
    verts, faces = [], []
    for y in ys:
        row = []
        for x in (-0.0015, 0.0015):
            z = None
            if bvh is not None:
                hit = bvh.ray_cast(Vector((x, y, 1.8)), Vector((0, 0, -1)))
                if hit[0] is not None:
                    z = float(hit[0].z) + 0.00003
            if z is None:
                z = 1.70
            row.append(len(verts))
            verts.append((x, float(y), z))
        if len(verts) >= 4:
            a, b = row
            faces.append((a - 2, b - 2, b, a))
    mesh = bpy.data.meshes.new("OCLX_part_strip_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(STRIP_NAME, mesh)
    bpy.context.collection.objects.link(obj)
    mat = bpy.data.materials.new("OCLX_part_strip_mat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*STRIP_COLOR, 1.0)
    bsdf.inputs["Roughness"].default_value = LINER_ROUGHNESS
    mesh.materials.clear()
    mesh.materials.append(mat)
    print("STRIP verts", len(verts), "faces", len(faces), flush=True)
    return obj


def flat_emit(name: str, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emi = mat.node_tree.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (*color, 1.0)
    emi.inputs["Strength"].default_value = 1.0
    mat.node_tree.links.new(emi.outputs[0], out.inputs["Surface"])
    return mat


def render_capgreen(S, state, hair, liner, params, rig, out: Path, landmarks: dict) -> dict:
    """Front view with green cap + black occluders, liner hidden, hair on."""
    cap = state["cap"]
    green = flat_emit("OCLX_capgreen_crown4", (0.0, 1.0, 0.0))
    black = flat_emit("OCLX_capblack_crown4", (0.0, 0.0, 0.0))
    saved_cap = list(cap.data.materials)
    cap.data.materials.clear()
    cap.data.materials.append(green)
    saved_all: dict = {}
    for o in bpy.data.objects:
        if o.type == "MESH" and o is not cap and not o.hide_render:
            saved_all[o.name] = list(o.data.materials)
            o.data.materials.clear()
            o.data.materials.append(black)
    liner.hide_render = True
    cap.hide_render = cap.hide_viewport = False
    hair.hide_render = hair.hide_viewport = False
    try:
        S.canonical_camera(state, "front", landmarks)
        S.C.place_camera_relative(state, params, "front")
        if rig is not None:
            try:
                S.place_rig_all7(state, rig, "front")
            except Exception as err:
                print("CAPGREEN rig skipped", err, flush=True)
        scene = bpy.context.scene
        prev_samples = scene.cycles.samples
        scene.cycles.samples = 16
        scene.cycles.seed = 0
        scene.render.filepath = str(out / "capgreen_front.png")
        bpy.ops.render.render(write_still=True)
        scene.cycles.samples = prev_samples
    finally:
        cap.data.materials.clear()
        for m in saved_cap:
            cap.data.materials.append(m)
        for name, mats in saved_all.items():
            obj = bpy.data.objects.get(name)
            if obj is not None:
                obj.data.materials.clear()
                for m in mats:
                    obj.data.materials.append(m)
        liner.hide_render = False
    print("CAPGREEN_RENDERED front", flush=True)
    return {"artifact": "capgreen_front.png", "samples": 16, "view": "front",
            "liner": "hidden", "idPass": "n/a"}


def main():
    args = cli()
    S = load_score()
    orig_configure = S.configure_color

    def configure_color_tt(obj, params):
        readback = orig_configure(obj, params)
        node = S.find_hair_node(obj)
        sockets = {s.identifier: s for s in node.inputs}
        sockets["TT lobe"].default_value = float(params.get("lobe_T", 1.0))
        readback["TT lobe"] = float(sockets["TT lobe"].default_value)
        return readback

    S.configure_color = configure_color_tt
    strands, params_path, out = Path(args.strands), Path(args.params), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    params, params_selector, rig = S.read_params(params_path)
    data = S.strand_data(strands)
    landmarks = json.loads(S.LANDMARKS.read_text())
    state = S.R.ST.build_state()
    liner = build_liner(state, args.liner)
    hidden = [liner]
    hs_mod = state["hs"]
    orig_id = hs_mod._render_id

    def id_without_extras(handle, path, size):
        for o in hidden:
            o.hide_render = True
        try:
            return orig_id(handle, path, size)
        finally:
            for o in hidden:
                o.hide_render = False

    hs_mod._render_id = id_without_extras
    try:
        hair, material_mode, material_readback = S.build_hair_scored(
            state, data["points"], data["radii"], f"hair_crown4_{args.liner}", params)
        views = S.VIEWS + (("crown_top",) if args.crown_top else ())
        cameras, lights_per_view = {}, {}
        for view in views:
            cameras[view], lights_per_view[view] = S.render_view(
                state, hair, params, rig, out, view, landmarks)
        judge = S.run_judge(out, landmarks)
        scores = {
            "front": float(judge["iou"]),
            "profile": float(judge["profile_view"]["iou"]),
            "back": float(judge["back_view"]["iou"]),
        }
        honest_front = S.TOP_METRIC.front_part_side(out / "front.png", out / "front-id.png")
        if rig is not None:
            rig_record: dict = {"mode": "camera_relative_all7",
                                "source": "top-level 'rig' block of params file", "rig": rig}
        else:
            rig_record = {"mode": "stock"}
        document = {
            "schemaVersion": S.SCHEMA,
            "gitSha": S.git_sha(),
            "inputs": {
                "strands": S.input_record(strands),
                "materialRigParams": {**S.input_record(params_path), "selector": params_selector},
                "scorer": S.input_record(Path(__file__)),
                "scoreV3": S.input_record(SCORE),
                "landmarks": S.input_record(S.LANDMARKS),
                "judgeV6": S.input_record(S.JUDGE),
                "targets": {view: {"image": S.input_record(S.R.X.target_image(view)),
                                   "mask": S.input_record(S.R.X.target_mask(view))}
                            for view in S.VIEWS},
            },
            "render": {
                "resolutionPx": S.SIZE, "beautySamples": S.SAMPLES, "cyclesSeed": 0,
                "filterSize": 1.5,                 "idPass": "hair-scene._render_id sans liner; 16 samples; holdout meshes; transparent film",
                "idThreshold": "alpha>=230", "views": list(views),
                "cameraMode": "absolute landmarks rig; history-independent",
                "cameras": cameras,
            },
            "geometry": {"strandCount": int(len(data["points"])),
                         "pointsPerStrand": int(data["points"].shape[1]),
                         "npzMetadata": data["metadata"]},
            "scalpLiner": {"name": LINER_NAME, "mode": args.liner,
                           "fadeMm": FADE_MM if args.liner != "s50" else 0,
                           "fadeDistance": ("mesh-edge Dijkstra from cap boundary, "
                                            "all boundaries except centre seam "
                                            "(|x|>3mm); temples/sideburn+nape "
                                            "included"),
                           "dark": list(S50),
                           "light": list(SKIN if args.liner == "fade_skin"
                                         else MID if args.liner == "fade_mid" else S50),
                           "roughness": LINER_ROUGHNESS, "offsetUm": 20,
                           "idPass": "hidden during ID"},
            "partStrip": None,
            "material": {
                "mode": material_mode,
                "implementation": "score_crown4.py: score.py build_hair_scored + TT socket + cap liner(+fade); no strip",
                "nodeReadback": material_readback,
            },
            "lights": {"perViewReadback": lights_per_view, "rig": rig_record},
            "judgeV6": {"iou": scores, "landmarks": landmarks["judge"]},
            "photometrics": {view: S.photometrics(out, view) for view in S.VIEWS},
            "orientation": S.orientation_scores(out, landmarks),
            "bands": S.band_scores(out),
            "honestPartSide": {"front": honest_front},
            "artifacts": {view: {"beauty": f"{view}.png", "id": f"{view}-id.png",
                                 "idSha256": S.sha256(out / f"{view}-id.png")} for view in views},
        }
        if args.crown_top:
            document["honestPartSide"]["crownTop"] = S.crown_metrics(state, out)
        # ---- cap-green front render: green cap, black others, liner hidden ----
        capgreen = render_capgreen(S, state, hair, liner, params, rig, out, landmarks)
        document["capGreen"] = capgreen
        (out / "score.json").write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
        print("HAIR_SCORE", json.dumps(scores, sort_keys=True), flush=True)
    finally:
        hs_mod._render_id = orig_id
    print("HAIR_CROWN4", args.liner, flush=True)


if __name__ == "__main__":
    main()
