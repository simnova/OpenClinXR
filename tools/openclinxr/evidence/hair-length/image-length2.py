"""Hair-length evidence driver over the persistent hair-search scene."""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import shutil
import sys
import traceback

import bpy
import numpy as np
from PIL import Image, ImageDraw
from mathutils import Vector
from mathutils.kdtree import KDTree


ROOT = os.getcwd()
HERE = os.path.join(ROOT, "tools/openclinxr/evidence/hair-length")
SEARCH_PATH = os.path.join(ROOT, "tools/openclinxr/evidence/hair-search/search.py")
BEST_PATH = os.path.join(ROOT, "tools/openclinxr/evidence/hair-search/best.json")
MULTIPLES = (1.0, 1.3, 1.5, 1.7)


def load_search():
    spec = importlib.util.spec_from_file_location("hair_search_length2", SEARCH_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.OUT = HERE
    return module


def surface_index(state):
    """Visible head/torso/garment mesh vertices and outward normals in world space."""
    deps = bpy.context.evaluated_depsgraph_get()
    entries = []
    for obj in state["scene"].objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        lowered = obj.name.lower()
        is_garment = any(token in lowered for token in
                         ("shirt", "sweater", "top", "dress", "jacket", "coat", "hoodie"))
        if obj is not state["head"] and not is_garment:
            continue
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            normal_matrix = evaluated.matrix_world.to_3x3().inverted().transposed()
            for vertex in mesh.vertices:
                entries.append((evaluated.matrix_world @ vertex.co,
                                (normal_matrix @ vertex.normal).normalized()))
        finally:
            evaluated.to_mesh_clear()
    if not entries:
        raise RuntimeError("no visible head/torso/garment surface vertices")
    tree = KDTree(len(entries))
    for index, (co, _normal) in enumerate(entries):
        tree.insert(co, index)
    tree.balance()
    return tree, entries


def strand_geometry_metrics(state, surface):
    """Signed nearest-vertex penetration and lower-lock connectivity."""
    tree, entries = surface
    deps = bpy.context.evaluated_depsgraph_get()
    hair = state["hair"].evaluated_get(deps)
    matrix = hair.matrix_world
    penetration = 0.0
    penetration_after_5mm = 0.0
    endpoints = []
    chin_z = float(state["chinWorld"].z)
    for curve in hair.data.curves:
        points = [matrix @ point.position for point in curve.points]
        if not points:
            continue
        arc = 0.0
        previous = points[0]
        for index, point in enumerate(points):
            if index:
                arc += (point - previous).length
            previous = point
            nearest, vertex_index, _distance = tree.find(point)
            normal = entries[vertex_index][1]
            depth = max(0.0, -float((point - nearest).dot(normal)))
            penetration = max(penetration, depth)
            if arc >= 0.005:
                penetration_after_5mm = max(penetration_after_5mm, depth)
        if points[-1].z < chin_z:
            endpoints.append(points[-1])

    # Count connected lower endpoint groups in the horizontal head frame.
    # A 25 mm link radius treats the four duplicate hairs around one guide as
    # one lock while preserving visibly separated terminal groups.
    locks = 0
    if endpoints:
        # Occupied 12.5 mm cells with 8-neighbour connectivity implement the
        # same 25 mm grouping without a quadratic endpoint comparison.
        cell_size = 0.0125
        pending = {(math.floor(point.x/cell_size), math.floor(point.y/cell_size))
                   for point in endpoints}
        while pending:
            locks += 1
            stack = [pending.pop()]
            while stack:
                x, y = stack.pop()
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        neighbour = (x+dx, y+dy)
                        if neighbour in pending:
                            pending.remove(neighbour)
                            stack.append(neighbour)
    return {
        "penetrationM": penetration,
        "penetrationExcludingFirst5mmM": penetration_after_5mm,
        "locksSplit": locks,
        "lowerEndpointCount": len(endpoints),
        "penetrationMethod": "signed nearest visible-mesh vertex normal",
        "locksSplitMethod": "connected lower endpoint occupancy, 12.5mm XY cells",
    }


def cell_passes(cell, control_penetration):
    metrics = cell["metrics"]
    return bool(
        0.46 <= metrics["lengthBelowChinFrac"] <= 0.56
        and cell["locksSplit"] <= 3
        and metrics["p50"] <= 0.12
        and metrics["p10"] >= 0.025
        and 0.55 <= metrics["face"] <= 0.70
        and cell["strandsAfter"] == 50265
        and metrics["meanRBSpread"] < 0.20
        and metrics["maskPx"] >= 100000
        and cell["penetrationM"] <= control_penetration + 0.001
    )


def reproduction_differences(cell):
    metrics = cell["metrics"]
    checks = {
        "p50": (metrics["p50"], 0.077, 0.01),
        "p10": (metrics["p10"], 0.034, 0.01),
        "lengthBelowChinFrac": (metrics["lengthBelowChinFrac"], 0.269, 0.02),
        "face": (metrics["face"], 0.649, 0.02),
        "strandsAfter": (cell["strandsAfter"], 50265, 0),
    }
    return {name: {"actual": actual, "expected": expected, "tolerance": tolerance}
            for name, (actual, expected, tolerance) in checks.items()
            if (actual != expected if tolerance == 0 else abs(actual-expected) > tolerance)}


def render_side(search, state, params, path):
    search.configure_candidate(state, params)
    scene = state["scene"]
    camera = scene.camera
    target = Vector(state["lightTarget"])
    original_location = camera.location.copy()
    original_rotation = camera.rotation_euler.copy()
    offset = original_location - target
    camera.location = target + Vector((-offset.y, offset.x, offset.z))
    search.SHARED.track_cam(camera, target)
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.cycles.samples = 64
    scene.render.filepath = path
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)
    camera.location = original_location
    camera.rotation_euler = original_rotation


