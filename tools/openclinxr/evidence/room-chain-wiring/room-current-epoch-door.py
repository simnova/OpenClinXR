#!/usr/bin/env python3
"""Current-epoch stepdown door measurements for HEAD asset c7def44b.

Reuses BOXES + metrics() from the frozen measure-stepdown-door.py via import
(preserves its math/thresholds/box defs; old default API untouched) but reads
the fresh current-epoch capture and writes only to the new epoch directory.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path("/Users/patrick/.codex/worktrees/ci-gap-packages-20261026/openclinxr")
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/room-chain-wiring"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/room-chain-wiring"))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "measure_stepdown_door",
    ROOT / "tools/openclinxr/evidence/room-chain-wiring/measure-stepdown-door.py",
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

EPOCH = ROOT / "docs/openclinxr/room-realism/stepdown-current-20261026"
CAP = EPOCH / "captures" / "runtime-04-door-inside.png"
REFERENCE = ROOT / "docs/openclinxr/room-realism/stepdown-door-ideas/reference-door.jpg"
GLB = ROOT / "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb"

runtime = mod.metrics(CAP, "runtime")
reference = mod.metrics(REFERENCE, "reference")
runtime["leafVsReference"] = {
    "deltaRgb": (abs(__import__("numpy").subtract(
        runtime["leaf"]["meanRgb"], reference["leaf"]["meanRgb"])).round(2).tolist())
}
runtime["frameVsReference"] = {
    "deltaRgb": (abs(__import__("numpy").subtract(
        runtime["frame"]["meanRgb"], reference["frame"]["meanRgb"])).round(2).tolist())
}
report = {
    "schemaVersion": "openclinxr.stepdown-door-current-measurements.v1",
    "epoch": "stepdown-current-20261026",
    "pose": "derived learner-runtime pose 04 (derived-poses.json)",
    "sourceGlb": "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb",
    "sourceGlbSha256": hashlib.sha256(GLB.read_bytes()).hexdigest(),
    "capture": "captures/runtime-04-door-inside.png",
    "captureSha256": runtime.pop("captureSha256"),
    "reference": reference,
    "current": runtime,
    "gates": {"infillWallMaxAbsChannelDelta": 3, "boundaryMaximumColumnStep": 4,
              "minimumPlateLeafWidthFraction": 0.9, "minimumPlateLeafLuminanceRatio": 1.0},
    "boxProvenance": "BOXES verbatim from tools/openclinxr/evidence/room-chain-wiring/measure-stepdown-door.py",
    "notEvidenceFor": ["clinical validity", "exam equivalence", "Quest readiness", "production readiness"],
}
(EPOCH / "current-door-measurements.json").write_text(json.dumps(report, indent=2) + "\n")
mod.overlay([
    ("CURRENT — HEAD c7def44b", CAP, "runtime"),
    ("REFERENCE — operator-selected option A", REFERENCE, "reference"),
], EPOCH / "current-door-measurement-boxes.png")
print(json.dumps({
    "captureSha256": report["captureSha256"],
    "sourceGlbSha256": report["sourceGlbSha256"],
    "infillVsWall": report["current"]["infillVsWall"],
    "kickPlate": {k: report["current"]["kickPlate"][k] for k in
                  ("widthFractionOfLeaf", "meanLuminance", "leafMeanLuminance")},
}, indent=2))
