from __future__ import annotations

import sys
from pathlib import Path


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for p in [here.parent, *here.parents]:
        if (p / "pnpm-workspace.yaml").is_file():
            return p
    raise RuntimeError("workspace root (pnpm-workspace.yaml) not found from body_param station")


TOOLS_OPENCLINXR = repo_root() / "tools" / "openclinxr"
MAKECLOTHES_DIR = str(TOOLS_OPENCLINXR / "asset-pipeline" / "makeclothes")
if MAKECLOTHES_DIR not in sys.path:
    sys.path.insert(0, MAKECLOTHES_DIR)

import garment_coverage as garment_coverage  # noqa: E402


def pathlib_path(p) -> Path:
    """Small adapter so callers can pass str or Path."""
    return Path(p) if not isinstance(p, Path) else p
