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

The same planning package now exposes `buildIwsdkAiModeProfiles()`, `buildIwsdkMcpToolCoverage()`, and `buildIwsdkMcpToolInventory()` so agent runs can pick an explicit verification posture and compare captured MCP runtime output against the exact source-backed tool list:

`buildIwsdkMcpToolInventoryRequirement()` preserves the source-backed claim that IWSDK exposes 32 MCP tools across nine categories. OpenClinXR should not claim IWSDK agent-tooling readiness until a sidecar run records the 32-tool inventory, records the observed tool names, shows coverage for session, transforms, input mode, select/trigger, gamepad, device state, browser, scene, and ECS categories, and validates the minimal smoke subset.

`buildIwsdkManagedBrowserEvidenceContract()` and `evaluateIwsdkManagedBrowserEvidence()` now make browser-mode evidence executable. Agent mode must prove the managed Playwright browser is ready and separate from the normal browser session, with fixed screenshot dimensions and the expected DevUI posture. Oversight and collaborate modes must prove the visible Playwright session is the browser under evaluation and that a normal browser was not automatically opened.

`evaluateIwsdkAgentToolingEvidence()` is the aggregate readiness check for the future sidecar MCP lane. It blocks readiness if adapter sync is missing, the tool inventory is not 32, observed tool names are absent or drift from the expected inventory, required MCP categories or minimal smoke tools are absent, managed-browser evidence fails, or optional `iwsdk-reference`/`hzdb` actions appear in the run.

`buildIwsdkViteAiDevConfigContract()` records the future sidecar Vite plugin posture without installing IWSDK. The phase 2 target is `@iwsdk/vite-plugin-dev` with `emulator: { device: 'metaQuest3' }`, `ai: { mode: 'agent', tools: ['codex'], screenshotSize: { width: 500, height: 500 } }`, and `verbose: true`. That config stays blocked until the install-backed `apps/ui-xr-iwsdk-spike` exists with exact IWSDK versions, the phase 1 runtime shell metrics pass, operator install-scope approval is recorded, and license review accepts the transitive dependency posture.

`pnpm iwsdk:agent-tooling:evidence -- --input path/to/evidence.json --output docs/openclinxr/iwsdk-agent-tooling-evidence-YYYY-MM-DD.json` scores that aggregate evidence from a captured JSON file without installing IWSDK or changing MCP config.

`pnpm iwsdk:compatibility:evidence -- --input path/to/evidence.json --output docs/openclinxr/iwsdk-compatibility-evidence-YYYY-MM-DD.json` scores captured phase-2 compatibility evidence for OpenClinXR's Vite major, the IWSDK Vite plugin peer range, Node major/runtime path, and Rolldown native-binding load behavior.

`pnpm iwsdk:metadata-drift:evidence -- --input path/to/evidence.json --output docs/openclinxr/iwsdk-metadata-drift-evidence-YYYY-MM-DD.json` scores captured package docs-vs-npm version evidence before optional tools such as `@iwsdk/reference` can be considered for unattended use.

`pnpm iwsdk:sidecar:metrics -- --input path/to/metrics.json --output docs/openclinxr/iwsdk-sidecar-metrics-YYYY-MM-DD.json` scores committed sidecar and production-runtime budgets from a captured metrics JSON file, including install footprint, dev runtime size, bundle delta, console errors, foreground Quest preflight readiness, Quest FPS, p95 frame time, and controller-select latency.

`pnpm iwsdk:workspace:posture` scans the committed workspace for IWSDK package dependencies, npm alias specifiers that target IWSDK packages, IWSDK references in root package-manager controls and workspace catalogs, source imports, blocked script actions, IWSDK lockfile package residue, blocked lockfile packages, quoted pnpm lockfile package keys, sharp/libvips-style blocked transitive lockfile packages, sidecar lockfile importer parity, sidecar lockfile dependency parity, sidecar approval state, and root package-manager controls. The planning package `packages/openclinxr/iwsdk-spike/` may hold advisory policy and tests, but executable `@iwsdk/*` imports or dependencies are allowed only in `apps/ui-xr-iwsdk-spike/` after approval. In the current contract-only state the posture check should report the sidecar as absent and ready; if `apps/ui-xr-iwsdk-spike/` exists later, run it with `--approved-sidecar` only after operator install-scope approval is recorded.

`pnpm iwsdk:evidence` prints the current no-install evidence report. In the current contract-only state it exits nonzero by design, with JSON blockers for sidecar approval, IWSDK/Vite/Node/Rolldown compatibility, agent tooling, and production runtime evidence.

`pnpm iwsdk:evidence:validate` validates the latest committed evidence-contract JSON shape without requiring the blockers to be resolved. The opt-in `pnpm iwsdk:verify` lane runs that shape check so future edits cannot silently drift the advisory evidence consumed by the benchmark report. The current compatibility section records OpenClinXR Vite major `8`, IWSDK plugin peer range `^7.0.0`, Node major `22`, the Node 22 runtime path used in the scratch evidence, and the Rolldown native-binding load assumption; phase 2 remains blocked while the peer range does not accept Vite 8.

