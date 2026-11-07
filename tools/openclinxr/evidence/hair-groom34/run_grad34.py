#!/usr/bin/env python3
"""groom34: gradient-anisotropy via groom31's grad31.py (import, no copy).

Adds opt34 (renders-34mask20) to RENDERS, points E at E34, runs main.
Writes E/metrics-grad34.json (also reproduces ctrl/opt30/opt31)."""
from __future__ import annotations
import sys
from pathlib import Path
E34 = Path(__file__).resolve().parent
E31 = E34.parent / "hair-groom31"
sys.path.insert(0, str(E31))
import grad31 as G  # noqa: E402
G.RENDERS["opt34"] = E34 / "renders-34mask20"
G.E = E34
G.main()
