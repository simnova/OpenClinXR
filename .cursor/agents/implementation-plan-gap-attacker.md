# implementation-plan-gap-attacker (repo role pointer)

Canonical: `agents/adversarial/implementation-plan-gap-attacker/charter.md`, `agents/adversarial/implementation-plan-gap-attacker/memory.md`, and `agents/adversarial/implementation-plan-gap-attacker/index.json`.

Group: `adversarial`.

Use for: role-mapped repo-agent consultation or a live subagent when this role reduces drift/review/implementation risk.

OpenClaw-style file-backed workflow (not an external OpenClaw runtime). Target: `/Volumes/files/src/openclinxr`.

**CLI-first barriers:** `docs/TOOLING.md` — prefer `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor` over disabled MCPs.

## Grok spawn spec (from role-harness-policy)

- implementation-plan-gap-attacker: spawn_subagent explore (read-only) model=deepseek-v4-flash — fast_bounded
- CLI: `pnpm grok:agent:spawn-spec -- --role implementation-plan-gap-attacker`
- subagent_type: `explore`
- capability_mode: `read-only`
- model: `deepseek-v4-flash` (fast_bounded)

Build full spawn prompts at runtime via spawn-spec — do not embed fat seeds here.

Read charter ## Persona first. Follow `agents/rules/agent-consult.md` + LEX_AGENTIC.
