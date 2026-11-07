#!/usr/bin/env python3
"""Transplant the fitted library hair (mesh, material, textures) between two GLBs of one actor.

Shipped actor GLBs carry dozens of graded post-export stages (skin, eyes, brows, garments)
that a materializer re-bake would drop. Their hair is stale: an untextured flat material from
a bake older than hair texture wiring (hair-groom-2 DESIGN Phase 0a). This stage takes only
the hair from a fresh materializer bake of the same actor:

- geometry: `transplant_fitted_brow.transplant` with the library-hair mesh token, so joints
  are translated by skin-joint name and every other bufferView stays byte-identical;
- material: the bake's hair material replaces the shipped one at the same index;
- textures: each image the bake's hair material references is downscaled to
  `--max-texture` (Pillow LANCZOS, PNG, compress_level 9) and appended.

Alpha: the bake's alphaMode is kept unless --alpha-mode is given. `--alpha-mode MASK
--alpha-cutoff 0.2` is peds-parent-aisha's shipped hair setting; it removes the BLEND
sort-order strip along the crown part (lane handoff, t1024mask crops).

Colour is not set here. Run apply_actor_hair_colour.py afterwards: it tints textured hair
through baseColorFactor from the case-authored hair_color token.

Run with Blender's bundled Python, which has Pillow:
  PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules" \\
    /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 \\
    tools/openclinxr/asset-pipeline/makeclothes/transplant_library_hair.py \\
    --input <shipped.glb> --bake <fresh-bake.glb> --output <out.glb>

claimScope: hair primitive, hair material and its images replaced; all other bytes kept.
notEvidenceFor: hair realism, scalp fit, Quest texture budget.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import struct
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from transplant_fitted_brow import encode_glb, parse_glb, transplant, view_bytes  # noqa: E402

STAGE = "actor_hair_transplant_post_export_v1"
TOOL = "tools/openclinxr/asset-pipeline/makeclothes/transplant_library_hair.py"
HAIR_MESH_TOKEN = "makeclothes_library_hair_"
TEXTURE_SLOTS = (
    ("pbrMetallicRoughness", "baseColorTexture"),
    ("pbrMetallicRoughness", "metallicRoughnessTexture"),
    (None, "normalTexture"),
    (None, "occlusionTexture"),
    (None, "emissiveTexture"),
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def png_size(payload: bytes) -> tuple[int, int]:
    if payload[:8] != b"\x89PNG\r\n\x1a\n" or payload[12:16] != b"IHDR":
        raise RuntimeError("embedded image is not a PNG")
    width, height = struct.unpack(">II", payload[16:24])
    return width, height


def downscale_png(payload: bytes, max_size: int) -> tuple[bytes, dict[str, Any]]:
    size = png_size(payload)
    if max(size) <= max_size:
        # Pass-through: no decode, no re-encode, bytes identical to the bake.
        return payload, {
            "sizeBefore": list(size),
            "sizeAfter": list(size),
            "bytesBefore": len(payload),
            "bytesAfter": len(payload),
            "resampled": False,
        }

    from PIL import Image, __version__ as pillow_version

    image = Image.open(io.BytesIO(payload))
    image.load()
    before = image.size
    scale = max_size / max(before)
    target = (max(1, round(before[0] * scale)), max(1, round(before[1] * scale)))
    image = image.resize(target, Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="PNG", compress_level=9)
    data = out.getvalue()
    return data, {
        "sizeBefore": list(before),
        "sizeAfter": list(image.size),
        "mode": image.mode,
        "bytesBefore": len(payload),
        "bytesAfter": len(data),
        "resampled": True,
        "pillow": pillow_version,
    }


def hair_material_index(document: dict[str, Any]) -> int:
    hits = [
        (mesh_index, mesh)
        for mesh_index, mesh in enumerate(document.get("meshes", []))
        if HAIR_MESH_TOKEN in str(mesh.get("name", ""))
    ]
    if len(hits) != 1:
        raise RuntimeError(f"expected one library hair mesh, found {len(hits)}")
    material = int(hits[0][1]["primitives"][0]["material"])
    users = [
        mesh.get("name")
        for mesh in document.get("meshes", [])
        for primitive in mesh.get("primitives", [])
        if primitive.get("material") == material
    ]
    if len(users) != 1:
        raise RuntimeError(f"hair material {material} is shared by {users}")
    return material


def carry_material(
    output: dict[str, Any],
    binary: bytes,
    bake: dict[str, Any],
    bake_binary: bytes,
    max_texture: int,
    alpha_mode: str | None = None,
    alpha_cutoff: float | None = None,
) -> tuple[bytes, dict[str, Any]]:
    target_index = hair_material_index(output)
    source_index = hair_material_index(bake)
    shipped_material = output["materials"][target_index]
    material = copy.deepcopy(bake["materials"][source_index])
    if material.get("extensions"):
        raise RuntimeError(f"bake hair material has extensions {sorted(material['extensions'])}")

    parts = [binary]
    images: list[dict[str, Any]] = []
    for parent, slot in TEXTURE_SLOTS:
        holder = material.get(parent, {}) if parent else material
        ref = holder.get(slot)
        if ref is None:
            continue
        texture = bake["textures"][int(ref["index"])]
        image = bake["images"][int(texture["source"])]
        if image.get("mimeType") != "image/png" or "bufferView" not in image:
            raise RuntimeError(f"{slot}: expected an embedded PNG, got {image.get('mimeType')}")
        source_payload = view_bytes(bake, bake_binary, int(image["bufferView"]))
        payload, resize = downscale_png(source_payload, max_texture)

        offset = sum(len(part) for part in parts)
        padding = -offset % 4
        if padding:
            parts.append(b"\0" * padding)
            offset += padding
        parts.append(payload)
        output["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload)})
        output.setdefault("images", []).append(
            {"name": image.get("name", slot), "mimeType": "image/png", "bufferView": len(output["bufferViews"]) - 1}
        )
        new_texture: dict[str, Any] = {"source": len(output["images"]) - 1}
        if "sampler" in texture:
            output.setdefault("samplers", []).append(copy.deepcopy(bake["samplers"][int(texture["sampler"])]))
            new_texture["sampler"] = len(output["samplers"]) - 1
        output.setdefault("textures", []).append(new_texture)
        ref["index"] = len(output["textures"]) - 1
        images.append(
            {
                "slot": slot,
                "name": image.get("name"),
                "sourceSha256": sha256(source_payload),
                "outputSha256": sha256(payload),
                **resize,
            }
        )

    if alpha_mode is not None:
        material["alphaMode"] = alpha_mode
        material.pop("alphaCutoff", None)
        if alpha_mode == "MASK":
            material["alphaCutoff"] = alpha_cutoff
    output["materials"][target_index] = material
    new_binary = b"".join(parts)
    output["buffers"][0]["byteLength"] = len(new_binary)
    return new_binary, {
        "materialIndex": target_index,
        "materialBefore": shipped_material,
        "materialAfter": material,
        "images": images,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, required=True, help="shipped actor GLB")
    parser.add_argument("--bake", type=Path, required=True, help="fresh materializer bake of the same actor")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-texture", type=int, default=1024)
    parser.add_argument("--alpha-mode", choices=("OPAQUE", "MASK", "BLEND"))
    parser.add_argument("--alpha-cutoff", type=float)
    parser.add_argument("--provenance", type=Path)
    parser.add_argument("--output-provenance", type=Path)
    parser.add_argument("--no-provenance", action="store_true")
    args = parser.parse_args()
    if (args.alpha_mode == "MASK") != (args.alpha_cutoff is not None):
        parser.error("--alpha-cutoff is required with --alpha-mode MASK and refused otherwise")
    if args.alpha_cutoff is not None and not 0.0 <= args.alpha_cutoff <= 1.0:
        parser.error("--alpha-cutoff must be in [0, 1]")

    shipped, shipped_binary, shipped_raw = parse_glb(args.input)
    bake, bake_binary, bake_raw = parse_glb(args.bake)
    output, output_binary, geometry = transplant(shipped, shipped_binary, bake, bake_binary, HAIR_MESH_TOKEN)
    output_binary, material = carry_material(
        output, output_binary, bake, bake_binary, args.max_texture, args.alpha_mode, args.alpha_cutoff
    )
    output_raw = encode_glb(output, output_binary)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output_raw)

    geometry = {key: value for key, value in geometry.items() if key != "nonBrowBufferViews"}
    record = {
        "stage": STAGE,
        "tool": TOOL,
        "inputGlbSha256": sha256(shipped_raw),
        "bakeGlbSha256": sha256(bake_raw),
        "outputGlbSha256": sha256(output_raw),
        "outputBytes": len(output_raw),
        "maxTexture": args.max_texture,
        "geometry": geometry,
        "material": material,
    }
    if not args.no_provenance:
        source = args.provenance or args.input.with_suffix("").with_suffix(".provenance.json")
        target = args.output_provenance or args.output.with_suffix("").with_suffix(".provenance.json")
        provenance = json.loads(source.read_text(encoding="utf-8"))
        provenance["outputSha256"] = record["outputGlbSha256"]
        provenance["outputBytes"] = record["outputBytes"]
        provenance["actorHairTransplantPostExport"] = record
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(provenance, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "outputBytes": len(output_raw), "images": material["images"]}, indent=1))


if __name__ == "__main__":
    main()
