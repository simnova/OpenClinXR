#!/usr/bin/env python3
"""Look-3 copy of look-1's hair material, with an explicit model selector."""
from __future__ import annotations


LOBE_IDS = {
    "lobe_R": "R lobe",
    "lobe_T": "TT lobe",
    "lobe_SR": "TRT lobe",
}


def material(state, obj, params, model="CHIANG"):
    """Build the station material with CHIANG/HUANG selection and lobe controls."""
    light = state["station"].LIGHT if "station" in state else {}
    mat = state["canonical"].data.materials[0].copy()
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    hair = nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.model = model
    # Blender 5.1.1 accepts MELANIN for HUANG, preserving q1's pigment path.
    hair.parametrization = "MELANIN"
    links.new(hair.outputs[0], out.inputs["Surface"])
    mel = float(params.get("melanin", light.get("melanin", 0.8)))
    rough = float(params.get("roughness", light.get("roughness", 0.3)))
    redness = float(params.get("redness", light.get("redness", 0.5)))
    root_dark = float(params.get("root_dark", light.get("root_dark", 0.0)))
    by_identifier = {socket.identifier: socket for socket in hair.inputs}
    by_identifier["Melanin Redness"].default_value = redness
    # Retained from the q1 station. This socket is disabled by HUANG but the
    # write is preserved for an exact model-only comparison.
    by_identifier["Radial Roughness"].default_value = 0.2
    info = nodes.new("ShaderNodeHairInfo")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (min(1.0, mel * (1.0 + root_dark)),) * 3 + (1.0,)
    ramp.color_ramp.elements[1].position = 0.075
    ramp.color_ramp.elements[1].color = (mel, mel, mel, 1.0)
    links.new(info.outputs["Intercept"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], by_identifier["Melanin"])
    by_identifier["Roughness"].default_value = rough
    wanted = {identifier: float(params[key]) for key, identifier in LOBE_IDS.items() if key in params}
    for socket in hair.inputs:
        if socket.identifier in wanted:
            socket.default_value = wanted[socket.identifier]
    return mat
