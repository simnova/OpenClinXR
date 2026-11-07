#!/usr/bin/env python3
"""groom33: score strands-33 renders via groom31's score31.py.

Imports score31 (no copy) with sys.argv pinned to valid keys, then
patches module globals: REF=ctrl (exactly as groom31's own
--ref ctrl --test 31 run), TEST=groom33 (renders-33 + store
strands-33). Writes E33/score31-33.json."""
from __future__ import annotations

import sys
from pathlib import Path

E33 = Path(__file__).resolve().parent
E31 = E33.parent / "hair-groom31"

sys.argv = ["score31.py", "--ref", "ctrl", "--test", "ctrl"]
sys.path.insert(0, str(E31))

import score31 as S  # noqa: E402

S.REF = "ctrl"
S.TEST = "33"
S.IDDIR = {"ctrl": S._RENDERS["ctrl"],
           "33": E33 / "renders-33"}
S.SN = {"ctrl": S._STRANDS["ctrl"],
        "33": Path("/Volumes/files/openclinxr-assets/store/hair-groom33")
        / "strands.npz"}
S.E = E33
S.main()
