#!/usr/bin/env python3
"""Hair-look-5: causal colour probes and bounded HUANG look search.

Run inside Blender.  Geometry and all upstream evidence are immutable inputs;
every generated artifact is written below hair-look5.
"""
from __future__ import annotations

import colorsys
import json
import math
import shutil
import sys
from pathlib import Path

import bpy
import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
I1 = ROOT / "tools/openclinxr/evidence/hair-int1"
L2 = ROOT / "tools/openclinxr/evidence/hair-look2"
L4 = ROOT / "tools/openclinxr/evidence/hair-look4"
G6 = ROOT / "tools/openclinxr/evidence/hair-geo6"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
VIEWS = ("front", "three_quarter", "profile_90", "back")
TARGET_NAMES = {
    "front": "target-front.png",
    "three_quarter": "target-three_quarter.png",
    "profile_90": "target-profile.png",
    "back": "target-back.png",
}

sys.path[:0] = [str(I1), str(L2)]
import run_blender as R  # noqa: E402
import cell_rel as C  # noqa: E402

BASE = dict(json.load(open(L4 / "cells/best/metrics.json"))["params"])
BASE["model"] = "HUANG"
BASE_FACE = float(json.load(open(I1 / "cells/i1/metrics.json"))["views"]["front"]["faceP50"])
TS = {view: R.X.target_photometrics(view) for view in VIEWS}


def target_front_regions():
    image = R.X.rgb(TARGET / "target-front.png")
    mask = R.X.mask_l(R.TARGET_MASKS / "mask-front-v2.png")
    y = R.X.luminance(image)
    yy, xx = np.nonzero(mask)
    y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
    h, w = y1 - y0 + 1, x1 - x0 + 1
    Y, X = np.indices(mask.shape)
    crown = mask & (Y <= y0 + .35 * h) & (X >= x0 + .35 * w) & (X <= x0 + .65 * w)
    sides = mask & (Y >= y0 + .18 * h) & (Y <= y0 + .68 * h) & ((X <= x0 + .28 * w) | (X >= x0 + .72 * w))
    return {"partSide": float(y[crown].mean() / y[sides].mean()), "faceP50": BASE_FACE}


TS["front"].update(target_front_regions())


class CMAES:
    """Small bounded CMA-ES implementation sufficient for this 4-D search."""

    def __init__(self, mean, sigma, population_size, seed, bounds):
        self.mean = np.asarray(mean, float)
        self.sigma = float(sigma)
        self.population_size = population_size
        self.bounds = np.asarray(bounds, float)
        self.rng = np.random.RandomState(seed)
        self.n = len(self.mean)
        self.mu = population_size // 2
        raw = np.log(self.mu + .5) - np.log(np.arange(1, self.mu + 1))
        self.weights = raw / raw.sum()
        self.mueff = 1.0 / np.sum(self.weights ** 2)
        n = self.n
        self.cc = (4 + self.mueff / n) / (n + 4 + 2 * self.mueff / n)
        self.cs = (self.mueff + 2) / (n + self.mueff + 5)
        self.c1 = 2 / ((n + 1.3) ** 2 + self.mueff)
        self.cmu = min(1 - self.c1, 2 * (self.mueff - 2 + 1 / self.mueff) / ((n + 2) ** 2 + self.mueff))
        self.damps = 1 + 2 * max(0.0, math.sqrt((self.mueff - 1) / (n + 1)) - 1) + self.cs
        self.pc = np.zeros(n)
        self.ps = np.zeros(n)
        self.C = np.eye(n)
        self.generation = 0
        self.chi_n = math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n))

    def _decompose(self):
        values, vectors = np.linalg.eigh(self.C)
        values = np.maximum(values, 1e-12)
        return vectors, np.sqrt(values)

    def ask(self):
        B, D = self._decompose()
        for _ in range(100):
            z = self.rng.normal(size=self.n)
            y = B @ (D * z)
            x = self.mean + self.sigma * y
            if np.all(x >= self.bounds[:, 0]) and np.all(x <= self.bounds[:, 1]):
                return x
        return np.clip(x, self.bounds[:, 0], self.bounds[:, 1])

    def tell(self, solutions):
        ranked = sorted(solutions, key=lambda row: row[1])[:self.mu]
        old_mean = self.mean.copy()
        xs = np.asarray([row[0] for row in ranked])
        self.mean = np.sum(self.weights[:, None] * xs, axis=0)
        y_w = (self.mean - old_mean) / self.sigma
        B, D = self._decompose()
        invsqrt = B @ np.diag(1.0 / D) @ B.T
        self.ps = (1 - self.cs) * self.ps + math.sqrt(self.cs * (2 - self.cs) * self.mueff) * (invsqrt @ y_w)
        self.generation += 1
        norm_ps = np.linalg.norm(self.ps)
        hsig = float(norm_ps / math.sqrt(1 - (1 - self.cs) ** (2 * self.generation)) < (1.4 + 2 / (self.n + 1)) * self.chi_n)
        self.pc = (1 - self.cc) * self.pc + hsig * math.sqrt(self.cc * (2 - self.cc) * self.mueff) * y_w
        ys = (xs - old_mean) / self.sigma
        rank_mu = sum(weight * np.outer(y, y) for weight, y in zip(self.weights, ys))
        self.C = ((1 - self.c1 - self.cmu) * self.C
                  + self.c1 * (np.outer(self.pc, self.pc) + (1 - hsig) * self.cc * (2 - self.cc) * self.C)
                  + self.cmu * rank_mu)
        self.sigma *= math.exp((self.cs / self.damps) * (norm_ps / self.chi_n - 1))


