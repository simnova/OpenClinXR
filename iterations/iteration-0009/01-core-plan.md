# Core Plan

## Evidence Now Proven

- The repo can pass the complete local verification gate after the latest slices: `pnpm verify`.
- The API now owns executable asset-pipeline submission through `/internal/capabilities/:capabilityId/jobs` and job reads through `/internal/capabilities/:capabilityId/jobs/:jobId`.
- The internal job lane accepts five deterministic zero-spend asset-pipeline capabilities: `character-generation`, `medical-equipment-generation`, `voice-asset-generation`, `animation-generation`, and `asset-bake`.
- UI apps are now structurally blocked from importing `@openclinxr/capability-gateway` or hardcoding `/internal/capabilities/` endpoint strings.
- The local model smoke produced a parsable clinical triage JSON object using Qwen/Qwen3-4B-GGUF through llama.cpp on Apple Silicon.
- The local voice smoke produced local audio with VibeVoice-Realtime-0.5B and recorded runtime, audio, latency, memory, and cache-footprint evidence, but the measured latency is not compatible with live XR dialog.
- The asset pipeline can run both permissive GLB conversion and a Blender-backed placeholder bake.
- The IWSDK sidecar is no longer only a proposal: Phase 1 has exact installed packages and a runnable sidecar lane.

## Remaining Blockers

- Quest immersive entry is not proven by automation. The latest gate still records `quest_immersive_entry_activation_not_received` and `quest_immersive_session_not_started`.
- A human worn-headset manual performance report is still missing, so frame pacing, comfort, controller latency, hand visibility, locomotion comfort, and readable in-VR text remain unclaimed.
- Local model evidence is a smoke, not a production dialogue contract. It still needs structured-output enforcement, hidden-truth containment, actor policy adherence, clinical safety review, and target M4 Pro or M4 Max benchmark evidence before live dialogue is enabled.
- Local voice evidence is file-based and too slow for live dialog. It still needs streaming capture, first audible playback latency, WebXR playback integration, misuse/disclosure controls, and headset performance evidence.
- Asset evidence is placeholder-level. It does not prove production character quality, rigging, skin/clothing generation, animation retargeting, KTX2 texture compression, LOD budgets, collider budgets, or multi-actor Quest frame pacing.
- IWSDK remains sidecar-only. Phase 2 devtools are approved but blocked by Vite peer-range posture, MCP evidence, managed-browser evidence, reference metadata drift, and bundle/performance budgets.
- The benchmark gate currently reuses `evidence-leadership-0008-004` for IWSDK blockers even though the iteration 0008 scorecard used that ID for Blender bake evidence. That ID drift must be fixed before leadership can treat the evidence ledger as clean.

## Implementation Direction

1. Keep `apps/api` as the only public tunnel for executable local/native capability work.
2. Keep local model, voice, and Python/native asset workers behind provider or capability facades so local development, local production, and hosted production can swap implementations without portal changes.
3. Use the deterministic asset-job facade as the contract for future Python/native asset workers before introducing Blender, rigging, voice-asset, or animation executables.
4. Treat `apps/ui-xr` as the primary full-VR station prototype and `apps/ui-xr-iwsdk-spike` as an isolated sidecar for IWSDK/MR learning.
5. Prioritize a Quest manual foreground report and WebXR entry evidence before adding more XR features.
6. Fix evidence-ledger ID drift before adding new leadership gates.
7. Build the next clinical code slices around traceable station runtime behavior, case-bank review, and admin governance rather than autonomous scoring.

## Commands That Carry The Evidence

- `pnpm verify`
- `pnpm agent:benchmarks`
- `pnpm --filter @openclinxr/api test`
- `pnpm --filter @openclinxr/capability-gateway test`
- `pnpm --filter @openclinxr/architecture-rules test`
- `pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-2026-05-04.json`
- `pnpm iwsdk:verify`
- `pnpm local:provider:benchmark`
- `pnpm security:audit`
- `pnpm security:licenses`
