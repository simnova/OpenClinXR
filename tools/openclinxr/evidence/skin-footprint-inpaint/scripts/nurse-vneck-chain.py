#!/usr/bin/env python3
"""nurse-vneck-chain.py — P2e-C tracked factory chain (single run, F1).

Stage 1 fills the hide-mask footprint of the skin baseColor from the
shipped skin (P2e-A inpaint) into a temp file under the run's out dir;
stage 2 un-hides exactly prim7 tris {2,3,4,5,6,53} (position-keyed 6-tri
set) from that temp output, never from a machine-local archive path.
The only external input is --pre (the c1da76fb4 git revision bytes,
written to a run-owned file by the sidecar corrector); the mask and the
faces-from fixture are tracked inputs.

Run:
  python3 tools/openclinxr/evidence/skin-footprint-inpaint/scripts/nurse-vneck-chain.py \
    --pre <glb> --out <glb> --footprint-mask <png> --faces-from <json> [--report <json>]

Exit nonzero (STOP) when either stage refuses.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def run_stage(exe: str, script: Path, args: list[str], label: str) -> None:
    r = subprocess.run([exe, "-I", str(script), *args], capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    if r.returncode != 0:
        print(json.dumps({"STOP": f"chain {label} refused", "exit": r.returncode}))
        raise SystemExit(r.returncode)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pre", dest="input", required=True)
    ap.add_argument("--out", dest="output", required=True)
    ap.add_argument("--footprint-mask", dest="footprint_mask", required=True)
    ap.add_argument("--faces-from", dest="faces_from", required=True)
    ap.add_argument("--report", dest="report", default=None)
    args = ap.parse_args(argv)

    here = Path(__file__).resolve().parent
    inpaint_tool = here.parent / "inpaint_hide_footprint.py"
    unhide_tool = here / "nurse-vneck-6tri-unhide.py"
    out_path = Path(args.output)
    stage1_path = out_path.parent / f"{out_path.stem}.stage1-{os.getpid()}.glb"
    stage1_report = out_path.parent / f"{out_path.stem}.stage1-{os.getpid()}.json"
    try:
        run_stage(
            sys.executable, inpaint_tool,
            ["--in", args.input, "--out", str(stage1_path),
             "--footprint-mask", args.footprint_mask, "--report", str(stage1_report)],
            "stage1-inpaint",
        )
        run_stage(
            sys.executable, unhide_tool,
            ["--in", str(stage1_path), "--out", args.output,
             "--faces-from", args.faces_from, "--report", args.report or str(out_path.parent / f"{out_path.stem}.stage2.json")],
            "stage2-unhide",
        )
    finally:
        for tmp in (stage1_path, stage1_report):
            try:
                tmp.unlink()
            except OSError:
                pass
    print(json.dumps({"chain": "inpaint+unhide", "output": args.output}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
