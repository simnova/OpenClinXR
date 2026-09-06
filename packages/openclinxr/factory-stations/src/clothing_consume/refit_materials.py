#!/usr/bin/env python3
"""Authored material assignment for the clothing_consume refit baker.

EXPAND, not a new station: fit_stage.py hardcoded Display colours (teal garment,
bluish skin) and discarded the garment's authored material. The generic .mhmat
machinery (parse_mhmat / mhmat_for_mhclo / make_material_from_mhmat) exists only
in the evidence rail (materialize_mpfb_humanoid_candidate.py, Blender-bound and
unimportable here) — this module ports the scoped subset the refit path needs.

Authored-first: garment .mhclo `material <rel>` -> .mhmat `diffuseColor` (factor)
+ `diffuseTexture` (Base Color image, resolved beside the .mhmat). Skin colour
per phenotype `skin_tone` (same authored map as the materializer rail). A mesh
whose source is verifiably absent (.mhmat not staged, texture missing on disk,
no UV layer, skin_tone absent/unknown) keeps the legacy Display fallback AND a
recorded reason — never silent. Same garment + body -> same materials (no
randomness, no wall-clock, fixed read order).

Pure-python decision half (parse/describe) imports without bpy for tests;
Blender assignment half requires bpy.
"""

from __future__ import annotations

import re
from pathlib import Path

try:
    import bpy  # type: ignore
except ImportError:  # plain-python test harness
    bpy = None  # type: ignore

# Authored skin map — same values as SKIN_TONE_RGB in the materializer rail
# (tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py:180).
SKIN_TONE_RGBA = {
    "warm_light_child": (0.84, 0.70, 0.60, 1.0),
    "warm_light": (0.78, 0.62, 0.52, 1.0),
    "warm_medium": (0.66, 0.50, 0.40, 1.0),
    "medium_warm": (0.58, 0.44, 0.36, 1.0),
    "default": (0.68, 0.53, 0.44, 1.0),
}

# Legacy Display fallbacks — the exact colours fit_stage.py hardcoded before
# this module, so absent-input output is byte-comparable to legacy behaviour.
FALLBACK_GARMENT_RGBA = (0.12, 0.48, 0.52, 1.0)
FALLBACK_SKIN_RGBA = (0.55, 0.62, 0.78, 1.0)


def parse_mhmat(path) -> dict:
    """Parse a MakeHuman .mhmat key-value material file.

    `diffuseTexture` is a FILE PATH and authors use spaces, so its value is the
    whole remainder of the line (stripped); all other keys keep token-split
    lists. Mirrors the #740 fix in the materializer rail.
    """
    props: dict = {}
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        parts = re.split(r"\s+", t, maxsplit=1)
        if len(parts) < 2:
            continue
        if parts[0] == "diffuseTexture":
            props[parts[0]] = [parts[1].strip()]
        else:
            props[parts[0]] = parts[1].split()
    return props


def mhmat_for_mhclo(mhclo_path) -> Path:
    """Resolve a .mhclo's declared `material <rel>` line to a real .mhmat path.

    Declared path first, flat provider-cache layout (asset files staged beside
    the .mhclo) as fallback. Raises RuntimeError when neither resolves —
    callers record it, never invent a material.
    """
    mhclo_path = Path(mhclo_path)
    declared = None
    for line in mhclo_path.read_text(encoding="utf-8", errors="replace").splitlines():
        t = line.strip()
        if t.startswith("material "):
            declared = (mhclo_path.parent / t.split(None, 1)[1].strip()).resolve()
            break
    if declared is not None and declared.is_file():
        return declared
    if declared is not None:
        flat = mhclo_path.parent / declared.name
        if flat.is_file():
            return flat
    raise RuntimeError(f"no .mhmat found for {mhclo_path} (declared {declared})")


