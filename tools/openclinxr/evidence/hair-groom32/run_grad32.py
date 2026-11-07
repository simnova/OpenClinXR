#!/usr/bin/env python3
"""groom32: gradient-anisotropy via groom31's grad31.py (import, no copy).

Adds opt32 (renders-32) to RENDERS, points E at E32, runs main.
Writes E32/metrics-grad31.json (also reproduces ctrl/opt30/opt31)."""
from __future__ import annotations

import sys
from pathlib import Path

E32 = Path(__file__).resolve().parent
E31 = E32.parent / "hair-groom31"
sys.path.insert(0, str(E31))

import grad31 as G  # noqa: E402

G.RENDERS["opt32"] = E32 / "renders-32"
G.E = E32
G.main()