def make_overlay(beauty_path, id_path, out_path):
    beauty = np.asarray(Image.open(beauty_path).convert("RGB"), dtype=np.float64)
    alpha = np.asarray(Image.open(id_path).convert("RGBA"), dtype=np.float64)[..., 3] / 255.0
    mask = alpha >= 0.9
    result = beauty.copy()
    tint = np.zeros_like(result)
    tint[..., 0] = 255
    result[mask] = 0.45 * result[mask] + 0.55 * tint[mask]
    Image.fromarray(np.uint8(np.clip(result, 0, 255))).save(out_path, compress_level=1)


def make_sweep(cells, out_path):
    sheet = Image.new("RGB", (512 * len(cells), 512), (20, 20, 20))
    for index, cell in enumerate(cells):
        panel = Image.open(cell["beautyPath"]).convert("RGB").resize(
            (512, 512), Image.Resampling.LANCZOS)
        draw = ImageDraw.Draw(panel)
        draw.rectangle((0, 0, 511, 82), fill=(12, 12, 12))
        metrics = cell["metrics"]
        lines = (
            "length %.1fx  below-chin %.3f" % (cell["lengthMultiple"], metrics["lengthBelowChinFrac"]),
            "p10/p50/p90 %.3f / %.3f / %.3f" % (metrics["p10"], metrics["p50"], metrics["p90"]),
            "R/B %.3f  penetration %.2f mm" % (metrics["rb"], 1000*cell["penetrationM"]),
            "locksSplit %d  pass %s" % (cell["locksSplit"], cell["passesBars"]),
        )
        for line_index, line in enumerate(lines):
            draw.text((7, 5 + 19*line_index), line,
                      fill=(80, 255, 80) if cell["passesBars"] else (255, 220, 80))
        sheet.paste(panel, (512*index, 0))
    sheet.save(out_path, compress_level=1)


def write_row(row):
    with open(os.path.join(HERE, "row-length2.json"), "w", encoding="utf-8") as handle:
        json.dump(row, handle, indent=2, sort_keys=True)


