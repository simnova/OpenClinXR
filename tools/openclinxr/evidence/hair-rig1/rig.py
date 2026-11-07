#!/usr/bin/env python3
"""Hair rig 1: camera-relative light re-solve on b9 (s5 strands + look7 COLOR).

b9 = hair-tilt5/cells/s5/strands.npz + hair-look7/best-params.json COLOR
material.  All renders go through hair-score/score.py (THE scorer v2).

  --step1  score b9 via score.py + look7 COLOR adapter -> E/base/score.json
           (rim intentionally left on the stock path, as in look7/best)
  --step2  CMA-ES over the 7 camera-relative rig dims, material frozen to
           look7 COLOR, 24 evals at 512 px / 32 samples -> E/search.jsonl
           + E/search_best.json + E/rim_check.json
  --step3  best rig at 1024 px / 64 samples via score.py + COLOR adapter +
           rig adapter (delivers all 7 rig dims incl. rim) -> E/best/score.json

Run inside Blender:
  Blender --background --python rig.py -- --step1|--step2|--step3
"""
from __future__ import annotations

import argparse
import colorsys
import importlib.util
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
S5 = ROOT / "tools/openclinxr/evidence/hair-tilt5/cells/s5/strands.npz"
L7PARAMS = ROOT / "tools/openclinxr/evidence/hair-look7/best-params.json"
SEARCH2 = ROOT / "tools/openclinxr/evidence/hair-search2/best.json"
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"
INT1 = ROOT / "tools/openclinxr/evidence/hair-int1"
LOOK2 = ROOT / "tools/openclinxr/evidence/hair-look2"
LOOK1 = ROOT / "tools/openclinxr/evidence/hair-look1"
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"

VIEWS = ("front", "three_quarter", "profile_90", "back")

sys.path[:0] = [str(INT1), str(LOOK2), str(LOOK1)]
import run_blender as R  # noqa: E402

# Camera-relative rig geometry, measured from the b7/g6 rig relative to the
# front camera (azimuth -90 deg in XY); see hair-look2/cell_rel.py.
CAM_AZ = {"front": -90.0, "three_quarter": -45.0, "profile_90": 0.0, "back": 90.0}
KEY_R = 1.9209
FILL_R = 1.8028
FILL_DAZ = 56.31

RIG_KEYS = ("key_energy", "key_elev_deg", "key_daz_deg", "key_size_m",
            "fill_energy", "fill_elev_deg", "rim_energy")
BOUNDS = np.asarray((
    (60.0, 260.0),   # key_energy
    (25.0, 65.0),    # key_elev_deg
    (-60.0, -15.0),  # key_daz_deg (camera-relative azimuth offset)
    (0.5, 3.0),      # key_size_m
    (15.0, 120.0),   # fill_energy (fill_W)
    (5.0, 45.0),     # fill_elev_deg
    (0.0, 60.0),     # rim_energy (rim_W)
), float)

TS = {view: R.X.target_photometrics(view) for view in VIEWS}


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--step1", action="store_true")
    parser.add_argument("--step2", action="store_true")
    parser.add_argument("--step3", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)
    if sum((args.step1, args.step2, args.step3)) != 1:
        parser.error("select exactly one step")
    return args


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def look7_params():
    return dict(json.load(open(L7PARAMS))["params"])


# ---------------------------------------------------------------- material

def configure_color(obj, params):
    """look7 COLOR material; copied semantics from hair-look7/run.py."""
    node = None
    for material in obj.data.materials:
        for cand in material.node_tree.nodes:
            if cand.bl_idname == "ShaderNodeBsdfHairPrincipled":
                node = cand
    if node is None:
        raise RuntimeError("Principled Hair BSDF not found")
    sockets = {socket.identifier: socket for socket in node.inputs}
    node.parametrization = "COLOR"
    sockets["Color"].default_value = (*params["directColorLinear"], 1.0)
    sockets["R lobe"].default_value = float(params["reflection"])
    sockets["TRT lobe"].default_value = float(params["secondaryReflection"])
    sockets["Roughness"].default_value = float(params["roughness"])
    return {
        "parametrization": node.parametrization,
        "Color": [float(x) for x in sockets["Color"].default_value],
        "Reflection": float(sockets["R lobe"].default_value),
        "Secondary Reflection": float(sockets["TRT lobe"].default_value),
        "Roughness": float(sockets["Roughness"].default_value),
    }


