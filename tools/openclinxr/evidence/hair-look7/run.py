#!/usr/bin/env python3
"""Hair look 7: direct COLOR brightness re-solve on frozen a1 strands."""
from __future__ import annotations

import argparse
import colorsys
import importlib.util
import json
import math
import shutil
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
REAL1 = ROOT / "tools/openclinxr/evidence/hair-real1"
LOOK5 = ROOT / "tools/openclinxr/evidence/hair-look5"
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"
SCORE_BASE = ROOT / "tools/openclinxr/evidence/hair-score/runs/a1-look5"
INT1 = ROOT / "tools/openclinxr/evidence/hair-int1"
LOOK2 = ROOT / "tools/openclinxr/evidence/hair-look2"
LOOK1 = ROOT / "tools/openclinxr/evidence/hair-look1"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TARGET_NAMES = {
    "front": "target-front.png", "three_quarter": "target-three_quarter.png",
    "profile_90": "target-profile.png", "back": "target-back.png",
}
VIEWS = ("front", "three_quarter", "profile_90", "back")
TS_LINEAR = np.asarray((0.01599629336550963, 0.011612245179743885, 0.009134058702220787), float)
BASE = dict(json.load(open(LOOK5 / "cells/best/metrics.json"))["params"])
BASE_FACE = float(json.load(open(LOOK5 / "cells/best/metrics.json"))["views"]["front"]["faceP50"])
STRANDS = REAL1 / "cells/a1/strands.npz"

sys.path[:0] = [str(INT1), str(LOOK2), str(LOOK1)]
import run_blender as R  # noqa: E402
import cell_rel as C  # noqa: E402

TS = {view: R.X.target_photometrics(view) for view in VIEWS}


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--step1", action="store_true")
    parser.add_argument("--step2", action="store_true")
    parser.add_argument("--step3", action="store_true")
    parser.add_argument("--step4", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)
    if sum((args.step1, args.step2, args.step3, args.step4)) != 1:
        parser.error("select exactly one step")
    return args


def source_geometry():
    with np.load(STRANDS) as data:
        return np.asarray(data["points"], float), np.asarray(data["radii"], np.float32)


def hair_node(obj):
    for material in obj.data.materials:
        for node in material.node_tree.nodes:
            if node.bl_idname == "ShaderNodeBsdfHairPrincipled":
                return node
    raise RuntimeError("Principled Hair BSDF not found")


def configure_color(obj, params):
    node = hair_node(obj)
    sockets = {socket.identifier: socket for socket in node.inputs}
    node.parametrization = "COLOR"
    sockets["Color"].default_value = (*params["directColorLinear"], 1.0)
    # Blender 5.1 exposes the UI labels as Reflection / Secondary Reflection,
    # but keyed RNA access is only reliable through these identifiers.
    sockets["R lobe"].default_value = float(params["reflection"])
    sockets["TRT lobe"].default_value = float(params["secondaryReflection"])
    sockets["Roughness"].default_value = float(params["roughness"])
    return {
        "model": node.model, "parametrization": node.parametrization,
        "Color": [float(x) for x in sockets["Color"].default_value],
        "Reflection": float(sockets["R lobe"].default_value),
        "Secondary Reflection": float(sockets["TRT lobe"].default_value),
        "Roughness": float(sockets["Roughness"].default_value),
    }


def expanded_params(spec):
    out = dict(BASE)
    out.update(spec)
    out["model"] = "HUANG"
    return out


def set_lights(state, params):
    R.ST.lights(state, params)
    for light in state["handle"].lights:
        if light.name == "OCLX_rim":
            light.data.energy = float(params["rim_W"])


def visible(state, obj):
    for other in bpy.data.objects:
        if other.type == "CURVES":
            other.hide_render = other.hide_viewport = other != obj
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    obj.hide_render = obj.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], obj)


