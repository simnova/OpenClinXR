#!/usr/bin/env python3
"""Canonical, history-independent scorer for OpenClinXR strand hair cards.

Run inside Blender:
  Blender --background --python score.py -- \
    --strands STRANDS.npz --params MATERIAL_RIG.json --out OUT [--crown-top]

The scorer deliberately pins camera transforms rather than calling the legacy
stateful view setter.  It renders beauty at 1024 px / 64 samples, renders the
shared hair-only ID pass, runs judge v6 with hair-curtain3 landmarks, and writes
OUT/score.json.  PARAMS may be a direct object or a metrics document containing
a top-level ``params`` object.
"""
from __future__ import annotations

import argparse
import colorsys
import hashlib
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from PIL import Image

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
I1 = ROOT / "tools/openclinxr/evidence/hair-int1"
L2 = ROOT / "tools/openclinxr/evidence/hair-look2"
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
TOP = ROOT / "tools/openclinxr/evidence/hair-top1"
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/hair_judge.py")
JUDGE_ROOT = JUDGE.parent
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TARGET_MASKS = JUDGE_ROOT / "target-set-back"
VIEWS = ("front", "three_quarter", "profile_90", "back")
SIZE = 1024
SAMPLES = 64
SCHEMA = "openclinxr.hair-score.v3"

# Every params key the scorer knows how to interpret.  Anything else fails
# loudly (the look7 COLOR defect: direct-colour keys silently ignored while
# the older melanin material rendered).  Keys are grouped by consumer so the
# error can say who would have read them.
MATERIAL_MELANIN_KEYS = frozenset({
    "melanin", "redness", "roughness", "random", "root_dark",
    "lobe_R", "lobe_T", "lobe_SR", "model",
})
MATERIAL_COLOR_KEYS = frozenset({
    "directColorLinear", "reflection", "secondaryReflection", "roughness",
})
# Derivation provenance for directColorLinear; verified not to touch the
# render (look7/run.py color() bakes them into directColorLinear before the
# render).  Known, recorded, and explicitly NOT renderer inputs.
PROVENANCE_ONLY_KEYS = frozenset({"colorScale", "hueShiftDeg"})
# Stock rig path consumers: ST.lights() reads key_elev_deg/key_energy/
# key_size_m/fill_elev_deg/fill_W; cell_rel.place_camera_relative() reads
# key_energy/fill_W.  OCLX_rim is HARDCODED to SEARCH_BASE["rim_W"] by
# hair-look1/station.py lights() and no stock call path touches it.
RIG_STOCK_KEYS = frozenset({
    "key_energy", "key_elev_deg", "key_azimuth_delta_deg", "key_size_m",
    "fill_W", "fill_elev_deg", "rim_W",
})
# Merged-in rig1 namings: honoured only through a top-level "rig" block
# (camera-relative all-7 placement); without one they are known-but-shadowed.
RIG_ALIAS_KEYS = frozenset({"key_daz_deg", "fill_energy", "rim_energy"})
KNOWN_PARAM_KEYS = (MATERIAL_MELANIN_KEYS | MATERIAL_COLOR_KEYS
                    | PROVENANCE_ONLY_KEYS | RIG_STOCK_KEYS | RIG_ALIAS_KEYS)
RIG_BLOCK_KEYS = frozenset({
    "key_energy", "key_elev_deg", "key_daz_deg", "key_size_m",
    "fill_energy", "fill_elev_deg", "rim_energy",
})
SEARCH2 = ROOT / "tools/openclinxr/evidence/hair-search2/best.json"
# Camera-relative rig geometry (hair-look2/cell_rel.py KEY/FILL/CAM_AZ).
CAM_AZ = {"front": -90.0, "three_quarter": -45.0, "profile_90": 0.0, "back": 90.0}
KEY_R = 1.9209
FILL_R = 1.8028
FILL_DAZ = 56.31

sys.path[:0] = [str(I1), str(L2), str(K1)]
import run_blender as R  # noqa: E402
import cell_rel as C  # noqa: E402

sys.path[:0] = [str(E)]
import orientation as O  # noqa: E402
import bands as B  # noqa: E402


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


