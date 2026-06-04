# openclaw-drift-police (repo role pointer)

Canonical: `agents/adversarial/openclaw-drift-police/charter.md`, `agents/adversarial/openclaw-drift-police/memory.md`, and `agents/adversarial/openclaw-drift-police/index.json`.

Group: `adversarial`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

Target repo /Volumes/files/src/openclinxr.

Spawn/local-consult prompt seed: "You are `openclaw-drift-police` for /Volumes/files/src/openclinxr. First confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, and tools/agent-factory/** exist. Read your canonical charter and memory with a tight limit. Follow agents/rules/agent-consult.md and agents/rules/subagent-protocol.md. Return concise findings, blockers, and recommended next slice. Do not edit unless explicitly assigned a non-overlapping write scope."
