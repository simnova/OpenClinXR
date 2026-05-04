# Proposal: IWSDK Phase 2 Devtools

Status: Proposed for later; do not approve until Phase 1 metrics and Quest foreground evidence are reviewed.

## Decision Needed

Approve a second IWSDK sidecar slice that evaluates agent-oriented devtools, adapter sync, MCP inventory, reference warmup, and optional Quest device-management helpers without promoting IWSDK into production `apps/ui-xr`.

## Recommendation

Do not install Phase 2 packages yet. First resolve the Phase 1 sidecar bundle-size blockers and foreground Quest evidence gap.

When those are reviewed, approve a narrow Phase 2 sidecar-only spike for `@iwsdk/vite-plugin-dev@0.3.1` and adapter/MCP evidence. Keep `@iwsdk/reference@0.3.2`, `@meta-quest/hzdb@1.1.0`, Meta Spatial, UIKitML, and GLTF optimizer packages as separately gated sub-slices.

## Proposed Phase 2 Package/Action Scope

| Package or action | Version | Proposed posture |
| --- | ---: | --- |
| `@iwsdk/vite-plugin-dev` | `0.3.1` | Sidecar-only after Vite 8 peer mismatch decision |
| `iwsdk adapter sync` | package-managed exact path | Local config generation only; reversible |
| IWSDK MCP inventory smoke | n/a | Record exact observed tools and minimal smoke sequence |
| `@iwsdk/reference` warmup | `0.3.2` | Separate exact `pnpm dlx` proposal/action after help/cache/download size are recorded |
| `@meta-quest/hzdb` | `1.1.0` | Separate sidecar-only review after behavior evidence plan |
| `@iwsdk/vite-plugin-gltf-optimizer` | `0.3.1` | Defer; sharp/libvips path remains license/performance review risk |

## Pros

- Unlocks the most agent-useful IWSDK capabilities: scene hierarchy, controller emulation, screenshots, ECS inspection, and adapter-generated MCP config.
- Could reduce friction for future XR iteration and background-agent verification.
- Keeps risky or broad packages out of production while still testing local developer value.
- Produces machine-readable evidence before any runtime adoption decision.

## Cons

- Published IWSDK Vite plugin peer ranges currently target Vite 7 while OpenClinXR is on Vite 8.
- Devtool packages may inject runtime weight or alter the Vite development environment.
- MCP/browser evidence still cannot replace physical Quest foreground performance proof.
- Reference/hzdb/optimizer sub-slices may introduce downloads, UNLICENSED metadata, or sharp/libvips review issues.

## Approval Wording

Approve this proposal only after reviewing Phase 1 sidecar metrics and Quest foreground evidence. Approval would allow Codex to install `@iwsdk/vite-plugin-dev@0.3.1` in `apps/ui-xr-iwsdk-spike`, run local adapter/MCP evidence, and commit reports. It would not authorize production adoption, default verification changes, `@iwsdk/reference`, `@meta-quest/hzdb`, optimizer packages, or cloud/API usage unless separately stated.

## Acceptance Criteria

- Phase 1 sidecar metric blockers are reviewed and either resolved or explicitly accepted for a devtool-only spike.
- Vite 8 peer mismatch posture is documented before install.
- `pnpm iwsdk:verify`, sidecar tests, sidecar build, architecture rules, and workspace posture checks pass.
- Adapter sync records generated config target, rollback path, and no machine-level trust changes.
- MCP evidence records exact observed tool names, category coverage, minimal smoke sequence, nonblank screenshot, known scene names, trace advancement, and console logs.
- Production `apps/ui-xr` remains free of `@iwsdk/*` dependencies and imports.

## Sources

- `proposals/approved/proposal-iwsdk-sidecar-install.md`
- `docs/openclinxr/iwsdk-sidecar-phase1-metrics-2026-05-04.json`
- `docs/openclinxr/iwsdk-codex-mcp-runbook.md`
- `docs/openclinxr/immersive-web-sdk-evaluation-2026-05-04.md`
- `packages/openclinxr/iwsdk-spike`