J = load_module("hair_score_judge_v6", JUDGE)
TOP_METRIC = load_module("hair_score_top_metric", TOP / "metric.py")


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strands", required=True)
    parser.add_argument("--params", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--crown-top", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def input_record(path: Path) -> dict:
    resolved = path.resolve(strict=True)
    return {"path": str(resolved), "sha256": sha256(resolved)}


def git_sha() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()


def read_params(path: Path) -> tuple[dict, str, dict | None]:
    document = json.loads(path.read_text())
    if isinstance(document, dict) and isinstance(document.get("params"), dict):
        params, selector = dict(document["params"]), "$.params"
        rig = document.get("rig")
    elif isinstance(document, dict):
        params, selector, rig = dict(document), "$", document.get("rig")
        if rig is not None and not isinstance(rig, dict):
            raise ValueError("top-level 'rig' block must be an object")
        # A bare params object has no sibling rig block; $.params docs may.
        if selector == "$":
            rig = None
    else:
        raise ValueError("material/rig params JSON must contain an object")
    unknown = sorted(set(params) - KNOWN_PARAM_KEYS)
    if unknown:
        raise ValueError(
            "params file %s selector %s contains keys the scorer does not consume: %s. "
            "Known material-melanin=%s material-COLOR=%s provenance-only=%s rig-stock=%s rig-alias=%s. "
            "Refusing to render rather than silently ignoring them." % (
                path, selector, unknown, sorted(MATERIAL_MELANIN_KEYS),
                sorted(MATERIAL_COLOR_KEYS), sorted(PROVENANCE_ONLY_KEYS),
                sorted(RIG_STOCK_KEYS), sorted(RIG_ALIAS_KEYS)))
    if rig is not None:
        unknown_rig = sorted(set(rig) - RIG_BLOCK_KEYS)
        if unknown_rig:
            raise ValueError(
                "params file %s 'rig' block contains keys the scorer does not consume: %s. "
                "Known rig-block=%s. Refusing to render." % (
                    path, unknown_rig, sorted(RIG_BLOCK_KEYS)))
        rig = dict(rig)
    return params, selector, rig


def strand_data(path: Path) -> dict:
    with np.load(path) as data:
        if "points" not in data.files or "radii" not in data.files:
            raise ValueError("strands NPZ requires points and radii arrays")
        points = np.asarray(data["points"], dtype=float)
        radii = np.asarray(data["radii"], dtype=np.float32)
        metadata = {
            key: np.asarray(data[key]).tolist()
            for key in data.files
            if key not in {"points", "radii", "roots"} and np.asarray(data[key]).size <= 16
        }
    if points.ndim != 3 or points.shape[2] != 3 or radii.shape != points.shape[:2]:
        raise ValueError(f"invalid strands shapes points={points.shape} radii={radii.shape}")
    return {"points": points, "radii": radii, "metadata": metadata}


def find_hair_node(obj):
    for material in obj.data.materials:
        for cand in material.node_tree.nodes:
            if cand.bl_idname == "ShaderNodeBsdfHairPrincipled":
                return cand
    raise RuntimeError("Principled Hair BSDF not found")


def configure_color(obj, params) -> dict:
    """look7 COLOR material; semantics from hair-look7/run.py + rig1 adapter."""
    node = find_hair_node(obj)
    sockets = {socket.identifier: socket for socket in node.inputs}
    node.parametrization = "COLOR"
    sockets["Color"].default_value = (*params["directColorLinear"], 1.0)
    sockets["R lobe"].default_value = float(params["reflection"])
    sockets["TRT lobe"].default_value = float(params["secondaryReflection"])
    sockets["Roughness"].default_value = float(params["roughness"])
    return read_material(node)


def read_material(node) -> dict:
    """Read back the material actually built (node truth, not params)."""
    sockets = {socket.identifier: socket for socket in node.inputs}
    record = {
        "model": str(node.model),
        "parametrization": str(node.parametrization),
        "Roughness": float(sockets["Roughness"].default_value),
        "R lobe": float(sockets["R lobe"].default_value),
        "TRT lobe": float(sockets["TRT lobe"].default_value),
    }
    if str(node.parametrization) == "COLOR":
        record["Color"] = [float(x) for x in sockets["Color"].default_value]
    else:
        try:
            record["MelaninRedness"] = float(sockets["Melanin Redness"].default_value)
        except KeyError:
            pass
        # Melanin value rides the Intercept->ramp link, not a socket; the
        # params-side value is recorded by the caller alongside this node truth.
    return record


def build_hair_scored(state, points, radii, name, params) -> tuple:
    """One material implementation: melanin stock, COLOR when direct keys present."""
    obj = R.build_hair(state, points, radii, name, params)
    node = find_hair_node(obj)
    if "directColorLinear" in params:
        for key in ("reflection", "secondaryReflection", "roughness"):
            if key not in params:
                raise ValueError(
                    "COLOR material requires '%s' alongside directColorLinear" % key)
        readback = configure_color(obj, params)
        mode = "COLOR"
    else:
        readback = read_material(node)
        mode = "MELANIN"
    return obj, mode, readback


def place_rig_all7(state, rig: dict, view: str) -> dict:
    """Camera-relative placement for all three lights (rig1 semantics).

    Key/fill ride the view camera azimuth at fixed radii; every energy/size
    comes from the rig dict so params rim verifiably reaches OCLX_rim (the
    stock path hardcodes it; see RIG_STOCK_KEYS note).
    """
    target = Vector(state["handle"].target)
    az = math.radians(CAM_AZ[view])
    readback = {}
    for light in state["handle"].lights:
        if light.name == "OCLX_key":
            r = KEY_R
            a = az + math.radians(rig["key_daz_deg"])
            z = target.z + r * math.tan(math.radians(rig["key_elev_deg"]))
            light.location = (target.x + r * math.cos(a),
                              target.y + r * math.sin(a), z)
            light.data.energy = float(rig["key_energy"])
            light.data.size = float(rig["key_size_m"])
        elif light.name == "OCLX_fill":
            r = FILL_R
            a = az + math.radians(FILL_DAZ)
            z = target.z + r * math.tan(math.radians(rig["fill_elev_deg"]))
            light.location = (target.x + r * math.cos(a),
                              target.y + r * math.sin(a), z)
            light.data.energy = float(rig["fill_energy"])
        elif light.name == "OCLX_rim":
            light.data.energy = float(rig["rim_energy"])
        else:
            continue
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
        readback[light.name] = {
            "energy": float(light.data.energy),
            "size": float(light.data.size),
            "location": [float(v) for v in light.location],
        }
    return readback


def read_lights(state) -> dict:
    record = {}
    for light in state["handle"].lights:
        if light.name in ("OCLX_key", "OCLX_fill", "OCLX_rim"):
            record[light.name] = {
                "energy": float(light.data.energy),
                "size": float(light.data.size),
                "location": [float(v) for v in light.location],
            }
    return record


def station_hardcoded_rim() -> float:
    return float(json.loads(SEARCH2.read_text())["params"]["rim_W"])


def visible(state, hair):
    for obj in bpy.data.objects:
        if obj.type == "CURVES":
            obj.hide_render = obj.hide_viewport = obj != hair
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    hair.hide_render = hair.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], hair)


