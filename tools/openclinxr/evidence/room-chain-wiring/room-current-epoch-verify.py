#!/usr/bin/env python3
"""Assemble verification-results.json + result.json for room-current-epoch."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path("/Users/patrick/.codex/worktrees/ci-gap-packages-20261026/openclinxr")
EPOCH = ROOT / "docs/openclinxr/room-realism/stepdown-current-20261026"
ARTIFACT = ROOT / ".openclinxr/slices/ci-gap-execution-20261026/jobs/room-current-epoch"

ARTIFACT.mkdir(parents=True, exist_ok=True)

budget = json.loads((EPOCH / "current-stepdown-budget.json").read_text())
door = json.loads((EPOCH / "current-door-measurements.json").read_text())


def run(cmd, logname):
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=600)
    (ARTIFACT / logname).write_text(
        f"$ {' '.join(cmd)}\nreturncode={p.returncode}\n--- stdout ---\n{p.stdout}\n--- stderr ---\n{p.stderr}\n",
        encoding="utf-8",
    )
    return p.returncode


rc_epoch_test = run(
    ["pnpm", "vitest", "run",
     "tools/openclinxr/evidence/room-chain-wiring/the-stepdown-current-epoch-meets-pixel-budgets.test.ts"],
    "vitest-current-epoch.log",
)
rc_build = run(["pnpm", "packages:build:agent"], "build-agent.log")
rc_typecheck = run(["pnpm", "packages:typecheck:agent"], "typecheck-agent.log")
rc_frozen = run(
    ["pnpm", "vitest", "run",
     "tools/openclinxr/evidence/room-chain-wiring/the-stepdown-finish-meets-pixel-budgets.test.ts"],
    "vitest-frozen-old.log",
)

results = {
    "schemaVersion": "openclinxr.room-current-epoch-verification.v1",
    "sourceGlbSha256": budget["sha256"],
    "budget": {k: budget[k] for k in
               ("bytes", "decodedMiBWithMips", "primitiveCount", "triangles", "materiallessPrimitives")},
    "door": {
        "captureSha256": door["captureSha256"],
        "infillVsWallDeltaRgb": door["current"]["infillVsWall"]["deltaRgb"],
        "boundaryStep": door["current"]["infillVsWall"]["maximumBoundaryColumnStep"],
        "plateWidthFraction": door["current"]["kickPlate"]["widthFractionOfLeaf"],
    },
    "returncodes": {
        "currentEpochTest": rc_epoch_test,
        "packagesBuildAgent": rc_build,
        "packagesTypecheckAgent": rc_typecheck,
        "frozenOldTest_expectedFail": rc_frozen,
    },
}
(ARTIFACT / "verification-results.json").write_text(json.dumps(results, indent=2) + "\n")

changed = []
for rel in [
    "docs/openclinxr/room-realism/stepdown-current-20261026/current-stepdown-budget.json",
    "docs/openclinxr/room-realism/stepdown-current-20261026/current-stepdown-budget.log",
    "docs/openclinxr/room-realism/stepdown-current-20261026/current-door-measurements.json",
    "docs/openclinxr/room-realism/stepdown-current-20261026/current-door-measurement-boxes.png",
    "docs/openclinxr/room-realism/stepdown-current-20261026/pre-hashes.json",
    "docs/openclinxr/room-realism/stepdown-current-20261026/captures/stage2-multiview.json",
    "tools/openclinxr/evidence/room-chain-wiring/the-stepdown-current-epoch-meets-pixel-budgets.test.ts",
    "tools/openclinxr/evidence/room-chain-wiring/room-current-epoch-prehash.py",
    "tools/openclinxr/evidence/room-chain-wiring/room-current-epoch-budget.py",
    "tools/openclinxr/evidence/room-chain-wiring/room-current-epoch-door.py",
    "tools/openclinxr/evidence/room-chain-wiring/room-current-epoch-posthash.py",
]:
    p = ROOT / rel
    if p.exists():
        changed.append({"path": rel, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()})
for png in sorted((EPOCH / "captures").glob("runtime-*.png")):
    changed.append({"path": f"docs/openclinxr/room-realism/stepdown-current-20261026/captures/{png.name}",
                    "sha256": hashlib.sha256(png.read_bytes()).hexdigest()})

result = {
    "job": "ph634-room-current-epoch",
    "status": "complete" if rc_epoch_test == 0 and rc_build == 0 and rc_typecheck == 0 else "blocked",
    "changed": changed,
    "remainingBlockers": [
        "frozen old test the-stepdown-finish-meets-pixel-budgets.test.ts fails on live GLB (pins 4c459f7f vs HEAD c7def44b) — expected mismatch this epoch closes; frozen file left untouched per task",
        "pnpm docs:drift-check fails: new epoch captures unregistered; pnpm docs:artifacts REFUSED shrink in worktree (protected registry) — registration must land on Main",
    ],
    "verification": str(ARTIFACT / "verification-results.json"),
}
(ARTIFACT / "result.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(results, indent=2))