def wrap_color(scorer):
    original = scorer.R.build_hair

    def build_color(state, points, radii, name, params):
        obj = original(state, points, radii, name, params)
        configure_color(obj, params)
        return obj

    scorer.R.build_hair = build_color
    return original


# ---------------------------------------------------------------- rig

def rig_from_params(params):
    return {
        "key_energy": float(params["key_energy"]),
        "key_elev_deg": float(params["key_elev_deg"]),
        "key_daz_deg": float(params.get("key_daz_deg", -38.66)),
        "key_size_m": float(params["key_size_m"]),
        "fill_energy": float(params["fill_W"]),
        "fill_elev_deg": float(params["fill_elev_deg"]),
        "rim_energy": float(params["rim_W"]),
    }


def place_rig(state, rig, view):
    """Camera-relative placement for all three lights.

    Key/fill ride the view camera azimuth at fixed radii; rim stays at its
    authored fixed position.  Every energy/size comes from the rig dict, so
    params["rim_W"] verifiably reaches OCLX_rim (station.py lights()
    hardcodes it to SEARCH_BASE["rim_W"]; the stock cell_rel path never
    touches the rim at all).
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


def wrap_rig(scorer):
    """Deliver all 7 rig dims through score.py's render path (rim included)."""
    def place(state, params, view):
        return place_rig(state, rig_from_params(params), view)

    scorer.C.place_camera_relative = place


