# Repo-defined agent role pointers

Canonical role definitions live under root `agents/**` with `charter.md`, `memory.md`, and `index.json`.

These files are safe harness-local pointers only. They do not duplicate role memory or replace the source-of-truth order in `AGENTS.md`.

This repo uses an OpenClaw-style / OpenClaw-inspired file-backed workflow, not an external OpenClaw runtime.

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

For Codex, sibling `.toml` files are native project custom-agent definitions; the Markdown files remain lightweight human/cross-harness pointers.
