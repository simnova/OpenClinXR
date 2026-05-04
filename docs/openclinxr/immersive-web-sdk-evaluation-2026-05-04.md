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

## Machine-Readable Budgets

`packages/openclinxr/iwsdk-spike` now exposes `buildIwsdkSpikeMetricThresholds()` and `evaluateIwsdkSpikeMetrics()` so a committed sidecar spike can be scored with stable pass/fail bars instead of prose-only judgment.

The same planning package now exposes `buildIwsdkAiModeProfiles()` and `buildIwsdkMcpToolCoverage()` so agent runs can pick an explicit verification posture:

`buildIwsdkMcpToolInventoryRequirement()` preserves the source-backed claim that IWSDK exposes 32 MCP tools. OpenClinXR should not claim IWSDK agent-tooling readiness until a sidecar run records the 32-tool inventory, shows coverage for session, transforms, input, browser, scene, and ECS categories, and validates the minimal smoke subset.

`buildIwsdkManagedBrowserEvidenceContract()` and `evaluateIwsdkManagedBrowserEvidence()` now make browser-mode evidence executable. Agent mode must prove the managed Playwright browser is ready and separate from the normal browser session, with fixed screenshot dimensions and the expected DevUI posture. Oversight and collaborate modes must prove the visible Playwright session is the browser under evaluation and that a normal browser was not automatically opened.

`evaluateIwsdkAgentToolingEvidence()` is the aggregate readiness check for the future sidecar MCP lane. It blocks readiness if adapter sync is missing, the tool inventory is not 32, required MCP categories or minimal smoke tools are absent, managed-browser evidence fails, or optional `iwsdk-reference`/`hzdb` actions appear in the run.

`pnpm iwsdk:evidence` prints the current no-install evidence report. In the current contract-only state it exits nonzero by design, with JSON blockers for sidecar approval, agent tooling, and production runtime evidence.

`pnpm iwsdk:evidence:validate` validates the latest committed evidence-contract JSON shape without requiring the blockers to be resolved. The opt-in `pnpm iwsdk:verify` lane runs that shape check so future edits cannot silently drift the advisory evidence consumed by the benchmark report.

| IWSDK AI mode | Browser posture | DevUI | OpenClinXR use |
| --- | --- | --- | --- |
| `agent` | Headless fixed viewport with the normal browser open independently | Off | Default unattended Codex smoke for screenshots, console logs, scene hierarchy, and controller-input regression. |
| `oversight` | Visible, resizable Playwright browser | Off | Human-observed debug run when visual framing, text readability, or XR entry behavior needs review. |
| `collaborate` | Visible, resizable Playwright browser | On | Hands-on pairing session for controller, hand, or spatial UI tuning after the sidecar shell is stable. |

IWSDK MCP evidence should be categorized rather than treated as one generic pass/fail:

| MCP category | Representative tools | Evidence use |
| --- | --- | --- |
| Session | `xr_get_session_status`, `xr_accept_session` | XR entry readiness and session state before screenshots or controller actions. |
| Browser | `browser_screenshot`, `browser_get_console_logs` | Nonblank canvas and warning/error capture for unattended sidecar smoke. |
| Scene | `scene_get_hierarchy` | Named station object presence without relying only on visual screenshots. |
| Input | `xr_select` | Controller-triggered learner trace actions in the emulated runtime. |
| Transforms | `xr_set_headset_transform`, `xr_set_controller_transform` | Repeatable headset/controller positioning for station framing checks. |
| ECS | `ecs_pause`, `ecs_step`, `ecs_query_entities` | Deterministic inspection of runtime entity state during scenario transitions. |

Optional MCP servers remain separately controlled:

- `iwsdk-reference` / `@iwsdk/reference`: blocked in unattended runs because warmup can download a pinned model and reference corpus.
- `hzdb` / `@meta-quest/hzdb`: blocked until legal/procurement review, because package metadata and terms need explicit acceptance.

Committed sidecar spike budget:

- `installedNodeModulesMbMax`: 300 MB.
- `injectedDevRuntimeKbMax`: 1200 KB.
- `appJsBundleKbMax`: 550 KB.
- `bundleDeltaVsUiXrKbMax`: 100 KB.
- `consoleErrorCountMax`: 0.

