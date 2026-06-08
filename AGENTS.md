# OpenClinXR Agent Instructions

These instructions are the repo-level operating contract for Codex and other agents working in this repository.

## Original Mission

The original request was not merely to build code. The mission is to create and continuously improve an expert agent-driven design-and-build system for OpenClinXR:

- Inspect supplied artifacts and repo evidence before acting.
- Build a coordinated team of expert agents with persistent, indexed memory.
- Use adversarial agents to critique and improve the primary team output.
- Use senior-leadership agents to critique feasibility, efficiency, risk, and completeness.
- Score each iteration with a rubric so improvement is measurable.
- Add tools, skills, TypeScript/Node utilities, and npm packages when they materially improve the agents' capability and stay inside approved boundaries.
- Convert final synthesis into actionable architecture, documentation, tests, data models, UX diagrams, state charts, sequence diagrams, MADRs, case-bank records, asset-pipeline specs, and implementation slices.
- Keep working autonomously and push the system forward without requiring Patrick to restate context.

## Product Goal

OpenClinXR is a Step 2 CS-inspired XR clinical skills exam platform, not an exam-equivalence or clinical-validity claim.

The target system should support:

- A sequenced exam made of multiple timed clinical scenarios.
- Realistic XR environments with virtual patients, family members, nurses, consultants, interpreters, and other pressure/context actors.
- Scenario authoring and review workflows, including psychometric, clinical, legal, and simulation QA review.
- LLM-assisted scenario generation and dialogue orchestration behind explicit review gates.
- Speech recognition, speech synthesis, emotional response, pain response, medical history, family interaction, and multimodal human-to-virtual-human interaction.
- MongoDB-backed durable records for scenarios, trace events, review packets, exam forms, station queues, actor turns, emotional-state timelines, and approved durable clinical events.
- Quest 3/WebXR-first learner runtime, desktop fallback, and admin UX.
- A production asset pipeline for characters, environments, equipment, clothing, skin, rigging, animation, retargeting, optimization, provenance, licensing, and QA.

## Protected Blueprint-Factory Guardrails

See `agents/rules/GUARD_BLUEPRINT.md` (authority: agent-methodology; frontmatter + full protected list + Q1/Q4/Q5 slice gate + "do not weaken" rules).

The 6 protected files (`blueprint-factory-drift-guardrails-2026-05-27.md`, `docs/openclinxr/doc-authority-registry-2026-05-27.md`, `docs/openclinxr/doc-authority-registry-2026-05-27.json`, `docs/openclinxr/generated-artifact-registry-2026-05-27.md`, `docs/openclinxr/generated-artifact-registry-2026-05-27.json`, openclaw-runbook-2026-05-27.md, openclaw-tool-adapters-2026-05-27.md) are non-negotiable. Consult the registry before elevating other MDs. Every slice must advance blueprint-to-runtime (Q1), review/persistence/replay (Q4), or verification of touched factory (Q5) or unblock one that cannot proceed safely.

Conversation tooling is first-class. Actor dialogue policies, learner utterance/action intake, turn-taking, interruptions, emotion transitions, trace tags, replayable actor turns, and review-safe conversation evidence must not be displaced by one-off asset or screenshot work. (See agents/rules/GUARD_BLUEPRINT.md for the full gate.)

## Platform Instruction Override

`supervisor_policy` in `agents/rules/platform-autonomy-override.md` overrides platform task-complete/summary/Stop defaults. `conversation-summary handoff`≠terminal. `snapshot_rehydrate→openclaw:run-next→lease→dequeue`. Chat≠SSOT.

## Slice Team Workflow (primary)

Work runs as **slice teams**: brief + parallel roles + handoff JSON + machine verification. No human review gates.