def main():
    global HERE
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default=HERE)
    argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)
    HERE = os.path.abspath(args.out_dir)
    os.makedirs(HERE, exist_ok=True)
    row = {"ok": False, "stage": "setup", "cells": []}
    try:
        search = load_search()
        with open(BEST_PATH, encoding="utf-8") as handle:
            best = json.load(handle)
        params = dict(best["params"])
        state = search.build_scene()
        surface = surface_index(state)
        light_count = sum(obj.type == "LIGHT" for obj in state["scene"].objects)
        row.update({
            "blenderVersion": bpy.app.version_string,
            "lightCount": light_count,
            "requestedMultiples": list(MULTIPLES),
            "params": params,
            "sourceBest": "tools/openclinxr/evidence/hair-search/best.json",
            "stage": "control",
        })
        for index, multiple in enumerate(MULTIPLES):
            request_params = dict(params, length=multiple)
            result = search.evaluate(state, {
                "index": index, "size": 1024, "samples": 64,
                "stem": "length2-%.1fx" % multiple, "params": request_params,
            })
            geometry = strand_geometry_metrics(state, surface)
            cell = {
                "lengthMultiple": multiple,
                "lengthReadBack": result["lengthReadBack"],
                "trimReadBack": result["trimReadBack"],
                "strandsAfter": result["strandsAfter"],
                "repairedGuides": result["repairedGuides"],
                "metrics": result["metrics"],
                "beautyPng": os.path.basename(result["beautyPath"]),
                "idPng": os.path.basename(result["idPath"]),
                "beautyPath": result["beautyPath"],
                "idPath": result["idPath"],
                **geometry,
            }
            row["cells"].append(cell)
            if index == 0:
                differences = reproduction_differences(cell)
                row["reproductionGate"] = {"ok": not differences, "differences": differences}
                row["controlPenetrationM"] = cell["penetrationM"]
                row["controlPenetrationExcludingFirst5mmM"] = cell["penetrationExcludingFirst5mmM"]
                if differences:
                    row.update({"stage": "reproduction-gate", "error":
                                "reproduction gate failed: " + json.dumps(differences, sort_keys=True)})
                    write_row(row)
                    print(row["error"])
                    return
            cell["passesBars"] = cell_passes(cell, row["controlPenetrationM"])

        passing = [cell for cell in row["cells"] if cell["passesBars"]]
        selected = min(passing, key=lambda cell: cell["lengthMultiple"]) if passing else None
        diagnostic = selected or min(
            row["cells"],
            key=lambda cell: abs(cell["metrics"]["lengthBelowChinFrac"] - 0.51))
        make_sweep(row["cells"], os.path.join(HERE, "sweep-length2.png"))
        shutil.copyfile(diagnostic["beautyPath"], os.path.join(HERE, "front-length2.png"))
        make_overlay(diagnostic["beautyPath"], diagnostic["idPath"],
                     os.path.join(HERE, "mask-overlay-length2.png"))
        render_side(search, state, dict(params, length=diagnostic["lengthMultiple"]),
                    os.path.join(HERE, "side-length2.png"))
        for cell in row["cells"]:
            cell["beautyPath"] = cell["beautyPng"]
            cell["idPath"] = cell["idPng"]
        row.update({
            "ok": selected is not None,
            "stage": "complete" if selected is not None else "selection",
            "selectedMultiple": selected["lengthMultiple"] if selected else None,
            "selected": selected,
            "diagnosticMultiple": diagnostic["lengthMultiple"],
            "diagnosticReason": (None if selected else
                                 "no passing cell; closest to centre of length band"),
            "error": "" if selected else "no length multiple passes all bars",
            "front": "front-length2.png",
            "side": "side-length2.png",
            "maskOverlay": "mask-overlay-length2.png",
            "sweep": "sweep-length2.png",
        })
        write_row(row)
    except Exception:
        row.update({
            "ok": False,
            "error": traceback.format_exc(),
            "lightCount": sum(obj.type == "LIGHT" for obj in bpy.context.scene.objects),
        })
        write_row(row)
        print(row["error"])


if __name__ == "__main__":
    main()
