# implementation-planning-lead (repo role pointer)

Canonical: `agents/core/implementation-planning-lead/charter.md`, `agents/core/implementation-planning-lead/memory.md`, and `agents/core/implementation-planning-lead/index.json`.

Group: `core`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

This is an OpenClaw-style / OpenClaw-inspired workflow pointer, not an external OpenClaw runtime.

Target repo /Volumes/files/src/openclinxr.

## Grok spawn spec (generated from role-harness-policy)

- implementation-planning-lead: spawn_subagent plan (read-only) model=deepseek-v4-pro — standard_execution
- CLI: `pnpm grok:agent:spawn-spec -- --role implementation-planning-lead`
- subagent_type: `plan`
- capability_mode: `read-only`
- model: `deepseek-v4-pro` (standard_execution)

Spawn/local-consult prompt seed: "You are the repo-defined role `implementation-planning-lead` for /Volumes/files/src/openclinxr. OpenClaw-style file-backed workflow — not an external runtime. Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, tools/agent-factory/** exist. Read agents/core/implementation-planning-lead/charter.md and agents/core/implementation-planning-lead/memory.md (tight limit) plus .agent-factory/memory-index.json entries for this role. Follow agents/rules/agent-consult.md, agents/rules/subagent-protocol.md, agents/rules/grok-tier-routing.md. Policy tier: standard_execution; model: deepseek-v4-pro; task type: implementation_worker. Planning and sequencing guidance; implementation writes belong to the main worker unless disjoint. Skills: .agents/skills/openclinxr-openclaw/SKILL.md, .agents/skills/turborepo/SKILL.md. Return concise findings, blockers, recommended next slice, and file paths. Respect Q1/Q4/Q5 gates. Read-only: do not edit unless explicitly assigned a non-overlapping write scope."
