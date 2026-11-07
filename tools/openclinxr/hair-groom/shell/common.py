"""Shared helpers for the S8 textured-hair-shell station (pure python).

Inputs log: every stage calls log_open() for each file it reads or
writes; assemble.py merges them into E/inputs-opened.txt (runtime
inputs log). Paths are repo-relative; absolute paths are resolved only
for hashing/display, never constructed from other worktrees.

Path ban (same as cards0): never read sibling-lane work products. The
banned fragments below are grep-checked over S8 *.py plus the evidence
*.json/*.txt record (RESULT/DONE excluded from the text-file check,
same as cards0).
"""
from __future__ import annotations

import hashlib
from pathlib import Path

# Fragments of sibling-lane / forbidden inputs. Shared fixtures that
# cards0 opened and passed with (judge module, target masks/photos,
# scalp1, cage1 SDF, look7 params, scorer cameras) are NOT banned.
BANNED = ["hair-" + "guides", "children" + "_station", "hair-" + "cap",
          "hair-" + "hem", "hair-" + "crown", "hair-" + "sweep",
          "score" + ".py"]

_OPENED: list[str] = []


def log_open(path) -> None:
    p = str(path)
    if p not in _OPENED:
        _OPENED.append(p)


def merge_opened(out_txt) -> list[str]:
    out_txt = Path(out_txt)
    prev: list[str] = []
    if out_txt.exists():
        prev = [ln.strip() for ln in
                out_txt.read_text().splitlines() if ln.strip()]
    merged = sorted(set(prev) | set(_OPENED))
    out_txt.write_text("\n".join(merged) + "\n")
    return merged


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def srgb(c: float) -> float:
    """Linear -> sRGB per channel (same conversion cards0 used)."""
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1.0 / 2.4) - 0.055


def smoothstep(a: float, b: float, x):
    import numpy as np
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)
