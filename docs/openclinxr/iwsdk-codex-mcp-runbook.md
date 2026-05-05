# IWSDK Codex MCP Runbook

Date: 2026-05-04
Status: Phase 1 sidecar installed; MCP/devtool phase remains advisory

## Purpose

This runbook defines how Codex should evaluate Meta Immersive Web SDK tooling now that a committed Phase 1 sidecar exists at `apps/ui-xr-iwsdk-spike` with exact package versions and accepted license posture.

This runbook does not install IWSDK, does not modify `.codex/config.toml`, does not warm the IWSDK reference corpus, and does not replace physical Quest 3 validation.

Current state: `apps/ui-xr-iwsdk-spike` is a runnable sidecar using `@iwsdk/core@0.3.1`, `@iwsdk/xr-input@0.3.1`, `three@0.184.0`, and the approved sidecar-only `@iwsdk/vite-plugin-dev@0.3.1` devDependency. The dev plugin is configured as serve-only with `injectOnBuild: false`; the 2026-05-04 IWER evidence run found no dev-runtime strings in production `dist` output. It is not production-ready: the IWSDK vendor bundle remains over budget, Vite 8 is still outside the plugin's declared Vite 7 peer range, scene hierarchy/ECS tools are not yet wired to an IWSDK framework runtime, and physical Quest foreground metrics are still missing.

Latest IWER managed-browser evidence:

- `docs/openclinxr/iwer-sidecar-emulation-evidence-2026-05-04.json`
- `docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png`

This is desktop/IWER emulation evidence only. It does not replace Quest foreground frame pacing, controller latency, thermals, comfort, passthrough, or in-headset readability observations.

Use `pnpm iwsdk:evidence` to print the current sidecar evidence contract report. A nonzero exit is expected while agent tooling, bundle budget, reference metadata, and Quest foreground blockers remain unresolved; the JSON blockers are the evidence to carry into leadership review.

Use `pnpm iwsdk:evidence:validate` to validate the latest committed `docs/openclinxr/iwsdk-evidence-contract-*.json` snapshot's structure without treating current readiness blockers as command failures. This check is now part of `pnpm iwsdk:verify`, alongside the contract tests that bind UI-XR parity and operator-steering blockers. The snapshot also carries the preinstall package policy and the Vite/Node/Rolldown compatibility gate so leadership can see which packages are allowed, review-required, or blocked without running the TypeScript package.

## Preconditions

- `pnpm iwsdk:verify` passes, including its default `pnpm iwsdk:preinstall` JSON preflight.
- `evaluateIwsdkPreInstallPackageSelection()` reports no blockers for the proposed IWSDK sidecar dependency list before any `pnpm add` changes the workspace lockfile.
- `pnpm iwsdk:preinstall -- --proposal path/to/proposal.json` records a ready JSON verdict for the exact package proposal, including required package-manager controls.
- `pnpm iwsdk:compatibility:evidence -- --input path/to/evidence.json --output docs/openclinxr/iwsdk-compatibility-evidence-YYYY-MM-DD.json` records a ready verdict for the exact Vite/Node/Rolldown evidence captured from the sidecar workspace.
- `pnpm iwsdk:metadata-drift:evidence -- --input path/to/evidence.json --output docs/openclinxr/iwsdk-metadata-drift-evidence-YYYY-MM-DD.json` records a ready verdict for any optional IWSDK package whose docs and npm metadata must be reconciled before use.
- The `metadataDrift` section in the latest evidence snapshot has no blockers before any `@iwsdk/reference` warmup; current evidence records docs `v0.3.1` versus npm latest `0.3.2`.
- `apps/ui-xr-iwsdk-spike` exists and is intentionally outside production runtime paths.
- IWSDK dependencies are exact-versioned in the sidecar app.
- The sidecar app does not import or depend on `@openclinxr/ui-xr` or `apps/ui-xr/src/**`; parity must flow through explicit contracts, shared packages, or committed evidence snapshots.
- `@iwsdk/reference`, `@meta-quest/hzdb`, and production adoption of `@iwsdk/vite-plugin-gltf-optimizer` remain outside default unattended verification unless the policy is deliberately changed. Patrick has approved the reference warmup download scope and `hzdb` legal/procurement posture, but both remain sidecar-gated.
- The sidecar app has recorded installed footprint, injected dev runtime size, JS bundle size, console errors, and bundle delta versus `apps/ui-xr`.

