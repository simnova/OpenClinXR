#!/usr/bin/env python3
"""Derive packages/openclinxr/asset-registry/src/body-cell-capability-manifest.json (#670).

Reads `BODY_CELL_PACK` from `body_param_stage` at generation time — never a second
literal. The pack's macros are themselves computed by CALLING this stage's own
translators (`_years_to_age_macro`, `_gender_presentation_to_macro`), so this file is
a pure projection of capability: no id, band boundary or macro value appears here.

Licence text is copied from third-party-asset-licence-ledger.md rows 100-101 ONLY
after both rows have been re-read and verified to still say it (MPFB2 build-time
tool / MPFB2 bundled data CC0 1.0). If they do not, this generator aborts rather
than publishing an unverified licence string.

Regenerate:
  python3 tools/openclinxr/asset-pipeline/makeclothes/generate_body_cell_capability_manifest.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
OUT = REPO / "packages/openclinxr/asset-registry/src/body-cell-capability-manifest.json"
LEDGER = REPO / "docs/openclinxr/third-party-asset-licence-ledger.md"
STAGE_DIR = REPO / "packages/openclinxr/factory-stations/src/body_param"

# Import the stage's pack — the only source of option ids/macros.
sys.path.insert(0, str(STAGE_DIR))
from body_param_stage import BODY_CELL_PACK  # noqa: E402

LICENCE = BODY_CELL_PACK[0]["licence"]
LICENCE_SOURCE = (
    "docs/openclinxr/third-party-asset-licence-ledger.md row 100 "
    "(MPFB2 build-time tool; outputs ours) + row 101 (MPFB2 data/targets CC0 1.0, "
    "verified 2026-08-12 #343)"
)

# Verify BOTH ledger rows still say what LICENCE claims before copying it into the
# published manifest. Row numbers here are FILE LINE NUMBERS (the same convention the
# slice brief used): line 100 = MPFB2-as-tool, line 101 = MPFB2 bundled data CC0.
# A drift here aborts generation instead of shipping a stale grant.
_LEDGER_LINES = LEDGER.read_text(encoding="utf8").splitlines()
_ROW_100 = _LEDGER_LINES[99] if len(_LEDGER_LINES) >= 100 else ""
_ROW_101 = _LEDGER_LINES[100] if len(_LEDGER_LINES) >= 101 else ""
for marker, row in (("build-time tool", _ROW_100), ("CC0 1.0", _ROW_101), ("#343", _ROW_101)):
    if marker not in row:
        raise RuntimeError(
            f"#670: ledger row no longer says {marker!r} as expected — re-verify "
            f"third-party-asset-licence-ledger.md rows 100-101 before regenerating"
        )


def main() -> None:
    options = [
        {
            "id": cell["id"],
            "ageBand": cell["ageBand"],
            "sex": cell["sex"],
            "yearsLo": cell["yearsLo"],
            "yearsHi": cell["yearsHi"],
            "ageMacro": cell["ageMacro"],
            "genderMacro": cell["genderMacro"],
            "licence": cell["licence"],
        }
        for cell in BODY_CELL_PACK
    ]
    manifest = {
        "schemaVersion": 1,
        "field": "body_cell",
        "derivedFrom": "packages/openclinxr/factory-stations/src/body_param/body_param_stage.py::BODY_CELL_PACK",
        "generatedBy": (
            "python3 tools/openclinxr/asset-pipeline/makeclothes/"
            "generate_body_cell_capability_manifest.py"
        ),
        "licenceSource": LICENCE_SOURCE,
        "options": options,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print(f"wrote {OUT.relative_to(REPO)} ({len(options)} cells from body_param_stage.BODY_CELL_PACK)")


if __name__ == "__main__":
    main()
