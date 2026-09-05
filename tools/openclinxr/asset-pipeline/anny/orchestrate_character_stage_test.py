#!/usr/bin/env python3
"""Stdlib unittest for the WCG-4 baker split in orchestrate_character.generate().

Proves the two character bakers are separately invocable at the OBJ/Blender
boundary (world-compile-graph-brief-2026-08-27.md Phase 4):
  stage=mesh    (BodyAnnyRef)  -> generate_mesh only, NEVER automate_blender
  stage=blender (BlenderDress) -> automate_blender only on an existing body,
                                  NEVER generate_mesh, refuses without a body
  stage=both    (default)      -> both stages (unchanged behaviour)

subprocess.check_call is faked (FakeRunner) — no Blender, no Anny model.
Run: python3 tools/openclinxr/asset-pipeline/anny/orchestrate_character_stage_test.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ORCH = load_module(HERE / "orchestrate_character.py", "orchestrate_character")


def make_params() -> dict:
    # phenotype carries a body-shape field (age) so the issue-294 refuse gate passes.
    return {
        "age": 8,
        "body_profile": "pediatric_school_age",
        "seed": 1001,
        "phenotype": {
            "age": 8,
            "height_cm": 125,
            "build": "slender_asthma",
            "garmentLayers": ["short_sleeve_exam_tshirt"],
        },
    }


class FakeRunner:
    """Records run_cmd calls; materializes mesh-stage outputs on disk."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def __call__(self, cmd: list[str], cwd=None, timeout=None) -> None:
        self.calls.append(list(cmd))
        if str(ORCH.GEN_MESH) in cmd:
            out = Path(cmd[cmd.index("--output") + 1])
            man = Path(cmd[cmd.index("--manifest") + 1])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("mock anny base obj\n", encoding="utf-8")
            man.write_text("{}\n", encoding="utf-8")

    def has_mesh(self) -> bool:
        return any(str(ORCH.GEN_MESH) in call for call in self.calls)

    def has_blender(self) -> bool:
        return any(str(ORCH.BLENDER_STAGE) in call for call in self.calls)


