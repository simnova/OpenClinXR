---
name: anny-asset-pipeline
description: Use when working on OpenClinXR Anny or Anny-compatible humanoid generation, source import, Blender rigging/cleanup, provenance, preflight reports, or promotion gates for case-defined humanoid actors. Keeps Anny output as a candidate source until license, provenance, rig, actor-role mapping, WebXR evidence, and false-readiness gates are satisfied.
---

# Anny Asset Pipeline

Use this skill for Anny or Anny-compatible humanoid work in `/Volumes/files/src/openclinxr`.

## Required Posture

- Treat Anny output as a source candidate, not an automatically trusted runtime asset.
- Keep `realAnnyWeightsUsed`, B+ realism, Quest readiness, production readiness, learner readiness, clinical validity, and scoring validity false unless a later approved gate explicitly promotes them.
- Do not execute cloud, paid, credentialed, or model-download work unless Patrick explicitly approves that scope.
- Prefer metadata-only preflight artifacts before runtime bundle changes.

## Safe Workflow

1. Rehydrate with `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, and `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
2. Consult Asset Pipeline Lead, License/Provenance Specialist, Rigging/Animation Specialist, and Visual Realism Adversary when the slice touches humanoid source quality.
3. Derive candidate intent from case actors: scenario id, actor role, age/body profile, posture, clothing needs, facial/hair treatment, emotion/dialogue needs, and reuse key.
4. Produce or inspect a local source candidate directory without runtime promotion.
5. Require provenance, license posture, asset hash, actor-role mapping, rig/skinning/morph evidence, and explicit blockers in the preflight report.
6. Use WebXR screenshots/videos only as later review evidence; they are not proof of Quest, production, clinical, scoring, or learner readiness.

## Key Local Anchors

- `tools/openclinxr/asset-pipeline/anny/`
- `tools/openclinxr/evidence/external-ai-asset-provider-preflight.ts`
- `docs/openclinxr/humanoid-source-quality-gate-2026-05-27.md`
- `docs/openclinxr/humanoid-provider-upgrade-plan-2026-05-27.md`
- `apps/ui-xr/public/generated-humanoids/*.provenance.json`

## Done Criteria For A Preflight Slice

- The report is deterministic and validates locally.
- The candidate is mapped to explicit case actors.
- All missing evidence is listed as blockers.
- Existing fallback runtime assets remain intact.
- False-readiness boundaries are visible in tests or validation.
