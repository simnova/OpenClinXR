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

## Local Scratch Spike

Codex ran a scratch spike outside the repository at `/tmp/openclinxr-iwsdk-spike-NyGyoa` with exact IWSDK `0.3.1`, Vite `8.0.10`, Three `0.184.0`, and explicit Node `22.19.0`. No main workspace package files or lockfiles were changed.

Results:

- `pnpm install --ignore-scripts` succeeded, but reported the expected `@iwsdk/vite-plugin-dev` peer mismatch with Vite 8.
- The minimal strict TypeScript app needed `@types/three`.
- The scratch Vite 8 install did not have the needed Rolldown native binding until `@rolldown/binding-darwin-arm64@1.0.0-rc.17` was added explicitly.
- Running Vite through the default pnpm script exposed Node `21.7.1`; running the Vite binary through `/Users/patrick/.nvm/versions/node/v22.19.0/bin/node` succeeded.
- `tsc --noEmit` passed.
- `vite build` passed with the IWSDK dev plugin loaded, producing one `504.47 kB` JavaScript chunk and the expected chunk-size warning.
- The scratch dev server loaded in Chrome DevTools at `http://127.0.0.1:5181`, fetched `/@iwer-injection-runtime`, exposed `navigator.xr` and `window.IWER_DEVICE`, and showed no warning/error console messages except a missing favicon.
- IWSDK reported a development runtime injection size of `1116.3 KB`.
- The scratch install occupied about `287 MB` in `node_modules`; `pnpm audit --audit-level=high` reported no known vulnerabilities.
- The license list included `LGPL-3.0-or-later` for `@img/sharp-libvips-darwin-arm64@1.0.4` and `Unknown` metadata for `@pmndrs/handle`, `@pmndrs/pointer-events`, and `@pmndrs/uikit`.

Interpretation: IWSDK dev tooling appears technically viable enough for a committed spike, but it is too heavy and too license-sensitive to add to the main runtime path casually.

## Recommended Spike

Create an isolated package or worktree spike before touching the production XR shell:

1. Use `packages/openclinxr/iwsdk-spike` as the source-backed planning contract for package posture, adoption gates, and the agent verification runbook. It intentionally has no `@iwsdk/*` runtime dependency.
2. Add a project-specific spike app, for example `apps/ui-xr-iwsdk-spike`, only if the team wants a committed experiment; otherwise use an ignored scratch worktree.
3. Install exact versions of `@iwsdk/core`, `@iwsdk/xr-input`, `@iwsdk/locomotor`, and possibly `@iwsdk/vite-plugin-dev`.
4. Use pnpm overrides to keep Three.js aligned with the repo's selected version.
5. Validate Vite 8 behavior before accepting any plugin into the main workspace.
6. Build a minimal ED bay scene that mirrors the current `apps/ui-xr` smoke: one patient, one nurse interruption, one EHR panel, trace action buttons, and a live canvas.
7. Compare build size, dev network requests, frame telemetry, console logs, and Quest 3 smoke behavior against the existing `apps/ui-xr` baseline.
8. Try the MCP runtime in agent mode only after local install and trust/network implications are explicit. For Codex, the docs point adapter generation at `.codex/config.toml`; start runtime verification with `iwsdk dev status`, then `xr_get_session_status`, then XR entry/screenshot/scene checks. Do not run `@iwsdk/reference` warmup unattended because it downloads model/reference assets.

## Decision For Now

Use IWSDK as a spike candidate, not a committed runtime dependency.

## Committed Sidecar Sequence

If the team decides to make the experiment visible in the monorepo, use `apps/ui-xr-iwsdk-spike/` and keep `apps/ui-xr/`, `apps/api/`, and `packages/openclinxr/scenario-runtime/` blocked from IWSDK dependencies until the spike exits. The sequence should be:

1. `phase-0-policy`: install only `@iwsdk/core` and `@iwsdk/xr-input`; verify pinned package specs, license policy, and the existing architecture boundary test. Keep `@iwsdk/reference`, `@meta-quest/hzdb`, and `@iwsdk/vite-plugin-gltf-optimizer` blocked.
2. `phase-1-runtime-shell`: rebuild the minimal ED bay shell with IWSDK core/input and compare nonblank canvas, bundle-size delta versus `apps/ui-xr`, controller-select trace events, and desktop fallback behavior.
3. `phase-2-agent-devtools`: add `@iwsdk/vite-plugin-dev` only after the shell is stable; measure Vite 8 compatibility, Node 22 runtime path, MCP scene hierarchy, MCP controller select, and console log capture. Do not run `@iwsdk/reference` warmup unattended.
4. `phase-3-quest-device-proof`: use physical Quest 3 evidence before any production adoption decision, including foreground frame pacing, controller-select latency, headset text readability, and thermal/comfort notes.

Azure B1/App Service should remain the orchestration/API target. IWSDK dev tooling, Playwright, MCP runtime support, reference warmups, and asset optimization experiments belong on the local M4-class workstation or a non-production spike environment, not the production App Service deployment path.

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
- `src-iwsdk-local-spike-2026-05-04`
- `src-openclinxr-iwsdk-spike-plan-2026-05-04`