## Codex MCP Template

`packages/openclinxr/iwsdk-spike` exposes `buildIwsdkCodexMcpAdapterTemplate()` as the source of truth for the local adapter template.

The package-level runbook also records `adapterSyncCommand = "iwsdk adapter sync"`. Run that only after the sidecar app and exact packages are approved, then keep the resulting local MCP config reversible.

## Future Vite AI Config

`packages/openclinxr/iwsdk-spike` also exposes `buildIwsdkViteAiDevConfigContract()` as the source of truth for the future sidecar's Vite dev-plugin posture. This remains advisory until phase 2, after the install-backed sidecar exists and the phase 1 runtime shell metrics pass.

Required future options:

- `@iwsdk/vite-plugin-dev`
- `emulator: { device: 'metaQuest3' }`
- `ai: { mode: 'agent', tools: ['codex'], screenshotSize: { width: 500, height: 500 } }`
- `verbose: true`

The config contract requires evidence that the Vite config uses `iwsdkDev`, that Codex MCP config generation is explicitly enabled, that unattended runs use agent mode, that the Quest 3 emulator is selected, that screenshot size is bounded, that adapter sync generates Codex config, and that runtime status records browser command readiness.

Do not add this plugin to the committed workspace until `apps/ui-xr-iwsdk-spike` exists with exact IWSDK versions, the phase 1 runtime shell metrics pass, the install scope is accepted, and transitive license posture is accepted.

Target:

```text
.codex/config.toml
```

Template:

```toml
[mcp_servers.iwsdk-runtime]
command = "pnpm"
args = ["exec", "iwsdk", "mcp", "stdio"]
```

Keep this adapter local and reversible. Do not commit `.codex/config.toml` changes to the repo.

## Verification Order

`packages/openclinxr/iwsdk-spike` exposes `buildIwsdkVerificationToolSelectionContract()` as the source of truth for which verification tool can support which XR claim.

Use the tool ladder this way:

- Browser Use, Playwright, or Chrome DevTools MCP against a local desktop/mobile browser can prove desktop fallback, nonblank WebGL canvas, trace controls, and clean console behavior. It cannot prove Quest shell delivery, foreground frame pacing, controller latency, comfort, or in-headset readability.
- Quest CDP through USB-C, ADB reverse, and Quest Browser remote inspection can prove Quest Browser shell delivery, WebXR feature detection, and basic trace-control interaction. It cannot prove foreground frame pacing when the CDP report is hidden or inactive.
- Future IWSDK MCP evidence can prove emulated XR session readiness, scene hierarchy parity, controller-select trace behavior, screenshots, console logs, and ECS inspection only after the approved sidecar exists and the MCP evidence gates pass.
- Manual foreground Quest evidence remains required before any production-readiness claim about frame pacing, controller latency, comfort, thermal behavior, or readable in-headset text.

Treat screenshots and videos as adversarial review artifacts, not decorative proof. Every capture used for XR/UI evidence should record whether it came from desktop browser, Quest CDP, IWSDK/IWER emulation, or a human worn-headset session; the route/runtime URL; viewport or headset context; scenario ID; XR mode; camera pose when available; capture command or tool; and artifact path. The Test Automation Lead owns the capture contract, UX Friction Critic attacks readability/occlusion/affordances, Clinical Safety Critic attacks misleading or missing clinical cues, XR Systems Architect classifies the evidence limits, and Asset Pipeline Lead attacks actor, equipment, clothing, skin, rigging, scale, and environment fidelity. Automated browser, MCP, or IWER screenshots cannot replace the manual Quest foreground report.

Default to IWSDK `agent` mode for unattended Codex checks: headless fixed viewport, DevUI off, and a separate normal browser for manual development. Use `oversight` mode only when Patrick or a developer needs to watch the Playwright browser directly. Use `collaborate` mode only for hands-on controller, hand, or spatial UI tuning after the sidecar shell is stable.

