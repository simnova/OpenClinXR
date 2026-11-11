#!/usr/bin/env python3
"""feature_hashes.py: final-GLB teeth/tongue rows hash like the swap report's outputAccessorHashes."""
from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FIXTURES = _load("test_swap_teeth_fixtures", "test_swap_teeth.py")
FEATURE = _load("feature_hashes", "feature_hashes.py")
SWAP = FIXTURES.SWAP


class FeatureHashesTest(unittest.TestCase):
    # Borrow the swap fixture's setup only, so the swap suite's own tests do not run twice.
    setUp = FIXTURES.TeethSwapFixtureTest.setUp
    tearDown = FIXTURES.TeethSwapFixtureTest.tearDown
    run_swap = FIXTURES.TeethSwapFixtureTest.run_swap

    def swapped(self) -> tuple[Path, dict]:
        self.run_swap()
        return self.root / "output.glb", json.loads((self.root / "report.json").read_text())

    def test_known_good_matches_the_swap_reports_own_rows(self) -> None:
        output, report = self.swapped()
        final = FEATURE.feature_hashes_of(output)
        for feature in ("teeth", "tongue"):
            self.assertEqual(final[feature], report["features"][feature]["outputAccessorHashes"])

    def test_a_perturbed_position_byte_changes_exactly_that_row(self) -> None:
        output, _ = self.swapped()
        before = FEATURE.feature_hashes_of(output)
        document, binary, _ = SWAP.GLB.parse_glb(output)
        _, mesh, _, _ = SWAP._feature_match(document, SWAP.DONOR_TOKEN["teeth"], "teeth")
        accessor = document["accessors"][mesh["primitives"][0]["attributes"]["POSITION"]]
        view = document["bufferViews"][accessor["bufferView"]]
        at = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
        mutated = bytearray(binary)
        mutated[at] ^= 0xFF
        perturbed = self.root / "perturbed.glb"
        perturbed.write_bytes(SWAP.GLB.encode_glb(document, bytes(mutated)))
        after = FEATURE.feature_hashes_of(perturbed)
        changed = [
            (feature, b["slot"], b["sha256"], a["sha256"])
            for feature in ("teeth", "tongue")
            for b, a in zip(before[feature], after[feature])
            if b != a
        ]
        for feature, slot, old, new in changed:
            print(f"PERTURBED {feature} {slot} before={old} after={new}")
        self.assertEqual([(f, s) for f, s, _, _ in changed], [("teeth", "primitive[0].attributes.POSITION")])


if __name__ == "__main__":
    unittest.main()