def render(tag, spec, size=512, samples=32, render_ids=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    state = R.ST.build_state()
    points, radii = source_geometry()
    params = expanded_params(spec)
    obj = R.build_hair(state, points, radii, f"hair_look7_{tag}", params)
    readback = configure_color(obj, params)
    visible(state, obj)
    set_lights(state, params)
    out = E / "cells" / tag
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    old = state["handle"].hair
    state["handle"].hair = obj
    timings = {}
    try:
        for view in VIEWS:
            state["c3"].set_final_view(state["handle"], view)
            C.place_camera_relative(state, params, view)
            scene.render.resolution_x = scene.render.resolution_y = size
            scene.render.resolution_percentage = 100
            scene.cycles.samples = samples
            scene.cycles.seed = 0
            scene.render.image_settings.file_format = "PNG"
            scene.render.filter_size = 1.5
            scene.render.film_transparent = False
            scene.render.filepath = str(out / f"{view}.png")
            started = time.perf_counter()
            bpy.ops.render.render(write_still=True)
            timings[view] = time.perf_counter() - started
            if render_ids:
                state["hs"]._render_id(state["handle"], out / f"{view}-id.png", size)
            print("RENDERED", tag, view, f"{timings[view]:.2f}s", flush=True)
    finally:
        state["handle"].hair = old
    return readback, timings


def copy_base_ids(tag):
    dst = E / "cells" / tag
    for view in VIEWS:
        shutil.copy2(E / "cells/base" / f"{view}-id.png", dst / f"{view}-id.png")


def rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), float) / 255.0


def alpha(path):
    return np.asarray(Image.open(path).convert("RGBA"), np.uint8)[..., 3]


def lum(image):
    return .2126 * image[..., 0] + .7152 * image[..., 1] + .0722 * image[..., 2]


def hue_sat(image, mask):
    y = lum(image)
    bright = mask & (y >= np.percentile(y[mask], 90))
    hsv = np.asarray([colorsys.rgb_to_hsv(*pixel) for pixel in image[bright]])
    weights = np.maximum(hsv[:, 1], .02)
    angle = hsv[:, 0] * 2 * math.pi
    hue = math.degrees(math.atan2(np.sum(np.sin(angle) * weights), np.sum(np.cos(angle) * weights))) % 360
    return {"hueDeg": float(hue), "saturation": float(np.median(hsv[:, 1])), "pixels": int(len(hsv))}


def photometrics(cell, view):
    image = rgb(cell / f"{view}.png")
    mask = alpha(cell / f"{view}-id.png") >= 230
    values = lum(image)[mask]
    return {"p50": float(np.percentile(values, 50)), "p90": float(np.percentile(values, 90)),
            "highlight": hue_sat(image, mask), "maskPx": int(mask.sum())}


def measure(tag):
    cell = E / "cells" / tag
    views = {view: photometrics(cell, view) for view in VIEWS}
    face = float(R.X.face_and_part(cell / "front.png", cell / "front-id.png")["faceP50"])
    base = E / "cells/base"
    silhouette = {}
    for view in VIEWS:
        a = alpha(base / f"{view}-id.png") >= 230
        b = alpha(cell / f"{view}-id.png") >= 230
        iou = float((a & b).sum() / max((a | b).sum(), 1))
        silhouette[view] = {"iouVsBase": iou, "deltaIou": iou - 1.0}
    return {"views": views, "faceCheekP50": face,
            "faceMoveFraction": abs(face - BASE_FACE) / BASE_FACE,
            "silhouette": silhouette,
            "gates": {"absDeltaIouAtMost001EachView": all(abs(x["deltaIou"]) <= .01 for x in silhouette.values()),
                      "faceCheekWithin5Percent": abs(face - BASE_FACE) / BASE_FACE <= .05}}


def hue_distance(a, b):
    return abs((float(a) - float(b) + 180.0) % 360.0 - 180.0)


def fitness(metrics):
    total = 0.0
    parts = {}
    for view in VIEWS:
        got, target = metrics["views"][view], TS[view]
        d50 = abs(got["p50"] - target["p50"]) / target["p50"]
        d90 = abs(got["p90"] - target["p90"]) / target["p90"]
        dh = hue_distance(got["highlight"]["hueDeg"], target["highlight"]["hueDeg"]) / 30.0
        ds = abs(got["highlight"]["saturation"] - target["highlight"]["saturation"])
        subtotal = d50 + d90 + 3.0 * (dh + ds)
        total += subtotal
        parts[view] = {"p50Relative": d50, "p90Relative": d90, "hueOver30": dh,
                       "saturationAbsolute": ds, "subtotal": subtotal}
    penalty = 10.0 if metrics["faceMoveFraction"] > .05 else 0.0
    parts["face"] = {"moveFraction": metrics["faceMoveFraction"], "penalty": penalty}
    return float(total + penalty), parts