The current production `apps/ui-xr` shell is the baseline station for future sidecar parity checks. It now exposes a source-controlled smoke plan through `buildIwsdkStationMcpSmokePlan()` in `apps/ui-xr/src/runtime-state.ts`. The first plan targets the ED chest pain station, requires named Three.js scene objects for patient, nurse, spouse, monitor, bed, floor, lights, and wall clock, and uses `ecg_request` as the first controller-select trace action.

Run IWSDK MCP checks in this order:

1. `iwsdk dev status`
2. `xr_get_session_status`
3. `xr_accept_session`
4. `browser_screenshot`
5. `scene_get_hierarchy`
6. `xr_select`
7. `browser_get_console_logs`

Evidence to record:

- Adapter sync command and target config file.
- Resolved runtime URL.
- Managed browser readiness.
- Confirmation that the managed Playwright browser is separate from the normal browser when using `agent` mode.
- Nonblank screenshot.
- Scene hierarchy including every `openclinxr.ed-chest-pain.*` object from the station smoke plan.
- One controller select mapped to the plan's station trace action, initially `ecg_request`.
- Empty warning/error console logs, or explicit blockers.
- 32-tool inventory with exact observed tool names and session, transforms, input mode, select/trigger, gamepad, device state, browser, scene, and ECS category coverage before claiming IWSDK agent-tooling readiness.
- Adversarial visual QA notes for each screenshot/video artifact, including clinical scene fidelity, actor/equipment realism, UI readability, interaction affordances, occlusion, scale, and explicit evidence limits.

`packages/openclinxr/iwsdk-spike` exposes `evaluateIwsdkAgentToolingEvidence()` as the aggregate readiness check for this section. Treat IWSDK agent-tooling readiness as blocked unless that evaluator accepts adapter sync evidence, the 32-tool inventory, observed tool names matching `buildIwsdkMcpToolInventory().allToolNames`, all required MCP categories, the minimal MCP smoke subset, managed-browser evidence, and the optional MCP server action list.

Score a future captured aggregate MCP evidence JSON file with:

```bash
pnpm iwsdk:agent-tooling:evidence -- --input path/to/iwsdk-agent-tooling-evidence.json --output docs/openclinxr/iwsdk-agent-tooling-evidence-YYYY-MM-DD.json
```

Score screenshot-based adversarial visual QA evidence separately with:

```bash
pnpm visual:qa:evidence:validate
```

The current visual QA fixture is `docs/openclinxr/visual-qa-evidence-2026-05-04.json`. It wraps the IWER managed-browser screenshot as an adversarial iteration artifact and requires clinical-scene, actor/equipment, readability, interaction-affordance, occlusion/scale, and evidence-limit notes. A passing visual QA report still has `readyForProductionRuntime: false` and `readyForPhysicalQuestClaim: false`.

The checker exits nonzero until the aggregate evidence is ready, but it does not install IWSDK, modify MCP config, or touch the sidecar app.

Score future phase-2 compatibility evidence with:

```bash
pnpm iwsdk:compatibility:evidence -- --input path/to/iwsdk-compatibility-evidence.json --output docs/openclinxr/iwsdk-compatibility-evidence-YYYY-MM-DD.json
```

The checker exits nonzero until OpenClinXR's Vite major is accepted by the IWSDK Vite plugin peer range, the Node 22 runtime path is recorded, and the Rolldown native binding load is recorded.

Score package metadata drift evidence with:

```bash
pnpm iwsdk:metadata-drift:evidence -- --input path/to/iwsdk-metadata-drift-evidence.json --output docs/openclinxr/iwsdk-metadata-drift-evidence-YYYY-MM-DD.json
```

The checker exits nonzero until package docs and npm latest versions align, or a deliberate exact-pin/source-refresh decision is recorded elsewhere in the policy.

Score a future committed sidecar metrics JSON file with:

```bash
pnpm iwsdk:sidecar:metrics -- --input path/to/iwsdk-sidecar-metrics.json --output docs/openclinxr/iwsdk-sidecar-metrics-YYYY-MM-DD.json
```

This checker uses the same budgets as `packages/openclinxr/iwsdk-spike`: installed footprint, injected dev runtime, app bundle, bundle delta, console errors, foreground Quest preflight readiness, foreground Quest FPS, p95 frame time, and controller-select latency.

Before creating or running any committed sidecar, scan the workspace posture with:

```bash
pnpm iwsdk:workspace:posture
```