`docs/openclinxr/iwsdk-first-slice-preinstall-proposal.json` is the committed no-install proposal fixture for the first allowed sidecar slice. It can be scored with `pnpm iwsdk:preinstall -- --proposal docs/openclinxr/iwsdk-first-slice-preinstall-proposal.json` before any lockfile or app scaffold changes.

`pnpm agent:sources` now also requires every source ID emitted by `packages/openclinxr/iwsdk-spike` to resolve to a committed `sources/*.json` record.

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
| Transforms | `xr_set_transform`, `xr_look_at` | Repeatable headset/controller positioning for station framing checks. |
| Input mode | `xr_set_input_mode`, `xr_set_connected` | Controller/hand tracking mode and device connectivity checks for repeatable station setup. |
| Select/trigger | `xr_select`, `xr_set_select_value` | Controller-triggered learner trace actions and grab/release interaction checks. |
| Gamepad | `xr_get_gamepad_state`, `xr_set_gamepad_state` | Thumbstick/button regression evidence for high-pressure station controls. |
| Device state | `xr_get_device_state`, `xr_set_device_state` | Whole-device reset and headset/controller state snapshots for deterministic smoke setup. |
| ECS | `ecs_pause`, `ecs_step`, `ecs_query_entity` | Deterministic inspection of runtime entity state during scenario transitions. |

Exact MCP tool inventory expected from the future sidecar runtime:

| MCP category | Expected tool names |
| --- | --- |
| Session | `xr_get_session_status`, `xr_accept_session`, `xr_end_session` |
| Transforms | `xr_get_transform`, `xr_set_transform`, `xr_look_at`, `xr_animate_to` |
| Input mode | `xr_set_input_mode`, `xr_set_connected` |
| Select/trigger | `xr_get_select_value`, `xr_set_select_value`, `xr_select` |
| Gamepad | `xr_get_gamepad_state`, `xr_set_gamepad_state` |
| Device state | `xr_get_device_state`, `xr_set_device_state` |
| Browser | `browser_screenshot`, `browser_get_console_logs`, `browser_reload_page` |
| Scene | `scene_get_hierarchy`, `scene_get_object_transform` |
| ECS | `ecs_pause`, `ecs_resume`, `ecs_step`, `ecs_query_entity`, `ecs_find_entities`, `ecs_list_systems`, `ecs_list_components`, `ecs_toggle_system`, `ecs_set_component`, `ecs_snapshot`, `ecs_diff` |

Optional MCP servers remain separately controlled:

- `iwsdk-reference` / `@iwsdk/reference`: Patrick approved local warmup scope on 2026-05-04, but unattended/default verification still blocks warmup until the exact PNPM path is validated. The unscoped `iwsdk` package was not found in npm; the package-managed candidate is `pnpm dlx @iwsdk/reference@0.3.2 iwsdk-reference warmup`. Record CLI help, payload size, cache location, and offline cleanup before running it.
- `hzdb` / `@meta-quest/hzdb`: Patrick approved legal/procurement posture on 2026-05-04 for package terms, npm metadata, Quest device-management scope, and asset-library lookup behavior. It remains sidecar-gated and must not enter production manifests or lockfile state before install-backed sidecar approval.

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
8. Try the MCP runtime in agent mode only after local install and trust/network implications are explicit. For Codex, the docs point adapter generation at `.codex/config.toml`; use `docs/openclinxr/iwsdk-codex-mcp-runbook.md` and the package-level `buildIwsdkCodexMcpAdapterTemplate()` output. Start runtime verification with `iwsdk dev status`, then `xr_get_session_status`, then XR entry/screenshot/scene checks. Do not use floating `npx iwsdk reference warmup`; use the exact PNPM candidate only after CLI help, cache location, and download size are recorded.

## Pre-Install Package Policy

The executable policy is intentionally stricter than the prose recommendation:

- First-slice packages: exact-versioned `@iwsdk/core` and `@iwsdk/xr-input`.
- Review-required packages: `@iwsdk/glxf`, `@iwsdk/locomotor`, `@iwsdk/vite-plugin-dev`, `@iwsdk/vite-plugin-gltf-optimizer`, `@iwsdk/vite-plugin-uikitml`, and `@iwsdk/vite-plugin-metaspatial`; these are not ready for unattended first-slice install even when exact-versioned.
- Blocked first-slice packages: `@iwsdk/create`, `@iwsdk/reference`, `@iwsdk/starter-assets`, and `@meta-quest/hzdb`; Patrick's 2026-05-04 approvals resolve human review for reference warmup scope and `hzdb` legal/procurement, not install-backed sidecar or production adoption.
- Blocked transitive package path: any `sharp-libvips` variant, including `@img/sharp-libvips-darwin-arm64`.
- Blocked license expressions: `AGPL`, `GPL`, `LGPL`, `UNLICENSED`, and `Unknown`, matched case-insensitively without collapsing `LGPL` into `GPL`.
- Required package-manager controls: exact version pins, a Three.js pnpm override, recorded `pnpm audit`, and a recorded license-policy report.
- Workspace posture controls are intentionally concrete: placeholder scripts such as `echo pnpm audit` or `true` do not satisfy the audit/license controls, and launcher aliases such as `pnpm create @iwsdk@...` remain blocked in unattended runs.

