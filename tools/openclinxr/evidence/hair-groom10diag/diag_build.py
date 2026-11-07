#!/usr/bin/env python3
"""Run groom9 verbatim with stage-displacement hooks injected in memory.

The source at commit e1533373f remains untouched.  Exact string anchors make
this fail closed if the station source changes.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SRC = ROOT / "tools/openclinxr/hair-groom/strands/interp9_children.py"


def inject(src: str, old: str, new: str) -> str:
    n = src.count(old)
    if n != 1:
        raise RuntimeError(f"instrumentation anchor count {n}, wanted 1: {old[:80]!r}")
    return src.replace(old, new)


def main():
    source = SRC.read_text()
    source = inject(source, "import frames as F\nfrom children import",
                    "import frames as F\nfrom stage_diag_runtime import (capture_raw, capture_stage, finalize_diag)\nfrom children import")
    source = inject(source,
        "    child_u = (gu_p[gi_c] * w_c).sum(axis=1)  # (C,)\n    # True rigid translation",
        "    child_u = (gu_p[gi_c] * w_c).sum(axis=1)  # (C,)\n    capture_raw(children, gi_c, w_c)\n    # True rigid translation")
    source = inject(source,
        "    trans_info = {\"p50\": round(float(np.median(trans)), 2),",
        "    capture_stage(\"far_snap\", children)\n    trans_info = {\"p50\": round(float(np.median(trans)), 2),")
    source = inject(source,
        "    # groom9 round 4 PERSISTENT lateral offset",
        "    capture_stage(\"part_sweep\", children)\n\n    # groom9 round 4 PERSISTENT lateral offset")
    source = inject(source,
        "    # Depth servo toward the child's own fraction",
        "    capture_stage(\"persistent_offset\", children)\n\n    # Depth servo toward the child's own fraction")
    source = inject(source,
        "    # Two clump scales, side-keyed above the vertex",
        "    capture_stage(\"depth_servo\", children)\n\n    # Two clump scales, side-keyed above the vertex")
    source = inject(source,
        "    fine_keys = [(int(cside_cell[i]),",
        "    capture_stage(\"coarse_clump\", children)\n    fine_keys = [(int(cside_cell[i]),")
    source = inject(source,
        "    # Per-child length jitter, sigma 4%",
        "    capture_stage(\"fine_clump\", children)\n\n    # Per-child length jitter, sigma 4%")
    source = inject(source,
        "    # groom9 HAIRLINE class (replaces sideburn-short)",
        "    capture_stage(\"length_jitter\", children)\n\n    # groom9 HAIRLINE class (replaces sideburn-short)")
    source = inject(source,
        "    # groom9 round 3: xneg hem tip-boost REMOVED",
        "    capture_stage(\"hairline_taper\", children)\n\n    # groom9 round 3: xneg hem tip-boost REMOVED")
    source = inject(source,
        "    _df, _ = _ptree.query(flat_ear, k=1)",
        "    capture_stage(\"ear_keepout\", children)\n    _df, _ = _ptree.query(flat_ear, k=1)")
    source = inject(source,
        "    # Part half-space clamps, all roots",
        "    capture_stage(\"sdf_project_outside\", children)\n\n    # Part half-space clamps, all roots")
    source = inject(source,
        "    # Radii taper.\n",
        "    capture_stage(\"part_clamp_reproject\", children)\n\n    # Radii taper.\n")
    source = inject(source,
        "    pts32 = children.astype(np.float32)\n",
        "    finalize_diag(children, gi_c, w_c, pool, parent, cxyz, g_res_p)\n    pts32 = children.astype(np.float32)\n")
    sys.path.insert(0, str(E))
    glb = {"__name__": "__main__", "__file__": str(SRC),
           "__package__": None, "__cached__": None}
    exec(compile(source, str(SRC), "exec"), glb, glb)


if __name__ == "__main__":
    main()
