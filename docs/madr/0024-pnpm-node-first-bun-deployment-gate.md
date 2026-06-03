# MADR 0024: Use pnpm And Node Locally Until Bun Is Installed And Benchmarked

Status: Accepted for planning
Date: 2026-05-03

## Context

Prior technology plans favored Bun/Hono. The local hardware spike found Node, npm, pnpm, and yarn installed, but Bun is not installed.

## Decision

Use pnpm and Node-compatible Hono development scripts for the first implementation plan. Keep Bun as the intended deployment/runtime candidate after a local install and WebSocket benchmark gate.

## Consequences

Positive:

- Developers can start immediately on the current machine.
- Hono remains the API framework.
- Bun adoption remains deliberate and measured.

Negative:

- Node local behavior may differ from Bun deployment behavior.
- Bun WebSocket performance remains evidence debt until installed and benchmarked.

## Reversal Trigger

Switch local default to Bun after Bun install, Hono API tests, WebSocket echo tests, and CI compatibility pass.

## Sources

- `src-local-hardware-spike-2026-05-03`
- `src-npm-stack-metadata-2026-05-03`
