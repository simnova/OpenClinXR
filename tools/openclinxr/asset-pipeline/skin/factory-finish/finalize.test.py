"""Job-root and recipe refusal. Does not claim a Blender bake."""
import ast
import json
import os
import pathlib
import sys
import tempfile
import unittest

import recipe

ROOT = pathlib.Path(__file__).resolve().parents[5]


class FinalizeGuards(unittest.TestCase):
    def test_unknown_recipe_refuses(self):
        with self.assertRaises(RuntimeError):
            recipe.require_recipe("tara-other")

    def test_authored_recipe_is_the_explicit_tara_id(self):
        data, path = recipe.load_authored()
        self.assertEqual(data["id"], recipe.RECIPE_ID)
        self.assertTrue(path.is_file())
        self.assertEqual(data["albedo"]["sha256"], "8d8b7dac34f97ebdd8605b51d527ac6863685054b33e1004b3e309599542beaf")

    def test_path_outside_job_root_refuses_before_use(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = pathlib.Path(tmp) / "job"
            job.mkdir()
            outside = pathlib.Path(tmp) / "outside.glb"
            outside.write_bytes(b"nope")
            with self.assertRaises(RuntimeError):
                recipe.confine(job, outside)

    def test_authored_bake_graph_is_explicit(self):
        data, _path = recipe.load_authored()
        settings = recipe.bake_settings(data)
        self.assertEqual(settings["dermal"]["bumpStrength"], 0.4)
        self.assertEqual(settings["dermal"]["voronoiFeature"], "F1")
        self.assertEqual(settings["cycles"]["normalSpace"], "TANGENT")
        self.assertEqual(settings["tools"]["mpfbModule"], "bl_ext.user_default.mpfb")
        self.assertEqual(len(recipe.bake_fingerprint(settings)), 64)
        broken = json.loads(json.dumps(data))
        del broken["bake"]["dermal"]["cellTexels"]
        with self.assertRaises(RuntimeError):
            recipe.bake_settings(broken)

    def test_baker_reads_evaluated_mesh_not_ambient_dermal_env(self):
        text = (pathlib.Path(__file__).resolve().parent / "bake_final_rest.py").read_text(encoding="utf-8")
        self.assertIn("evaluated_get", text)
        self.assertIn("to_mesh_clear", text)
        self.assertIn("preserve_all_data_layers=True", text)
        self.assertNotIn('os.environ.get("DERMAL_', text)
        tree = ast.parse(text)
        coords = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_coords")
        dumped = ast.dump(coords)
        self.assertNotIn("data", dumped)
        self.assertIn("mesh", dumped)
        self.assertIn("_with_evaluated_mesh", dumped)

    def test_stage_copies_then_replaces_and_routes_early_failures(self):
        stage = ROOT / "tools/openclinxr/asset-pipeline/makeclothes/seated_clip_bind_stage.py"
        text = stage.read_text(encoding="utf-8")
        self.assertIn('staging = attempt / "publication-staging.glb"', text)
        self.assertIn("shutil.copyfile(finished, staging)", text)
        self.assertNotIn("os.replace(os.fspath(finished), args.output)", text)
        main = text.split("def main(argv):", 1)[1]
        self.assertNotIn("_reject(", main)
        self.assertIn("_fail(", main)

    def test_selected_early_failure_keeps_accepted_report(self):
        stage = ROOT / "tools/openclinxr/asset-pipeline/makeclothes/seated_clip_bind_stage.py"
        tree = ast.parse(stage.read_text(encoding="utf-8"))
        wanted = {"STAGE_ID", "_write_report", "_reject", "_skin_mode", "_fail"}
        body = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "STAGE_ID" for target in node.targets):
                body.append(node)
            if isinstance(node, ast.FunctionDef) and node.name in wanted:
                body.append(node)
        namespace = {"json": json, "Path": pathlib.Path, "sys": sys, "datetime": __import__("datetime").datetime, "timezone": __import__("datetime").timezone}
        exec(compile(ast.Module(body=body, type_ignores=[]), str(stage), "exec"), namespace)
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            attempt = root / "attempt"
            attempt.mkdir()
            report = root / "accepted.json"
            report.write_bytes(b"PRIOR_RECEIPT")
            output = root / "accepted.glb"
            output.write_bytes(b"PRIOR_GLB")
            args = type("A", (), {})()
            args.skin_recipe_id = "tara-cc0-final-rest-v1"
            args.skin_attempt_dir = str(attempt)
            args.skin_job_root = str(root)
            args.report = str(report)
            code = namespace["_fail"](args, "missing_input:actor", "")
            self.assertEqual(code, 2)
            self.assertEqual(report.read_bytes(), b"PRIOR_RECEIPT")
            self.assertEqual(output.read_bytes(), b"PRIOR_GLB")
            failure = json.loads((attempt / "stage-failure.json").read_text(encoding="utf-8"))
            self.assertEqual(failure["reason"], "missing_input:actor")
            preserved = (attempt / "stage-failure.json").read_bytes()
            again = namespace["_fail"](args, "export_failed", "later")
            self.assertEqual(again, 2)
            self.assertEqual((attempt / "stage-failure.json").read_bytes(), preserved)

    def test_used_attempt_is_refused_and_reservation_is_replayable(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = pathlib.Path(tmp) / "job"
            job.mkdir()
            attempt = job / "attempt"
            recipe.reserve_attempt(job, attempt)
            recipe.assert_reserved_attempt(job, attempt)
            (attempt / "stage-failure.json").write_text("prior", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                recipe.assert_reserved_attempt(job, attempt)
            self.assertEqual((attempt / "stage-failure.json").read_text(encoding="utf-8"), "prior")
            with self.assertRaises(RuntimeError):
                recipe.reserve_attempt(job, attempt)

    def test_normal_tolerance_passes_measured_roundoff_and_refuses_rotation(self):
        import math

        bake = pathlib.Path(__file__).resolve().parent / "bake_final_rest.py"
        tree = ast.parse(bake.read_text(encoding="utf-8"))
        wanted = {"_unit_tuple", "compare_normals", "compare_uv"}
        body = [
            node
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id in {"NORMAL_COMPONENT_TOLERANCE", "NORMAL_ANGLE_TOLERANCE_DEG", "UV_COMPONENT_TOLERANCE"} for target in node.targets)
            or isinstance(node, ast.FunctionDef) and node.name in wanted
        ]
        namespace = {"math": math}
        exec(compile(ast.Module(body=body, type_ignores=[]), str(bake), "exec"), namespace)
        compare = namespace["compare_normals"]
        source = [(0.0, 0.0, 1.0)]
        # Measured body delta was 0.00029767 component / 0.03426402 deg.
        roundoff = [(0.00029767, 0.0, 1.0)]
        passed = compare(source, roundoff)
        self.assertLess(passed["maxAngleDeg"], 0.1)
        angle = math.radians(20.0)
        rotated = [(0.0, -math.sin(angle), math.cos(angle))]
        with self.assertRaises(RuntimeError):
            compare(source, rotated)
        part_a = [(0.0, 0.0, 1.0)]
        part_b = rotated
        compare(part_a + part_b, part_a + part_b)
        with self.assertRaises(RuntimeError):
            compare(part_a + part_b, part_b + part_a)

    def test_gltf_axis_and_multiprimitive_body_match(self):
        bake = pathlib.Path(__file__).resolve().parent / "bake_final_rest.py"
        tree = ast.parse(bake.read_text(encoding="utf-8"))
        wanted = {"_same", "blender_to_gltf", "match_gltf_primitives"}
        body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in wanted]
        namespace = {}
        exec(compile(ast.Module(body=body, type_ignores=[]), str(bake), "exec"), namespace)
        self.assertEqual(namespace["blender_to_gltf"]((1.0, 2.0, 3.0)), (1.0, 3.0, -2.0))
        reference = {"4:0": [(0.0, 0.0, 0.0)], "4:1": [(1.0, 0.0, 0.0)]}
        pools = [("body", [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0)])]
        matched = namespace["match_gltf_primitives"](reference, pools)
        self.assertEqual(matched["4:0"], [[0.0, 0.0, 0.0]])
        self.assertEqual(matched["4:1"], [[1.0, 0.0, 0.0]])
        with self.assertRaises(RuntimeError):
            namespace["match_gltf_primitives"](reference, [("body", [(1.0, 0.0, 0.0), (0.0, 0.0, 0.0)])])

    def test_materializer_refuses_unsupported_identity_before_attempt_write(self):
        text = (ROOT / "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py").read_text(encoding="utf-8")
        main = text.split("def main():", 1)[1].split("\ndef ", 1)[0]
        self.assertNotIn("_skin_attempt.mkdir", main)
        gate = main.index("assert_reserved_attempt")
        self.assertLess(main.index("unsupported skin recipe"), gate)
        self.assertLess(main.index("unsupported skin actor stem"), gate)
        self.assertLess(main.index("unsupported skin actor role"), gate)
        self.assertLess(main.index("refusing to overwrite initial body output"), gate)

    def test_proof_runner_requires_nonzero_python_exit_and_outputs(self):
        text = (pathlib.Path(__file__).resolve().parent / "prove_tara.py").read_text(encoding="utf-8")
        self.assertIn('"--python-exit-code"', text)
        self.assertIn('"1"', text)
        self.assertIn("output.is_file()", text)
        self.assertIn("runtime.is_file()", text)
        finalize = (pathlib.Path(__file__).resolve().parent / "finalize.py").read_text(encoding="utf-8")
        self.assertIn('"--python-exit-code"', finalize)
        self.assertIn('"attemptId": recipe.get_run_id(attempt)', finalize)
        self.assertNotIn('"attemptId": attempt.name', finalize)

    def test_two_jobs_get_distinct_uuid4_run_ids(self):
        import uuid

        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            ids = []
            preserved = []
            for name in ("job-a", "job-b"):
                job = root / name
                job.mkdir()
                attempt = job / "attempt"
                recipe.reserve_attempt(job, attempt)
                recipe.assert_reserved_attempt(job, attempt)
                run_id = recipe.get_run_id(attempt)
                parsed = uuid.UUID(run_id)
                self.assertEqual(parsed.version, 4)
                self.assertEqual(str(parsed), run_id)
                self.assertNotEqual(run_id, "attempt")
                ids.append(run_id)
                preserved.append((attempt / "reservation.json").read_bytes())
            self.assertNotEqual(ids[0], ids[1])
            self.assertEqual((root / "job-a" / "attempt" / "reservation.json").read_bytes(), preserved[0])
            self.assertEqual((root / "job-b" / "attempt" / "reservation.json").read_bytes(), preserved[1])

    def test_tampered_and_reused_markers_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = pathlib.Path(tmp) / "job"
            job.mkdir()
            attempt = job / "attempt"
            recipe.reserve_attempt(job, attempt)
            marker = attempt / "reservation.json"
            original = marker.read_bytes()
            payload = json.loads(original)
            payload["runId"] = attempt.name
            marker.write_text(json.dumps(payload) + "\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                recipe.assert_reserved_attempt(job, attempt)
            with self.assertRaises(RuntimeError):
                recipe.get_run_id(attempt)
            marker.write_bytes(original)
            payload = json.loads(original)
            payload["runId"] = "00000000-0000-1000-8000-000000000000"
            marker.write_text(json.dumps(payload) + "\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                recipe.assert_reserved_attempt(job, attempt)
            marker.write_bytes(original)
            payload = json.loads(original)
            payload["jobRoot"] = str(pathlib.Path(tmp) / "other")
            marker.write_text(json.dumps(payload) + "\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                recipe.assert_reserved_attempt(job, attempt)
            marker.write_bytes(original)
            recipe.assert_reserved_attempt(job, attempt)
            (attempt / "stage-failure.json").write_text("prior", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                recipe.assert_reserved_attempt(job, attempt)
            self.assertEqual((attempt / "stage-failure.json").read_text(encoding="utf-8"), "prior")
            self.assertEqual(marker.read_bytes(), original)
            with self.assertRaises(RuntimeError):
                recipe.reserve_attempt(job, attempt)
            self.assertEqual(marker.read_bytes(), original)

    def test_resume_reads_identity_without_stamping(self):
        import contextlib
        import io

        import prove_tara

        with tempfile.TemporaryDirectory() as tmp:
            job = pathlib.Path(tmp) / "tara-job"
            job.mkdir()
            attempt = job / "attempt"
            recipe.reserve_attempt(job, attempt)
            run_id = recipe.get_run_id(attempt)
            reservation_bytes = (attempt / "reservation.json").read_bytes()
            invocation = {
                "exitCode": 0,
                "processExitCode": 0,
                "entrypoint": prove_tara.ENTRYPOINT,
                "args": [],
                "jobRoot": str(job),
                "runtimeOutput": str(job / "runtime.glb"),
                "attemptId": run_id,
            }
            invocation_path = attempt / "materializer-invocation.json"
            invocation_path.write_text(json.dumps(invocation), encoding="utf-8")
            report = recipe.repo_root() / "tools/openclinxr/evidence/factory-skin-publication-result/report.json"
            report_before = report.read_bytes() if report.is_file() else None
            previous = os.environ.get("OPENCLINXR_SKIN_RESUME")
            os.environ["OPENCLINXR_SKIN_RESUME"] = str(job)
            buf = io.StringIO()
            try:
                with contextlib.redirect_stdout(buf):
                    prove_tara.main()
            finally:
                if previous is None:
                    os.environ.pop("OPENCLINXR_SKIN_RESUME", None)
                else:
                    os.environ["OPENCLINXR_SKIN_RESUME"] = previous
            payload = json.loads(buf.getvalue())
            self.assertEqual(payload["attemptId"], run_id)
            self.assertEqual(payload["exitCode"], 0)
            self.assertIs(payload["stamped"], False)
            self.assertIs(payload["resume"], True)
            self.assertEqual((attempt / "reservation.json").read_bytes(), reservation_bytes)
            if report_before is None:
                self.assertFalse(report.exists())
            else:
                self.assertEqual(report.read_bytes(), report_before)
            invocation_path.write_text(json.dumps({"exitCode": 0}), encoding="utf-8")
            os.environ["OPENCLINXR_SKIN_RESUME"] = str(job)
            try:
                with self.assertRaises(RuntimeError):
                    prove_tara.main()
            finally:
                if previous is None:
                    os.environ.pop("OPENCLINXR_SKIN_RESUME", None)
                else:
                    os.environ["OPENCLINXR_SKIN_RESUME"] = previous
            self.assertEqual((attempt / "reservation.json").read_bytes(), reservation_bytes)


if __name__ == "__main__":
    unittest.main()