def track(camera, target):
    camera.rotation_euler = (Vector(tuple(target)) - camera.location).to_track_quat("-Z", "Y").to_euler()


def canonical_camera(state, view: str, landmarks: dict):
    """Set an absolute camera transform; never inherit the preceding view."""
    camera, target = state["handle"].camera, state["handle"].target
    recorded = landmarks.get("views", {}).get(view)
    if recorded:
        camera.location = Vector(tuple(recorded["camera_location"]))
        camera.data.lens = float(recorded["camera_lens_mm"])
    else:
        # Three-quarter and crown were not recorded in landmarks.json.  Both
        # use the same 0.7 m rig radius as the recorded front camera.
        front = landmarks["views"]["front"]["camera_location"]
        radius = abs(float(front[1]) - float(target.y))
        if view == "three_quarter":
            angle = math.radians(45.0)
            camera.location = target + Vector((radius * math.sin(angle), -radius * math.cos(angle), 0.03))
        elif view == "crown_top":
            camera.location = target + Vector((0.0, -0.10, radius))
        else:
            raise ValueError(view)
        camera.data.lens = float(landmarks["views"]["front"]["camera_lens_mm"])
    track(camera, target)
    bpy.context.view_layer.update()
    return {
        "location": [float(value) for value in camera.location],
        "lensMm": float(camera.data.lens),
        "matrixWorld": [[float(value) for value in row] for row in camera.matrix_world],
    }


