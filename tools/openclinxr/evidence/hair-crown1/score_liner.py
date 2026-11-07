#!/usr/bin/env python3
"""hair-crown1 STEP 2 cell c_liner scorer: score.py v3 + TT 0.5 + dark scalp liner.

score.py is imported unmodified (sha recorded as scorer input). The liner is
the hair-int1 scalp_patch precedent: a copy of the cap surface lifted +20um
along its normals with a dark diffuse brown material, so scalp glimpsed
between part/crown roots reads near hair colour (production practice).

R4 note: score.py visible() raises on unclassifiable visible MESH objects, so
the liner is named OCLX_body_mesh_scalp_liner (contains the BODY_SUB
'body_mesh'); it is hidden during the ID pass exactly like int1, so ID masks
stay hair-vs-scalp truth.

Run inside Blender:
  Blender --background --python score_liner.py -- \
    --strands STRANDS.npz --params PARAMS.json --out OUT --crown-top
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"

LINER_NAME = "OCLX_body_mesh_scalp_liner"
LINER_COLOR = (0.022, 0.009, 0.005, 1.0)  # int1 OCLX_dark_scalp_under_hair
LINER_ROUGHNESS = 0.72


def load_score():
    spec = importlib.util.spec_from_file_location("hair_crown1_score_v3", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strands", required=True)
    parser.add_argument("--params", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--crown-top", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def build_liner(state):
    source = state["cap"]
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = LINER_NAME
    bpy.context.collection.objects.link(obj)
    for vertex in obj.data.vertices:
        vertex.co += vertex.normal * 0.00002
    mat = bpy.data.materials.new("OCLX_dark_scalp_under_hair_crown1")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = LINER_COLOR
    bsdf.inputs["Roughness"].default_value = LINER_ROUGHNESS
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.hide_render = obj.hide_viewport = False
    return obj


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
    liner = build_liner(state)
    # Hide the liner during the ID pass only (int1 precedent); beauty keeps it.
    hs_mod = state["hs"]
    orig_id = hs_mod._render_id

    def id_without_liner(handle, path, size):
        liner.hide_render = True
        try:
            return orig_id(handle, path, size)
        finally:
            liner.hide_render = False

    hs_mod._render_id = id_without_liner
    try:
        hair, material_mode, material_readback = S.build_hair_scored(
            state, data["points"], data["radii"], "hair_crown1_liner", params)
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
        material_record = {
            "mode": material_mode,
            "implementation": "score_liner.py: score.py build_hair_scored + TT socket + cap liner",
            "nodeReadback": material_readback,
            "paramsSide": {k: params[k] for k in
                           ("melanin", "redness", "lobe_R", "lobe_T", "lobe_SR", "random",
                            "root_dark", "model", "directColorLinear", "reflection",
                            "secondaryReflection", "roughness", "colorScale", "hueShiftDeg")
                           if k in params},
        }
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
                "filterSize": 1.5, "idPass": "hair-scene._render_id sans liner; 16 samples; holdout meshes; transparent film",
                "idThreshold": "alpha>=230", "views": list(views),
                "cameraMode": "absolute landmarks rig; history-independent",
                "cameras": cameras,
            },
            "geometry": {"strandCount": int(len(data["points"])),
                         "pointsPerStrand": int(data["points"].shape[1]),
                         "npzMetadata": data["metadata"]},
            "scalpLiner": {"name": LINER_NAME, "r4Pass": "name contains BODY_SUB 'body_mesh'",
                           "color": list(LINER_COLOR), "roughness": LINER_ROUGHNESS,
                           "offsetUm": 20, "precedent": "hair-int1 scalp_patch",
                           "idPass": "hidden during ID (hair-vs-scalp truth preserved)"},
            "material": material_record,
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
        (out / "score.json").write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
        print("HAIR_SCORE", json.dumps(scores, sort_keys=True), flush=True)
    finally:
        hs_mod._render_id = orig_id
    print("HAIR_CROWN1_LINER", LINER_NAME, flush=True)


if __name__ == "__main__":
    main()