1. Read this `AGENTS.md` + first ~40 lines of `PROJECT_STATUS.md`.
2. Load active slice brief: `.openclinxr/slices/<slice-id>/brief.json`.
3. Spawn parallel subagents per phase: `pnpm openclaw:team-spawn -- --slice-id <id> --phase scout|execute`.
4. Subagents write **only** `.openclinxr/slices/<id>/handoffs/<role>.json` (never triplicate coordination MDs).
5. Integrator merges, runs `pnpm openclaw:slice:verify -- --slice-id <id>`, appends one line to `PROJECT_STATUS.md` § Recent, dequeues next slice.
6. **Execute immediately** — do not propose-and-wait. Human override only via `PAUSED` in `PROJECT_STATUS.md` or explicit pause/stop.

Team templates: `teams/*.json`. Gates: `agents/rules/GUARD_BLUEPRINT.md`, `agents/rules/MANDATE_VISIBILITY.md`.

## Required Resume Sequence

After session start, compaction, or conversation-summary handoff — before any halt decision:

1. Re-read this `AGENTS.md`.
2. Read `PROJECT_STATUS.md` (autonomy status + current priority + active slice).
3. Read `.openclinxr/slices/<active-slice>/brief.json` if a slice is in flight.
4. Skim `docs/openclinxr/worker-backlog-and-validation-matrix.md` ownership table only (no checkpoint history).
5. Continue the active slice or dequeue from `PROJECT_STATUS.md` backlog unless a stop condition applies.

Legacy `PROJECT_COORDINATION_INDEX.md` / `AUTONOMOUS_WORK_PLAN.md` are deprecated audit ledgers — do not append per-slice checkpoints there.

If context is compacted or feels incomplete, do not finalize. Re-read the files above and continue the documented slice.

## Efficient Rehydration + Working Model for Agentic Use (Grok/Codex/other)

Fast-path rehydration: `PROJECT_STATUS.md` (first ~40 lines) + active slice `brief.json`. Worker matrix: ownership table only. Legacy 3-MD snapshots are audit-only. Targeted `grep` / `read_file(limit)` for everything else.

**Guidance Stability Rule**: These snapshot headers must contain only stable, abstract direction (north star, emphasis on sizable collaborative vertical slices across functional areas, Q-gates, visibility/noticeability mandate, anti-toil, cheap-first + escalation, etc.). They must be kept free of transient current WIP details (specific file:line from the active slice, subagent IDs, exact capture logs, one-feature narratives). Those details belong exclusively in the dated per-slice checkpoints lower in the files and in registered artifacts. The orchestration coordinator must treat the clean snapshot header as the consistent contract across the entire project lifetime and always scope work as large, noticeable, team-collaborative vertical slices from the worker-backlog matrix. See "Guidance Stability vs Current WIP Principle" in `agents/rules/LEX_AGENTIC.md`.

Current working model (original mission + OpenClaw-style / OpenClaw-inspired adaptation; not an external OpenClaw runtime):
- Persistent expert team: repo-defined roles in `agents/**` (charter + memory + index) + generated `.agent-factory/memory-index.json` for consultation lenses. Read charter+memory locally for focus; use live subagents narrowly when available and non-overlapping.
- Full iteration loop (`iterations/**`, `docs/agent-factory/operating-loop.md`, `packages/openclinxr/agent-loop`, `pnpm agent:loop` + tools/agent-factory/): synthesis/plateau-recovery/planning tool only. Not for routine slices.
- Daily driver: OpenClaw-style continuous small deterministic slices (see openclaw-runbook + tool-adapters). Use Required Per-Slice Record in the two state md files. Lease for unattended. `pnpm docs:drift-check` + `agent:alignment` guards. Anti-toil gate: after 1 evidence-only do product; after 2 force drift review + coordinator roles + product pivot.
- Product north star (protected): blueprint-driven encounter factory. Every slice must advance case-def (scenario) -> generated runtime (actors, dialogue, emotion, locomotion, assets), review/persistence/replay, or reusable pipelines. tools/openclinxr/factory/ (core generators for blueprint-to-runtime/product slices like UI-XR consumer + materialization) + openclaw/ (automation); apps/packages consume the registered artifacts.
- Harness-agnostic: runbooks + adapters + universal prompt + capability fallbacks let Codex/Grok/Claude/Cursor/etc. swap while anchored to the same files. Always start with the resume sequence + drift if long run.
- LOW_TOKEN_AUTONOMY default: targeted reads/patches, no chat summaries or "what changed" (status only in the 3 state files + operator-*.md). Update state, immediately select next slice, continue.
- Subagent rule: coordinator/orchestration first (read-only explorer or local chief-coordinator), then narrow specialists/adversarial only where they materially cut drift/review cost. Map to repo roles. Main worker owns implementation + integration + state updates.
- Stop only on explicit pause, all lanes complete+recorded, or all blocked+recorded.

