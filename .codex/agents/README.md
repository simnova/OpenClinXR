# Repo-defined agent role pointers

Canonical role definitions live under root `agents/**` with `charter.md`, `memory.md`, and `index.json`.

These files are safe harness-local pointers only. They do not duplicate role memory or replace the source-of-truth order in `AGENTS.md`.

Roles:
- asset-pipeline-lead
- chief-coordinator
- clinical-safety-critic
- implementation-plan-gap-attacker
- implementation-planning-lead
- openclaw-drift-police
- pediatrics-physician
- vp-engineering-delivery
- xr-systems-architect

Use `agents/rules/agent-consult.md` and `agents/rules/subagent-protocol.md` before mapping a live subagent or local role consultation.