def stock_rim_probe():
    """Prove the stock path ignores params rim_W (the rim check).

    Runs ST.lights + stock place_camera_relative with a sentinel rim value
    and reads back what actually sits on OCLX_rim.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    state = R.ST.build_state()
    sentinel = dict(look7_params())
    sentinel["rim_W"] = 1234.5
    R.ST.lights(state, sentinel)
    import cell_rel as C  # noqa: E402
    for view in ("front", "back"):
        state["c3"].set_final_view(state["handle"], view)
        C.place_camera_relative(state, sentinel, view)
        for light in state["handle"].lights:
            if light.name == "OCLX_rim":
                sentinel[f"rimReadback_{view}"] = float(light.data.energy)
    hardcoded = float(json.load(open(SEARCH2))["params"]["rim_W"])
    return {
        "stationHardcodeSource": "hair-look1/station.py lights(): OCLX_rim energy = SEARCH_BASE[rim_W]",
        "stationHardcodedRim_W": hardcoded,
        "sentinelParamsRim_W": 1234.5,
        "rimReadback_front": sentinel["rimReadback_front"],
        "rimReadback_back": sentinel["rimReadback_back"],
        "reachesLight": bool(sentinel["rimReadback_front"] == hardcoded
                             and sentinel["rimReadback_back"] == hardcoded),
        "conclusion": ("STOCK PATH IGNORES params rim_W: OCLX_rim keeps the hardcoded "
                       "value on every view; only an explicit set delivers it."),
    }


# ---------------------------------------------------------------- metrics

def rgb(path):
    from PIL import Image as _Image
    return np.asarray(_Image.open(str(path)).convert("RGB"), float) / 255.0


def alpha(path):
    from PIL import Image as _Image
    return np.asarray(_Image.open(str(path)).convert("RGBA"), np.uint8)[..., 3]


def lum(image):
    return .2126 * image[..., 0] + .7152 * image[..., 1] + .0722 * image[..., 2]


def hue_sat(image, mask):
    values = lum(image)[mask]
    bright = mask & (lum(image) >= np.percentile(values, 90))
    hsv = np.asarray([colorsys.rgb_to_hsv(*pixel) for pixel in image[bright]])
    weights = np.maximum(hsv[:, 1], .02)
    angle = hsv[:, 0] * 2 * math.pi
    hue = math.degrees(math.atan2(np.sum(np.sin(angle) * weights),
                                  np.sum(np.cos(angle) * weights))) % 360
    return {"hueDeg": float(hue), "saturation": float(np.median(hsv[:, 1])),
            "pixels": int(len(hsv))}


def photometrics(png, ident):
    image = rgb(png)
    mask = alpha(ident) >= 230
    values = lum(image)[mask]
    return {"p50": float(np.percentile(values, 50)),
            "p90": float(np.percentile(values, 90)),
            "highlight": hue_sat(image, mask), "maskPx": int(mask.sum())}


def hue_distance(a, b):
    return abs((float(a) - float(b) + 180.0) % 360.0 - 180.0)


def fitness_of(metrics, face_move):
    total = 0.0
    parts = {}
    for view in VIEWS:
        got, target = metrics[view], TS[view]
        d50 = abs(got["p50"] - target["p50"]) / target["p50"]
        d90 = abs(got["p90"] - target["p90"]) / target["p90"]
        dh = hue_distance(got["highlight"]["hueDeg"], target["highlight"]["hueDeg"]) / 30.0
        ds = abs(got["highlight"]["saturation"] - target["highlight"]["saturation"])
        subtotal = d50 + d90 + 2.0 * (dh + ds)
        total += subtotal
        parts[view] = {"p50Relative": d50, "p90Relative": d90, "hueOver30": dh,
                       "saturationAbsolute": ds, "subtotal": subtotal}
    penalty = 10.0 if face_move > .05 else 0.0
    parts["face"] = {"moveFraction": face_move, "penalty": penalty}
    return float(total + penalty), parts


# ---------------------------------------------------------------- search render

def track(camera, target):
    camera.rotation_euler = (Vector(tuple(target)) - camera.location).to_track_quat("-Z", "Y").to_euler()


def canonical_camera(state, landmarks, view):
    """Absolute camera transform; copied semantics from hair-score/score.py."""
    camera, target = state["handle"].camera, state["handle"].target
    recorded = landmarks.get("views", {}).get(view)
    if recorded:
        camera.location = Vector(tuple(recorded["camera_location"]))
        camera.data.lens = float(recorded["camera_lens_mm"])
    elif view == "three_quarter":
        front = landmarks["views"]["front"]["camera_location"]
        radius = abs(float(front[1]) - float(target.y))
        angle = math.radians(45.0)
        camera.location = target + Vector((radius * math.sin(angle), -radius * math.cos(angle), 0.03))
        camera.data.lens = float(landmarks["views"]["front"]["camera_lens_mm"])
    else:
        raise ValueError(view)
    track(camera, target)
    bpy.context.view_layer.update()


def visible(state, hair):
    for obj in bpy.data.objects:
        if obj.type == "CURVES":
            obj.hide_render = obj.hide_viewport = obj != hair
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    hair.hide_render = hair.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], hair)


class CMAES:
    def __init__(self, mean, sigma=.22, population=4, seed=20261015):
        self.mean = np.asarray(mean, float)
        self.sigma = sigma
        self.population = population
        self.rng = np.random.RandomState(seed)
        self.n = len(self.mean)
        self.mu = population // 2
        raw = np.log(self.mu + .5) - np.log(np.arange(1, self.mu + 1))
        self.weights = raw / raw.sum()
        self.mueff = 1 / np.sum(self.weights ** 2)
        n = self.n
        self.cc = (4 + self.mueff / n) / (n + 4 + 2 * self.mueff / n)
        self.cs = (self.mueff + 2) / (n + self.mueff + 5)
        self.c1 = 2 / ((n + 1.3) ** 2 + self.mueff)
        self.cmu = min(1 - self.c1, 2 * (self.mueff - 2 + 1 / self.mueff) / ((n + 2) ** 2 + self.mueff))
        self.damps = 1 + 2 * max(0, math.sqrt((self.mueff - 1) / (n + 1)) - 1) + self.cs
        self.pc = np.zeros(n)
        self.ps = np.zeros(n)
        self.C = np.eye(n)
        self.generation = 0
        self.chi_n = math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n))

    def decompose(self):
        values, vectors = np.linalg.eigh(self.C)
        return vectors, np.sqrt(np.maximum(values, 1e-12))

    def ask(self):
        B, D = self.decompose()
        for _ in range(100):
            z = self.rng.normal(size=self.n)
            y = B @ (D * z)
            x = self.mean + self.sigma * y
            if np.all((x >= 0) & (x <= 1)):
                return x
        return np.clip(x, 0, 1)

    def tell(self, solutions):
        ranked = sorted(solutions, key=lambda row: row[1])[:self.mu]
        old = self.mean.copy()
        xs = np.asarray([row[0] for row in ranked])
        self.mean = np.sum(self.weights[:, None] * xs, axis=0)
        yw = (self.mean - old) / self.sigma
        B, D = self.decompose()
        inv = B @ np.diag(1 / D) @ B.T
        self.ps = (1 - self.cs) * self.ps + math.sqrt(self.cs * (2 - self.cs) * self.mueff) * (inv @ yw)
        self.generation += 1
        norm = np.linalg.norm(self.ps)
        hsig = float(norm / math.sqrt(1 - (1 - self.cs) ** (2 * self.generation)) < (1.4 + 2 / (self.n + 1)) * self.chi_n)
        self.pc = (1 - self.cc) * self.pc + hsig * math.sqrt(self.cc * (2 - self.cc) * self.mueff) * yw
        ys = (xs - old) / self.sigma
        rank_mu = sum(w * np.outer(y, y) for w, y in zip(self.weights, ys))
        self.C = ((1 - self.c1 - self.cmu) * self.C + self.c1 * (np.outer(self.pc, self.pc) + (1 - hsig) * self.cc * (2 - self.cc) * self.C)) + self.cmu * rank_mu
        self.sigma *= math.exp((self.cs / self.damps) * (norm / self.chi_n - 1))


def decode(vector):
    values = BOUNDS[:, 0] + np.asarray(vector) * (BOUNDS[:, 1] - BOUNDS[:, 0])
    return {name: float(value) for name, value in zip(RIG_KEYS, values)}


def encode(rig):
    values = np.asarray([rig[name] for name in RIG_KEYS], float)
    return (values - BOUNDS[:, 0]) / (BOUNDS[:, 1] - BOUNDS[:, 0])


def start_rig():
    base = look7_params()
    return {
        "key_energy": float(base["key_energy"]),
        "key_elev_deg": float(math.degrees(math.atan(1.4059 / 1.9209))),
        "key_daz_deg": -38.66,
        "key_size_m": float(base["key_size_m"]),
        "fill_energy": float(base["fill_W"]),
        "fill_elev_deg": float(math.degrees(math.atan(0.9915 / 1.8028))),
        "rim_energy": float(json.load(open(SEARCH2))["params"]["rim_W"]),
    }


# ---------------------------------------------------------------- steps

def run_scorer(strands, params_path, out):
    scorer = load_module("hair_rig1_score", SCORE)
    wrap_color(scorer)
    saved = list(sys.argv)
    sys.argv = [str(SCORE), "--", "--strands", str(strands),
                "--params", str(params_path), "--out", str(out)]
    try:
        scorer.main()
    finally:
        sys.argv = saved


def step1():
    E.mkdir(parents=True, exist_ok=True)
    run_scorer(S5, L7PARAMS, E / "base")
    path = E / "base/score.json"
    doc = json.load(open(path))
    doc["materialAdapter"] = {
        "reason": "canonical scorer builder is HUANG-only; render and all metrics remain score.py",
        "mode": "COLOR",
        "parametersSelector": "$.params plus directColorLinear/reflection/secondaryReflection/roughness",
        "adapter": str(Path(__file__).resolve()),
        "strandsNote": "b9 = hair-tilt5/cells/s5/strands.npz (current best strands)",
    }
    path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    print("BASE_SCORED", str(path), flush=True)


def step2():
    E.mkdir(parents=True, exist_ok=True)
    (E / "rim_check.json").write_text(json.dumps(stock_rim_probe(), indent=2) + "\n")

    base_face = float(R.X.face_and_part(E / "base/front.png", E / "base/front-id.png")["faceP50"])
    landmarks = json.loads(LANDMARKS.read_text())
    with np.load(S5) as data:
        points = np.asarray(data["points"], float)
        radii = np.asarray(data["radii"], np.float32)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    state = R.ST.build_state()
    material = look7_params()
    hair = R.build_hair(state, points, radii, "hair_rig1_search", material)
    configure_color(hair, material)
    visible(state, hair)
    old = state["handle"].hair
    state["handle"].hair = hair

    out = E / "search_cells"
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene

    def evaluate(rig, tag):
        R.ST.lights(state, material)
        timings = {}
        readbacks = {}
        for view in VIEWS:
            canonical_camera(state, landmarks, view)
            readbacks[view] = place_rig(state, rig, view)
            scene.render.resolution_x = scene.render.resolution_y = 512
            scene.render.resolution_percentage = 100
            scene.cycles.samples = 32
            scene.cycles.seed = 0
            scene.render.image_settings.file_format = "PNG"
            scene.render.filter_size = 1.5
            scene.render.film_transparent = False
            scene.render.filepath = str(out / f"{tag}-{view}.png")
            started = time.perf_counter()
            bpy.ops.render.render(write_still=True)
            timings[view] = time.perf_counter() - started
            state["hs"]._render_id(state["handle"], out / f"{tag}-{view}-id.png", 512)
            print("RENDERED", tag, view, f"{timings[view]:.1f}s", flush=True)
        metrics = {view: photometrics(out / f"{tag}-{view}.png", out / f"{tag}-{view}-id.png")
                   for view in VIEWS}
        face = float(R.X.face_and_part(out / f"{tag}-front.png", out / f"{tag}-front-id.png")["faceP50"])
        move = abs(face - base_face) / base_face
        score, parts = fitness_of(metrics, move)
        return metrics, face, move, score, parts, timings, readbacks

    start = start_rig()
    optimizer = CMAES(encode(start))
    stream = (E / "search.jsonl").open("w")
    best = None
    index = 0
    try:
        for generation in range(6):
            solutions = []
            for member in range(4):
                vector = np.asarray(encode(start)) if (generation == 0 and member == 0) else optimizer.ask()
                rig = decode(vector)
                tag = f"eval{index:02d}"
                metrics, face, move, score, parts, timings, readbacks = evaluate(rig, tag)
                record = {"eval": index, "generation": generation, "rig": rig,
                          "fitness": score, "fitnessParts": parts,
                          "metrics": metrics, "faceCheekP50": face,
                          "faceMoveFraction": move, "baseFaceCheekP50": base_face,
                          "lightsReadback": readbacks, "renderSeconds": timings}
                stream.write(json.dumps(record) + "\n")
                stream.flush()
                solutions.append((vector, score))
                if best is None or score < best["fitness"]:
                    best = record
                print("EVAL", index, "FITNESS", round(score, 4), flush=True)
                index += 1
            optimizer.tell(solutions)
    finally:
        stream.close()
        state["handle"].hair = old

    (E / "search_best.json").write_text(json.dumps({
        "schemaVersion": 1,
        "selection": "minimum declared fitness over 24 bounded seeded CMA-ES evaluations (first eval = stock effective rig)",
        "bounds": {name: list(bound) for name, bound in zip(RIG_KEYS, BOUNDS)},
        "startRig": start, "bestEval": best["eval"], "searchFitness512": best["fitness"],
        "rig": best["rig"], "fitnessParts": best["fitnessParts"],
        "baseFaceCheekP50": base_face,
    }, indent=2) + "\n")
    print("SEARCH_BEST", json.dumps(best["rig"]), "FITNESS", best["fitness"], flush=True)


def step3():
    E.mkdir(parents=True, exist_ok=True)
    search_best = json.load(open(E / "search_best.json"))
    params = look7_params()
    rig = search_best["rig"]
    params.update({"key_energy": rig["key_energy"], "key_elev_deg": rig["key_elev_deg"],
                   "key_daz_deg": rig["key_daz_deg"], "key_size_m": rig["key_size_m"],
                   "fill_W": rig["fill_energy"], "fill_elev_deg": rig["fill_elev_deg"],
                   "rim_W": rig["rim_energy"]})
    params_path = E / "best_params.json"
    params_path.write_text(json.dumps({
        "schemaVersion": 1, "params": params, "rig": rig,
        "materialFrom": str(L7PARAMS), "rigFrom": str(E / "search_best.json"),
    }, indent=2) + "\n")

    scorer = load_module("hair_rig1_score_best", SCORE)
    wrap_color(scorer)
    wrap_rig(scorer)
    saved = list(sys.argv)
    sys.argv = [str(SCORE), "--", "--strands", str(S5),
                "--params", str(params_path), "--out", str(E / "best")]
    try:
        scorer.main()
    finally:
        sys.argv = saved
    path = E / "best/score.json"
    doc = json.load(open(path))
    doc["materialAdapter"] = {
        "reason": "canonical scorer builder is HUANG-only; render and all metrics remain score.py",
        "mode": "COLOR",
        "parametersSelector": "$.params plus directColorLinear/reflection/secondaryReflection/roughness",
        "adapter": str(Path(__file__).resolve()),
        "strandsNote": "b9 = hair-tilt5/cells/s5/strands.npz (current best strands)",
    }
    doc["rigAdapter"] = {
        "reason": "hair-look1/station.py lights() hardcodes OCLX_rim to SEARCH_BASE rim_W and the stock camera-relative path never touches the rim; score.py would ignore key_elev_deg/key_daz_deg/fill_elev_deg/rim_W values",
        "mode": "camera_relative_all7",
        "parametersSelector": "$.params key_energy/key_elev_deg/key_daz_deg/key_size_m/fill_W/fill_elev_deg/rim_W",
        "adapter": str(Path(__file__).resolve()),
        "rimCheck": "E/rim_check.json",
    }
    path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    print("BEST_SCORED", str(path), flush=True)


def main():
    args = cli()
    if args.step1:
        step1()
    elif args.step2:
        step2()
    else:
        step3()


if __name__ == "__main__":
    main()
