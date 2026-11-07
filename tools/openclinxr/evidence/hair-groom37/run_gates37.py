#!/usr/bin/env python3
"""groom37 E driver: score one build with gates34 (import, no copy)."""
from __future__ import annotations
import sys
from pathlib import Path
E = Path(__file__).resolve().parent
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                         / "strands"))
import gates34 as G  # noqa: E402
if __name__ == "__main__":
    sys.argv = ["gates34.py"] + sys.argv[1:]
    G.main()
