"""Vitruvian light-vs-African Face BaseColor chroma gate.

EXRs are read as scene-linear RGB. CIELAB and CIEDE2000 are reused from the
existing skin-family instrument; this file intentionally does not implement a
second color-difference function.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
TONE_CHECK = REPO / "tools/openclinxr/asset-pipeline/skin/families/tone-check.py"
STORE_4K = Path("/Volumes/files/openclinxr-assets/store/vitruvian-src/4K")
DEFAULT_LIGHT = STORE_4K / "Vitruvian_Face_BaseColor_Utility - Linear - sRGB.exr"
DEFAULT_AFRICAN = STORE_4K / "Vitruvian_African_Face_BaseColor.exr"


def load_tone_module():
    spec = importlib.util.spec_from_file_location("openclinxr_tone_check", TONE_CHECK)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TONE = load_tone_module()


def read_linear_rgb(path: Path) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if bgr is None or bgr.ndim != 3 or bgr.shape[2] < 3:
        raise ValueError(f"could not read three-channel EXR: {path}")
    return np.asarray(bgr[..., :3][..., ::-1], dtype=np.float64)


def linear_to_srgb(rgb: np.ndarray) -> np.ndarray:
    rgb = np.maximum(rgb, 0.0)
    return np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * rgb ** (1 / 2.4) - 0.055)


def linear_rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    # Existing srgb_to_lab performs the inverse transfer before XYZ/Lab.
    return TONE.srgb_to_lab(linear_to_srgb(np.asarray(rgb, dtype=np.float64)))


def vec(values: np.ndarray) -> list[float]:
    return [round(float(v), 6) for v in values]


def region_stats(image: np.ndarray, patches: list[dict]) -> dict:
    patch_rgb = []
    patch_lab = []
    per_patch = []
    all_pixels = []
    for patch in patches:
        x0, y0, x1, y1 = patch["box"]
        pixels = image[y0:y1, x0:x1].reshape(-1, 3)
        mean_rgb = pixels.mean(axis=0)
        mean_lab = linear_rgb_to_lab(mean_rgb)
        all_pixels.append(pixels)
        patch_rgb.append(mean_rgb)
        patch_lab.append(mean_lab)
        per_patch.append({"id": patch["id"], "mean_linear_rgb": vec(mean_rgb), "lab_d65": vec(mean_lab)})
    all_rgb = np.concatenate(all_pixels, axis=0).mean(axis=0)
    all_lab = linear_rgb_to_lab(all_rgb)
    prgb = np.asarray(patch_rgb)
    plab = np.asarray(patch_lab)
    return {
        "mean_linear_rgb": vec(all_rgb),
        "lab_d65": vec(all_lab),
        "patch_mean_sd_linear_rgb": vec(prgb.std(axis=0, ddof=1)),
        "patch_mean_sd_lab_d65": vec(plab.std(axis=0, ddof=1)),
        "patches": per_patch,
        "_patch_rgb": prgb,
        "_patch_lab": plab,
        "_rgb": all_rgb,
        "_lab": all_lab,
    }


def separation(stats: dict, region: str) -> dict:
    mean = stats[region]["_lab"] - stats["forehead"]["_lab"]
    # All target/forehead patch combinations express sampling uncertainty
    # without assuming one-to-one correspondence between unrelated UV sites.
    diffs = np.asarray([r - f for r in stats[region]["_patch_lab"] for f in stats["forehead"]["_patch_lab"]])
    return {
        "a_star": round(float(mean[1]), 6),
        "b_star": round(float(mean[2]), 6),
        "patch_sd_a_star": round(float(diffs[:, 1].std(ddof=1)), 6),
        "patch_sd_b_star": round(float(diffs[:, 2].std(ddof=1)), 6),
    }


def clean(stats: dict) -> dict:
    return {region: {k: v for k, v in values.items() if not k.startswith("_")} for region, values in stats.items()}


def make_overlay(light: np.ndarray, regions: dict, path: Path) -> None:
    preview = np.clip(linear_to_srgb(light), 0, 1)
    preview = cv2.resize(preview, (1024, 1024), interpolation=cv2.INTER_AREA)
    image = Image.fromarray(np.rint(preview * 255).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(image)
    colors = {"forehead": "#00ffff", "cheek": "#00ff00", "lip": "#ff00ff", "ear": "#ffff00", "nose": "#ff8000"}
    for region, patches in regions.items():
        for patch in patches:
            x0, y0, x1, y1 = [round(v / 4) for v in patch["box"]]
            color = colors[region]
            draw.rectangle((x0, y0, x1, y1), outline=color, width=2)
            draw.text((x0 + 2, max(0, y0 - 12)), patch["id"], fill=color, stroke_width=2, stroke_fill="black")
    image.save(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--light", type=Path, default=DEFAULT_LIGHT)
    parser.add_argument("--african", type=Path, default=DEFAULT_AFRICAN)
    parser.add_argument("--output", type=Path, default=HERE / "chroma-table.json")
    parser.add_argument("--overlay", type=Path, default=HERE / "patches-overlay.png")
    args = parser.parse_args()

    patch_doc = json.loads((HERE / "patches.json").read_text())
    regions = patch_doc["regions"]
    light = read_linear_rgb(args.light)
    african = read_linear_rgb(args.african)
    if light.shape != african.shape or list(light.shape[:2][::-1]) != patch_doc["source_resolution"]:
        raise ValueError(f"source shape mismatch: light={light.shape}, african={african.shape}")

    light_stats = {r: region_stats(light, p) for r, p in regions.items()}
    african_stats = {r: region_stats(african, p) for r, p in regions.items()}
    k = african_stats["cheek"]["_rgb"] / np.maximum(light_stats["cheek"]["_rgb"], 1e-12)
    predicted_stats = {r: region_stats(np.clip(light * k, 0, None), p) for r, p in regions.items()}

    cheek_deltas = np.asarray([TONE.ciede2000(p, african_stats["cheek"]["_lab"]) for p in african_stats["cheek"]["_patch_lab"]])
    noise_sd = float(cheek_deltas.std(ddof=1))
    noise_floor = 2 * noise_sd
    comparisons = {}
    for region in regions:
        delta = TONE.ciede2000(predicted_stats[region]["_lab"], african_stats[region]["_lab"])
        comparisons[region] = {"ciede2000_predicted_vs_african": round(delta, 6), "noise_floor": round(noise_floor, 6), "margin": round(delta - noise_floor, 6)}

    separations = {
        family: {region: separation(stats, region) for region in ("lip", "ear")}
        for family, stats in (("light", light_stats), ("african", african_stats), ("predicted", predicted_stats))
    }
    sep_gate = {}
    for region in ("lip", "ear"):
        target = separations["african"][region]
        pred = separations["predicted"][region]
        sep_gate[region] = {}
        for axis in ("a_star", "b_star"):
            difference = abs(pred[axis] - target[axis])
            threshold = 2 * target[f"patch_sd_{axis}"]
            sep_gate[region][axis] = {"absolute_difference": round(difference, 6), "two_x_african_patch_sd": round(threshold, 6), "exceeds": bool(difference > threshold)}

    candidate_go = {
        region: comparisons[region]["margin"] > 0 and any(v["exceeds"] for v in sep_gate[region].values())
        for region in ("lip", "ear")
    }
    # A control is a similar global miss when its positive margin is at least
    # 75% of the strongest passing lip/ear margin. The ratio is emitted.
    passing_margins = [comparisons[r]["margin"] for r in ("lip", "ear") if candidate_go[r]]
    strongest = max(passing_margins, default=0.0)
    control_ratio = comparisons["forehead"]["margin"] / strongest if strongest > 0 else 0.0
    global_offset = bool(strongest > 0 and comparisons["forehead"]["margin"] > 0 and control_ratio >= 0.75)
    verdict = "inconclusive_global_offset" if global_offset else ("go" if any(candidate_go.values()) else "kill")

    doc = {
        "version": 1,
        "inputs": {"light": str(args.light), "african": str(args.african), "substitution": args.light.resolve() == args.african.resolve()},
        "method": {
            "input_encoding": "scene-linear RGB from EXR; OpenCV BGR reordered to RGB",
            "lab": f"imported {TONE_CHECK.relative_to(REPO)}:srgb_to_lab after exact linear-to-sRGB transfer; D65",
            "ciede2000": f"imported {TONE_CHECK.relative_to(REPO)}:ciede2000",
            "region_aggregation": "mean of all pixels in fixed boxes; patch SD is sample SD across per-patch means",
            "separation_patch_sd": "sample SD over all target-region patch minus forehead patch combinations",
            "global_offset_similar_margin_rule": "forehead positive margin >= 0.75 * strongest passing lip/ear margin",
        },
        "light": clean(light_stats),
        "african": clean(african_stats),
        "cheek_multiply": {"k_rgb": vec(k), "predicted": clean(predicted_stats)},
        "noise": {"african_cheek_patch_ciede2000_to_region_mean": [round(float(v), 6) for v in cheek_deltas], "sd": round(noise_sd, 6), "floor_two_x_sd": round(noise_floor, 6)},
        "comparisons": comparisons,
        "separations_region_minus_forehead": separations,
        "separation_gate": sep_gate,
        "candidate_go": candidate_go,
        "counterweight": {"strongest_passing_lip_or_ear_margin": round(strongest, 6), "forehead_margin_ratio": round(control_ratio, 6), "global_offset": global_offset},
        "verdict": verdict,
    }
    args.output.write_text(json.dumps(doc, indent=2) + "\n")
    make_overlay(light, regions, args.overlay)
    print(json.dumps({"output": str(args.output), "overlay": str(args.overlay), "substitution": doc["inputs"]["substitution"], "verdict": verdict, "noise_floor": round(noise_floor, 6), "comparisons": comparisons, "separation_gate": sep_gate}, indent=2))


if __name__ == "__main__":
    main()
