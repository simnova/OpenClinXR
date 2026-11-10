#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
import os
import subprocess
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("swap_teeth", HERE / "swap_teeth.py")
assert SPEC is not None and SPEC.loader is not None
SWAP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SWAP)


class Fixture:
    def __init__(self, misalign: bool = False) -> None:
        # misalign=True skips the 4-byte view padding, the layout the shipped physician carries
        # since 20f073984 (2902 of 3675 accessors break glTF 2.0 3.6.2.4).
        self.misalign = misalign
        self.binary = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def view(self, payload: bytes, target: int | None = None) -> int:
        while not self.misalign and len(self.binary) % 4:
            self.binary.append(0)
        index = len(self.views)
        self.views.append(
            {
                "buffer": 0,
                "byteOffset": len(self.binary),
                "byteLength": len(payload),
                **({"target": target} if target else {}),
            }
        )
        self.binary.extend(payload)
        return index

    def accessor(
        self, values: np.ndarray, component: int, kind: str, target: int = 34962
    ) -> int:
        array = np.ascontiguousarray(values)
        view = self.view(array.tobytes(), target)
        self.accessors.append(
            {
                "bufferView": view,
                "componentType": component,
                "count": len(array),
                "type": kind,
            }
        )
        return len(self.accessors) - 1


def make_glb(
    fitted: bool,
    joint_names: list[str] | None = None,
    zero_targets: bool = False,
    misalign: bool = False,
) -> tuple[bytes, bytes, bytes]:
    fixture = Fixture(misalign)
    teeth_image = b"fixture-cc0-teeth-image"
    tongue_image = b"fixture-cc0-tongue-image"
    image_views = [fixture.view(teeth_image), fixture.view(tongue_image)]
    body_position = fixture.accessor(
        np.asarray([[7.0, 8.0, 9.0]], dtype="<f4"), 5126, "VEC3"
    )
    meshes = [{"name": "fixture_body", "primitives": [{"attributes": {"POSITION": body_position}}]}]
    if zero_targets:
        # glTF 2.0 3.6.2.3 all-zero accessor (no bufferView, no sparse), as gltf-transform writes
        # all-zero morph deltas; the shipped MPFB bodies carry 377 of these.
        fixture.accessors.append({"componentType": 5126, "type": "VEC3", "count": 1})
        meshes[0]["primitives"][0]["targets"] = [{"POSITION": len(fixture.accessors) - 1}]
    nodes = [{"name": name} for name in (joint_names or ["Hip", "Head", "jaw", "tongue"])]
    skin_joints = list(range(len(nodes)))
    for feature_index, feature in enumerate(("teeth", "tongue")):
        indices = fixture.accessor(
            np.asarray([[0], [1], [2]], dtype="<u2"), 5123, "SCALAR", 34963
        )
        positions = fixture.accessor(
            np.asarray([[0.0, 0.0, 0.0], [0.01, 0.0, 0.01], [0.0, 0.0, 0.02]], dtype="<f4"),
            5126,
            "VEC3",
        )
        mouth_targets = []
        if zero_targets:
            fixture.accessors.append({"componentType": 5126, "type": "VEC3", "count": 3})
            mouth_targets = [{"POSITION": len(fixture.accessors) - 1}]
        joint_value = 2 if feature == "teeth" else 3
        joints = fixture.accessor(
            np.asarray([[joint_value, 1, 0, 0]] * 3, dtype="u1"), 5121, "VEC4"
        )
        weights = fixture.accessor(
            np.asarray([[0.6, 0.4, 0.0, 0.0]] * 3, dtype="<f4"), 5126, "VEC4"
        )
        prefix = "openclinxr_fitted" if fitted else "openclinxr_hm08"
        meshes.append(
            {
                "name": f"{prefix}_{feature}_fixture_mesh",
                "primitives": [
                    {
                        "indices": indices,
                        "attributes": {
                            "POSITION": positions,
                            "JOINTS_0": joints,
                            "WEIGHTS_0": weights,
                        },
                        "material": feature_index,
                        **({"targets": mouth_targets} if mouth_targets else {}),
                    }
                ],
            }
        )
        nodes.append(
            {"name": f"{feature}_slot", "mesh": len(meshes) - 1, "skin": 0}
        )
    document = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(fixture.binary)}],
        "bufferViews": fixture.views,
        "accessors": fixture.accessors,
        "images": [
            {"name": "teeth.png", "mimeType": "image/png", "bufferView": image_views[0]},
            {"name": "tongue01_diffuse.png", "mimeType": "image/png", "bufferView": image_views[1]},
        ],
        "samplers": [{"magFilter": 9729, "minFilter": 9987}],
        "textures": [
            {"source": 0, "sampler": 0},
            {"source": 1, "sampler": 0},
        ],
        "materials": [
            {"name": "teeth", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}},
            {"name": "tongue", "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}}},
        ],
        "meshes": meshes,
        "nodes": nodes,
        "skins": [{"joints": skin_joints}],
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "scene": 0,
    }
    return SWAP.GLB.encode_glb(document, bytes(fixture.binary)), teeth_image, tongue_image


class TeethSwapFixtureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="openclinxr-teeth-swap-")
        self.root = Path(self.temp.name)
        shipped, _, _ = make_glb(False)
        donor, teeth_image, tongue_image = make_glb(True)
        self.shipped = self.root / "shipped.glb"
        self.donor = self.root / "scratch.glb"
        self.shipped.write_bytes(shipped)
        self.donor.write_bytes(donor)
        self.expected = {
            "teeth": SWAP.sha256(teeth_image),
            "tongue": SWAP.sha256(tongue_image),
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_swap(self, shipped: Path | None = None, donor: Path | None = None):
        output = self.root / "output.glb"
        report = self.root / "report.json"
        return SWAP.swap(
            shipped or self.shipped,
            donor or self.donor,
            output,
            report,
            expected_image_sha256=self.expected,
        ), output

    def test_refuses_zero_or_two_hm08_teeth(self) -> None:
        document, binary, _ = SWAP.GLB.parse_glb(self.shipped)
        document["meshes"][1]["name"] = "not_a_mouth_mesh"
        zero = self.root / "zero.glb"
        zero.write_bytes(SWAP.GLB.encode_glb(document, binary))
        with self.assertRaisesRegex(RuntimeError, "teeth hm08=0 fitted=0"):
            self.run_swap(shipped=zero)

        document, binary, _ = SWAP.GLB.parse_glb(self.shipped)
        document["meshes"].append(copy.deepcopy(document["meshes"][1]))
        document["nodes"].append(
            {"name": "duplicate_teeth_slot", "mesh": len(document["meshes"]) - 1, "skin": 0}
        )
        two = self.root / "two.glb"
        two.write_bytes(SWAP.GLB.encode_glb(document, binary))
        with self.assertRaisesRegex(RuntimeError, "teeth hm08=2 fitted=0"):
            self.run_swap(shipped=two)

    def test_already_fitted_pair_skips_without_writing_output(self) -> None:
        fitted, _, _ = make_glb(True)
        shipped = self.root / "mpfb-peds-parent-aisha.glb"
        shipped.write_bytes(fitted)
        output = self.root / "must-not-exist.glb"
        report = self.root / "already-fitted-report.json"
        command = [
            sys.executable,
            str(HERE / "swap_teeth.py"),
            "--input",
            str(shipped),
            "--scratch",
            str(self.root / "unused-scratch.glb"),
            "--output",
            str(output),
            "--report",
            str(report),
        ]
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            env={**os.environ, "PYTHONPYCACHEPREFIX": str(self.root / "pycache")},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "TEETH_SWAP_SKIP mpfb-peds-parent-aisha already-fitted")
        self.assertFalse(output.exists())
        self.assertEqual(json.loads(report.read_text(encoding="utf-8"))["status"], "already-fitted")

    def test_refuses_hm08_and_fitted_mix(self) -> None:
        document, binary, _ = SWAP.GLB.parse_glb(self.shipped)
        fitted, _, _ = make_glb(True)
        fitted_path = self.root / "fitted-for-mix.glb"
        fitted_path.write_bytes(fitted)
        fitted_document, _, _ = SWAP.GLB.parse_glb(fitted_path)
        document["meshes"].extend(copy.deepcopy(fitted_document["meshes"][1:]))
        mixed = self.root / "mixed.glb"
        mixed.write_bytes(SWAP.GLB.encode_glb(document, binary))
        with self.assertRaisesRegex(RuntimeError, "teeth hm08=1 fitted=1"):
            self.run_swap(shipped=mixed)

    def test_refuses_unmapped_joint_name(self) -> None:
        donor, _, _ = make_glb(True, ["Hip", "Head", "jaw", "fixture_missing_joint"])
        bad = self.root / "unmapped.glb"
        bad.write_bytes(donor)
        with self.assertRaisesRegex(RuntimeError, "unmapped by NAME"):
            self.run_swap(donor=bad)

    def test_original_bin_is_an_exact_prefix_and_only_mouth_accessors_move(self) -> None:
        report, output = self.run_swap()
        _, shipped_binary, _ = SWAP.GLB.parse_glb(self.shipped)
        output_document, output_binary, _ = SWAP.GLB.parse_glb(output)
        self.assertEqual(output_binary[: len(shipped_binary)], shipped_binary)
        self.assertTrue(report["cw1OriginalBinPrefix"]["unchanged"])
        self.assertGreater(len(report["protectedAccessorHashes"]), 0)
        names = [mesh.get("name", "") for mesh in output_document["meshes"]]
        self.assertEqual(sum("openclinxr_fitted_teeth" in name for name in names), 1)
        self.assertEqual(sum("openclinxr_fitted_tongue" in name for name in names), 1)
        self.assertEqual(sum("openclinxr_hm08_teeth" in name for name in names), 0)
        self.assertEqual(sum("openclinxr_hm08_tongue" in name for name in names), 0)

    def test_all_zero_accessors_are_hashed_and_carried_without_bytes(self) -> None:
        shipped, _, _ = make_glb(False, zero_targets=True)
        donor, _, _ = make_glb(True, zero_targets=True)
        zero_shipped = self.root / "zero-shipped.glb"
        zero_donor = self.root / "zero-scratch.glb"
        zero_shipped.write_bytes(shipped)
        zero_donor.write_bytes(donor)
        report, output = self.run_swap(zero_shipped, zero_donor)
        rows = [row for row in report["protectedAccessorHashes"] if row["slot"].endswith(".targets[0].POSITION")]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["meshName"], "fixture_body")
        document, _, _ = SWAP.GLB.parse_glb(output)
        teeth = next(mesh for mesh in document["meshes"] if "openclinxr_fitted_teeth" in mesh.get("name", ""))
        target = document["accessors"][teeth["primitives"][0]["targets"][0]["POSITION"]]
        self.assertNotIn("bufferView", target)
        self.assertNotIn("sparse", target)
        self.assertEqual(target["count"], 3)


    def test_aligned_input_takes_the_append_only_path(self) -> None:
        report, _ = self.run_swap()
        self.assertNotIn("alignedRelayout", report)
        document, binary, _ = SWAP.GLB.parse_glb(self.shipped)
        self.assertEqual(SWAP.relayout_aligned(document, binary)[2], None)

    def test_misaligned_input_is_relaid_4_aligned_with_values_unchanged(self) -> None:
        shipped, _, _ = make_glb(False, misalign=True)
        misaligned = self.root / "misaligned-shipped.glb"
        misaligned.write_bytes(shipped)
        input_document, input_binary, _ = SWAP.GLB.parse_glb(misaligned)
        before = SWAP.misaligned_accessor_count(input_document)
        self.assertGreater(before, 0, "fixture must exhibit the defect")
        report, output = self.run_swap(misaligned)
        relayout = report["alignedRelayout"]
        self.assertTrue(relayout["applied"])
        self.assertEqual(relayout["misalignedAccessorsBefore"], before)
        self.assertEqual(relayout["misalignedAccessorsAfter"], 0)
        output_document, output_binary, _ = SWAP.GLB.parse_glb(output)
        self.assertEqual(SWAP.misaligned_accessor_count(output_document), 0)
        self.assertTrue(
            all(int(view.get("byteOffset", 0)) % 4 == 0 for view in output_document["bufferViews"])
        )
        excluded = {
            index
            for index, mesh in enumerate(output_document["meshes"])
            if "openclinxr_fitted" in mesh.get("name", "")
        }
        self.assertEqual(
            SWAP._protected_accessor_hashes(output_document, output_binary, excluded),
            SWAP._protected_accessor_hashes(input_document, input_binary, excluded),
        )
        self.assertEqual(report["protectedAccessorHashes"],
                         SWAP._protected_accessor_hashes(input_document, input_binary, excluded))
        image = output_document["images"][0]
        view = output_document["bufferViews"][image["bufferView"]]
        start = int(view.get("byteOffset", 0))
        self.assertEqual(output_binary[start : start + int(view["byteLength"])], b"fixture-cc0-teeth-image")


if __name__ == "__main__":
    unittest.main()
