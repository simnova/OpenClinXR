#!/usr/bin/env python3
"""Save current-epoch budget JSON for HEAD asset c7def44b (no frozen mutation)."""
import json
import subprocess
from pathlib import Path

ROOT = Path("/Users/patrick/.codex/worktrees/ci-gap-packages-20261026/openclinxr")
raw = subprocess.run(
    ["pnpm", "exec", "tsx",
     "tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-budget.ts",
     "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb"],
    cwd=ROOT, capture_output=True, text=True, timeout=300,
)
# pnpm prints warnings to stdout; JSON starts at first '{'
start = raw.stdout.index("{")
budget = json.loads(raw.stdout[start:])
dest = ROOT / "docs/openclinxr/room-realism/stepdown-current-20261026/current-stepdown-budget.json"
dest.write_text(json.dumps(budget, indent=2) + "\n", encoding="utf-8")
log = ROOT / "docs/openclinxr/room-realism/stepdown-current-20261026/current-stepdown-budget.log"
log.write_text(
    f"returncode={raw.returncode}\nsha256={budget['sha256']}\nbytes={budget['bytes']}\n"
    f"decodedMiBWithMips={budget['decodedMiBWithMips']}\n"
    f"primitives={budget['primitiveCount']} triangles={budget['triangles']} "
    f"materialless={budget['materiallessPrimitives']}\n",
    encoding="utf-8",
)
print(log.read_text(encoding="utf-8"))
