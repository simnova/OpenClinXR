# visual-realism-adversary (repo role pointer)

Canonical: `agents/adversarial/visual-realism-adversary/charter.md`, `agents/adversarial/visual-realism-adversary/memory.md`, and `agents/adversarial/visual-realism-adversary/index.json`.

Group: `adversarial`.

Use for: role-mapped repo-agent consultation or a live subagent when this role reduces drift/review/implementation risk.

OpenClaw-style file-backed workflow (not an external OpenClaw runtime). Target: `/Volumes/files/src/openclinxr`.

**CLI-first barriers:** `docs/TOOLING.md` — prefer `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor` over disabled MCPs.

## Grok spawn spec (from role-harness-policy)

- visual-realism-adversary: spawn_subagent explore (read-only) model=deepseek-v4-flash-vision-exp — fast_bounded
- CLI: `pnpm grok:agent:spawn-spec -- --role visual-realism-adversary`
- subagent_type: `explore`
- capability_mode: `read-only`
- model: `deepseek-v4-flash-vision-exp` (fast_bounded)

Build full spawn prompts at runtime via spawn-spec — do not embed fat seeds here.

Read charter ## Persona first. Follow `agents/rules/agent-consult.md` + LEX_AGENTIC.
