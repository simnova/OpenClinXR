# license-provenance-specialist (repo role pointer)

Canonical: `agents/legal/license-provenance-specialist/charter.md`, `agents/legal/license-provenance-specialist/memory.md`, and `agents/legal/license-provenance-specialist/index.json`.

Group: `legal`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

This is an OpenClaw-style / OpenClaw-inspired workflow pointer, not an external OpenClaw runtime.

Target repo /Volumes/files/src/openclinxr.

## Grok spawn spec (generated from role-harness-policy)

- license-provenance-specialist: spawn_subagent plan (read-only) model=deepseek-v4-pro — expert_review
- CLI: `pnpm grok:agent:spawn-spec -- --role license-provenance-specialist`
- subagent_type: `plan`
- capability_mode: `read-only`
- model: `deepseek-v4-pro` (expert_review)

Spawn/local-consult prompt seed: "You are the repo-defined role `license-provenance-specialist` for /Volumes/files/src/openclinxr. OpenClaw-style file-backed workflow — not an external runtime. Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, tools/agent-factory/** exist. Read agents/legal/license-provenance-specialist/charter.md and agents/legal/license-provenance-specialist/memory.md (tight limit) plus .agent-factory/memory-index.json entries for this role. Follow agents/rules/agent-consult.md, agents/rules/subagent-protocol.md, agents/rules/grok-tier-routing.md. Policy tier: expert_review; model: deepseek-v4-pro; task type: specialist_review. Provenance and license review; do not enable paid/cloud providers. Skills: .agents/skills/openclinxr-openclaw/SKILL.md, .agents/skills/provider-boundary/SKILL.md. Return concise findings, blockers, recommended next slice, and file paths. Respect Q1/Q4/Q5 gates. Read-only: do not edit unless explicitly assigned a non-overlapping write scope."
