# OpenClinXR Project Coordination Index

Last updated: 2026-05-21

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

- `.agent-factory/memory-index.json`: generated memory records across 69 agents and 111 active/superseded entries.
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

## Active Product Advancement Queue

Use this queue unless Patrick explicitly changes direction.

1. Worker 7 plus Worker 8 completed-station faculty review path.

   Product goal: faculty can inspect a completed ED chest-pain station through review-safe API/admin surfaces, including timeline, missing required behaviors, unsafe/late signals, note evidence, and reviewer decision posture.

2. Worker 9 XR trace interaction or locomotion instrumentation.

   Product goal: one concrete learner XR interaction path becomes more observable and closer to headset readiness. Consider IWSDK sidecar support, but do not couple IWSDK into production runtime.

3. Worker 4 plus Worker 2 scenario-bank expansion.

   Product goal: the exam skeleton expands beyond one station with schema-backed actors, environments, equipment, trace tags, rubrics, communication profiles, and asset needs.

4. Worker 11 reviewed asset-production evidence ladder for one named artifact.

   Product goal: one named ED station artifact moves from placeholder planning toward reviewed manifest/provenance/license/optimization/Quest-QA evidence without production-readiness claims.

5. Worker 5 plus Worker 12 replayable station evidence.

   Product goal: review-safe traces, packets, actor turns, emotional-state timelines, and approved durable clinical events become safer and more replayable inside approved persistence boundaries.

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

Coordinator rule:

- Reject slices that polish one fixture, garment, screenshot, prop, or room without strengthening the blueprint-to-runtime factory contract.
- Keep conversation tooling first-class: actor dialogue, learner utterance/action intake, turn-taking, interruptions, emotion transitions, trace tags, replayable actor turns, and review-safe evidence.
- If three consecutive slices focus on visual assets, clothing, provider metadata, or screenshots without advancing conversation/runtime/review behavior, consult Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, VP Engineering Delivery, Clinical Simulation Lead, Data Trace Architect, Voice/Speech Engineer, XR Systems Architect, and Asset Pipeline Lead before selecting the next slice.
- Agents may not delete, weaken, bypass, rename, or reinterpret the guardrails during autonomous work.
- Agents may not create scattered markdown/status/prompt artifacts or unregistered generated artifacts; `pnpm docs:drift-check` must pass before claiming the repo is ready for long unattended OpenClaw execution.

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
