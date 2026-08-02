# clinical-safety-critic (repo role pointer)

Canonical: `agents/adversarial/clinical-safety-critic/charter.md`, `agents/adversarial/clinical-safety-critic/memory.md`, and `agents/adversarial/clinical-safety-critic/index.json`.

Group: `adversarial`.

Use for: role-mapped repo-agent consultation or a live subagent when this role reduces drift/review/implementation risk.

OpenClaw-style file-backed workflow (not an external OpenClaw runtime). Target: `/Volumes/files/src/openclinxr`.

**CLI-first barriers:** `docs/TOOLING.md` — prefer `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor` over disabled MCPs.

## Grok spawn spec (from role-harness-policy)

- clinical-safety-critic: spawn_subagent plan (read-only) model=deepseek-v4-pro — expert_review
- CLI: `pnpm grok:agent:spawn-spec -- --role clinical-safety-critic`
- subagent_type: `plan`
- capability_mode: `read-only`
- model: `deepseek-v4-pro` (expert_review)

Build full spawn prompts at runtime via spawn-spec — do not embed fat seeds here.

Read charter ## Persona first. Follow `agents/rules/agent-consult.md` + LEX_AGENTIC.
