# Repo-defined agent roles (multi-harness)

Canonical mission/memory: root `agents/**` (`charter.md`, `memory.md`, `index.json`).

| Harness | Generated form |
|---------|----------------|
| **`.grok/agents/*.md`** | **Grok-native** YAML frontmatter (`name`, `description`, `disallowedTools`, `mcpInheritance: none`) per user-guide 16-subagents — not fat spawn seeds |
| **`.claude` / `.cursor`** | Lightweight pointers |
| **`.codex`** | Pointers + native `.toml` from `role-harness-policy.ts` |

**CLI-first MCP policy:** `docs/TOOLING.md` + `pnpm env:doctor`. Roster governance: **hrbp** + `docs/agent-ops/`.

Roles:
- architect
- archivist
- asset-pipeline-lead
- chief-coordinator
- clinical-safety-critic
- hrbp
- implementation-plan-gap-attacker
- implementation-planning-lead
- license-provenance-specialist
- openclaw-drift-police
- pediatrics-physician
- pmo
- productivity-skeptic
- rigging-animation-specialist
- visual-realism-adversary
- vp-engineering-delivery
- xr-systems-architect

Use `agents/rules/agent-consult.md`, `PROTO_SUBAGENT`, `LEX_AGENTIC`. Regenerate: `pnpm agent:harness:sync`.
