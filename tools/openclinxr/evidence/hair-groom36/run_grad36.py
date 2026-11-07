#!/usr/bin/env python3
"""groom36: gradient-anisotropy via groom31's grad31.py (import, no copy).

Adds opt36 (build-36 back view), points E at E36, runs main.
Writes E/metrics-grad36.json (also reproduces ctrl/opt30/opt31)."""
from __future__ import annotations
import sys
from pathlib import Path
E36 = Path(__file__).resolve().parent
E31 = E36.parent / "hair-groom31"
sys.path.insert(0, str(E31))
import grad31 as G  # noqa: E402
G.RENDERS["opt36"] = E36 / "renders-36"
G.E = E36
G.main()
