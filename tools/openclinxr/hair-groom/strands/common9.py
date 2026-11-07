"""S9 shared helpers: inputs log + hashing (own-directory import only)."""
from __future__ import annotations

import hashlib
from pathlib import Path

_OPENED: list[str] = []


def log_open(path) -> None:
    p = str(path)
    if p not in _OPENED:
        _OPENED.append(p)


def merge_opened(out_txt) -> list[str]:
    out_txt = Path(out_txt)
    prev: list[str] = []
    if out_txt.exists():
        prev = [ln.strip() for ln in out_txt.read_text().splitlines()
                if ln.strip()]
    merged = sorted(set(prev) | set(_OPENED))
    out_txt.write_text("\n".join(merged) + "\n")
    return merged


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
