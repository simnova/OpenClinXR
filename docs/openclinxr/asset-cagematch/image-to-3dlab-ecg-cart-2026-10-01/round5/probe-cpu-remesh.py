#!/usr/bin/env python3
"""Record why TRELLIS.2 remesh cannot run off Metal on this installation."""

from __future__ import annotations

import argparse
import inspect
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--trellis-root", type=Path,
                        default=Path.home() / ".openclinxr-tools/trellis2-apple/src")
    args = parser.parse_args()
    sys.path.insert(0, str(args.trellis_root.resolve()))
    import trellis2.backends as backends

    source = inspect.getsource(backends)
    cpu_remesh_symbol = "fast_simplification" in source and "remesh_narrow_band_dc" in source
    payload = {
        "schemaVersion": "openclinxr.ecg-cart-round5-remesh-probe.v1",
        "requested": {"remesh": True, "remeshBand": 1, "remeshProject": 0, "device": "cpu"},
        "outcome": "not_runnable_off_metal",
        "hasMps": bool(backends.HAS_MPS),
        "hasCuda": bool(backends.HAS_CUDA),
        "hasRemesh": bool(backends.HAS_REMESH),
        "remeshImplementation": (
            f"{backends.remesh_narrow_band_dc.__module__}."
            f"{backends.remesh_narrow_band_dc.__name__}"
            if backends.remesh_narrow_band_dc is not None else None
        ),
        "cpuFallbackPresent": False,
        "sourceObservation": (
            "trellis2.backends only assigns remesh_narrow_band_dc from cumesh when the "
            "Metal/CUDA mesh backend loads; unlike simplify/fill, there is no trimesh or "
            "fast_simplification CPU remesh branch"
        ),
        "sourceContainsBothNames": cpu_remesh_symbol,
        "reason": (
            "This host exposes only the cumesh Metal remesher. Round 3 already failed its "
            "float-atomic kernel on M1, and forcing CPU disables the only remesh symbol. "
            "No R5-D mesh was fabricated; inner-shell inspection is therefore not applicable."
        ),
        "innerShellCheck": "not_applicable_no_mesh",
        "claimScope": "installed TRELLIS.2 Apple backend capability probe",
        "notEvidenceFor": ["general CPU remesh impossibility", "Quest readiness", "runtime adoption"],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
