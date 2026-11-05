#!/usr/bin/env python3
"""Apply a case-authored hair colour to fitted scalp and eyebrow GLB materials.

This is a JSON-chunk-only post-export stage. It preserves the GLB BIN chunk
byte-for-byte, including embedded images, geometry, rigging, and animations.
Textured hair is tinted only through baseColorFactor; image bytes are never
read or rewritten.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

from embed_library_hair import authored_hair_color_rgba


REPO = Path(__file__).resolve().parents[4]
DEFAULT_PHENOTYPES = (
    REPO / "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json"
)
STAGE = "actor_hair_colour_post_export_v1"
TOOL = "tools/openclinxr/asset-pipeline/makeclothes/apply_actor_hair_colour.py"
HAIR_PREFIX = "openclinxr_fitted_hair_"
EYEBROW_PREFIX = "openclinxr_fitted_eyebrow_"


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_glb(raw: bytes) -> tuple[dict, bytes]:
    if raw[:4] != b"glTF" or struct.unpack_from("<I", raw, 4)[0] != 2:
        raise RuntimeError("expected GLB v2")
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    if json_type != 0x4E4F534A:
        raise RuntimeError("first GLB chunk is not JSON")
    doc = json.loads(raw[20:20 + json_len])
    bin_header = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", raw, bin_header)
    if bin_type != 0x004E4942:
        raise RuntimeError("second GLB chunk is not BIN")
    binary = raw[bin_header + 8:bin_header + 8 + bin_len]
    if bin_header + 8 + bin_len != len(raw):
        raise RuntimeError("unexpected bytes after GLB BIN chunk")
    return doc, binary


def encode_glb(doc: dict, binary: bytes) -> bytes:
    json_bytes = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary += b"\0" * ((-len(binary)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    return (
        b"glTF"
        + struct.pack("<II", 2, total)
        + struct.pack("<II", len(json_bytes), 0x4E4F534A)
        + json_bytes
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def authored_hair_token(provenance: dict, phenotypes: dict) -> tuple[str | None, str]:
    scenario_id = str(provenance.get("scenarioId") or "")
    actor_id = str(provenance.get("actorId") or "")
    if not scenario_id or not actor_id:
        raise RuntimeError("provenance must declare scenarioId and actorId")
    try:
        phenotype = phenotypes["entries"][scenario_id][actor_id]["phenotype"]
    except (KeyError, TypeError) as error:
        raise RuntimeError(
            f"actor phenotype export has no {scenario_id}/{actor_id} phenotype"
        ) from error
    source = (
        "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json"
        f"#entries.{scenario_id}.{actor_id}.phenotype.hair_color"
    )
    token = phenotype.get("hair_color")
    return (str(token) if token is not None and str(token).strip() else None), source


def recolour_materials(doc: dict, rgb: tuple[float, float, float]) -> list[dict]:
    matched: dict[str, list[tuple[int, dict]]] = {"hair": [], "eyebrow": []}
    for index, material in enumerate(doc.get("materials", [])):
        name = str(material.get("name", ""))
        if name.startswith(HAIR_PREFIX):
            matched["hair"].append((index, material))
        elif name.startswith(EYEBROW_PREFIX):
            matched["eyebrow"].append((index, material))
    counts = {key: len(value) for key, value in matched.items()}
    if counts != {"hair": 1, "eyebrow": 1}:
        raise RuntimeError(f"expected one fitted hair and eyebrow material, found {counts}")

    changed: list[dict] = []
    for kind in ("hair", "eyebrow"):
        index, material = matched[kind][0]
        pbr = material.setdefault("pbrMetallicRoughness", {})
        factor = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
        if not isinstance(factor, list) or len(factor) != 4:
            raise RuntimeError(f"material {index} has invalid baseColorFactor: {factor!r}")
        replacement = [*rgb, factor[3]]
        if factor != replacement:
            pbr["baseColorFactor"] = replacement
            changed.append(
                {
                    "kind": kind,
                    "index": index,
                    "name": str(material.get("name", "")),
                    "textured": "baseColorTexture" in pbr,
                    "before": factor,
                    "after": replacement,
                }
            )
    return changed


def update_provenance(path: Path, record: dict, output_sha: str, output_bytes: int) -> None:
    provenance = json.loads(path.read_text(encoding="utf-8"))
    provenance["outputSha256"] = output_sha
    provenance["outputBytes"] = output_bytes
    provenance["actorHairColourPostExport"] = record
    note = (
        "2026-11-05 st-vitbrow r4: post-export fitted scalp-hair and eyebrow "
        "baseColorFactor now resolve from the case-authored hair_color token; BIN/image "
        "bytes, geometry, rig, animations, eyes, eyelashes, and skin remain unchanged."
    )
    notes = provenance.setdefault("sourceNotes", [])
    if note not in notes:
        notes.append(note)
    path.write_text(json.dumps(provenance, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glb", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--provenance", type=Path, default=None)
    parser.add_argument("--phenotypes", type=Path, default=DEFAULT_PHENOTYPES)
    parser.add_argument("--no-provenance", action="store_true")
    args = parser.parse_args()

    output = args.output or args.glb
    provenance_path = args.provenance or args.glb.with_suffix(".provenance.json")
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    phenotypes = json.loads(args.phenotypes.read_text(encoding="utf-8"))
    hair_color, hair_color_source = authored_hair_token(provenance, phenotypes)
    source_raw = args.glb.read_bytes()

    if hair_color is None:
        if output != args.glb:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(source_raw)
        print(json.dumps({
            "changed": False,
            "reason": "actor has no authored hair_color",
            "actorId": provenance["actorId"],
            "output": {"path": str(output), "sha256": sha_bytes(source_raw), "bytes": len(source_raw)},
        }, indent=1))
        return

    rgba = authored_hair_color_rgba(hair_color)
    resolved_rgb = (rgba[0], rgba[1], rgba[2])
    doc, binary = parse_glb(source_raw)
    changed_materials = recolour_materials(doc, resolved_rgb)
    if not changed_materials:
        if output != args.glb:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(source_raw)
        print(json.dumps({
            "changed": False,
            "reason": "matched materials already use the resolved hair colour",
            "actorId": provenance["actorId"],
            "resolvedLinearRgb": list(resolved_rgb),
            "output": {"path": str(output), "sha256": sha_bytes(source_raw), "bytes": len(source_raw)},
        }, indent=1))
        return

    output_raw = encode_glb(doc, binary)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(output_raw)
    output_sha = sha_bytes(output_raw)
    record = {
        "stage": STAGE,
        "tool": TOOL,
        "inputGlbSha256": sha_bytes(source_raw),
        "outputGlbSha256": output_sha,
        "outputBytes": len(output_raw),
        "resolvedLinearRgb": list(resolved_rgb),
        "actorId": provenance["actorId"],
        "scenarioId": provenance["scenarioId"],
        "hairColor": hair_color,
        "hairColorSource": hair_color_source,
        "matchedMaterials": changed_materials,
    }
    if not args.no_provenance:
        update_provenance(provenance_path, record, output_sha, len(output_raw))
    print(json.dumps({
        "changed": True,
        "stage": record,
        "output": {"path": str(output), "sha256": output_sha, "bytes": len(output_raw)},
    }, indent=1))


if __name__ == "__main__":
    main()
