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

`docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md` is protected coordination policy. Autonomous agents, live subagents, repo-defined agents, and routine implementation workers must not delete, weaken, bypass, rename, or reinterpret it.

`docs/openclinxr/doc-authority-registry-2026-05-27.md` and `docs/openclinxr/doc-authority-registry-2026-05-27.json` classify Markdown files by authority. Agents must consult the registry before treating Markdown outside the canonical control surfaces as active instructions.

`docs/openclinxr/generated-artifact-registry-2026-05-27.md` and `docs/openclinxr/generated-artifact-registry-2026-05-27.json` classify generated non-Markdown artifacts. Agents must consult the registry before deleting, ignoring, or committing generated JSON, screenshots, local cache outputs, or runtime asset artifacts.

`docs/openclinxr/openclaw-runbook-2026-05-27.md` is the protected OpenClaw runbook for unattended repo-native execution.

`docs/openclinxr/openclaw-tool-adapters-2026-05-27.md` is the protected host-adapter guide for running OpenClaw across Codex, Claude, Grok, Cursor, and other agent tools. It defines host prompts, capability fallbacks, and Drift Police rules for tool-agnostic execution. It defines the Required Per-Slice Record, canonical automation prompt, and `pnpm docs:drift-check` guard. Agents must not delete, weaken, bypass, rename, or reinterpret it.

OpenClinXR is not a collection of handcrafted XR scenes. OpenClinXR is a blueprint-driven encounter factory. The encounter specification/blueprint must drive environment, actors, conversation tooling, emotion state, locomotion, gaze/lip-sync, clothing, equipment, interactions, traces, persistence, review packets, provider gates, shared asset reuse, and runtime/screenshot evidence.

Conversation tooling is first-class. Actor dialogue policies, learner utterance/action intake, turn-taking, interruptions, emotion transitions, trace tags, replayable actor turns, and review-safe conversation evidence must not be displaced by one-off asset or screenshot work.

Before starting a slice, apply the guardrail slice gate in `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md`. If a slice does not advance blueprint-to-runtime generation, conversation/runtime tooling, reusable generated assets, review/persistence/replay, or verification of touched factory behavior, do not do it.

The design should stay grounded in the original research and technology direction captured in repo docs and proposals, including virtual patient/standardized-patient literature, former Step 2 CS-style workflow knowledge, TypeScript/React/Hono/Bun/MongoDB/WebXR stack preferences, open-source-first tooling, and avoidance of AGPL/copyleft or cloud/paid dependencies unless explicitly approved.

## Required Resume Sequence

At the start of any new session, after any context compaction, and before deciding whether to stop:

1. Re-read this `AGENTS.md`.
2. Read `PROJECT_COORDINATION_INDEX.md`.
3. Read `AUTONOMOUS_WORK_PLAN.md`.
4. Read `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
5. Select the next approved local deterministic product-advancement slice from those docs.
6. Continue implementation unless a stop condition below is reached.

If context is compacted or feels incomplete, do not finalize. Re-read these files and continue from the documented next slice.

## Efficient Rehydration + Working Model for Agentic Use (Grok/Codex/other)

The snapshots at the top of `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, and `docs/openclinxr/worker-backlog-and-validation-matrix.md` (added 2026-05-28) are the fast-path context. Read only the first ~60-80 lines of each for continuation unless full history or audit is required. This keeps rehydration low-token and effective while preserving the full ledger.

Current working model (original mission + OpenClaw adaptation):
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

**New Owner Efficiency Overhaul (2026-06):** As owner, purged historical bloat for utmost productivity: iterations/0001-0008 + proposals/ + docs/superpowers/ + 80+ historical-synthesis md + 300+ old dated png/json artifacts from docs/openclinxr/ (screenshots/evidence/ full purge of pre-05-28 visuals; 39M->6M). agents/ slimmed from 70 roles/555 files to 9 core (chief-coordinator, openclaw-drift-police, implementation-plan-gap-attacker, implementation-planning-lead, asset-pipeline-lead, xr-systems-architect, vp-engineering-delivery, pediatrics-physician, clinical-safety-critic) + historical-roles/ archive (or purged). Registries auto-slimmed (historical-synthesis 84->10, generated 819->440, agent-memory 140->18). Ledgers use snapshots + tail|grep; no full reads. Full iteration loop deprecated for routine (synthesis only; 0009 kept as rare example). Core policy: if not advancing current product (UI-XR consumer + materialization) or enabling sustained OpenClaw autonomy on M1 Max, purge or consolidate. Always: targeted grep/read_file(limit), lease, focused -t, post-slice guards, per-slice records. Rehydrate now <5s effective. Update this section on future evolutions.

