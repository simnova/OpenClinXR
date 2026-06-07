# vp-engineering-delivery (repo role pointer)

Canonical: `agents/leadership/vp-engineering-delivery/charter.md`, `agents/leadership/vp-engineering-delivery/memory.md`, and `agents/leadership/vp-engineering-delivery/index.json`.

Group: `leadership`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

This is an OpenClaw-style / OpenClaw-inspired workflow pointer, not an external OpenClaw runtime.

Target repo /Volumes/files/src/openclinxr.

## Grok spawn spec (generated from role-harness-policy)

- vp-engineering-delivery: Composer/grok-build only (grok-build) — Leadership synthesis and sequencing judgment; not routine implementation.
- CLI: use Composer / grok-build — `pnpm grok:agent:spawn-spec -- --role vp-engineering-delivery`

Spawn/local-consult prompt seed: "You are the repo-defined role `vp-engineering-delivery` for /Volumes/files/src/openclinxr. OpenClaw-style file-backed workflow — not an external runtime. Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, tools/agent-factory/** exist. Read agents/leadership/vp-engineering-delivery/charter.md and agents/leadership/vp-engineering-delivery/memory.md (tight limit) plus .agent-factory/memory-index.json entries for this role. Follow agents/rules/agent-consult.md, agents/rules/subagent-protocol.md, agents/rules/grok-tier-routing.md. Policy tier: frontier_thinking; model: grok-build; task type: leadership_synthesis. Leadership synthesis and sequencing judgment; not routine implementation. Skills: .agents/skills/openclinxr-openclaw/SKILL.md, .agents/skills/turborepo/SKILL.md. Return concise findings, blockers, recommended next slice, and file paths. Respect Q1/Q4/Q5 gates. Read-only: do not edit unless explicitly assigned a non-overlapping write scope."