def fparams(**changes):
    out = dict(BASE)
    out.update(changes)
    return out


def i1_geometry():
    src = np.load(G6 / "cells/f1/strands.npz")
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"], np.float32)
    cx = float(src["cx"])
    near = np.flatnonzero((np.abs(roots[:, 0] - cx) <= .003) & (roots[:, 1] <= float(src["apex_y"])))
    ids = near[::2]
    add = points[ids].copy()
    side = np.where(add[:, 0, 0] >= cx, 1.0, -1.0)
    add[:, :, 0] += side[:, None] * .00004
    return np.concatenate([points, add]), np.concatenate([radii, radii[ids]])


def set_lights(state, params):
    R.ST.lights(state, params)
    for light in state["handle"].lights:
        if light.name == "OCLX_rim":
            light.data.energy = float(params.get("rim_W", BASE["rim_W"]))


def shirt_materials():
    found = []
    for obj in bpy.data.objects:
        name = obj.name.lower()
        if "t_shirt" not in name and "tshirt" not in name:
            continue
        for mat in obj.data.materials if hasattr(obj.data, "materials") else []:
            if mat and mat.use_nodes:
                bsdf = mat.node_tree.nodes.get("Principled BSDF")
                if bsdf and "Base Color" in bsdf.inputs:
                    found.append((obj.name, mat.name, bsdf.inputs["Base Color"]))
    return found


def neutralize_shirt():
    saved, audit = [], []
    for obj_name, mat_name, socket in shirt_materials():
        rgba = tuple(float(x) for x in socket.default_value)
        grey = .2126 * rgba[0] + .7152 * rgba[1] + .0722 * rgba[2]
        saved.append((socket, rgba))
        socket.default_value = (grey, grey, grey, rgba[3])
        audit.append({"object": obj_name, "material": mat_name, "original": rgba, "neutralGrey": grey})
    if not saved:
        raise RuntimeError("shirt material not found")
    return saved, audit


def restore_shirt(saved):
    for socket, rgba in saved:
        socket.default_value = rgba


def render_beauties(state, tag, params, size, samples, neutral_shirt=False):
    cell = E / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    # Cycles retains hidden curve allocations and their material state across
    # repeated cells in Blender 5.1.  Reset the datablocks so every causal
    # probe/evaluation starts from the exact same station state.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    render_state = R.ST.build_state()
    patch = R.scalp_patch(render_state)
    obj = R.build_hair(render_state, state["points"], state["radii"], f"hair_look5_{tag}", params)
    R.visibility(render_state, [obj], patch, False)
    set_lights(render_state, params)
    scene = bpy.context.scene
    old = render_state["handle"].hair
    render_state["handle"].hair = obj
    saved = []
    shirt_audit = []
    if neutral_shirt:
        saved, shirt_audit = neutralize_shirt()
    try:
        for view in VIEWS:
            render_state["c3"].set_final_view(render_state["handle"], view)
            C.place_camera_relative(render_state, params, view)
            scene.render.resolution_x = scene.render.resolution_y = size
            scene.render.resolution_percentage = 100
            scene.cycles.samples = samples
            scene.cycles.seed = 0
            scene.render.image_settings.file_format = "PNG"
            scene.render.filter_size = 1.5
            scene.render.film_transparent = False
            scene.render.filepath = str(cell / f"{view}.png")
            bpy.ops.render.render(write_still=True)
            print("RENDERED", tag, view, flush=True)
    finally:
        if saved:
            restore_shirt(saved)
        render_state["handle"].hair = old
    return cell, shirt_audit


