#!/usr/bin/env python3
"""groom32: score build-31 (no settle) renders via groom31's score31.py.

Imports score31 (no copy) with sys.argv pinned to valid keys, then
patches module globals: REF=ctrl (exactly as groom31's own
--ref ctrl --test 31 run), TEST=groom32 (renders-32 + build-31
strands). Writes E32/score31-32.json."""
from __future__ import annotations

import sys
from pathlib import Path

E32 = Path(__file__).resolve().parent
E31 = E32.parent / "hair-groom31"

sys.argv = ["score31.py", "--ref", "ctrl", "--test", "ctrl"]
sys.path.insert(0, str(E31))

import score31 as S  # noqa: E402

S.REF = "ctrl"
S.TEST = "32"
S.IDDIR = {"ctrl": S._RENDERS["ctrl"],
           "32": E32 / "renders-32"}
S.SN = {"ctrl": S._STRANDS["ctrl"],
        "32": E31 / "build-31/strands.npz"}
S.E = E32
S.main()