Run `pnpm iwsdk:preinstall` to print the default first-slice JSON report, or pass `--proposal path/to/proposal.json` to score a concrete dependency proposal before package manifests or the workspace lockfile change. The opt-in `pnpm iwsdk:verify` lane also runs the default preinstall report, so policy drift is caught before source and architecture checks complete. This means a runnable sidecar is not just a folder-creation task.

## Decision For Now

Use IWSDK as a spike candidate, not a committed runtime dependency.

The sidecar path is contract-only today. Do not create a no-install `apps/ui-xr-iwsdk-spike` app, because that would not measure IWSDK package compatibility, MCP runtime behavior, install footprint, bundle impact, or physical Quest 3 performance. Create the runnable sidecar only after the install scope, exact package versions, and license posture are accepted.

MADR 0028 captures this as an accepted spike-planning decision. The production `apps/ui-xr` shell now contributes baseline MCP targets without adding IWSDK dependencies: `buildIwsdkStationMcpSmokePlan()` defines the ED chest pain agent-mode smoke order, required named scene objects, and the first controller-select trace target. A future sidecar should preserve those semantic scene names or explain any migration before parity can be claimed.

## Committed Sidecar Sequence

If the team decides to make the experiment visible in the monorepo, use `apps/ui-xr-iwsdk-spike/` and keep `apps/ui-xr/`, `apps/api/`, and `packages/openclinxr/scenario-runtime/` blocked from IWSDK dependencies until the spike exits. The sequence should be:

1. `phase-0-policy`: install only `@iwsdk/core` and `@iwsdk/xr-input`; verify pinned package specs, license policy, sidecar lockfile importer dependency parity, and the existing architecture boundary test. Keep `@iwsdk/reference`, `@meta-quest/hzdb`, `@iwsdk/create`, and `@iwsdk/vite-plugin-gltf-optimizer` blocked.
2. `phase-1-runtime-shell`: rebuild the minimal ED bay shell with IWSDK core/input and compare nonblank canvas, bundle-size delta versus `apps/ui-xr`, controller-select trace events, and desktop fallback behavior.
3. `phase-2-agent-devtools`: add `@iwsdk/vite-plugin-dev` only after the shell is stable; measure Vite 8 compatibility, Node 22 runtime path, `scene_get_hierarchy`, `xr_select`, and `browser_get_console_logs`. Do not run `@iwsdk/reference` warmup unattended.
4. `phase-3-quest-device-proof`: use physical Quest 3 evidence before any production adoption decision, including foreground frame pacing, controller-select latency, headset text readability, and thermal/comfort notes.

Azure B1/App Service should remain the orchestration/API target. IWSDK dev tooling, Playwright, MCP runtime support, reference warmups, and asset optimization experiments belong on the local M4-class workstation or a non-production spike environment, not the production App Service deployment path.

Most promising first packages:

- `@iwsdk/xr-input` for controller/hand interaction modeling.
- `@iwsdk/locomotor` for locomotion patterns if future stations need movement beyond a fixed exam bay.
- `@iwsdk/glxf` for scene format loading, only if it simplifies exam-room scene composition without fragmenting the GLB/GLTF asset pipeline.
- `@iwsdk/vite-plugin-uikitml` for spatial UI/EHR panel experiments, only after Vite compatibility, accessibility, and in-headset text-readability checks.
- `@iwsdk/vite-plugin-metaspatial` for optional Meta Spatial Editor authoring workflow experiments, only after asset provenance and build-pipeline review.
- `@iwsdk/vite-plugin-gltf-optimizer` for asset optimization, only after Vite 8 peer compatibility and the sharp/libvips license path are resolved.
- `@iwsdk/vite-plugin-dev` for local MCP-driven XR debugging, kept outside required verification at first.
- `@iwsdk/core` only if the ECS/runtime model proves valuable enough to justify adopting its dependency graph.

Avoid for now:

- `@iwsdk/create`, because unattended scaffold generation can create misleading runtime-looking workspace changes before install scope is approved.
- `@iwsdk/starter-assets`, because CDN-hosted starter templates/assets need asset-license, cache-location, and offline reproducibility review.
- `@meta-quest/hzdb`, because npm metadata reports `UNLICENSED`.
- `@iwsdk/reference` warmup in unattended runs, because it can download a pinned model and reference corpus.

## Sources

- `src-meta-iwsdk-github-2026`
- `src-iwsdk-ai-docs-2026`
- `src-iwsdk-npm-metadata-2026-05-04`
- `src-iwsdk-local-spike-2026-05-04`
- `src-openclinxr-iwsdk-spike-plan-2026-05-04`