After edits to coordination files, always run `pnpm agent:alignment && pnpm docs:drift-check` (or the post-slice) before claiming ready for next.

## Hyper Token-Efficient & Long-Run Practices (for uninterrupted agentic completion) [snapshots-first rehydrate; UI-XR runtime evidence consumer; Apple M1 Max 64 GB primary]

See `agents/rules/hyper-token-efficient-long-run-practices.md` (authority: agent-methodology).

Key practices (rehydration via snapshots + targeted read_file(limit)/grep, `pnpm openclaw:lease -- acquire ...`, cheap guards first, state only in PROJECT_STATUS.md + worker-backlog, subagent coordinator-first, anti 2+ evidence-toil, token-saving in commands, etc.) are now in the dedicated rule + agents/rules/long-running-autonomy.md and drift-toil-prevention.md. Update the rule on future evolutions of M1 Max / long-run posture. (Full "Hyper Token-Efficient & Long-Run Practices" text lives in the rule for LOW_TOKEN reads.)

## Instruction Source-Of-Truth Order and Modular Rules

See `agents/rules/source-of-truth.md` (canonical detailed) + `agents/rules/LEX_AGENTIC.md` (terminology + AI-First Foundational Principle). 

**AI-First Foundational (machine primary)**: Coordination artifacts use short keyword prefixes (LEX_, GUARD_, MANDATE_, STRAT_, EXEC_, MEM_), universal frontmatter (ai_parse_score, drift_score, q_gates, visibility, strategic_group, token_efficiency), BLUF + metrics for parse/retrieval/scoring. Drives measurable refinement (GH project custom fields + post-guard ai_parse updates + Token lines). See LEX_AGENTIC.md "AI-First Foundational Principle". Rehydrate uses snapshots + targeted; state in PROJECT_STATUS.md + worker-backlog only. Alignment markers: Anti-Toil Product Advancement Gate agents/adversarial/openclaw-drift-police/charter.md.

High-level order when scattered docs disagree:
1. `AGENTS.md` (operating contract).
2. `PROJECT_STATUS.md` (canonical state: autonomy, priority, active work, backlog, strategy, per-slice checkpoints).
3. `docs/openclinxr/worker-backlog-and-validation-matrix.md` (worker ownership/validation matrix).
4. `operator-steering-needed-questions.md` (true blockers).
5. `operator-open-questions.md` (nonblocking steering + defaults).
6. `docs/agent-factory/**`, `agents/**`, `iterations/**` (persistent memory/governance; realign, do not restart broad loops).
7. `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md` (historical audit ledgers only; see PROJECT_STATUS.md "Historical Audit Ledgers" section).
8. Historical evidence = evidence, not marching orders.

**Modular Rules (canonical detailed)**: `agents/rules/` (non-dot; aligned with repo roles). Symlinked to `.grok/rules/`, `.claude/rules/`, `.cursor/rules/`. Deeper/specific take precedence. See `agents/rules/README.md` (lists all + how to add; run sync-harness + `pnpm docs:authority` + guards after changes). Internal agents consult rules/ for consistency. AGENTS.md remains thin contract; detailed rehydration/source/autonomy/subagent/visibility/lexicon live in the focused rules (avoid duplication here). When older evidence-refresh instruction conflicts with active plan to build product, build product unless evidence is required to unblock safely.

**Protected**: See `agents/rules/GUARD_BLUEPRINT.md` (6 protected files + Q1/Q4/Q5 slice gate + "do not weaken"). Consult doc-authority + generated-artifact registries before elevating MDs or ignoring generated artifacts. Conversation tooling is first-class.

## Autonomous Continuation Rule