def render_view(state, hair, params, rig, out: Path, view: str, landmarks: dict):
    visible(state, hair)
    camera = canonical_camera(state, view, landmarks)
    R.ST.lights(state, params)
    if view in VIEWS:
        C.place_camera_relative(state, params, view)
    if rig is not None and view in VIEWS:
        place_rig_all7(state, rig, view)
    lights = read_lights(state)
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filter_size = 1.5
    scene.render.film_transparent = False
    scene.render.filepath = str(out / f"{view}.png")
    old = state["handle"].hair
    state["handle"].hair = hair
    try:
        bpy.ops.render.render(write_still=True)
        state["hs"]._render_id(state["handle"], out / f"{view}-id.png", SIZE)
    finally:
        state["handle"].hair = old
    print("HAIR_SCORE_RENDERED", view, flush=True)
    return camera, lights


def triple(row: dict, keys: tuple[str, str, str]) -> str:
    return ",".join(str(row[key]) for key in keys)


def run_judge(out: Path, landmarks: dict) -> dict:
    lm = landmarks["judge"]
    judge_out = out / "judge"
    judge_out.mkdir(exist_ok=True)
    return J.judge(
        str(out / "front.png"), str(out / "front-id.png"), out.name,
        triple(lm["front"], ("crown_top_row", "chin_row", "face_centre_col")),
        str(judge_out), target_set="back", id_mask_path=str(out / "front-id.png"),
        profile_mask_path=str(out / "profile_90-id.png"),
        profile_landmarks=triple(lm["profile"], ("crown_top_row", "chin_row", "forehead_front_col")),
        back_mask_path=str(out / "back-id.png"),
        back_landmarks=triple(lm["back"], ("crown_top_row", "shoulder_row", "hair_centre_col")),
        target_front_mask=str(TARGET_MASKS / "mask-front-v2.png"),
        target_profile_mask=str(TARGET_MASKS / "mask-profile-v2.png"),
        target_back_mask=str(TARGET_MASKS / "mask-back-v3.png"), overlay_prefix="overlay-",
    )


def rgb(path: Path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=float) / 255.0


def alpha(path: Path):
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)[..., 3]


def luminance(image):
    return .2126 * image[..., 0] + .7152 * image[..., 1] + .0722 * image[..., 2]


def hue_sat(image, mask):
    values = luminance(image)[mask]
    bright = mask & (luminance(image) >= np.percentile(values, 90))
    hsv = np.asarray([colorsys.rgb_to_hsv(*pixel) for pixel in image[bright]])
    weights = np.maximum(hsv[:, 1], .02)
    angle = hsv[:, 0] * 2.0 * math.pi
    hue = math.degrees(math.atan2(np.sum(np.sin(angle) * weights), np.sum(np.cos(angle) * weights))) % 360.0
    return {"hueDeg": float(hue), "saturation": float(np.median(hsv[:, 1])), "pixels": int(len(hsv))}


def photometrics(out: Path, view: str) -> dict:
    image = rgb(out / f"{view}.png")
    mask = alpha(out / f"{view}-id.png") >= 230
    values = luminance(image)[mask]
    target = R.X.target_photometrics(view)
    highlight = hue_sat(image, mask)
    return {
        "p50": float(np.percentile(values, 50)),
        "p90": float(np.percentile(values, 90)),
        "hueDeg": highlight["hueDeg"],
        "saturation": highlight["saturation"],
        "maskPx": int(mask.sum()),
        "target": {
            "p50": float(target["p50"]), "p90": float(target["p90"]),
            "hueDeg": float(target["highlight"]["hueDeg"]),
            "saturation": float(target["highlight"]["saturation"]),
        },
        "deltaVsTarget": {
            "p50": float(np.percentile(values, 50) - target["p50"]),
            "p90": float(np.percentile(values, 90) - target["p90"]),
            "hueDeg": float(highlight["hueDeg"] - target["highlight"]["hueDeg"]),
            "saturation": float(highlight["saturation"] - target["highlight"]["saturation"]),
        },
    }


