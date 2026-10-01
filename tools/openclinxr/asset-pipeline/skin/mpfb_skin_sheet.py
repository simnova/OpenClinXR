"""Keeper UV skin sheets for MPFB subjects.

materialize_mpfb_humanoid_candidate calls skin_sheet_for_subject for every
humanoid. A directory sheets/<subject_id>/ with albedo, normal, roughness,
and cavity means that subject ships the sheet. No directory means None, and
the procedural enhanced_skin bake is unchanged.

The albedo file is the unwrapped body map. It is not the quad sheet, whose
top-left cell is a pore tile.

Blender 5.1.1 export of this wiring (plane probe, 2026-10-01) keeps cavity:
occlusionTexture and metallicRoughnessTexture share one image,
R=cavity, G=roughness, B=255, metallicFactor 0.
"""

from __future__ import annotations

import hashlib
import io
import json
import struct
import sys
from pathlib import Path

STATION_DIR = Path(__file__).resolve().parent / "sheets"

# materialize's subject_id for the peds parent is peds_anxious_parent
# (shipped material mpfb_skin_peds_anxious_parent). The case actor id is
# parent_tara_johnson_v1. One sheet serves both names.
_ALIASES = {
    "parent_tara_johnson_v1": "peds_anxious_parent",
    "mpfb_parent_tara_johnson_v1": "peds_anxious_parent",
    "mpfb-peds-parent-aisha": "peds_anxious_parent",
}

_FILES = {
    "albedo": "albedo.png",
    "normal": "normal.png",
    "roughness": "roughness.png",
    "cavity": "cavity.png",
}

SKIN_MATERIAL_NAMES = (
    "mpfb_skin_peds_anxious_parent",
    "mpfb_skin_parent_tara_johnson_v1",
)
TEETH_MESH = "openclinxr_fitted_teeth_mpfb_parent_tara_johnson_v1_mesh"
TEETH_VERTS = 4494
TEETH_TARGETS = ("viseme_aa", "viseme_PP")


def skin_sheet_for_subject(subject_id: str | None) -> dict | None:
    """Return the four sheet paths for this subject, or None when absent."""
    if not subject_id:
        return None
    key = _ALIASES.get(subject_id, subject_id)
    folder = STATION_DIR / key
    paths = {role: folder / name for role, name in _FILES.items()}
    if not all(path.is_file() for path in paths.values()):
        return None
    return {"subjectId": key, **paths}


def load_skin_sheet_images(sheet: dict):
    """Load the four maps as Blender images. Called from materialize."""
    import bpy

    def load(path: Path, name: str, colorspace: str):
        image = bpy.data.images.load(str(path), check_existing=False)
        image.name = name
        try:
            image.colorspace_settings.name = colorspace
        except TypeError:
            pass
        return image

    return {
        "albedo": load(sheet["albedo"], "skin_sheet_albedo", "sRGB"),
        "normal": load(sheet["normal"], "skin_sheet_normal", "Non-Color"),
        "roughness": load(sheet["roughness"], "skin_sheet_roughness", "Non-Color"),
        "cavity": load(sheet["cavity"], "skin_sheet_cavity", "Non-Color"),
    }


