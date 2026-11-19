#!/usr/bin/env python3
"""kevin-collar-s7-chain.py — S7 tracked factory chain (visibility-selected unhide + atlas inpaint).

Stage 1 runs the openings-spec unhide with the S7 visibility selection
(--select-tris) on the pre-image into a temp file under the run's out dir;
stage 2 fills the hide-mask footprint of the skin baseColor from its own
texels (nurse hide-footprint tool, unchanged) into the final output. The only
external input is --pre (the 8108f27c0 revision bytes, written to a run-owned
file by the sidecar corrector); the openings spec and the footprint mask are
tracked inputs resolved from the repo.

SELECTED (S7 visibility selection, 101 tris): T_open over 58 view-sphere
dirs + glb-grade K1/K2 (E/s7a/v-select-60.json
sha256 295fe6c0b91fe7df9d6291a9a4c7283dbc239251de77d422f1ad52ccf2c6a677),
T_leak empty at both TIEs (product 2.14e-5 m, grade 6.42e-4 m) so the
intersection is empty and no recess/offset was built. Keys are hidden-prim
index -> src-face list within that primitive (stage-22 src coords).
Prims 2 and 5 select nothing: their hidden primitives stay untouched.

FOOTPRINT: the mask is the FULL pre hide-mask H
(fixtures/kevin-openings-footprint-mask.png, 220972 texels) — the unchanged
S5 inpaint. S6 falsified the shrunken H' mask (kept moved tris sample
pre-black UVs outside H': C1 NOT PADDING 47674 fails); SELECTED is a subset
of the S5 213 moved set, so H covers every selected tri's UVs.

Run:
  python3 tools/.../scripts/kevin-collar-s7-chain.py \\
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

# S7 visibility selection (src faces per hidden prim); see module docstring.
SELECTED: dict[int, list[int]] = {
    1: [0, 3, 4, 5, 6, 7, 8, 10, 11, 14, 15, 16, 53, 79, 80, 81, 92, 93, 95,
        96, 98, 104, 188, 189, 193, 194, 196, 198, 199, 205, 206, 208, 209,
        215, 216, 236, 237, 262, 395, 396, 397, 398, 399, 400, 405, 406, 407,
        408, 467, 481, 487, 489, 490, 557, 559, 576, 582, 583, 584, 585, 587,
        590, 592, 593, 596, 597, 629, 638, 639, 640, 646, 647, 648, 661, 662],
    4: [1, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 23, 24, 25,
        26, 27, 28, 29],
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
    assert SELECTED_TOTAL == 101, SELECTED_TOTAL

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
    sel_path = Path(tempfile.mkdtemp(prefix="s7sel-")) / "selected.json"
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
