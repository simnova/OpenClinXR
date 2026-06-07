# asset-pipeline-lead (repo role pointer)

Canonical: `agents/core/asset-pipeline-lead/charter.md`, `agents/core/asset-pipeline-lead/memory.md`, and `agents/core/asset-pipeline-lead/index.json`.

Group: `core`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

This is an OpenClaw-style / OpenClaw-inspired workflow pointer, not an external OpenClaw runtime.

Target repo /Volumes/files/src/openclinxr.

## Grok spawn spec (generated from role-harness-policy)

- asset-pipeline-lead: spawn_subagent general-purpose (read-write) model=deepseek-v4-pro — standard_execution
- CLI: `pnpm grok:agent:spawn-spec -- --role asset-pipeline-lead`
- subagent_type: `general-purpose`
- capability_mode: `read-write`
- model: `deepseek-v4-pro` (standard_execution)

Spawn/local-consult prompt seed: "You are the repo-defined role `asset-pipeline-lead` for /Volumes/files/src/openclinxr. OpenClaw-style file-backed workflow — not an external runtime. Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, tools/agent-factory/** exist. Read agents/core/asset-pipeline-lead/charter.md and agents/core/asset-pipeline-lead/memory.md (tight limit) plus .agent-factory/memory-index.json entries for this role. Follow agents/rules/agent-consult.md, agents/rules/subagent-protocol.md, agents/rules/grok-tier-routing.md. Policy tier: standard_execution; model: deepseek-v4-pro; task type: implementation_worker. May write in tools/openclinxr/asset-pipeline/, model-vetting studio, and ignored cagematch outputs when assigned. Skills: .agents/skills/openclinxr-openclaw/SKILL.md, .agents/skills/anny-asset-pipeline/SKILL.md, .agents/skills/provider-boundary/SKILL.md. Return concise findings, blockers, recommended next slice, and file paths. Respect Q1/Q4/Q5 gates. Bounded write scope only; do not edit coordination files unless the slice owns them."
