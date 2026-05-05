#!/usr/bin/env python3
"""Stdlib tests for the local realtime voice evidence helper scripts."""

from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
INSTALL = SCRIPTS / "install_local_voice_models.py"
CHECK = SCRIPTS / "check_local_voice_evidence.py"


def load_module(path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_json(script: pathlib.Path, *args: str) -> dict[str, object]:
    completed = subprocess.run(
        [sys.executable, str(script), *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.stderr:
        raise AssertionError(f"expected machine-readable stdout only, got stderr: {completed.stderr}")
    return json.loads(completed.stdout)


def run_json_error(script: pathlib.Path, *args: str) -> tuple[int, dict[str, object]]:
    completed = subprocess.run(
        [sys.executable, str(script), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.stderr:
        raise AssertionError(f"expected machine-readable stdout only, got stderr: {completed.stderr}")
    return completed.returncode, json.loads(completed.stdout)


class LocalVoiceEvidenceTests(unittest.TestCase):
    def test_cache_defaults_to_realtime_voice_directory(self) -> None:
        module = load_module(CHECK)

        self.assertEqual(
            pathlib.Path.home() / ".cache" / "openclinxr" / "realtime-voice",
            module.default_cache_dir(),
        )

    def test_check_reports_missing_cache_as_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cache = pathlib.Path(temp) / "missing"

            payload = run_json(CHECK, "--cache-dir", str(cache))

        self.assertEqual("local_voice_evidence_check", payload["kind"])
        self.assertEqual(str(cache), payload["cache_dir"])
        self.assertFalse(payload["cache_exists"])
        self.assertEqual([], payload["models"])
        self.assertEqual([], payload["support_directories"])
        self.assertFalse(payload["ready"])

    def test_check_reports_support_venvs_separately_from_model_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = pathlib.Path(temp)
            cache = temp_path / "cache"
            venv = cache / "api-python-backend-venv"
            model = cache / "kyutai__moshiko-mlx-q4"
            (venv / "bin").mkdir(parents=True)
            (venv / "bin" / "python").write_text("# placeholder\n", encoding="utf-8")
            model.mkdir(parents=True)
            (model / "weights.bin").write_bytes(b"not real weights")

            payload = run_json(CHECK, "--cache-dir", str(cache))

        self.assertFalse(payload["ready"])
        self.assertEqual(["kyutai__moshiko-mlx-q4"], [model["model_id"] for model in payload["models"]])
        self.assertEqual(["api-python-backend-venv"], [entry["name"] for entry in payload["support_directories"]])
        self.assertEqual(
            "runtime_support_venv_not_model_weights",
            payload["support_directories"][0]["reason"],
        )

    def test_install_dry_run_does_not_create_cache_or_copy_models(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = pathlib.Path(temp)
            source = temp_path / "source-model"
            cache = temp_path / "cache"
            (source / "weights").mkdir(parents=True)
            (source / "weights" / "tiny.bin").write_bytes(b"local model placeholder")

            payload = run_json(
                INSTALL,
                "--cache-dir",
                str(cache),
                "--model-id",
                "kyutai/moshiko-mlx-q4",
                "--source",
                str(source),
                "--dry-run",
            )

            self.assertFalse(cache.exists())
            self.assertEqual("local_voice_model_install", payload["kind"])
            self.assertTrue(payload["dry_run"])
            self.assertEqual("kyutai/moshiko-mlx-q4", payload["model_id"])
            self.assertEqual(str(source.resolve()), payload["source"])
            self.assertEqual(str(cache / "kyutai__moshiko-mlx-q4"), payload["target_dir"])
            self.assertEqual("would_copy_local_source", payload["actions"][0]["action"])

    def test_install_supports_huggingface_style_model_ids_without_nested_storage(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cache = pathlib.Path(temp) / "cache"

            payload = run_json(
                INSTALL,
                "--cache-dir",
                str(cache),
                "--model-id",
                "kyutai/moshiko-mlx-q4",
                "--dry-run",
            )

            self.assertEqual("kyutai/moshiko-mlx-q4", payload["model_id"])
            self.assertEqual("kyutai__moshiko-mlx-q4", payload["storage_name"])
            self.assertEqual(str(cache / "kyutai__moshiko-mlx-q4"), payload["target_dir"])

    def test_install_rejects_unapproved_model_id_as_json(self) -> None:
        code, payload = run_json_error(
            INSTALL,
            "--model-id",
            "moshi-mlx",
            "--dry-run",
        )

        self.assertEqual(2, code)
        self.assertEqual("local_voice_model_install", payload["kind"])
        self.assertEqual(
            "model_id is not in the approved local realtime voice candidate list",
            payload["error"],
        )
        self.assertEqual(
            [
                "kyutai/moshiko-mlx-q4",
                "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
            ],
            payload["approved_model_ids"],
        )

    def test_install_rejects_model_id_path_traversal_as_json(self) -> None:
        code, payload = run_json_error(
            INSTALL,
            "--model-id",
            "../outside-cache",
            "--dry-run",
        )

        self.assertEqual(2, code)
        self.assertEqual("local_voice_model_install", payload["kind"])
        self.assertIn("relative identifier", payload["error"])

    def test_install_rejects_remote_source_even_for_dry_run(self) -> None:
        code, payload = run_json_error(
            INSTALL,
            "--model-id",
            "kyutai/moshiko-mlx-q4",
            "--source",
            "https://example.invalid/model.bin",
            "--dry-run",
        )

        self.assertEqual(2, code)
        self.assertEqual("local_voice_model_install", payload["kind"])
        self.assertEqual("remote sources are not allowed", payload["error"])

    def test_install_local_source_then_check_reports_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = pathlib.Path(temp)
            source = temp_path / "qwen-source"
            cache = temp_path / "cache"
            source.mkdir()
            (source / "config.json").write_text('{"ok": true}\n', encoding="utf-8")

            install_payload = run_json(
                INSTALL,
                "--cache-dir",
                str(cache),
                "--model-id",
                "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
                "--source",
                str(source),
            )
            check_payload = run_json(CHECK, "--cache-dir", str(cache))

        self.assertFalse(install_payload["dry_run"])
        self.assertTrue(install_payload["installed"])
        self.assertEqual("local_source_copy", install_payload["evidence"]["source_type"])
        self.assertTrue(check_payload["ready"])
        self.assertEqual("mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit", check_payload["models"][0]["model_id"])
        self.assertEqual("local_source_copy", check_payload["models"][0]["source_type"])

    def test_install_argument_errors_are_json(self) -> None:
        code, payload = run_json_error(INSTALL)

        self.assertEqual(2, code)
        self.assertEqual("local_voice_model_install_error", payload["kind"])
        self.assertEqual("argument_error", payload["error"])
        self.assertIn("--model-id", payload["message"])

    def test_install_accepts_pnpm_forwarded_separator(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cache = pathlib.Path(temp) / "cache"

            payload = run_json(
                INSTALL,
                "--",
                "--cache-dir",
                str(cache),
                "--model-id",
                "kyutai/moshiko-mlx-q4",
                "--dry-run",
            )

        self.assertEqual("local_voice_model_install", payload["kind"])
        self.assertTrue(payload["dry_run"])
        self.assertEqual("kyutai/moshiko-mlx-q4", payload["model_id"])


if __name__ == "__main__":
    unittest.main()
