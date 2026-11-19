#!/usr/bin/env python3
"""Apply the hair asset's authored maps to its fitted hair material (post-export).

Post-export stage (pattern: apply_actor_hair_colour.py = stage 21; in-place byte
patch of the GLB, never a NodeIO write, which drops OPENCLINXR_* extensions).
For each target GLB whose fitted hair material names a toigo_* style, this stage:

- resolves the style's .mhclo via embed_library_hair.source_hair_textures (no copy),
- recolours the diffuse PNG to the case-authored hair colour with the FU4
  hue-preserving core embed_library_hair.recolour_to_token_chroma_linear
  (shared luminance ratio toward the token chroma; no copy; no behaviour
  change to recolour_to_mean_linear or create_material, both untouched),
- appends the recoloured diffuse PNG + the raw normal PNG to the BIN (pre-existing
  bufferView bytes untouched), wires baseColorTexture + normalTexture, sets
  alphaMode MASK + alphaCutoff 0.2 (peds-parent-aisha shipped known-good at
  30083bee8; see S0 in RESULT), and clears baseColorFactor to white (known-good
  carries no factor; the tint is baked into the texels).

Case hair_color token resolution follows apply_actor_hair_colour.authored_hair_token
(tools/openclinxr/asset-pipeline/makeclothes/apply_actor_hair_colour.py:71-87):
provenance scenarioId/actorId -> phenotypes entries -> phenotype.hair_color.
FU1 F1 NO FALLBACK: a missing token (no provenance, no phenotype entry, or no
hair_color) is a STOP for that GLB — the stage writes no output for it and the
reason goes on its stdout line (and RESULT). There is no brown fallback path.
mhair02 hair materials are refused (another card).
Images are named after their content (FU1 F4a): hair-diffuse-<token>.png for the
recoloured diffuse, hair-normal-<style>.png for the normal map.
Pass --output-provenance to record the derived GLB and material wiring in a new
sidecar. The source sidecar must pin the input bytes.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from embed_library_hair import (  # noqa: E402
    authored_hair_color_rgba,
    recolour_to_token_chroma_linear,
    source_hair_shininess,
    source_hair_textures,
)
from apply_actor_hair_colour import (  # noqa: E402
    authored_hair_token,
    encode_glb,
    parse_glb,
    sha_bytes,
)

STAGE = "actor_hair_material_maps_post_export_v1"
TOOL = "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py"
HAIR_PREFIX = "openclinxr_fitted_hair_"
ALPHA_MODE = "MASK"
ALPHA_CUTOFF = 0.2
DEFAULT_HAIR_CACHE = Path(
    "/Volumes/files/src/openclinxr/.openclinxr-local/provider-cache/hair/sources/"
    "makehuman-hair01/extracted/hair"
)
KNOWN_STYLES = (
    "toigo_blunt_bob_with_bangs",
    "toigo_curled_under_bob_with_bangs",
    "toigo_blunt_bob",
    "toigo_curled_under_bob",
    "toigo_inverted_bob_with_bangs",
    "toigo_inverted_bob",
)


def hair_style_from_material(name: str) -> str | None:
    for style in KNOWN_STYLES:
        if style in name:
            return style
    match = re.search(r"toigo(?:_[a-z]+)+", name)
    return match.group(0) if match else None


def srgb_to_linear(channel: object) -> object:
    import numpy as np

    rgb = np.asarray(channel, dtype=np.float64)
    return np.where(
        rgb <= 0.04045,
        rgb / 12.92,
        ((rgb + 0.055) / 1.055) ** 2.4,
    )


def linear_to_srgb(channel: object) -> object:
    import numpy as np

    lin = np.asarray(channel, dtype=np.float64)
    return np.where(
        lin <= 0.0031308,
        12.92 * lin,
        1.055 * (np.clip(lin, 0.0, None) ** (1.0 / 2.4)) - 0.055,
    )


def recoloured_diffuse_png(source_png: bytes, target_rgb: tuple[float, float, float]) -> tuple[bytes, float]:
    """Recolour by shared luminance ratio toward the token chroma (FU4 R1).

    Returns (png_bytes, clip_fraction): clip_fraction is the fraction of kept
    texels (alpha >= 0.2, the T2 kept set) with target_c * k > 1 in any channel.
    """
    from PIL import Image
    import numpy as np

    rgba = np.asarray(Image.open(io.BytesIO(source_png)).convert("RGBA"), dtype=np.float64) / 255.0
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]
    linear = srgb_to_linear(rgb)
    stacked = np.dstack([linear, alpha])
    out_linear = np.asarray(recolour_to_token_chroma_linear(stacked, target_rgb), dtype=np.float64)
    lum = 0.2126 * linear[..., 0] + 0.7152 * linear[..., 1] + 0.0722 * linear[..., 2]
    ybar = float(np.sum(lum * alpha) / float(alpha.sum()))
    k = lum / ybar
    kept = alpha >= 0.2
    clip_fraction = float(np.any(np.asarray(target_rgb) * k[..., None] > 1.0, axis=-1)[kept].mean()) if kept.any() else 0.0
    out_rgb = np.clip(linear_to_srgb(out_linear[..., :3]), 0.0, 1.0)
    out_alpha = out_linear[..., 3]
    out = np.dstack([out_rgb, out_alpha])
    pixels = np.clip(np.round(out * 255.0), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(pixels, mode="RGBA").save(buf, format="PNG", compress_level=9)
    return buf.getvalue(), clip_fraction


def resolve_token(provenance_path: Path | None, phenotypes_path: Path) -> tuple[str, str]:
    """Resolve the case token or raise: FU1 F1 NO FALLBACK — no brown default.

    Raises RuntimeError with the reason (missing provenance, unresolvable
    provenance/phenotype, or phenotype without hair_color). The caller prints
    the reason on its stdout line and writes no output for the GLB.
    """
    if provenance_path is None or not provenance_path.exists():
        raise RuntimeError(f"STOP: no case hair_color token (provenance missing: {provenance_path})")
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    phenotypes = json.loads(phenotypes_path.read_text(encoding="utf-8"))
    token, source = authored_hair_token(provenance, phenotypes)
    if token is None or not str(token).strip():
        raise RuntimeError(f"STOP: no case hair_color token ({source}: phenotype has no hair_color)")
    return str(token), str(source)


def apply_maps(
    doc: dict,
    binary: bytes,
    diffuse_png: bytes,
    diffuse_name: str,
    normal_png: bytes,
    normal_name: str,
    roughness: float,
) -> tuple[dict, bytes, dict]:
    mats = doc.get("materials", [])
    hair_hits = [
        (i, m)
        for i, m in enumerate(mats)
        if str(m.get("name", "")).startswith(HAIR_PREFIX) and "toigo_" in str(m.get("name", ""))
    ]
    if len(hair_hits) != 1:
        raise RuntimeError(f"expected one toigo fitted hair material, found {len(hair_hits)}")
    index, material = hair_hits[0]
    if "mhair02" in str(material.get("name", "")):
        raise RuntimeError("refusing mhair02 hair material (another card owns it)")

    parts: list[bytes] = [binary]
    new_views: list[dict] = []

    def append_payload(payload: bytes) -> int:
        offset = sum(len(part) for part in parts)
        padding = (-offset) % 4
        if padding:
            parts.append(b"\x00" * padding)
            offset += padding
        parts.append(payload)
        doc.setdefault("bufferViews", []).append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        )
        new_views.append({"byteOffset": offset, "byteLength": len(payload)})
        return len(doc["bufferViews"]) - 1

    diffuse_bv = append_payload(diffuse_png)
    normal_bv = append_payload(normal_png)

    doc.setdefault("images", []).append(
        {"name": diffuse_name, "mimeType": "image/png", "bufferView": diffuse_bv}
    )
    diffuse_image = len(doc["images"]) - 1
    doc["images"].append(
        {"name": normal_name, "mimeType": "image/png", "bufferView": normal_bv}
    )
    normal_image = len(doc["images"]) - 1

    samplers = doc.setdefault("samplers", [])
    if samplers:
        sampler_index = 0
    else:
        samplers.append(
            {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}
        )
        sampler_index = 0

    doc.setdefault("textures", []).append({"source": diffuse_image, "sampler": sampler_index})
    diffuse_tex = len(doc["textures"]) - 1
    doc["textures"].append({"source": normal_image, "sampler": sampler_index})
    normal_tex = len(doc["textures"]) - 1

    before = json.loads(json.dumps(material))
    pbr = material.setdefault("pbrMetallicRoughness", {})
    pbr["baseColorTexture"] = {"index": diffuse_tex}
    pbr.pop("baseColorFactor", None)
    pbr["roughnessFactor"] = roughness
    material["normalTexture"] = {"index": normal_tex}
    material["alphaMode"] = ALPHA_MODE
    material["alphaCutoff"] = ALPHA_CUTOFF

    new_binary = b"".join(parts)
    doc["buffers"][0]["byteLength"] = len(new_binary)
    record = {
        "materialIndex": index,
        "materialName": str(material.get("name", "")),
        "materialBefore": before,
        "materialAfter": json.loads(json.dumps(material)),
        "roughnessFactor": roughness,
        "shininessSource": "mhmat shininess via source_hair_shininess (1 - shininess)",
        "bufferViewsAdded": new_views,
        "imagesAdded": [diffuse_image, normal_image],
        "texturesAdded": [diffuse_tex, normal_tex],
        "samplerReused": sampler_index,
    }
    return doc, new_binary, record


def paths_alias(first: Path, second: Path) -> bool:
    if first.resolve() == second.resolve():
        return True
    try:
        return first.samefile(second)
    except FileNotFoundError:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glb", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--provenance", type=Path, default=None)
    parser.add_argument("--output-provenance", type=Path, default=None)
    parser.add_argument("--phenotypes", type=Path, default=None)
    parser.add_argument("--hair-cache", type=Path, default=DEFAULT_HAIR_CACHE)
    parser.add_argument("--no-provenance", action="store_true")
    args = parser.parse_args()

    output = args.output or args.glb
    provenance_path = None if args.no_provenance else (
        args.provenance or args.glb.with_suffix("").with_suffix(".provenance.json")
    )
    phenotypes_path = args.phenotypes or Path(
        __file__
    ).resolve().parents[4] / "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json"

    token, token_source = None, ""
    try:
        token, token_source = resolve_token(provenance_path, phenotypes_path)
    except RuntimeError as exc:
        print(
            json.dumps(
                {
                    "stage": STAGE,
                    "tool": TOOL,
                    "glb": str(args.glb),
                    "stopped": True,
                    "reason": str(exc),
                },
                indent=1,
            )
        )
        raise SystemExit(2)
    target_rgb = tuple(float(v) for v in authored_hair_color_rgba(token)[:3])

    source_raw = args.glb.read_bytes()
    input_sha = sha_bytes(source_raw)
    output_provenance = args.output_provenance
    provenance = None
    if output_provenance is not None:
        if provenance_path is None:
            raise RuntimeError("output provenance requires an input sidecar")
        if paths_alias(output_provenance, args.glb) or paths_alias(output_provenance, output):
            raise RuntimeError("output provenance cannot overwrite GLB bytes")
        if paths_alias(output_provenance, provenance_path):
            raise RuntimeError("output provenance cannot overwrite its input sidecar")
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        if provenance.get("outputSha256") != input_sha or provenance.get("outputBytes") != len(source_raw):
            raise RuntimeError("input sidecar does not pin the pre-image GLB")
    doc, binary = parse_glb(source_raw)

    mats = doc.get("materials", [])
    hair = [m for m in mats if str(m.get("name", "")).startswith(HAIR_PREFIX)]
    if len(hair) != 1:
        raise RuntimeError(f"expected one fitted hair material, found {len(hair)}")
    style = hair_style_from_material(str(hair[0].get("name", "")))
    if style is None:
        raise RuntimeError(f"hair material names no toigo_* style: {hair[0].get('name')}")
    mhclo = args.hair_cache / style / f"{style}.mhclo"
    maps = source_hair_textures(str(mhclo))
    if "diffuse" not in maps or "normal" not in maps:
        raise RuntimeError(f"style {style} declares maps {sorted(maps)} (need diffuse+normal)")
    # FU5 SPEC DECIDE: roughnessFactor = 1 - shininess per the MPFB mhmat rule
    # (abstractmaterialwrapper.py: roughness = 1.0 - shininess when the mhmat
    # has shininess and no roughness). No specular extension is wired
    # (KEY::SPEC_MAP_UNMAPPED): no reference maps Phong specularColor to glTF
    # specularColorFactor, so no specular number is invented.
    shininess = source_hair_shininess(str(mhclo))
    if shininess is None:
        raise RuntimeError(f"STOP: style {style} declares no mhmat shininess; refusing to invent roughness")
    roughness = 1.0 - shininess
    diffuse_src = Path(maps["diffuse"]).read_bytes()
    normal_src = Path(maps["normal"]).read_bytes()
    diffuse_name = f"hair-diffuse-{token}.png"
    normal_name = f"hair-normal-{style}.png"

    diffuse_png, clip_fraction = recoloured_diffuse_png(diffuse_src, target_rgb)  # type: ignore[arg-type]

    doc, new_binary, record = apply_maps(doc, binary, diffuse_png, diffuse_name, normal_src, normal_name, roughness)
    output_raw = encode_glb(doc, new_binary)
    output_sha = sha_bytes(output_raw)
    if provenance is not None:
        recorded_before = {key: provenance[key] for key in ("outputSha256", "outputBytes", "byteLineage")
                           if key in provenance}
        provenance["outputSha256"] = output_sha
        provenance["outputBytes"] = len(output_raw)
        provenance["byteLineage"] = {
            "preImageFile": str(args.glb),
            "preImageSha256": input_sha,
            "derivationArgv": ["mise", "exec", "--", "python3", "-I", TOOL, *sys.argv[1:]],
            "recordedBefore": recorded_before,
            "stageRecord": {
                "wiredMaterials": [{
                    "materialName": record["materialName"],
                    "texturesAdded": record["texturesAdded"],
                }],
            },
        }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(output_raw)
    if output_provenance is not None and provenance is not None:
        output_provenance.parent.mkdir(parents=True, exist_ok=True)
        output_provenance.write_text(json.dumps(provenance, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "stage": STAGE,
                "tool": TOOL,
                "inputGlbSha256": input_sha,
                "outputGlbSha256": output_sha,
                "outputBytes": len(output_raw),
                "bytesAdded": len(output_raw) - len(source_raw),
                "hairStyle": style,
                "hairColorToken": token,
                "hairColorSource": token_source,
                "resolvedLinearRgb": list(target_rgb),
                "roughnessFactor": roughness,
                "clipFraction": clip_fraction,
                "record": record,
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
