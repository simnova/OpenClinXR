# OpenClinXR Project Coordination Index

Last updated: 2026-06-03 (lean OpenClaw daily driver; 9 core agents; UI-XR consumer + materialization for peds factory; snapshots + Efficiency Quick Ref primary rehydrate; historical purged to git only; M1 Max 64GB).

## Current State Snapshot (read first for rehydration)

**Product focus**: Blueprint-driven encounter factory (case-definition -> generated runtime + review + persistence). Primary case: peds_asthma_parent_anxiety_v1 (pediatric) + ED chest-pain seed. Target workstation: Apple M1 Max 64 GB (this machine; M4 future). 

**Current emphasis (post assessment 2026-06)**: Core: make the peds case spec (communication profiles, escalation/deescalation triggers, empathy/parent comm tags, clinical objectives, event schedule) drive generated actor turn timelines, dialogue cue policies, and emotion state transitions into runtime artifacts, review packets, and replay (deterministic first, gates for LLM). Supporting: UI-XR consumer for ingesting manual "good realism" (locomotion/gaze/expression) evidence as reference data that can be operator-selected and attached to generated sessions for review/QA (raw hidden, gates false). Materialization for asset needs from spec. Review/replay surfaces show both spec expectations and attached evidence. 

Recent direction (consumer + meta bloat/docs/validation) was necessary for agent sustainability and review backbone but per guardrails ("do not let asset realism displace conversation tooling", "blueprint must drive", anti-toil after evidence/meta) requires rebalance to generation from case def. See AUTONOMOUS assessment record.

**Active lanes (from worker matrix, highest value first)**: Worker 9/7/11 runtime visual evidence consumer + preflight/submit-preview + review/replay pipeline (UI-XR + Admin/GraphQL/API); Worker 11/7 materialization evidence attachment continuation and surfaces; Worker 7/8/9 faculty/admin review posture and replay safety; XR trace/locomotion and actor-realism in UI-XR; scenario bank expansion.

