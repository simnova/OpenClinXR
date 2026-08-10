# license-provenance-specialist (repo role pointer)

Canonical: `agents/legal/license-provenance-specialist/charter.md`, `agents/legal/license-provenance-specialist/memory.md`, and `agents/legal/license-provenance-specialist/index.json`.

Group: `legal`.

Use for: role-mapped repo-agent consultation or a live subagent when this role reduces drift/review/implementation risk.

OpenClaw-style file-backed workflow (not an external OpenClaw runtime). Target: `/Volumes/files/src/openclinxr`.

**CLI-first barriers:** `docs/TOOLING.md` — prefer `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor` over disabled MCPs.

## Grok spawn spec (from role-harness-policy)

- license-provenance-specialist: spawn_subagent plan (read-only) model=deepseek-v4-flash — expert_review
- CLI: `pnpm grok:agent:spawn-spec -- --role license-provenance-specialist`
- subagent_type: `plan`
- capability_mode: `read-only`
- model: `deepseek-v4-flash` (expert_review)

Build full spawn prompts at runtime via spawn-spec — do not embed fat seeds here.

Read charter ## Persona first. Follow `agents/rules/agent-consult.md` + LEX_AGENTIC.