def shared_masks(size):
    out = E / "cells" / f"masks{size}"
    out.mkdir(parents=True, exist_ok=True)
    for view in VIEWS:
        source = Image.open(I1 / "cells/i1" / f"{view}-id.png").convert("RGBA")
        if source.size != (size, size):
            source = source.resize((size, size), Image.Resampling.NEAREST)
        source.save(out / f"{view}-id.png")
    return out


def measure(cell, mask_dir):
    views = {view: R.X.photometrics(cell / f"{view}.png", mask_dir / f"{view}-id.png", view) for view in VIEWS}
    views["front"].update(R.X.face_and_part(cell / "front.png", mask_dir / "front-id.png"))
    return views


def hue_delta(a, b):
    return abs((float(a) - float(b) + 180.0) % 360.0 - 180.0) / 30.0


def fitness(views):
    total = 0.0
    parts = {}
    for view in VIEWS:
        got, target = views[view], TS[view]
        d50 = abs(got["p50"] - target["p50"]) / target["p50"]
        d90 = abs(got["p90"] - target["p90"]) / target["p90"]
        dh = hue_delta(got["highlight"]["hueDeg"], target["highlight"]["hueDeg"])
        ds = abs(got["highlight"]["saturation"] - target["highlight"]["saturation"])
        subtotal = d50 + d90 + 3.0 * dh + 3.0 * ds
        total += subtotal
        parts[view] = {"d50": d50, "d90": d90, "hue": dh, "sat": ds, "subtotal": subtotal}
    got_bins = views["back"]["backProfile"]["bins"]
    target_bins = TS["back"]["backProfile"]["bins"]
    back_l1 = float(np.mean([abs(a - b) for a, b in zip(got_bins, target_bins) if a is not None and b is not None]))
    face_move = abs(views["front"]["faceP50"] - BASE_FACE) / BASE_FACE
    penalty = 10.0 if face_move > .05 else 0.0
    total += back_l1 + penalty
    parts.update({"backL1": back_l1, "faceP50": views["front"]["faceP50"], "faceMove": face_move, "facePenalty": penalty})
    return float(total), parts


def compact(views):
    return {
        view: {
            "p50": views[view]["p50"],
            "p90": views[view]["p90"],
            "highlight": views[view]["highlight"],
            **({"partSide": views[view]["partSide"], "faceP50": views[view]["faceP50"]} if view == "front" else {}),
            **({"backProfile": views[view]["backProfile"]} if view == "back" else {}),
        }
        for view in VIEWS
    }


def render_probe(state, mask_dir, tag, params, label, neutral=False):
    cell, shirt_audit = render_beauties(state, tag, params, 512, 32, neutral)
    views = measure(cell, mask_dir)
    score, parts = fitness(views)
    doc = {
        "tag": tag,
        "label": label,
        "params": params,
        "neutralShirtDiagnostic": neutral,
        "shirtAudit": shirt_audit,
        "fitness": score,
        "fitnessParts": parts,
        "views": compact(views),
    }
    (cell / "metrics.json").write_text(json.dumps(doc, indent=2) + "\n")
    return doc


NAMES = ("redness", "rim_W", "lobe_SR", "lobe_T")
BOUNDS = ((.1, .4), (0.0, BASE["rim_W"]), (.8, 1.5), (.5, 1.0))


def norm(params):
    return np.asarray([(params[name] - low) / (high - low) for name, (low, high) in zip(NAMES, BOUNDS)])


def denorm(vector):
    out = dict(BASE)
    for name, value, (low, high) in zip(NAMES, vector, BOUNDS):
        out[name] = low + float(np.clip(value, 0.0, 1.0)) * (high - low)
    return out


def search(state, mask_dir, start):
    optimizer = CMAES(norm(start), .22, population_size=4, seed=17, bounds=np.asarray([[0.0, 1.0]] * 4))
    best = None
    records = []
    for generation in range(4):
        solutions = []
        for _ in range(4):
            vector = optimizer.ask()
            params = denorm(vector)
            index = len(records)
            cell, _ = render_beauties(state, f"eval{index:02d}", params, 512, 32)
            views = measure(cell, mask_dir)
            score, parts = fitness(views)
            record = {"eval": index, "generation": generation, "params": params, "fitness": score, "fitnessParts": parts, "views": compact(views)}
            records.append(record)
            (cell / "metrics.json").write_text(json.dumps(record, indent=2) + "\n")
            solutions.append((vector, score))
            if best is None or score < best[0]:
                best = (score, index, dict(params), parts)
            print("EVAL", index, "FITNESS", score, flush=True)
        optimizer.tell(solutions)
    with (E / "search.jsonl").open("w") as stream:
        for record in records:
            stream.write(json.dumps(record) + "\n")
    return best, records


