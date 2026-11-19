#!/usr/bin/env python3
"""kevin-collar-s5-chain.py — S5 tracked factory chain (index-only unhide + atlas inpaint).

Stage 1 runs the openings-spec unhide (index-only, original UVs) on the
pre-image into a temp file under the run's out dir; stage 2 fills the
hide-mask footprint of the skin baseColor from its own texels (nurse
hide-footprint tool, unchanged) into the final output. The only external
input is --pre (the 8108f27c0 revision bytes, written to a run-owned file
by the sidecar corrector); the openings spec and the footprint mask are
tracked inputs resolved from the repo.

Run:
  python3 tools/.../scripts/kevin-collar-s5-chain.py \\
    --pre <glb> --out <glb> [--report <json>]

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
    ap.add_argument("--report", dest="report", default=None)
    a = ap.parse_args(argv)

    here = Path(__file__).resolve().parent
    repo = here.parent.parent.parent.parent.parent
    unhide_tool = repo / "tools/openclinxr/asset-pipeline/makeclothes/unhide-neckline-opening.py"
    inpaint_tool = here.parent / "inpaint_hide_footprint.py"
    spec = repo / "tools/openclinxr/asset-pipeline/makeclothes/openings/neckline-sleeves.json"
    mask = here.parent / "fixtures/kevin-openings-footprint-mask.png"
    out_path = Path(a.output)
    stage1_path = out_path.parent / f"{out_path.stem}.stage22-{os.getpid()}.glb"
    stage1_report = out_path.parent / f"{out_path.stem}.stage22-{os.getpid()}.json"
    stage2_report = a.report or str(out_path.parent / f"{out_path.stem}.stage23.json")
    try:
        run_stage(
            sys.executable, unhide_tool,
            ["--in", a.input, "--output", str(stage1_path),
             "--report", str(stage1_report),
             "--openings-spec", str(spec)],
            "stage22-unhide",
        )
        run_stage(
            sys.executable, inpaint_tool,
            ["--in", str(stage1_path), "--out", a.output,
             "--footprint-mask", str(mask), "--report", stage2_report],
            "stage23-inpaint",
        )
    finally:
        for tmp in (stage1_path, stage1_report):
            try:
                tmp.unlink()
            except OSError:
                pass
    print(json.dumps({"chain": "unhide+inpaint", "output": a.output}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