def crown_metrics(state, out: Path) -> dict:
    frame = TOP_METRIC.crown_frame(state)
    a = alpha(out / "crown_top-id.png")
    image_y = luminance(rgb(out / "crown_top.png"))
    tiles = {}
    for label, lo, hi in (("0-10", 3.0, 10.0), ("10-20", 10.0, 20.0), ("20-30", 20.0, 30.0), ("30-50", 30.0, 50.0)):
        region = frame["strip"](lo, hi)
        count = max(int(region.sum()), 1)
        tiles[label] = {
            "pixels": int(region.sum()),
            "bareFractionAlphaLt30": float((region & (a < 30)).sum() / count),
            "partialFractionAlpha30To229": float((region & (a >= 30) & (a < 230)).sum() / count),
            "coveredFractionAlphaGe230": float((region & (a >= 230)).sum() / count),
        }
    part, sides = frame["strip"](0.0, 3.0), frame["strip"](7.0, 24.0)
    return {
        "definition": "hair-top1 physical crown strips; BARE alpha<30, PARTIAL 30<=alpha<230, covered alpha>=230",
        "tiles": tiles,
        "partSide": float(image_y[part].mean() / max(image_y[sides].mean(), 1e-12)),
    }


def render_triples(landmarks: dict) -> dict:
    """Render (a,b,c) triples from hair-curtain3/landmarks.json (judge input)."""
    lm = landmarks["judge"]
    return {
        "front": (float(lm["front"]["crown_top_row"]),
                  float(lm["front"]["chin_row"]),
                  float(lm["front"]["face_centre_col"])),
        "three_quarter": None,
        "profile_90": (float(lm["profile"]["crown_top_row"]),
                       float(lm["profile"]["chin_row"]),
                       float(lm["profile"]["forehead_front_col"])),
        "back": (float(lm["back"]["crown_top_row"]),
                 float(lm["back"]["shoulder_row"]),
                 float(lm["back"]["hair_centre_col"])),
    }


def orientation_scores(out: Path, landmarks: dict) -> dict:
    """Per-view strand-direction scores (Gabor orientation vs target)."""
    rtriples, ttriples = render_triples(landmarks), O.target_triples()
    result = {}
    for view in VIEWS:
        render_beauty = rgb(out / f"{view}.png")
        render_mask = alpha(out / f"{view}-id.png") >= 230
        target_beauty, target_mask = O.load_beauty_mask(
            R.X.target_image(view), R.X.target_mask(view))
        result[view] = O.score_view(
            render_beauty, render_mask, target_beauty, target_mask, view,
            register_fn=J.register_view,
            render_triple=rtriples[view], target_triple=ttriples[view])
    return result


def band_scores(out: Path) -> dict:
    """Lit highlight-band counts, ours vs target, per crop."""
    result = {}
    for crop, view in (("back", "back"), ("ear", "three_quarter")):
        ours = B.score_beauty(rgb(out / f"{view}.png"),
                              alpha(out / f"{view}-id.png") >= 230)[crop]
        tgt = B.score_beauty(*B.load_beauty_mask(
            R.X.target_image(view), R.X.target_mask(view)))[crop]
        result[crop] = {"ours": ours, "target": tgt, "view": view,
                        "box": list(B.BACK_BOX if crop == "back" else B.EAR_BOX)}
    return result