When the operator has approved the install-backed sidecar scope, rerun it as:

```bash
pnpm iwsdk:workspace:posture -- --approved-sidecar
```

The checker exits nonzero if IWSDK dependencies or imports leak outside `apps/ui-xr-iwsdk-spike/`, including from the advisory `packages/openclinxr/iwsdk-spike/` policy package; if the sidecar imports or depends on production `apps/ui-xr` internals instead of parity contracts; if a package tries to reach IWSDK through an `npm:@iwsdk/...` alias specifier; if root package-manager controls or `pnpm-workspace.yaml` catalogs reference IWSDK packages; if package scripts attempt blocked actions such as `iwsdk reference warmup`, `pnpm dlx @iwsdk/reference@0.3.2 iwsdk-reference warmup`, `@iwsdk/create`, or `pnpm create @iwsdk`; if IWSDK packages remain in quoted or unquoted lockfile keys after the sidecar app is absent; if blocked packages or sharp/libvips-style blocked transitive packages appear in the lockfile; if the sidecar manifest and `pnpm-lock.yaml` importer are out of sync; if approved exact first-slice sidecar IWSDK dependencies are missing from the lockfile importer; if the sidecar exists without explicit approval; or if required audit/license/Three override controls are missing once the sidecar is approved. Placeholder controls such as `echo pnpm audit` or `true` do not satisfy the audit/license checks.

`packages/openclinxr/iwsdk-spike` also exposes `buildIwsdkOperatorSteeringBlockers()` and `buildIwsdkOperatorApprovalContract()`. `tools/openclinxr/iwsdk-operator-steering-blockers.test.ts` keeps true human-approval blockers mirrored in `operator-steering-needed-questions.md`, currently install-backed sidecar approval and physical Quest foreground frame pacing. The approval contract records Patrick's 2026-05-04 approval for reference warmup scope and `@meta-quest/hzdb` legal/procurement posture, while keeping the exact PNPM warmup path, cache/download evidence, and `hzdb` runtime behavior sidecar-gated.

## Managed Browser Evidence Contract

`packages/openclinxr/iwsdk-spike` exposes `buildIwsdkManagedBrowserEvidenceContract()` and `evaluateIwsdkManagedBrowserEvidence()` so browser-mode claims are scored separately from generic MCP readiness.

Score a captured evidence JSON file with:

```bash
pnpm iwsdk:browser:evidence -- --input path/to/iwsdk-browser-evidence.json --output docs/openclinxr/iwsdk-browser-evidence-YYYY-MM-DD.json
```

The checker exits nonzero when the selected mode's browser evidence is incomplete or contradictory, and prints explicit blockers in JSON.

For `agent` mode, a ready report must record the runtime URL, managed-browser readiness, managed session id, normal browser opened state, normal session id, different managed/normal session ids, fixed screenshot size, managed DevUI off, and normal-browser DevUI on. This preserves the source-backed distinction that unattended agent work happens in a managed headless Playwright browser while manual development can continue in a separate normal browser XR session.

For `oversight` mode, a ready report must record a visible Playwright managed session with DevUI off and no automatic normal browser. For `collaborate` mode, a ready report must record a visible Playwright managed session with DevUI on and no automatic normal browser.

Browser evidence blockers use explicit names such as `managed_browser_not_ready`, `normal_browser_session_not_independent`, `missing_agent_fixed_screenshot_size`, `managed_devui_should_be_off`, and `managed_devui_should_be_on`.

## Still Blocked

- Floating `npx iwsdk reference warmup`
- Committing `pnpm dlx @iwsdk/reference@0.3.2 iwsdk-reference warmup` as a workspace script before CLI help, cache location, and download size are recorded
- Installing `@meta-quest/hzdb` outside an approved IWSDK sidecar
- Treating optional `iwsdk-reference` or `hzdb` MCP servers as normal unattended dependencies
- Adopting `@iwsdk/vite-plugin-gltf-optimizer` in production builds
- Claiming Quest frame pacing from MCP emulation alone

## Required Follow-Up

Physical Quest 3 validation remains mandatory before production-runtime adoption. The IWSDK MCP lane can accelerate local iteration, but it cannot prove headset frame pacing, comfort, controller behavior, thermal behavior, or readable in-headset text.
