#!/usr/bin/env python3
"""Append a subject-derived metallic/roughness map to one exported MPFB GLB."""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import struct
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
DEFAULT_GLB = REPO / "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb"
DEFAULT_DERIVE = HERE / "derive-inputs"
DEFAULT_PROVENANCE = DEFAULT_GLB.with_suffix(".provenance.json")
ROUGH_DIR = HERE.parent / "face-replay"
DARK_DIR = HERE.parent / "vitruvian_dark"
sys.path.insert(0, str(ROUGH_DIR))
sys.path.insert(0, str(DARK_DIR))
import build_roughness as rough  # noqa: E402
import vitruvian_dark_remap as glb  # noqa: E402

STAGE = "subject_derived_roughness_breakup_v3"
EXTRAS_KEY = "openClinXrSubjectRoughnessBreakup"
MAP_NAME = "mpfb-family-partner-adult.subject-roughness-orm"
TOOL = "tools/openclinxr/asset-pipeline/skin/roughness-breakup/apply_roughness_breakup.py"
DERIVE_FILES = (
    "ao.png", "landmarks-uv.json", "mask-facecore.png", "mask-lips.png",
    "mask-scalp.png",
)


def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha_file(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def canonical_sha(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False).encode("utf-8")
    return sha_bytes(payload)


def view_bytes(doc: dict, binary: bytes, index: int) -> bytes:
    view = doc["bufferViews"][index]
    start = int(view.get("byteOffset", 0))
    return binary[start:start + int(view["byteLength"])]


def view_hashes(doc: dict, binary: bytes) -> list[str]:
    return [sha_bytes(view_bytes(doc, binary, index))
            for index in range(len(doc.get("bufferViews", [])))]


def image_bytes(doc: dict, binary: bytes, image_index: int) -> bytes:
    image = doc["images"][image_index]
    if "bufferView" not in image:
        raise RuntimeError(f"image {image_index} is not GLB-embedded")
    return view_bytes(doc, binary, int(image["bufferView"]))


def skin_material_index(doc: dict) -> int:
    found = []
    named_skin = []
    for index, material in enumerate(doc.get("materials", [])):
        pbr = material.get("pbrMetallicRoughness", {})
        texture_index = pbr.get("baseColorTexture", {}).get("index")
        if texture_index is None:
            continue
        image_index = int(doc["textures"][int(texture_index)]["source"])
        image_name = str(doc["images"][image_index].get("name", "")).lower()
        material_name = str(material.get("name", "")).lower()
        if ("skin" in material_name
                and not any(token in material_name for token in ("eye", "hair", "scalp"))):
            named_skin.append(index)
        if "skin-baked" in image_name and "skin" in material_name:
            found.append(index)
    if not found and len(named_skin) == 1:
        found = named_skin
    if len(found) != 1:
        raise RuntimeError(f"expected one baked skin material, found {found}")
    return found[0]


def texture_png(doc: dict, binary: bytes, texture_index: int) -> np.ndarray:
    source = int(doc["textures"][texture_index]["source"])
    return np.asarray(Image.open(io.BytesIO(image_bytes(doc, binary, source))).convert("RGB"))


def load_inputs(derive: Path, size: int) -> tuple[
        np.ndarray, dict, np.ndarray, np.ndarray, np.ndarray]:
    missing = [name for name in DERIVE_FILES if not (derive / name).is_file()]
    if missing:
        raise RuntimeError(f"missing tracked derive inputs: {missing}")
    ao_image = Image.open(derive / "ao.png").convert("L")
    face_image = Image.open(derive / "mask-facecore.png").convert("L")
    lip_image = Image.open(derive / "mask-lips.png").convert("L")
    scalp_image = Image.open(derive / "mask-scalp.png").convert("L")
    if ao_image.size != (size, size):
        ao_image = ao_image.resize((size, size), Image.Resampling.BILINEAR)
    if face_image.size != (size, size):
        face_image = face_image.resize((size, size), Image.Resampling.BILINEAR)
    if lip_image.size != (size, size):
        lip_image = lip_image.resize((size, size), Image.Resampling.NEAREST)
    if scalp_image.size != (size, size):
        scalp_image = scalp_image.resize((size, size), Image.Resampling.BILINEAR)
    return (
        np.asarray(ao_image, dtype=np.float32) / 255.0,
        json.loads((derive / "landmarks-uv.json").read_text()),
        np.asarray(face_image, dtype=np.uint8),
        np.asarray(lip_image, dtype=np.float32) / 255.0,
        np.asarray(scalp_image, dtype=np.uint8),
    )


def eye_keepout(landmarks: dict, size: int) -> tuple[np.ndarray, dict]:
    """Build a derived lower/inner-eye capsule from the shipped UV landmarks."""
    scale = size / float(landmarks["size"])
    points = {
        key: np.asarray(value["uv_texel"], dtype=np.float64) * scale
        for key, value in landmarks["landmarks"].items()
    }
    keepout = np.zeros((size, size), dtype=np.uint8)
    spans = {}
    for side in ("L", "R"):
        inner = points[f"eye-corner-{side}-inner"]
        outer = points[f"eye-corner-{side}-outer"]
        span = float(np.linalg.norm(inner - outer))
        thickness = max(1, int(round(2 * span)))
        cv2.line(
            keepout,
            tuple(np.rint(inner).astype(int)),
            tuple(np.rint(outer).astype(int)),
            255,
            thickness=thickness,
            lineType=cv2.LINE_AA,
        )
        spans[side] = {"span": span, "thickness": thickness}
    return keepout > 127, spans


def feather_t_zone(old_t: np.ndarray, allowed: np.ndarray) -> tuple[np.ndarray, dict]:
    """Fade ROUGH's T contribution to zero before every exclusion boundary.

    ROUGH's quantized, unclipped soft disk changes by at most one G count per
    four-neighbour step. L1 distance to the forbidden set has the same bound,
    so their pointwise minimum preserves that derived bound without a tuned
    feather width.
    """
    raw_reduction = np.rint(
        -rough.relative_t_zone_offset(old_t) * 255.0,
    ).astype(np.uint8)
    boundary_distance = cv2.distanceTransform(
        allowed.astype(np.uint8), cv2.DIST_L1, 3,
    )
    reduction = np.minimum(
        raw_reduction.astype(np.float32), boundary_distance,
    ).astype(np.uint8)
    reduction[~allowed] = 0
    corrected_t = reduction.astype(np.float32) / (0.08 * 255.0)
    return corrected_t, {
        "rawReductionGreen": raw_reduction,
        "reductionGreen": reduction,
        "boundaryDistance": boundary_distance,
    }


def corrected_masks(derive: Path, size: int) -> dict[str, np.ndarray]:
    ao, landmarks, facecore, lips, scalp = load_inputs(derive, size)
    blank = np.zeros((size, size, 3), dtype=np.uint8)
    _, masks = rough.build_roughness_map(blank, ao, landmarks, facecore, lips)
    old_t = masks["t_zone"].copy()
    lower_lid, eye_spans = eye_keepout(landmarks, size)
    face_hard = facecore > 127
    scalp_hard = scalp > 127
    allowed = face_hard & ~scalp_hard & ~lower_lid
    corrected_t, feather = feather_t_zone(old_t, allowed)
    lip_hard = lips > 0.5
    cheek_open = face_hard & (corrected_t <= (1 / 255)) & ~lip_hard
    cheek_open = cv2.erode(
        cheek_open.astype(np.uint8), np.ones((9, 9), np.uint8),
    ) > 0
    masks.update({
        "t_zone": corrected_t,
        "old_t_zone": old_t,
        "cheek_open": cheek_open,
        "facecore_hard": face_hard,
        "scalp_hard": scalp_hard,
        "lower_lid_keepout": lower_lid,
        "eye_spans": eye_spans,
        "t_feather": feather,
    })
    return masks


def measurement_masks(derive: Path, size: int) -> dict[str, np.ndarray]:
    return corrected_masks(derive, size)


def mask_geometry(masks: dict[str, np.ndarray]) -> dict:
    centres = masks["centres"]
    forehead = np.asarray(centres["forehead"], dtype=np.float64)
    chin = np.asarray(centres["chin"], dtype=np.float64)
    axis = chin - forehead
    axis /= np.linalg.norm(axis)

    def extent(mask: np.ndarray) -> float:
        rows, cols = np.where(mask)
        projected = (np.column_stack((cols, rows)) - forehead) @ axis
        return float(projected.max() - projected.min())

    active_t = masks["t_zone"] > (1 / 255)
    old_active_t = masks["old_t_zone"] > (1 / 255)
    facecore = masks["facecore_hard"]
    return {
        "oldTZoneLongAxisExtent": extent(old_active_t),
        "oldScalpOverlapTexels": int(
            (old_active_t & masks["scalp_hard"]).sum()
        ),
        "tZoneLongAxisExtent": extent(active_t),
        "facecoreLongAxisExtent": extent(facecore),
        "scalpOverlapTexels": int((active_t & masks["scalp_hard"]).sum()),
        "activeTZoneTexels": int(active_t.sum()),
    }


def defect_probe(masks: dict[str, np.ndarray], landmarks: dict,
                 facecore: np.ndarray, lips: np.ndarray) -> dict:
    size = facecore.shape[0]
    gate = cv2.dilate((facecore > 0).astype(np.uint8), np.ones((15, 15), np.uint8))
    lower_lid = masks["lower_lid_keepout"]
    component_rows = {}
    for name, radius in (
        ("nose", rough.R_NOSE), ("chin", rough.R_CHIN),
        ("forehead", rough.R_FOREHEAD),
    ):
        centre = masks["centres"][name]
        component = rough.disk((size, size), centre[0], centre[1], radius * size)
        component = cv2.dilate(
            (component.astype(np.uint8) * gate), np.ones((5, 5), np.uint8),
        )
        component = cv2.GaussianBlur(component.astype(np.float32), (0, 0), 12)
        component_rows[name] = int(((component > (1 / 255)) & lower_lid).sum())
    lip_feather = cv2.GaussianBlur((lips > 0.5).astype(np.float32), (0, 0), 6)
    return {
        "oldDiskLowerLidOverlapTexels": component_rows,
        "oldLipFeatherLowerLidOverlapTexels": int(
            ((lip_feather > (1 / 255)) & lower_lid).sum()
        ),
        "correctedTLowerLidOverlapTexels": int(
            ((masks["t_zone"] > (1 / 255)) & lower_lid).sum()
        ),
        "correctedTScalpOverlapTexels": int(
            ((masks["t_zone"] > (1 / 255)) & masks["scalp_hard"]).sum()
        ),
        "eyeSpans": masks["eye_spans"],
    }


def max_four_neighbour_gradient(values: np.ndarray, coverage: np.ndarray,
                                exclude: np.ndarray | None = None) -> int:
    """Return the max quantized four-neighbour gradient on covered pairs."""
    values_i = values.astype(np.int16)
    if exclude is None:
        exclude = np.zeros(values.shape, dtype=bool)
    horizontal = (coverage[:, 1:] & coverage[:, :-1]
                  & ~exclude[:, 1:] & ~exclude[:, :-1])
    vertical = (coverage[1:, :] & coverage[:-1, :]
                & ~exclude[1:, :] & ~exclude[:-1, :])
    candidates = []
    if horizontal.any():
        candidates.append(int(np.abs(values_i[:, 1:] - values_i[:, :-1])[horizontal].max()))
    if vertical.any():
        candidates.append(int(np.abs(values_i[1:, :] - values_i[:-1, :])[vertical].max()))
    return max(candidates, default=0)


def edge_four_neighbour_gradient(values: np.ndarray, coverage: np.ndarray,
                                 edge: np.ndarray) -> int:
    """Return max gradient for covered pairs touching a named edge."""
    values_i = values.astype(np.int16)
    horizontal = (coverage[:, 1:] & coverage[:, :-1]
                  & (edge[:, 1:] | edge[:, :-1]))
    vertical = (coverage[1:, :] & coverage[:-1, :]
                & (edge[1:, :] | edge[:-1, :]))
    candidates = []
    if horizontal.any():
        candidates.append(int(np.abs(values_i[:, 1:] - values_i[:, :-1])[horizontal].max()))
    if vertical.any():
        candidates.append(int(np.abs(values_i[1:, :] - values_i[:-1, :])[vertical].max()))
    return max(candidates, default=0)


def gradient_probe(green: np.ndarray, masks: dict[str, np.ndarray],
                   coverage: np.ndarray, baseline_green: int) -> dict:
    """Measure D4 and G10 against ROUGH's own quantized treatments."""
    old_t = masks["old_t_zone"]
    raw_green = np.rint(
        baseline_green + rough.relative_t_zone_offset(old_t) * 255.0,
    ).astype(np.uint8)
    allowed = (masks["facecore_hard"] & ~masks["scalp_hard"]
               & ~masks["lower_lid_keepout"])
    hard_clipped_t = old_t.copy()
    hard_clipped_t[~allowed] = 0.0
    hard_clipped_green = np.rint(
        baseline_green + rough.relative_t_zone_offset(hard_clipped_t) * 255.0,
    ).astype(np.uint8)

    lips = masks["lips"]
    rough_lip = rough.apply_lip_roughness(
        np.full(green.shape, baseline_green / 255.0, dtype=np.float32),
        lips.astype(np.float32),
    )
    rough_lip_green = np.rint(rough_lip * 255.0).astype(np.uint8)
    lip_treatment = rough_lip_green != baseline_green
    lip_edge = ((cv2.dilate(lips.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)
                & (cv2.erode(lips.astype(np.uint8), np.ones((3, 3), np.uint8)) == 0))
    return {
        "roughSoftDiskMaxGradientGreen": max_four_neighbour_gradient(
            raw_green, np.ones(green.shape, dtype=bool),
        ),
        "r3HardClipMaxGradientGreen": max_four_neighbour_gradient(
            hard_clipped_green, np.ones(green.shape, dtype=bool),
        ),
        "targetNonLipMaxGradientGreen": max_four_neighbour_gradient(
            green, coverage, lip_treatment,
        ),
        "targetLipEdgeMaxGradientGreen": edge_four_neighbour_gradient(
            green, coverage, lip_edge,
        ),
        "roughLipEdgeMaxGradientGreen": edge_four_neighbour_gradient(
            rough_lip_green, coverage, lip_edge,
        ),
        "lipTreatmentExcludedTexels": int(lip_treatment.sum()),
    }


def map_metrics(green: np.ndarray, masks: dict[str, np.ndarray],
                coverage: np.ndarray, baseline_green: int | None = None) -> dict:
    t_zone = (masks["t_zone"] > 0.5) & coverage
    cheek = masks["cheek_open"] & coverage
    lips = masks["lips"] & coverage
    covered = green[coverage].astype(np.float64) / 255.0
    if not (t_zone.any() and cheek.any() and lips.any() and covered.size):
        raise RuntimeError("roughness measurement mask is empty")
    result = {
        "tZoneMean": float(green[t_zone].mean() / 255.0),
        "cheekMean": float(green[cheek].mean() / 255.0),
        "lipMean": float(green[lips].mean() / 255.0),
        "minimum": float(covered.min()),
        "maximum": float(covered.max()),
        "standardDeviation": float(covered.std()),
        "texels": {
            "tZone": int(t_zone.sum()),
            "cheek": int(cheek.sum()),
            "lips": int(lips.sum()),
            "coverage": int(coverage.sum()),
        },
    }
    if baseline_green is not None:
        active_t = masks["t_zone"] > (1 / 255)
        face_baseline = masks["facecore_hard"] & ~active_t & ~masks["lips"] & coverage
        off_face = ~masks["facecore_hard"] & coverage
        result["baseline"] = {
            "green": int(baseline_green),
            "value": float(baseline_green / 255.0),
            "facecoreMedian": float(np.median(green[face_baseline]) / 255.0),
            "facecoreTexels": int(face_baseline.sum()),
            "bodyOffFaceMinimum": float(green[off_face].min() / 255.0),
            "bodyOffFaceMaximum": float(green[off_face].max() / 255.0),
            "bodyOffFaceTexels": int(off_face.sum()),
            "bodyOffFaceNonBaselineTexels": int(
                (green[off_face] != baseline_green).sum()
            ),
        }
        result["maskGeometry"] = mask_geometry(masks)
    return result


def reconstruct_input_doc(doc: dict, record: dict) -> dict:
    restored = copy.deepcopy(doc)
    if int(record["bufferViewIndex"]) != int(record["preExistingBufferViewCount"]):
        raise RuntimeError("roughness stage bufferView index does not follow its recorded input")
    if int(restored["images"][int(record["imageIndex"])]["bufferView"]) != int(
        record["bufferViewIndex"]
    ):
        raise RuntimeError("roughness stage image no longer names its recorded bufferView")
    if int(restored["textures"][int(record["textureIndex"])]["source"]) != int(
        record["imageIndex"]
    ):
        raise RuntimeError("roughness stage texture no longer names its recorded image")
    for collection, key in (("textures", "textureIndex"), ("images", "imageIndex"),
                            ("bufferViews", "bufferViewIndex")):
        index = int(record[key])
        if index >= len(restored[collection]):
            raise RuntimeError(f"stage {collection} entry is missing")
        # This stage and every later byte stage are append-only.  Truncating at
        # the recorded stage index reconstructs the exact pre-stage collection
        # even when OPENCLINXR_skin_shade appended more entries afterwards.
        del restored[collection][index:]
    pbr = restored["materials"][int(record["skinMaterialIndex"])]["pbrMetallicRoughness"]
    pbr.pop("metallicRoughnessTexture", None)
    pbr["roughnessFactor"] = record["inputRoughnessFactor"]
    for material in restored.get("materials", []):
        extensions = material.get("extensions", {})
        extensions.pop("OPENCLINXR_skin_shade", None)
        if not extensions:
            material.pop("extensions", None)
    for key in ("extensionsUsed", "extensionsRequired"):
        if key not in restored:
            continue
        restored[key] = [
            name for name in restored[key]
            if name != "OPENCLINXR_skin_shade"
            and not (
                name == "KHR_texture_transform"
                and not any(
                    isinstance(value, dict) and "KHR_texture_transform" in value
                    for value in _walk_json(restored)
                )
            )
        ]
        if not restored[key]:
            restored.pop(key)
    restored["buffers"][0]["byteLength"] = int(record["inputBufferBytes"])
    extras = restored["asset"]["extras"]
    extras.pop(EXTRAS_KEY, None)
    if not record["inputHadAssetExtras"] and not extras:
        restored["asset"].pop("extras")
    return restored


def _walk_json(value: object):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from _walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_json(child)


def inspect_stage(raw: bytes, derive: Path, known_good: Path | None = None) -> dict:
    doc, binary = glb.parse_glb(raw)
    record = doc.get("asset", {}).get("extras", {}).get(EXTRAS_KEY)
    if not isinstance(record, dict) or record.get("stage") != STAGE:
        raise RuntimeError(f"{STAGE} is not embedded in the GLB")
    material_index = int(record["skinMaterialIndex"])
    pbr = doc["materials"][material_index]["pbrMetallicRoughness"]
    texture_ref = pbr.get("metallicRoughnessTexture", {})
    texture_index = int(texture_ref.get("index", -1))
    packed = texture_png(doc, binary, texture_index)
    coverage = glb.uv_coverage_mask(doc, binary, packed.shape[1], packed.shape[0])
    masks = measurement_masks(derive, packed.shape[0])
    baseline_green = int(record["baselineGreen"])
    target = map_metrics(packed[..., 1], masks, coverage, baseline_green)
    target["gradientProbe"] = gradient_probe(
        packed[..., 1], masks, coverage, baseline_green,
    )
    current_views = view_hashes(doc, binary)
    expected_views = list(record["preExistingBufferViewSha256"])
    reconstructed = reconstruct_input_doc(doc, record)
    base_texture = doc["materials"][material_index]["pbrMetallicRoughness"]["baseColorTexture"]
    base_image = int(doc["textures"][int(base_texture["index"])]["source"])
    report = {
        "stage": STAGE,
        "mapSha256": sha_bytes(image_bytes(doc, binary, int(doc["textures"][texture_index]["source"]))),
        "target": target,
        "packing": {
            "redUnique": np.unique(packed[..., 0]).astype(int).tolist(),
            "blueUnique": np.unique(packed[..., 2]).astype(int).tolist(),
            "roughnessFactor": pbr.get("roughnessFactor"),
            "metallicFactor": pbr.get("metallicFactor"),
            "texCoord": texture_ref.get("texCoord", 0),
            "sampler": doc["textures"][texture_index].get("sampler"),
        },
        "counterweights": {
            "baseColorSha256": sha_bytes(image_bytes(doc, binary, base_image)),
            "baseColorUnchanged": sha_bytes(image_bytes(doc, binary, base_image)) == record["inputBaseColorSha256"],
            "preExistingBufferViewsUnchanged": current_views[:len(expected_views)] == expected_views,
            "inputJsonReconstructs": canonical_sha(reconstructed) == record["inputJsonSha256"],
            "parsedJsonDiff": record["parsedJsonDiff"],
        },
        "deriveInputs": record["deriveInputs"],
        "defectProbe": record["defectProbe"],
    }
    if known_good is not None:
        known_raw = known_good.read_bytes()
        known_doc, known_binary = glb.parse_glb(known_raw)
        known_material = known_doc["materials"][skin_material_index(known_doc)]
        known_texture = int(known_material["pbrMetallicRoughness"]["metallicRoughnessTexture"]["index"])
        known_packed = texture_png(known_doc, known_binary, known_texture)
        if known_packed.shape != packed.shape:
            raise RuntimeError(
                f"known-good packed map shape differs: {known_packed.shape} vs {packed.shape}"
            )
        # P3 proves both actors use the same MPFB atlas space. Measure the
        # known-good G channel over the target's shipped UV coverage so the
        # region comparison has exactly one denominator.
        report["knownGood"] = map_metrics(known_packed[..., 1], masks, coverage)
        known_image = int(known_doc["textures"][known_texture]["source"])
        report["knownGoodMapSha256"] = sha_bytes(image_bytes(known_doc, known_binary, known_image))
        report["mapDiffersFromKnownGood"] = report["mapSha256"] != report["knownGoodMapSha256"]
    return report


def build_stage(raw: bytes, derive: Path) -> tuple[bytes, dict]:
    doc, binary = glb.parse_glb(raw)
    existing = doc.get("asset", {}).get("extras", {}).get(EXTRAS_KEY)
    if isinstance(existing, dict) and existing.get("stage") == STAGE:
        return raw, existing
    if isinstance(existing, dict):
        input_doc = reconstruct_input_doc(doc, existing)
        input_binary = binary[:int(existing["inputBufferBytes"])]
        raw = glb.encode_glb(input_doc, input_binary)
        doc, binary = glb.parse_glb(raw)
    material_index = skin_material_index(doc)
    pbr = doc["materials"][material_index]["pbrMetallicRoughness"]
    if "metallicRoughnessTexture" in pbr:
        raise RuntimeError("skin already has a metallicRoughnessTexture from another stage")
    base_texture_index = int(pbr["baseColorTexture"]["index"])
    base_image_index = int(doc["textures"][base_texture_index]["source"])
    base_bytes = image_bytes(doc, binary, base_image_index)
    albedo = np.asarray(Image.open(io.BytesIO(base_bytes)).convert("RGB"))
    if albedo.shape[0] != albedo.shape[1]:
        raise RuntimeError(f"skin atlas is not square: {albedo.shape}")
    size = albedo.shape[0]
    ao, landmarks, facecore, lips, _scalp = load_inputs(derive, size)
    masks = corrected_masks(derive, size)
    input_roughness = float(pbr.get("roughnessFactor", 1.0))
    baseline_green = int(round(input_roughness * 255))
    baseline = baseline_green / 255.0
    roughness = np.full((size, size), baseline, dtype=np.float32)
    roughness += rough.relative_t_zone_offset(masks["t_zone"])
    face_lips = lips.copy()
    face_lips[~masks["facecore_hard"]] = 0
    roughness = rough.apply_lip_roughness(roughness, face_lips)
    roughness[~masks["facecore_hard"]] = baseline
    green = np.rint(roughness * 255).astype(np.uint8)
    packed = np.full((size, size, 3), 255, dtype=np.uint8)
    packed[..., 1] = green
    png_io = io.BytesIO()
    Image.fromarray(packed, "RGB").save(png_io, format="PNG", compress_level=9)
    map_bytes = png_io.getvalue()

    input_doc_sha = canonical_sha(doc)
    input_view_hashes = view_hashes(doc, binary)
    input_buffer_bytes = int(doc["buffers"][0]["byteLength"])
    input_had_extras = "extras" in doc.get("asset", {})
    buffer_view_index = len(doc["bufferViews"])
    image_index = len(doc["images"])
    texture_index = len(doc["textures"])
    offset = len(binary)
    doc["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(map_bytes)})
    doc["images"].append({
        "name": MAP_NAME,
        "mimeType": "image/png",
        "bufferView": buffer_view_index,
    })
    sampler = doc["textures"][base_texture_index].get("sampler", 0)
    doc["textures"].append({"source": image_index, "sampler": sampler})
    pbr["metallicRoughnessTexture"] = {"index": texture_index}
    pbr["roughnessFactor"] = 1.0
    output_binary = binary + map_bytes
    doc["buffers"][0]["byteLength"] = len(output_binary)
    coverage = glb.uv_coverage_mask(doc, output_binary, size, size)
    metrics = map_metrics(green, masks, coverage, baseline_green)
    derive_rows = {
        str((derive / name).relative_to(REPO)): sha_file(derive / name)
        for name in DERIVE_FILES
    }
    record = {
        "stage": STAGE,
        "tool": TOOL,
        "inputGlbSha256": sha_bytes(raw),
        "inputGlbBytes": len(raw),
        "inputJsonSha256": input_doc_sha,
        "inputBufferBytes": input_buffer_bytes,
        "inputHadAssetExtras": input_had_extras,
        "inputRoughnessFactor": input_roughness,
        "baselineGreen": baseline_green,
        "inputBaseColorSha256": sha_bytes(base_bytes),
        "preExistingBufferViewCount": len(input_view_hashes),
        "preExistingBufferViewSha256": input_view_hashes,
        "skinMaterialIndex": material_index,
        "bufferViewIndex": buffer_view_index,
        "imageIndex": image_index,
        "textureIndex": texture_index,
        "mapSha256": sha_bytes(map_bytes),
        "deriveInputs": derive_rows,
        "metrics": metrics,
        "defectProbe": defect_probe(masks, landmarks, facecore, lips),
        "packing": "R=255 neutral cavity, G=subject roughness, B=255; metallicFactor=0",
        "parsedJsonDiff": [
            f"bufferViews[{buffer_view_index}] appended",
            f"images[{image_index}] appended",
            f"textures[{texture_index}] appended with sampler {sampler}",
            f"buffers[0].byteLength {input_buffer_bytes} -> {len(output_binary)}",
            f"materials[{material_index}].pbrMetallicRoughness.metallicRoughnessTexture added",
            f"materials[{material_index}].pbrMetallicRoughness.roughnessFactor {input_roughness} -> 1.0",
            f"asset.extras.{EXTRAS_KEY} added",
        ],
    }
    doc.setdefault("asset", {}).setdefault("extras", {})[EXTRAS_KEY] = record
    return glb.encode_glb(doc, output_binary), record


def update_provenance(path: Path, record: dict, output_raw: bytes) -> None:
    provenance = json.loads(path.read_text())
    stage_row = {
        "stage": STAGE,
        "tool": TOOL,
        "inputSha256": record["inputGlbSha256"],
        "outputSha256": sha_bytes(output_raw),
        "outputBytes": len(output_raw),
        "mapSha256": record["mapSha256"],
        "deriveInputs": record["deriveInputs"],
    }
    stages = [row for row in provenance.get("stages", [])
              if not str(row.get("stage", "")).startswith(
                  "subject_derived_roughness_breakup_v")]
    stages.append(stage_row)
    provenance["stages"] = stages
    note = ("2026-11-05 st-vitrough r4: appended a subject-derived packed roughness "
            "map (G) relative to the shipped 0.78 baseline, with a derived one-G-count "
            "inside feather before scalp and lower-lid exclusions; baseColor, geometry, "
            "rig, animations, and all pre-existing buffer views remain byte-identical.")
    notes = provenance.setdefault("sourceNotes", [])
    notes[:] = [item for item in notes if not any(
        marker in item for marker in ("st-vitrough r2:", "st-vitrough r3:")
    )]
    if note not in notes:
        notes.append(note)
    provenance["outputSha256"] = sha_bytes(output_raw)
    provenance["outputBytes"] = len(output_raw)
    path.write_text(json.dumps(provenance, indent=1, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", type=Path, default=DEFAULT_GLB)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--derive-dir", type=Path, default=DEFAULT_DERIVE)
    parser.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    parser.add_argument("--known-good", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--no-provenance", action="store_true")
    args = parser.parse_args()
    source_raw = args.glb.read_bytes()
    if args.check:
        report = inspect_stage(source_raw, args.derive_dir, args.known_good)
    else:
        output_raw, record = build_stage(source_raw, args.derive_dir)
        output = args.output or args.glb
        output.write_bytes(output_raw)
        if not args.no_provenance:
            update_provenance(args.provenance, record, output_raw)
        report = inspect_stage(output_raw, args.derive_dir, args.known_good)
        report["output"] = {
            "path": str(output), "sha256": sha_bytes(output_raw), "bytes": len(output_raw),
        }
    if args.report:
        args.report.write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