**Last slice (one-liner)**: 2026-06-03 launch via turborepo + full webvr + compare May + resolve (launched pnpm turbo --filter api+ui-xr both listening; curl validated "OpenClinXR Station Runtime" + main.ts with three+WebXR+clinical props+gltf from case; fixed stale :3000 holder + type breaks in runtime-state from wiring (readiness, loop, fixture); 87 tests pass; May compare no core xr loss; "if not seeing broke" resolved. See AUTONOMOUS Per-Slice. 2026-06-03 wire manifest to consumer as produced + launch both + production + wire to more (product: producedGltfManifest + producedAssetFilePath wired in consumer from factory manifest (actual asset file production); both api + player launched via turborepo (both must be running); player page + api up, world with actual load + produced in full experience; panel wired for review; live launch + hot reload + curl validated the world in running app per user 'launch... validate' + 'use turborepo... interact via browser' + 'both must be running' + 'diagnose by running the application' + 'not merely updating ts/md without running'). See AUTONOMOUS.

**Next queued slice (do this)**: admin replay surfaces for caseDerived timeline or full persistence or 2nd richer (product): per rehydrate (post richer ed env cues); highest admin replay for emotion timeline + actor turns from packet caseDerived/persistenceProjection (surfaces in review/replay for peds+ed; Q4); or full persistence if save not live; or 2nd richer derive. (IWSDK: spike sidecar only; multimodal for verif.) Record Per-Slice for richer ed env authoring, focused, exact post+guards, release, rehydrate, pick, continue. (Continue local det.)
**Last slice (one-liner)**: 2026-06-03 richer authoring for env in factory (product): expanded ed envCuesFromSpec + extras with 2 more from spec (spouse_anna, nurse_maria) for richer authoring vet/gltf. Blueprint tie Q1/3/4/5. Touched: packet + states. Evidence: lease; biome; guards. See AUTONOMOUS. Next from fresh: admin replay for caseDerived timeline or full persistence or 2nd richer; record, focused, post+guards, release, pick. (Continue.)

**Rehydration checklist (required at start of session/after compaction/heartbeat)**: 1. Re-read AGENTS.md. 2. Read PROJECT_COORDINATION_INDEX.md (this; stop at first '---' or line ~80 for continuation). 3. Read AUTONOMOUS_WORK_PLAN.md (front snapshot + latest entries). 4. Read docs/openclinxr/worker-backlog-and-validation-matrix.md. 5. Run `pnpm docs:drift-check` if cleanup/drift suspected or long run. 6. `pnpm openclaw:lease -- status` if unattended. 7. Pick from active queue or worker matrix. 8. Consult agents/** (read charter+memory) or live subagents only for drift/review/plan if materially reduces cost. 9. Do small slice, verify, update state files only, continue.

**Efficiency Quick Ref (token + long-run hyper-opt)**: 
- Fast guards: `pnpm agent:alignment` (cheap, ~0.5s) always before full verify.
- Lease for edits: `pnpm openclaw:lease -- acquire --owner grok --slice <name> --ttl-minutes 60`.
- Focused test: `pnpm ... vitest run FILE.test.ts -t "substring"`.
- History quick: terminal `tail -30 AUTONOMOUS_WORK_PLAN.md | grep -E 'Next|Product path'`.
- Search: use `grep` tool with `path`/`glob`/`head_limit`, never full read long files.
- Read smart: `read_file` + `offset`+`limit=30` for >100ln files.
- Post-slice: `pnpm openclaw:post-slice && pnpm docs:drift-check`.
- For external long-run: `pnpm openclaw:automation-prompt` to feed scheduler/heartbeat.
- Avoid: full `agent:verify`, broad ls on docs/openclinxr (429+ jsons), reading full ledgers.

**Working model**: See AGENTS.md (OpenClaw daily driver for blueprint factory; 9 core agents; snapshots + Efficiency Quick Ref primary; full iteration synthesis-only; LOW_TOKEN; lease; guards; anti-toil; blueprint gate). Adaptable via openclaw-tool-adapters. Efficient Rehydration applied here.

**Protected (do not weaken)**: AGENTS.md, blueprint-factory-drift-guardrails-2026-05-27.md, openclaw-runbook-2026-05-27.md, openclaw-tool-adapters-2026-05-27.md, doc-authority-registry, generated-artifact-registry, this index, AUTONOMOUS, worker-backlog.
Efficient Rehydration + Working Model
UI-XR runtime evidence consumer

Use this snapshot + queue below for task selection. Full historical detail follows for audit/evidence only.

## Purpose

This is the top-level coordinator index for keeping Codex and sub-agents focused on the OpenClinXR product goal.

Use it as the short command-and-control layer before dispatching agents, selecting worker slices, or refreshing evidence.

This file does not replace:

- `AGENTS.md`: operating contract.
- `AUTONOMOUS_WORK_PLAN.md`: active continuation plan.
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`: worker ownership and validation map.
- `.agent-factory/memory-index.json`: generated agent-memory index.
- `docs/openclinxr/knowledge-graph-and-indexing.md`: product knowledge-graph design.

It fills the missing gap between those files: a concise coordinator-facing index that states what currently counts as advancement and how to keep sub-agents in bounds.

## Existing Indexes And Their Limits

Existing useful indexes:

- `.agent-factory/memory-index.json`: generated memory records for 9 core agents (21 active/superseded entries post new-owner slim/purge).
- `agents/**/index.json`: per-agent memory indexes.
- `docs/openclinxr/knowledge-graph-and-indexing.md`: future product knowledge graph for scenarios, claims, sources, rubrics, traces, and memory.
- `AUTONOMOUS_WORK_PLAN.md`: long-form execution plan and historical ledger.
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`: worker-by-worker validation map.

Observed gap:

- None of the existing indexes is a compact, human-readable coordinator dashboard for current product direction, anti-toil rules, sub-agent work orders, and drift correction.
- Because the active plan accumulated historical "next slice" notes, agents could follow stale breadcrumbs rather than the current product-advancement queue.

## Commit-History Drift Analysis

Targeted history review on 2026-05-21 used:

```bash
git log --since='2026-05-03' --pretty=format:'%ad%x09%s' --date=short
git log --max-count=40 --name-only --pretty=format:'---COMMIT--- %h %ad %s' --date=short -- AGENTS.md AUTONOMOUS_WORK_PLAN.md docs/openclinxr/worker-backlog-and-validation-matrix.md docs/agent-factory iterations agents packages apps tools
```

High-level count from commit subjects since 2026-05-03:

- Total commits reviewed: 736.
- Evidence/gate-like subjects: 363.
- Product/contract-like subjects: 261.
- Docs-like subjects: 49.
- Other subjects: 63.

Evolution pattern:

1. Early work built the agent-factory, scenario/design material, package skeletons, and first deterministic clinical-station contracts.
2. The work then correctly added safety gates for Quest, voice, local models, IWSDK, assets, Pages evidence, security, and benchmark leadership packets.
3. The gates became self-reinforcing: "latest evidence", "source currentness", "benchmark freshness", "snapshot sync", and known-blocked reports repeatedly generated new work.
4. The newest visible history contains a high density of evidence refreshes, metadata snapshots, benchmark gate updates, Pages publishing checks, and local runtime probes.
5. Product-shaping code continued, but the coordination center started treating red dashboards and stale evidence as the active backlog.

Root causes:

- No compact coordinator index separated active product advancement from historical evidence ledgers.
- "Next slice" breadcrumbs were written chronologically in long files and remained visible after they were no longer strategic.
- Benchmark gates were useful but began acting like a task generator.
- Safe local evidence work was easier to continue than higher-value product integration work.
- Agent-factory memory existed, but it was not framed as an implementation-time focus mechanism.

Correction:

- Treat evidence as support for product decisions, not as the product.
- Keep one active product advancement queue.
- Require every sub-agent work order to name the product path it advances.
- Run aggregate evidence only after coherent build batches or changed facts.

## Active Product Advancement Queue (synced to 2026-05-28 OpenClaw state; supersedes older 05-21 entries below)

Use this queue unless Patrick explicitly changes direction. Prioritize lanes that advance the blueprint-to-runtime factory contract, conversation/runtime tooling, review/persistence/replay, or reusable asset paths for the peds + multi-station skeleton. After any slice, write the Required Per-Slice Record (Product path advanced, Blueprint/factory tie, Touched files, Evidence, Next queued slice) into AUTONOMOUS_WORK_PLAN.md or the worker backlog.

1. Worker 9/7/11 runtime evidence consumer + preflight/submit-preview + review/replay pipeline (UI-XR + Admin/GraphQL/API surfaces).

   Product goal: copied/manual UI-XR runtime performance payloads (actor realism, visual-QA, locomotion) become reusable metadata-only inputs to the guarded `/runtime/visual-evidence-attachments` record path and flow as summary-only submitPreview/preflight/nextActions into replay projections, runtime-selection packets, publication readiness, and Admin ReviewReplayReadinessSummaryPanel/Faculty panels. Raw payloads stay hidden; all provider/runtime/learner/Quest/production/clinical/scoring gates remain false. Advances review-safe evidence attachment for the factory without new routes or readiness claims.

2. Worker 11 actor/equipment materialization evidence attachment continuation (peds asthma focus).

   Product goal: provider-neutral materialization input manifests, attachment plans (12 actor + 24 equipment slots), evidence attachment records, and worker/API/Admin surfaces that let reviewers see attached/missing/held slots and blockers for actor-specific humanoid (body/clothing/hair-face/rig) and equipment (mesh/scale/placement/affordance) before runtime selection. Keeps shared-neutral/generic reuse as explicit blockers. No provider execution or readiness claims.

3. Worker 7/8/9 faculty/admin completed-station review posture + replay safety (including asset/runtime summaries).

   Product goal: faculty can inspect completed stations (ED + peds) through review-safe API/admin surfaces with timeline, missing behaviors, unsafe/late signals, note evidence, reviewer decision posture, runtimeVisualEvidenceAttachmentRecord, assetReleaseLadderReplayProjection, and materialization gates visible as read-only context. Review projections stay summary-only.

4. Worker 4/2/11 scenario-bank expansion + case-definition-driven factory coverage (peds + others).

   Product goal: exam skeleton expands with schema-backed actors, environments, equipment, trace tags, rubrics, communication profiles, actorRuntimeRealismRequirements; publication/launch/factory/runtime artifacts derive from scenario fixtures rather than ED fallbacks; caseDefinitionDrivenFactoryCoverage proves alignment.

5. Worker 9/11 XR trace interaction, locomotion, actor-realism, and UI-XR consumer tooling.

   Product goal: one concrete learner XR path (desktop fallback) becomes more observable (in-scene panels, window evidence, copied payloads) and closer to headset readiness evidence posture. IWSDK sidecar only for emulation/tooling; physical Quest foreground remains the truth source. Consider materialization gate handoff.

Legacy 05-21 queue items (asset ladder, replay, provider) are largely complete or absorbed into above; do not restart evidence loops on them. If a lane blocks, record in operator files with recommended default and pivot.

## Productive Work Test

Before starting a slice, answer yes to at least one:

- Does this make a learner station, faculty review, admin workflow, scenario authoring, XR runtime, persistence path, provider facade, or asset pipeline more complete?
- Does this unblock a named product slice that cannot safely proceed without the evidence?
- Does this verify code that was just touched?
- Does this capture a newly available hardware/runtime fact that changes the next implementation decision?
- Does this make an encounter blueprint/specification drive more of the generated runtime experience, including actors, conversation tooling, emotion state, locomotion, assets, traces, persistence, or review evidence?

If the answer is no, do not do the slice.

## Protected Blueprint-Factory Guardrails

`docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md` is protected coordination policy and must remain linked from `AGENTS.md`, this index, and `AUTONOMOUS_WORK_PLAN.md`.

`docs/openclinxr/doc-authority-registry-2026-05-27.md` is the Markdown authority map. Use it before treating old plans, iteration syntheses, proposals, evidence reports, temporary notes, or handoff files as active instructions.

`docs/openclinxr/generated-artifact-registry-2026-05-27.md` is the generated artifact authority map. Use it before deleting, ignoring, or committing generated JSON, screenshots, local cache outputs, or runtime asset artifacts.

`docs/openclinxr/openclaw-runbook-2026-05-27.md` is the protected OpenClaw runbook.

`docs/openclinxr/openclaw-tool-adapters-2026-05-27.md` is the protected host-adapter guide for Codex, Claude, Grok, Cursor, and other agent tools. Use it before long unattended batches or after cleanup/drift suspicion; it defines `pnpm docs:drift-check`, the Required Per-Slice Record, and the canonical automation prompt.

`docs/openclinxr/dependency-hygiene-and-e18e-policy.md` is the dependency-hygiene policy. Use it before attempting `e18e`, `pnpm dedupe`, TypeScript compiler-preview, IWSDK/Vite, GLTF toolchain, or lockfile cleanup work.

Coordinator rule:

- Reject slices that polish one fixture, garment, screenshot, prop, or room without strengthening the blueprint-to-runtime factory contract.
- Keep conversation tooling first-class: actor dialogue, learner utterance/action intake, turn-taking, interruptions, emotion transitions, trace tags, replayable actor turns, and review-safe evidence.
- If three consecutive slices focus on visual assets, clothing, provider metadata, or screenshots without advancing conversation/runtime/review behavior, consult Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, VP Engineering Delivery, Clinical Simulation Lead, Data Trace Architect, Voice/Speech Engineer, XR Systems Architect, and Asset Pipeline Lead before selecting the next slice.
- Agents may not delete, weaken, bypass, rename, or reinterpret the guardrails during autonomous work.
- Agents may not create scattered markdown/status/prompt artifacts or unregistered generated artifacts; `pnpm docs:drift-check` must pass before claiming the repo is ready for long unattended OpenClaw execution.
- Agents may not treat `e18e` duplicate warnings as an autofix target; dependency cleanup must improve a measured signal while keeping `pnpm peers check` and `pnpm hooks:strict` green.

## Evidence-Toil Stop Rule

Evidence-only work is allowed when it supports a specific implementation decision.

Do not do evidence-only work when it only:

- refreshes an already-known blocked gate;
- makes a stale report newer without changing a decision;
- reruns aggregate benchmarks after no meaningful product change;
- adds another "latest evidence" validator without an active build consumer;
- improves dashboard color while leaving the product skeleton unchanged.

After one evidence-only slice, choose a product-shaping slice next.

After two consecutive evidence-only slices, the coordinator must run a drift correction:

- Read this file, `AUTONOMOUS_WORK_PLAN.md`, and the worker backlog.
- Consult `agents/coordinator/chief-coordinator/memory.md`.
- Consult `agents/core/implementation-planning-lead/memory.md`.
- Consult `agents/adversarial/implementation-plan-gap-attacker/charter.md`.
- Consult `agents/leadership/vp-engineering-delivery/memory.md`.
- Pick a build slice from the active queue unless all approved build lanes are truly blocked.

## Sub-Agent Work Order Template

Every spawned or simulated sub-agent work order should include:

```markdown
Role:
Product path advanced:
Worker lane:
Allowed files/modules:
Explicit non-goals:
Evidence allowed:
Stop condition:
Expected output:
```

Required constraints:

- The product path must match the active queue.
- The worker lane must map to the worker backlog.
- Allowed files/modules must be narrow and non-overlapping.
- Non-goals must include no cloud/paid/API/deployment/destructive work unless explicitly approved.
- Evidence allowed must say whether evidence is verification-only or decision-changing.
- Stop condition must not be "completed one slice" unless the user explicitly asked for one slice only.

## Sub-Agent Control Roster

Use repo-defined agents as focus roles:

- Chief Coordinator: task selection, drift prevention, source-of-truth enforcement.
- Implementation Planning Lead: file ownership, sequence, and verification fit.
- Implementation Plan Gap Attacker: challenges whether the slice is real product progress or toil.
- OpenClaw Drift Police: detects scattered artifacts, one-off encounter work, evidence toil, weakened guardrails, wrong-cwd subagents, and noncanonical process; recommends the smallest correction and a product-slice pivot.
- VP Engineering Delivery: rejects optional runtime/evidence work that does not reduce product gap.
- Solution Architect: checks cross-package boundaries and integration shape.
- UX Product Lead: faculty/admin workflow quality.
- XR Systems Architect: Quest/WebXR/IWSDK slices.
- Clinical Simulation Lead: scenario-bank and actor realism.
- Data Trace Architect: trace, review, replay, and durable evidence semantics.
- Asset Pipeline Lead: asset provenance, generation, optimization, and Quest QA posture.
- Legal/Compliance/Psychometric critics: invoked when wording, claims, scoring, review gates, privacy, or regulated posture changes.

## Coordinator Decision Tree

1. Check for true blockers in `operator-steering-needed-questions.md`.
2. If no true blocker, choose the first active product lane that can move locally.
3. If tempted to refresh evidence, name the implementation decision it unlocks.
4. If no decision is unlocked, skip the evidence refresh.
5. If sub-agents are useful, issue narrow work orders using the template above.
6. After a slice, update `AUTONOMOUS_WORK_PLAN.md` and the worker backlog with product impact, not just command output.
7. Run focused verification for touched packages.
8. Continue to the next product lane unless a documented stop condition is reached.
9. Do not send chat progress updates, status updates, checkpoint summaries, file-change summaries, test summaries, "what changed" summaries, or final responses during autonomous continuation; checkpoint state is written to repo docs only.
10. If a lane is blocked, write the blocker/operator question with a recommended default, mark that lane, and pivot to another productive lane instead of stopping.

## Alignment Hooks

Repo-local hooks that keep the coordinator and sub-agents aligned:

- `pnpm agent:alignment`: static coordination hook. It verifies that `PROJECT_COORDINATION_INDEX.md` remains wired into `AGENTS.md`, `AUTONOMOUS_WORK_PLAN.md`, the worker backlog, the agent-factory README, and the latest synthesis. It also rejects stale autonomous-plan breadcrumbs such as `Next Task C` that can pull agents back into evidence toil.
- `pnpm agent:verify`: now runs `pnpm agent:alignment` before broader agent-factory, evidence, maturity, benchmark, and source checks.

Use `pnpm agent:alignment` as the cheap first check after editing coordination docs or before dispatching a new long-running agent batch. Do not use the broader `agent:verify` loop as a routine alignment hook unless a coherent build/evidence batch is complete.

## Long-Run Coordinator Rule

For unattended multi-hour or multi-day work, the coordinator loop is not complete until all active product-advancement lanes are complete or all are blocked and recorded. Do not stop after a queue item, screenshot pass, verification pass, or doc update. Rotate to another approved lane when one blocks. Every 4-8 coherent slices, run `pnpm agent:alignment`; consult repo-defined agents only when drift is detected or their scoped review materially reduces cost/risk.

## OpenClaw-Style Activation Check

Current finding: the repo contains an OpenClaw-style agent-factory configuration, but it is not an always-on daemon. The active mechanism is file-backed memory plus repo commands:

- Agent memory and role definitions: `agents/**/charter.md`, `agents/**/memory.md`, `agents/**/index.json`.
- Agent-factory operating manual: `docs/agent-factory/**`.
- Iteration artifacts and syntheses: `iterations/**`.
- Tooling: `pnpm agent:alignment`, `pnpm agent:loop`, `pnpm agent:validate`, `pnpm agent:index`, `pnpm agent:maturity`, and `packages/openclinxr/agent-loop`.

Coordinator requirement: before calling work "autonomous" on a long run, explicitly choose one of these modes:

- `local_role_consultation`: read relevant repo-defined agent memories/charters and apply their lens locally.
- `live_subagents`: spawn available environment subagents with narrow non-overlapping work orders.
- `agent_loop_artifact`: run or dry-run `pnpm agent:loop` for broad planning/plateau recovery.

Default for LOW_TOKEN_AUTONOMY is `local_role_consultation` unless live subagents or `agent:loop` materially reduce drift, review cost, or implementation risk.

Current Codex environment note: live subagent tooling may be lazy-loaded. Search for multi-agent/subagent tools before assuming live subagents are unavailable. When available, prefer one or two narrowly scoped `explorer`/`worker` agents for independent drift review or disjoint implementation, and map their prompts to repo-defined roles from the Sub-Agent Control Roster.

Codex/OpenClaw bridge:

- `docs/openclinxr/codex-openclaw-operating-bridge-2026-05-27.md` is the current prompt/tooling alignment bridge for this Codex environment.
- Use the bridge when Patrick asks whether Codex is fully using the software, asks for a better kickoff prompt, requests OpenClaw-style execution, or asks why repo agents are underused.
- Live subagents must be given `/Volumes/files/src/openclinxr` as the target repo and must verify the core OpenClaw files before reporting. Findings from the wrong cwd are orchestration noise and should be discarded after closing the agent.
- Browser screenshots, multimodal review, Blender/Node local execution, and web/tool research are implementation accelerators only when routed through the active product queue and repo-defined evidence gates.

## Index Maintenance Rule

Update this file only when one of these changes:

- Active product advancement order changes.
- A new drift pattern is discovered.
- A new required coordinator control rule is added.
- A repo-defined agent role becomes necessary for keeping work aligned.

Do not update this file for routine command output, benchmark refreshes, or per-slice status.

## Historical 2026-05-21 Checkpoints (archival context only)

The sections below capture an earlier queue state and Iteration 9 reset. They are superseded by the Current State Snapshot and Active Product Advancement Queue at the top of this file. Do not use the 05-21 queues for task selection; they are retained for audit and to show evolution of the OpenClaw continuous-slice model. For rehydration, stop reading here or jump to the next major heading after reviewing the frontmatter.

(Original 05-21 completion checkpoint and Iteration 9 reset text preserved below for history; current work has advanced the factory through materialization evidence seams and into runtime evidence consumer + review pipeline for UI-XR while preserving all guardrails and claim boundaries. Alignment marker preserved: Worker 7 plus Worker 8 completed-station faculty review path)

## 2026-05-21 Active Queue Completion Checkpoint

The active product-advancement queue has verified slices across all currently approved lanes:

- Worker 7/8: completed-station admin review posture and readable dialogue-replay blockers.
- Worker 9: structured XR locomotion and hand-select posture fields without Quest readiness overclaim.
- Worker 4: full twelve-station dialogue seed coverage and scenario maturity alignment to replay-ready dialogue seeds.
- Worker 10: offline model-gateway replay of all dialogue seeds plus validated capability provider-health selection.
- Worker 11: asset production/source-reference hardening.
- Worker 5/12: benchmark replay evidence, review replay determinism, and in-memory durable actor-turn identity guards.

Continuation rule: if no newer approved lane has been added, do not loop on evidence refresh. Re-enter through this index, choose a newly approved product slice, or ask only if the next step would require credentials, paid/cloud/API use, destructive operations, production deployment, hardware action, or scope outside approved proposals.

## 2026-05-21 Iteration 9 repo-agent coordination reset

Purpose: keep the top-level coordinating agent and subagents aligned with the original OpenClinXR goal: a multi-station XR clinical skills exam platform with learner/faculty/admin workflows, scenario bank, review workflow, persistence, provider gates, Quest/WebXR runtime evidence, and asset pipeline readiness.

Repo-agent lenses used for this reset:

- Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, and VP Engineering Delivery for queue selection and anti-toil critique.
- XR Systems Architect, Asset Pipeline Lead, Local AI Inference Engineer, and Voice/Speech Engineer for runtime, asset, and provider sequencing.
- Rubric Steward, Psychometrics Lead, and Security/Privacy Attacker for score-use, validation, and safety boundaries.

Coordinator control rule:

- If two consecutive slices are evidence, scorecard, benchmark, Quest, IWSDK, model, voice, asset-probe, or cache refresh work, pause local execution long enough to reselect a product-advancement lane from the active queue below.
- Evidence work is allowed only when it unlocks a product slice, verifies touched code, captures newly available hardware/runtime facts, or closes a named leadership gate without changing prior evidence ID meaning.
- IWSDK remains an approved sidecar/tooling consideration, not a primary runtime dependency, until phase-2 dependency, license, MCP/tooling, bundle, and physical Quest behavior review are complete.

Active product-advancement queue:

1. Faculty/admin completed-station review path for ED chest-pain station reviewability.
2. Scenario-bank expansion beyond the first deterministic station.
3. Replayable station evidence plus persistence/review safety.
4. Asset production readiness ladder for one named clinical artifact.
5. XR/runtime readiness surface using Quest/WebXR/IWSDK evidence only where product-relevant.
6. Provider/runtime readiness surface for deterministic model/voice/provider replay outcomes.

Preferred first touch:

- Start with the Worker 7/8 faculty/admin review lane because it most directly turns existing scenario, replay, rubric, trace, and persistence work into a user-visible product path.
- If that lane is blocked by missing schema or fixture structure, fall forward to Worker 4/2 scenario-bank expansion, not sideways into evidence refresh.

## 2026-05-21 Iteration 9 product-advancement checkpoint

- Scenario-bank behavior depth advanced from partial communication-profile coverage to all 12 stations / all 36 actors covered with schema-valid profiles.
- Faculty/admin review visibility now exposes behavior-profile coverage through GraphQL and Scenario Detail UI while preserving scenario status and score-use gates.
- Model-gateway request construction now carries actor communication-profile context into dialogue seed requests.
- Asset pipeline advanced from per-asset production ladders to station-level production readiness ladders.
- XR/runtime readiness advanced with an explicit learner-launch decision surface gated by full-VR evidence, live model/voice readiness, and IWSDK station MCP smoke evidence.
- Next preferred lane: persistence/replay review safety or wiring the new asset/runtime readiness summaries into faculty/admin surfaces, avoiding any fresh Quest evidence loops unless they unblock a named product slice.


## 2026-05-21 Superpowers multi-agent continuation synthesis

Invocation: Patrick explicitly requested the Superpowers agent workflow to review, plan, and execute using all available agents.

Agents consulted:

- Chief Coordinator: prioritized Worker 5/12 replayable station evidence, then scenario-bank breadth, then asset-production readiness.
- Implementation Planning Lead: recommended review-safe completed-station replay as the smallest coherent next slice.
- Data Trace/Persistence reviewer: recommended wiring durable clinical-event review summaries into the replay/admin path.
- Clinical Simulation/Model Behavior reviewer: recommended safe actor-profile prompt-context projection and warned not to claim profiles already shape live dialogue.
- Adversarial/Claim-Control reviewer: warned that behavior profiles, dev-ready assets, XR decisions, and hidden-fact canaries need explicit projection/claim boundaries.
- XR/Asset/Provider reviewer: recommended admin readiness surface wiring next, especially asset/runtime readiness, and explicitly rejected Quest/IWSDK evidence refresh unless it unlocks a named product slice.

Executed from that synthesis:

- Added safe actor communication-profile prompt context in `@openclinxr/model-gateway`.
- Added live-provider-safe actor response projection that omits hidden-fact canaries from provider prompt input.
- Added GraphQL/API/admin durable clinical-event review summary in the ReviewPacketReplay flow.

Next preferred lane after this batch:

1. Admin readiness surface wiring for asset/runtime/provider readiness summaries already present in code, without evidence refresh or production claims.
2. If that scope is too broad, continue Worker 5/12 by enriching the review replay surface with additional read-only summary projections from existing trace/review data.
3. Avoid new Quest/IWSDK/model/voice evidence refreshes unless the refresh unlocks a named product slice or verifies touched code.


## 2026-05-21 Admin readiness lane update: SOLID for agentic context

- Recent product slices advanced the admin readiness surface across asset release ladders, provider gates, runtime protocol posture, and realtime voice posture without refreshing Quest/IWSDK evidence or enabling live providers.
- `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.tsx` is now the focused surface for seed exam launch/runtime/provider/voice/asset boundary context; future agents should extend this component instead of adding more readiness logic to `apps/ui-admin/src/App.tsx`.
- SOLID guidance for this repo: extract cohesive product surfaces when it reduces read scope for future agents, but avoid speculative abstraction layers that make agents chase indirection.
- Next aligned product lanes:
  1. Continue admin/faculty review surfaces only when they expose already-computed readiness or replay evidence.
  2. Continue persistence/replay hardening through read-only projections and summary surfaces, not raw payload display.
  3. Continue asset-pipeline work through station/scenario release-ladder evidence and operator-visible blockers.
- Drift guard: do not turn cleanup/refactor into its own loop; each extraction should either protect a recently touched surface or unlock the next product slice.

2026-06-03 Publish coherent batch: peds active emotion/dialogue demos surfaced in review packet + Admin panel + materialization continuation peds cues (meta publish per long-run rule after coherent 2+ product slices advancing feature): Product path advanced: durable main state for peds case-derived active emotion (stepEmotionStateFromCaseMachine on triggers) + dialogue cue ids (getDialoguePolicyForActorFromCase) now in review packet type/build + rendered via RuntimeSelectionMetric in RuntimeSelectionReviewPacketPanel + api-client types (plus materialization emotionRequirementCount from active cues in packet). Batch closes the gen+integrate+materialization+review-surface work from rebalance. Blueprint/factory tie: "blueprint must drive generated runtime" (peds_asthma_parent_anxiety_v1 commProfile/escalation/deescalation/requiredTraceTags 9 tags + clinicalObjectives -> turns/emotionTimeline/runtimeExecutionHints/emotion machines/dialogue policies/active demos in packet for review + runtime-state scaffold; Q1); "Conversation Tooling Is First-Class" (dialogue policies, emotion transitions, trace tags, replayable; Q2); materialization asset needs driven by case active (Q3 reusable); connects to Admin review/replay surfaces (Q4); focused evidence via prior tests/guards (Q5). Per OpenClaw long-run (batch publish after feature advance for days/weeks persistence, standing auth). Touched files (targeted): AUTONOMOUS_WORK_PLAN.md PROJECT_COORDINATION_INDEX.md docs/openclinxr/worker-backlog-and-validation-matrix.md apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx apps/ui-admin/src/api-client.ts (no generated/ broad). Evidence: lease acquired grok/publish-coherent-batch-2026-06-03 pre any edit; git status pre: exactly 5 files 11+ /3- (the active surface + states); focused ui-admin vitest (panel/api-client covering render); exact pnpm openclaw:post-slice && pnpm agent:alignment && pnpm docs:drift-check (post); git add only the 5; commit Per-Slice-style; git push origin main; post-push git log --oneline -3; pre guards 139/413 drift 26f align. Nonblocking: none. Next queued slice (post release+rehydrate): continue materialization (surface emotionRequirementCount + active cues in more review e.g. EnvironmentGenerationQueuePanel or worker report) or advance ui-xr runtime-state player scaffold to consume generated (e.g. pedsRuntimePlayerDemo stepping emotion from pedsEmotionStepDemo + cue from dialogue policy for turn simulation, focused test). Update states with new Per-Slice, focused verif, exact post+guards, release, pick next. Release lease.

2026-06-03 UI-XR runtime-state player scaffold consumes generated peds (product slice): Added pedsRuntimePlayerDemo (computed from pedsActiveEmotionDemo + pedsDialogueCueIdsDemo via the case step/policy machines) to RuntimeVisualEvidenceCaptureScaffold type + build return in runtime-state.ts (after peds demos). Smallest coherent to make the scaffold a consumer of generated behavior (currentEmotion/nextCueId from peds spec for player turn simulation, viseme hint, desktop fallback). Blueprint/factory tie: "blueprint must drive generated runtime" (peds_asthma_parent_anxiety_v1 commProfile/escalation/requiredTraceTags/clinicalObjectives -> derive* + emotion machine/dialogue policy in packet -> active + now pedsRuntimePlayerDemo in ui-xr runtime scaffold/state; Q1); improves conversation/runtime tooling for emotion/dialogue/turn (player consumes cue + affect for future locomotion/gaze/lip; Q2); connects to runtime evidence (Q4/5); no one-off, no displace asset over conv, gates false, M1 64GB, no overclaims. Touched files: apps/ui-xr/src/runtime-state.ts (type + compute const + return include). Evidence: lease grok/ui-xr-player-consume-generated-peds; focused vitest ui-xr runtime-state.test.ts -t "scaffold|peds" (pass); biome on touched; states updated (this Per-Slice in 3 files); exact pnpm openclaw:post-slice && pnpm agent:alignment && pnpm docs:drift-check (post); release. Nonblocking: none (subagent review of prior batch spawned for drift check on gen surface). Next queued slice: surface pedsRuntimePlayerDemo (or active emotionRequirement) in more review/runtime surfaces (e.g. EnvironmentGenerationQueuePanel publication or additional replay), or expand to simple step loop in player using timeline triggers; record Per-Slice, focused, post+guards, release, continue. Release lease.

2026-06-03 Surface peds player/emotion req in publication queue (product continuation of player slice): Added summarizePedsGeneratedPlayerAndEmotion (renders pedsRuntimePlayerDemo current/next + emotion req count from active case cues if peds) + call in EnvironmentGenerationQueuePanel render (after runtime scaffold summary, in publication readiness section). Makes generated (player consume + materialization from active) visible in Admin 3D Environment Generation Queue review surface (review-safe, metadata). Blueprint/factory tie: Q4 connect generated runtime behavior (peds case player/emotion from machines) to admin review/replay (publication queue); Q1/2/3/5 from prior player; continues "surface in more review" per queued + subagent recs (integrated: all PASS on guardrails/conv-first/rebalance/charters; DRY rec noted for future; this addresses rec 3 surface). Touched: apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx (fn + render call). Evidence: lease for surface; focused vitest panel test (will cover new text); states append this; exact post/align/drift; (coherent with player: 2+ product, publish batch after). Nonblocking: subagent recs integrated (DRY in next derive extend; expand player loop as future). Next: publish coherent batch (player + surface), or expand player to step loop, or materialization surface in other; record, guards, continue. Release lease.

2026-06-03 Expand peds player to step loop (product): Extended pedsRuntimePlayerDemo const to pedsPlayerStepLoopDemo (array of 2 steps using peds spec triggers "ignored_breathing" -> "frightened"/"urgent_escalation" then "breathing_effort_acknowledged" -> "reassured"/"empathy_statement" via stepEmotionStateFromCaseMachine + policy cues); added to type + build return. Makes runtime-state player consume a generated turn sequence from case (for future humanoid drive). Blueprint/factory tie: Q1/2 "spec drives ... emotion state transitions" + "player consuming the generated behavior" (step loop from machines/policies/timeline triggers); Q4/5 review/runtime evidence + verif; continues "expand to simple step loop" from surface queued + subagent rec 2. Touched: apps/ui-xr/src/runtime-state.ts (type + loop const + return). Evidence: lease; focused vitest ui-xr (scaffold/peds/loop); biome; states append; exact post/align/drift; (coherent batch player+expand+surface, publish after). Nonblocking: subagent recs (DRY noted, surface done, expand here). Next: publish coherent (expand+prior), or surface loop in more review, or materialization/other; record Per-Slice, guards, continue. Release lease.

2026-06-03 Update snapshots with current state and next (meta): Refreshed Current State Snapshot "Last completed" and "Explicit next queued" + worker "Last rows" "Next action" + PROJECT "Last slice" "Next queued" in the 3 files with latest product (2 scenarios gen with caseDerived/turns/emotion/machines/policies/player loop/replay/persistence shape/materialization surface/surfaces in admin; all gates false, M1 64GB, no overclaims; publishes). Justification: snapshots must reflect living plan for accurate rehydrate/continuation per AGENTS/Efficiency Quick Ref (old 05-28 snapshot + tail for ledger); enables future agents to pick correctly without stale. Blueprint/factory tie: improves the "expert agent-driven design-and-build system" itself (hyper opt for long unattended on M1); no product change but unlocks correct next product slices for factory completion. Touched: PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md. Evidence: reads of tops; post/guards; (meta after product, pivot to product next per anti-toil). Nonblocking: none. Next queued slice (product pivot per anti-toil after meta): add locomotion/gaze/lip stub in ui-xr player from generated hints/loop (for peds+ed); or full mongo persistence wiring; record Per-Slice, focused, post+guards, release, continue. Release lease.
