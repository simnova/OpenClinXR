#!/usr/bin/env python3
"""hair-count2 timing wrapper: score.py v3 with per-view render timing.

Wraps render_view with perf_counter and prints TIMING lines; full score
(including ID pass) is otherwise v3 verbatim. Output goes to a scratch
dir; the canonical E/n2/score.json is untouched.
"""
from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"


def main():
    spec = importlib.util.spec_from_file_location("hair_count2_score_timed", SCORE)
    S = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = S
    spec.loader.exec_module(S)
    orig = S.render_view

    def timed(state, hair, params, rig, out, view, landmarks):
        t0 = time.perf_counter()
        try:
            return orig(state, hair, params, rig, out, view, landmarks)
        finally:
            print("HAIR_COUNT2_VIEW_SECONDS", view,
                  round(time.perf_counter() - t0, 2), flush=True)

    S.render_view = timed
    S.main()


if __name__ == "__main__":
    main()
