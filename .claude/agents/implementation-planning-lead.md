# implementation-planning-lead (repo role pointer)

Canonical: `agents/core/implementation-planning-lead/charter.md`, `agents/core/implementation-planning-lead/memory.md`, and `agents/core/implementation-planning-lead/index.json`.

Group: `core`.

Use for: role-mapped repo-agent consultation or a live subagent when this role reduces drift/review/implementation risk.

OpenClaw-style file-backed workflow (not an external OpenClaw runtime). Target: `/Volumes/files/src/openclinxr`.

**CLI-first barriers:** `docs/TOOLING.md` — prefer `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor` over disabled MCPs.

## Grok spawn spec (from role-harness-policy)

- implementation-planning-lead: spawn_subagent plan (read-only) model=deepseek-v4-flash — standard_execution
- CLI: `pnpm grok:agent:spawn-spec -- --role implementation-planning-lead`
- subagent_type: `plan`
- capability_mode: `read-only`
- model: `deepseek-v4-flash` (standard_execution)

Build full spawn prompts at runtime via spawn-spec — do not embed fat seeds here.

Read charter ## Persona first. Follow `agents/rules/agent-consult.md` + LEX_AGENTIC.
