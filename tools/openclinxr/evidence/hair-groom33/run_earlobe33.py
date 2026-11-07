#!/usr/bin/env python3
"""groom33: earlobe gate via groom31's earlobe31.py (import, no copy).

Adds groom33 rows (renders-33 + store strands-33) to the module maps,
points E at E33, runs main. Writes E33/earlobe-gate31.json."""
from __future__ import annotations

import sys
from pathlib import Path

E33 = Path(__file__).resolve().parent
E31 = E33.parent / "hair-groom31"
sys.path.insert(0, str(E31))

import earlobe31 as L  # noqa: E402

L.STRANDS["groom33"] = Path(
    "/Volumes/files/openclinxr-assets/store/hair-groom33/strands.npz")
L.RENDERS["groom33"] = E33 / "renders-33"
L.E = E33
L.main()
