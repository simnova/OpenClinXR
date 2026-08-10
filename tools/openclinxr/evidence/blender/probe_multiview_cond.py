#!/usr/bin/env python3
"""Issue-255 PRE-FIX probe: does the local TRELLIS checkpoint condition on multiple views?

Runs BEFORE any adaptation of run_bake_isolated.py. Answer two questions:

  Q1. Encode 1 view vs 4 views through `pipeline.get_cond`. Are the resulting cond
      tensors identical? (If identical, multi-view is a no-op and the A/B bake would
      be meaningless.)
  Q2. Downstream consumption: with `num_samples=1` (batch 1 latent), can the sparse
      structure flow model consume (a) the batch-4 cond produced by passing 4 images
      to get_cond as-is, and (b) the training-consistent sequence-concatenated cond
      (1, 4L, C) from MultiImageConditionedMixin.encode_images?

Writes .openclinxr/evidence/issue-255/pre-fix.json

Usage:
  PYTHONUNBUFFERED=1 ~/.openclinxr-tools/trellis2-apple/venv/bin/python3 \
    probe_multiview_cond.py \
      --input-dir <dir with front/side/three_quarter_left/three_quarter_right.png> \
      --output-json <path to pre-fix.json> \
      --weights-path ~/ComfyUI/models/trellis2 \
      --dinov3-path ~/ComfyUI/models/dinov3 \
      --trellis-root ~/.openclinxr-tools/trellis2-apple/src
"""
import argparse, json, os, subprocess, sys, time, traceback

VIEW_ORDER = ["front", "side", "three_quarter_left", "three_quarter_right"]


