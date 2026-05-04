# MADR 0028: Evaluate Meta Immersive Web SDK In A Sidecar Spike Before Production XR Adoption

Date: 2026-05-04
Status: Accepted for spike planning

## Context

OpenClinXR needs a Quest 3 WebXR experience that can be validated locally by developers and background agents. The current headset shell uses Vite, TypeScript, Three.js, and explicit Quest 3 smoke gates. Meta's Immersive Web SDK is relevant because its public materials describe a Three.js-oriented WebXR framework with XR input, locomotion, spatial UI, ECS-style runtime inspection, and AI/MCP development tooling.

The SDK is promising, but current evidence is still spike-level. The local scratch spike found useful compatibility signals, but also package-weight, Vite peer-version, and transitive-license review pressure. The physical Quest 3 gate remains mandatory before any production runtime decision.

## Decision

Treat IWSDK as an isolated sidecar spike candidate, not a production dependency.

Create `apps/ui-xr-iwsdk-spike/` only after operator approval of install scope, exact package versions, license posture, and `pnpm iwsdk:verify`. Keep `apps/ui-xr/`, `apps/api/`, and production scenario runtime packages IWSDK-free until the sidecar proves runtime, bundle, MCP, and Quest 3 behavior.

The current `apps/ui-xr/` shell remains the baseline. It should expose stable Three.js object names and a source-controlled MCP smoke plan so future `scene_get_hierarchy`, `browser_screenshot`, `xr_select`, and `browser_get_console_logs` checks have concrete targets.

## Consequences

Positive:

- Background agents can use a precise IWSDK evidence contract instead of vague WebXR claims.
- The production headset shell stays small and understandable while the sidecar measures real dependency cost.
- Scene hierarchy checks can verify patient, nurse, spouse, monitor, bed, and station objects without relying on screenshots alone.
- Quest 3 physical frame pacing, latency, comfort, and readability remain separate from emulator/MCP evidence.

Negative:

- Sidecar validation adds one more gate before production runtime changes.
- MCP and desktop emulation evidence can become misleading if treated as a substitute for headset testing.
- Exact dependency and license posture may block useful IWSDK packages until reviewed.

## Implementation Notes

- First executable station target: ED chest pain scenario.
- First MCP smoke order: `xr_get_session_status`, `xr_accept_session`, `browser_screenshot`, `scene_get_hierarchy`, `xr_select`, `browser_get_console_logs`.
- First controller-select trace target: `ecg_request`.
- Required named objects live in `apps/ui-xr/src/runtime-state.ts`.
- Current production shell names scene objects in `apps/ui-xr/src/main.ts`; a future sidecar must preserve those semantic names or document the migration.
- Patrick approved `@iwsdk/reference` warmup scope and `@meta-quest/hzdb` legal/procurement posture on 2026-05-04, but do not run floating `npx iwsdk reference warmup`, install `@meta-quest/hzdb`, or add IWSDK packages outside the approved sidecar path in unattended mode.
- Patrick approved [proposal-iwsdk-sidecar-install.md](../proposals/approved/proposal-iwsdk-sidecar-install.md) on 2026-05-04; `apps/ui-xr-iwsdk-spike` now exists as a runnable Phase 1 sidecar with exact `@iwsdk/core@0.3.1`, `@iwsdk/xr-input@0.3.1`, and `three@0.184.0`.
- Phase 1 browser parity passed, but the sidecar remains blocked from production adoption by bundle budget and foreground Quest metrics in `docs/openclinxr/iwsdk-sidecar-phase1-metrics-2026-05-04.json`.

## Sources

- `src-meta-iwsdk-github-2026`
- `src-iwsdk-ai-docs-2026`
- `src-iwsdk-npm-metadata-2026-05-04`
- `src-iwsdk-local-spike-2026-05-04`
- `src-openclinxr-iwsdk-spike-plan-2026-05-04`
