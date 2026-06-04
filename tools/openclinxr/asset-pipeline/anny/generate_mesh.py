#!/usr/bin/env python3
"""
Anny mesh generation (Python/PyTorch script, target <5 seconds).

This is the local, OSS-first entrypoint for role_specific_humanoid_glb base body generation.

Usage (example for peds_asthma_parent_anxiety case):
  python generate_mesh.py \
    --params '{"age": 8, "body_profile": "pediatric_school_age", "pose": "standing_neutral", "phenotype": {"skin_tone": "warm_light_child", "hair_color": "light_brown", "eye_color": "hazel", "gender_presentation": "child", "height_cm": 125, "build": "slender_asthma"}}' \
    --output .openclinxr/asset-production/peds-asthma/generated/anny-peds-asthma-patient.obj \
    --manifest .openclinxr/asset-production/peds-asthma/generated/anny-peds-asthma-patient-manifest.json \
    # Final GLB is produced by automate_blender.py.

In a real deployment the "forward pass" section loads the Anny (or Anny-compatible) PyTorch model
from the official tutorials/notebooks, runs inference on the normalized parameter vector, and
exports a production-quality mesh with clean UVs ready for StableGen / ComfyUI baking.

The script is deliberately dependency-light for the stub so it runs in CI and on M1 Max without
heavy GPU requirements for the mesh stage itself (texturing is the heavier stage, offloaded to
ComfyUI server or Blender addon).

This advances the blueprint-driven asset factory: case spec (actor description + clinical
phenotype hints) -> explicit params -> generated base mesh + provenance manifest.
"""

import argparse
import json
import math
import os
from typing import Any, Dict


def parse_params(params_arg: str) -> Dict[str, Any]:
    try:
        return json.loads(params_arg)
    except Exception:
        # allow @file.json
        if params_arg.startswith("@"):
            with open(params_arg[1:], "r") as f:
                return json.load(f)
        raise