def git_head(path: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", path, "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
    except Exception:
        return "not-a-git-tree"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--weights-path", default=os.path.expanduser("~/ComfyUI/models/trellis2"))
    parser.add_argument("--dinov3-path", default=os.path.expanduser("~/ComfyUI/models/dinov3"))
    parser.add_argument("--trellis-root",
                        default=os.path.expanduser("~/.openclinxr-tools/trellis2-apple/src"))
    args = parser.parse_args()

    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
    # Resolve paths against the CALLER's cwd BEFORE chdir into the trellis root.
    input_dir = os.path.abspath(args.input_dir)
    out_path = os.path.abspath(args.output_json)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    trellis_root = args.trellis_root
    sys.path.insert(0, trellis_root)
    os.chdir(trellis_root)

    report = {
        "subject": "ecg-cart",
        "measurementKind": "pre-fix cond tensor comparison (1 view vs 4 views)",
        "measuredAgainstCommit": git_head(os.getcwd()),
        "worktreeHead": git_head(os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))),
        "vendoredTrellisRoot": trellis_root,
        "inputDir": input_dir,
        "viewOrder": VIEW_ORDER,
        "verdict": "inconclusive_blocked",
        "cond": {},
        "flowForwardProbe": {},
    }

    t_start = time.time()

    try:
        from PIL import Image

        views = {}
        for v in VIEW_ORDER:
            p = os.path.join(input_dir, f"{v}.png")
            if not os.path.exists(p):
                report["verdict"] = "blocked_build"
                report["verdictReason"] = f"Missing view image: {p}"
                report["wallClockS"] = round(time.time() - t_start, 1)
                with open(out_path, "w") as f:
                    json.dump(report, f, indent=2, default=str)
                return 1
            views[v] = Image.open(p).convert("RGB")

        from mlx_backend.pipeline import create_mlx_pipeline
        import torch
        import numpy as np

        print("[PROBE] Loading MLX pipeline...", flush=True)
        t0 = time.time()
        pipeline = create_mlx_pipeline(
            weights_path=args.weights_path,
            dinov3_local_path=args.dinov3_path,
        )
        report["pipelineLoadTimeS"] = round(time.time() - t0, 1)

        def summarize(t):
            t = t.detach()
            return {
                "shape": list(t.shape),
                "dtype": str(t.dtype),
                "norm": float(t.norm().item()),
                "absMax": float(t.abs().max().item()),
            }

        # Q1: cond tensors, 1 view vs 4 views.
        cond_1 = pipeline.get_cond([views["front"]], 512)
        cond_4 = pipeline.get_cond([views["front"], views["side"],
                                    views["three_quarter_left"], views["three_quarter_right"]], 512)

        c1 = cond_1["cond"].detach()
        c4 = cond_4["cond"].detach()

        identical = c1.shape == c4.shape and bool((c1 == c4).all().item())
        # Per-row comparisons
        row0_vs_row0 = float((c4[0] - c1[0]).abs().max().item())      # same image, expect ~0
        row0_vs_row1 = float((c4[1] - c1[0]).abs().max().item())      # different image, expect >0
        row0_vs_row2 = float((c4[2] - c1[0]).abs().max().item())
        row0_vs_row3 = float((c4[3] - c1[0]).abs().max().item())
        row_norms = [float(c4[i].norm().item()) for i in range(c4.shape[0])]

        report["cond"] = {
            "oneView": summarize(c1),
            "fourView": summarize(c4),
            "identical": identical,
            "firstRowAbsMaxDiff_sameImage": round(row0_vs_row0, 6),
            "firstRowAbsMaxDiff_side": round(row0_vs_row1, 6),
            "firstRowAbsMaxDiff_threeQuarterLeft": round(row0_vs_row2, 6),
            "firstRowAbsMaxDiff_threeQuarterRight": round(row0_vs_row3, 6),
            "fourViewRowNorms": [round(n, 3) for n in row_norms],
            "tokensPerImage": int(c1.shape[1]),
            "condChannels": int(c1.shape[2]),
        }

        # Q2: downstream flow-model forward probes (single network pass each).
        flow = pipeline.models["sparse_structure_flow_model"]
        res = flow.resolution
        in_ch = flow.in_channels
        x = torch.randn(1, in_ch, res, res, res)
        t = torch.rand(1)

        # (a) batch-4 cond as-is (what a naive "pass the list" would produce)
        try:
            with torch.no_grad():
                out_as_is = flow(x, t, c4)
            report["flowForwardProbe"]["batch4AsIs"] = {
                "outcome": "runs",
                "outputShape": list(out_as_is.shape),
            }
        except Exception as e:
            report["flowForwardProbe"]["batch4AsIs"] = {
                "outcome": "throws",
                "errorType": type(e).__name__,
                "error": str(e)[:400],
            }

        # (b) sequence-concatenated cond (1, 4L, C) — mirrors MultiImageConditionedMixin
        L = c4.shape[1]
        C = c4.shape[2]
        c4_seq = c4.reshape(1, L * 4, C).contiguous()
        try:
            with torch.no_grad():
                out_seq = flow(x, t, c4_seq)
            report["flowForwardProbe"]["sequenceConcat"] = {
                "outcome": "runs",
                "outputShape": list(out_seq.shape),
                "condShape": list(c4_seq.shape),
            }
        except Exception as e:
            report["flowForwardProbe"]["sequenceConcat"] = {
                "outcome": "throws",
                "errorType": type(e).__name__,
                "error": str(e)[:400],
            }

        # (c) baseline single-view cond (1, L, C) — the current production shape
        c1_seq = c1.reshape(1, L, C).contiguous()
        try:
            with torch.no_grad():
                out_1 = flow(x, t, c1_seq)
            report["flowForwardProbe"]["singleViewBaseline"] = {
                "outcome": "runs",
                "outputShape": list(out_1.shape),
                "condShape": list(c1_seq.shape),
            }
        except Exception as e:
            report["flowForwardProbe"]["singleViewBaseline"] = {
                "outcome": "throws",
                "errorType": type(e).__name__,
                "error": str(e)[:400],
            }

        # verdict
        if identical:
            report["verdict"] = "multiview_noop"
            report["verdictReason"] = (
                "4-view cond tensor is IDENTICAL to 1-view cond tensor — "
                "the checkpoint does not condition on additional views. Stop here."
            )
        else:
            report["verdict"] = "cond_differs"
            report["verdictReason"] = (
                "4-view cond tensor DIFFERS from 1-view cond tensor. "
                "The encoding genuinely carries the extra views. "
                "Whether the weights make use of them is the A/B bake question."
            )

    except Exception as e:
        report["verdict"] = "blocked_build"
        report["verdictReason"] = f"{type(e).__name__}: {str(e)[:500]}"
        report["traceback"] = traceback.format_exc()[-2000:]

    report["wallClockS"] = round(time.time() - t_start, 1)
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"[PROBE] Wrote {out_path}", flush=True)
    print(f"[PROBE] verdict: {report['verdict']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
