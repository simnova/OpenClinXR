#!/usr/bin/env python3
"""kevin-collar-s9-chain.py — S9 tracked factory chain (visibility-selected unhide + atlas inpaint).

Stage 1 runs the openings-spec unhide with the S9 visibility selection
(--select-tris) on the pre-image into a temp file under the run's out dir;
stage 2 fills the hide-mask footprint of the skin baseColor from its own
texels (nurse hide-footprint tool, unchanged) into the final output. The only
external input is --pre (the 8108f27c0 revision bytes, written to a run-owned
file by the sidecar corrector); the openings spec and the footprint mask are
tracked inputs resolved from the repo.

SELECTED (S9, 126 tris): S7 T_open (132, E/s7a/v-select-65.json unionOpen)
minus the 6 open L tris (1:460, 1:537, 1:572, 4:17, 7:14, 7:15) = the
v-select-65.json 'selected' list verbatim (union-inter == selected,
leak-only 1:459/1:461 were never in the union). Keys are hidden-prim
index -> src-face list within that primitive (stage-22 src coords).
Index-only: no vertex attribute changes (S8 recess branch deleted, S9).

FOOTPRINT: the mask is the FULL pre hide-mask H
(fixtures/kevin-openings-footprint-mask.png, 220972 texels) — the unchanged
S5 inpaint. SELECTED is a subset of the S5 213 moved set, so H covers every
selected tri's UVs.

Run:
  python3 tools/.../scripts/kevin-collar-s9-chain.py \\
    --pre <glb> --out <glb> [--report <json>]

Exit nonzero (STOP) when either stage refuses.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# S9 visibility selection (src faces per hidden prim); see module docstring.
SELECTED: dict[int, list[int]] = {
    1: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 53, 55, 79, 80, 81, 85, 86, 90, 92, 93, 94, 95, 96, 97, 98, 104, 188, 189, 193, 194, 196, 198, 199, 205, 206, 208, 209, 215, 216, 236, 237, 249, 262, 395, 396, 397, 398, 399, 400, 401, 402, 403, 405, 406, 407, 408, 410, 467, 469, 472, 481, 482, 487, 489, 490, 557, 558, 559, 560, 576, 582, 583, 584, 585, 587, 590, 592, 593, 596, 597, 598, 629, 638, 639, 640, 646, 647, 648, 661, 662],
    4: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29],
    7: [0, 1, 2, 3],
}
SELECTED_TOTAL = sum(len(faces) for faces in SELECTED.values())


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
    assert SELECTED_TOTAL == 126, SELECTED_TOTAL

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
    sel_path = Path(tempfile.mkdtemp(prefix="s9sel-")) / "selected.json"
    sel_path.write_text(json.dumps({str(k): sorted(v) for k, v in SELECTED.items()}) + "\n")
    try:
        run_stage(
            sys.executable, unhide_tool,
            ["--in", a.input, "--output", str(stage1_path),
             "--report", str(stage1_report),
             "--openings-spec", str(spec),
             "--select-tris", str(sel_path)],
            "stage22-unhide-select",
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
    print(json.dumps({"chain": "unhide-select+inpaint", "selectedTotal": SELECTED_TOTAL,
                      "output": a.output}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
