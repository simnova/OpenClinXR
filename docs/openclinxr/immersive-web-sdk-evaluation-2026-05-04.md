# Immersive Web SDK Evaluation

Date: 2026-05-04
Status: Advisory spike recommendation

## Summary

Meta's Immersive Web SDK is a strong candidate for an OpenClinXR WebXR development spike, especially for agent-assisted XR debugging, XR input emulation, spatial UI experiments, locomotion, and build-time GLTF optimization. It should not be adopted as the default headset runtime until the team measures Vite 8 compatibility, Quest 3 frame behavior, bundle impact, and package-governance fit.

## Why It Fits

- It is TypeScript/Three.js-oriented and aligns with the current `apps/ui-xr` direction.
- It provides higher-level WebXR systems that OpenClinXR will need soon: XR input, grab interactions, locomotion, spatial UI, physics, scene understanding, and desktop emulation.
- Its AI-native tooling is unusually relevant to this project: the docs describe MCP tools for screenshots, controller input simulation, scene inspection, and ECS debugging, which could help background agents validate XR behavior without constantly requiring the headset.
- The GLTF optimizer plugin may complement the current asset-pipeline guidance around KTX2, mesh optimization, Draco, and build-time asset preparation.
- The codebase and most reviewed packages report MIT licensing.

## Main Risks

- Version posture: this repo is already using Vite `8.0.10`; several IWSDK Vite plugins currently peer Vite `^7.0.0`. Do not install them into the main workspace until a sidecar spike verifies compatibility.
- Dependency posture: `@iwsdk/core` currently depends on `three: *`, which conflicts with the OpenClinXR preference for exact pinned external versions unless pnpm overrides or a wrapper package constrains it.
- Dev-tool weight: `@iwsdk/vite-plugin-dev` depends on Playwright, sharp, IWER, WebSocket, and MCP SDK packages. That may be worth it for XR agent tooling, but it should stay out of `pnpm verify` until install size, native module behavior, and deterministic CI behavior are understood.
- License gate pressure: `@iwsdk/vite-plugin-gltf-optimizer` depends on GLTF Transform and sharp; the repo has already rejected a direct `@gltf-transform/cli` path because sharp installed `@img/sharp-libvips-darwin-arm64` reporting `LGPL-3.0-or-later`. Use a scratch spike and keep optimizer adoption blocked until the license path is clean or approved.
- Legal/procurement: the optional `@meta-quest/hzdb` package reports `UNLICENSED` in npm metadata. Treat it as blocked until legal/procurement approves its terms.
- Validation scope: IWSDK emulation and MCP tools can improve local iteration, but they do not replace Quest 3 device smoke tests, foreground frame-pacing evidence, thermal/comfort checks, or headset text-readability checks.

## Recommended Spike

Create an isolated package or worktree spike before touching the production XR shell:

1. Add a project-specific spike app, for example `apps/ui-xr-iwsdk-spike`, only if the team wants a committed experiment; otherwise use an ignored scratch worktree.
2. Install exact versions of `@iwsdk/core`, `@iwsdk/xr-input`, `@iwsdk/locomotor`, and possibly `@iwsdk/vite-plugin-dev`.
3. Use pnpm overrides to keep Three.js aligned with the repo's selected version.
4. Validate Vite 8 behavior before accepting any plugin into the main workspace.
5. Build a minimal ED bay scene that mirrors the current `apps/ui-xr` smoke: one patient, one nurse interruption, one EHR panel, trace action buttons, and a live canvas.
6. Compare build size, dev network requests, frame telemetry, console logs, and Quest 3 smoke behavior against the existing `apps/ui-xr` baseline.
7. Try the MCP runtime in agent mode only after local install and trust/network implications are explicit; do not run `@iwsdk/reference` warmup unattended because it downloads model/reference assets.

## Decision For Now

Use IWSDK as a spike candidate, not a committed runtime dependency.

Most promising first packages:

- `@iwsdk/xr-input` for controller/hand interaction modeling.
- `@iwsdk/locomotor` for locomotion patterns if future stations need movement beyond a fixed exam bay.
- `@iwsdk/vite-plugin-gltf-optimizer` for asset optimization, only after Vite 8 peer compatibility and the sharp/libvips license path are resolved.
- `@iwsdk/vite-plugin-dev` for local MCP-driven XR debugging, kept outside required verification at first.
- `@iwsdk/core` only if the ECS/runtime model proves valuable enough to justify adopting its dependency graph.

Avoid for now:

- `@meta-quest/hzdb`, because npm metadata reports `UNLICENSED`.
- `@iwsdk/reference` warmup in unattended runs, because it can download a pinned model and reference corpus.

## Sources

- `src-meta-iwsdk-github-2026`
- `src-iwsdk-ai-docs-2026`
- `src-iwsdk-npm-metadata-2026-05-04`
