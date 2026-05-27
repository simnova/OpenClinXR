# OpenClaw Runbook

Date: 2026-05-27

This runbook is a protected OpenClaw control surface for OpenClinXR. Routine agents must not delete, weaken, bypass, rename, or reinterpret it during autonomous work.

## Purpose

OpenClaw mode exists to keep unattended work advancing the OpenClinXR product instead of producing scattered notes, one-off scenes, stale screenshots, or generic agent-status artifacts.

Use this runbook with `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, `docs/openclinxr/worker-backlog-and-validation-matrix.md`, and `docs/openclinxr/openclaw-tool-adapters-2026-05-27.md`.

## OpenClaw Start Sequence

1. Read `AGENTS.md`.
2. Read `PROJECT_COORDINATION_INDEX.md`.
3. Read `AUTONOMOUS_WORK_PLAN.md`.
4. Read `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
5. Run `pnpm docs:drift-check` before a long unattended batch when the repo has just been reorganized or when drift is suspected.
6. Select the highest-value approved product slice from the active queue.
7. Use repo-defined roles only when they reduce drift, risk, or review cost.
8. Invoke `agents/adversarial/openclaw-drift-police/` when scattered artifacts, one-off encounter work, evidence toil, wrong-cwd subagents, weakened guardrails, or noncanonical process is suspected.
9. Implement the smallest coherent product advancement.
10. Verify the touched behavior with focused tests or runtime/browser evidence when relevant.
11. Update canonical state files only, then immediately queue the next slice unless a true stop condition is reached.

## Allowed OpenClaw Execution Modes

- `live_subagents`: use when the host tool exposes live subagents and independent, non-overlapping work or review is available.
- `local_role_consultation`: use when live agents are unavailable or too expensive; read the relevant repo-defined role memory/charter and record the decision in canonical state.
- `agent_loop_artifact`: use only for plateau recovery, major planning, or broad drift review; do not run it for routine implementation.

## Drift Police Agent

`agents/adversarial/openclaw-drift-police/` is the repo-defined drift-policing agent. Use it as an adversarial correction role, not as a product implementer.

Invoke it when:

- `pnpm docs:drift-check` fails.
- New markdown/status/prompt/checkpoint files appear outside canonical state.
- Generated screenshots, JSON, GLBs, or local cache artifacts are unregistered.
- A worker starts manually designing one encounter instead of strengthening the reusable factory.
- Two evidence-only slices happen in a row.
- A subagent reports from the wrong cwd or ignores repo-native OpenClaw files.

The expected correction is: name the drift, cite the violated guardrail, recommend the smallest cleanup or registration step, and route the worker back to the next product slice.

## Required Per-Slice Record

Each autonomous slice must leave a short canonical record in `AUTONOMOUS_WORK_PLAN.md` or the worker backlog with these fields, either as prose or structured bullets:

- `Product path advanced`: learner station, faculty review, admin workflow, scenario authoring, XR runtime, persistence, provider facade, asset pipeline, or blueprint-to-runtime factory.
- `Blueprint/factory tie`: how the slice keeps encounter details/specifications driving generated runtime behavior.
- `Touched files`: only the meaningful files or packages, not exhaustive command logs.
- `Evidence`: focused tests, API smoke, browser screenshot, runtime JSON, or explicit reason evidence was not appropriate.
- `Next queued slice`: the next approved product-advancement action, not a checkpoint stop.

## Drift Rules

- Do not hand-design individual encounters when the factory/specification should drive them.
- Do not create new markdown journals, checkpoint notes, status files, or prompt fragments outside canonical files.
- Do not commit generated screenshots, JSON, local cache, or runtime outputs unless they are classified by `docs:artifacts` and useful as current representative evidence.
- Do not treat unit tests as the only proof for XR/runtime/UI/asset behavior when browser or runtime evidence is feasible.
- Do not refresh evidence simply because it is stale unless it unlocks a concrete implementation decision.
- Do not use paid/cloud APIs, production deployment, credentials, destructive operations, or unapproved runtime dependency changes without explicit approval.

## Drift Check

Run:

```bash
pnpm docs:drift-check
```

The drift check verifies:

- `docs:drift-check` is wired into `package.json`.
- new Markdown files are registered in `docs/openclinxr/doc-authority-registry-2026-05-27.json`.
- generated artifacts under known evidence/cache/runtime roots are registered in `docs/openclinxr/generated-artifact-registry-2026-05-27.json`.
- canonical guardrail files still link the OpenClaw runbook, drift check, and protected factory guardrails.
- common one-off status/checkpoint/prompt artifact names are rejected unless explicitly registered.

## Canonical Automation Prompt

Use this prompt for Codex, Claude, Cursor, or another agent host when starting unattended work:

```text
Continue in repo-native OpenClaw mode in /Volumes/files/src/openclinxr.

Use AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, and docs/openclinxr/openclaw-runbook-2026-05-27.md as the source of truth. Do not use generic chat autonomy.

Before selecting work, run or mentally apply the OpenClaw drift guard: no scattered markdown, no one-off hand-designed encounters, no unregistered generated artifacts, no evidence refresh unless it unlocks a concrete implementation decision.

Stay focused on the case-definition-driven WebXR encounter factory. Scene, humanoid, clothing, animation, conversation, emotion, locomotion, gaze/lip-sync, equipment, trace, persistence, provider, and review work must flow from encounter specifications/blueprints through reusable factory/provider/cache pipelines.

Use repo-defined coordinator, worker, adversarial reviewer, evidence reviewer, and specialist roles only when they materially reduce drift, risk, or review cost. If live subagents are unavailable, perform local role consultation and record only canonical outcomes.

After each slice, run focused verification when appropriate, update canonical state files with product path advanced, blueprint/factory tie, touched files, evidence, and next queued slice, then continue. Do not stop for slice completion, tests, docs, screenshots, or checkpoints.

Stop only if explicitly told to pause/stop or if all approved lanes are truly blocked and recorded with recommended defaults.
```

## Confidence Standard

The repo is ready for longer unattended OpenClaw work only when the following pass:

```bash
pnpm docs:authority
pnpm docs:artifacts
pnpm docs:drift-check
pnpm agent:alignment
```

A run can proceed with at least 80% confidence when those checks pass and the next slice is selected from the active product queue rather than from stale chat context.