To achieve hyper-optimized state for long-running, low-interruption, token-efficient agent work (Grok/Codex/Claude/etc. over days):

**Rehydration (always first, low token):**
- Read *only* the "Current State Snapshot" blocks (first 20-80 lines) in PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, worker-backlog-and-validation-matrix.md + AGENTS top.
- For history/audit only: use terminal `tail -50 FILE | grep -E '(Next queued|Product path|Blueprint/factory)'` or `tail -100 FILE` – never full read unless synthesizing iteration.
- Use `read_file` with `offset` + `limit` (e.g. limit=30) on any file >100 lines.

**Searches & Evidence (avoid bloat):**
- Always prefer the `grep` tool (with `path`, `glob`, `head_limit`, `-B`/`-A`) over `read_file` or `cat` for code/docs exploration.
- For generated artifacts: use `grep` or terminal `ls docs/openclinxr/ | grep peds` + read specific registered JSONs only; do not walk 800+ files manually.
- For tests/verif: `pnpm --filter ... test -- -t "exact test name substring"` (focused, fast, low output).
- `pnpm exec biome check specific/file.ts` not whole.

**Commands for speed/longevity:**
- Cheap guards first: `pnpm agent:alignment` (0.5s) before any `agent:verify` or full hygiene.
- Long run: `pnpm openclaw:lease -- acquire --owner <you> --slice <current> --ttl-minutes 60` before edits; release after state update. Use `pnpm openclaw:lease -- status`.
- Preflight for days-long: `pnpm openclaw:preflight && pnpm docs:drift-check && pnpm openclaw:lease -- status`.
- Post every slice: `pnpm openclaw:post-slice`.
- Get external scheduler prompt: `pnpm openclaw:automation-prompt` (for Codex heartbeat, cron, or AI scheduler_create for recurring "rehydrate + one slice + record").
- Use AI `scheduler_create` + `monitor` tools (this env) for persistent background heartbeat/lease watch without chat blocks.
- `pnpm docs:artifacts` only after coherent batch that produces new registered outputs.

