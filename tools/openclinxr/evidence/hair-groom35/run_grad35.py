#!/usr/bin/env python3
"""groom35: gradient-anisotropy via groom31's grad31.py (import, no copy).

Adds opt35a (step2 back) + opt35b (step3 back), points E at E35, runs
main. Writes E/metrics-grad35.json."""
from __future__ import annotations
import sys
from pathlib import Path
E35 = Path(__file__).resolve().parent
E31 = E35.parent / "hair-groom31"
sys.path.insert(0, str(E31))
import grad31 as G  # noqa: E402
G.RENDERS["opt35a"] = E35 / "renders-35step2"
G.RENDERS["opt35b"] = E35 / "renders-35step3"
G.E = E35
G.main()