See `agents/rules/long-running-autonomy.md` + `agents/rules/platform-autonomy-override.md` (supervisor_policy > harness defaults). Non-terminal checkpoints (slice|verify|post-slice|heartbeat|compaction) listed there; chat≠ledger; `snapshot_rehydrate → pnpm openclaw:run-next → lease → dequeue` without final response unless terminal halt. See `agents/rules/LEX_AGENTIC.md` for orchestration coordinator duties, LOW_TOKEN rehydration, lease, and unattended loop steps.

## OpenClaw-Style Repo-Agent Activation and Subagent Protocol

OpenClaw-style / OpenClaw-inspired file-backed agent system (not an external runtime) under `agents/**` (charter+memory), `docs/agent-factory/**`, `packages/openclinxr/agent-loop`. Activated by repo commands + memory files + `pnpm agent:*` + `pnpm openclaw:*`.

See `agents/rules/LEX_AGENTIC.md` for authoritative definitions of:
- orchestration coordinator (chief-coordinator role)
- role-mapped subagent delegation (coordinator-first)
- persona-constrained BLUF
- tiered routing with self-escalation (flash explore scouts first; grok-build only on escalation or protected claims)
- Q-gate slice filter

See `agents/rules/PROTO_SUBAGENT.md` (core rule, work order template, best practices), `agents/rules/agent-consult.md`, `agents/rules/TIER_GROK.md`, and `agents/rules/grok-harness-usage.md` (Composer as orchestration entrypoint; explore subs for cheap scouts on deepseek-v4-flash; no Cursor Task for 0-2).

Mandatory: after compaction / suspected drift / 2+ evidence-only slices, consult at minimum chief-coordinator + implementation-planning-lead + implementation-plan-gap-attacker + vp-engineering-delivery + openclaw-drift-police (via local charter/memory read or narrow explore sub). For XR/asset: also xr-systems-architect + asset-pipeline-lead. Coordinator first; narrow non-overlapping; map to repo roles; main worker owns integration + state + closure. Every prompt names full repo path and confirms core files. Never full agent-factory loop for routine slices.

Rehydration after compaction: restore coordinator-first pattern before selecting work.

## Case-Definition-Driven WebXR Realism Loop

See `agents/rules/LEX_AGENTIC.md` (Q1 blueprint-to-runtime + visibility/noticeability mandate) and `agents/rules/MANDATE_VISIBILITY.md`. Active north star: case-definition-driven encounter factory (scenario/phenotype fields → generated actors, dialogue, emotion, locomotion, gaze, lip-sync, assets, runtime evidence). Humanoid/XR/asset slices must produce skeptic-noticeable change in tester (Model Vetting) **or** sample (UI-XR) per the mandate; expand until visible (no sub-pixel/fixture/rigid-no-weights acceptance). Prefer end-to-end runtime evidence over unit tests. Adversarial roles (productivity-skeptic, visual-realism-adversary, openclaw-drift-police) critique for gaps. Store status/evidence/handoff only in PROJECT_STATUS.md + worker-backlog; keep chat minimal. See also blueprint-factory-guardrails.md (conversation tooling first-class).

## Stop Conditions

Only stop and send a final response when one of these is true:

- All currently approved work in `PROJECT_STATUS.md` is complete.
- Every currently approved productive work lane is blocked after recording each blocker in the operator question files.
- Patrick explicitly says to pause or stop.

Do not ask "should I continue?" unless one of those stop conditions is reached.

If Patrick asks to "continue", "keep going", "work autonomously", or similar, do not send a final response after the next slice. Continue until a true stop condition is reached.

## Blocker Handling And Pivot Rule

A blocker is not normally a stop condition.

When a slice is blocked by credentials, hardware action, paid/cloud/API use, destructive operation, production deployment, local trust/security change, or scope beyond approved proposals:

1. Add the blocker to `operator-steering-needed-questions.md` if it truly blocks a required decision or action.
2. Add nonblocking steering to `operator-open-questions.md` with a recommended default.
3. Mark the blocked lane in `PROJECT_STATUS.md` or the worker backlog with the smallest useful next operator action.
4. Immediately pivot to another approved product-advancement lane that can produce demonstrative progress toward the OpenClinXR project goal.