class GenerateStageSplitTest(unittest.TestCase):
    def setUp(self) -> None:
        self._runner = FakeRunner()
        self._orig_run_cmd = ORCH.run_cmd
        ORCH.run_cmd = self._runner
        self._tmp = tempfile.TemporaryDirectory(prefix="openclinxr-orch-stage-")

    def tearDown(self) -> None:
        ORCH.run_cmd = self._orig_run_cmd
        self._tmp.cleanup()

    def _glb(self, name: str = "actor.glb") -> str:
        return str(Path(self._tmp.name) / name)

    def _write_body(self, name: str) -> str:
        """Simulate a prior mesh-stage run: body OBJ + manifest on disk."""
        glb = self._glb(name)
        obj = Path(glb).with_suffix(".anny_base.obj")
        man = Path(glb).with_suffix(".anny_manifest.json")
        obj.write_text("mock anny base obj\n", encoding="utf-8")
        man.write_text("{}\n", encoding="utf-8")
        return glb

    def test_mesh_only_runs_generate_mesh_and_never_automate_blender(self) -> None:
        glb = self._glb()
        out = ORCH.generate(make_params(), "peds_asthma_parent_anxiety_v1", "patient", glb, stage="mesh")
        self.assertEqual(len(self._runner.calls), 1)
        self.assertTrue(self._runner.has_mesh())
        self.assertFalse(self._runner.has_blender())
        self.assertIn("obj", out)
        self.assertIn("manifest", out)
        self.assertNotIn("glb", out)
        # The mesh output is the body the blender stage would consume.
        self.assertTrue(Path(out["obj"]).is_file())
        self.assertTrue(Path(out["manifest"]).is_file())

    def test_blender_only_refuses_without_existing_body(self) -> None:
        glb = self._glb()
        with self.assertRaises(SystemExit) as ctx:
            ORCH.generate(make_params(), "peds_asthma_parent_anxiety_v1", "patient", glb, stage="blender")
        self.assertIn("stage=blender requires an existing body", str(ctx.exception))

    def test_blender_only_runs_automate_blender_and_never_generate_mesh(self) -> None:
        glb = self._write_body("actor.glb")
        out = ORCH.generate(make_params(), "peds_asthma_parent_anxiety_v1", "patient", glb, stage="blender")
        self.assertEqual(len(self._runner.calls), 1)
        self.assertTrue(self._runner.has_blender())
        self.assertFalse(self._runner.has_mesh())
        self.assertIn("glb", out)
        self.assertIn("report", out)
        self.assertIn("provenance", out)
        self.assertIn("bundle", out)

    def test_both_default_runs_mesh_then_blender(self) -> None:
        glb = self._glb()
        out = ORCH.generate(make_params(), "peds_asthma_parent_anxiety_v1", "patient", glb)
        self.assertEqual(len(self._runner.calls), 2)
        self.assertTrue(self._runner.has_mesh())
        self.assertTrue(self._runner.has_blender())
        self.assertIn("glb", out)

    def _write_wardrobe_lock_sidecar(self, glb: str, payload: dict) -> None:
        sidecar = Path(glb).with_name(Path(glb).stem + ".wcg-wardrobe-lock.json")
        sidecar.write_text(json.dumps(payload), encoding="utf-8")

    def test_both_with_skip_blender_sidecar_runs_mesh_but_never_blender(self) -> None:
        glb = self._glb()
        self._write_wardrobe_lock_sidecar(glb, {"skipBlender": True, "locked": True})
        out = ORCH.generate(make_params(), "peds_asthma_parent_anxiety_v1", "patient", glb)
        self.assertEqual(len(self._runner.calls), 1)
        self.assertTrue(self._runner.has_mesh())
        self.assertFalse(self._runner.has_blender())
        # Same return shape as stage=mesh: the body baked, no GLB claim.
        self.assertIn("obj", out)
        self.assertIn("manifest", out)
        self.assertNotIn("glb", out)

    def test_blender_with_skip_blender_sidecar_returns_without_blender_and_does_not_refuse(self) -> None:
        # No existing body on disk — the sidecar skip must short-circuit before
        # the stage=blender existing-body refuse.
        glb = self._glb()
        self._write_wardrobe_lock_sidecar(glb, {"skipBlender": True})
        out = ORCH.generate(make_params(), "peds_asthma_parent_anxiety_v1", "patient", glb, stage="blender")
        self.assertEqual(len(self._runner.calls), 0)
        self.assertFalse(self._runner.has_mesh())
        self.assertFalse(self._runner.has_blender())
        self.assertIn("obj", out)
        self.assertIn("manifest", out)

    def test_sidecar_without_skip_blender_leaves_behavior_unchanged(self) -> None:
        glb = self._glb()
        self._write_wardrobe_lock_sidecar(glb, {"locked": True})  # no skipBlender flag
        out = ORCH.generate(make_params(), "peds_asthma_parent_anxiety_v1", "patient", glb)
        self.assertEqual(len(self._runner.calls), 2)
        self.assertTrue(self._runner.has_mesh())
        self.assertTrue(self._runner.has_blender())
        self.assertIn("glb", out)

    def test_invalid_stage_refuses(self) -> None:
        glb = self._glb()
        with self.assertRaises(SystemExit) as ctx:
            ORCH.generate(make_params(), "peds_asthma_parent_anxiety_v1", "patient", glb, stage="nope")
        self.assertIn("stage must be one of mesh, blender, both", str(ctx.exception))

    def test_cli_wires_stage_flag(self) -> None:
        glb = self._glb()
        argv = [
            "orchestrate_character.py",
            "--stage", "mesh",
            "--case-actor-preset", "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1",
            "--output-glb", glb,
        ]
        with mock.patch.object(sys, "argv", argv):
            ORCH.main()
        self.assertTrue(self._runner.has_mesh())
        self.assertFalse(self._runner.has_blender())

    def test_stage_choices_are_exposed(self) -> None:
        self.assertEqual(tuple(ORCH.CHARACTER_STAGES), ("mesh", "blender", "both"))
        # The default stays "both": existing callers are unaffected.
        self.assertEqual(ORCH.generate.__defaults__[-1], "both")


if __name__ == "__main__":
    unittest.main(verbosity=2)
