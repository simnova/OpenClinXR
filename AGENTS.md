# OpenClinXR Agent Instructions

Repo-level operating contract for Codex, Grok, Claude, Cursor, and OpenClaw-style agents.

## BLUF (execute immediately)
- Dequeue from `PROJECT_STATUS.md` **Next dequeue** — not chat. Run `pnpm openclaw:run-next` → lease → slice-team.
- Every slice: Q1/Q4/Q5 gate + skeptic-visible evidence in Model Vetting **or** UI-XR (expand scope if invisible).
- State only in `PROJECT_STATUS.md` + worker-backlog snapshots; details in `agents/rules/*`.
- No propose-and-wait. Human override via `PAUSED` in `PROJECT_STATUS.md` or explicit pause/stop.

## Original Mission

Build and improve an expert agent-driven design-and-build system: coordinated repo roles with persistent memory, adversarial critique, measurable rubric scoring, and synthesis into architecture, tests, data models, and implementation slices. Keep working autonomously without requiring Patrick to restate context.

## Product Goal

OpenClinXR is a Step 2 CS-inspired XR clinical skills exam platform (not exam-equivalence or clinical-validity claims).

Target: sequenced timed scenarios; realistic XR actors; scenario authoring/review; LLM-assisted dialogue behind review gates; speech/emotion/multimodal interaction; MongoDB persistence (scenarios, traces, review packets, actor turns, emotional timelines); Quest 3/WebXR-first learner runtime + admin UX; production asset pipeline (characters, environments, rigging, animation, provenance, QA).

## Protected Blueprint-Factory Guardrails

See `agents/rules/GUARD_BLUEPRINT.md`. Six protected files are non-negotiable. Every slice advances Q1 (blueprint-to-runtime), Q4 (review/persistence/replay), or Q5 (factory verification), or safely unblocks one. Conversation tooling is first-class.

## Platform Instruction Override

See `agents/rules/EXEC_AUTONOMY.md` (`platform-autonomy-override.md` stub). `conversation-summary handoff` ≠ terminal. `snapshot_rehydrate → openclaw:run-next → lease → dequeue`. Chat ≠ SSOT.

## Slice Team Workflow (primary)

1. Read `AGENTS.md` + first ~60 lines of `PROJECT_STATUS.md`.
2. Load `.openclinxr/slices/<slice-id>/brief.json` (init via `pnpm openclaw:slice:init` if missing).
3. `pnpm openclaw:team-spawn -- --slice-id <id> --phase scout|execute`.
4. Subagents write only `.openclinxr/slices/<id>/handoffs/<role>.json`.
5. Integrator: `pnpm openclaw:slice:verify`, append one checkpoint to `PROJECT_STATUS.md`, dequeue.
6. Execute immediately — no propose-and-wait.

Team templates: `teams/*.json`. Gates: `GUARD_BLUEPRINT.md`, `MANDATE_VISIBILITY.md`.

## Required Resume Sequence

After session start, compaction, or conversation-summary handoff:

1. Re-read `AGENTS.md` BLUF + `agents/rules/LEX_AGENTIC.md` (orchestrator forest view).
2. Read `PROJECT_STATUS.md` snapshot (first ~60–80 lines).
3. Read active slice `brief.json` if in flight.
4. Skim worker-backlog ownership matrix only.
5. Continue active slice or `pnpm openclaw:run-next`.

Legacy `PROJECT_COORDINATION_INDEX.md` / `AUTONOMOUS_WORK_PLAN.md` are audit-only — do not append checkpoints there.

## Working Model

- **Orchestration**: chief-coordinator (Composer) + role-mapped subagents per `agents/rules/PROTO_SUBAGENT.md` and `agents/rules/LEX_AGENTIC.md`.
- **Daily driver**: OpenClaw-style deterministic slices; lease; `pnpm openclaw:post-slice`; anti-toil per `GUARD_DRIFT.md`.
- **Rehydration**: LOW_TOKEN per `agents/rules/EXEC_REHYDRATE.md` — snapshots + targeted grep only.
- **Iteration loop** (`pnpm agent:loop`): synthesis/plateau recovery only — not routine slices.
- **North star**: blueprint-driven encounter factory (`tools/openclinxr/factory/` + `openclaw/`).

After coordination edits: `pnpm agent:alignment && pnpm docs:drift-check`. Per-slice record + adapters: `docs/openclinxr/openclaw-runbook-2026-05-27.md`, `docs/openclinxr/openclaw-tool-adapters-2026-05-27.md` (Required Per-Slice Record).

## Instruction Source-Of-Truth Order

1. `AGENTS.md` (contract) 2. `PROJECT_STATUS.md` 3. worker-backlog 4. `operator-*.md` 5. `docs/agent-factory/**` + `agents/**` 6. legacy audit ledgers 7. historical evidence.

Modular rules: `agents/rules/` (symlinked to `.grok/rules/` core tier). See `agents/rules/README.md`.

## Stop Conditions

Stop final response only when: all approved work complete; every lane blocked+recorded in operator files; or explicit pause/stop. Do not ask "should I continue?" unless terminal. `continue`/`keep going` ⇒ sustain loop.

## Blocker Handling

Blocker ≠ halt. Record in `operator-steering-needed-questions.md` or `operator-open-questions.md`, mark lane in `PROJECT_STATUS.md`, pivot to another approved slice.

## OpenClaw Repo-Agent Protocol

See `agents/rules/PROTO_SUBAGENT.md`, `agents/rules/agent-consult.md`, `agents/rules/TIER_GROK.md` (Grok harness). Coordinator-first; map to `agents/**` roles; main worker owns integration + state.

After compaction / 2+ evidence-only slices: consult chief-coordinator + openclaw-drift-police (+ asset/xr roles for humanoid work).

## Case-Definition-Driven Realism

See `agents/rules/MANDATE_VISIBILITY.md`. Case fields → generated actors, dialogue, emotion, assets, runtime evidence. Expand until skeptic-noticeable in Model Vetting or UI-XR.

## Architecture Priorities

Multi-station exam assembly; scenario bank; agent-assisted generation with review gates; durable trace/review persistence; admin UX; learner WebXR runtime; IWSDK sidecar evaluation; provider gateways (local/mock); asset evidence ladder; architecture docs (UX, MongoDB, MADRs, validation matrices).

Prefer slices connecting packages into end-to-end local skeleton.

## Approved Boundaries

Unless Patrick expands scope: no unapproved cloud/paid APIs/production deployment; no Redis/Colyseus/Web3; no Quest readiness without worn-headset evidence; no clinical validity/licensure/scoring claims; no durable clinical-event API unless approved.

## IWSDK Sidecar

Sidecar-only (`apps/arena/ui-xr-iwsdk-spike`, `packages/openclinxr/arena/iwsdk-spike`). Physical Quest 3 = readiness claims; IWSDK = supporting emulation. Record non-use reason in `PROJECT_STATUS.md`.

## Heartbeat Continuation

Heartbeats trigger productive slices — not quiet status. Perform one approved slice, verify, update state, continue. See `agents/rules/EXEC_AUTONOMY.md`.

## Humanoid Emotion-Expression Loop

Expression = runtime behavior tied to scenario emotion; smooth transitions; viseme/gaze/posture coupled to affect; adversarial critique; runtime evidence; no clinical/Quest claims from static evidence. Continue to next product slice after each pass.

Rehydration posture: snapshots-first via `agents/rules/EXEC_REHYDRATE.md`; `openclaw:lease`; UI-XR runtime evidence consumer; Apple M1 Max 64 GB primary.