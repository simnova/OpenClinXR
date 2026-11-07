#!/usr/bin/env python3
"""Evidence-only determinism check: JSON/NPZ payload hashes run-a vs run-b.

Payload hash: .json -> sha256 of canonical re-encoding (sorted keys,
compact separators); .npz -> sha256 over sorted keys, each with dtype,
shape, and raw bytes. Writes determinism.json.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

E = Path(__file__).resolve().parent
RUNS = [Path("/tmp/station0a-run-a"), Path("/tmp/station0a-run-b")]
FILES = ["registration.json", "run-record.json", "projected.json", "station-frame.npz"]


def payload_hash(path):
    if path.suffix == ".json":
        doc = json.loads(path.read_text())
        return hashlib.sha256(
            json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
    import numpy as np
    digest = hashlib.sha256()
    with np.load(path) as data:
        for key in sorted(data.files):
            arr = np.asarray(data[key])
            digest.update(key.encode() + b"\0" + str(arr.dtype).encode() + b"\0"
                          + str(arr.shape).encode() + b"\0" + arr.tobytes())
    return digest.hexdigest()


def main():
    rows, ok = {}, True
    for name in FILES:
        hashes = [payload_hash(run / name) for run in RUNS]
        same = hashes[0] == hashes[1]
        ok = ok and same
        rows[name] = {"runA": hashes[0], "runB": hashes[1], "identical": same}
    result = {"files": rows, "pass": ok,
              "codeHash": json.loads((RUNS[0] / "run-record.json").read_text())["codeHash"]}
    (E / "determinism.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print("DETERMINISM pass=%s" % ok)
    for name, row in rows.items():
        print("  %s %s.. %s" % (name, row["runA"][:16], "IDENTICAL" if row["identical"] else "DIFFER"))


if __name__ == "__main__":
    main()
