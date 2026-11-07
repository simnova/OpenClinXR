#!/usr/bin/env python3
"""hair-crown2 STEP 2 shade-generalized liner scorer.

score.py v3 + TT 0.5 (score_tt adapter semantics) + dark scalp liner at a
caller-chosen shade of the hair-int1 diffuse (0.022/0.009/0.005):
  --liner-shade {s50,s75,s100} -> 0.5x / 0.75x / 1.0x int1 diffuse, rough 0.72.
The liner is a copy of the cap surface (+20um) so it lives only on scalp
UNDER HAIR: the cap's front boundary is the anatomical hairline and it never
reaches face skin (verified: E/ruler/capmask_front.png has no white on the
face except a 50px poke-through sliver at rows 250-251, checked per render).

R4 note (crown1 precedent): named OCLX_body_mesh_scalp_liner; hidden during
the ID pass so ID stays hair-vs-scalp truth.

Run inside Blender:
  Blender --background --python score_liner2.py -- \
    --strands STRANDS.npz --params PARAMS.json --out OUT --liner-shade S75 --crown-top
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
LINER_ROUGHNESS = 0.72
INT1 = (0.022, 0.009, 0.005)
SHADES = {"s50": 0.5, "s75": 0.75, "s100": 1.0}


def load_score():
    spec = importlib.util.spec_from_file_location("hair_crown2_score_v3", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strands", required=True)
    parser.add_argument("--params", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--liner-shade", required=True, choices=sorted(SHADES))
    parser.add_argument("--crown-top", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def build_liner(state, color):
    source = state["cap"]
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = LINER_NAME
    bpy.context.collection.objects.link(obj)
    for vertex in obj.data.vertices:
        vertex.co += vertex.normal * 0.00002
    mat = bpy.data.materials.new("OCLX_dark_scalp_under_hair_crown2")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
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
    factor = SHADES[args.liner_shade]
    color = tuple(c * factor for c in INT1)
    strands, params_path, out = Path(args.strands), Path(args.params), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    params, params_selector, rig = S.read_params(params_path)
    data = S.strand_data(strands)
    landmarks = json.loads(S.LANDMARKS.read_text())
    state = S.R.ST.build_state()
    liner = build_liner(state, color)
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
            state, data["points"], data["radii"], f"hair_crown2_{args.liner_shade}", params)
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
                "filterSize": 1.5, "idPass": "hair-scene._render_id sans liner; 16 samples; holdout meshes; transparent film",
                "idThreshold": "alpha>=230", "views": list(views),
                "cameraMode": "absolute landmarks rig; history-independent",
                "cameras": cameras,
            },
            "geometry": {"strandCount": int(len(data["points"])),
                         "pointsPerStrand": int(data["points"].shape[1]),
                         "npzMetadata": data["metadata"]},
            "scalpLiner": {"name": LINER_NAME, "shade": args.liner_shade,
                           "factorVsInt1": factor, "int1Diffuse": list(INT1),
                           "color": list(color), "roughness": LINER_ROUGHNESS,
                           "offsetUm": 20, "precedent": "hair-int1 scalp_patch",
                           "restriction": ("cap copy: cap front boundary is the "
                                           "anatomical hairline; never reaches face skin"),
                           "idPass": "hidden during ID (hair-vs-scalp truth preserved)"},
            "material": {
                "mode": material_mode,
                "implementation": "score_liner2.py: score.py build_hair_scored + TT socket + cap liner",
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
        (out / "score.json").write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
        print("HAIR_SCORE", json.dumps(scores, sort_keys=True), flush=True)
    finally:
        hs_mod._render_id = orig_id
    print("HAIR_CROWN2_LINER", args.liner_shade, list(color), flush=True)


if __name__ == "__main__":
    main()
