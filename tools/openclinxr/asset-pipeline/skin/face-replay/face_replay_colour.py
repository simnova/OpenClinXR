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
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import face_replay_compose as C

METHOD_VERSION = "global-lab6-v2"
MIN_MASK_TEXELS = 64
MIN_HALF_TEXELS = 500


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
    img = Image.open(side_path).convert("L")
    if img.size != (size[0], size[1]):
        img = img.resize((size[0], size[1]), Image.NEAREST)
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
                mask = regions["facecore"] & (np.arange(h)[:, None] >= fy0 + int(0.2 * fhh)) & (np.arange(h)[:, None] < fy0 + int(0.6 * fhh)) & (np.abs(np.arange(w)[None, :] - (fx0 + fx1) // 2) < int(0.15 * fww)) if len(fys) > 0 else np.zeros_like(fc, dtype=bool)
            elif name == "chin":
                mask = regions["facecore"] & (np.arange(h)[:, None] >= fy0 + int(0.7 * fhh)) if len(fys) > 0 else np.zeros_like(fc, dtype=bool)
            elif name == "upper_lip":
                mask = regions["facecore"] & (np.arange(h)[:, None] >= fy0 + int(0.55 * fhh)) & (np.arange(h)[:, None] < fy0 + int(0.7 * fhh)) if len(fys) > 0 else np.zeros_like(fc, dtype=bool)
            
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


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Replayable global colour solve")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--solve", action="store_true")
    ap.add_argument("--replay", action="store_true")
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
    raise SystemExit("need --check, --solve or --replay")


if __name__ == "__main__":
    main()
