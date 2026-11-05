#!/usr/bin/env python3
"""Post-export CIELAB dark-skin remap for the st-vitdark actor.

The Vitruvian light/African Face BaseColor maps provide colour statistics only.
No Vitruvian pixel is projected into the MPFB UV.  The actor's existing skin
baseColor is transferred by the light->African cheek delta in D65 CIELAB, then
feathered MPFB-UV masks restore the African region-minus-cheek separations.

Inputs controlling colour are read exclusively from chroma-table.json.  Mask
geometry is reused from the existing MPFB derive station; its cheek boxes and
nose disc are the recorded construction in skin/families/skin_layers.py.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import struct
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parents[5]
DEFAULT_GLB = REPO / "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb"
DEFAULT_PROVENANCE = DEFAULT_GLB.with_suffix(".provenance.json")
DEFAULT_CHROMA = REPO / ".openclinxr/openclaw/ceo/st-vitdark/chroma-table.json"
DEFAULT_DERIVE = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/"
    ".openclinxr/realism-spike/skinfamilies/a1/derive"
)

# Recorded, source-cited mask construction from skin/families/skin_layers.py.
MASK_SOURCE = "tools/openclinxr/asset-pipeline/skin/families/skin_layers.py"
DERIVE_SIZE = 2048.0
NOSE_TIP_COL_ROW = (1773.1, 1058.5)
NOSE_RADIUS_PX = 45.0
CHEEK_COLS = (1690.0, 1930.0)
CHEEK_ROWS = ((850.0, 985.0), (1131.0, 1281.0))
FEATHER_SIGMA_PX = 6.0
LIP_CORNER_UV = ((0.91006, 0.50143), (0.90978, 0.53211))
MOUTH_CORNER_RADIUS_UV = 0.025
STAGE = "vitruvian_dark_cielab_remap_v2"
REGION_DETAIL_SCALE = np.array([0.75, 0.15, 0.15], dtype=np.float64)


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha_file(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float64)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    matrix = np.array(
        [[0.4124564, 0.3575761, 0.1804375],
         [0.2126729, 0.7151522, 0.0721750],
         [0.0193339, 0.1191920, 0.9503041]]
    )
    xyz = lin @ matrix.T / np.array([0.95047, 1.0, 1.08883])
    epsilon, kappa = 0.008856, 903.3
    f = np.where(xyz > epsilon, np.cbrt(xyz), (kappa * xyz + 16.0) / 116.0)
    return np.stack(
        [116.0 * f[..., 1] - 16.0,
         500.0 * (f[..., 0] - f[..., 1]),
         200.0 * (f[..., 1] - f[..., 2])], axis=-1,
    )


def lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16.0) / 116.0
    fx = fy + lab[..., 1] / 500.0
    fz = fy - lab[..., 2] / 200.0
    epsilon, kappa = 0.008856, 903.3

    def invf(v: np.ndarray) -> np.ndarray:
        cube = v ** 3
        return np.where(cube > epsilon, cube, (116.0 * v - 16.0) / kappa)

    xyz = np.stack([invf(fx), invf(fy), invf(fz)], axis=-1)
    xyz *= np.array([0.95047, 1.0, 1.08883])
    inv = np.array(
        [[3.2404542, -1.5371385, -0.4985314],
         [-0.9692660, 1.8760108, 0.0415560],
         [0.0556434, -0.2040259, 1.0572252]]
    )
    lin = xyz @ inv.T
    srgb = np.where(lin <= 0.0031308, 12.92 * lin,
                    1.055 * np.clip(lin, 0.0, None) ** (1.0 / 2.4) - 0.055)
    return np.clip(srgb, 0.0, 1.0)


def ciede2000(l1: np.ndarray, l2: np.ndarray) -> float:
    L1, a1, b1 = (float(v) for v in l1)
    L2, a2, b2 = (float(v) for v in l2)
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    cb = (C1 + C2) / 2.0
    G = 0.5 * (1.0 - math.sqrt(cb ** 7 / (cb ** 7 + 25.0 ** 7)))
    ap1, ap2 = (1.0 + G) * a1, (1.0 + G) * a2
    cp1, cp2 = math.hypot(ap1, b1), math.hypot(ap2, b2)
    hp1 = math.degrees(math.atan2(b1, ap1)) % 360.0
    hp2 = math.degrees(math.atan2(b2, ap2)) % 360.0
    dL, dC = L2 - L1, cp2 - cp1
    dh = hp2 - hp1
    if cp1 * cp2 == 0.0:
        dh = 0.0
    elif abs(dh) > 180.0:
        dh -= 360.0 * (1.0 if dh > 0.0 else -1.0)
    dH = 2.0 * math.sqrt(cp1 * cp2) * math.sin(math.radians(dh / 2.0))
    lp, cp = (L1 + L2) / 2.0, (cp1 + cp2) / 2.0
    if cp1 * cp2 == 0.0:
        hp = hp1 + hp2
    elif abs(hp1 - hp2) <= 180.0:
        hp = (hp1 + hp2) / 2.0
    elif hp1 + hp2 < 360.0:
        hp = (hp1 + hp2 + 360.0) / 2.0
    else:
        hp = (hp1 + hp2 - 360.0) / 2.0
    T = (1.0 - 0.17 * math.cos(math.radians(hp - 30.0))
         + 0.24 * math.cos(math.radians(2.0 * hp))
         + 0.32 * math.cos(math.radians(3.0 * hp + 6.0))
         - 0.20 * math.cos(math.radians(4.0 * hp - 63.0)))
    dro = 30.0 * math.exp(-((hp - 275.0) / 25.0) ** 2)
    rc = 2.0 * math.sqrt(cp ** 7 / (cp ** 7 + 25.0 ** 7))
    sl = 1.0 + 0.015 * (lp - 50.0) ** 2 / math.sqrt(20.0 + (lp - 50.0) ** 2)
    sc, sh = 1.0 + 0.045 * cp, 1.0 + 0.015 * cp * T
    rt = -math.sin(math.radians(2.0 * dro)) * rc
    return math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2
                     + rt * (dC / sc) * (dH / sh))


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
    return doc, raw[bin_header + 8:bin_header + 8 + bin_len]


def encode_glb(doc: dict, binary: bytes) -> bytes:
    json_bytes = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary += b"\0" * ((-len(binary)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    return (b"glTF" + struct.pack("<II", 2, total)
            + struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
            + struct.pack("<II", len(binary), 0x004E4942) + binary)


def view_bytes(doc: dict, binary: bytes, index: int) -> bytes:
    view = doc["bufferViews"][index]
    start = int(view.get("byteOffset", 0))
    return binary[start:start + int(view["byteLength"])]


def skin_image(doc: dict, binary: bytes) -> tuple[int, int, bytes]:
    candidates = []
    for image_index, image in enumerate(doc.get("images", [])):
        name = str(image.get("name", "")).lower()
        if "skin-baked" in name:
            candidates.append((image_index, int(image["bufferView"])))
    if len(candidates) != 1:
        raise RuntimeError(f"expected exactly one skin-baked image, found {candidates}")
    image_index, view_index = candidates[0]
    return image_index, view_index, view_bytes(doc, binary, view_index)


def replace_view(doc: dict, binary: bytes, index: int, payload: bytes) -> bytes:
    view = doc["bufferViews"][index]
    start, old_len = int(view.get("byteOffset", 0)), int(view["byteLength"])
    old_padded = (old_len + 3) & ~3
    new_padded = (len(payload) + 3) & ~3
    delta = new_padded - old_padded
    out = binary[:start] + payload + b"\0" * (new_padded - len(payload)) + binary[start + old_padded:]
    view["byteLength"] = len(payload)
    for i, other in enumerate(doc["bufferViews"]):
        if i == index:
            continue
        offset = int(other.get("byteOffset", 0))
        if offset > start:
            other["byteOffset"] = offset + delta
    doc["buffers"][0]["byteLength"] = len(out)
    return out


def load_mask(derive: Path, name: str, size: int) -> np.ndarray:
    path = derive / name
    if not path.is_file():
        raise RuntimeError(f"missing MPFB UV mask: {path}")
    image = Image.open(path).convert("L").resize((size, size), Image.Resampling.LANCZOS)
    return np.asarray(image, dtype=np.float64) / 255.0


def build_masks(derive: Path, size: int) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    scale = size / DERIVE_SIZE
    core = load_mask(derive, "mask-facecore.png", size)
    lips = load_mask(derive, "mask-lips.png", size)
    ears = np.maximum(load_mask(derive, "mask-ears-L.png", size),
                      load_mask(derive, "mask-ears-R.png", size))
    eyes = np.maximum(load_mask(derive, "mask-eyes-L.png", size),
                      load_mask(derive, "mask-eyes-R.png", size))
    brows = np.maximum(load_mask(derive, "mask-brows-L.png", size),
                       load_mask(derive, "mask-brows-R.png", size))
    occupancy = load_mask(derive, "occupancy.png", size)
    features = np.maximum.reduce([lips, eyes, brows])
    skin = (core > 0.5) & (features <= 0.5) & (occupancy > 0.5)
    rows, cols = np.mgrid[0:size, 0:size]
    nose = (((cols - NOSE_TIP_COL_ROW[0] * scale) ** 2
             + (rows - NOSE_TIP_COL_ROW[1] * scale) ** 2)
            <= (NOSE_RADIUS_PX * scale) ** 2) & skin
    mouth_corner = np.zeros((size, size), dtype=bool)
    for u, v in LIP_CORNER_UV:
        mouth_corner |= ((cols - u * size) ** 2 + (rows - v * size) ** 2
                         <= (MOUTH_CORNER_RADIUS_UV * size) ** 2)
    mouth_corner &= (occupancy > 0.5) & ~(lips > 0.5)
    cheek = np.zeros((size, size), dtype=bool)
    for r0, r1 in CHEEK_ROWS:
        cheek |= ((cols >= CHEEK_COLS[0] * scale) & (cols < CHEEK_COLS[1] * scale)
                  & (rows >= r0 * scale) & (rows < r1 * scale))
    cheek &= skin & ~nose
    fy = np.where(skin)[0]
    if fy.size == 0:
        raise RuntimeError("empty face skin mask")
    forehead = skin & (rows <= fy.min() + int(0.30 * (fy.max() - fy.min())))
    # Measurement regions must be disjoint so each African separation has one owner.
    forehead &= ~cheek & ~nose
    hard = {
        "cheek": cheek,
        "forehead": forehead,
        "lip": (lips > 0.5) & (occupancy > 0.5),
        "ear": (ears > 0.5) & (occupancy > 0.5),
        "nose": nose,
        "mouth_corner": mouth_corner,
        "upper_lid": (eyes > 0.5) & (occupancy > 0.5),
    }
    for name, mask in hard.items():
        if int(mask.sum()) < 32:
            raise RuntimeError(f"{name} mask too small: {int(mask.sum())}")
    soft = {}
    sigma = FEATHER_SIGMA_PX * scale
    for name, mask in hard.items():
        blurred = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma))
        # Keep the Gaussian tail outside the hard measurement mask. Clipping
        # it at the threshold made the r2 correction discontinuous at lip and
        # lid boundaries, which rendered as blue-grey mouth-corner smudges.
        soft[name] = np.asarray(blurred, dtype=np.float64) / 255.0
    return hard, soft


def mean_lab(lab: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return lab[mask].reshape(-1, 3).mean(axis=0)


def stabilize_region(out: np.ndarray, hard: np.ndarray, alpha: np.ndarray,
                     desired_mean: np.ndarray) -> tuple[np.ndarray, dict]:
    """Blend a feature toward its target mean while retaining bounded detail.

    r2 added one Lab delta to every feature pixel. The source lip had strongly
    red pixels beside cheek-coloured corner pixels, so the same negative a*/b*
    delta made the centre saturated red and the corners blue-grey even though
    their *average* passed the atlas gate. Here the target is a colour field:
    luminance detail is retained at 75%, chroma detail at 15%, and its base is
    solved so the hard-mask mean still lands on the authored target.
    """
    current_mean = mean_lab(out, hard)
    detail = (out - current_mean) * REGION_DETAIL_SCALE
    a = alpha[..., None]
    fixed = out * (1.0 - a) + detail * a
    alpha_mean = float(alpha[hard].mean())
    target_base = (desired_mean - mean_lab(fixed, hard)) / alpha_mean
    candidate = target_base + detail
    blended = out * (1.0 - a) + candidate * a
    return blended, {
        "mode": "target_field_with_bounded_detail",
        "alpha_mean": alpha_mean,
        "source_mean_lab": [float(v) for v in current_mean],
        "desired_mean_lab": [float(v) for v in desired_mean],
        "target_base_lab": [float(v) for v in target_base],
        "detail_scale_lab": [float(v) for v in REGION_DETAIL_SCALE],
    }


def african_target(chroma: dict, region: str) -> np.ndarray:
    return np.asarray(chroma["african"][region]["lab_d65"], dtype=np.float64)


def patch_separation_sd(chroma: dict, region: str, channel: int) -> float:
    vals = []
    for target in chroma["african"][region]["patches"]:
        for forehead in chroma["african"]["forehead"]["patches"]:
            vals.append(float(target["lab_d65"][channel]) - float(forehead["lab_d65"][channel]))
    return float(np.std(np.asarray(vals), ddof=1))


def metrics(lab: np.ndarray, hard: dict[str, np.ndarray], chroma: dict) -> dict:
    means = {name: mean_lab(lab, mask) for name, mask in hard.items()}
    target_forehead = african_target(chroma, "forehead")
    target_cheek = african_target(chroma, "cheek")
    rows = {}
    for region in ("lip", "ear", "nose"):
        actual = means[region] - means["forehead"]
        target = african_target(chroma, region) - target_forehead
        tol_a = 2.0 * patch_separation_sd(chroma, region, 1)
        tol_b = 2.0 * patch_separation_sd(chroma, region, 2)
        rows[region] = {
            "actual_region_minus_forehead": [float(v) for v in actual],
            "african_region_minus_forehead": [float(v) for v in target],
            "absolute_error_a_star": abs(float(actual[1] - target[1])),
            "absolute_error_b_star": abs(float(actual[2] - target[2])),
            "two_x_patch_sd_a_star": tol_a,
            "two_x_patch_sd_b_star": tol_b,
            "pass": abs(float(actual[1] - target[1])) <= tol_a
                    and abs(float(actual[2] - target[2])) <= tol_b,
        }
    actual_de = ciede2000(means["forehead"], means["cheek"])
    target_de = ciede2000(target_forehead, target_cheek)
    floor = float(chroma["noise"]["floor_two_x_sd"])
    return {
        "mean_lab": {k: [float(v) for v in value] for k, value in means.items()},
        "regions": rows,
        "forehead_to_cheek": {
            "actual_ciede2000": actual_de,
            "african_ciede2000": target_de,
            "absolute_error": abs(actual_de - target_de),
            "floor": floor,
            "pass": abs(actual_de - target_de) <= floor,
        },
    }


def remap(rgb: np.ndarray, hard: dict[str, np.ndarray], soft: dict[str, np.ndarray],
          chroma: dict, zero_separations: bool) -> tuple[np.ndarray, dict]:
    lab = srgb_to_lab(rgb)
    light_cheek = np.asarray(chroma["light"]["cheek"]["lab_d65"], dtype=np.float64)
    dark_cheek = african_target(chroma, "cheek")
    # Express the transfer as the required Vitruvian light->African cheek pair,
    # plus a measured input-anchor correction. This makes the stage safe after
    # the deep_warm token reaches a future fresh bake: the actor cheek still
    # lands on the African cheek instead of receiving darkness twice.
    pair_delta = dark_cheek - light_cheek
    actor_cheek = mean_lab(lab, hard["cheek"])
    input_anchor_delta = light_cheek - actor_cheek
    global_delta = pair_delta + input_anchor_delta
    out = lab + global_delta
    cheek_mean = mean_lab(out, hard["cheek"])
    corrections = {}
    for region in ("forehead", "ear", "nose"):
        target_sep = (np.zeros(3) if zero_separations else
                      african_target(chroma, region) - dark_cheek)
        desired = cheek_mean + target_sep
        current = mean_lab(out, hard[region])
        alpha_mean = float(soft[region][hard[region]].mean())
        correction = (desired - current) / alpha_mean
        out += soft[region][..., None] * correction
        corrections[region] = {
            "mode": "additive_delta",
            "target_region_minus_cheek": [float(v) for v in target_sep],
            "alpha_mean": alpha_mean,
            "lab_correction": [float(v) for v in correction],
        }
    lip_target_sep = (np.zeros(3) if zero_separations else
                      african_target(chroma, "lip") - dark_cheek)
    # The mouth corners are outside the vermilion mask but carried the r2
    # blue-grey patches after the global transfer. Their centres come from the
    # same shipped-UV landmarks consumed by xr-scene/skin-shader.
    out, corner_record = stabilize_region(
        out, hard["mouth_corner"], soft["mouth_corner"], cheek_mean,
    )
    corrections["mouth_corner"] = corner_record
    out, lip_record = stabilize_region(
        out, hard["lip"], soft["lip"], cheek_mean + lip_target_sep,
    )
    corrections["lip"] = {
        **lip_record,
        "target_region_minus_cheek": [float(v) for v in lip_target_sep],
    }
    # The eyelid has no independent Vitruvian target. Treat it as a near-cheek
    # control so the light atlas's orange crease cannot survive the large dark
    # transfer as a saturated band. This does not touch the separate eye image.
    out, lid_record = stabilize_region(
        out, hard["upper_lid"], soft["upper_lid"], cheek_mean,
    )
    corrections["upper_lid"] = lid_record
    encoded = lab_to_srgb(out)
    # The gate grades shipped 8-bit PNG bytes, not the pre-quantized float array.
    quantized = np.rint(encoded * 255.0).astype(np.uint8)
    final_rgb = quantized.astype(np.float64) / 255.0
    return quantized, {
        "global_cheek_delta_lab": [float(v) for v in global_delta],
        "vitruvian_light_to_african_cheek_delta_lab": [float(v) for v in pair_delta],
        "input_cheek_to_vitruvian_light_anchor_delta_lab": [float(v) for v in input_anchor_delta],
        "corrections": corrections,
        "metrics": metrics(srgb_to_lab(final_rgb), hard, chroma),
    }


def multiply_control(rgb: np.ndarray, hard: dict[str, np.ndarray], chroma: dict) -> dict:
    k = np.asarray(chroma["cheek_multiply"]["k_rgb"], dtype=np.float64)
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    multiplied = np.clip(linear * k, 0.0, 1.0)
    encoded = np.where(multiplied <= 0.0031308, 12.92 * multiplied,
                       1.055 * multiplied ** (1.0 / 2.4) - 0.055)
    quantized = np.rint(np.clip(encoded, 0.0, 1.0) * 255.0).astype(np.uint8)
    return metrics(srgb_to_lab(quantized.astype(np.float64) / 255.0), hard, chroma)


def image_hashes(doc: dict, binary: bytes) -> dict[str, str]:
    return {str(image.get("name", f"image-{i}")): sha_bytes(view_bytes(doc, binary, int(image["bufferView"])))
            for i, image in enumerate(doc.get("images", []))}


def buffer_view_hashes(doc: dict, binary: bytes) -> list[str]:
    return [sha_bytes(view_bytes(doc, binary, index))
            for index in range(len(doc.get("bufferViews", [])))]


def update_provenance(path: Path, record: dict, output_sha: str, output_bytes: int) -> None:
    provenance = json.loads(path.read_text())
    provenance["outputSha256"] = output_sha
    provenance["outputBytes"] = output_bytes
    provenance["vitruvianDarkRemap"] = record
    notes = provenance.setdefault("sourceNotes", [])
    note = ("2026-11-04 st-vitdark r3: render-defect correction in the post-export CIELAB "
            "skin remap; feather tails cross feature boundaries and lip/lid chroma uses a "
            "bounded-detail target field instead of a single per-feature delta; geometry/rig/"
            "animations and every non-skin image remain byte-identical.")
    if note not in notes:
        notes.append(note)
    path.write_text(json.dumps(provenance, indent=1, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", type=Path, default=DEFAULT_GLB)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--input-revision", default=None,
                        help="read --glb bytes from a pinned git revision (reproducible pre-stage input)")
    parser.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    parser.add_argument("--chroma-table", type=Path, default=DEFAULT_CHROMA)
    parser.add_argument("--derive-dir", type=Path,
                        default=Path(os.environ.get("MPFB_UV_DERIVE_DIR", DEFAULT_DERIVE)))
    parser.add_argument("--report", type=Path, default=Path(__file__).with_name("report.json"))
    parser.add_argument("--zero-region-separations", action="store_true")
    parser.add_argument("--no-provenance", action="store_true")
    args = parser.parse_args()
    output = args.output or args.glb
    if args.input_revision:
        rel = args.glb.resolve().relative_to(REPO).as_posix()
        source_raw = subprocess.run(
            ["git", "show", f"{args.input_revision}:{rel}"], cwd=REPO,
            check=True, capture_output=True,
        ).stdout
    else:
        source_raw = args.glb.read_bytes()
    source_sha = sha_bytes(source_raw)
    doc, binary = parse_glb(source_raw)
    _, skin_view, skin_bytes = skin_image(doc, binary)
    source_images = image_hashes(doc, binary)
    source_views = buffer_view_hashes(doc, binary)
    image = Image.open(io.BytesIO(skin_bytes)).convert("RGB")
    rgb = np.asarray(image, dtype=np.float64) / 255.0
    if image.width != image.height:
        raise RuntimeError(f"skin atlas must be square, got {image.size}")
    chroma = json.loads(args.chroma_table.read_text())
    hard, soft = build_masks(args.derive_dir, image.width)
    remapped_u8, transfer = remap(rgb, hard, soft, chroma, args.zero_region_separations)
    png_io = io.BytesIO()
    Image.fromarray(remapped_u8, "RGB").save(png_io, format="PNG", compress_level=9)
    new_skin = png_io.getvalue()
    stage_record = {
        "stage": STAGE,
        "probeZeroRegionSeparations": args.zero_region_separations,
        "tool": "tools/openclinxr/asset-pipeline/skin/vitruvian_dark/vitruvian_dark_remap.py",
        "inputGlbSha256": source_sha,
        "inputSkinSha256": sha_bytes(skin_bytes),
        "outputSkinSha256": sha_bytes(new_skin),
        "chromaTable": str(args.chroma_table.relative_to(REPO)),
        "chromaTableSha256": sha_file(args.chroma_table),
        "maskSource": MASK_SOURCE,
        "deriveDir": str(args.derive_dir),
        "sourceMaps": {
            "upstreamCommit": "c036e5376108dc44065beb0a3f4ef8eac463e039",
            "lightSha256": "e28f1154c88bd4eb08bfb25ba2a7e8892b486877bf69b8fdd8f4af1cbacb87a4",
            "africanSha256": "20d9c249b66c32dc6327e1fa6682b47a9ff4efc58a2f1c9ad2c7a054d8b4bfa6",
            "licence": "CC0-1.0",
        },
        "transfer": transfer,
    }
    extras = doc.setdefault("asset", {}).setdefault("extras", {})
    extras["openClinXrVitruvianDarkRemap"] = stage_record
    new_binary = replace_view(doc, binary, skin_view, new_skin)
    output_raw = encode_glb(doc, new_binary)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(output_raw)
    out_doc, out_binary = parse_glb(output_raw)
    output_images = image_hashes(out_doc, out_binary)
    output_views = buffer_view_hashes(out_doc, out_binary)
    unchanged = {name: source_images[name] == digest for name, digest in output_images.items()
                 if name != doc["images"][next(i for i, x in enumerate(doc["images"])
                                              if "skin-baked" in str(x.get("name", "")).lower())]["name"]}
    unchanged_views = {
        str(index): source_views[index] == output_views[index]
        for index in range(len(source_views)) if index != skin_view
    }
    report = {
        "stage": STAGE,
        "input": {"path": str(args.glb), "sha256": source_sha, "bytes": len(source_raw)},
        "inputRevision": args.input_revision,
        "output": {"path": str(output), "sha256": sha_bytes(output_raw), "bytes": len(output_raw)},
        "probeZeroRegionSeparations": args.zero_region_separations,
        "sourceImageSha256": source_images,
        "outputImageSha256": output_images,
        "nonSkinImagesUnchanged": unchanged,
        "allNonSkinImagesUnchanged": all(unchanged.values()),
        "nonSkinBufferViewsUnchanged": unchanged_views,
        "allNonSkinBufferViewsUnchanged": all(unchanged_views.values()),
        "maskCounts": {name: int(mask.sum()) for name, mask in hard.items()},
        "multiplyControl": multiply_control(rgb, hard, chroma),
        **transfer,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=1) + "\n")
    if not args.no_provenance and not args.zero_region_separations:
        update_provenance(args.provenance, stage_record, report["output"]["sha256"], len(output_raw))
    print(json.dumps({
        "output": report["output"],
        "regions": report["metrics"]["regions"],
        "foreheadToCheek": report["metrics"]["forehead_to_cheek"],
        "multiplyLip": report["multiplyControl"]["regions"]["lip"],
        "nonSkinImagesUnchanged": report["allNonSkinImagesUnchanged"],
    }, indent=1))


if __name__ == "__main__":
    main()
