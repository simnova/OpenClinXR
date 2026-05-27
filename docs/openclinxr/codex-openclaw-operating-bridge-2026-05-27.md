# Codex/OpenClaw Operating Bridge

Date: 2026-05-27

## Purpose

This bridge aligns modern Codex capabilities with the repo-native OpenClaw-style agent system already present in OpenClinXR. It prevents the autonomy prompt from drifting into generic Codex behavior while still using Codex tools that materially advance the case-definition-driven WebXR encounter factory.

## Current Finding

OpenClinXR already contains an OpenClaw-style system:

- `AGENTS.md` defines the operating contract and stop conditions.
- `PROJECT_COORDINATION_INDEX.md` is the command-and-control dashboard.
- `AUTONOMOUS_WORK_PLAN.md` is the active queue and durable handoff.
- `docs/openclinxr/worker-backlog-and-validation-matrix.md` maps workers to evidence and validation.
- `agents/**` contains role charters, memories, and adversarial/leadership lenses.
- `docs/agent-factory/**` describes the planning loop, rubric, model policy, and workflow policy.
- `packages/openclinxr/agent-loop` and `tools/agent-factory/**` provide repo-native loop/roster/alignment tooling.
- `pnpm agent:alignment`, `pnpm agent:loop`, `pnpm agent:validate`, `pnpm agent:index`, and related scripts activate or verify the file-backed agent system.

The gap is not absence of OpenClaw configuration. The gap is prompt/tool alignment: prompts should explicitly choose a repo-native execution mode and should not let Codex operate as a single generic implementer unless that is the lowest-cost path.

## Canonical Organization Map

Use these locations as the canonical homes for agentic-operation artifacts. Do not create parallel prompt/runbook/status files elsewhere unless this map is updated.

| Concern | Canonical location | Notes |
| --- | --- | --- |
| Operating contract and stop conditions | `AGENTS.md` | Highest-priority repo-local instructions for Codex and agents. |
| Current product queue and coordinator decisions | `PROJECT_COORDINATION_INDEX.md` | Short command-and-control index; should not contain per-slice logs. |
| Active execution queue and durable slice handoff | `AUTONOMOUS_WORK_PLAN.md` | May contain historical ledger, but current queue transitions must be explicit. |
| Worker ownership and validation map | `docs/openclinxr/worker-backlog-and-validation-matrix.md` | One row per meaningful worker capability or validation lane. |
| Codex/OpenClaw tool bridge | `docs/openclinxr/codex-openclaw-operating-bridge-2026-05-27.md` | This file; explains how Codex capabilities map onto repo-native OpenClaw execution. |
| Agent-factory operating manuals | `docs/agent-factory/**` | Planning-loop and role-governance manuals; not routine implementation logs. |
| Repo-defined role memory | `agents/**/charter.md`, `agents/**/memory.md`, `agents/**/index.json` | Role lenses for local consultation or live-subagent prompts. |
| Generated agent-factory reports | `.agent-factory/**` | Machine-readable evidence/memory/risk/benchmark reports; do not use as active queue. |
| Full iteration synthesis | `iterations/**` | Broad planning/leadership/adversarial loop artifacts. |
| Implementation tooling | `tools/**`, `packages/**`, `apps/**` | Product/pipeline code, focused validators, and runtime surfaces. |
| Operator blockers | `operator-steering-needed-questions.md`, `operator-open-questions.md` | True blockers and nonblocking defaults only. |

## Artifact Hygiene Rules