def describe_garment_material_source(mhclo_path_str: str, has_uv_layer: bool) -> dict:
    """Pure-python authored-vs-fallback decision for a garment. No bpy.

    Returns a record with source "authored" only when the full chain resolves
    (.mhmat staged + diffuseTexture declared + texture on disk + UV layer);
    otherwise source "fallback" with the verifiable reason. Deterministic:
    same files -> same record.
    """
    record: dict = {
        "declaredMhmat": None,
        "mhmatStaged": False,
        "declaredDiffuseTexture": None,
        "textureResolves": False,
        "textureBytes": 0,
        "meshUvLayer": bool(has_uv_layer),
        "source": "fallback",
        "reason": None,
    }
    try:
        mhmat_path = mhmat_for_mhclo(mhclo_path_str)
    except (RuntimeError, OSError) as exc:
        record["reason"] = f"declared .mhmat not staged: {exc}"
        return record
    record["mhmatStaged"] = True
    record["declaredMhmat"] = mhmat_path.name
    try:
        props = parse_mhmat(mhmat_path)
    except OSError as exc:
        record["reason"] = f".mhmat unreadable: {exc}"
        return record
    diffuse = props.get("diffuseTexture")
    if not diffuse:
        record["reason"] = f"{mhmat_path.name} declares no diffuseTexture"
        return record
    tex_path = (mhmat_path.parent / Path(diffuse[0])).resolve()
    record["declaredDiffuseTexture"] = Path(diffuse[0]).name
    if not tex_path.is_file():
        record["reason"] = f"declared diffuseTexture {diffuse[0]} missing on disk at {tex_path}"
        return record
    record["textureResolves"] = True
    record["textureBytes"] = tex_path.stat().st_size
    if not has_uv_layer:
        record["reason"] = "mesh has no UV layer — a texture would render as garbage"
        return record
    record["source"] = "authored"
    return record


def describe_skin_material_source(skin_tone: str) -> dict:
    """Pure-python authored-vs-fallback decision for skin. No bpy."""
    tone = (skin_tone or "").strip().lower()
    if tone in SKIN_TONE_RGBA:
        return {
            "source": "phenotype",
            "skinTone": tone,
            "factor": list(SKIN_TONE_RGBA[tone]),
            "reason": None,
        }
    return {
        "source": "fallback",
        "skinTone": tone or None,
        "factor": list(FALLBACK_SKIN_RGBA),
        "reason": "skin_tone absent or unknown — using legacy Display colour",
    }


def make_display_material(name: str, rgba) -> object:
    """Flat Principled material with viewport colour set (grade render reads it)."""
    assert bpy is not None, "make_display_material requires Blender bpy"
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    principled = mat.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = tuple(rgba)
    principled.inputs["Roughness"].default_value = 0.65
    mat.diffuse_color = tuple(rgba)
    try:
        mat.viewport_display.color = tuple(rgba)[:3]
    except Exception:  # noqa: BLE001
        pass
    return mat


def make_material_from_mhmat(mhmat_path, name: str) -> object:
    """Authored Principled material: diffuseTexture -> Base Color image,
    diffuseColor -> factor. OPAQUE blend (an RGBA texture alpha is a MakeHuman
    shader input, not a cutout mask)."""
    assert bpy is not None, "make_material_from_mhmat requires Blender bpy"
    props = parse_mhmat(mhmat_path)
    color = props.get("diffuseColor") or ["1.0", "1.0", "1.0"]
    try:
        factor = [float(color[0]), float(color[1]), float(color[2]), 1.0]
    except (IndexError, ValueError):
        factor = [1.0, 1.0, 1.0, 1.0]
    diffuse = props.get("diffuseTexture")
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = factor
    bsdf.inputs["Roughness"].default_value = 0.65
    if diffuse:
        tex_path = (Path(mhmat_path).parent / Path(diffuse[0])).resolve()
        img = bpy.data.images.load(str(tex_path), check_existing=True)
        tex_node = material.node_tree.nodes.new("ShaderNodeTexImage")
        tex_node.image = img
        material.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    material.diffuse_color = tuple(factor)
    try:
        material.viewport_display.color = tuple(factor)[:3]
    except Exception:  # noqa: BLE001
        pass
    return material


def assign_garment_material(garment, mhclo_path_str: str, material_name: str) -> dict:
    """Assign the garment's authored material or the recorded fallback."""
    has_uv = bool(garment.data.uv_layers)
    record = describe_garment_material_source(mhclo_path_str, has_uv)
    record["mesh"] = garment.name
    record["materialName"] = material_name
    garment.data.materials.clear()
    if record["source"] == "authored":
        mhmat_path = mhmat_for_mhclo(mhclo_path_str)
        garment.data.materials.append(make_material_from_mhmat(mhmat_path, material_name))
    else:
        garment.data.materials.append(make_display_material(material_name, FALLBACK_GARMENT_RGBA))
    return record


def assign_skin_material(body, skin_tone: str, material_name: str) -> dict:
    """Assign the phenotype skin material or the recorded fallback."""
    record = describe_skin_material_source(skin_tone)
    record["mesh"] = body.name
    record["materialName"] = material_name
    body.data.materials.clear()
    body.data.materials.append(make_display_material(material_name, tuple(record["factor"])))
    return record
