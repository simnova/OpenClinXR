#!/usr/bin/env python3
"""groom37: gradient-anisotropy via groom31's grad31.py (import, no copy).

Adds opt37 (build-37 back view), points E at E37, runs main.
Writes E37/metrics-grad37.json (also reproduces ctrl/opt30/opt31)."""
from __future__ import annotations
import sys
from pathlib import Path
E37 = Path(__file__).resolve().parent
E31 = E37.parent / "hair-groom31"
sys.path.insert(0, str(E31))
import grad31 as G  # noqa: E402
G.RENDERS["opt37"] = E37 / "renders-37"
G.E = E37
G.main()
