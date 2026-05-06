# Blender Bake Temporary Note

Status: temporary, deletable after the asset-pipeline decision is captured in a MADR or implementation doc.
Date: 2026-05-06

## Short Answer

The Blender bake is a deterministic local asset-pipeline smoke test.

It proves that OpenClinXR can invoke Blender headlessly, create a simple clinical scene from local scripted primitives, export a GLB, parse the exported GLB, and record evidence about the resulting object inventory. It does not prove production art quality, realistic humans, rigging, animation, medical-device accuracy, or Quest runtime performance.

## What The Script Does

The root script `pnpm asset:blender:bake` runs `tools/openclinxr/blender-asset-bake-smoke.ts`.

That TypeScript tool:

- Detects the installed Blender version.
- Creates a temporary working directory outside the repo.
- Writes a generated Python script into that temporary directory.
- Starts Blender with `--background --factory-startup --python`.
- Uses Blender Python APIs to build the selected fixture scene.
- Exports the scene as GLB.
- Reads the GLB back into Node.js.
- Deletes the temporary working directory.
- Writes a JSON evidence report when an output path is provided.

The current useful fixture is `ed_chest_pain_clinical_asset_pack`. It builds a low-detail ED exam bay with a stretcher, patient, nurse, monitor, ECG cart, IV pole, oxygen wall unit, and a scale/origin marker. The objects are intentionally simple primitives with explicit names and materials.

## What The Evidence Checks

The report checks the exported GLB at a structural and semantic level:

- GLB magic header is `glTF`.
- GLB version is 2.
- Declared GLB length matches the actual byte length.
- The JSON chunk can be parsed.
- The scene has at least the expected number of nodes.
- Required clinical object names are present.
- Missing required object names become blockers.

The latest 2026-05-06 evidence file records Blender 5.1.1, a 109,040-byte GLB, 21 nodes, 21 meshes, 7 materials, and no missing required object names for the ED chest pain clinical asset pack.

## Why This Exists

This bake gives the asset lane a measurable baseline before introducing heavier or riskier tooling.

It is useful because it proves:

- Blender can run locally from automation.
- The repo can generate a clinical GLB without external assets.
- Export settings are repeatable enough for CI-style evidence.
- Object naming and provenance can be inspected after export.
- Asset-production blockers can distinguish working export plumbing from real asset readiness.

## What It Is Not

The bake is not:

- A production clinical environment.
- A realistic patient, nurse, or equipment model.
- A rigged or animated character pipeline.
- A Quest 3 performance proof.
- A substitute for visual QA, clinical SME review, or license review.
- Evidence that Blender MCP, SkinTokens, MakeHuman, MPFB, ComfyUI, Audio2Face, or any other asset-generation tool should be installed.

## Relationship To Blender MCP

The current bake uses Blender CLI only. Blender MCP is tracked as a possible future design and QA aid, especially for agent-readable scene inspection, screenshots, and material or mesh review.

Blender MCP should remain gated behind a separate local-only security and install proposal because it gives an AI-controlled tool path into Blender and Blender Python. Until that is approved, the CLI bake remains the baseline.

## Delete Criteria

Delete this file after one of these happens:

- The production asset evidence ladder is approved and moved into permanent docs.
- A MADR captures the Blender CLI and Blender MCP posture.
- The asset pipeline changes enough that this temporary summary is obsolete.
