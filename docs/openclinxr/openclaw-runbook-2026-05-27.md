# OpenClaw Runbook

Date: 2026-05-27

This runbook is a protected OpenClaw-style / OpenClaw-inspired control surface for OpenClinXR. Routine agents must not delete, weaken, bypass, rename, or reinterpret it during autonomous work.

Important naming clarification: this repository uses an OpenClaw-style execution pattern, not an external OpenClaw runtime, daemon, SaaS product, or privileged orchestration service. OpenClinXR uses repo-native guardrail files, repo-defined roles, deterministic checks, host adapter prompts, and a drift-police role that can be used from Codex, Claude, Grok, Cursor, or another capable agent host.

## Purpose

OpenClaw-style / OpenClaw-inspired mode exists to keep unattended work advancing the OpenClinXR product instead of producing scattered notes, one-off scenes, stale screenshots, or generic agent-status artifacts.

Use this runbook with `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, `docs/openclinxr/worker-backlog-and-validation-matrix.md`, and `docs/openclinxr/openclaw-tool-adapters-2026-05-27.md`.

## OpenClaw-Style Start Sequence

1. Run `pnpm openclaw:preflight` before long unattended work from a supposedly clean checkout.
2. Read `AGENTS.md`.
3. Read `PROJECT_COORDINATION_INDEX.md`.
4. Read `AUTONOMOUS_WORK_PLAN.md`.
5. Read `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
6. Run `pnpm docs:drift-check` before a long unattended batch when the repo has just been reorganized or when drift is suspected.
6. Select the highest-value approved product slice from the active queue.
7. Use repo-defined roles only when they reduce drift, risk, or review cost.
8. Invoke `agents/adversarial/openclaw-drift-police/` when scattered artifacts, one-off encounter work, evidence toil, wrong-cwd subagents, weakened guardrails, or noncanonical process is suspected.
9. Implement the smallest coherent product advancement.
10. Verify the touched behavior with focused tests or runtime/browser evidence when relevant.
11. Update canonical state files only, then run `pnpm openclaw:post-slice` before claiming the slice is ready for the next queue transition.
12. Immediately queue the next slice unless a true stop condition is reached.

## Allowed OpenClaw-Style Execution Modes

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
- A subagent reports from the wrong cwd or ignores repo-native OpenClaw-style files.

The expected correction is: name the drift, cite the violated guardrail, recommend the smallest cleanup or registration step, and route the worker back to the next product slice.

## Required Per-Slice Record

Each autonomous slice must leave a short canonical record in `AUTONOMOUS_WORK_PLAN.md` or the worker backlog with these fields, either as prose or structured bullets:

- `Product path advanced`: learner station, faculty review, admin workflow, scenario authoring, XR runtime, persistence, provider facade, asset pipeline, or blueprint-to-runtime factory.
- `Blueprint/factory tie`: how the slice keeps encounter details/specifications driving generated runtime behavior.
- `Touched files`: only the meaningful files or packages, not exhaustive command logs.
- `Evidence`: focused tests, API smoke, browser screenshot, runtime JSON, or explicit reason evidence was not appropriate.
- `Next queued slice`: the next approved product-advancement action, not a checkpoint stop.

## Token-Efficient & Long-Run Hyper-Opt Rules (for uninterrupted completion) [snapshots-first; Efficiency Quick Ref]

To support days-long agentic runs with minimal token use and no interruption:

- Rehydrate exclusively via snapshots (first 60-80 lines of the 3 state files) + AGENTS top. Use `tail | grep` for "Next queued" / recent records; full ledger reads only for rare synthesis.
- Searches: `grep` tool (with path/glob/head_limit) or terminal `grep` / `tail` before any `read_file` on large files. Always `read_file` + `offset` + `limit` (e.g. 30) for files >100 lines.
- Verification: always focused (`vitest ... -t "name"`, `biome check specific.ts`). Never full `agent:verify` for routine; use `agent:alignment` first (~0.5s).
- Long-run protocol: use `pnpm openclaw:run-next` to select the next queued slice and write only `.openclinxr/openclaw/run-next-report.json`; acquire `pnpm openclaw:lease -- acquire --owner <role> --slice <id> --ttl-minutes 60` before any real write; release after canonical update. Run `pnpm openclaw:preflight && pnpm docs:drift-check` at start of unattended. Use `pnpm openclaw:watchdog` only as a quiet local idle check; it must not append no-op heartbeat records to canonical Markdown.
- Codex native lifecycle hooks are project-local in `.codex/hooks.json` and route through `pnpm codex:hook`. They provide SessionStart/PreToolUse/PostToolUse/PreCompact/SubagentStart/SubagentStop/UserPromptSubmit/Stop reminders plus scoped alignment/drift guards for coordination/OpenClaw-style surfaces. They must be trusted with `/hooks` when their hash changes.
- On any platform heartbeat/compact/force response: rehydrate snapshots, check `git status --short` + lease status, use `pnpm openclaw:run-next` if a new slice needs selection, finish/repair/pivot, record only real product changes, verification evidence, or blockers. No chat status.
- Avoid token bloat: no broad ls on docs/openclinxr (400+ JSONs), no full cat of ledgers, no un-focused tests, no evidence refresh without decision unlock.
- Subagent: coordinator first (read-only), narrow, map to agents/**, close fast, integrate results to state only.
- These + snapshots + lease + drift/alignment make hyper-optimized, low-interruption, token-efficient multi-day completion possible while advancing the factory.

Update the canonical automation prompt (via openclaw:automation-prompt) to reference these rules for any external scheduler or runner.

## Drift Rules

- Do not hand-design individual encounters when the factory/specification should drive them.
- Do not create new markdown journals, checkpoint notes, status files, or prompt fragments outside canonical files.
- Do not commit generated screenshots, JSON, local cache, or runtime outputs unless they are classified by `docs:artifacts` and useful as current representative evidence.
- Do not treat unit tests as the only proof for XR/runtime/UI/asset behavior when browser or runtime evidence is feasible.
- Do not refresh evidence simply because it is stale unless it unlocks a concrete implementation decision.
- Model-work product guard: do not spend another model/model-pipeline slice mainly on tests, validators, benchmarks, screenshots, source-currentness checks, or review artifacts unless that slice also builds or directly unlocks actual model artifacts, model generation/import, rigging/animation/skin/clothing functionality, runtime-visible model behavior, or provider/cache/tooling capability that can produce models on this machine inside approved boundaries.
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

## Operational Redundancy Commands

Use these commands to reduce unattended-run drift:

```bash
pnpm openclaw:preflight
pnpm openclaw:post-slice
pnpm openclaw:automation-prompt
pnpm openclaw:run-next
pnpm openclaw:watchdog
pnpm openclaw:lease -- status
```

`openclaw:preflight` runs the full readiness gate and should pass before a long unattended run starts.

`openclaw:post-slice` checks that the operational redundancy surface still has the required preflight, post-slice, automation-prompt, per-slice ledger, and host-adapter markers.

`openclaw:automation-prompt` prints the canonical automation prompt from this runbook so agent starts and optional external automations can be refreshed from the protected source instead of hand-maintained chat fragments.

`openclaw:run-next` selects the next queued product slice from canonical state and writes `.openclinxr/openclaw/run-next-report.json`, an ignored local runtime report. It does not edit `AUTONOMOUS_WORK_PLAN.md`, `PROJECT_COORDINATION_INDEX.md`, or the worker matrix by itself.

`openclaw:watchdog` is an optional quiet local check. It recommends `run-next` only when the tree is clean, no active lease is held, the previous local report is stale, and a queued slice exists. If it idles, it writes only the local report; it must not produce repeated canonical heartbeat entries.

`openclaw:lease` coordinates slice workers through `.openclinxr/openclaw/automation-lease.json`, an ignored local runtime file. Before starting a slice, acquire a lease with `pnpm openclaw:lease -- acquire --owner openclaw-run-next --slice "<slice-name>"`; if another unexpired owner holds it, do not start overlapping edits. During long slices, refresh with `pnpm openclaw:lease -- heartbeat --owner openclaw-run-next --slice "<slice-name>"`; after canonical state updates and verification, release with `pnpm openclaw:lease -- release --owner openclaw-run-next`. Expired leases are recoverable by the next run.

## Canonical Automation Prompt

Use this prompt for Codex, Claude, Cursor, or another agent host when starting unattended work:

```text
Continue in repo-native OpenClaw-style / OpenClaw-inspired mode in /Volumes/files/src/openclinxr. This is not an external OpenClaw runtime.

Use AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, and docs/openclinxr/openclaw-runbook-2026-05-27.md as the source of truth. Do not use generic chat autonomy.

Before selecting work, run or mentally apply the OpenClaw drift guard: no scattered markdown, no one-off hand-designed encounters, no unregistered generated artifacts, no evidence refresh unless it unlocks a concrete implementation decision.

Apply the model-work product guard before any Anny, humanoid, voice, animation, skin, clothing, or model-provider slice: do not spend another model/model-pipeline slice mainly on tests, validators, benchmarks, screenshots, source-currentness checks, or review artifacts unless the same slice builds or directly unlocks actual model artifacts, model generation/import, rigging/animation/skin/clothing functionality, runtime-visible model behavior, or provider/cache/tooling capability that can produce models locally inside approved boundaries.

Before editing, run `pnpm openclaw:run-next` to identify the next queued slice, then acquire the lease with `pnpm openclaw:lease -- acquire --owner openclaw-run-next --slice "<short-slice-name>"`. If the lease output says another unexpired owner holds the slice, do not overlap that work; re-read canonical state and wait for a clean runner opportunity. Refresh the lease during long work and release it only after focused verification and canonical state updates. If the lease is expired, recover it and inspect `git status --short` before continuing.

Stay focused on the case-definition-driven WebXR encounter factory. Scene, humanoid, clothing, animation, conversation, emotion, locomotion, gaze/lip-sync, equipment, trace, persistence, provider, and review work must flow from encounter specifications/blueprints through reusable factory/provider/cache pipelines.

Use repo-defined coordinator, worker, adversarial reviewer, evidence reviewer, and specialist roles only when they materially reduce drift, risk, or review cost. If live subagents are unavailable, perform local role consultation and record only canonical outcomes.

After each slice, run focused verification when appropriate, update canonical state files with product path advanced, blueprint/factory tie, touched files, evidence, and next queued slice, then continue. Do not stop for slice completion, tests, docs, screenshots, or checkpoints.

Stop only if explicitly told to pause/stop or if all approved lanes are truly blocked and recorded with recommended defaults.
```

## Confidence Standard

The repo is ready for longer unattended OpenClaw work only when the following pass:

```bash
pnpm openclaw:ready
```

`openclaw:ready` is the preferred high-confidence gate because it checks the worktree is clean, the current branch is synchronized with upstream, the doc/artifact registries are reproducible, and the drift/alignment checks pass.

If the readiness gate is unavailable, use the component checks directly:

```bash
pnpm docs:authority
pnpm docs:artifacts
pnpm docs:drift-check
pnpm agent:alignment
```

A run can proceed with at least 80% confidence when those checks pass and the next slice is selected from the active product queue rather than from stale chat context.

A run can proceed with 95%+ confidence only when `pnpm openclaw:ready` passes from a clean, upstream-synchronized checkout and the next slice has a clear product path plus blueprint/factory tie.
