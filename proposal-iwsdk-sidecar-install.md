# Proposal: IWSDK Sidecar Install

## Decision Needed

Approve Codex to create and install a runnable `apps/ui-xr-iwsdk-spike` sidecar as an isolated WebXR experiment. Approval would allow a committed package manifest and lockfile changes for the packages below, but not production adoption in `apps/ui-xr` or shared runtime packages.

## Recommendation

Approve Phase 1 only.

Phase 1 should create a runnable Vite/Three sidecar that mirrors the existing XR station shape closely enough to measure IWSDK runtime value without adding IWSDK devtools, reference warmup, `hzdb`, GLTF optimization, or Meta Spatial Editor tooling yet. This is the lowest-risk way to validate headset behavior, bundle weight, and app architecture before pulling in MCP/devtool packages with Vite 7 peer ranges or optional packages with download/device-management side effects.

## Proposed Phase 1 Package List

| Package | Version | Role | Posture |
| --- | ---: | --- | --- |
| `@iwsdk/core` | `0.3.1` | Runtime helpers, ECS/WebXR integration, UI/scene primitives | Approve for sidecar only |
| `@iwsdk/xr-input` | `0.3.1` | Controller and interaction input modeling | Approve for sidecar only |
| `three` | `0.184.0` | Match current OpenClinXR XR app and satisfy IWSDK peer/runtime use | Use exact existing repo version |
| `@types/three` | `0.184.0` | TypeScript typing for sidecar source | Use exact existing repo version |
| `vite` | `8.0.10` | Match current repo Vite major and expose peer mismatch evidence | Use exact existing repo version |
| `typescript` | `6.0.3` | Match current repo TypeScript/tsgo posture | Use exact existing repo version |
| `vitest` | `4.1.5` | Sidecar unit/contract checks | Use exact existing repo version |

The sidecar may also depend on workspace-only OpenClinXR fixtures or schemas when useful, but it must not import `apps/ui-xr/src/**` or depend on `@openclinxr/ui-xr`.

## Explicitly Not Included In Phase 1

| Package or action | Current version | Why excluded |
| --- | ---: | --- |
| `@iwsdk/vite-plugin-dev` | `0.3.1` | Peer dependency is `vite: ^7.0.0`; defer until the runtime sidecar is stable and the Vite 8 compatibility decision is explicit. |
| `@iwsdk/vite-plugin-gltf-optimizer` | `0.3.1` | Pulls the sharp/libvips path and adds asset-pipeline complexity before runtime value is proven. |
| `@iwsdk/vite-plugin-uikitml` | `0.3.1` | Peer dependency is `vite: ^7.0.0`; defer until in-headset text and EHR panel requirements need it. |
| `@iwsdk/vite-plugin-metaspatial` | `0.3.1` | Peer dependency is `vite: ^7.0.0`; defer until Meta Spatial Editor workflow has a concrete authoring spike. |
| `@iwsdk/reference` | `0.3.2` | Warmup download scope is approved, but the package is best used through an exact `pnpm dlx @iwsdk/reference@0.3.2 iwsdk-reference warmup` path after CLI help, cache location, and download size are recorded. |
| `@meta-quest/hzdb` | `1.1.0` | Legal/procurement posture is approved, but it should remain sidecar-gated until runtime device-management and asset lookup behavior are recorded. |
| `@iwsdk/create` | not proposed | Avoid generator side effects; create the sidecar from repo patterns instead. |
| `@iwsdk/starter-assets` | not proposed | Avoid unreviewed starter asset licensing/cache behavior. |

## Pros

- Produces a real app target for Quest 3 and desktop browser measurement instead of another contract-only artifact.
- Keeps the first install small and tied to exact package versions already represented in the policy package.
- Lets Codex compare `apps/ui-xr` and `apps/ui-xr-iwsdk-spike` bundle size, frame pacing, controller behavior, and scene naming without contaminating production runtime code.
- Preserves PNPM, TurboRepo, ArchUnitTS, Biome, Knip, audit, and existing verification lanes.
- Leaves the MCP/devtools lane available once Vite 8 compatibility and sidecar runtime value are known.

## Cons

- `@iwsdk/core` itself brings a broad transitive graph, including `three: *`, `@pmndrs/*`, `@babylonjs/havok`, `@iwsdk/glxf`, and `@iwsdk/locomotor`.
- The most agent-useful IWSDK package, `@iwsdk/vite-plugin-dev`, is not part of the first install because its published peer range targets Vite 7 while OpenClinXR is on Vite 8.
- A sidecar may temporarily duplicate XR station shell code until the right shared contracts are identified.
- Quest foreground performance still needs human-in-headset capture; a sidecar alone cannot prove comfort or sustained frame pacing.

## Acceptance Criteria

- `apps/ui-xr-iwsdk-spike` exists and runs locally with `pnpm --filter @openclinxr/ui-xr-iwsdk-spike dev:portless`.
- The sidecar renders a nonblank ED chest-pain station shell with stable object names matching the IWSDK parity contract.
- `pnpm iwsdk:verify`, `pnpm verify`, `pnpm packages:build`, and `git diff --check` pass after lockfile changes.
- ArchUnitTS and the IWSDK workspace posture checker still block IWSDK imports/dependencies outside the sidecar.
- Bundle, install footprint, console error, desktop canvas, Quest CDP, and manual Quest foreground evidence are recorded before any Phase 2 devtool package is proposed.

## Approval Wording

Approve this proposal if Codex may create and install `apps/ui-xr-iwsdk-spike` with the Phase 1 package list above, commit the resulting package manifest and lockfile changes, and run local-only verification. This approval should not include Phase 2 packages or production adoption unless stated separately.

## Sources

- Local `pnpm view` metadata queries on 2026-05-04 for IWSDK packages, `three`, `vite`, and `@vitejs/plugin-react`.
- `sources/iwsdk-npm-metadata-2026-05-04.json`
- `docs/openclinxr/iwsdk-codex-mcp-runbook.md`
- `packages/openclinxr/iwsdk-spike`