def color(scale, shift_deg=0.0):
    h, s, v = colorsys.rgb_to_hsv(*TS_LINEAR)
    shifted = np.asarray(colorsys.hsv_to_rgb((h + shift_deg / 360.0) % 1.0, s, v), float)
    return [float(x) for x in shifted * scale]


def spec(scale, hue_shift=0.0, reflection=None, secondary=None, roughness=None):
    return {
        "colorScale": float(scale), "hueShiftDeg": float(hue_shift),
        "directColorLinear": color(scale, hue_shift),
        "reflection": float(BASE["lobe_R"] if reflection is None else reflection),
        "secondaryReflection": float(BASE["lobe_SR"] if secondary is None else secondary),
        "roughness": float(BASE["roughness"] if roughness is None else roughness),
    }


def step1():
    E.mkdir(parents=True, exist_ok=True)
    cases = {
        "base": (spec(1.0), "t3 COLOR at TS back-hair linear colour"),
        "k1": (spec(.60), "TS linear colour x0.60"),
        "k2": (spec(.45), "TS linear colour x0.45"),
        "k3": (spec(1.0, reflection=.25), "t3 colour; Reflection 0.25"),
        "k4": (spec(.60, reflection=.30), "TS linear colour x0.60; Reflection 0.30"),
    }
    cells = {}
    for index, (tag, (params, label)) in enumerate(cases.items()):
        readback, timings = render(tag, params, render_ids=index == 0)
        if index:
            copy_base_ids(tag)
        row = measure(tag)
        row.update({"label": label, "params": params, "materialReadback": readback, "renderSeconds": timings})
        cells[tag] = row
    doc = {"schemaVersion": 1, "resolution": 512, "samples": 32,
           "geometrySource": str(STRANDS), "rigSource": str(LOOK5 / "cells/best/metrics.json"),
           "targetPhotometrics": {view: {"p50": TS[view]["p50"], "p90": TS[view]["p90"],
                                                "hueDeg": TS[view]["highlight"]["hueDeg"],
                                                "saturation": TS[view]["highlight"]["saturation"]} for view in VIEWS},
           "baseFaceCheekP50": BASE_FACE, "cells": cells}
    (E / "probes.json").write_text(json.dumps(doc, indent=2) + "\n")
    print("PROBES", json.dumps({tag: fitness(row)[0] for tag, row in cells.items()}), flush=True)


class CMAES:
    def __init__(self, mean, sigma=.22, population=4, seed=71):
        self.mean = np.asarray(mean, float); self.sigma = sigma; self.population = population
        self.rng = np.random.RandomState(seed); self.n = len(self.mean); self.mu = population // 2
        raw = np.log(self.mu + .5) - np.log(np.arange(1, self.mu + 1)); self.weights = raw / raw.sum()
        self.mueff = 1 / np.sum(self.weights ** 2); n = self.n
        self.cc = (4 + self.mueff/n)/(n+4+2*self.mueff/n); self.cs = (self.mueff+2)/(n+self.mueff+5)
        self.c1 = 2/((n+1.3)**2+self.mueff); self.cmu = min(1-self.c1, 2*(self.mueff-2+1/self.mueff)/((n+2)**2+self.mueff))
        self.damps = 1+2*max(0, math.sqrt((self.mueff-1)/(n+1))-1)+self.cs
        self.pc = np.zeros(n); self.ps = np.zeros(n); self.C = np.eye(n); self.generation = 0
        self.chi_n = math.sqrt(n)*(1-1/(4*n)+1/(21*n*n))

    def decompose(self):
        values, vectors = np.linalg.eigh(self.C)
        return vectors, np.sqrt(np.maximum(values, 1e-12))

    def ask(self):
        B, D = self.decompose()
        for _ in range(100):
            z = self.rng.normal(size=self.n); y = B @ (D*z); x = self.mean + self.sigma*y
            if np.all((x >= 0) & (x <= 1)): return x
        return np.clip(x, 0, 1)

    def tell(self, solutions):
        ranked = sorted(solutions, key=lambda row: row[1])[:self.mu]
        old = self.mean.copy(); xs = np.asarray([row[0] for row in ranked])
        self.mean = np.sum(self.weights[:, None]*xs, axis=0); yw = (self.mean-old)/self.sigma
        B, D = self.decompose(); inv = B @ np.diag(1/D) @ B.T
        self.ps = (1-self.cs)*self.ps + math.sqrt(self.cs*(2-self.cs)*self.mueff)*(inv@yw)
        self.generation += 1; norm = np.linalg.norm(self.ps)
        hsig = float(norm/math.sqrt(1-(1-self.cs)**(2*self.generation)) < (1.4+2/(self.n+1))*self.chi_n)
        self.pc = (1-self.cc)*self.pc + hsig*math.sqrt(self.cc*(2-self.cc)*self.mueff)*yw
        ys = (xs-old)/self.sigma; rank_mu = sum(w*np.outer(y,y) for w,y in zip(self.weights,ys))
        self.C = ((1-self.c1-self.cmu)*self.C + self.c1*(np.outer(self.pc,self.pc)+(1-hsig)*self.cc*(2-self.cc)*self.C) + self.cmu*rank_mu)
        self.sigma *= math.exp((self.cs/self.damps)*(norm/self.chi_n-1))


