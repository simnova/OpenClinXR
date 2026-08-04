# Tooling topology (architect map)

**Owner:** architect (topology map) · **CLI-first policy SSOT:** `docs/TOOLING.md` · **Capability process:** `docs/agent-ops/CAPABILITY-EVOLUTION.md`  
**Status:** Living reference — keep concise; detail lives in TOOLING.md + env-doctor `mcpCliMatrix`  
**Established:** 2026-08-04

## Principle

Prefer **shell CLIs** over always-on MCP schemas. Agents remove barriers with one-liners (`pnpm env:doctor`, `gh`, `pnpm playwright:*`, `pnpm browser:agent`). Optional MCP only when no CLI path exists (diagrams, live Atlas agent work).

## Surface map

| Need | Prefer (CLI / surface) | MCP posture | Change owner |
|------|------------------------|-------------|--------------|
| **Toolchain** (mise, node, pnpm, PATH, LSP bins) | `pnpm env:doctor` / `mise` / `mise run doctor` | **Do not add** mise MCP | architect + implementer (env-doctor); hrbp if agent prompts cite wrong tools |
| **GitHub** | `pnpm gh:status` / `gh pr` / `gh issue` / `gh api` | **`grok_com_github` disabled** | hrbp (prompts); parent for PR publish policy |
| **Browser evidence** | `pnpm playwright:*` / `pnpm browser:agent` / `agent-browser <cmd>` | **`playwright`**, **`chrome-devtools`**, **`agent-browser` MCP disabled** | xr / evidence implementers; hrbp for re-enable requests |
| **Diagrams** | — (no CLI parity) | **`drawio` MCP** optional (user) when in diagram session | architect / diagram owner |
| **Mongo / Atlas agent** | `mongosh` + evidence scripts first | **`mongodb` MCP** optional (user plugin) for active Atlas agent work | data / persistence owners; hrbp for enable |
| **Commit / promote** | worktree commit authority + `pnpm openclaw:worktree:promote` | n/a | hrbp (COMMIT-AUTHORITY); parent promote |

## Disabled MCP vs CLI (summary)

| Disabled / avoid | Use instead |
|------------------|-------------|
| `playwright` MCP | `pnpm playwright:codegen` / `playwright:test` / `playwright:help` |
| `chrome-devtools` MCP (+ plugin removed) | playwright / `pnpm browser:agent` / evidence scripts |
| `agent-browser` MCP | `pnpm browser:agent` / CLI |
| `grok_com_github` | `gh` / `pnpm gh:status` |
| mise MCP | `pnpm env:doctor` / `mise` |

Config hooks and re-enable criteria: **`docs/TOOLING.md`** § MCP → CLI. Runtime matrix: `pnpm env:doctor` → JSON `mcpCliMatrix`.

## Who owns what

| Concern | R | A | Notes |
|---------|---|---|--------|
| CLI-first matrix text + doctor | implementer (tools) | architect (topology) | Must stay aligned with TOOLING.md |
| Agent defs / prompts citing tools | hrbp | hrbp | Spot-check after MCP/CLI policy change (`REVIEW-CADENCE.md`) |
| Re-enable MCP / new skill / model tier | hrbp triage | human (paid/secrets) | File `capability-requests/` per CAPABILITY-EVOLUTION |
| Composition of packages vs apps | architect | architect | `COMPOSITION-ROOTS.md` — not this file |

## Agent rule (one liner)

Run `pnpm env:doctor` for toolchain; use package scripts for browsers/GitHub; do **not** load disabled MCP schemas when a CLI one-liner works. Escalate missing capability via CAPABILITY-EVOLUTION — do not silently re-enable MCP.

## Related

- `docs/TOOLING.md` — pins, env doctor, full MCP→CLI table  
- `docs/agent-ops/CAPABILITY-EVOLUTION.md` — residual path  
- `docs/agent-ops/COMMIT-AUTHORITY.md` — worktree commit vs promote  
- `docs/agent-ops/RACI.md` — CLI-first MCP policy row  