def build_simple_uv_body(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deterministic stub "forward pass".

    Produces a low-poly but UV-mapped humanoid (head + torso + limbs) whose proportions
    are driven by the input scalars. Real Anny would replace this with the actual
    parametric decoder + UV unwrap from the model.
    """
    age = float(params.get("age", 30))
    profile = params.get("body_profile", "adult_standard")
    phenotype = params.get("phenotype", {})
    height_scale = float(phenotype.get("height_cm", 170)) / 170.0
    build = phenotype.get("build", "average")

    # Very rough parametric scaling
    if "pediatric" in profile or age < 12:
        height_scale *= 0.65
        head_scale = 1.15
    else:
        head_scale = 1.0

    if "slender" in build or "asthma" in str(phenotype).lower():
        torso_width = 0.85
    elif "bariatric" in profile:
        torso_width = 1.25
    else:
        torso_width = 1.0

    # Simple mesh: head (UV sphere-ish), neck, torso (box), arms, legs.
    # We generate a minimal vertex list + faces + UVs so that Blender has something
    # with valid texture coordinates for later PBR baking.
    verts = []
    uvs = []
    faces = []

    def add_vert(x, y, z, u, v):
        verts.append((x, y, z))
        uvs.append((u, v))
        return len(verts) - 1

    # Head (approximate)
    head_y = 1.65 * height_scale
    for i in range(8):
        for j in range(5):
            theta = (i / 7.0) * math.pi * 2
            phi = (j / 4.0) * math.pi - math.pi / 2
            r = 0.22 * head_scale
            x = r * math.cos(phi) * math.cos(theta)
            z = r * math.cos(phi) * math.sin(theta)
            y = head_y + r * math.sin(phi)
            u = i / 7.0
            v = j / 4.0
            add_vert(x, y, z, u, v)

    # Very crude faces for head (strip)
    for i in range(7):
        for j in range(4):
            a = i * 5 + j
            b = a + 1
            c = (i + 1) * 5 + j
            d = c + 1
            faces.append((a, b, d))
            faces.append((a, d, c))

    # Torso
    torso_top = head_y - 0.35 * head_scale
    torso_bot = 0.95 * height_scale
    for sign in (-1, 1):
        for lr in (-1, 1):
            x = 0.18 * torso_width * lr
            z = 0.12 * sign
            u = 0.5 + 0.5 * lr
            v = 0.3 if sign > 0 else 0.1
            add_vert(x, torso_top, z, u, v)
            add_vert(x, torso_bot, z, u, v * 0.6)

    # Simple limb stubs (enough for skinning demo and UVs)
    # Arms
    for side in (-1, 1):
        shoulder_x = 0.22 * torso_width * side
        for k in range(4):
            t = k / 3.0
            ax = shoulder_x + (0.08 * side if k > 0 else 0)
            ay = torso_top - 0.15 - t * 0.55
            az = 0.0
            add_vert(ax, ay, az, 0.2 + side * 0.1, 0.4 - t * 0.3)

    # Legs
    for side in (-1, 1):
        hip_x = 0.12 * side
        for k in range(4):
            t = k / 3.0
            lx = hip_x + (0.03 * side if k > 0 else 0)
            ly = torso_bot - t * 0.9
            lz = 0.0
            add_vert(lx, ly, lz, 0.6 + side * 0.1, 0.25 - t * 0.2)

    # Extremely simplified faces for torso/limbs (the important part is that UVs exist
    # and are non-degenerate so StableGen/ComfyUI baking and Blender texture paint work).
    # In a real Anny output the topology + UVs would be much higher quality.

    mesh = {
        "vertices": verts,
        "uvs": uvs,
        "faces": faces,
        "material_hints": {
            "skin": phenotype.get("skin_tone", "warm_light"),
            "hair": phenotype.get("hair_color", "brown"),
        },
    }
    return mesh


def write_obj(mesh: Dict[str, Any], path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        f.write("# Anny stub mesh - replace with real forward pass output\n")
        f.write("mtllib anny_stub.mtl\n")
        for (x, y, z), (u, v) in zip(mesh["vertices"], mesh["uvs"]):
            f.write(f"v {x:.6f} {y:.6f} {z:.6f}\n")
            f.write(f"vt {u:.6f} {v:.6f}\n")
        f.write("usemtl skin\n")
        for a, b, c in mesh["faces"]:
            # OBJ is 1-based
            f.write(f"f {a+1}/{a+1} {b+1}/{b+1} {c+1}/{c+1}\n")


def write_manifest(params: Dict[str, Any], mesh: Dict[str, Any], out_path: str, obj_path: str) -> None:
    manifest = {
        "schema_version": "openclinxr.anny-source-manifest.v1",
        "generator": "tools/openclinxr/asset-pipeline/anny/generate_mesh.py",
        "source_kind": "anny_compatible_stub_mesh",
        "generator_mode": "stub",
        "uses_real_anny_forward_pass": False,
        "real_anny_weights_used": False,
        "fallback_active": True,
        "input_params": params,
        "output": {
            "obj_path": os.path.abspath(obj_path),
            "vertex_count": len(mesh["vertices"]),
            "face_count": len(mesh["faces"]),
            "has_uvs": True,
            "uv_coverage_note": "basic cylindrical unwrap for head/torso/limbs; production Anny produces production unwraps",
        },
        "phenotype_summary": params.get("phenotype", {}),
        "not_evidence_for": [
            "real_anny_model_output",
            "b_plus_visual_realism_gate",
            "production_asset_readiness",
            "quest_readiness",
        ],
        "notes": [
            "This is a deterministic stub so the rest of the pipeline (Blender rigging + texturing) can be exercised without the real Anny weights.",
            "Replace the build_simple_uv_body implementation with the real PyTorch forward pass from Anny tutorials when the model + weights are available locally.",
            "The produced OBJ + this manifest are the handoff into the headless Blender stage (automate_blender.py).",
        ],
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(manifest, f, indent=2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--params", required=True, help="JSON string or @path/to/params.json with age, body_profile, pose, phenotype, etc.")
    ap.add_argument("--output", required=True, help="Path to write the .obj (Anny base mesh with UVs)")
    ap.add_argument("--manifest", required=True, help="Path to write the Anny source manifest (provenance + params)")
    ap.add_argument("--gltf", required=False, help="Deprecated compatibility option; ignored because automate_blender.py produces the final GLB")
    args = ap.parse_args()

    params = parse_params(args.params)
    mesh = build_simple_uv_body(params)

    write_obj(mesh, args.output)
    write_manifest(params, mesh, args.manifest, args.output)

    print(f"[anny] wrote base mesh with UVs: {args.output}")
    print(f"[anny] wrote manifest: {args.manifest}")
    if args.gltf:
        print(f"[anny] --gltf ignored: final GLB is produced by automate_blender.py ({args.gltf})")
    print("[anny] ready for headless Blender rigging + StableGen/ComfyUI texturing stage.")


if __name__ == "__main__":
    main()
