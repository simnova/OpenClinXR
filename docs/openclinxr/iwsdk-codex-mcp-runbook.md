# IWSDK Codex MCP Runbook

Date: 2026-05-04
Status: Advisory, do not execute until an isolated IWSDK sidecar app is approved

## Purpose

This runbook defines how Codex should evaluate Meta Immersive Web SDK MCP tooling after, and only after, a committed sidecar app exists at `apps/ui-xr-iwsdk-spike` with exact package versions and accepted license posture.

This runbook does not install IWSDK, does not modify `.codex/config.toml`, does not warm the IWSDK reference corpus, and does not replace physical Quest 3 validation.

Current state: contract only. Do not create a no-install `apps/ui-xr-iwsdk-spike` scaffold, because that would look like runtime progress while proving no IWSDK behavior.

## Preconditions

- `pnpm iwsdk:verify` passes.
- `evaluateIwsdkPreInstallPackageSelection()` reports no blockers for the proposed IWSDK sidecar dependency list before any `pnpm add` changes the workspace lockfile.
- `apps/ui-xr-iwsdk-spike` exists and is intentionally outside production runtime paths.
- IWSDK dependencies are exact-versioned in the sidecar app.
- `@iwsdk/reference`, `@meta-quest/hzdb`, and production adoption of `@iwsdk/vite-plugin-gltf-optimizer` remain blocked unless the policy is deliberately changed.
- The sidecar app has recorded installed footprint, injected dev runtime size, JS bundle size, console errors, and bundle delta versus `apps/ui-xr`.

## Codex MCP Template

`packages/openclinxr/iwsdk-spike` exposes `buildIwsdkCodexMcpAdapterTemplate()` as the source of truth for the local adapter template.

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

Run IWSDK MCP checks in this order:

1. `iwsdk dev status`
2. `xr_get_session_status`
3. `xr_accept_session`
4. `browser_screenshot`
5. `scene_get_hierarchy`
6. `xr_select`
7. `browser_get_console_logs`

Evidence to record:

- Resolved runtime URL.
- Managed browser readiness.
- Nonblank screenshot.
- Scene hierarchy including named station objects.
- One controller select mapped to a station trace action.
- Empty warning/error console logs, or explicit blockers.

## Still Blocked

- `npx iwsdk reference warmup`
- Installing `@meta-quest/hzdb`
- Adopting `@iwsdk/vite-plugin-gltf-optimizer` in production builds
- Claiming Quest frame pacing from MCP emulation alone

## Required Follow-Up

Physical Quest 3 validation remains mandatory before production-runtime adoption. The IWSDK MCP lane can accelerate local iteration, but it cannot prove headset frame pacing, comfort, controller behavior, thermal behavior, or readable in-headset text.
