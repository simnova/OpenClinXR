#!/usr/bin/env python3
"""groom32: earlobe gate via groom31's earlobe31.py (import, no copy).

Adds groom32 rows (renders-32 + build-31 strands) to the module maps,
points E at E32, runs main. Writes E32/earlobe-gate31.json. The
module's hardImgCameraSide still tests groom31 keys; the groom32
equivalent is computed by the caller from the JSON."""
from __future__ import annotations

import sys
from pathlib import Path

E32 = Path(__file__).resolve().parent
E31 = E32.parent / "hair-groom31"
sys.path.insert(0, str(E31))

import earlobe31 as L  # noqa: E402

L.STRANDS["groom32"] = E31 / "build-31/strands.npz"
L.RENDERS["groom32"] = E32 / "renders-32"
L.E = E32
L.main()