**State & No-Interruption:**
- All durable state ONLY in the 3 canonical md (snapshots + per-slice records) + registered artifacts + agents/** memory + .agent-factory reports. Never chat-only or temp md.
- On heartbeat/force-response/compaction/recovery: re-read snapshots (4 files), `git status --short`, `pnpm openclaw:lease -- status`, repair current if lease allows, else pivot to next from queue. Record recovery in next slice record.
- Lease prevents overlapping edits across heartbeats/agents.
- For subagents: always one coordinator first (read-only), narrow non-overlap, map to repo roles, close threads promptly, integrate to state files.
- Anti-interruption: small slices only (<1h ideal), immediate next after record+verify. Use focused verif only on touched.

**Token Saving in this session (Grok specifics):**
- Parallel tool calls for independent reads/greps.
- `run_terminal_command` with `timeout` short, `description` concise.
- Never output full long command results unless delta; use `| tail -N` or `| head`.
- For image/screenshot review: use when verifies touched behavior only.
- If context feels full: stop, re-read only snapshots, continue product without summary chat.
- Prefer edit with `search_replace` (exact old->new, unique) over write new.

**Drift/Toil Prevention (hyper guard):**
- Never 2+ evidence-only without drift review + coordinator consult + product pivot.
- `pnpm agent:alignment` catches stale breadcrumbs in docs.
- Use `agents/adversarial/openclaw-drift-police/` (read charter+memory) on any suspicion of sprawl or one-off.

Violating these increases token use, risk of drift, and interruption. These practices make multi-day unattended completion feasible with minimal context.

## Instruction Source-Of-Truth Order

Use this order when repo docs appear scattered or disagree:

1. `AGENTS.md` is the operating contract.
2. `PROJECT_COORDINATION_INDEX.md` is the coordinator dashboard for active product direction, sub-agent control, and drift correction.
3. `AUTONOMOUS_WORK_PLAN.md` is the active continuation plan. Its active product-advancement queue overrides old chronological "next slice" breadcrumbs.
4. `docs/openclinxr/worker-backlog-and-validation-matrix.md` is the worker ownership and validation map.
5. `operator-steering-needed-questions.md` contains true blockers and hardware/operator instructions.
6. `operator-open-questions.md` contains nonblocking steering questions and recommended defaults.
7. `docs/agent-factory/**`, `agents/**`, and `iterations/**` are persistent multi-agent memory and governance evidence. Use them to realign task selection, not to restart broad planning loops unless the active plan explicitly calls for one.
8. Historical evidence reports, benchmark outputs, and old iteration "go-forward" notes are evidence, not active marching orders.

When an older file says to refresh evidence but the active plan says to build product capability, build product capability unless the evidence refresh unlocks that build.

## Autonomous Continuation Rule

Do not treat any of the following as a stopping point:

- A completed implementation slice.
- A focused verification pass.
- A benchmark smoke pass.
- A documentation/status update.
- A progress checkpoint.
- A context-summary or compaction checkpoint.

Do not send chat progress updates, status updates, checkpoint summaries, file-change summaries, test summaries, "what changed" summaries, or final responses during autonomous work. None of that should take place in chat. Status belongs in `AUTONOMOUS_WORK_PLAN.md` and `docs/openclinxr/worker-backlog-and-validation-matrix.md`, not in chat.

After each completed slice:

1. Update `AUTONOMOUS_WORK_PLAN.md`.
2. Update `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
3. Run focused verification for touched packages when appropriate.
4. Record nonblocking questions in `operator-open-questions.md` with a recommended default.
5. Immediately choose the next approved local deterministic slice and continue.

Final responses are disabled for autonomous continuation except when a stop condition is reached, Patrick explicitly asks for a status/explanation/prompt, or the platform requires a response to a direct user question. Progress updates, status updates, file-change summaries, test summaries, and checkpoints do not exist as chat events; they are file updates only.

## Days-Long Unattended Autonomy Contract

This repo can only sustain days-long autonomy through repeated rehydration, durable file-backed state, and automation/heartbeat continuation. A single Codex turn is not a durable background process: it may stop because the platform requires a response, context compacts, a tool session ends, a heartbeat arrives, or a plugin/skill workflow introduces an approval checkpoint.

The most common apparent "stop" is a heartbeat turn ending with the required heartbeat XML response. That response is a platform boundary, not project completion. On the next heartbeat or user continuation, rehydrate from the repo docs and continue the next approved slice instead of explaining status.

When Patrick asks for unattended or multi-hour/multi-day work:

- Treat the request as approval to run the repo autonomous loop until a stop condition in this file is reached.
- Rehydrate from `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, and `docs/openclinxr/worker-backlog-and-validation-matrix.md` before selecting work if context may have compacted.
- Do not wait for chat confirmation after a slice, verification pass, screenshot, evidence review, doc update, or heartbeat.
- If a tool, skill, plugin, or methodology asks for approval, require chat approval only for new scope, destructive operations, paid/cloud/API use, production deployment, credentials, physical hardware action, runtime dependency changes, or an explicit user-requested planning gate. For already-approved local deterministic slices, record assumptions/defaults in operator files and continue.
- If context compacts, re-read the resume docs and continue; do not infer completion from compaction.
- Before long unattended runs after cleanup or suspected drift, run `pnpm docs:drift-check` and apply the required per-slice record in `docs/openclinxr/openclaw-runbook-2026-05-27.md`.
- If a heartbeat arrives, perform at least one productive approved slice before any heartbeat response unless all lanes are blocked.
- If the platform forces a response, keep it minimal and continuation-oriented; do not summarize files changed or ask whether to continue unless a stop condition is reached.
- Every batch ends by selecting the next approved slice, not by reporting completion.
- Durable status belongs in repo docs and operator files, not chat.

Unattended loop:

1. Select the highest-value lane from `PROJECT_COORDINATION_INDEX.md` and `AUTONOMOUS_WORK_PLAN.md`.
2. Implement the smallest coherent product-advancement slice.
3. Run focused verification for touched packages when appropriate.
4. Capture visual/runtime evidence only when it verifies changed behavior or unlocks the next implementation decision.
5. Update `AUTONOMOUS_WORK_PLAN.md`, `docs/openclinxr/worker-backlog-and-validation-matrix.md`, and any relevant evidence/operator files.
6. If blocked, record the blocker with a recommended default, then pivot to another approved lane.
7. If two evidence-only slices happen consecutively, force the next slice to be a product-building or pipeline-hardening slice.
8. Continue without asking whether to continue.

## OpenClaw-Style Repo-Agent Activation

This repository has an OpenClaw-style, file-backed agent system under `agents/**`, `docs/agent-factory/**`, `iterations/**`, `.agent-factory/**`, and `packages/openclinxr/agent-loop`. It is activated by repo commands and memory files, not by merely existing on disk.

For Codex-specific tool alignment, also use `docs/openclinxr/codex-openclaw-operating-bridge-2026-05-27.md`. That bridge maps current Codex capabilities, live subagents, Browser screenshots, local execution, and repo-native agent-factory commands back to this operating contract.

Activation status:

- Active as persistent repo memory: yes. Agent charters, memories, indexes, scorecards, and iteration syntheses are committed and should steer work.
- Active as tooling: yes. `pnpm agent:alignment`, `pnpm agent:loop`, `pnpm agent:validate`, `pnpm agent:index`, `pnpm agent:maturity`, and related checks exist.
- Active as always-on autonomous runtime: no. There is no daemon that automatically spawns all `agents/**` roles on every slice.
- Active as live subagents: only when the current Codex environment exposes a subagent/multi-agent tool or when a repo command creates an agent-loop artifact. If no live subagent tool is available, simulate repo-defined agents by reading the relevant `charter.md`/`memory.md` files and recording the lens used.

Live subagent discovery rule:

- Before concluding that live subagents are unavailable, search the current tool environment for multi-agent/subagent tooling.
- If `multi_agent_v1` or equivalent tooling is available and Patrick has requested agent use, delegation, parallel review, or OpenClaw-style execution, use live subagents for bounded independent work that materially reduces drift or review cost.
- Map repo-defined roles onto live subagent prompts. Example: an `explorer` can act as Chief Coordinator or Gap Attacker for a read-only drift check; a `worker` can act as Asset Pipeline Lead or XR Systems Architect for a disjoint implementation slice.
- Do not spawn agents for every heartbeat by default. Spawn when there are independent review/implementation tasks, when drift is suspected, or after repeated evidence/gate-only slices.

OpenClaw orchestration-agent rule:

- When Patrick asks for OpenClaw-style multi-agent execution or after context compaction during autonomous work, create or simulate a coordinator/orchestration agent before broad multi-agent execution.
- The orchestration agent does not implement product code, patch files, run routine verification, or own a product slice.
- The orchestration agent only maintains mission alignment, checks in on progress, assigns independent tasks, chooses independent slices, maps repo-defined roles to live/local agents, prevents overlapping write scopes, watches for toil/drift, criticizes repeated tests or isolated code that do not create tangible product advancement, and recommends when agent threads should be closed.
- The main Codex worker remains responsible for implementation, verification, doc updates, and closing live subagent threads once their outputs are consumed.
- If live subagent tooling is available and Patrick has requested this mode, spawn the orchestration agent as a narrow read-only `explorer`/coordinator. Then spawn narrowly scoped specialist or adversarial agents only where they materially reduce drift, review cost, or implementation risk. If live subagent tooling is unavailable, simulate it by consulting `agents/coordinator/chief-coordinator/**`, `agents/core/implementation-planning-lead/**`, and the active worker role memories, then record the orchestration decision in the plan docs.
- Every live subagent prompt must explicitly name `/Volumes/files/src/openclinxr` as the target repo and must first confirm that `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, `docs/agent-factory/**`, `agents/**`, and `tools/agent-factory/**` are present before drawing repo-native conclusions. If a subagent reports from another cwd, close it as stale and do not use its findings.
- Rehydration after compaction: immediately after reading this file, restore this pattern before selecting work: coordinator/orchestration agent first, then independent specialist/adversarial agents only where they materially reduce drift or review cost, while local implementation continues on non-overlapping work.
- Before completing any slice, repeat this instruction internally and start the next slice: keep going; use focused subagents with one non-coding coordinator; keep driving toward the case-definition-driven factory that builds hyper-realistic WebXR encounters with humanoids acting out case roles complete with locomotion, expression, interactivity, and changing emotion state; use codebase evidence and screenshots for adversarial review; keep chat minimal; do not treat unit tests or isolated code as sufficient proof of progress; full end-to-end running software is the goal.

Mandatory agent use rules:

- After any context compaction, suspected drift, or two consecutive evidence/gate-only slices, consult at least the Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, and VP Engineering Delivery memories/charters before selecting the next slice.
- When suspected drift involves scattered artifacts, one-off encounter work, evidence toil, weakened guardrails, wrong-cwd subagents, or noncanonical process, consult `agents/adversarial/openclaw-drift-police/charter.md` and `agents/adversarial/openclaw-drift-police/memory.md`, run or request `pnpm docs:drift-check`, apply the smallest correction, and pivot back to a product slice.
- For XR/humanoid/asset work, also consult XR Systems Architect and Asset Pipeline Lead memory/charter when the next slice changes runtime behavior, visual evidence rules, generated assets, rigging, animation, Quest/WebXR posture, or IWSDK posture.
- For scenario-bank, clinical, scoring, review, or safety language changes, consult the relevant physician/simulation, psychometric, clinical-safety, legal/compliance, and security/privacy agents.
- When live subagent tools are available, spawn narrow non-overlapping agents for independent review or implementation only when they materially reduce drift, review cost, or implementation risk.
- When live subagent tools are unavailable or more expensive than local work, perform a "repo-agent consultation" locally by reading the relevant role memory/charter and writing the role decision into `AUTONOMOUS_WORK_PLAN.md` or the worker backlog.
- Do not run the full agent-factory loop for routine implementation. Run or dry-run `pnpm agent:loop` only when broad planning, leadership/adversarial synthesis, plateau recovery, or major direction changes are needed.

## Case-Definition-Driven WebXR Realism Loop

The active product north star is a case-definition-driven encounter factory. Scenario definitions should drive generated assets, actor roles, dialogue, emotion state, locomotion/posture, gaze, lip-sync, interactivity, equipment, environment props, review gates, and runtime evidence. Avoid hardcoded one-off scene behavior unless it is an explicitly labeled deterministic local fallback that is being converted back into factory metadata.

For humanoid/XR/asset work:

- Keep pushing toward hyper-realistic WebXR encounters where humanoids act out case-defined roles, including locomotion or posture changes, facial expression, gaze, lip-sync, interactivity/collision affordances, and changing emotional state.
- Use evidence in the codebase to refine the next implementation, especially screenshots, browser evidence JSON, runtime scene evidence, visual QA reports, and adversarial review notes.
- Do not accept unit tests as the sole proof of progress. Focused tests are useful, but product advancement requires running software evidence when the slice changes runtime, UI, XR, scene, humanoid, or asset behavior.
- Prefer end-to-end local browser/runtime evidence, screenshots, generated bundle evidence, or admin/review workflow evidence over isolated code assertions whenever feasible and inside approved boundaries.
- Use adversarial agents to compare screenshots/evidence against the intended encounter representation and identify concrete realism gaps before broad new planning.
- If a slice only adds tests, validators, or metadata and does not move a learner/faculty/admin/runtime/factory path closer to executable behavior, the orchestration agent should treat it as suspect and select a tangible product slice next.
- Keep chat output minimal. Store status, evidence, and next-slice handoff in `AUTONOMOUS_WORK_PLAN.md` and `docs/openclinxr/worker-backlog-and-validation-matrix.md`.

## Stop Conditions

Only stop and send a final response when one of these is true:

- All currently approved work in `AUTONOMOUS_WORK_PLAN.md` is complete.
- Every currently approved productive work lane is blocked after recording each blocker in the operator question files.
- Patrick explicitly says to pause or stop.

Do not ask "should I continue?" unless one of those stop conditions is reached.

If Patrick asks to "continue", "keep going", "work autonomously", or similar, do not send a final response after the next slice. Continue until a true stop condition is reached.

## Blocker Handling And Pivot Rule

A blocker is not normally a stop condition.

When a slice is blocked by credentials, hardware action, paid/cloud/API use, destructive operation, production deployment, local trust/security change, or scope beyond approved proposals:

1. Add the blocker to `operator-steering-needed-questions.md` if it truly blocks a required decision or action.
2. Add nonblocking steering to `operator-open-questions.md` with a recommended default.
3. Mark the blocked lane in `AUTONOMOUS_WORK_PLAN.md` or the worker backlog with the smallest useful next operator action.
4. Immediately pivot to another approved product-advancement lane that can produce demonstrative progress toward the OpenClinXR project goal.

Only stop for blockers if all approved product-advancement lanes are blocked and no safe local deterministic slice remains.

## Low-Token Autonomy

Operate in LOW_TOKEN_AUTONOMY mode unless Patrick explicitly changes the mode.

- Minimize chat output.
- Do not narrate routine progress.
- Prefer targeted `rg`/`sed` reads and small patches.
- Avoid broad repo scans and repeated file reads.
- Keep status and handoff context in `AUTONOMOUS_WORK_PLAN.md` and the worker backlog.
- Do not summarize successful command output unless it changes the next decision.

## Anti-Toil Product Advancement Gate

Do not let verification, benchmark refreshes, evidence ledgers, or repeated review loops become the work.

Before selecting a slice, apply this gate:

- The slice must directly advance the Step 2 CS-inspired multi-station XR clinical-skills exam skeleton, or unblock a named product slice that cannot safely proceed without the evidence.
- Evidence-only work is allowed when it verifies a just-touched package, captures a newly available hardware/runtime fact, or closes a specific leadership gate that is blocking an implementation decision.
- Evidence-only work is not allowed merely to make stale reports fresher, reduce red in aggregate dashboards, rerun known-failing gates, or restate already-known blockers.
- After one evidence-only slice, the next slice should normally be product construction: scenario bank, exam assembly, station runtime, admin review workflow, XR interaction, persistence integration, provider facade safety, or asset-pipeline implementation.
- After two consecutive evidence/validation-only slices, force a Chief Coordinator plus Implementation Plan Gap Attacker review using `agents/**`, `docs/agent-factory/**`, and the latest `iterations/iteration-*/07-final-synthesis.md`; then choose a build slice unless a true blocker prevents all approved build work.
- Run aggregate benchmark rollups at most once after a coherent batch of changes, not after every small validation, unless the aggregate result changes the next implementation decision.
- Prefer “make a learner/faculty/admin flow more complete” over “make a report more current” when both are safe.

Useful self-check:

- If the output only says “still blocked” and no product behavior, contract, fixture, UI, or runtime path improved, it was probably toil.
- If the output makes a future implementation safer, more connected, or more observable, it is likely productive.

## Repo-Defined Agents And Worker Roles

Use the worker backlog as the source of truth for ownership and slice boundaries.

Use repo-defined agents or spawned subagents only when they materially reduce local exploration, implementation, or review cost. Otherwise continue locally in LOW_TOKEN_AUTONOMY mode.

Repo-defined agent memory and iteration artifacts are not optional background decoration. Use them as the local substitute for persistent multi-agent memory when task selection feels unfocused, after compaction, or when repeated evidence work risks becoming toil.

Minimum repo-native agent context for realignment:

- `docs/agent-factory/README.md`
- `docs/agent-factory/operating-loop.md`
- `docs/agent-factory/model-assignment-policy.md`
- `docs/agent-factory/rubric.md`
- Latest `iterations/iteration-*/07-final-synthesis.md`
- Relevant `agents/**/charter.md` and `agents/**/memory.md` for the active worker slice.

Agent usage should serve the original team-of-agents request. The default mental model is:

- Coordinator/leader agent: maintains mission, boundaries, priorities, plan docs, and final synthesis.
- Specialist implementation agents: own independent worker slices such as schema, domain, fixtures, review, API, XR, provider gateways, assets, MongoDB, security, and test harness.
- Adversarial agents: review outputs for holes, overclaims, unsafe assumptions, feasibility gaps, missing tests, licensing risk, Quest performance risk, persistence issues, UX gaps, and clinical-safety wording problems.
- Senior-leadership agents: challenge the approach on feasibility, efficiency, maintainability, scope control, evidence quality, and whether the next slice advances the original product goal.

Model assignment guidance:

- Use fast/cheap models for targeted repo exploration, mechanical validation, and narrow test/doc patches.
- Use stronger coding models for cross-package implementation, persistence semantics, architecture rules, and high-risk refactors.
- Reserve the strongest/highest-reasoning models for architecture synthesis, adversarial critique, senior-leadership review, and ambiguous product/technical tradeoffs.
- Do not use subagents when a local targeted read/patch is cheaper and clearer.

When using agents:

- Scope each agent to one independent worker slice or one focused review question.
- Avoid overlapping write scopes.
- Tell agents the repo is shared and they must not revert unrelated changes.
- Tell agents to respect approved boundaries in `AUTONOMOUS_WORK_PLAN.md`.
- Continue local non-overlapping work while agents run.
- Integrate agent results into the plan/status docs before moving on.

Worker roles in `docs/openclinxr/worker-backlog-and-validation-matrix.md` are always useful as an ownership map. They do not require spawning agents unless that is more efficient than local work.

## Persistent Memory And Scoring

Persistent memory for this repo is file-backed and indexed through the planning/status documents. Keep it concise, searchable, and actionable.

Primary memory files:

- `AGENTS.md`: durable agent operating contract.
- `AUTONOMOUS_WORK_PLAN.md`: current state, continuation defaults, completed slices, and next work.
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`: worker ownership, validation matrix, evidence, and done conditions.
- `operator-steering-needed-questions.md`: true operator blockers and approved scope.
- `operator-open-questions.md`: nonblocking questions with recommended defaults.
- `operator-suggestion-backlog.md`: remembered suggestions that are not yet approved scope.

