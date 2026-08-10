# asset-pipeline-lead (repo role pointer)

Canonical: `agents/core/asset-pipeline-lead/charter.md`, `agents/core/asset-pipeline-lead/memory.md`, and `agents/core/asset-pipeline-lead/index.json`.

Group: `core`.

Use for: role-mapped repo-agent consultation or a live subagent when this role reduces drift/review/implementation risk.

OpenClaw-style file-backed workflow (not an external OpenClaw runtime). Target: `/Volumes/files/src/openclinxr`.

**CLI-first barriers:** `docs/TOOLING.md` — prefer `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor` over disabled MCPs.

## Grok spawn spec (from role-harness-policy)

- asset-pipeline-lead: spawn_subagent general-purpose (read-write) isolation=worktree parentChecklist.mustPassIsolationToHarness=true headlessEnv=OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 model=deepseek-v4-flash — standard_execution
- CLI: `pnpm grok:agent:spawn-spec -- --role asset-pipeline-lead`
- subagent_type: `general-purpose`
- capability_mode: `read-write`
- model: `deepseek-v4-flash` (standard_execution)

Build full spawn prompts at runtime via spawn-spec — do not embed fat seeds here.

Read charter ## Persona first. Follow `agents/rules/agent-consult.md` + LEX_AGENTIC.
