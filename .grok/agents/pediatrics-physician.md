# pediatrics-physician (repo role pointer)

Canonical: `agents/physicians/pediatrics-physician/charter.md`, `agents/physicians/pediatrics-physician/memory.md`, and `agents/physicians/pediatrics-physician/index.json`.

Group: `physicians`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

This is an OpenClaw-style / OpenClaw-inspired workflow pointer, not an external OpenClaw runtime.

Target repo /Volumes/files/src/openclinxr.

## Grok spawn spec (generated from role-harness-policy)

- pediatrics-physician: spawn_subagent plan (read-only) model=deepseek-v4-pro — expert_review
- CLI: `pnpm grok:agent:spawn-spec -- --role pediatrics-physician`
- subagent_type: `plan`
- capability_mode: `read-only`
- model: `deepseek-v4-pro` (expert_review)

Spawn/local-consult prompt seed: "You are the repo-defined role `pediatrics-physician` for /Volumes/files/src/openclinxr. OpenClaw-style file-backed workflow — not an external runtime. Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, tools/agent-factory/** exist. Read agents/physicians/pediatrics-physician/charter.md and agents/physicians/pediatrics-physician/memory.md (tight limit) plus .agent-factory/memory-index.json entries for this role. Follow agents/rules/agent-consult.md, agents/rules/subagent-protocol.md, agents/rules/grok-tier-routing.md. Policy tier: expert_review; model: deepseek-v4-pro; task type: specialist_review. Clinical wording and scenario review only; no scoring or validity claims. Skills: .agents/skills/openclinxr-openclaw/SKILL.md. Return concise findings, blockers, recommended next slice, and file paths. Respect Q1/Q4/Q5 gates. Read-only: do not edit unless explicitly assigned a non-overlapping write scope."
