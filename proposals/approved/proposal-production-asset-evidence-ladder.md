# Proposal: Production Asset Evidence Ladder

Status: Approved by Patrick on 2026-05-06.

Approval note: Patrick approved the constrained evidence-ladder slice. The approval authorizes repo-local deterministic evidence/reporting work for generated-human rigging, skin/clothing provenance, medical equipment, animation retargeting, LOD/texture/collider budgets, and multi-actor Quest bundle budgets. It does not authorize new asset-generation package installs, downloaded third-party assets, cloud or paid APIs, committed generated third-party assets, production runtime adoption, or production asset-readiness claims.

**Decision:** Approved
**Requested by:** Codex  
**Date:** 2026-05-06  
**Scope:** Asset-pipeline evidence design and local deterministic report generation only

## Decision Needed

Approve a constrained slice that turns the open production-asset blocker into an explicit evidence ladder for generated clinical actors, skin/clothing, rigging, animation, medical equipment, optimization, and Quest 3 runtime budgets.

This would not claim production asset readiness. It would make the missing proof lanes measurable so future work cannot mistake the current Blender placeholder bake for production-grade asset generation.

## Recommendation

Approve the evidence-ladder slice.

The repo already proves that Blender can run headlessly and export a placeholder clinical GLB, and the capability facade already includes `character-generation`, `medical-equipment-generation`, `voice-asset-generation`, `animation-generation`, and `asset-bake`. The next useful step is not to install more generation tools. It is to define the production proof artifacts and validators that any future Blender, Python, MCP, SkinTokens, Anny, Mesh2Motion, or equipment-generation worker must satisfy.

## Proposed Scope

| Area | Proposed Work | Posture |
| --- | --- | --- |
| Evidence schema | Add or extend machine-readable report types for generated-human rigging, skin/clothing provenance, medical-equipment library coverage, animation retargeting, LOD/texture/collider budgets, and multi-actor Quest bundle budgets. | Repo-local evidence only |
| Fixture reports | Create deterministic repo-owned fixture reports that show the report shapes and intentionally remain blocked for production where evidence is fake or placeholder-only. | No external assets |
| Benchmark integration | Keep `asset-production-readiness` blocked until all proof lanes are present and non-placeholder. | Claim guard |
| Documentation | Update asset-pipeline docs and issue #6 with the evidence ladder and remaining proof lanes. | Planning/evidence only |
| Existing tools | Reuse existing local Blender CLI bake and pinned `gltf-pipeline` evidence only where helpful. | No new install |

## Out Of Scope

- Installing Blender MCP, SkinTokens, Anny, Mesh2Motion, MakeHuman/MPFB, StableGen, Audio2Face, Tripo, ComfyUI, or any other asset-generation package.
- Downloading model weights, third-party meshes, texture libraries, motion libraries, or clinical equipment assets.
- Running cloud or paid APIs.
- Committing generated third-party assets.
- Production runtime adoption of asset-generation workers.
- Claiming production-grade humans, rigging, equipment, animation, optimization, or Quest performance.

## Tool Notes

- Blender CLI remains the current baseline for deterministic local bakes. Blender MCP may be useful later for scene inspection, screenshot/video capture, material/mesh inspection, and agent-readable QA, but it should require a separate security and install proposal because it gives an AI-controlled tool path into Blender's Python/desktop environment.
- SkinTokens/TokenRig is worth tracking as an offline rigging research candidate, not a Quest or Apple Silicon runtime dependency. The upstream materials describe MIT licensing for the checkpoint repository, an approximately 1.6 GB checkpoint set, Qwen3-0.6B-based rig generation, and an NVIDIA GPU requirement of at least 14 GB memory.
- The current placeholder bake remains useful only as tool-chain evidence: it proves export plumbing, GLB validation, object-name inventory, and license/provenance capture. It does not prove production art quality.

## Pros

- Converts the biggest asset blocker into exact, testable proof lanes.
- Keeps future native/Python asset workers behind the existing capability facade.
- Prevents placeholder bake success from being misread as production readiness.
- Gives Blender MCP, SkinTokens, and future asset tools a clear acceptance target before any install.
- Supports adversarial visual QA by defining what screenshots/videos and scene inventories must prove.

## Cons

- Adds evidence/reporting structure before generating better-looking actors or equipment.
- Will still leave `evidence-leadership-0009-005` open until real assets and Quest headset budgets exist.
- May reveal that several future tools need separate legal, security, hardware, or GPU proposals.
- Creates more validator work around artifacts that are not user-facing yet.

## Acceptance Criteria

- The asset-production readiness report names each missing proof lane and keeps production readiness blocked for placeholder-only evidence.
- Report fixtures distinguish `repo_generated_placeholder`, `reviewed_local_clinical_asset_fixture`, and future reviewed production-source evidence.
- The benchmark gate keeps `evidence-leadership-0009-005` open unless production-grade proof is present for generated humans, rigging/skin weights, skin/clothing provenance, equipment, animation retargeting, optimization, and Quest bundle budgets.
- Documentation states that Blender CLI placeholder evidence, Blender MCP, and SkinTokens are authoring/evidence aids, not production runtime dependencies.
- No new packages, downloaded models, third-party assets, cloud services, or paid APIs are introduced by this slice.

## Overall Recommendation

Approve this as the next asset-pipeline planning/evidence slice. It is the right bridge between the already-passing Blender placeholder bake and the much more serious production asset-generation work that will need separate approvals, assets, hardware, and clinical visual QA.

## Sources

- Current repo evidence: `docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json`
- Current repo benchmark: `docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json`
- Current repo guidance: `docs/openclinxr/asset-generation-pipeline.md`
- Blender Lab MCP operator reference: https://www.blender.org/lab/mcp-server/
- SkinTokens code repository: https://github.com/VAST-AI-Research/SkinTokens
- SkinTokens checkpoint model card: https://huggingface.co/VAST-AI/SkinTokens
