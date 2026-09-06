#!/usr/bin/env python3
"""
lighting-rig baker for the lighting_design factory station.

Reads a deterministic rig JSON (emitted by lighting_design/run.ts
designLightingRig) and materializes the rig lights in a Blender scene so the
placement can be verified headless. Writes a placement report JSON.

The room albedo bake (room_generate/room-albedo-ao-bake.py --rig-json) is the
wired consumer: its probe lights come from the rig instead of hardcoded
placement. ui-xr runtime key/fill consumption from the rig is follow-up work,
not wired here.

Deterministic: same rig JSON -> same lights, same report. No LLM in the path.
No Quest, animation, or clinical claims.

Usage (inside Blender headless):
  blender --background --python lighting-rig.py -- \\
    --rig-json <rig.json> --report <report.json> [--room-glb <room.glb>]

Exit 0 on success; non-zero with a printed error on any failure.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

RIG_SCHEMA_VERSION = "openclinxr.lighting-rig.v1"

# Comfortable indoor ranges (same order as the room distributed bake rig).
MAX_ENERGY = 500.0
MAX_SIZE_M = 4.0

RIG_TYPE_TO_BLENDER = {
    "point": "POINT",
    "area": "AREA",
    "directional": "SUN",
}


def _argv_after_double_dash() -> List[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def load_rig(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf8") as fh:
        rig = json.load(fh)
    if not isinstance(rig, dict):
        raise ValueError(f"rig JSON must be an object: {path}")
    if rig.get("schemaVersion") != RIG_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported rig schema {rig.get('schemaVersion')!r}, expected {RIG_SCHEMA_VERSION}"
        )
    lights = rig.get("lights")
    if not isinstance(lights, list) or len(lights) == 0:
        raise ValueError("rig has no lights")
    for light in lights:
        if not isinstance(light, dict):
            raise ValueError("rig light must be an object")
        if light.get("type") not in RIG_TYPE_TO_BLENDER:
            raise ValueError(f"unknown rig light type {light.get('type')!r}")
        pos = light.get("position")
        if (
            not isinstance(pos, list)
            or len(pos) != 3
            or not all(isinstance(v, (int, float)) for v in pos)
        ):
            raise ValueError(f"rig light {light.get('name')!r} has bad position")
        energy = light.get("energy")
        if not isinstance(energy, (int, float)) or not (0 < energy <= MAX_ENERGY):
            raise ValueError(
                f"rig light {light.get('name')!r} energy {energy!r} outside indoor range"
            )
        size = light.get("size", 0)
        if not isinstance(size, (int, float)) or not (0 <= size <= MAX_SIZE_M):
            raise ValueError(
                f"rig light {light.get('name')!r} size {size!r} outside indoor range"
            )
    return rig


def place_rig_lights(rig: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Create one Blender light per rig entry. Returns the placed records."""
    import bpy

    placed: List[Dict[str, Any]] = []
    for entry in rig["lights"]:
        blender_type = RIG_TYPE_TO_BLENDER[entry["type"]]
        name = f"openclinxr_lighting_rig_{entry['name']}"
        data = bpy.data.lights.new(name, type=blender_type)
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = tuple(entry["position"])
        target = entry.get("target")
        if target is not None and blender_type == "SUN":
            direction = (
                target[0] - entry["position"][0],
                target[1] - entry["position"][1],
                target[2] - entry["position"][2],
            )
            obj.rotation_euler = direction_to_euler(direction)
        if blender_type == "AREA":
            data.size = float(entry.get("size") or 0.1)
            data.size_y = float(entry.get("size") or 0.1)
        data.energy = float(entry["energy"])
        placed.append(
            {
                "name": entry["name"],
                "blenderName": name,
                "type": entry["type"],
                "position": list(entry["position"]),
                "energy": float(entry["energy"]),
                "colorTemperatureK": entry.get("colorTemperatureK"),
            }
        )
        print(
            f"[lighting-rig] placed {name} type={blender_type} "
            f"at={entry['position']} energy={entry['energy']}"
        )
    return placed


def direction_to_euler(direction) -> tuple:
    import math

    dx, dy, dz = direction
    yaw = math.atan2(dy, dx) - math.pi / 2.0
    horizontal = math.hypot(dx, dy)
    pitch = math.atan2(horizontal, -dz) if dz != 0 else 0.0
    return (pitch, 0.0, yaw)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rig-json", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--room-glb", default="")
    args = ap.parse_args(_argv_after_double_dash())

    if not os.path.exists(args.rig_json):
        raise SystemExit(f"rig JSON not found: {args.rig_json}")

    rig = load_rig(args.rig_json)

    import bpy

    if args.room_glb:
        if not os.path.exists(args.room_glb):
            raise SystemExit(f"room GLB not found: {args.room_glb}")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete()
        bpy.ops.import_scene.gltf(filepath=args.room_glb)

    placed = place_rig_lights(rig)

    report = {
        "schemaVersion": "openclinxr.lighting-rig-report.v1",
        "rigSchemaVersion": rig.get("schemaVersion"),
        "mood": rig.get("mood"),
        "seed": rig.get("seed"),
        "exposure": rig.get("exposure"),
        "bakePathLlm": False,
        "placedLights": placed,
        "notEvidenceFor": ["quest_readiness", "clinical_accuracy"],
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
    with open(args.report, "w", encoding="utf8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")
    print(f"[lighting-rig] report -> {args.report} ({len(placed)} light(s))")


if __name__ == "__main__":
    main()
