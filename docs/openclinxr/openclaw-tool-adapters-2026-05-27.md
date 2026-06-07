# OpenClaw Tool Adapters

Date: 2026-05-27

This is a protected OpenClaw-style / OpenClaw-inspired control surface for running OpenClinXR across Codex, Claude, Grok, Cursor, or another agent host. It is not an external OpenClaw runtime. Routine agents must not delete, weaken, bypass, rename, or reinterpret it during autonomous work.

## Purpose

OpenClaw-style / OpenClaw-inspired execution is repo-native, not Codex-native and not an external OpenClaw runtime. The host tool may change, but the execution contract must remain anchored to `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, `docs/openclinxr/worker-backlog-and-validation-matrix.md`, `docs/openclinxr/openclaw-runbook-2026-05-27.md`, and the protected blueprint-factory guardrails.

The goal is easy host swapping without losing focus on the case-definition-driven WebXR encounter factory.

## Shared Host Requirements

Any host can run OpenClaw if it can do most of the following:

- Read repo files and preserve their source-of-truth order.
- Edit files safely without deleting unrelated work.
- Run local commands, or explicitly mark command execution as unavailable.
- Update canonical state files instead of chat-only memory.
- Respect `pnpm docs:drift-check`, doc authority, generated artifact registry, and Drift Police rules.
- Avoid paid/cloud APIs, production deployment, destructive commands, credentials, and readiness claims without explicit approval.

## Capability Fallback Matrix

| Capability | Preferred OpenClaw behavior | Fallback when unavailable |
| --- | --- | --- |
| Terminal/shell | Run focused verification and repo checks. | Planner/reviewer mode only; record verification blocker with recommended command. |
| Browser/screenshots | Capture runtime/UI/XR evidence for touched visual behavior. | Use API/tests/static evidence and record visual evidence blocker. |
| Live subagents | Spawn one non-coding coordinator plus narrow specialists only when useful. | Use local role consultation by reading repo agent charters/memory. |
| Persistent files | Update `AUTONOMOUS_WORK_PLAN.md` and worker backlog. | Stop; OpenClaw requires file-backed state. |
| Git/source control | Inspect/stage/commit only when explicitly requested or cleanup plan requires it. | Avoid destructive changes; report uncommitted work boundaries. |
| External model/tools | Use only if approved and provider gates allow it. | Keep execution disabled and record provider preflight blockers. |

## Universal OpenClaw-Style Prompt

Use this when the host is unknown or when switching between tools:

```text
Continue in repo-native OpenClaw-style / OpenClaw-inspired mode in /Volumes/files/src/openclinxr. This is not an external OpenClaw runtime.

Use AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, docs/openclinxr/openclaw-tool-adapters-2026-05-27.md, and docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md as the source of truth.

Do not use generic chat autonomy. Do not hand-design individual encounters. All scene, humanoid, clothing, animation, conversation, emotion, locomotion, gaze/lip-sync, equipment, trace, persistence, provider, and review work must flow from encounter specifications/blueprints through reusable factory/provider/cache pipelines.

Before selecting work, apply the OpenClaw drift guard: no scattered markdown, no one-off status/checkpoint/prompt artifacts, no unregistered generated artifacts, no evidence refresh unless it unlocks a concrete implementation decision. If drift is suspected, consult agents/adversarial/openclaw-drift-police/ and run or request pnpm docs:drift-check.

