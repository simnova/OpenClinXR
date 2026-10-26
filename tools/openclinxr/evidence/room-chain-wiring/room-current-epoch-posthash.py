#!/usr/bin/env python3
"""Verify the 17 frozen files are byte-identical to pre-run hashes."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path("/Users/patrick/.codex/worktrees/ci-gap-packages-20261026/openclinxr")
pre = json.loads((ROOT / "docs/openclinxr/room-realism/stepdown-current-20261026/pre-hashes.json").read_text())
bad = []
for rel, expected in pre.items():
    actual = hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()
    if actual != expected:
        bad.append(rel)
if bad:
    print(f"FROZEN MUTATION: {bad}")
    sys.exit(1)
print(f"frozen-ok: all {len(pre)} files byte-identical")
