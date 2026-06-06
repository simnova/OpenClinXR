---
name: provider-boundary
description: Use when OpenClinXR work involves local-only or approval-gated asset/model providers such as Anny, Hunyuan3D, Meshy, Tripo, ComfyUI/StableGen, VLM reviewers, voice/model providers, credentials, paid APIs, network calls, or provider execution gates.
---

# Provider Boundary

Use this skill before adding or changing any OpenClinXR provider path.

## Boundary Classes

- `local_metadata_only`: inspect repo/local files, manifests, fixtures, hashes, and checked-in evidence only.
- `local_execution`: run approved local deterministic tools without network, credentials, paid APIs, or new model downloads.
- `approval_gated_external`: any cloud, paid, credentialed, network, production deployment, or external provider execution.
- `blocked`: any path with missing license, credential, budget, provenance, redaction, or operator approval evidence.

## Rules

- Default to `local_metadata_only` unless the active plan explicitly approves more.
- Never request credentials, call paid APIs, download model weights, or invoke cloud providers without explicit approval.
- Preserve false gates for provider runtime readiness, generated asset quality, production readiness, Quest readiness, learner readiness, clinical validity, and scoring validity.
- Record missing evidence as blockers and pivot to safe local work when possible.
- Keep provider output out of production runtime manifests until provenance, license, quality, review, and runtime evidence gates pass.

## Provider Notes

- Anny/Anny-compatible local scaffolds may produce source candidates, but real Anny claims require a manifest proving real model/weights use.
- Hunyuan3D local use requires install evidence, model license review, cache location, and runtime smoke evidence.
- Meshy, Tripo, cloud VLM review, and paid/credentialed providers are approval-gated external paths.
- ComfyUI/StableGen diffusion remains blocked unless a license exception and execution approval are recorded.

## Safe Output Shape

Provider planning artifacts should say what is allowed, what is blocked, what evidence is missing, and what the next safe local step is. They should not imply runtime, learner, production, Quest, clinical, or scoring readiness.
