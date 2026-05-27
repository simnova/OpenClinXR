# OpenClinXR Documentation Navigation

This directory contains product references, evidence, gates, and historical notes. Agents must not treat every Markdown file here as equally authoritative.

## Start Here

1. `../../AGENTS.md` - repo operating contract and protected guardrails.
2. `../../PROJECT_COORDINATION_INDEX.md` - current coordinator dashboard and active product queue.
3. `../../AUTONOMOUS_WORK_PLAN.md` - active queue handoff and slice ledger.
4. `worker-backlog-and-validation-matrix.md` - worker ownership and validation map.
5. `blueprint-factory-drift-guardrails-2026-05-27.md` - protected blueprint-factory/conversation-tooling guardrails.
6. `codex-openclaw-operating-bridge-2026-05-27.md` - Codex/OpenClaw execution-mode bridge.
7. `doc-authority-registry-2026-05-27.md` - generated authority map for Markdown files.
8. `generated-artifact-registry-2026-05-27.md` - generated cleanup map for JSON, screenshots, local caches, and runtime assets.

## Authority Rule

Use `doc-authority-registry-2026-05-27.md` before using older plans, evidence reports, temporary notes, unattended-run notes, proposals, or iteration outputs as instructions.

Use `generated-artifact-registry-2026-05-27.md` before deleting, ignoring, or committing generated non-Markdown artifacts.

Protected-policy files are off-limits to routine agents: do not delete, weaken, bypass, rename, or reinterpret them during autonomous work.

## Cleanup Rule

When a doc is outdated, prefer one of these actions:

- mark it historical or evidence-only;
- summarize it into a canonical current reference;
- archive it through a deliberate cleanup slice;
- update the doc authority registry.
- update the generated artifact registry when non-Markdown evidence/cache artifacts change.

Do not create new prompt, status, handoff, or continuation docs unless they are linked from the canonical control surfaces.
