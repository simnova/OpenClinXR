#!/usr/bin/env python3
"""Derive packages/openclinxr/asset-registry/src/iris-capability-manifest.json (#522).

Reads `_EYE_IRIS_PACK` from `iris_palette` at generation time — never a second literal.
Licence text is CC0 1.0 from third-party-asset-licence-ledger.md row 47 (#356 headers).

Regenerate:
  python3 tools/openclinxr/asset-pipeline/anny/generate_iris_capability_manifest.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
OUT = REPO / "packages/openclinxr/asset-registry/src/iris-capability-manifest.json"

# Import the selector pack — the only source of option ids.
sys.path.insert(0, str(HERE))
from iris_palette import _EYE_IRIS_PACK  # noqa: E402

# Ledger row 47: MakeHuman system-asset eyes — CC0 1.0 verified in asset headers 2026-08-13 (#356).
LICENCE = "CC0 1.0"
LICENCE_SOURCE = (
    "docs/openclinxr/third-party-asset-licence-ledger.md row 47 "
    "(makehuman_system_assets eyes; headers verified 2026-08-13 #356)"
)


def main() -> None:
    options = [{"id": colour, "licence": LICENCE} for colour in _EYE_IRIS_PACK]
    manifest = {
        "schemaVersion": 1,
        "field": "eye_color",
        "derivedFrom": "tools/openclinxr/asset-pipeline/anny/iris_palette.py::_EYE_IRIS_PACK",
        "generatedBy": (
            "python3 tools/openclinxr/asset-pipeline/anny/generate_iris_capability_manifest.py"
        ),
        "licenceSource": LICENCE_SOURCE,
        "options": options,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print(f"wrote {OUT.relative_to(REPO)} ({len(options)} options from iris_palette._EYE_IRIS_PACK)")


if __name__ == "__main__":
    main()
