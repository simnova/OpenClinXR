# IWSDK Codex MCP Runbook

Date: 2026-05-04
Status: Advisory, do not execute until an isolated IWSDK sidecar app is approved

## Purpose

This runbook defines how Codex should evaluate Meta Immersive Web SDK MCP tooling after, and only after, a committed sidecar app exists at `apps/ui-xr-iwsdk-spike` with exact package versions and accepted license posture.

This runbook does not install IWSDK, does not modify `.codex/config.toml`, does not warm the IWSDK reference corpus, and does not replace physical Quest 3 validation.

Current state: contract only. Do not create a no-install `apps/ui-xr-iwsdk-spike` scaffold, because that would look like runtime progress while proving no IWSDK behavior.

## Preconditions

- `pnpm iwsdk:verify` passes, including its default `pnpm iwsdk:preinstall` JSON preflight.
- `evaluateIwsdkPreInstallPackageSelection()` reports no blockers for the proposed IWSDK sidecar dependency list before any `pnpm add` changes the workspace lockfile.
- `pnpm iwsdk:preinstall -- --proposal path/to/proposal.json` records a ready JSON verdict for the exact package proposal, including required package-manager controls.
- `apps/ui-xr-iwsdk-spike` exists and is intentionally outside production runtime paths.
- IWSDK dependencies are exact-versioned in the sidecar app.
- `@iwsdk/reference`, `@meta-quest/hzdb`, and production adoption of `@iwsdk/vite-plugin-gltf-optimizer` remain blocked unless the policy is deliberately changed.
- The sidecar app has recorded installed footprint, injected dev runtime size, JS bundle size, console errors, and bundle delta versus `apps/ui-xr`.

## Codex MCP Template

`packages/openclinxr/iwsdk-spike` exposes `buildIwsdkCodexMcpAdapterTemplate()` as the source of truth for the local adapter template.

The package-level runbook also records `adapterSyncCommand = "iwsdk adapter sync"`. Run that only after the sidecar app and exact packages are approved, then keep the resulting local MCP config reversible.

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

Default to IWSDK `agent` mode for unattended Codex checks: headless fixed viewport, DevUI off, and a separate normal browser for manual development. Use `oversight` mode only when Patrick or a developer needs to watch the Playwright browser directly. Use `collaborate` mode only for hands-on controller, hand, or spatial UI tuning after the sidecar shell is stable.

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
- Scene hierarchy including named station objects.
- One controller select mapped to a station trace action.
- Empty warning/error console logs, or explicit blockers.
- 32-tool inventory with session, transforms, input, browser, scene, and ECS category coverage before claiming IWSDK agent-tooling readiness.

## Managed Browser Evidence Contract

`packages/openclinxr/iwsdk-spike` exposes `buildIwsdkManagedBrowserEvidenceContract()` and `evaluateIwsdkManagedBrowserEvidence()` so browser-mode claims are scored separately from generic MCP readiness.

For `agent` mode, a ready report must record the runtime URL, managed-browser readiness, managed session id, normal browser opened state, normal session id, different managed/normal session ids, fixed screenshot size, managed DevUI off, and normal-browser DevUI on. This preserves the source-backed distinction that unattended agent work happens in a managed headless Playwright browser while manual development can continue in a separate normal browser XR session.

For `oversight` mode, a ready report must record a visible Playwright managed session with DevUI off and no automatic normal browser. For `collaborate` mode, a ready report must record a visible Playwright managed session with DevUI on and no automatic normal browser.

Browser evidence blockers use explicit names such as `managed_browser_not_ready`, `normal_browser_session_not_independent`, `missing_agent_fixed_screenshot_size`, `managed_devui_should_be_off`, and `managed_devui_should_be_on`.

## Still Blocked

- `npx iwsdk reference warmup`
- Installing `@meta-quest/hzdb`
- Treating optional `iwsdk-reference` or `hzdb` MCP servers as normal unattended dependencies
- Adopting `@iwsdk/vite-plugin-gltf-optimizer` in production builds
- Claiming Quest frame pacing from MCP emulation alone

## Required Follow-Up

Physical Quest 3 validation remains mandatory before production-runtime adoption. The IWSDK MCP lane can accelerate local iteration, but it cannot prove headset frame pacing, comfort, controller behavior, thermal behavior, or readable in-headset text.