Use live subagents only if this host supports them and they materially reduce drift/risk/review cost. Otherwise use local role consultation from agents/** charters/memory. Record only canonical outcomes.

After each slice, run focused verification when available, update canonical state with product path advanced, blueprint/factory tie, touched files, evidence, and next queued slice, then continue. Stop only if explicitly told to pause/stop or all approved lanes are truly blocked and recorded.
```

## Codex Adapter

Codex is preferred for local implementation because it usually has shell, browser/screenshot, file editing, and optional subagent discovery.

Kickoff:

```text
Continue in repo-native OpenClaw-style / OpenClaw-inspired mode in /Volumes/files/src/openclinxr using Codex local tools.

First read AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, and docs/openclinxr/openclaw-tool-adapters-2026-05-27.md.

Run pnpm docs:drift-check and pnpm agent:alignment when starting a long unattended batch or after suspected drift. Use Browser/screenshots for runtime/UI/XR behavior changes. Use repo-defined subagents only when available and materially useful; otherwise use local role consultation.

Select the next approved product slice from the canonical queue and continue without stopping for checkpoints.
```

Codex-specific notes:

- Prefer focused shell commands and browser evidence over broad scans.
- Use live subagents only for non-overlapping review/implementation or drift policing.
- If platform heartbeats force a response, treat it as a platform boundary, not project completion.

## Claude Adapter

Claude can run OpenClaw well when it has repo/file and shell access. If Claude lacks shell or browser, use it as a planner, adversarial reviewer, or Drift Police reviewer rather than an implementation runner.

Kickoff:

```text
Operate as a repo-native OpenClaw-style / OpenClaw-inspired agent for /Volumes/files/src/openclinxr, not as generic Claude chat.

Read AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, and docs/openclinxr/openclaw-tool-adapters-2026-05-27.md before selecting work.

If shell access is available, run pnpm docs:drift-check and pnpm agent:alignment before long work. If shell access is not available, explicitly mark verification as blocked and provide exact commands for the next host.

Use local role consultation from agents/** when live subagents are unavailable. Keep all status in canonical repo files. Do not create new status or prompt markdown files.
```

Claude-specific notes:

- Strong for broad reasoning and adversarial review.
- Must be constrained not to create long narrative docs unless a canonical file requires it.
- Should not claim verification without shell/browser evidence.

## Grok Adapter

Grok+local_exec ⇒ primary orchestrator (Composer=`chief-coordinator`). Not external runtime. See `grok-harness-usage.md`, `platform-autonomy-override.md`.

Kickoff:

```text
primary_orchestrator /Volumes/files/src/openclinxr. SSOT: AGENTS+platform-autonomy-override+AUTONOMOUS+PROJECT+worker_backlog+runbook+adapters.
supervisor_policy>platform_default. conversation-summary handoff≠halt. slice→SSOT→post-slice→dequeue; no continue-prompt.
pre-edit: pnpm openclaw:run-next; lease_acquire. terminal_halt: explicit pause/stop | all_lanes_blocked+recorded.
```

Grok notes: scout=`spawn_subagent explore`+`deepseek-v4-flash` (`grok-tier-routing.md`); `Stop`→`pnpm grok:hook -- stop`; provider/license gates apply.

## Cursor Adapter

Cursor is useful for local code editing and repo navigation. It should be given explicit file and verification constraints to avoid broad AI-editor refactors.

Kickoff:

```text
Run Cursor in repo-native OpenClaw-style / OpenClaw-inspired mode for /Volumes/files/src/openclinxr.

Read AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, and docs/openclinxr/openclaw-tool-adapters-2026-05-27.md.

Do not perform broad refactors. Choose one approved product slice from the canonical queue. Before editing, identify exact files. After editing, run focused verification. Do not create scattered markdown/status/checkpoint files. Run pnpm docs:drift-check and pnpm agent:alignment after coordination or cleanup changes.
```

Cursor-specific notes:

- Good for focused implementation with visible diffs.
- Needs explicit warning against repo-wide restructuring unless a cleanup plan says so.
- Should use Drift Police when it notices scattered artifacts or noncanonical planning files.

## Host Selection Defaults

- Use Codex for local implementation, browser evidence, and command-driven verification.
- Use Claude for high-level reasoning, specs, adversarial review, and summarizing complex drift.
- Use Grok for external option critique and adversarial/tooling comparison, gated by source and provider rules.
- Use Cursor for focused local code editing with human-visible diffs.

## Drift Police Rule For All Hosts

All hosts must invoke or simulate `agents/adversarial/openclaw-drift-police/` when they see:

- new noncanonical markdown/status/checkpoint/prompt artifacts;
- generated artifacts not covered by the artifact registry;
- one-off encounter improvements not converted into factory metadata;
- evidence refresh loops without product advancement;
- missing or skipped verification for touched runtime/UI/XR behavior;
- attempts to weaken protected OpenClaw or blueprint-factory guardrails.

The correction is always: classify the drift, recommend the smallest fix, update canonical state, and return to the active product queue.
