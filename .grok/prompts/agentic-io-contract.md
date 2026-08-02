# Agentic I/O contract (OpenClinXR / Grok)

Shared final-message shape for subagents reporting to a parent orchestrator or chief-coordinator.
Adapted from atlantis-cameras-v2 agent-ops FINAL contract; kept short for LOW_TOKEN.

## FINAL message (always)

```text
STATUS: ok|partial|blocked
VERDICT: <role-specific vocabulary>
SUMMARY: ≤2 lines
## artifacts
- path/to/file (if any)
## deltas
- what changed (if any)
## residuals
- blockers / human needed (or none)
```

## Rules

1. **Reader is the parent agent**, not a human prose essay. Keep structure machine-parseable.
2. Prefer **paths + file:line** over narrative.
3. Subagents **do not spawn children** unless explicitly allowed; escalate via parent.
4. **CLI-first** for barriers (`docs/TOOLING.md`): `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor`. Do not call disabled MCPs.
5. On tool/model constraints that block delivery, emit `CAPABILITY_CONSTRAINT` and point parent to `docs/agent-ops/capability-requests/TEMPLATE.md` (hrbp owns triage).
6. Do not self-edit agent frontmatter unless you are **hrbp** with an approved roster revision.