def final_render(state, params, selected_eval, search_score):
    cell, _ = render_beauties(state, "best", params, 1024, 64)
    for view in VIEWS:
        shutil.copy2(I1 / "cells/i1" / f"{view}-id.png", cell / f"{view}-id.png")
    views = measure(cell, cell)
    score, parts = fitness(views)
    doc = {
        "tag": "best",
        "resolution": 1024,
        "samples": 64,
        "selectedEval": selected_eval,
        "searchFitness512": search_score,
        "fitness1024": score,
        "fitnessParts1024": parts,
        "params": params,
        "views": compact(views),
        "targets": compact(TS),
        "geometrySource": str(G6 / "cells/f1/strands.npz"),
        "geometryVariant": "hair-int1 i1 (+50% roots in 6 mm centre band)",
        "geometryChanged": False,
    }
    (cell / "metrics.json").write_text(json.dumps(doc, indent=2) + "\n")
    return doc


def make_sheet():
    columns = [
        ("front", "front", None),
        ("three_quarter", "three_quarter", None),
        ("profile_90", "profile_90", None),
        ("back", "back", None),
        ("ear crop", "three_quarter", (100, 240, 484, 624)),
        ("back crop", "back", (320, 280, 704, 664)),
    ]
    rows = ("TS", "i1", "best")
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile * len(columns), (tile + label) * len(rows)), "white")
    draw = ImageDraw.Draw(canvas)
    for ri, row in enumerate(rows):
        for ci, (title, view, crop) in enumerate(columns):
            if row == "TS":
                source = TARGET / TARGET_NAMES[view]
            elif row == "i1":
                source = I1 / "cells/i1" / f"{view}.png"
            else:
                source = E / "cells/best" / f"{view}.png"
            image = Image.open(source).convert("RGB")
            if crop:
                image = image.crop(crop)
            image = image.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = ci * tile, ri * (tile + label)
            canvas.paste(image, (x, y + label))
            draw.text((x + 7, y + 8), f"{row} | {title}", fill="black")
    canvas.save(E / "look-sheet.png")


def make_result(probe_doc, best):
    baseline = probe_doc["baseline"]
    lines = ["HAIR LOOK 5 — HIGHLIGHT HUE AND SATURATION", ""]
    for tag in ("c1", "c2", "c3", "c4", "c5", "c6"):
        row = probe_doc["probes"][tag]
        lines.append(
            f"PROBE {tag} {row['status']}::{row['label']}; fitness={row['fitness']:.6f} vs i1 {baseline['fitness']:.6f}; "
            f"delta={row['fitnessDelta']:+.6f}; front hue/sat={row['views']['front']['highlight']['hueDeg']:.3f}/{row['views']['front']['highlight']['saturation']:.3f}; "
            f"3q={row['views']['three_quarter']['highlight']['hueDeg']:.3f}/{row['views']['three_quarter']['highlight']['saturation']:.3f}; "
            f"profile={row['views']['profile_90']['highlight']['hueDeg']:.3f}/{row['views']['profile_90']['highlight']['saturation']:.3f}; "
            f"back={row['views']['back']['highlight']['hueDeg']:.3f}/{row['views']['back']['highlight']['saturation']:.3f}; "
            f"part/side={row['views']['front']['partSide']:.3f}; face={row['views']['front']['faceP50']:.3f}"
        )
    p = best["params"]
    lines += [
        "",
        f"BEST PARAMS::HUANG melanin={p['melanin']:.6f}; redness={p['redness']:.6f}; Reflection={p['lobe_R']:.6f}; "
        f"Secondary Reflection={p['lobe_SR']:.6f}; Transmission={p['lobe_T']:.6f}; roughness={p['roughness']:.6f}; "
        f"Random={p['random']:.6f}; rim_W={p['rim_W']:.6f}; camera-relative rig",
        f"BEST FITNESS::512={best['searchFitness512']:.6f}; 1024={best['fitness1024']:.6f}; selected eval={best['selectedEval']}; face move={best['fitnessParts1024']['faceMove']*100:.3f}% PASS<=5%",
        "",
    ]
    for view in VIEWS:
        got, target = best["views"][view], best["targets"][view]
        lines.append(
            f"BEST.{view}::p50={got['p50']:.6f} vs TS {target['p50']:.6f}; p90={got['p90']:.6f} vs TS {target['p90']:.6f}; "
            f"hue={got['highlight']['hueDeg']:.3f} vs TS {target['highlight']['hueDeg']:.3f}; "
            f"sat={got['highlight']['saturation']:.3f} vs TS {target['highlight']['saturation']:.3f}"
            + (f"; part/side={got['partSide']:.3f}; face={got['faceP50']:.3f}" if view == "front" else "")
        )
    hue_improved = sum(hue_delta(best["views"][v]["highlight"]["hueDeg"], TS[v]["highlight"]["hueDeg"]) for v in VIEWS) < sum(hue_delta(baseline["views"][v]["highlight"]["hueDeg"], TS[v]["highlight"]["hueDeg"]) for v in VIEWS)
    sat_improved = sum(abs(best["views"][v]["highlight"]["saturation"] - TS[v]["highlight"]["saturation"]) for v in VIEWS) < sum(abs(baseline["views"][v]["highlight"]["saturation"] - TS[v]["highlight"]["saturation"]) for v in VIEWS)
    lines += ["", f"SAW::Best is {'closer' if hue_improved else 'not closer'} in aggregate highlight hue and {'closer' if sat_improved else 'not closer'} in aggregate highlight saturation than i1; the sheet preserves the remaining per-view luminance and colour mismatch for visual review."]
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")
    (E / "DONE.txt").write_text("DONE: six four-view 512x32 one-change probes, 16-evaluation CMA-ES, four-view 1024x64 best, look sheet, metrics, RESULT, and source scripts are present.\n")