Production-runtime adoption budget:

- All committed sidecar metrics must pass.
- `avgFpsMin`: 72 FPS on the foreground Quest 3 run.
- `p95FrameMsMax`: 25 ms on the foreground Quest 3 run.
- `controllerSelectLatencyMsMax`: 150 ms for a station trace action.

The scratch spike fits the committed sidecar ceilings using the recorded `287 MB`, `1116.3 KB`, and `504.47 kB` measurements, but production readiness remains blocked because the physical Quest 3 foreground frame-pacing and controller-latency metrics have not passed.

## Recommended Spike

Create an isolated package or worktree spike before touching the production XR shell:

1. Use `packages/openclinxr/iwsdk-spike` as the source-backed planning contract for package posture, adoption gates, and the agent verification runbook. It intentionally has no `@iwsdk/*` runtime dependency.
2. Add a project-specific spike app, for example `apps/ui-xr-iwsdk-spike`, only if the team wants a committed experiment; otherwise use an ignored scratch worktree.
3. Before any install, run the proposed dependency list through `buildIwsdkPreInstallPackagePolicy()` and `evaluateIwsdkPreInstallPackageSelection()` from `packages/openclinxr/iwsdk-spike`. The first install-backed slice should allow only exact-versioned `@iwsdk/core` and `@iwsdk/xr-input`.
4. Use pnpm overrides to keep Three.js aligned with the repo's selected version.
5. Validate Vite 8 behavior before accepting any plugin into the main workspace.
6. Build a minimal ED bay scene that mirrors the current `apps/ui-xr` smoke: one patient, one nurse interruption, one EHR panel, trace action buttons, and a live canvas.
7. Compare build size, dev network requests, frame telemetry, console logs, and Quest 3 smoke behavior against the existing `apps/ui-xr` baseline.
8. Try the MCP runtime in agent mode only after local install and trust/network implications are explicit. For Codex, the docs point adapter generation at `.codex/config.toml`; use `docs/openclinxr/iwsdk-codex-mcp-runbook.md` and the package-level `buildIwsdkCodexMcpAdapterTemplate()` output. Start runtime verification with `iwsdk dev status`, then `xr_get_session_status`, then XR entry/screenshot/scene checks. Do not run `@iwsdk/reference` warmup unattended because it downloads model/reference assets.

## Pre-Install Package Policy

The executable policy is intentionally stricter than the prose recommendation:

- First-slice packages: exact-versioned `@iwsdk/core` and `@iwsdk/xr-input`.
- Review-required packages: `@iwsdk/locomotor`, `@iwsdk/vite-plugin-dev`, and `@iwsdk/vite-plugin-gltf-optimizer`; these are not ready for unattended first-slice install even when exact-versioned.
- Blocked packages: `@iwsdk/reference` and `@meta-quest/hzdb`.
- Blocked transitive package path: any `sharp-libvips` variant, including `@img/sharp-libvips-darwin-arm64`.
- Blocked license expressions: `AGPL`, `GPL`, `LGPL`, `UNLICENSED`, and `Unknown`, matched case-insensitively without collapsing `LGPL` into `GPL`.
- Required package-manager controls: exact version pins, a Three.js pnpm override, recorded `pnpm audit`, and a recorded license-policy report.

Run `pnpm iwsdk:preinstall` to print the default first-slice JSON report, or pass `--proposal path/to/proposal.json` to score a concrete dependency proposal before package manifests or the workspace lockfile change. The opt-in `pnpm iwsdk:verify` lane also runs the default preinstall report, so policy drift is caught before source and architecture checks complete. This means a runnable sidecar is not just a folder-creation task.

## Decision For Now

Use IWSDK as a spike candidate, not a committed runtime dependency.

The sidecar path is contract-only today. Do not create a no-install `apps/ui-xr-iwsdk-spike` app, because that would not measure IWSDK package compatibility, MCP runtime behavior, install footprint, bundle impact, or physical Quest 3 performance. Create the runnable sidecar only after the install scope, exact package versions, and license posture are accepted.

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