- Prefer updating the canonical location over creating a new "handoff", "prompt", "runbook", or "continuation" file.
- If a new artifact is needed, name its owning concern and link it from `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, or this bridge.
- Use `.agent-factory/**` for generated machine reports, not active instructions.
- Use `docs/openclinxr/**` for evidence, scorecards, visual reviews, provider gates, and product-specific runbooks.
- Use `docs/agent-factory/**` only for agent-factory methodology, not OpenClinXR product evidence.
- Avoid chronological status sprawl: every appended status entry must name the next queue transition or cleanup action.
- Treat old unattended-run or handoff files as historical evidence unless linked by the current queue.

## Required Execution Modes

Before starting a nontrivial autonomous batch, choose exactly one mode and record the choice in the active plan when it affects task selection.

### `live_subagents`

Use when the current Codex environment exposes live multi-agent tooling and Patrick has requested orchestration, subagents, adversarial review, cleanup, or autonomous OpenClaw-style execution.

Rules:

- Spawn one non-coding coordinator/gap-attacker first.
- The coordinator is read-only and must not patch product files.
- Spawn specialist workers only for disjoint write scopes or independent reviews.
- Map live agents to repo roles from `agents/**`, not invented generic roles.
- Close stale or completed agent threads after consuming their result.

### `local_role_consultation`

Use when live subagents are unavailable or too expensive for the slice.

Rules:

- Read only the relevant `agents/**/charter.md` and `agents/**/memory.md` files.
- Apply the role lens locally.
- Record the role consultation in `AUTONOMOUS_WORK_PLAN.md` when it changes the next slice.

### `agent_loop_artifact`

Use only for broad planning, plateau recovery, major direction changes, or leadership/adversarial synthesis.

Rules:

- Prefer `pnpm agent:alignment` first.
- Use `pnpm agent:loop` only when a full planning loop is worth the cost.
- Do not run full agent-factory loops for routine implementation.

## Codex Capability Mapping

Use Codex capabilities as implementation accelerators inside the OpenClaw control loop:

- Browser automation: run local WebXR/admin flows, capture WebXR-only screenshots, and verify runtime behavior after touched UI/XR slices.
- Multimodal review: describe screenshots and compare only the WebXR view against encounter expectations.
- Live subagents: run coordinator, adversarial visual critic, asset pipeline reviewer, or bounded workers when they materially reduce drift or review cost.
- Local execution: run Blender, Node, package scripts, screenshot comparators, and focused validators.
- Web/tool research: use only for unstable external tool/library/source/license questions, then write allowlists/gates before execution.
- File-backed memory: persist queue state, decisions, evidence paths, blockers, and next slices in project docs rather than chat.

## Cleanup Rules

- Do not create new one-off prompt files unless they become linked from `AGENTS.md` or `PROJECT_COORDINATION_INDEX.md`.
- Do not append unbounded chronological breadcrumbs without a current queue transition.
- Do not keep dead agent threads open after their output is consumed.
- Do not let evidence gates become the active backlog unless they unlock a named implementation decision.
- If a slice only produces metadata, the next slice must harden executable pipeline behavior or runtime evidence.
- If live subagents report from a cwd other than `/Volumes/files/src/openclinxr`, close them and discard the result as stale orchestration noise.

## Better Kickoff Prompt

```text
Continue autonomously in /Volumes/files/src/openclinxr using AGENTS.md and PROJECT_COORDINATION_INDEX.md.

Use repo-native OpenClaw execution, not generic Codex autonomy.

First, choose and record the execution mode:
- live_subagents when available and useful,
- local_role_consultation when cheaper,
- agent_loop_artifact only for plateau recovery or major planning.

If live subagents are available, spawn exactly one non-coding coordinator/gap-attacker first. The coordinator must only select slices, assign/check focused agents, prevent drift/toil, and recommend cleanup. It must not patch product code. Spawn specialist or adversarial agents only for narrow, non-overlapping work that materially reduces implementation or review risk. Close stale/completed agents after consuming results.

Primary objective: advance the case-definition-driven WebXR encounter factory. Scenario definitions should drive environment, equipment, actors, humanoid body archetypes, clothing, rigging, locomotion, gaze/lip-sync, expression/emotion transitions, interactivity, persistence metadata, provider gates, shared asset-library caching, and screenshot-based promotion evidence.

Current priority: adaptive source-backed humanoid/clothing realism. Stop hand-authoring one-off clothing. Build the reusable pipeline:
1. license-compatible garment/source intake,
2. body measurement extraction for child/adult/thin/average/overweight/tall/short archetypes,
3. garment retargeting/fitting per body,
4. collision/clearance/material realism,
5. rig/weight transfer,
6. WebXR-only screenshot scoring per archetype,
7. promotion only after multi-archetype evidence passes,
8. semantic shared asset-library reuse with LRU/cache metadata.

Use Browser and screenshot evidence for runtime visual changes. Use multimodal/adversarial review on WebXR-only crops. Use Blender/Node/local scripts for generation and fitting. Use web research only for current external tooling/license questions and keep providers gated/off by default.

After each slice, update AUTONOMOUS_WORK_PLAN.md and docs/openclinxr/worker-backlog-and-validation-matrix.md, record nonblocking blockers in operator-open-questions.md with recommended defaults, then immediately continue to the next approved slice.

Do not treat slice completion, screenshots, tests, documentation updates, heartbeats, or evidence checkpoints as stop conditions. Keep chat minimal. Stop only if I explicitly say pause/stop or all approved lanes are truly blocked.
```