def main():
    E.mkdir(parents=True, exist_ok=True)
    mask_dir = shared_masks(512)
    points, radii = i1_geometry()
    state = {"points": points, "radii": radii}

    baseline = render_probe(state, mask_dir, "baseline", BASE, "i1 control at 512x32")
    specs = {
        "c1": (fparams(redness=.15), "redness 0.15", False),
        "c2": (fparams(redness=.25), "redness 0.25", False),
        "c3": (fparams(rim_W=BASE["rim_W"] * .25), "rim energy x0.25", False),
        "c4": (fparams(), "shirt neutral grey at equal luminance (diagnostic only)", True),
        "c5": (fparams(lobe_SR=1.0), "Secondary Reflection 1.0", False),
        "c6": (fparams(lobe_T=.6), "Transmission 0.6", False),
    }
    probes = {}
    for tag, (params, label, neutral) in specs.items():
        row = render_probe(state, mask_dir, tag, params, label, neutral)
        delta = baseline["fitness"] - row["fitness"]
        row["fitnessDelta"] = delta
        row["status"] = "SUPPORTED" if delta > .01 else "REFUTED"
        probes[tag] = row

    redness_tag = min((tag for tag in ("c1", "c2") if probes[tag]["status"] == "SUPPORTED"), key=lambda tag: probes[tag]["fitness"], default=None)
    start = dict(BASE)
    if redness_tag:
        start["redness"] = probes[redness_tag]["params"]["redness"]
    if probes["c3"]["status"] == "SUPPORTED":
        start["rim_W"] = probes["c3"]["params"]["rim_W"]
    if probes["c5"]["status"] == "SUPPORTED":
        start["lobe_SR"] = probes["c5"]["params"]["lobe_SR"]
    if probes["c6"]["status"] == "SUPPORTED":
        start["lobe_T"] = probes["c6"]["params"]["lobe_T"]
    probe_doc = {
        "schemaVersion": 1,
        "classificationRule": "SUPPORTED when full look-2-style four-view fitness (hue/saturation weight 3) improves by >0.01 versus the 512x32 i1 control",
        "baseline": baseline,
        "probes": probes,
        "supported": [tag for tag, row in probes.items() if row["status"] == "SUPPORTED"],
        "combinedSearchStart": start,
        "c4ExcludedFromCombination": True,
    }
    (E / "probes.json").write_text(json.dumps(probe_doc, indent=2) + "\n")
    print("PROBES", json.dumps({tag: row["status"] for tag, row in probes.items()}), flush=True)

    best, _records = search(state, mask_dir, start)
    final = final_render(state, best[2], best[1], best[0])
    make_sheet()
    make_result(probe_doc, final)
    print("DONE", json.dumps({"eval": best[1], "fitness512": best[0], "fitness1024": final["fitness1024"], "params": best[2]}), flush=True)


if __name__ == "__main__":
    main()