Each meaningful iteration should leave behind:

- What changed.
- What evidence passed.
- What risk remains.
- What next slice is recommended.
- Which agent/team role would own it.

Use an improvement rubric when producing or revising architecture/design/spec outputs:

- Mission alignment: advances the sequenced XR clinical-skills exam goal.
- Evidence quality: grounded in repo artifacts, tests, approved proposals, and cited research where needed.
- Feasibility: executable on current stack/hardware without unapproved cloud, paid APIs, or production claims.
- Safety and claim control: avoids licensure, diagnosis, exam-equivalence, or validation overclaims.
- Architecture completeness: covers UX, data, state, sequence, persistence, agents, assets, QA, and observability.
- Testability: has deterministic local tests, benchmark gates, or evidence artifacts.
- Asset realism path: accounts for characters, skin, clothing, equipment, animation, optimization, provenance, and licensing.
- Quest/WebXR performance posture: keeps frame pacing, comfort, locomotion, input, and headset evidence separate from emulation.
- Maintainability: clean package boundaries, small slices, and clear worker ownership.

If a slice does not improve at least one rubric dimension, choose a better slice.

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
- Use `apps/ui-xr-iwsdk-spike`, `packages/openclinxr/iwsdk-spike`, and the documented IWSDK evidence commands as the allowed work areas.
- Keep physical Quest 3 foreground evidence as the required source for readiness claims; IWSDK and IWER evidence are supporting/emulation evidence only.
- Do not add IWSDK packages to `apps/ui-xr`, shared production packages, default startup, or broad verification unless explicitly approved.
- Latest observed IWSDK package metadata remains sidecar-gated: `@iwsdk/*` packages are current at `0.4.1`, but Vite plugins still peer on `vite: ^7.0.0` while the repo uses Vite `8.0.10`; do not promote IWSDK runtime adoption from package freshness alone.
- Respect the existing IWSDK gates for exact package versions, sidecar-only devtools, package weight, license posture, Vite/Node compatibility, native dependency exceptions, and metadata/source evidence.
- If IWSDK is not used for an XR slice, record the reason briefly in `AUTONOMOUS_WORK_PLAN.md` or the worker backlog so the decision is explicit rather than forgotten.

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
- Before replying to a heartbeat, perform at least one small productive approved slice from `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, or `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
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