def wire_skin_sheet_channels(material, roughness_image, cavity_image) -> dict:
    """Link roughness and cavity onto the export Principled material.

    Base Color and the normal map are already linked by materialize.
    Cavity goes to the glTF Material Output Occlusion socket. The 5.1.1
    exporter keeps that socket as occlusionTexture and packs it with
    roughness into one image.
    """
    import bpy

    tree = material.node_tree
    bsdf = next(node for node in tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    rough_node = tree.nodes.new("ShaderNodeTexImage")
    rough_node.name = "SkinSheetRoughness"
    rough_node.image = roughness_image
    tree.links.new(rough_node.outputs["Color"], bsdf.inputs["Roughness"])

    cavity_node = tree.nodes.new("ShaderNodeTexImage")
    cavity_node.name = "SkinSheetCavity"
    cavity_node.image = cavity_image
    group = _gltf_occlusion_group()
    group_node = tree.nodes.new("ShaderNodeGroup")
    group_node.name = "SkinSheetGlTFOutput"
    group_node.node_tree = group
    tree.links.new(cavity_node.outputs["Color"], group_node.inputs["Occlusion"])
    return {
        "roughnessWired": True,
        "cavityWired": True,
        "cavitySocket": "glTF Material Output.Occlusion",
        "exporterKeepsCavity": True,
        "packing": "occlusionTexture shares metallicRoughnessTexture; R=cavity G=roughness B=255; metallicFactor 0",
    }


def _gltf_occlusion_group():
    import bpy

    for group in bpy.data.node_groups:
        name = group.name.lower()
        if not (name.startswith("gltf material output") or name.startswith("gltf settings")):
            continue
        sockets = [sock.name for sock in group.interface.items_tree if hasattr(sock, "name")]
        if "Occlusion" in sockets:
            return group
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket("Occlusion", socket_type="NodeSocketFloat")
    group.nodes.new("NodeGroupOutput")
    group_input = group.nodes.new("NodeGroupInput")
    group_input.location = (-200, 0)
    return group


def pack_cavity_roughness_png(cavity_path: Path, roughness_path: Path) -> bytes:
    """ORM image the Blender 5.1.1 exporter writes for this wiring."""
    import numpy as np
    from PIL import Image

    cavity = np.array(Image.open(cavity_path).convert("RGB"))
    roughness = np.array(Image.open(roughness_path).convert("RGB"))
    if cavity.shape != roughness.shape:
        raise RuntimeError(f"sheet size mismatch {cavity.shape} vs {roughness.shape}")
    packed = np.zeros_like(cavity)
    packed[..., 0] = cavity[..., 0]
    packed[..., 1] = roughness[..., 1]
    packed[..., 2] = 255
    buffer = io.BytesIO()
    Image.fromarray(packed, "RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def _read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise RuntimeError(f"{path} is not a GLB")
    offset = 12
    document = None
    binary = None
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<I4s", data, offset)
        offset += 8
        chunk = data[offset : offset + length]
        offset += length
        if chunk_type == b"JSON":
            document = json.loads(chunk)
        elif chunk_type == b"BIN\x00":
            binary = chunk
    if document is None or binary is None:
        raise RuntimeError(f"{path} is missing a JSON or BIN chunk")
    return document, binary


def _pack_glb(document: dict, binary: bytes) -> bytes:
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((4 - len(payload) % 4) % 4)
    binary = binary + b"\x00" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(payload) + 8 + len(binary)
    return b"".join(
        (
            struct.pack("<4sII", b"glTF", 2, total),
            struct.pack("<I4s", len(payload), b"JSON"),
            payload,
            struct.pack("<I4s", len(binary), b"BIN\x00"),
            binary,
        )
    )


def _view_bytes(views: list, binary: bytes, index: int) -> bytes:
    view = views[index]
    start = view.get("byteOffset", 0)
    return binary[start : start + view["byteLength"]]


def _teeth_report(document: dict, binary: bytes) -> dict:
    mesh = next(item for item in document["meshes"] if item.get("name") == TEETH_MESH)
    primitive = mesh["primitives"][0]
    names = (mesh.get("extras") or {}).get("targetNames") or []
    position = document["accessors"][primitive["attributes"]["POSITION"]]
    target_hashes = []
    for target in primitive.get("targets") or []:
        accessor = document["accessors"][target["POSITION"]]
        view = document["bufferViews"][accessor["bufferView"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        # POSITION morphs are tightly packed float32 vec3 in their own view.
        target_hashes.append(hashlib.sha256(binary[start : start + view["byteLength"]]).hexdigest())
    position_view = document["bufferViews"][position["bufferView"]]
    position_start = position_view.get("byteOffset", 0) + position.get("byteOffset", 0)
    return {
        "vertexCount": position["count"],
        "targetNames": list(names),
        "positionSha256": hashlib.sha256(
            binary[position_start : position_start + position_view["byteLength"]]
        ).hexdigest(),
        "targetSha256": target_hashes,
    }


def apply_skin_sheet_to_glb(glb_path: Path, subject_id: str) -> dict:
    """Replace the skin images on an existing GLB. Mesh buffer views are copied.

    A full materialize re-bakes the body and drops the fitted-teeth viseme
    targets. This path only rewrites image bytes and the skin material slots.
    """
    sheet = skin_sheet_for_subject(subject_id)
    if sheet is None:
        raise RuntimeError(f"no skin sheet for {subject_id}")
    document, binary = _read_glb(glb_path)
    before = _teeth_report(document, binary)
    if before["vertexCount"] != TEETH_VERTS:
        raise RuntimeError(f"teeth vertex count {before['vertexCount']} != {TEETH_VERTS}")
    for name in TEETH_TARGETS:
        if name not in before["targetNames"]:
            raise RuntimeError(f"teeth mesh missing {name}")

    views = document["bufferViews"]
    uncovered = bytearray(len(binary))
    for view in views:
        start = view.get("byteOffset", 0)
        uncovered[start : start + view["byteLength"]] = b"\x01" * view["byteLength"]
    stray = [index for index, flag in enumerate(uncovered) if flag == 0 and binary[index] != 0]
    if stray:
        raise RuntimeError(f"GLB has {len(stray)} non-zero bytes outside buffer views")

    material = next(
        (item for item in document["materials"] if item.get("name") in SKIN_MATERIAL_NAMES),
        None,
    )
    if material is None:
        names = [item.get("name") for item in document["materials"]]
        raise RuntimeError(f"skin material not in {names}")
    pbr = material.setdefault("pbrMetallicRoughness", {})
    base_tex = pbr.get("baseColorTexture", {}).get("index")
    normal_tex = (material.get("normalTexture") or {}).get("index")
    if base_tex is None or normal_tex is None:
        raise RuntimeError(f"skin material {material.get('name')} has no base color or normal texture")
    albedo_image = document["textures"][base_tex]["source"]
    normal_image = document["textures"][normal_tex]["source"]
    albedo_view = document["images"][albedo_image]["bufferView"]
    normal_view = document["images"][normal_image]["bufferView"]

    albedo_bytes = Path(sheet["albedo"]).read_bytes()
    normal_bytes = Path(sheet["normal"]).read_bytes()
    orm_bytes = pack_cavity_roughness_png(Path(sheet["cavity"]), Path(sheet["roughness"]))
    replacements = {albedo_view: albedo_bytes, normal_view: normal_bytes}

    order = sorted(range(len(views)), key=lambda index: views[index].get("byteOffset", 0))
    rebuilt = bytearray()
    payloads_before = {index: _view_bytes(views, binary, index) for index in order}
    for index in order:
        while len(rebuilt) % 4:
            rebuilt.append(0)
        views[index]["byteOffset"] = len(rebuilt)
        payload = replacements.get(index, payloads_before[index])
        views[index]["byteLength"] = len(payload)
        rebuilt += payload
    while len(rebuilt) % 4:
        rebuilt.append(0)
    orm_offset = len(rebuilt)
    rebuilt += orm_bytes
    document["buffers"][0]["byteLength"] = len(rebuilt)

    orm_view = len(views)
    views.append({"buffer": 0, "byteOffset": orm_offset, "byteLength": len(orm_bytes)})
    orm_image = len(document["images"])
    document["images"].append(
        {
            "bufferView": orm_view,
            "mimeType": "image/png",
            "name": "skin-sheet-cavity-roughness",
        }
    )
    document["images"][albedo_image]["name"] = "skin-sheet-albedo"
    document["images"][normal_image]["name"] = "skin-sheet-normal"
    orm_texture = len(document["textures"])
    sampler = document["textures"][base_tex].get("sampler", 0)
    document["textures"].append({"sampler": sampler, "source": orm_image})
    pbr["metallicFactor"] = 0
    pbr.pop("roughnessFactor", None)
    pbr["metallicRoughnessTexture"] = {"index": orm_texture}
    material["occlusionTexture"] = {"index": orm_texture}

    for index, payload in payloads_before.items():
        if index in replacements:
            continue
        if _view_bytes(views, rebuilt, index) != payload:
            raise RuntimeError(f"buffer view {index} changed during the skin image swap")

    packed = _pack_glb(document, bytes(rebuilt))
    tmp = glb_path.with_suffix(".glb.skin-sheet-tmp")
    tmp.write_bytes(packed)
    reread, reread_bin = _read_glb(tmp)
    after = _teeth_report(reread, reread_bin)
    if after["vertexCount"] != before["vertexCount"] or after["targetNames"] != before["targetNames"]:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"teeth targets changed {before} -> {after}")
    if after["positionSha256"] != before["positionSha256"] or after["targetSha256"] != before["targetSha256"]:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("teeth position or morph bytes changed")
    tmp.replace(glb_path)
    return {
        "glb": str(glb_path),
        "material": material["name"],
        "bytes": glb_path.stat().st_size,
        "sha256": hashlib.sha256(glb_path.read_bytes()).hexdigest(),
        "teeth": after,
        "occlusionTexture": orm_texture,
        "metallicRoughnessTexture": orm_texture,
        "exporterKeepsCavity": True,
    }


def _check() -> None:
    aisha = skin_sheet_for_subject("peds_anxious_parent")
    actor = skin_sheet_for_subject("parent_tara_johnson_v1")
    stem = skin_sheet_for_subject("mpfb-peds-parent-aisha")
    if aisha is None or actor is None or stem is None:
        raise SystemExit("Aisha sheet did not resolve")
    if aisha["subjectId"] != "peds_anxious_parent":
        raise SystemExit(aisha["subjectId"])
    if actor["albedo"] != aisha["albedo"] or stem["albedo"] != aisha["albedo"]:
        raise SystemExit("aliases did not share the Aisha sheet")
    for other in ("patient_aisha_khan_v1", "ed_chest_pain_nurse_adult", "peds_patient_child"):
        if skin_sheet_for_subject(other) is not None:
            raise SystemExit(f"{other} must not have a sheet")
    packed = pack_cavity_roughness_png(aisha["cavity"], aisha["roughness"])
    if packed[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("packed cavity/roughness is not a PNG")
    print("SKIN_SHEET_CHECK ok")


def main(argv: list[str]) -> None:
    if argv[:1] == ["--check"]:
        _check()
        return
    if argv[:1] == ["--apply"] and len(argv) == 3:
        report = apply_skin_sheet_to_glb(Path(argv[1]), argv[2])
        print("SKIN_SHEET_APPLIED " + json.dumps(report))
        return
    raise SystemExit("usage: mpfb_skin_sheet.py --check | --apply <glb> <subject_id>")


if __name__ == "__main__":
    main(sys.argv[1:])
