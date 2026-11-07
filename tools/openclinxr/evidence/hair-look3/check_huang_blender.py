#!/usr/bin/env python3
"""Record Blender 5.1 Principled Hair model/parametrization availability."""
from __future__ import annotations

import json
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent


def sockets(node):
    return [
        {
            "name": sock.name,
            "identifier": sock.identifier,
            "enabled": bool(sock.enabled),
            "default": list(sock.default_value)
            if hasattr(sock.default_value, "__len__") and not isinstance(sock.default_value, str)
            else sock.default_value,
        }
        for sock in node.inputs
    ]


node = bpy.data.materials.new("huang_check").node_tree.nodes.new("ShaderNodeBsdfHairPrincipled")
models = [item.identifier for item in node.bl_rna.properties["model"].enum_items]
params = [item.identifier for item in node.bl_rna.properties["parametrization"].enum_items]
out = {"blender": bpy.app.version_string, "models": models, "parametrizations": params, "states": {}}
for model in models:
    node.model = model
    out["states"][model] = {}
    for param in params:
        try:
            node.parametrization = param
            out["states"][model][param] = {
                "accepted": node.parametrization == param,
                "enabledInputs": [s["name"] for s in sockets(node) if s["enabled"]],
                "sockets": sockets(node),
            }
        except Exception as exc:
            out["states"][model][param] = {"accepted": False, "error": str(exc)}
(HERE / "huang-rna.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(out, indent=2), flush=True)
