#!/usr/bin/env python3
"""Measure i2 runtime stills against the accepted Imagine references.

Runtime cheek uses the central 64% of the subject rectangle recorded by the
capture writer, intersected with the lit skin-chroma rule. Reference cheek
keeps the accepted S1b path. Forearm/neck use the largest lit skin component's
deepest 50%, followed by inclusive p5..p95 L* trimming. Reference card boxes
are the pre-result GREY_BOXES from s1/measure_s1.py. No missing value is imputed.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SUBJECTS = ("warm_light", "warm_medium", "young", "middle", "old")
REGIONS = ("cheek", "forearm", "neck")
CAPTURE_REGION = {"cheek": "head", "forearm": "forearm-close", "neck": "neck-close"}
GREY_BOXES = {
    "warm_light:cheek": [[8, 8, 104, 1016]], "warm_light:forearm": [[947, 178, 1024, 642]],
    "warm_light:neck": [[912, 132, 1024, 712]], "warm_medium:cheek": [[8, 8, 104, 1016]],
    "warm_medium:forearm": [[890, 418, 1016, 950]], "warm_medium:neck": [[936, 126, 1016, 754]],
    "young:cheek": [[8, 8, 137, 834]], "young:forearm": [[55, 830, 405, 1016]],
    "young:neck": [[12, 594, 123, 700], [12, 718, 123, 858]],
    "middle:cheek": [[8, 8, 179, 1016]], "middle:forearm": [[909, 82, 1016, 470]],
    "middle:neck": [[8, 8, 194, 498], [8, 517, 189, 1016]],
    "old:cheek": [[910, 8, 1016, 340], [788, 359, 1016, 1016]],
    "old:forearm": [[812, 8, 1016, 1016]], "old:neck": [[938, 44, 1016, 961]],
}
CHEEK_TOOLS = None


def load_exact_cheek_tools(s1b_dir: Path):
    """Load the exact S1b primary FaceLandmarker + documented fallback path."""
    path = s1b_dir / "measure_s1b.py"
    spec = importlib.util.spec_from_file_location("st_skinref_i2_s1b", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import exact S1b cheek implementation: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    flr = module.S1.load_face_module()
    landmarker = module.S1.create_cpu_landmarker(flr)
    return module, landmarker, flr


def args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("e", type=Path, nargs="?", help="st-skinref evidence directory")
    p.add_argument("--renders", type=Path, help="capture root (default E/i2)")
    p.add_argument("--out", type=Path, help="report path (default <renders>/measurements.json)")
    p.add_argument("--v4-no-card", action="store_true", help="dry-run legacy renders without a card")
    p.add_argument("--s1b-dir", type=Path,
                   help="directory containing measure_s1b.py (required for reference cheek or neck)")
    p.add_argument("--cheek-mask-json", nargs=2, type=Path, metavar=("TILE", "NUMBERS"),
                   help="print the runtime cheek mask record for one tile and numbers.json")
    return p.parse_args()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    x = np.asarray(rgb, dtype=np.float64) / 255.0
    return np.where(x <= .04045, x / 12.92, ((x + .055) / 1.055) ** 2.4)


def linear_to_lab(linear: np.ndarray) -> np.ndarray:
    xyz = np.asarray(linear, dtype=np.float64) @ np.array([
        [.4124564, .3575761, .1804375], [.2126729, .7151522, .0721750],
        [.0193339, .1191920, .9503041],
    ]).T
    xyz /= np.array([.95047, 1.0, 1.08883])
    d = 6 / 29
    f = np.where(xyz > d ** 3, np.cbrt(xyz), xyz / (3 * d ** 2) + 4 / 29)
    return np.stack((116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]),
                     200 * (f[..., 1] - f[..., 2])), axis=-1)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    return linear_to_lab(srgb_to_linear(rgb))


def r4(v) -> list[float]:
    return [round(float(x), 4) for x in v]


def largest_component(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(ndimage.binary_opening(mask, structure=np.ones((3, 3), bool)))
    if not count:
        return np.zeros(mask.shape, bool)
    sizes = np.bincount(labels.ravel()); sizes[0] = 0
    return labels == int(sizes.argmax())


def deepest_half(component: np.ndarray) -> np.ndarray:
    ys, xs = np.where(component)
    out = np.zeros(component.shape, bool)
    if not len(xs):
        return out
    distance = ndimage.distance_transform_edt(component)
    order = np.argsort(-distance[ys, xs], kind="stable")[:math.ceil(len(xs) / 2)]
    out[ys[order], xs[order]] = True
    return out


def exclude_box(mask: np.ndarray, box: list[int] | dict) -> None:
    values = list(box.values()) if isinstance(box, dict) else box
    if len(values) != 4:
        raise RuntimeError(f"greyCardBoxPx must have four coordinates, got {box}")
    x0, y0, x1, y1 = (int(value) for value in values)
    mask[max(0, y0):min(mask.shape[0], y1), max(0, x0):min(mask.shape[1], x1)] = False


def chin_y(rgb: np.ndarray) -> float | None:
    """FaceLandmarker landmark 152 (chin) y in pixels, or None when no face is found."""
    if CHEEK_TOOLS is None:
        raise RuntimeError("--s1b-dir is required for the FaceLandmarker neck path")
    import mediapipe as mp
    _, landmarker, _ = CHEEK_TOOLS
    result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    if not result.face_landmarks:
        return None
    return float(result.face_landmarks[0][152].y * rgb.shape[0])


def neck_rows(component: np.ndarray, rgb: np.ndarray) -> tuple[np.ndarray | None, str]:
    """super-ceo I2 neck rule: skin component rows strictly below chin landmark 152, same rule on runtime and refs."""
    cy = chin_y(rgb)
    if cy is None:
        return None, "neck rule: FaceLandmarker detected no face; neck UNMEASURABLE"
    out = component.copy(); out[: int(math.floor(cy)) + 1, :] = False
    return out, f"neck rule: skin component rows below FaceLandmarker chin 152 (y={cy:.1f}px)"


def rect_values(box: list[int] | dict) -> tuple[int, int, int, int]:
    values = list(box.values()) if isinstance(box, dict) else box
    if len(values) != 4:
        raise RuntimeError(f"rectangle must have four coordinates, got {box}")
    return tuple(int(value) for value in values)


def runtime_cheek_mask(rgb: np.ndarray, grey_card_box: list[int] | dict,
                       subject_crop_box: list[int] | dict) -> tuple[np.ndarray, str, str | None]:
    method = ("runtime lit + skin-chroma intersection within central 64% of numbers.json "
              "subjectCropPx (0.18..0.82 on each axis); greyCardBoxPx subtracted")
    x0, y0, x1, y1 = rect_values(subject_crop_box)
    if x1 <= x0 or y1 <= y0:
        return np.zeros(rgb.shape[:2], bool), method, "recorded subject rect has zero area"
    domain = np.zeros(rgb.shape[:2], bool)
    dx0 = math.ceil(x0 + .18 * (x1 - x0)); dx1 = math.ceil(x0 + .82 * (x1 - x0))
    dy0 = math.ceil(y0 + .18 * (y1 - y0)); dy1 = math.ceil(y0 + .82 * (y1 - y0))
    domain[max(0, dy0):min(rgb.shape[0], dy1), max(0, dx0):min(rgb.shape[1], dx1)] = True
    lab = rgb_to_lab(rgb); L, a, b = np.moveaxis(lab, -1, 0)
    lit = (np.abs(rgb[..., 0].astype(int) - 0x18)
           + np.abs(rgb[..., 1].astype(int) - 0x21)
           + np.abs(rgb[..., 2].astype(int) - 0x1d)) > 36
    mask = domain & lit & (L >= 8) & (L <= 98) & (a >= 1) & (a <= 45) & (b >= 3) & (b <= 55)
    exclude_box(mask, grey_card_box)
    if not np.any(mask):
        return mask, method, "recorded cheek domain has 0 skin pixels"
    return mask, method, None


def skin_mask(rgb: np.ndarray, region: str, runtime: bool,
              grey_card_box: list[int] | dict | None = None) -> tuple[np.ndarray, str]:
    if runtime and grey_card_box is None:
        raise RuntimeError("runtime skin mask requires region greyCardBoxPx")
    if region == "cheek":
        if runtime:
            raise RuntimeError("runtime cheek requires runtime_cheek_mask with subjectCropPx")
        if CHEEK_TOOLS is None:
            raise RuntimeError("--s1b-dir is required for the reference S1b cheek path")
        s1b, landmarker, flr = CHEEK_TOOLS
        mask, info = s1b.cheek_mask(rgb, landmarker, flr)
        method = str(info.get("method", "S1b cheek mask"))
        if info.get("landmarkerFailure"):
            method += f"; fallback after FaceLandmarker failure: {info['landmarkerFailure']}"
        else:
            method += "; primary FaceLandmarker cheek_side polygon intersected with 3px-eroded largest skin component"
        return mask, method
    lab = rgb_to_lab(rgb); L, a, b = np.moveaxis(lab, -1, 0)
    if runtime:
        lit = (np.abs(rgb[..., 0].astype(int) - 0x18)
               + np.abs(rgb[..., 1].astype(int) - 0x21)
               + np.abs(rgb[..., 2].astype(int) - 0x1d)) > 36
        raw = lit & (L >= 8) & (L <= 98) & (a >= 1) & (a <= 45) & (b >= 3) & (b <= 55)
        exclude_box(raw, grey_card_box)
    else:
        raw = (L >= 18) & (L <= 96) & (a >= 2) & (a <= 35) & (b >= 5) & (b <= 45)
    component = largest_component(raw)
    method = "S1/S1b largest fixed skin-chroma component; exact deepest 50% by distance transform"
    if region == "neck":
        below, note = neck_rows(component, rgb)
        if below is None:
            return np.zeros(component.shape, bool), method + "; " + note
        component = largest_component(below); method += "; " + note + " (largest component of the remainder)"
    if runtime:
        method += "; region greyCardBoxPx subtracted before component selection"
    return deepest_half(component), method


def lab_stats(rgb: np.ndarray, mask: np.ndarray) -> dict | None:
    pixels = rgb[mask]
    if len(pixels) < 300:
        return None
    labs = rgb_to_lab(pixels); lo, hi = np.percentile(labs[:, 0], [5, 95])
    kept = labs[(labs[:, 0] >= lo) & (labs[:, 0] <= hi)]
    if len(kept) < 250:
        return None
    return {"Lab": r4(np.median(kept, axis=0)), "pixelCountBeforeTrim": int(len(labs)),
            "pixelCountAfterTrim": int(len(kept)), "trim": "inclusive p5-p95 L*"}


def normalize(rgb: np.ndarray, card_srgb: np.ndarray) -> np.ndarray:
    # Binding N1: linearise IEC 61966-2-1, von-Kries divide, set card to 18%; never scale L*.
    return np.clip(srgb_to_linear(rgb) / np.maximum(srgb_to_linear(card_srgb), 1e-9) * .18, 0, 1)


def normalized_stats(rgb: np.ndarray, mask: np.ndarray, card_srgb: np.ndarray) -> dict | None:
    pixels = linear_to_lab(normalize(rgb[mask], card_srgb))
    if len(pixels) < 300:
        return None
    lo, hi = np.percentile(pixels[:, 0], [5, 95]); kept = pixels[(pixels[:, 0] >= lo) & (pixels[:, 0] <= hi)]
    return None if len(kept) < 250 else {"Lab": r4(np.median(kept, axis=0)),
        "pixelCountBeforeTrim": int(len(pixels)), "pixelCountAfterTrim": int(len(kept)), "trim": "inclusive p5-p95 L*"}


def ref_path(refs: Path, subject: str, region: str) -> Path:
    return refs / "regen/young_forearm_v2.jpg" if (subject, region) == ("young", "forearm") else refs / f"{subject}_{region}.jpg"


def reference_record(path: Path, key: str, region: str) -> dict:
    rgb = np.asarray(Image.open(path).convert("RGB")); mask, method = skin_mask(rgb, region, False)
    candidates = []
    for index, box in enumerate(GREY_BOXES[key]):
        x0, y0, x1, y1 = box; patch = rgb[y0:y1, x0:x1].reshape(-1, 3)
        labs = rgb_to_lab(patch); med_rgb = np.median(patch, axis=0); med_lab = np.median(labs, axis=0)
        mad = np.median(np.abs(patch - med_rgb), axis=0)
        lit_fraction = float(np.mean((labs[:, 0] >= 10) & (np.hypot(labs[:, 1], labs[:, 2]) <= 15)))
        valid = math.hypot(med_lab[1], med_lab[2]) <= 10 and float(mad.max()) <= 12 and lit_fraction >= .90
        candidates.append({"index": index, "box": box, "pixelCount": len(patch), "srgbMedian": r4(med_rgb),
                           "rawMedianLab": r4(med_lab), "madSrgb": r4(mad),
                           "litFraction": round(lit_fraction, 6), "valid": valid})
    valid = [x for x in candidates if x["valid"]]
    chosen = max(valid, key=lambda x: (x["pixelCount"], -x["index"])) if valid else None
    raw = lab_stats(rgb, mask)
    normal = normalized_stats(rgb, mask, np.asarray(chosen["srgbMedian"])) if chosen else None
    reason = None
    if chosen is None:
        reason = "no readable reference card"
    elif raw is None:
        reason = "reference skin patch below 300 input or 250 retained pixels"
    elif normal is None:
        reason = "reference normalized skin patch below 300 input or 250 retained pixels"
    return {"path": str(path), "sha256": sha(path), "cardMaskMethod":
            "S1 pre-result fixed conservative card interiors; readable iff chroma<=10, max channel MAD<=12 and >=90% pixels have L*>=10,C*<=15",
            "cards": candidates, "chosenCard": chosen, "skinPatchMethod": method,
            "raw": raw, "normalized": normal, "unmeasurable": chosen is None or raw is None or normal is None,
            "unmeasurableReason": reason}


def one_hit(root: Path, pattern: str) -> Path | None:
    hits = sorted(root.glob(pattern))
    return hits[0] if len(hits) == 1 else None


def recursive_find(value, key: str):
    if isinstance(value, dict):
        if key in value:
            return value[key]
        for child in value.values():
            found = recursive_find(child, key)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = recursive_find(child, key)
            if found is not None:
                return found
    return None


def runtime_paths(renders: Path, subject: str, region: str, v4: bool) -> tuple[Path | None, Path | None]:
    base = renders / f"{subject}-{CAPTURE_REGION[region]}"
    framing = CAPTURE_REGION[region] if region != "cheek" else "cheek"
    region_root = base if v4 else base / "region"
    image = one_hit(region_root, f"*/runtime/{framing}/new.png")
    if image is None:
        image = one_hit(region_root, f"**/runtime/{framing}/new.png")
    card_num = None if v4 else one_hit(base / "card", "**/runtime/*/numbers.json")
    return image, card_num


def select_runtime_mask(rgb: np.ndarray, region: str, region_numbers: dict) -> tuple[np.ndarray | None, str, str | None]:
    grey_card_box = region_numbers["greyCardBoxPx"]
    if region == "cheek":
        subject_crop_box = region_numbers.get("subjectCropPx")
        if subject_crop_box is None:
            return None, "", "no recorded subject rect"
        return runtime_cheek_mask(rgb, grey_card_box, subject_crop_box)
    mask, method = skin_mask(rgb, region, True, grey_card_box)
    return mask, method, None


def runtime_record(renders: Path, subject: str, region: str, v4: bool, mask_source: Path | None = None) -> dict:
    # mask_source (grey-body P1, super-ceo-cap8 2026-11-10): the skin patch is selected on the capture of the
    # same subject/region under mask_source (the baseline skin) and applied to this capture. A grey-body
    # surface has no skin chroma, so a chroma gate on it selects nothing (L50) or an arbitrary patch (L18).
    # Requires identical image size and grey-card box.
    image_path, card_path = runtime_paths(renders, subject, region, v4)
    if image_path is None:
        return {"unmeasurable": True, "unmeasurableReason": "runtime still missing", "card": "no card (v4)" if v4 else "missing"}
    if v4:
        numbers_path = image_path.with_name("numbers.json")
        numbers = json.loads(numbers_path.read_text())
        region_key = CAPTURE_REGION[region] if region != "cheek" else "cheek"
        patch = numbers["regions"][region_key]["new"]
        raw = {"Lab": r4(patch["meanCielabD65"]), "pixelCountBeforeTrim": patch["pixelCount"],
               "pixelCountAfterTrim": patch["pixelCount"], "trim": "v4 numbers.json region aggregate (dry-run only)"}
        return {"path": str(image_path), "sha256": sha(image_path),
                "skinPatchMethod": numbers["regions"][region_key].get("maskMethod", "v4 numbers.json region mask"),
                "raw": raw, "normalized": None, "card": "no card (v4)", "cardLitFraction": None,
                "unmeasurable": True, "unmeasurableReason": "no card (v4)"}
    region_numbers_path = image_path.with_name("numbers.json")
    if not region_numbers_path.exists():
        return {"path": str(image_path), "sha256": sha(image_path), "raw": None, "normalized": None,
                "greyCardBoxPx": None, "card": "unreadable", "cardLitFraction": None,
                "unmeasurable": True, "unmeasurableReason": "region numbers.json missing; cannot resolve greyCardBoxPx"}
    region_numbers = json.loads(region_numbers_path.read_text())
    grey_card_box = region_numbers.get("greyCardBoxPx")
    if grey_card_box is None:
        return {"path": str(image_path), "sha256": sha(image_path), "raw": None, "normalized": None,
                "regionNumbersPath": str(region_numbers_path), "greyCardBoxPx": None,
                "card": "unreadable", "cardLitFraction": None, "unmeasurable": True,
                "unmeasurableReason": "region numbers.json lacks greyCardBoxPx; refusing unmasked runtime skin patch"}
    rgb = np.asarray(Image.open(image_path).convert("RGB"))
    subject_crop_box = region_numbers.get("subjectCropPx")
    if mask_source is None:
        mask, method, mask_reason = select_runtime_mask(rgb, region, region_numbers)
    else:
        source_image, _ = runtime_paths(mask_source, subject, region, False)
        source_numbers = json.loads(source_image.with_name("numbers.json").read_text()) if source_image else None
        source_rgb = np.asarray(Image.open(source_image).convert("RGB")) if source_image else None
        if source_image is None or source_numbers.get("greyCardBoxPx") is None:
            mask, method, mask_reason = None, "", f"patch: mask source capture missing under {mask_source}"
        elif source_rgb.shape != rgb.shape or source_numbers.get("greyCardBoxPx") != grey_card_box:
            mask, method, mask_reason = None, "", (f"patch: mask source frame differs (shape {source_rgb.shape} vs {rgb.shape}, "
                                                   f"card box {source_numbers.get('greyCardBoxPx')} vs {grey_card_box})")
        else:
            mask, source_method, mask_reason = select_runtime_mask(source_rgb, region, source_numbers)
            method = f"mask selected on {source_image} (sha256 {sha(source_image)[:12]}) and applied here: {source_method}"
    if mask_reason is not None:
        return {"path": str(image_path), "sha256": sha(image_path), "skinPatchMethod": method,
                "raw": None, "normalized": None, "regionNumbersPath": str(region_numbers_path),
                "greyCardBoxPx": grey_card_box, "subjectCropPx": subject_crop_box,
                "card": "not_read", "cardLitFraction": None, "unmeasurable": True,
                "unmeasurableReason": mask_reason}
    raw = lab_stats(rgb, mask)
    if card_path is None:
        return {"path": str(image_path), "sha256": sha(image_path), "skinPatchMethod": method,
                "raw": raw, "normalized": None, "card": "missing", "cardLitFraction": None,
                "unmeasurable": True, "unmeasurableReason": "runtime card output missing"}
    doc = json.loads(card_path.read_text()); card = recursive_find(doc, "cardLab") or {}
    gate = recursive_find(doc, "cardGate") or {}
    srgb = card.get("srgbMedian"); lab = card.get("rawMedianLab")
    lit = gate.get("cardBoxLitFraction")
    if lit is None:
        lit = recursive_find(doc, "cardBoxLitFraction")
    readable = srgb is not None and lab is not None and lit is not None and float(lit) >= .90
    normal = normalized_stats(rgb, mask, np.asarray(srgb)) if readable and raw else None
    return {"path": str(image_path), "sha256": sha(image_path), "regionNumbersPath": str(region_numbers_path),
            "greyCardBoxPx": grey_card_box, "skinPatchMethod": method, "raw": raw,
            "normalized": normal, "card": {"numbersPath": str(card_path), "srgbMedian": srgb, "rawMedianLab": lab},
            "cardLitFraction": lit, "unmeasurable": not readable or raw is None or normal is None,
            "maskPixelCount": int(mask.sum()),
            "unmeasurableReason": None if readable and raw and normal else (
                "card: runtime card unreadable or <90% lit" if not readable
                else "patch: fewer than 300 masked pixels (or 250 after the p5-p95 L* trim)" if raw is None
                else "patch: normalized patch empty")}


def cheek_mask_record(tile_path: Path, numbers_path: Path) -> dict:
    numbers = json.loads(numbers_path.read_text())
    subject_crop_box = numbers.get("subjectCropPx")
    if subject_crop_box is None:
        return {"unmeasurable": True, "unmeasurableReason": "no recorded subject rect"}
    grey_card_box = numbers.get("greyCardBoxPx")
    if grey_card_box is None:
        return {"unmeasurable": True, "unmeasurableReason": "no recorded grey card rect"}
    rgb = np.asarray(Image.open(tile_path).convert("RGB"))
    mask, method, reason = runtime_cheek_mask(rgb, grey_card_box, subject_crop_box)
    if reason is not None:
        return {"method": method, "pixelCount": 0, "unmeasurable": True,
                "unmeasurableReason": reason}
    ys, xs = np.where(mask)
    stats = lab_stats(rgb, mask)
    return {"method": method, "pixelCount": int(len(xs)), "Lab": stats["Lab"] if stats else None,
            "bbox": {"x0": int(xs.min()), "y0": int(ys.min()),
                     "x1": int(xs.max()) + 1, "y1": int(ys.max()) + 1},
            "unmeasurable": False, "unmeasurableReason": None}


def main() -> None:
    global CHEEK_TOOLS
    a = args()
    if a.cheek_mask_json is not None:
        print(json.dumps(cheek_mask_record(*a.cheek_mask_json)))
        return
    if a.e is None:
        raise RuntimeError("e is required unless --cheek-mask-json is used")
    e = a.e.resolve(); renders = (a.renders or e / "i2").resolve(); out = (a.out or renders / "measurements.json").resolve()
    CHEEK_TOOLS = load_exact_cheek_tools(a.s1b_dir.resolve()) if a.s1b_dir is not None else None
    refs = Path("/Volumes/files/openclinxr-assets/store/st-skinref/imagine-v3")
    manifest = {rel.removeprefix("./"): digest for digest, rel in
                (line.split(None, 1) for line in (refs / "MANIFEST.sha256").read_text().splitlines())}
    verdict_doc = json.loads((e / "verdicts-v37.json").read_text()); rows = {}
    hash_checks = []
    for subject in SUBJECTS:
        for region in REGIONS:
            key = f"{subject}:{region}"; path = ref_path(refs, subject, region); rel = str(path.relative_to(refs))
            actual = sha(path); expected = manifest.get(rel); hash_checks.append({"key": key, "path": rel, "expected": expected, "actual": actual, "pass": actual == expected})
            if actual != expected:
                raise RuntimeError(f"reference SHA256 mismatch {key}: {actual} != {expected}")
            ref = reference_record(path, key, region); runtime = runtime_record(renders, subject, region, a.v4_no_card)
            for rec in (ref, runtime):
                if region == "neck" and "neck UNMEASURABLE" in str(rec.get("skinPatchMethod", "")):
                    rec.update({"unmeasurable": True, "unmeasurableReason": "reference neck is a lateral close-up; no face landmarks, so the chin rule cannot place a neck mask" if rec is ref else "runtime neck: FaceLandmarker no face, so the chin rule cannot place a neck mask"})
            measurable = not ref["unmeasurable"] and not runtime["unmeasurable"]
            rn = runtime.get("normalized", {}).get("Lab") if runtime.get("normalized") else None
            fn = ref.get("normalized", {}).get("Lab") if ref.get("normalized") else None
            delta = [round(rn[i] - fn[i], 4) for i in range(3)] if measurable else [None] * 3
            d_c = round(math.hypot(rn[1], rn[2]) - math.hypot(fn[1], fn[2]), 4) if measurable else None
            d_e = round(math.sqrt(sum(x*x for x in delta)), 4) if measurable else None
            verdict = verdict_doc["verdicts"][key]
            app_matched = subject != "warm_medium"
            contaminated = subject == "warm_medium"
            sign = {"darker": (delta[0] > 0) if measurable and "render-darker" in verdict and not contaminated else None,
                    "warmer": (d_c < 0) if measurable and "render-warmer" in verdict and not contaminated else None}
            rows[key] = {"subject": subject, "region": region, "runtime_n": rn, "ref_n": fn,
                         "dL*": delta[0], "da*": delta[1], "db*": delta[2], "dC*": d_c,
                         "dE76": "contaminated" if contaminated else d_e,
                         "dE76Numeric": d_e, "verdict": verdict, "signAgrees": sign, "appMatched": app_matched,
                         "label": "lab renders standing; not app-matched" if contaminated else "app-matched patient slot",
                         "excludedFromTally": contaminated or not app_matched or not measurable,
                         "runtime": runtime, "reference": ref}
    tally = {}
    for scope, regions in (("neck", ("neck",)), ("forearm", ("forearm",)), ("combined", ("neck", "forearm"))):
        tally[scope] = {}
        for direction in ("darker", "warmer"):
            eligible = [row for row in rows.values() if row["region"] in regions and not row["excludedFromTally"] and f"render-{direction}" in row["verdict"]]
            tally[scope][direction] = {"agrees": sum(row["signAgrees"][direction] is True for row in eligible), "denominator": len(eligible)}
    report = {"schema": "openclinxr.st-skinref-i2-measure.v1", "verdictSchema": "openclinxr.skin-tone-judging.v1",
              "mode": "v4-no-card-dryrun" if a.v4_no_card else "i2", "normalization":
              "Lab(lineariseIEC61966(patch_sRGB) / lineariseIEC61966(card_sRGB) * 0.18), D65; per-channel von Kries; never scale L*",
              "deltaConvention": "runtime_n - ref_n; dC*=hypot(runtime a*,b*)-hypot(ref a*,b*); darker agrees when dL*>0 (runtime lighter, so darker is needed); warmer agrees when dC*<0 (runtime has less chroma, so warmer is needed), matching v37/S1",
              "actorSlot": "young/middle/old GLBs are the isolated lab subject reanchored from resolveProductPatientStagingTransform: patient slot; --patient-yaw-from applies",
              "robert": "ED app card L*=68.36, product overexposure, card tsk_093442568140ddfe; dE contaminated and excluded",
              "referenceSha256": hash_checks, "keys": rows, "tally": tally}
    out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"out": str(out), "keys": len(rows), "hashChecksPassed": sum(x["pass"] for x in hash_checks), "tally": tally}, indent=2))


if __name__ == "__main__":
    main()
