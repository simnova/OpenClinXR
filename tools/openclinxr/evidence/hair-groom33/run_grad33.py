#!/usr/bin/env python3
"""groom33: gradient-anisotropy via groom31's grad31.py (import, no copy).

Adds opt33 (renders-33) to RENDERS, points E at E33, runs main.
Writes E33/metrics-grad31.json (also reproduces ctrl/opt30/opt31)."""
from __future__ import annotations

import sys
from pathlib import Path

E33 = Path(__file__).resolve().parent
E31 = E33.parent / "hair-groom31"
sys.path.insert(0, str(E31))

import grad31 as G  # noqa: E402

G.RENDERS["opt33"] = E33 / "renders-33"
G.E = E33
G.main()