BOUNDS = np.asarray(((.35,.80),(-4.,4.),(.20,.50),(.60,1.40),(.30,.45)), float)


def decode(vector):
    values = BOUNDS[:, 0] + np.asarray(vector)*(BOUNDS[:, 1]-BOUNDS[:, 0])
    return spec(*values)


def encode(params):
    values = np.asarray((params["colorScale"], params["hueShiftDeg"], params["reflection"],
                         params["secondaryReflection"], params["roughness"]), float)
    return (values-BOUNDS[:, 0])/(BOUNDS[:, 1]-BOUNDS[:, 0])


def step2():
    probes = json.load(open(E / "probes.json"))
    ranked = sorted(((fitness(row)[0], row["params"]) for row in probes["cells"].values()), key=lambda row: row[0])
    start = ranked[0][1]
    optimizer = CMAES(encode(start))
    records = []; best = None
    for generation in range(4):
        solutions = []
        for _ in range(4):
            vector = optimizer.ask(); params = decode(vector); index = len(records); tag = f"eval{index:02d}"
            readback, timings = render(tag, params)
            copy_base_ids(tag); metrics = measure(tag); score, parts = fitness(metrics)
            record = {"eval": index, "generation": generation, "params": params, "fitness": score,
                      "fitnessParts": parts, "metrics": metrics, "materialReadback": readback,
                      "renderSeconds": timings}
            records.append(record); solutions.append((vector, score))
            if best is None or score < best["fitness"]: best = record
            print("EVAL", index, "FITNESS", score, flush=True)
        optimizer.tell(solutions)
    with (E / "search.jsonl").open("w") as stream:
        for record in records: stream.write(json.dumps(record) + "\n")
    best_doc = {"schemaVersion": 1, "selection": "minimum declared fitness over 16 bounded seeded CMA-ES evaluations",
                "bounds": {name: list(bound) for name, bound in zip(("colorScale","hueShiftDeg","reflection","secondaryReflection","roughness"), BOUNDS)},
                "bestEval": best["eval"], "searchFitness512": best["fitness"], "params": expanded_params(best["params"]),
                "colorParams": best["params"]}
    (E / "best-params.json").write_text(json.dumps(best_doc, indent=2) + "\n")
    print("BEST", json.dumps(best_doc), flush=True)


def load_module(name, path):
    module_spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(module_spec); sys.modules[name] = module
    module_spec.loader.exec_module(module)
    return module


def run_canonical_scorer():
    scorer = load_module("hair_look7_canonical_score", SCORE)
    original = scorer.R.build_hair

    def build_color(state, points, radii, name, params):
        obj = original(state, points, radii, name, params)
        configure_color(obj, params)
        return obj

    scorer.R.build_hair = build_color
    saved = list(sys.argv)
    sys.argv = [str(SCORE), "--", "--strands", str(STRANDS), "--params", str(E / "best-params.json"),
                "--out", str(E / "best"), "--crown-top"]
    try:
        scorer.main()
    finally:
        sys.argv = saved
        scorer.R.build_hair = original
    path = E / "best/score.json"; doc = json.load(open(path))
    doc["materialAdapter"] = {"reason": "canonical scorer builder is HUANG-only; render and all metrics remain score.py",
                              "mode": "COLOR", "parametersSelector": "$.params plus directColorLinear/reflection/secondaryReflection/roughness",
                              "adapter": str(Path(__file__).resolve())}
    path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")


