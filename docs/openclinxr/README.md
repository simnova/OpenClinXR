# OpenClinXR Documentation Navigation

This directory contains protected product references, generated navigation registries, current evidence, and a small number of compatibility inputs. It is not a dumping ground for dated status files or historical generated artifacts.

Agents must not treat every Markdown or JSON file here as equally authoritative. Historical evidence is disposable by default unless a current test, runtime path, provenance record, template, or registry entry explicitly justifies keeping it.

## Start Here

1. `../../AGENTS.md` - repo operating contract and protected guardrails.
2. `../../PROJECT_COORDINATION_INDEX.md` - current coordinator dashboard and active product queue.
3. `../../AUTONOMOUS_WORK_PLAN.md` - active queue handoff and slice ledger.
4. `worker-backlog-and-validation-matrix.md` - worker ownership and validation map.
5. `blueprint-factory-drift-guardrails-2026-05-27.md` - protected blueprint-factory/conversation-tooling guardrails.
6. `codex-openclaw-operating-bridge-2026-05-27.md` - Codex/OpenClaw-style execution-mode bridge (repo-native, not an external runtime).
7. `doc-authority-registry-2026-05-27.md` - generated authority map for Markdown files.
8. `generated-artifact-registry-2026-05-27.md` - generated cleanup map for JSON, screenshots, local caches, and runtime assets.
9. `evidence-index-2026-05-27.md` - generated navigation index for representative retained evidence.

## Authority Rule

Use `doc-authority-registry-2026-05-27.md` before using older plans, evidence reports, temporary notes, unattended-run notes, proposals, or iteration outputs as instructions.

Use `generated-artifact-registry-2026-05-27.md` before deleting, ignoring, or committing generated non-Markdown artifacts.

Use `evidence-index-2026-05-27.md` to find representative retained evidence quickly without scanning every generated artifact.

Use `pnpm docs:worktree-cleanup` when needed for a local `.agent-factory/worktree-cleanup-current.json` cache; do not keep dated worktree-status artifacts in this docs tree.

Protected-policy files are off-limits to routine agents: do not delete, weaken, bypass, rename, or reinterpret them during autonomous work.

## Cleanup Rule

When a doc or artifact is outdated, prefer one of these actions:

- delete it if it is historical evidence with no active consumer;
- summarize durable lessons into a canonical current reference;
- move active generated outputs behind a current product/test/runtime owner;
- update the doc authority registry;
- update the generated artifact registry when non-Markdown evidence/cache artifacts change.

Do not create new prompt, status, handoff, or continuation docs unless they are linked from the canonical control surfaces.

New dated JSON belongs here only when it is current product evidence, a reusable template, or a temporary compatibility input with an explicit consumer. Otherwise keep it local, write it under `.agent-factory`, or delete it after the decision it supported is made.
