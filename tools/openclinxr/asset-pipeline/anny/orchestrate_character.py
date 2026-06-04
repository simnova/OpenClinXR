#!/usr/bin/env python3
"""
Single-call orchestrator for the full Anny -> textured/rigged GLB pipeline.

This is the "pass patient parameters → get textured, rigged GLB back. No GUI ever opens."
entrypoint described in the user query.

It calls:
1. generate_mesh.py (Anny stage, <5s)
2. automate_blender.py via `blender --background --python` (headless Blender + StableGen/ComfyUI stage)

Example (peds case):
  python orchestrate_character.py \
    --case-id peds_asthma_parent_anxiety_v1 \
    --actor-role patient \
    --params-json '{"age": 8, "body_profile": "pediatric_school_age", "phenotype": {"skin_tone": "warm_light_child", "build": "slender_asthma"}}' \
    --output-glb .openclinxr/asset-production/peds-asthma/patient_robert_hayes.glb

You can also run it as a tiny FastAPI service (if fastapi/uvicorn installed):
  uvicorn orchestrate_character:app --port 8765
  curl -X POST http://localhost:8765/generate -d '{...}'

The orchestrator is deliberately thin so it can be called from the TS asset worker
(via child_process.execFile or a local HTTP capability adapter) for the
"character-generation" / "role_specific_humanoid_glb" materialization work orders.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

HERE = Path(__file__).parent
GEN_MESH = HERE / "generate_mesh.py"
BLENDER_STAGE = HERE / "automate_blender.py"


def run_cmd(cmd: list[str], cwd: Optional[str] = None, timeout: Optional[int] = None) -> None:
    print(f"[orchestrate] $ {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd, timeout=timeout)


def generate(params: Dict[str, Any], case_id: str, actor_role: str, output_glb: str, use_comfy: bool = False, comfy_url: str = "http://127.0.0.1:8188") -> Dict[str, str]:
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        obj = tmp / "anny_base.obj"
        manifest = tmp / "anny_manifest.json"

        # 1. Anny mesh stage
        run_cmd([
            sys.executable, str(GEN_MESH),
            "--params", json.dumps(params),
            "--output", str(obj),
            "--manifest", str(manifest),
        ])

        # 2. Headless Blender stage (emits rigging_report.json next to the candidate GLB)
        report_path = output_glb.replace(".glb", "_rigging_report.json") if output_glb.endswith(".glb") else output_glb + "_rigging_report.json"
        blender_cmd = [
            "blender", "--background", "--python", str(BLENDER_STAGE), "--",
            "--input-mesh", str(obj),
            "--input-manifest", str(manifest),
            "--output-glb", str(output_glb),
            "--case-id", case_id,
            "--actor-role", actor_role,
        ]
        if use_comfy:
            blender_cmd += ["--use-comfy", "--comfy-url", comfy_url]

        # Blender may not be on PATH in all envs; the caller can pass BLENDER_PATH
        blender_bin = os.environ.get("BLENDER_PATH", "blender")
        blender_cmd[0] = blender_bin

        run_cmd(blender_cmd, timeout=300)

    print(f"[orchestrate] SUCCESS: {output_glb} + report")
    return {"glb": output_glb, "report": report_path}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case-id", required=True)
    ap.add_argument("--actor-role", required=True)
    ap.add_argument("--params-json", required=True, help="JSON or @file")
    ap.add_argument("--output-glb", required=True)
    ap.add_argument("--use-comfy", action="store_true")
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    args = ap.parse_args()

    params_str = args.params_json
    if params_str.startswith("@"):
        with open(params_str[1:]) as f:
            params = json.load(f)
    else:
        params = json.loads(params_str)

    out = generate(params, args.case_id, args.actor_role, args.output_glb, args.use_comfy, args.comfy_url)
    print("ORCHESTRATE_SUCCESS")
    print(json.dumps(out))


# --- Optional FastAPI (for web API / worker HTTP call) ---
try:
    from fastapi import FastAPI
    from pydantic import BaseModel

    app = FastAPI(title="OpenClinXR Anny Character Generator")

    class GenerateRequest(BaseModel):
        case_id: str
        actor_role: str
        params: Dict[str, Any]
        output_glb: str
        use_comfy: bool = False
        comfy_url: str = "http://127.0.0.1:8188"

    @app.post("/generate")
    def generate_endpoint(req: GenerateRequest):
        out = generate(req.params, req.case_id, req.actor_role, req.output_glb, req.use_comfy, req.comfy_url)
        return {"ok": True, "glb": out.get("glb"), "report": out.get("report")}

except ImportError:
    app = None  # FastAPI not installed; CLI still works


if __name__ == "__main__":
    main()