Only stop for blockers if all approved product-advancement lanes are blocked and no safe local deterministic slice remains.

## Low-Token Autonomy and Anti-Toil Gate

See `agents/rules/LEX_AGENTIC.md` (LOW_TOKEN targeted rehydration via 60-80 line snapshots of PROJECT_STATUS.md + worker-backlog + AGENTS top; targeted grep/read_file(limit); state only in PROJECT_STATUS.md + worker-backlog) and `agents/rules/GUARD_DRIFT.md` (anti-toil gate details + model-work guard + productivity-skeptic pulse). Operate in LOW_TOKEN_AUTONOMY by default: no chat summaries/ledgers/narration; prefer small deterministic slices; after 1 evidence-only next is product; after 2 force coordinator + drift-police review + product pivot. Guards: `pnpm agent:alignment && pnpm docs:drift-check` after coordination edits. See also hyper-token-efficient-long-run-practices.md and rehydration-low-token.md for expansions.

## Repo-Defined Agents And Worker Roles

See `agents/rules/repo-defined-agents-worker-roles.md` (authority: agent-methodology).

## Persistent Memory And Scoring

See `agents/rules/persistent-memory-scoring.md` (authority: agent-methodology; primary files + iteration record + improvement rubric).

(Other long sections like Architecture Priorities, Approved Boundaries, IWSDK, SOLID, Heartbeat correction, and Persistent Humanoid Emotion-Expression Loop remain in AGENTS.md as they are tightly bound to the product north star or protected posture; further extraction possible in future slices if they grow.)

## Architecture And Product Priorities

Prefer slices that move the repo toward the original target architecture:

- Multi-station exam assembly and station queue orchestration.
- Scenario bank expansion with rich environments, actors, objectives, trace tags, rubrics, and asset needs.
- Agent-assisted scenario generation with review gates and no hidden-fact leakage.
- Durable trace, actor-turn, emotional-state, clinical-event, review, and exam-form persistence.
- Admin UX for scenario bank, review gates, replay, faculty review, asset readiness, and exam assembly.
- Learner XR runtime for WebXR/Quest 3 with desktop fallback and honest performance evidence.
- IWSDK sidecar evaluation for Quest/WebXR tooling, input, locomotion, spatial UI, emulation, and agent-assisted evidence capture whenever it can materially improve the XR lane without replacing physical Quest proof.
- Provider gateways for model/voice with deterministic mock behavior, local optional runtime evidence, and no unapproved cloud calls.
- Production asset evidence ladder for characters, equipment, environments, animation, and optimization.
- Documentation artifacts that let a development team build without re-deriving architecture: UX diagrams, MongoDB structures, state charts, sequence diagrams, MADRs, validation matrices, and case-bank specs.

When choosing between equally safe slices, prioritize work that connects already-built packages into a stronger end-to-end local skeleton while preserving approved boundaries.

## Approved Boundaries

Respect the current approved boundaries unless Patrick explicitly expands scope:

- No API/runtime wiring for durable clinical events unless already approved.
- No Redis, Redka, Colyseus, bitECS, WebTransport, QUIC, Web3, cloud services, paid APIs, production deployment, or production-readiness claims unless explicitly approved.
- No Quest readiness claims until the manual worn-headset evidence clears the documented frame pacing, trace interaction, locomotion, and latency gates.
- No clinical validity, licensure, ECFMG, USMLE, diagnosis, or high-stakes scoring claims.

## IWSDK Continuation Requirement

Do not forget the approved IWSDK sidecar track when working on XR, Quest, input, locomotion, spatial UI, browser evidence, or agent-assisted runtime debugging.

Before choosing or completing a Worker 9 XR slice, explicitly consider whether the existing IWSDK sidecar can provide useful local evidence, tooling, parity checks, emulation, or implementation guidance. Use it when it materially advances the slice and stays inside approved boundaries.

Approved IWSDK posture:

- Keep IWSDK sidecar-only unless a future proposal explicitly promotes production adoption.
- Use `apps/arena/ui-xr-iwsdk-spike`, `packages/openclinxr/arena/iwsdk-spike`, and the documented IWSDK evidence commands as the allowed work areas.
- Keep physical Quest 3 foreground evidence as the required source for readiness claims; IWSDK and IWER evidence are supporting/emulation evidence only.
- Do not add IWSDK packages to `apps/ui-xr`, shared production packages, default startup, or broad verification unless explicitly approved.
- Latest observed IWSDK package metadata remains sidecar-gated: `@iwsdk/*` packages are current at `0.4.2`, but Vite plugins still peer on `vite: ^7.0.0` while the repo uses Vite `8.0.10`; do not promote IWSDK runtime adoption from package freshness alone.
- Respect the existing IWSDK gates for exact package versions, sidecar-only devtools, package weight, license posture, Vite/Node compatibility, native dependency exceptions, and metadata/source evidence.
- If IWSDK is not used for an XR slice, record the reason briefly in `PROJECT_STATUS.md` or the worker backlog so the decision is explicit rather than forgotten.

## SOLID for agentic context, not ceremony

When continuing OpenClinXR implementation work, apply SOLID principles only when they reduce context load and make product boundaries easier for future agents to understand.

- Prefer cohesive, intention-revealing modules for admin panels, API route groups, readiness summaries, review projections, persistence projections, and provider/runtime boundary surfaces.
- Extract from long files opportunistically while touching a surface, especially when the extraction lets future agents read one focused file instead of a broad orchestration file.
- Keep orchestration files thin, but do not introduce speculative factories, generic plugin layers, or abstract adapters before real variants exist.
- Preserve explicit product language over clever indirection; future agents should be able to see learner-launch gates, provider gates, asset-release gates, and evidence boundaries without chasing wrappers.
- Do not turn refactoring into a standalone loop. Each extraction should protect a recently touched surface, unlock a product slice, or reduce repeated read scope for approved ongoing work.

## Heartbeat continuation correction - 2026-05-23

- Heartbeats are continuation triggers, not status checkpoints.
- On any heartbeat or automation wake-up, do not respond with only a quiet status message unless no filesystem/tool access is available.
- Before replying to a heartbeat, perform at least one small productive approved slice from `PROJECT_STATUS.md` or `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
- After the slice, run focused verification for touched files/packages when appropriate, update the relevant plan/status docs, record nonblocking questions in `operator-open-questions.md`, and continue to the next approved slice if context/time remains.
- Do not treat visual QA captures, evidence reports, doc updates, or focused verification as stop points.
- If a true blocker appears, write it to `operator-open-questions.md` with a recommended default and pivot to another productive approved lane instead of stopping in chat.
- Only stop when the user explicitly says pause/stop, or when every approved lane is complete and no productive local work remains.

## Persistent Humanoid Emotion-Expression Loop

When working on humanoids, dialogue, animation, generated assets, runtime evidence, or visual QA, preserve this iterative self-improvement loop after context compaction:

1. Treat emotional expression as a runtime behavior, not only a static mesh or morph-target inventory.
2. Align expressions with scenario/dialogue emotion, including pain, anxiety, concern, reassurance, grief, confusion, and escalation where scenario metadata supports it.
3. Prefer smooth transition curves between affect states over step changes or speech-only brow/cheek coupling.
4. Keep mouth/viseme motion, brow/cheek tension, eyelid/blink behavior, eye gaze, gaze aversion, head orientation, and body posture tied to the active emotion state where safe.
5. Use adversarial repo agents, especially UX friction, clinical safety, implementation-gap, XR systems, and asset-pipeline roles, to critique whether evidence proves meaningful affect transitions or only generic facial activity.
6. Capture or attach screenshot/video/runtime evidence when it verifies a just-touched expression behavior or exposes the next quality gap.
7. Do not claim clinical affect validity, scoring validity, production facial animation quality, or Quest readiness from local/static evidence.
8. After each expression slice, either improve runtime behavior, generator contract, bundle metadata, or evidence quality, then immediately continue to the next product-advancement slice unless a stop condition is reached.
