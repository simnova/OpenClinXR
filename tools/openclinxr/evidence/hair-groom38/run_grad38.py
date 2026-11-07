#!/usr/bin/env python3
"""groom38: gradient-anisotropy via groom31's grad31.py (import, no copy).

Adds opt38 (build-38 views), points E at E38, runs main.
Writes E38/metrics-grad38.json (also reproduces ctrl/opt30/opt31)."""
from __future__ import annotations
import sys
from pathlib import Path
E38 = Path(__file__).resolve().parent
E31 = E38.parent / "hair-groom31"
sys.path.insert(0, str(E31))
import grad31 as G  # noqa: E402
G.RENDERS["opt38"] = E38 / "renders-38"
G.E = E38
G.main()
