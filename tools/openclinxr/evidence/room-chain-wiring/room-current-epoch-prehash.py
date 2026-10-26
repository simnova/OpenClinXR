#!/usr/bin/env python3
"""Record pre-run SHA256 of the 17 frozen files for room-current-epoch."""
import hashlib
import json
from pathlib import Path

ROOT = Path("/Users/patrick/.codex/worktrees/ci-gap-packages-20261026/openclinxr")
FROZEN = [
    "docs/openclinxr/room-realism/cornice-flush/stepdown/shipped-budget.json",
    "docs/openclinxr/room-realism/cornice-flush/stepdown/door-reference-measurements.json",
    "docs/openclinxr/room-realism/cornice-flush/stepdown/v4-flush-tile/runtime-04-door-inside.png",
    "docs/openclinxr/room-realism/stepdown-room-v1-finish/budget.json",
    "docs/openclinxr/room-realism/stepdown-room-v1-finish/derived-poses.json",
    "docs/openclinxr/room-realism/stepdown-room-v1-finish/door-reference-measurements.json",
    "docs/openclinxr/room-realism/stepdown-room-v1-finish/REPORT.md",
    "tools/openclinxr/evidence/room-chain-wiring/the-stepdown-finish-meets-pixel-budgets.test.ts",
    "tools/openclinxr/evidence/room-chain-wiring/measure-stepdown-door.py",
    "tools/openclinxr/evidence/room-chain-wiring/cornice-flush-capture.ts",
    "tools/openclinxr/evidence/room-chain-wiring/cornice-flush-evidence.py",
    "tools/openclinxr/evidence/room-ward-finish-chain/ward-finish-chain-capture.ts",
    "tools/openclinxr/evidence/room-ward-finish-chain/door-measurements.py",
    "tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-budget.ts",
    "docs/openclinxr/room-realism/cornice-flush/measurements.json",
    "docs/openclinxr/room-realism/cornice-flush/build-manifest.json",
    "docs/openclinxr/room-realism/cornice-flush/REPORT.md",
]
out = {}
for rel in FROZEN:
    p = ROOT / rel
    if p.exists():
        out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    else:
        out[rel] = "MISSING"
dest = ROOT / "docs/openclinxr/room-realism/stepdown-current-20261026/pre-hashes.json"
dest.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
print(f"wrote {dest} ({len(out)} entries, missing={sum(1 for v in out.values() if v == 'MISSING')})")
