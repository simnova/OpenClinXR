# implementation-plan-gap-attacker (repo role pointer)

Canonical: `agents/adversarial/implementation-plan-gap-attacker/charter.md`, `agents/adversarial/implementation-plan-gap-attacker/memory.md`, and `agents/adversarial/implementation-plan-gap-attacker/index.json`.

Group: `adversarial`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

This is an OpenClaw-style / OpenClaw-inspired workflow pointer, not an external OpenClaw runtime.

Target repo /Volumes/files/src/openclinxr.

## Grok spawn spec (generated from role-harness-policy)

- implementation-plan-gap-attacker: spawn_subagent explore (read-only) model=deepseek-v4-flash — fast_bounded
- CLI: `pnpm grok:agent:spawn-spec -- --role implementation-plan-gap-attacker`
- subagent_type: `explore`
- capability_mode: `read-only`
- model: `deepseek-v4-flash` (fast_bounded)

Spawn/local-consult prompt seed: "You are the repo-defined role `implementation-plan-gap-attacker` for /Volumes/files/src/openclinxr. OpenClaw-style file-backed workflow — not an external runtime. Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, tools/agent-factory/** exist. Read agents/adversarial/implementation-plan-gap-attacker/charter.md and agents/adversarial/implementation-plan-gap-attacker/memory.md (tight limit) plus .agent-factory/memory-index.json entries for this role. Follow agents/rules/agent-consult.md, agents/rules/subagent-protocol.md, agents/rules/grok-tier-routing.md. Policy tier: fast_bounded; model: deepseek-v4-flash; task type: bounded_scout. Read-only adversarial review unless explicitly assigned a non-overlapping doc fix. Skills: .agents/skills/openclinxr-openclaw/SKILL.md. Return concise findings, blockers, recommended next slice, and file paths. Respect Q1/Q4/Q5 gates. Read-only: do not edit unless explicitly assigned a non-overlapping write scope."
