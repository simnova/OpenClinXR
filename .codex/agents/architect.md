# architect (repo role pointer)

Canonical: `agents/core/architect/charter.md`, `agents/core/architect/memory.md`, and `agents/core/architect/index.json`.

Group: `core`.

Use for: role-mapped repo-agent consultation or a live subagent when this role reduces drift/review/implementation risk.

OpenClaw-style file-backed workflow (not an external OpenClaw runtime). Target: `/Volumes/files/src/openclinxr`.

**CLI-first barriers:** `docs/TOOLING.md` — prefer `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor` over disabled MCPs.

## Grok spawn spec (from role-harness-policy)

- architect: spawn_subagent general-purpose (read-write) isolation=worktree parentChecklist.mustPassIsolationToHarness=true headlessEnv=OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 model=deepseek-v4-flash — standard_execution
- CLI: `pnpm grok:agent:spawn-spec -- --role architect`
- subagent_type: `general-purpose`
- capability_mode: `read-write`
- model: `deepseek-v4-flash` (standard_execution)

Build full spawn prompts at runtime via spawn-spec — do not embed fat seeds here.

Read charter ## Persona first. Follow `agents/rules/agent-consult.md` + LEX_AGENTIC.
