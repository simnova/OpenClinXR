#!/usr/bin/env python3
"""Import shim. Unique baker spawn is runBodyParam on the package copy.

Blender `--python` of THIS path must fail closed. Helper imports
(`BODY_CELL_PACK`, `_gender_presentation_to_macro`, …) load the package module.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

if __name__ == "__main__":
    raise SystemExit(
        "moved: packages/openclinxr/factory-stations/src/body_param/body_param_stage.py; unique spawn is runBodyParam"
    )


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for p in [here.parent, *here.parents]:
        if (p / "pnpm-workspace.yaml").is_file():
            return p
    raise RuntimeError("workspace root not found from body_param_stage import shim")


_SRC = _repo_root() / "packages/openclinxr/factory-stations/src/body_param/body_param_stage.py"
_SPEC = importlib.util.spec_from_file_location("_factory_stations_body_param_stage", _SRC)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"cannot load colocated body_param_stage from {_SRC}")
_MOD = importlib.util.module_from_spec(_SPEC)
sys.modules["_factory_stations_body_param_stage"] = _MOD
_SPEC.loader.exec_module(_MOD)
globals().update({k: v for k, v in vars(_MOD).items() if k not in {"__name__", "__file__", "__package__"}})
