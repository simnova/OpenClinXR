#!/usr/bin/env python3
"""Evidence-only parity: station register.py vs the judge's register_view.

Loads register_view from the pinned judge file and similarity_from_triples
from the station, evaluates both on the three registered views' triples
from the station run, and writes parity.json. Station code is not touched.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
RUN = Path("/tmp/station0a-run-a")
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/hair_judge.py")
STATION_REG = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-p7/tools/openclinxr/hair-groom/register.py")


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main():
    judge = load("parity_judge", JUDGE)
    station = load("parity_station_register", STATION_REG)
    registration = json.loads((RUN / "registration.json").read_text())
    views = {}
    worst = 0.0
    for view in ("front", "profile_90", "back"):
        entry = registration["views"][view]
        a_r, b_r, c_r = entry["renderTriple"]
        a_t, b_t, c_t = entry["targetTriple"]
        dummy = np.zeros((32, 32), dtype=bool)
        _, _, jt = judge.register_view(dummy, None, a_r, b_r, c_r, a_t, b_t, c_t)
        st = station.similarity_from_triples(a_r, b_r, c_r, a_t, b_t, c_t)
        deltas = {k: abs(float(jt[k]) - float(st[k])) for k in ("scale", "tx", "ty")}
        worst = max(worst, max(deltas.values()))
        views[view] = {
            "judge": {k: float(jt[k]) for k in ("scale", "tx", "ty")},
            "station": {k: float(st[k]) for k in ("scale", "tx", "ty")},
            "absDelta": deltas,
            "pass": all(v <= 1e-6 for v in deltas.values()),
        }
    result = {"views": views, "worstAbsDelta": worst, "tolerance": 1e-6,
              "pass": all(v["pass"] for v in views.values())}
    (E / "parity.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print("PARITY worst=%.3e pass=%s" % (worst, result["pass"]))


if __name__ == "__main__":
    main()
