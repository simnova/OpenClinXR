"""One job-local Tara producer: materializer, final REST bake, loader proof, report.

Does not promote a GLB into the shipped candidate directory. The runtime file stays
under the job root. Refuses to replace an existing report.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import recipe

ENTRYPOINT = "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _blender():
    env = os.environ.get("OPENCLINXR_BLENDER")
    if env and Path(env).is_file():
        return env
    mac = Path("/Applications/Blender.app/Contents/MacOS/Blender")
    if mac.is_file():
        return str(mac)
    found = shutil.which("blender")
    if not found:
        raise RuntimeError("pinned Blender CLI not found")
    return found


def _row(repo, path):
    path = Path(path).resolve()
    rel = path.relative_to(repo).as_posix()
    return {"path": rel, "sha256": _sha(path.read_bytes())}


def _run(cmd, cwd, log_path, timeout):
    proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
    log_path.write_text((proc.stdout or "") + "\n" + (proc.stderr or ""), encoding="utf-8")
    return proc


def _resume_diagnostic(job):
    """Read an existing attempt. Do not reserve, bake, or rewrite records."""
    attempt = job / "attempt"
    if not attempt.is_dir():
        raise RuntimeError(f"resume attempt missing: {attempt}")
    attempt_id = recipe.get_run_id(attempt)
    invocation_path = attempt / "materializer-invocation.json"
    if not invocation_path.is_file():
        raise RuntimeError("resume invocation missing; refusing to stamp a producer record")
    invocation = json.loads(invocation_path.read_text(encoding="utf-8"))
    exit_code = invocation.get("processExitCode")
    if not isinstance(exit_code, int):
        raise RuntimeError("resume invocation missing process exit code")
    print(json.dumps({
        "resume": True,
        "stamped": False,
        "attemptId": attempt_id,
        "exitCode": exit_code,
        "job": str(job),
        "attempt": str(attempt),
    }))
    return attempt_id, exit_code


def main():
    repo = recipe.repo_root()
    report_path = repo / "tools/openclinxr/evidence/factory-skin-publication-result/report.json"
    resume = os.environ.get("OPENCLINXR_SKIN_RESUME")
    if resume:
        _resume_diagnostic(Path(resume).resolve())
        return
    if report_path.exists():
        raise RuntimeError(f"report already exists; preserve the attempt: {report_path}")
    job_name = "tara-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    job = repo / "tools/openclinxr/asset-pipeline/skin/factory-finish/runs" / job_name
    attempt = job / "attempt"
    job.parent.mkdir(parents=True, exist_ok=True)
    job.mkdir()
    recipe.reserve_attempt(job, attempt)
    attempt_id = recipe.get_run_id(attempt)
    output = job / f"{recipe.OUTPUT_STEM}.glb"
    runtime = job / f"{recipe.OUTPUT_STEM}.motion-bind.glb"
    args = [
        "--output",
        str(output),
        "--eye-colour-reference",
        "peds_anxious_parent",
        "--actor-role",
        "parent",
        "--no-body-subdiv",
        "--skin-recipe-id",
        recipe.RECIPE_ID,
        "--skin-job-root",
        str(job),
        "--skin-attempt-dir",
        str(attempt),
    ]
    materializer_log = attempt / "materializer.log"
    invocation_path = attempt / "materializer-invocation.json"
    proc = _run(
        [
            _blender(),
            "--background",
            "--python-exit-code",
            "1",
            "--python",
            str(repo / ENTRYPOINT),
            "--",
            *args,
        ],
        repo,
        materializer_log,
        timeout=14400,
    )
    exit_code = proc.returncode
    log_text = materializer_log.read_text(encoding="utf-8")
    # --python-exit-code 1 makes a traceback a nonzero exit. Also require the
    # body and runtime files; a zero exit without those outputs is not success.
    script_ok = (
        exit_code == 0
        and output.is_file()
        and output.stat().st_size > 0
        and runtime.is_file()
        and runtime.stat().st_size > 0
        and "SEATED_REST_BIND_OK" in log_text
        and "Traceback (most recent call last)" not in log_text
    )
    invocation = {
        "exitCode": 0 if script_ok else 1,
        "processExitCode": exit_code,
        "entrypoint": ENTRYPOINT,
        "args": args,
        "jobRoot": str(job.resolve()),
        "runtimeOutput": str(runtime.resolve()),
        "attemptId": attempt_id,
    }
    invocation_path.write_text(json.dumps(invocation, indent=2) + "\n", encoding="utf-8")
    if not script_ok:
        raise RuntimeError(f"materializer exit {exit_code} script_ok={script_ok}\n{log_text[-4000:]}")
    if os.environ.get("OPENCLINXR_SKIN_DEFER_LOADER") == "1":
        print(json.dumps({
            "deferredLoader": True,
            "attemptId": attempt_id,
            "attempt": str(attempt),
            "job": str(job),
            "exitCode": exit_code,
        }))
        return
    source = attempt / "final-rest-source.glb"
    finished = runtime
    if not source.is_file() or not finished.is_file():
        raise RuntimeError("materializer returned without a job-local source and runtime GLB")
    ui_out = attempt / "ui-loader.json"
    ui_url = os.environ.get("OPENCLINXR_UI_URL", "http://127.0.0.1:4179/")
    loader = repo / "tools/openclinxr/evidence/factory-skin-publication/loader-proof.mjs"
    loader_proc = _run(
        [
            os.environ.get("OPENCLINXR_NODE") or shutil.which("node") or "node",
            "--experimental-strip-types",
            str(loader),
            "--url",
            ui_url,
            "--finished",
            str(finished),
            "--material",
            recipe.MATERIAL_NAME,
            "--output",
            str(ui_out),
        ],
        repo,
        attempt / "loader-proof.log",
        timeout=600,
    )
    if loader_proc.returncode != 0:
        tail = (attempt / "loader-proof.log").read_text(encoding="utf-8")[-4000:]
        raise RuntimeError(f"loader proof exit {loader_proc.returncode}\n{tail}")
    tool_log = attempt / "tool.log"
    tool_log.write_text(materializer_log.read_text(encoding="utf-8"), encoding="utf-8")
    report = {
        "schema": "openclinxr.factory-skin-publication.v1",
        "attemptId": attempt_id,
        "frequencyUnits": "authored-texture-frequency",
        "source": _row(repo, source),
        "finished": _row(repo, finished),
        "normal": _row(repo, attempt / "rest-bake" / "final-rest-normal.png"),
        "albedo": _row(repo, repo / "tools/openclinxr/evidence/skin-material-finish-plant/albedo.png"),
        "authoredRecipe": _row(repo, recipe.authored_path()),
        "executionRecipe": _row(repo, attempt / "execution-recipe.json"),
        "receipt": _row(repo, attempt / "receipt.json"),
        "basis": _row(repo, attempt / "rest-bake" / "basis.json"),
        "ui": _row(repo, ui_out),
        "materializerInvocation": _row(repo, attempt / "materializer-invocation.json"),
        "publication": _row(repo, attempt / "publication.json"),
        "toolLog": _row(repo, tool_log),
    }
    receipt = json.loads((attempt / "receipt.json").read_text(encoding="utf-8"))
    if receipt.get("attemptId") != attempt_id:
        raise RuntimeError("receipt attemptId does not match the reservation run id")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "attempt": str(attempt),
        "attemptId": attempt_id,
        "exitCode": exit_code,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"PROVE_TARA_REFUSED {exc}", file=sys.stderr)
        raise SystemExit(1)