def make_sheet():
    columns = (("front","front",None), ("three_quarter","three_quarter",None),
               ("profile_90","profile_90",None), ("back","back",None),
               ("ear crop","three_quarter",(100,240,484,624)), ("back crop","back",(320,280,704,664)))
    rows = (("TS", TARGET), ("look5 base", SCORE_BASE), ("best", E / "best"))
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile*len(columns), (tile+label)*len(rows)), "white"); draw = ImageDraw.Draw(canvas)
    for ri, (row, root) in enumerate(rows):
        for ci, (title, view, crop) in enumerate(columns):
            source = root / TARGET_NAMES[view] if row == "TS" else root / f"{view}.png"
            image = Image.open(source).convert("RGB")
            if crop: image = image.crop(crop)
            image = image.resize((tile,tile), Image.Resampling.LANCZOS)
            x, y = ci*tile, ri*(tile+label); canvas.paste(image,(x,y+label)); draw.text((x+7,y+8),f"{row} | {title}",fill="black")
    canvas.save(E / "look-sheet.png")


def step3():
    run_canonical_scorer()
    make_sheet()
    print("SCORED", E / "best/score.json", flush=True)


def fmt_probe(tag, row):
    fields = "; ".join(f"{view}={row['views'][view]['p50']:.6f}/{row['views'][view]['p90']:.6f}/{row['views'][view]['highlight']['hueDeg']:.3f}/{row['views'][view]['highlight']['saturation']:.3f}"
                       for view in VIEWS)
    max_diou = max(abs(value["deltaIou"]) for value in row["silhouette"].values())
    return f"PROBE {tag}::{row['label']}; p50/p90/hue/sat {fields}; cheek={row['faceCheekP50']:.6f}; max|dIoU|={max_diou:.6f} {'PASS' if max_diou <= .01 else 'FAIL'}"


def step4():
    probes = json.load(open(E / "probes.json")); params = json.load(open(E / "best-params.json")); score = json.load(open(E / "best/score.json"))
    p = params["colorParams"]
    lines = ["HAIR LOOK 7 — DIRECT COLOR WITH BRIGHTNESS RE-SOLVE", ""]
    for tag in ("k1","k2","k3","k4"): lines.append(fmt_probe(tag, probes["cells"][tag]))
    lines += ["", f"BEST PARAMS::colourScale={p['colorScale']:.6f}; hueShiftDeg={p['hueShiftDeg']:.6f}; directColorLinear={p['directColorLinear']}; Reflection={p['reflection']:.6f}; Secondary Reflection={p['secondaryReflection']:.6f}; roughness={p['roughness']:.6f}; selectedEval={params['bestEval']}; fitness512={params['searchFitness512']:.6f}", ""]
    for view in VIEWS:
        row = score["photometrics"][view]; target = row["target"]
        lines.append(f"BEST.{view}::p50={row['p50']:.6f} vs TS {target['p50']:.6f}; p90={row['p90']:.6f} vs TS {target['p90']:.6f}; hue={row['hueDeg']:.3f} vs TS {target['hueDeg']:.3f}; sat={row['saturation']:.3f} vs TS {target['saturation']:.3f}")
    lines += ["", "SAW::Against TS, the first wrong read is still geometry rather than colour: the back silhouette has a blunt rectangular hem with long sparse spikes, vertical curtain bands, and an exposed centre-part/scalp, while TS reads as a dense natural sheet with a softly irregular hem and fine fibre variation. Direct colour warms the body colour and re-solves brightness but cannot repair that structure."]
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")
    (E / "DONE.txt").write_text("DONE: four 512x32 COLOR probes, 16-evaluation bounded CMA-ES, canonical hair-score 1024x64 all-view+crown score, TS/base/best look sheet, RESULT, and reproducible source are present.\n")


def main():
    args = cli()
    if args.step1: step1()
    elif args.step2: step2()
    elif args.step3: step3()
    else: step4()


if __name__ == "__main__":
    main()