def main():
    args = cli()
    strands, params_path, out = Path(args.strands), Path(args.params), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    params, params_selector, rig = read_params(params_path)
    data = strand_data(strands)
    landmarks = json.loads(LANDMARKS.read_text())
    state = R.ST.build_state()
    hair, material_mode, material_readback = build_hair_scored(
        state, data["points"], data["radii"], "hair_score_candidate", params)
    views = VIEWS + (("crown_top",) if args.crown_top else ())
    cameras, lights_per_view = {}, {}
    for view in views:
        cameras[view], lights_per_view[view] = render_view(
            state, hair, params, rig, out, view, landmarks)
    judge = run_judge(out, landmarks)
    scores = {
        "front": float(judge["iou"]),
        "profile": float(judge["profile_view"]["iou"]),
        "back": float(judge["back_view"]["iou"]),
    }
    honest_front = TOP_METRIC.front_part_side(out / "front.png", out / "front-id.png")
    if rig is not None:
        rig_record: dict = {
            "mode": "camera_relative_all7",
            "source": "top-level 'rig' block of params file",
            "rig": rig,
        }
    else:
        hardcoded = station_hardcoded_rim()
        rig_record = {
            "mode": "stock",
            "source": "hair-look1/station.py lights(): OCLX_rim energy = SEARCH_BASE[rim_W]; "
                      "stock cell_rel path never touches the rim",
            "stationHardcodedRim_W": hardcoded,
            "paramsRim_W_ignored": params.get("rim_W"),
            "note": "OCLX_rim keeps the hardcoded value on every view; "
                    "only a top-level 'rig' block delivers it",
        }
    material_record = {
        "mode": material_mode,
        "implementation": "score.py build_hair_scored (COLOR semantics from hair-look7/run.py)",
        "nodeReadback": material_readback,
        "paramsSide": {
            key: params[key] for key in
            ("melanin", "redness", "lobe_R", "lobe_T", "lobe_SR", "random",
             "root_dark", "model", "directColorLinear", "reflection",
             "secondaryReflection", "roughness", "colorScale", "hueShiftDeg")
            if key in params
        },
    }
    document = {
        "schemaVersion": SCHEMA,
        "gitSha": git_sha(),
        "inputs": {
            "strands": input_record(strands),
            "materialRigParams": {**input_record(params_path), "selector": params_selector},
            "scorer": input_record(Path(__file__)),
            "landmarks": input_record(LANDMARKS),
            "judgeV6": input_record(JUDGE),
            "targets": {
                view: {
                    "image": input_record(R.X.target_image(view)),
                    "mask": input_record(R.X.target_mask(view)),
                }
                for view in VIEWS
            },
        },
        "render": {
            "resolutionPx": SIZE, "beautySamples": SAMPLES, "cyclesSeed": 0,
            "filterSize": 1.5, "idPass": "hair-scene._render_id; 16 samples; holdout meshes; transparent film",
            "idThreshold": "alpha>=230", "views": list(views), "cameraMode": "absolute landmarks rig; history-independent",
            "cameras": cameras,
        },
        "geometry": {"strandCount": int(len(data["points"])), "pointsPerStrand": int(data["points"].shape[1]), "npzMetadata": data["metadata"]},
        "material": material_record,
        "lights": {"perViewReadback": lights_per_view, "rig": rig_record},
        "paramsStrict": {
            "selector": params_selector,
            "knownParamKeys": sorted(KNOWN_PARAM_KEYS),
            "rigBlockKeys": sorted(RIG_BLOCK_KEYS),
            "provenanceOnlyIgnored": sorted(set(params) & PROVENANCE_ONLY_KEYS),
            "shadowedWithoutRigBlock": sorted(set(params) & RIG_ALIAS_KEYS),
        },
        "judgeV6": {"iou": scores, "landmarks": landmarks["judge"]},
        "photometrics": {view: photometrics(out, view) for view in VIEWS},
        "orientation": orientation_scores(out, landmarks),
        "bands": band_scores(out),
        "honestPartSide": {"front": honest_front},
        "artifacts": {view: {"beauty": f"{view}.png", "id": f"{view}-id.png", "idSha256": sha256(out / f"{view}-id.png")} for view in views},
    }
    if args.crown_top:
        document["honestPartSide"]["crownTop"] = crown_metrics(state, out)
    (out / "score.json").write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print("HAIR_SCORE", json.dumps(scores, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
