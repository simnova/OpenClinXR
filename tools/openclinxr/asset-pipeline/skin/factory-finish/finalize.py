"""Private finalizer: REST-bake the posture-corrected source, then append maps.

The receipt file is written before this function returns. The seated stage commits
the finished GLB only after that return.
"""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import recipe


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _finish_module():
    path = recipe.repo_root() / "tools/openclinxr/asset-pipeline/skin/finish_skin_material.py"
    spec = importlib.util.spec_from_file_location("finish_skin_material_frozen", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _blender():
    env = os.environ.get("OPENCLINXR_BLENDER")
    if env and Path(env).is_file():
        return env
    mac = Path("/Applications/Blender.app/Contents/MacOS/Blender")
    if mac.is_file():
        return str(mac)
    found = shutil.which("blender")
    if found:
        return found
    raise RuntimeError("pinned Blender CLI not found")


def finalize_source(source_glb, recipe_id, attempt_dir, job_root):
    recipe.require_recipe(recipe_id)
    authored, authored_path = recipe.load_authored()
    source = Path(source_glb).resolve()
    attempt = Path(attempt_dir).resolve()
    job = recipe.confine(job_root, attempt)
    if not source.is_file():
        raise RuntimeError(f"missing final REST source {source}")
    recipe.assert_reserved_attempt(job, attempt)
    source_bytes = source.read_bytes()
    saved_source = attempt / "final-rest-source.glb"
    if saved_source.exists():
        raise RuntimeError(f"attempt source already exists: {saved_source}")
    saved_source.write_bytes(source_bytes)
    recipe.confine(job, saved_source)
    settings = recipe.bake_settings(authored)
    config_path = attempt / "bake-config.json"
    config_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    bake_dir = attempt / "rest-bake"
    bake_dir.mkdir(parents=True)
    script = Path(__file__).resolve().parent / "bake_final_rest.py"
    log_path = attempt / "bake-blender.log"
    proc = subprocess.run(
        [
            _blender(),
            "--background",
            "--python-exit-code",
            "1",
            "--python",
            str(script),
            "--",
            "--source",
            str(saved_source),
            "--out-dir",
            str(bake_dir),
            "--job-root",
            str(job),
            "--config",
            str(config_path),
        ],
        cwd=str(recipe.repo_root()),
        capture_output=True,
        text=True,
        timeout=3600,
    )
    log_text = (proc.stdout or "") + "\n" + (proc.stderr or "")
    log_path.write_text(log_text, encoding="utf-8")
    normal_path = bake_dir / "final-rest-normal.png"
    basis_path = bake_dir / "basis.json"
    manifest_path = bake_dir / "bake-manifest.json"
    if proc.returncode != 0 or "Traceback (most recent call last)" in log_text:
        tail = log_text[-4000:]
        raise RuntimeError(f"final REST bake failed (exit {proc.returncode})\n{tail}")
    if not normal_path.is_file() or not basis_path.is_file() or not manifest_path.is_file():
        raise RuntimeError("final REST bake exited without the normal, basis, and manifest")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    normal = normal_path.read_bytes()
    if _sha(normal) != manifest["normalSha256"] or manifest["assetSha256"] != _sha(source_bytes):
        raise RuntimeError("bake manifest does not match this final source")
    if manifest.get("evaluationMode") != "REST":
        raise RuntimeError("bake was not evaluated in REST")
    albedo_rel = authored["albedo"]["path"]
    albedo_path = recipe.repo_root() / albedo_rel
    albedo = albedo_path.read_bytes()
    if _sha(albedo) != authored["albedo"]["sha256"]:
        raise RuntimeError("approved albedo bytes drifted")
    execution = {
        "schema": "openclinxr.factory-skin-execution-recipe.v1",
        "recipeId": recipe_id,
        "sourceSha256": _sha(source_bytes),
        "materialName": authored["materialName"],
        "frequencyUnits": "authored-texture-frequency",
        "bakeSettingsSha256": recipe.bake_fingerprint(settings),
        "normal": {
            "path": str(normal_path),
            "sha256": _sha(normal),
            "imageName": authored["normal"]["imageName"],
            "conditionedOnSourceSha256": _sha(source_bytes),
            "bakeManifest": str(bake_dir / "bake-manifest.json"),
            "bakeManifestSha256": _sha((bake_dir / "bake-manifest.json").read_bytes()),
        },
        "albedo": {
            "path": str(albedo_path),
            "sha256": _sha(albedo),
            "imageName": authored["albedo"]["imageName"],
            "license": authored["albedo"]["license"],
            "sourceUrl": authored["albedo"]["sourceUrl"],
            "assetId": authored["albedo"]["assetId"],
        },
    }
    execution_path = attempt / "execution-recipe.json"
    execution_path.write_text(json.dumps(execution, indent=2) + "\n", encoding="utf-8")
    finisher = _finish_module()
    finished_bytes, checks = finisher.finish(source_bytes, execution, normal, albedo)
    finished_path = attempt / "finished.glb"
    if finished_path.exists():
        raise RuntimeError(f"attempt finished GLB already exists: {finished_path}")
    finished_path.write_bytes(finished_bytes)
    receipt = {
        "schema": "openclinxr.factory-skin-receipt.v1",
        "attemptId": recipe.get_run_id(attempt),
        "sourceSha256": _sha(source_bytes),
        "normalSha256": _sha(normal),
        "conditionedOnSourceSha256": _sha(source_bytes),
        "finishedSha256": _sha(finished_bytes),
        "authoredRecipeSha256": _sha(authored_path.read_bytes()),
        "executionRecipeSha256": _sha(execution_path.read_bytes()),
        "bakeSettingsSha256": recipe.bake_fingerprint(settings),
        "observedBlender": manifest.get("blender"),
        "observedMpfb": manifest.get("mpfb"),
        "checks": checks,
        "frequencyUnits": "authored-texture-frequency",
    }
    receipt_path = attempt / "receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return SimpleNamespace(
        finished_glb=finished_path,
        receipt_path=receipt_path,
        source_path=saved_source,
        basis_path=basis_path,
        normal_path=normal_path,
        execution_path=execution_path,
        outcome="finished",
    )
