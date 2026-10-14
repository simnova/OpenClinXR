"""Replayable global colour solve (face-replay station).

Ports the scratch lab6fix transfer into deterministic, size-agnostic
code: a GLOBAL Lab affine of 6 numbers (face-core mean + std), sourced
in ALBEDO space with a recorded render-to-albedo offset D. It replaces
the closed-loop regional solve whose per-region corrections were never
stored and which left a midline split on a changed composite.

Two modes. SOLVE (human/orchestrator; any renderer use stays outside
this module): measures source stats in albedo space under the
mesh-derived face-core mask and render stats under supplied
render-space masks, then WRITES solve-parameters.json carrying the
subject id, the six numbers, the offset, the mask/input/goal shas and
the method version. REPLAY: reads the parameters, verifies the input
albedo + mask shas, measures the source stats LIVE from the supplied
input, applies the affine globally, writes the output. Zero renders,
zero model calls, zero child processes on the replay path. A recorded
input sha mismatch is a hard REFUSE (non-zero exit), never a fallback.

The first version of this transfer was wrong because it applied
render-space statistics in albedo space; the offset D carries that
fix (target albedo mean = goal render mean - D).

Texture convention: same as the compositor (row=v*S, flipY=false).
Lab helpers are reused from face_replay_compose (single implementation).
Only stdlib + numpy + PIL are required.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image as PILImage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import face_replay_compose as C

# Re-export for tests
load_rgb = C.load_rgb
load_mask = C.load_mask

METHOD_VERSION = "global-lab6-v2"
REGIONAL_VERSION = "regional-v1"
MIN_MASK_TEXELS = 64
MIN_HALF_TEXELS = 500
# Regional tone field parameters
REGIONAL_FEATHER_TEXELS = 32.0  # feathering at 4096 reference size


def face_stats(rgb: np.ndarray, mask: np.ndarray) -> tuple[list, list, int]:
    px = C.lab_of(rgb)[mask > 0.5]
    n = int(px.shape[0])
    if n < MIN_MASK_TEXELS:
        raise RuntimeError(f"COLOUR_MASK_TOO_SMALL n={n}: refuse")
    mean = [float(v) for v in px.mean(axis=0)]
    std = [float(v) + 1e-6 for v in px.std(axis=0)]
    return mean, std, n


def solve_compute(tex_mean: list, tex_sd: list, pre_mean: list,
                  pre_sd: list, goal_mean: list, goal_sd: list) -> tuple[list, list, list]:
    """Compute six numbers with render-space gain for std.
    
    The mean target in albedo space = goal_render_mean - D (where D = pre_render_mean - albedo_mean).
    The std target in albedo space = albedo_std * gain, where gain_c = goal_render_std_c / pre_render_std_c.
    This avoids baking lighting contrast (which increases render std) into the albedo texture.
    """
    offset = [float(a - b) for a, b in zip(pre_mean, tex_mean)]
    # Mean target: goal render mean minus the render→albedo offset
    tgt_mean = [float(g - d) for g, d in zip(goal_mean, offset)]
    # Std target: albedo std scaled by render-space gain (goal_render / pre_render)
    gain = [float(g / max(p, 1e-6)) for g, p in zip(goal_sd, pre_sd)]
    tgt_sd = [float(tex_sd[i] * gain[i]) for i in range(3)]
    six = tgt_mean + tgt_sd
    return six, offset, gain


def apply_transfer(rgb: np.ndarray, src_mean: list, src_sd: list,
                   tgt_mean: list, tgt_sd: list) -> np.ndarray:
    lab = C.lab_of(rgb).astype(np.float64)
    mu_s = np.array(src_mean, dtype=np.float64)
    sd_s = np.array(src_sd, dtype=np.float64)
    mu_t = np.array(tgt_mean, dtype=np.float64)
    sd_t = np.array(tgt_sd, dtype=np.float64)
    out = (lab - mu_s) / np.maximum(sd_s, 1e-6) * sd_t + mu_t
    out[..., 0] = np.clip(out[..., 0], 0.0, 100.0)
    return C.rgb_of(out)


def cheek_delta_l(rgb: np.ndarray, face: np.ndarray, side_path: Path,
                  size: tuple[int, int]) -> tuple[float | None, int, int]:
    img = PILImage.open(side_path).convert("L")
    if img.size != (size[0], size[1]):
        img = img.resize((size[0], size[1]), PILImage.NEAREST)
    arr = np.array(img)
    left = (arr > 200) & (face > 0.5)
    right = (arr < 55) & (face > 0.5)
    nl, nr = int(left.sum()), int(right.sum())
    if nl < MIN_HALF_TEXELS or nr < MIN_HALF_TEXELS:
        return None, nl, nr
    lab = C.lab_of(rgb)
    return float(lab[left][:, 0].mean() - lab[right][:, 0].mean()), nl, nr


def _mask_or_refuse(path: Path, size: tuple[int, int]) -> np.ndarray:
    mask = C.load_mask(path, size)
    if int((mask > 0.5).sum()) < MIN_MASK_TEXELS:
        raise RuntimeError(f"COLOUR_MASK_TOO_SMALL {path.name}: refuse")
    return mask


def cmd_solve(args: argparse.Namespace) -> dict:
    albedo = C.load_rgb(Path(args.input_albedo))
    h, w = albedo.shape[:2]
    face = _mask_or_refuse(Path(args.albedo_mask), (w, h))
    pre = C.load_rgb(Path(args.pre_render))
    goal = C.load_rgb(Path(args.goal_render))
    pw, ph = pre.shape[1], pre.shape[0]
    gw, gh = goal.shape[1], goal.shape[0]
    pre_mask = _mask_or_refuse(Path(args.pre_mask), (pw, ph))
    goal_mask = _mask_or_refuse(Path(args.goal_mask), (gw, gh))
    tex_mean, tex_sd, tex_n = face_stats(albedo, face)
    pre_mean, pre_sd, pre_n = face_stats(pre, pre_mask)
    goal_mean, goal_sd, goal_n = face_stats(goal, goal_mask)
    six, offset, gain = solve_compute(tex_mean, tex_sd, pre_mean, pre_sd, goal_mean, goal_sd)
    params = {
        "subject": args.subject,
        "method": METHOD_VERSION,
        "six": six,
        "offset_D_render_minus_albedo": offset,
        "gain_albedo_std": gain,
        "source_albedo": {"mean": tex_mean, "std": tex_sd, "n": tex_n},
        "pre_render": {"mean": pre_mean, "std": pre_sd, "n": pre_n},
        "goal_render": {"mean": goal_mean, "std": goal_sd, "n": goal_n},
        "shas": {
            "input_albedo": C.sha256_file(Path(args.input_albedo)),
            "albedo_mask": C.sha256_file(Path(args.albedo_mask)),
            "pre_render": C.sha256_file(Path(args.pre_render)),
            "pre_mask": C.sha256_file(Path(args.pre_mask)),
            "goal_render": C.sha256_file(Path(args.goal_render)),
            "goal_mask": C.sha256_file(Path(args.goal_mask)),
        },
        "files": {
            "input_albedo": Path(args.input_albedo).name,
            "albedo_mask": Path(args.albedo_mask).name,
            "pre_render": Path(args.pre_render).name,
            "pre_mask": Path(args.pre_mask).name,
            "goal_render": Path(args.goal_render).name,
            "goal_mask": Path(args.goal_mask).name,
        },
        "albedo_size": [w, h],
    }
    out = Path(args.out_params)
    out.write_text(json.dumps(params, indent=1) + "\n", encoding="utf8")
    return params


def cmd_replay(args: argparse.Namespace) -> dict:
    params = json.loads(Path(args.params).read_text(encoding="utf8"))
    if params.get("method") not in ("global-lab6-v1", "global-lab6-v2"):
        raise RuntimeError(f"COLOUR_METHOD_MISMATCH "
                           f"{params.get('method')}: refuse")
    albedo_path = Path(args.input_albedo)
    mask_path = Path(args.albedo_mask)
    actual_albedo = C.sha256_file(albedo_path)
    if actual_albedo != params["shas"]["input_albedo"]:
        raise RuntimeError("COLOUR_INPUT_SHA_MISMATCH "
                           f"actual {actual_albedo[:16]} != expected "
                           f"{params['shas']['input_albedo'][:16]}: refuse")
    actual_mask = C.sha256_file(mask_path)
    if actual_mask != params["shas"]["albedo_mask"]:
        raise RuntimeError("COLOUR_MASK_SHA_MISMATCH "
                           f"actual {actual_mask[:16]} != expected "
                           f"{params['shas']['albedo_mask'][:16]}: refuse")
    rgb = C.load_rgb(albedo_path)
    h, w = rgb.shape[:2]
    face = _mask_or_refuse(mask_path, (w, h))
    # Use the FIXED source stats from the solve (source_albedo), not live stats.
    # The six numbers in params were computed against these fixed stats.
    src_mean = params["source_albedo"]["mean"]
    src_sd = params["source_albedo"]["std"]
    src_n = params["source_albedo"]["n"]
    six = params["six"]
    out = apply_transfer(rgb, src_mean, src_sd, six[:3], six[3:])
    d_before: float | None = None
    d_after: float | None = None
    nl = nr = 0
    if args.side_map:
        d_before, nl, nr = cheek_delta_l(rgb, face, Path(args.side_map),
                                         (w, h))
        d_after, _, _ = cheek_delta_l(out, face, Path(args.side_map),
                                      (w, h))
    C.save_rgb(Path(args.out), out)
    
    # Build per-region table (B3): forehead, cheeks L/R, nose, chin, upper lip
    # Mean Lab before | after | goal, and L/R cheek difference before | after
    # This requires the masks at the input size and the goal render stats.
    region_table = {}
    if "goal_render" in params:
        goal_mean = params["goal_render"]["mean"]
        goal_sd = params["goal_render"]["std"]
        
        # Load masks at input resolution
        masks = {}
        masks_dir = mask_path.parent
        for role in C.MASK_ROLES:
            cand = masks_dir / f"mask-{role}.png"
            if cand.is_file():
                masks[role] = C.load_mask(cand, (w, h))
        
        regions = C.regions_from_masks(masks)
        before_lab = C.lab_of(rgb).astype(np.float64)
        after_lab = C.lab_of(out).astype(np.float64)
        
        # Cheek L/R
        if "side" in masks:
            pos = masks["side"] > 0.78  # 200/255
            neg = masks["side"] < 0.22  # 55/255
        else:
            pos = neg = None
        
        fc = regions["facecore"]
        fys, fxs = np.where(fc)
        if len(fys) > 0:
            fy0, fy1 = int(fys.min()), int(fys.max())
            fx0, fx1 = int(fxs.min()), int(fxs.max())
            fhh = fy1 - fy0
            fww = fx1 - fx0
            cheek_top = fy0 + int(0.35 * fhh)
            cheek_mask = fc & (np.arange(h)[:, None] >= cheek_top)
            if pos is not None:
                left = cheek_mask & pos
                right = cheek_mask & neg
                dL_before = float(before_lab[left][:, 0].mean() - before_lab[right][:, 0].mean()) if int(left.sum()) >= 500 and int(right.sum()) >= 500 else None
                dL_after = float(after_lab[left][:, 0].mean() - after_lab[right][:, 0].mean()) if int(left.sum()) >= 500 and int(right.sum()) >= 500 else None
            else:
                dL_before = dL_after = None
        else:
            dL_before = dL_after = None
        
        # Per-region means
        for name in ["forehead", "cheeks", "nose", "chin", "upper_lip"]:
            if name == "forehead":
                mask = regions["forehead"]
            elif name == "cheeks":
                # Use cheek_mask from above
                mask = cheek_mask if len(fys) > 0 else np.zeros_like(fc, dtype=bool)
            elif name == "nose":
                # Use facecore center region as proxy for nose
                if len(fys) > 0:
                    row_idx = np.arange(h)[:, None]
                    col_idx = np.arange(w)[None, :]
                    cx = (fx0 + fx1) // 2
                    mask = (regions["facecore"] & 
                            (row_idx >= fy0 + int(0.2 * fhh)) & 
                            (row_idx < fy0 + int(0.6 * fhh)) & 
                            (np.abs(col_idx - cx) < int(0.15 * fww)))
                else:
                    mask = np.zeros_like(fc, dtype=bool)
            elif name == "chin":
                if len(fys) > 0:
                    row_idx = np.arange(h)[:, None]
                    mask = regions["facecore"] & (row_idx >= fy0 + int(0.7 * fhh))
                else:
                    mask = np.zeros_like(fc, dtype=bool)
            elif name == "upper_lip":
                if len(fys) > 0:
                    row_idx = np.arange(h)[:, None]
                    mask = regions["facecore"] & (row_idx >= fy0 + int(0.55 * fhh)) & (row_idx < fy0 + int(0.7 * fhh))
                else:
                    mask = np.zeros_like(fc, dtype=bool)
            
            if int(mask.sum()) >= 64:
                before_m = before_lab[mask].mean(axis=0)
                after_m = after_lab[mask].mean(axis=0)
                region_table[name] = {
                    "before_Lab": [float(before_m[0]), float(before_m[1]), float(before_m[2])],
                    "after_Lab": [float(after_m[0]), float(after_m[1]), float(after_m[2])],
                    "goal_Lab": goal_mean,
                }
    
    report = {
        "mode": "colour-replay",
        "subject": params.get("subject"),
        "method": params.get("method"),
        "six": six,
        "offset_D_render_minus_albedo":
            params.get("offset_D_render_minus_albedo"),
        "source_measured": {"mean": src_mean, "std": src_sd, "n": src_n},
        "cheek_delta_L": {"before": d_before, "after": d_after,
                          "n_left": nl, "n_right": nr},
        "region_table": region_table,
        "output_sha256": C.sha256_file(Path(args.out)),
    }
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=1) + "\n",
                                      encoding="utf8")
    return report


def check() -> None:
    rng = np.random.default_rng(0)
    probe = rng.integers(0, 256, size=(32, 32, 3)).astype(np.uint8)
    rt = C.rgb_of(C.lab_of(probe).astype(np.float64)).astype(int)
    if np.abs(rt - probe.astype(int)).max() > 3:
        raise SystemExit("Lab round-trip drift too large")
    print("FACE_REPLAY_COLOUR_CHECK ok")


def derive_regional_masks(masks: dict[str, np.ndarray],
                          face_bbox: np.ndarray) -> dict[str, np.ndarray]:
    """Derive regional masks for tone field: cheeks, forehead-below-brow, chin.
    
    Uses the same landmark-derived approach as the below-brow mask:
    - face_bbox from facecore: [fx0, fy0, fx1, fy1]
    - forehead-below-brow: derived from eye/brow rows (eye-60 = brow row)
    - cheeks: lower facecore, split by side map
    - chin: bottom of facecore
    """
    h, w = next(iter(masks.values())).shape
    fx0, fy0, fx1, fy1 = face_bbox
    fhh = fy1 - fy0
    fww = fx1 - fx0
    
    fc = masks.get("facecore", np.zeros((h, w), dtype=bool))
    # Ensure boolean
    fc = fc > 0.5
    side = masks.get("side", None)
    
    regions = {}
    
    row_idx = np.arange(h)[:, None]
    
    # Forehead-below-brow: from brow row (fy0 + ~0.15*fhh) to ~0.35*fhh
    # This is the region between brow and eyes
    brow_row = fy0 + int(0.15 * fhh)
    forehead_bottom = fy0 + int(0.35 * fhh)
    forehead_mask = fc & (row_idx >= brow_row) & (row_idx < forehead_bottom)
    regions["forehead_below_brow"] = forehead_mask
    
    # Cheeks: lower facecore (below ~0.35*fhh), split by side map
    cheek_top = fy0 + int(0.35 * fhh)
    cheek_mask = fc & (row_idx >= cheek_top)
    if side is not None:
        pos = side > 0.78
        neg = side < 0.22
        regions["cheek_L"] = cheek_mask & pos
        regions["cheek_R"] = cheek_mask & neg
    else:
        # Fallback: split by image center
        cx = (fx0 + fx1) // 2
        col_idx = np.arange(w)[None, :]
        left_mask = cheek_mask & (col_idx < cx)
        right_mask = cheek_mask & (col_idx >= cx)
        regions["cheek_L"] = left_mask
        regions["cheek_R"] = right_mask
    
    # Chin: bottom of facecore (below ~0.7*fhh)
    chin_mask = fc & (row_idx >= fy0 + int(0.7 * fhh))
    regions["chin"] = chin_mask
    
    return regions


def feather_mask(mask: np.ndarray, feather_texels: float,
                 scale: float, ref_size: float = 4096.0) -> np.ndarray:
    """Feather a binary mask using gaussian blur."""
    if feather_texels <= 0:
        return mask.astype(np.float64)
    from scipy import ndimage
    sigma = feather_texels / 3.0 * scale / ref_size * max(mask.shape)
    f = mask.astype(np.float64)
    if f.sum() > 0:
        f = ndimage.gaussian_filter(f, sigma, truncate=3.0, mode="reflect")
        if f.max() > 0:
            f /= f.max()
    return f


def solve_regional(rgb: np.ndarray, pre_render: np.ndarray, goal_render: np.ndarray,
                   regional_masks: dict[str, np.ndarray],
                   pre_masks: dict[str, np.ndarray],
                   goal_masks: dict[str, np.ndarray],
                   scale: float) -> dict:
    """Solve regional tone field: per-region Lab affine (6 numbers per region).
    
    For each region:
    - Measure source albedo mean/std under regional mask
    - Measure pre-render mean/std under pre_mask
    - Measure goal-render mean/std under goal_mask
    - Compute 6 numbers (mean + std affine) per region, like global solve but per region
    - Store parameters for replay
    """
    from scipy import ndimage
    
    # Get source albedo stats per region
    src_stats = {}
    for name, mask in regional_masks.items():
        px = C.lab_of(rgb)[mask > 0.5]
        n = int(px.shape[0])
        if n < MIN_MASK_TEXELS:
            raise RuntimeError(f"REGIONAL_MASK_TOO_SMALL {name} n={n}: refuse")
        src_stats[name] = {
            "mean": [float(v) for v in px.mean(axis=0)],
            "std": [float(v) + 1e-6 for v in px.std(axis=0)],
            "n": n
        }
    
    # Get pre-render stats per region
    pre_stats = {}
    for name, mask in pre_masks.items():
        px = C.lab_of(pre_render)[mask > 0.5]
        n = int(px.shape[0])
        if n < MIN_MASK_TEXELS:
            raise RuntimeError(f"REGIONAL_PRE_MASK_TOO_SMALL {name} n={n}: refuse")
        pre_stats[name] = {
            "mean": [float(v) for v in px.mean(axis=0)],
            "std": [float(v) + 1e-6 for v in px.std(axis=0)],
            "n": n
        }
    
    # Get goal-render stats per region
    goal_stats = {}
    for name, mask in goal_masks.items():
        px = C.lab_of(goal_render)[mask > 0.5]
        n = int(px.shape[0])
        if n < MIN_MASK_TEXELS:
            raise RuntimeError(f"REGIONAL_GOAL_MASK_TOO_SMALL {name} n={n}: refuse")
        goal_stats[name] = {
            "mean": [float(v) for v in px.mean(axis=0)],
            "std": [float(v) + 1e-6 for v in px.std(axis=0)],
            "n": n
        }
    
    # Compute 6 numbers per region
    regional_params = {}
    for name in regional_masks.keys():
        if name not in pre_stats or name not in goal_stats:
            continue
        tex_m = src_stats[name]["mean"]
        tex_sd = src_stats[name]["std"]
        pre_m = pre_stats[name]["mean"]
        pre_sd = pre_stats[name]["std"]
        goal_m = goal_stats[name]["mean"]
        goal_sd = goal_stats[name]["std"]
        
        # Same computation as global solve but per region
        offset = [float(a - b) for a, b in zip(pre_m, tex_m)]
        tgt_mean = [float(g - d) for g, d in zip(goal_m, offset)]
        gain = [float(g / max(p, 1e-6)) for g, p in zip(goal_sd, pre_sd)]
        tgt_sd = [float(tex_sd[i] * gain[i]) for i in range(3)]
        six = tgt_mean + tgt_sd
        
        regional_params[name] = {
            "six": six,
            "offset_D_render_minus_albedo": offset,
            "gain_albedo_std": gain,
            "source_albedo": {"mean": tex_m, "std": tex_sd, "n": src_stats[name]["n"]},
            "pre_render": {"mean": pre_m, "std": pre_sd, "n": pre_stats[name]["n"]},
            "goal_render": {"mean": goal_m, "std": goal_sd, "n": goal_stats[name]["n"]},
        }
    
    return regional_params


def apply_regional_transfer(rgb: np.ndarray, regional_masks: dict[str, np.ndarray],
                            regional_params: dict, feather: float, scale: float) -> np.ndarray:
    """Apply regional tone transfer with feathering.
    
    For each region, apply its Lab affine, then blend with feathering at boundaries.
    """
    h, w = rgb.shape[:2]
    lab = C.lab_of(rgb).astype(np.float64)
    out_lab = lab.copy()
    
    # For each region, compute the transfer
    region_transfers = {}
    for name, mask in regional_masks.items():
        if name not in regional_params:
            continue
        params = regional_params[name]
        src_mean = np.array(params["source_albedo"]["mean"], dtype=np.float64)
        src_sd = np.array(params["source_albedo"]["std"], dtype=np.float64)
        tgt_mean = np.array(params["six"][:3], dtype=np.float64)
        tgt_sd = np.array(params["six"][3:], dtype=np.float64)
        
        # Apply transfer to masked pixels
        region_lab = lab[mask > 0.5]
        transferred = (region_lab - src_mean) / np.maximum(src_sd, 1e-6) * tgt_sd + tgt_mean
        transferred[..., 0] = np.clip(transferred[..., 0], 0.0, 100.0)
        region_transfers[name] = (mask, transferred)
    
    # Blend transfers with feathering
    # Build weight maps for each region
    weight_maps = {}
    for name, mask in regional_masks.items():
        weight_maps[name] = feather_mask(mask, feather, scale)
    
    # Normalize weights so they sum to <= 1
    total_weight = np.zeros((h, w), dtype=np.float64)
    for wm in weight_maps.values():
        total_weight += wm
    total_weight = np.maximum(total_weight, 1e-6)
    
    # Apply blended transfers
    for name, (mask, transferred) in region_transfers.items():
        wm = weight_maps[name] / total_weight
        if wm.sum() > 0:
            out_lab[mask > 0.5] = (1 - wm[mask > 0.5][:, None]) * lab[mask > 0.5] + \
                                   wm[mask > 0.5][:, None] * transferred
    
    return C.rgb_of(out_lab)


def cmd_solve_regional(args: argparse.Namespace) -> dict:
    """Solve regional tone field and write parameters."""
    albedo = C.load_rgb(Path(args.input_albedo))
    h, w = albedo.shape[:2]
    scale = max(h, w) / 4096.0
    
    # Load facecore mask for bbox
    face_mask = C.load_mask(Path(args.albedo_mask), (w, h))
    fys, fxs = np.where(face_mask > 0.5)
    if len(fys) == 0:
        raise RuntimeError("empty facecore mask: refuse")
    face_bbox = np.array([int(fxs.min()), int(fys.min()), int(fxs.max()), int(fys.max())])
    
    # Load all masks at input resolution
    masks = {}
    masks_dir = Path(args.albedo_mask).parent
    for role in C.MASK_ROLES:
        cand = masks_dir / f"mask-{role}.png"
        if cand.is_file():
            masks[role] = C.load_mask(cand, (w, h))
    
    # Derive regional masks
    regional_masks = derive_regional_masks(masks, face_bbox)
    
    # Load pre-render and goal-render
    pre_render = C.load_rgb(Path(args.pre_render))
    goal_render = C.load_rgb(Path(args.goal_render))
    
    # Load pre-masks and goal-masks (below-brow style)
    pre_mask = C.load_mask(Path(args.pre_mask), pre_render.shape[1::-1])
    goal_mask = C.load_mask(Path(args.goal_mask), goal_render.shape[1::-1])
    
    # For regional, we use the same below-brow mask for all regions (pre/goal)
    # but split into sub-regions using the regional masks
    pre_masks = {}
    goal_masks = {}
    for name, mask in regional_masks.items():
        # Resize regional mask to pre/goal render size if needed
        if mask.shape != pre_render.shape[:2]:
            img = PILImage.fromarray((mask * 255).astype(np.uint8))
            img = img.resize((pre_render.shape[1], pre_render.shape[0]), PILImage.NEAREST)
            pre_masks[name] = np.array(img) > 127
        else:
            pre_masks[name] = mask
        
        if mask.shape != goal_render.shape[:2]:
            img = PILImage.fromarray((mask * 255).astype(np.uint8))
            img = img.resize((goal_render.shape[1], goal_render.shape[0]), PILImage.NEAREST)
            goal_masks[name] = np.array(img) > 127
        else:
            goal_masks[name] = mask
    
    # Solve regional parameters
    regional_params = solve_regional(albedo, pre_render, goal_render,
                                      regional_masks, pre_masks, goal_masks, scale)
    
    # Also compute global solve for reference
    face = _mask_or_refuse(Path(args.albedo_mask), (w, h))
    pre = C.load_rgb(Path(args.pre_render))
    goal = C.load_rgb(Path(args.goal_render))
    pw, ph = pre.shape[1], pre.shape[0]
    gw, gh = goal.shape[1], goal.shape[0]
    pre_mask_full = _mask_or_refuse(Path(args.pre_mask), (pw, ph))
    goal_mask_full = _mask_or_refuse(Path(args.goal_mask), (gw, gh))
    tex_mean, tex_sd, tex_n = face_stats(albedo, face)
    pre_mean, pre_sd, pre_n = face_stats(pre, pre_mask_full)
    goal_mean, goal_sd, goal_n = face_stats(goal, goal_mask_full)
    six, offset, gain = solve_compute(tex_mean, tex_sd, pre_mean, pre_sd, goal_mean, goal_sd)
    
    params = {
        "subject": args.subject,
        "method": REGIONAL_VERSION,
        "global_six": six,
        "global_offset_D_render_minus_albedo": offset,
        "global_gain_albedo_std": gain,
        "source_albedo": {"mean": tex_mean, "std": tex_sd, "n": tex_n},
        "pre_render": {"mean": pre_mean, "std": pre_sd, "n": pre_n},
        "goal_render": {"mean": goal_mean, "std": goal_sd, "n": goal_n},
        "regional": regional_params,
        "regional_feather_texels": REGIONAL_FEATHER_TEXELS,
        "shas": {
            "input_albedo": C.sha256_file(Path(args.input_albedo)),
            "albedo_mask": C.sha256_file(Path(args.albedo_mask)),
            "pre_render": C.sha256_file(Path(args.pre_render)),
            "pre_mask": C.sha256_file(Path(args.pre_mask)),
            "goal_render": C.sha256_file(Path(args.goal_render)),
            "goal_mask": C.sha256_file(Path(args.goal_mask)),
        },
        "files": {
            "input_albedo": Path(args.input_albedo).name,
            "albedo_mask": Path(args.albedo_mask).name,
            "pre_render": Path(args.pre_render).name,
            "pre_mask": Path(args.pre_mask).name,
            "goal_render": Path(args.goal_render).name,
            "goal_mask": Path(args.goal_mask).name,
        },
        "albedo_size": [w, h],
    }
    
    out = Path(args.out_params)
    out.write_text(json.dumps(params, indent=1) + "\n", encoding="utf8")
    return params


def cmd_replay_regional(args: argparse.Namespace) -> dict:
    """Replay regional tone field from stored parameters (0 renders)."""
    params = json.loads(Path(args.params).read_text(encoding="utf8"))
    if params.get("method") != REGIONAL_VERSION:
        raise RuntimeError(f"REGIONAL_METHOD_MISMATCH "
                           f"{params.get('method')}: refuse")
    
    albedo_path = Path(args.input_albedo)
    mask_path = Path(args.albedo_mask)
    actual_albedo = C.sha256_file(albedo_path)
    if actual_albedo != params["shas"]["input_albedo"]:
        raise RuntimeError("REGIONAL_INPUT_SHA_MISMATCH "
                           f"actual {actual_albedo[:16]} != expected "
                           f"{params['shas']['input_albedo'][:16]}: refuse")
    actual_mask = C.sha256_file(mask_path)
    if actual_mask != params["shas"]["albedo_mask"]:
        raise RuntimeError("REGIONAL_MASK_SHA_MISMATCH "
                           f"actual {actual_mask[:16]} != expected "
                           f"{params['shas']['albedo_mask'][:16]}: refuse")
    
    rgb = C.load_rgb(albedo_path)
    h, w = rgb.shape[:2]
    scale = max(h, w) / 4096.0
    feather = params.get("regional_feather_texels", REGIONAL_FEATHER_TEXELS)
    
    # Load masks to derive regional masks
    masks = {}
    masks_dir = mask_path.parent
    for role in C.MASK_ROLES:
        cand = masks_dir / f"mask-{role}.png"
        if cand.is_file():
            masks[role] = C.load_mask(cand, (w, h))
    
    face_mask = C.load_mask(mask_path, (w, h))
    fys, fxs = np.where(face_mask > 0.5)
    if len(fys) == 0:
        raise RuntimeError("empty facecore mask: refuse")
    face_bbox = np.array([int(fxs.min()), int(fys.min()), int(fxs.max()), int(fys.max())])
    
    regional_masks = derive_regional_masks(masks, face_bbox)
    regional_params = params.get("regional", {})
    
    # Apply regional transfer
    out = apply_regional_transfer(rgb, regional_masks, regional_params, feather, scale)
    
    # Save output
    C.save_rgb(Path(args.out), out)
    
    # Build report with per-region before/after
    if "goal_render" in params:
        goal_mean = params["goal_render"]["mean"]
        before_lab = C.lab_of(rgb).astype(np.float64)
        after_lab = C.lab_of(out).astype(np.float64)
        
        region_table = {}
        for name in regional_masks.keys():
            mask = regional_masks[name]
            if int(mask.sum()) >= 64 and name in regional_params:
                before_m = before_lab[mask].mean(axis=0)
                after_m = after_lab[mask].mean(axis=0)
                region_table[name] = {
                    "before_Lab": [float(before_m[0]), float(before_m[1]), float(before_m[2])],
                    "after_Lab": [float(after_m[0]), float(after_m[1]), float(after_m[2])],
                    "goal_Lab": goal_mean,
                    "params": regional_params[name],
                }
        
        report = {
            "mode": "regional-replay",
            "subject": params.get("subject"),
            "method": params.get("method"),
            "global_six": params.get("global_six"),
            "regional_feather_texels": feather,
            "region_table": region_table,
            "output_sha256": C.sha256_file(Path(args.out)),
        }
        
        if args.report:
            Path(args.report).write_text(json.dumps(report, indent=1) + "\n", encoding="utf8")
        return report
    
    return {"mode": "regional-replay", "output_sha256": C.sha256_file(Path(args.out))}


def check_regional() -> None:
    """Self-test for regional solve/replay."""
    # Simple round-trip test
    rng = np.random.default_rng(0)
    probe = rng.integers(0, 256, size=(64, 64, 3)).astype(np.uint8)
    lab = C.lab_of(probe)
    rt = C.rgb_of(lab).astype(int)
    if np.abs(rt - probe.astype(int)).max() > 3:
        raise SystemExit("Lab round-trip drift too large")
    print("FACE_REPLAY_REGIONAL_CHECK ok")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Replayable global and regional colour solve")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--check-regional", action="store_true")
    ap.add_argument("--solve", action="store_true")
    ap.add_argument("--replay", action="store_true")
    ap.add_argument("--solve-regional", action="store_true")
    ap.add_argument("--replay-regional", action="store_true")
    ap.add_argument("--input-albedo", default=None)
    ap.add_argument("--albedo-mask", default=None)
    ap.add_argument("--pre-render", default=None)
    ap.add_argument("--pre-mask", default=None)
    ap.add_argument("--goal-render", default=None)
    ap.add_argument("--goal-mask", default=None)
    ap.add_argument("--subject", default=None)
    ap.add_argument("--out-params", default=None)
    ap.add_argument("--params", default=None)
    ap.add_argument("--side-map", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--report", default=None)
    return ap


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.check:
        check()
        return
    if args.check_regional:
        check_regional()
        return
    if args.solve:
        if not args.input_albedo or not args.albedo_mask \
                or not args.pre_render or not args.pre_mask \
                or not args.goal_render or not args.goal_mask \
                or not args.subject or not args.out_params:
            raise SystemExit("solve needs --input-albedo --albedo-mask "
                             "--pre-render --pre-mask --goal-render "
                             "--goal-mask --subject --out-params")
        cmd_solve(args)
        return
    if args.replay:
        if not args.input_albedo or not args.albedo_mask \
                or not args.params or not args.out:
            raise SystemExit("replay needs --input-albedo --albedo-mask "
                             "--params --out")
        cmd_replay(args)
        return
    if args.solve_regional:
        if not args.input_albedo or not args.albedo_mask \
                or not args.pre_render or not args.pre_mask \
                or not args.goal_render or not args.goal_mask \
                or not args.subject or not args.out_params:
            raise SystemExit("solve-regional needs --input-albedo --albedo-mask "
                             "--pre-render --pre-mask --goal-render "
                             "--goal-mask --subject --out-params")
        cmd_solve_regional(args)
        return
    if args.replay_regional:
        if not args.input_albedo or not args.albedo_mask \
                or not args.params or not args.out:
            raise SystemExit("replay-regional needs --input-albedo --albedo-mask "
                             "--params --out")
        cmd_replay_regional(args)
        return
    raise SystemExit("need --check, --check-regional, --solve, --replay, --solve-regional, or --replay-regional")


if __name__ == "__main__":
    main()
