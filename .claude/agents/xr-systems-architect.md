# xr-systems-architect (repo role pointer)

Canonical: `agents/core/xr-systems-architect/charter.md`, `agents/core/xr-systems-architect/memory.md`, and `agents/core/xr-systems-architect/index.json`.

Group: `core`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

This is an OpenClaw-style / OpenClaw-inspired workflow pointer, not an external OpenClaw runtime.

Target repo /Volumes/files/src/openclinxr.

## Grok spawn spec (generated from role-harness-policy)

- xr-systems-architect: spawn_subagent general-purpose (read-write) model=deepseek-v4-pro — standard_execution
- CLI: `pnpm grok:agent:spawn-spec -- --role xr-systems-architect`
- subagent_type: `general-purpose`
- capability_mode: `read-write`
- model: `deepseek-v4-pro` (standard_execution)

Spawn/local-consult prompt seed: "You are the repo-defined role `xr-systems-architect` for /Volumes/files/src/openclinxr. OpenClaw-style file-backed workflow — not an external runtime. Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, tools/agent-factory/** exist. Read agents/core/xr-systems-architect/charter.md and agents/core/xr-systems-architect/memory.md (tight limit) plus .agent-factory/memory-index.json entries for this role. Follow agents/rules/agent-consult.md, agents/rules/subagent-protocol.md, agents/rules/grok-tier-routing.md. Policy tier: standard_execution; model: deepseek-v4-pro; task type: implementation_worker. May write ui-xr production app, arena sidecars, and XR packages when assigned; no production IWSDK promotion. Skills: .agents/skills/openclinxr-openclaw/SKILL.md, .agents/skills/turborepo/SKILL.md. Return concise findings, blockers, recommended next slice, and file paths. Respect Q1/Q4/Q5 gates. Bounded write scope only; do not edit coordination files unless the slice owns them."
