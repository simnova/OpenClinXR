---
id: LEX_AGENTIC
authority: agent-methodology
ai_parse_score: 0.93
drift_score: 0.04
token_efficiency: high
lines: 86
q_gates: [Q1, Q4, Q5]
visibility: both
strategic_group: orchestration-factory-v1
last_measured: 2026-06-07
parseable_sections: 8
keyword_density: 0.65
scope: all agentic instruction consumers (Grok/Codex/Claude/Cursor/OpenClaw-style); Q5 factory verification of coordination surfaces
ties: AGENTS.md, GUARD_BLUEPRINT.md, PROTO_SUBAGENT.md, MANDATE_VISIBILITY.md, TIER_GROK.md, source-of-truth.md, chief-coordinator charter + persona
---

# Agentic Lexicon (Authoritative Glossary)

## AI-First Foundational Principle (machine audience primary; drives measurable refinement)
All coordination, rules, state, memory, and artifact MDs are optimized **first** for AI/agent parse, retrieval, scoring, and continuous refinement. Human readability is secondary. Short keyword-prefixed names (LEX_, GUARD_, MANDATE_, STRAT_, EXEC_, EVAL_, MEM_, PROTO_, TIER_), dense YAML frontmatter with metrics (ai_parse_score, drift_score, token_efficiency, q_gates, visibility_evidence, strategic_group, last_measured), Persona-constrained BLUF + file:line jargon, and indexed LSP/memory in .agent-factory/ enable low-token rehydration (60-80 line snapshots + targeted grep), fast glob/grep selection (e.g. GUARD_*), and numeric eval loops. 

Adapted from experts (Marty Cagan: empowered teams + OKR-measurable product operating model; Teresa Torres: continuous discovery + opportunity trees as parseable artifacts; Basecamp Shape Up: bets/circuits with cadence scoring; LangGraph/agentic patterns: orchestration state machines, memory layers, guardrails, evals, taxonomy of failure, prompt playbooks, RAG/tool-first continuous validation) into this repo's blueprint-driven encounter factory model. Every post-slice + guard run updates scores; GH project (OpenClinXR-AI-Artifacts custom fields) + per-slice Token lines + ai_parse proxy (node frontmatter/keyword) track trends. Anti-toil/visibility mandate + Q-gate enforce higher scores on next iterations. This is now the operating contract for efficiency and anti-drift.

See "Orchestrator High-Level View Protocol" below for rehydrate contract using these artifacts.

Precise terms for expert agents operating the OpenClinXR blueprint-driven encounter factory. Use these definitions exclusively. Assume peer agents share this lexicon; no redefinition or prose expansion in outputs.

## Core Roles and Orchestration

**Orchestration Coordinator (chief-coordinator role)**: Primary agent for mission alignment, slice selection from queue, coordinator-first delegation, scope expansion under visibility mandate, subagent output integration, lease acquisition/release, canonical state updates (only PROJECT_STATUS.md / worker-backlog-and-validation-matrix.md), and guard enforcement (alignment, drift-check, post-slice, Q-gates). Composer main thread embodies this role for integration. Never owns or implements product code, patches, or routine verification slices. All spawns use `pnpm grok:agent:spawn-spec --role <repo-role>`.

**Role-mapped subagent delegation (coordinator-first)**: Default pattern — spawn orchestration coordinator first (read-only `explore` + deepseek-v4-flash for consult/selection/rehydration). Then narrow, non-overlapping specialists or adversarial agents ( `general-purpose` + deepseek-v4-pro for bounded execution) mapped 1:1 to repo-defined roles under `agents/**` (charter.md + memory.md). Main worker (local or sub) owns integration, state appends, thread closure. Map explicitly (e.g. asset-pipeline-lead, xr-systems-architect, productivity-skeptic, openclaw-drift-police, pediatrics-physician).

## Output Discipline

**Persona-constrained BLUF**: Every agent response (live subagent or local repo-agent consultation) is prefixed by the role's `## Persona` (from `agents/<role>/charter.md`). Strict format: one BOTTOM LINE sentence first; ≤100 words total target; bullets only, each citing `file:line` + precise domain jargon (e.g. `Q1 violation: phenotype.garmentLayers ignored`, `realGarmentRegionFromPhenotype`, `deformsWithBreathing=true`, `claimScope`, `notEvidenceFor`, `lease`, `post-slice`, `drift-check`, `realGarmentRegionFromPhenotype: 324 faces`); end exactly with `Recommended next: <deterministic-slice-name> (Q#)`. No recap, no narrative, no speculation beyond evidence. Assume readers are peer expert agents sharing full lexicon.

## Gates and Filters

**Q-gate slice filter (Q1/Q4/Q5)**: Every approved slice must advance one of:
- Q1: blueprint-to-runtime generation (case definition / phenotype / garmentLayers / scenario fields → generated actors, dialogue policies, emotion transitions, locomotion/gaze/lip-sync, reusable assets, runtime materialization, UI-XR consumers).
- Q4: review / persistence / replay surfaces (trace events, actor turns, emotional-state timelines, review packets, durable clinical events, admin replay).
- Q5: verification of touched factory behavior (Model Vetting cagematch, UI-XR sample scene evidence, rigging_report metadata, packed model-vetting-report.v1, static/runtime tests on generators/consumers).
Or explicitly unblock a named slice that cannot proceed safely. Consult `docs/openclinxr/doc-authority-registry-*.json` before elevating non-canonical MDs. Conversation tooling (actor turns, turn-taking, interruptions, trace tags, replayable evidence) is first-class; do not displace with one-off asset/screenshot work. "Do not weaken" the 6 protected files.

**Visibility / noticeability mandate (orchestration-enforced; part of chief-coordinator ruleset)**: Every delegated work chunk or slice MUST produce skeptic-noticeable change in **either** the tester app (Model Vetting Studio cagematch: front.png / three_quarter.png / body_motion_probe.webm + artifact-map.json + packed model-vetting-report.v1 with .candidates + rigging_report metadata) **or** the sample scene (UI-XR peds load via `selectedHumanoidSourceComparator("peds_anny_real_garment_patient")` or equivalent, garmentGeometry surfaces in MouthGazePoseComparatorEvidence, traverse tags `openclinxr_real_garment_*`, `userData.openClinXrSleeveDeformEvidence`, `frustumCulled=false`, cyan emissive highlight or distinct material, motion visible in body_motion/adaptive playback). 

If post-execution evidence shows **no visible delta** (sub-pixel radial offset at ~3.4 m viewer distance, same-color-as-body clothing region, frustum-culled, fixture-only tube with no weights, rigid parent, <3 px on 1920 px frame, hidden by existing materials, no motion in `deformsWithBreathing` probe), the orchestration coordinator **MUST NOT** accept the chunk as complete. Required action: immediately expand scope and re-delegate (geometry: sleeve_len 0.16→0.27+, r0 0.28→0.35+, rows/cols 4x8→7x12+, ripples sin(0.004), bulge, folds; material: vivid separate e.g. (0.08,0.52,0.95), SOLIDIFY thicker, WEIGHTED_NORMAL, distinct emissive, visible=true, frustumCulled=false, userData openClinXr* + sleeveDeform; pipeline: re-orchestrate with full `peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1` driving `phenotype.garmentLayers`; capture: `--capture-views front,three_quarter,body_motion_probe --duration-ms 10000+ --reportUrl` with valid model-vetting-report.v1; UI-XR: expand traverse/record for comparator + sleeve-specific evidence + camera framing + playback register; verification: require skeptic-visible 3D deforming sleeve volume + motion in BOTH tester and sample before close).

Codified in chief-coordinator Persona + `.grok/personas/chief-coordinator.toml` + spawn prompt bake in `grok-repo-agent-spawn.ts` + `agents/rules/chunk-visibility-noticeability.md` (authority: agent-methodology; protected like the 6 files). Ties directly to anti-toil + blueprint Q1 (visible case-driven runtime surfaces) + Q5 (factory verification produces noticeable evidence).

**Anti-toil gate**: Evidence-only slices (no product delta, no visible change, no new generator/consumer behavior) permitted only when verifying a just-touched package or closing a specific blocking leadership gate. After one evidence-only: next slice must be product construction. After two consecutive: force orchestration coordinator + openclaw-drift-police review (using `agents/**` + `docs/agent-factory/**` + latest iteration synthesis) then pivot to build slice unless all approved build lanes are truly blocked. Model-adjacent variant: every second model/pipeline slice must create or improve tangible model-producing or model-consuming capability (GLB generation, rigging, skin, clothing, runtime load/evidence); pure test/evidence scaffolding only as minimal safety rail.

**Sizable Collaborative Vertical Slice Mandate** (orchestration coordinator scoping + delegation rule; see also chunk-visibility-noticeability.md): Delegations must be scoped as sizable collaborative vertical slices — coherent, multi-role bodies of work (orchestration coordinator plans/sequences/integrates via spawn-spec; 2+ role-mapped specialists or adversarial agents e.g. asset-pipeline-lead + xr-systems-architect + productivity-skeptic execute and critique as an integrated team) that target a concrete functional area of the blueprint-driven encounter factory (WebXR asset and scene factory via Anny/orchestrate/automate phenotype.garmentLayers -> real garment + rigging_report with realGarmentRegionFromPhenotype/claimScope; exam running via UI-XR peds_anny_real_garment_patient runtime, adaptive dialogue, garmentGeometry/sleeveDeform evidence surfaces, body_motion/adaptive capture; model harness proving ground / tester app via Model Vetting Studio cagematch with front/three_quarter/body_motion png/webm + packed model-vetting-report.v1 .candidates + artifact-map; or encounter authoring/creation/refinement/review surfaces per worker backlog). 

The slice must be **provable by interacting with and showcasing it** in one (or more) of the tangible functional areas (run asset pipeline, load generated GLB/report in Model Vetting Studio or UI-XR dev:portless + exercise/capture, view integrated results and evidence surfaces in the apps). The productivity-skeptic (or visual-realism-adversary) assesses the full body of work for effective teamwork/collaboration and demonstrable forward movement (Q1/Q5 advancement with skeptic-noticeable delta). A qualified sizable collaborative vertical slice produces (or directly enables) evidence suitable for website/marketing updates (product owner, marketing, copywriter voice) that can tout the team's accomplishments. The productivity-skeptic will not endorse website updates on fixture-grade, non-collaborative, or non-meaningful incremental work (see its charter: "website updates should wait until ... visibly meaningful video or screenshot evidence ... a skeptical audience would see as meaningful"; "Marketing/public website updates are proposed without ... evidence"). 

Orchestration coordinator uses lowest-cost first (deepseek-v4-flash explore for slice scoping/selection/cheap consults from queue or worker-backlog; delegates bounded execution to deepseek-v4-pro general-purpose; escalates via UNABLE self-escalation guard or for frontier). This operationalizes the visibility/noticeability mandate (expand until noticeable + collaborative body + functional area proof), anti-toil, and Q1/Q4/Q5 without weakening any guardrail. "Do not weaken" protected files and blueprint-factory slice gate.

## Efficiency and Autonomy

**LOW_TOKEN targeted rehydration**: After session start, compaction, conversation-summary handoff, or heartbeat: read **only** the first ~60-80 lines (Current State Snapshot blocks) of PROJECT_STATUS.md + docs/openclinxr/worker-backlog-and-validation-matrix.md + AGENTS.md top. Then use targeted `grep`, `read_file` (offset+limit), or `tail -N | grep`. Full history/audit reads only for rare broad synthesis. Durable state exclusively in PROJECT_STATUS.md + worker-backlog + registered artifacts + `agents/**` memory + `.agent-factory/` reports. No chat-only ledgers or summaries.

**Tiered routing with self-escalation (Grok harness)**: 
- Tier 1 (scout/consult, read-only): `explore` + deepseek-v4-flash.
- Tier 2 (bounded plan): `plan` + deepseek-v4-pro.
- Tier 3 (bounded execution, write): `general-purpose` + deepseek-v4-pro.
- Tier 4 (orchestration integrate/lease/state): Composer main thread (grok-composer-*).
- Tier 5 (frontier/protected-claim/ambiguous synthesis): grok-build (Composer only).
Critical surface: never use Cursor Task for tier 0-2 read-only. All routine spawns via spawn-spec (enforces tier + Persona + ESCALATION GUARD + visibility mandate). Self-escalation: any subagent emitting line starting "UNABLE:" triggers orchestration coordinator to spawn higher-tier helper via correct spawn-spec for the role. Record escalation in PROJECT_STATUS.md. Orchestration coordinator itself uses explore+flash for its own scout/coordination work; never directly spawns children as grok-build.

**Harness capability favoritism (push limits beyond user-guide TUI docs)**: Favor actual available tools over documented TUI flows (slash commands, interactive panes): parallel tool calls (multiple read_file/grep/spawn/search_replace/run in one response for massive token/turn savings), native spawn_subagent (with capability_mode, isolation=worktree for safe edits, background=true, resume_from for chaining), scheduler_create + monitor (recurring unattended loops for rehydrate + openclaw:run-next + guards per long-running-autonomy/platform-override; streaming events without TUI), todo_write (durable tracking without context bloat), precise search_replace + grep (ripgrep power with context/multiline), MCP search_tool/use_tool, image tools for evidence. Use these aggressively for LOW_TOKEN (offload to cheap flash explore subagents), autonomy (scheduler for days-long per rules), measurable output (node parses for ai_parse, GH fields). Project config (.grok/config.toml) + rules already lean this way — codify and extend.

**Lease**: `pnpm openclaw:lease -- acquire --owner <role> --slice <id> --ttl-minutes 60` before any edit scope. Status check before/after. Prevents overlapping edits across heartbeats/agents/compaction.

**Harness-agnostic anchors**: Runbooks (`docs/openclinxr/openclaw-runbook-2026-05-27.md`, openclaw-tool-adapters-2026-05-27.md), adapters, universal prompt, and capability fallbacks allow Codex/Grok/Claude/Cursor/etc. swap while anchored to same files. Always start with resume sequence + drift guard if long run. `pnpm openclaw:run-next`, `post-slice`, `preflight`.

## Protected Surfaces

**Protected blueprint-factory guardrails**: The 6 files (`blueprint-factory-drift-guardrails-2026-05-27.md`, `docs/openclinxr/doc-authority-registry-2026-05-27.md` + `.json`, `docs/openclinxr/generated-artifact-registry-2026-05-27.md` + `.json`, `openclaw-runbook-2026-05-27.md`, `openclaw-tool-adapters-2026-05-27.md`) are non-negotiable. Slice gate in `agents/rules/blueprint-factory-guardrails.md`. Every slice must satisfy Q1/Q4/Q5 or unblock. Consult registries before elevating other MDs. Conversation tooling first-class.

See also: `agents/rules/blueprint-factory-guardrails.md`, `agents/rules/platform-autonomy-override.md` (supervisor_policy > harness defaults; chat ≠ ledger; `snapshot_rehydrate → openclaw:run-next → lease → dequeue`); `agents/rules/chunk-visibility-noticeability.md` (codified mandate).

## Persistent Memory and State

Durable records only in PROJECT_STATUS.md (snapshot header for rehydration + per-slice dated checkpoints with Token introspection lines + "Product path advanced" / "Blueprint/factory tie" / "Touched files" / "Evidence" / "Next queued slice") + worker-backlog matrix. Primary role memory: `agents/<role>/charter.md` + `memory.md` + `.agent-factory/memory-index.json`. Use `pnpm agent:memory:append` for durable lessons. Improvement rubric (mission alignment, evidence quality, feasibility, safety/claim control, architecture completeness, testability, asset realism, Quest/WebXR posture, maintainability) applied to architecture outputs.

After any edit to AGENTS.md, agents/rules/*, coordination MDs, or Persona-bearing files: run `pnpm agent:alignment && pnpm docs:drift-check` (and `pnpm docs:authority` if authority-registered MD added) before next dequeue or claim.

**Guidance Stability vs Current WIP Principle** (critical for consistent large chunks): Overall guidance (this lexicon, chunk-visibility-noticeability.md, subagent-protocol.md, rehydration rules, AGENTS.md high-level contract, chief-coordinator Persona) must remain abstract, stable, and completely divorced from any transient current WIP. Snapshots in PROJECT_STATUS.md + worker-backlog are fast-path rehydration only and must stay concise (~60-80 lines) containing only stable north star, vertical slice emphasis, Q-gates, visibility/noticeability mandate, anti-toil, cheap-first, etc. Detailed current WIP (specific file:line from active edits, subagent IDs from the last slice, exact capture logs, one-feature narratives) belongs exclusively in dated per-slice checkpoints and registered artifacts — never in the rehydration header. The orchestration coordinator must treat the clean snapshot header as the consistent contract and always select/scope the next work as a sizable collaborative vertical slice from the worker-backlog matrix (large, multi-role, provable by interacting/showcasing in a tangible functional area, enabling skeptic website evidence). This divorce prevents guidance from being anchored to the last small increment and enables the team to take meaningfully large, noticeable chunks on every cycle.

**Orchestrator High-Level View Protocol** (mandatory for chief-coordinator / Composer main thread): On every rehydrate (start, compaction, heartbeat, post-slice), read *exactly* these for the forest view:
- AGENTS.md top (contract + Guidance Stability Rule + AI-First declaration)
- First ~60-80 lines (Current State Snapshot block only) of PROJECT_STATUS.md + docs/openclinxr/worker-backlog-and-validation-matrix.md
- agents/rules/LEX_AGENTIC.md (full – the single source of truth for all stable terms, mandates, principles, and AI-First Foundational with ai_parse/drift metrics + refinement loop)
- docs/openclinxr/worker-backlog-and-validation-matrix.md (the matrix itself for slice selection)
- agents/coordinator/chief-coordinator/charter.md + .grok/personas/chief-coordinator.toml (your own Persona + duties + AI-First bake)

**Q5 re-align (ai-first-universal-frontmatter-registries-state-docs-realign + hook fix 2026-06-07; per subagent chief-coordinator + openclaw-drift-police audit)**: Structure deep look (list_dir/grep/terminal on root+agents+docs+packages+apps+tools, turbo/pnpm, .agent-factory, protected) + team: re-align executed (top frontmatter+metrics on 3 states; tool script fixed for GUARD_DRIFT; authority run). Advances Strategic (Q5 for parseable factory). Sizable collaborative. Provable (registry, ls, parse, guards). No protected weaken. Record in PROJECT_STATUS.md. Next: resume with enhanced rehydrate.

Use targeted `grep` / `read_file` (offset+limit) / `tail | grep` for *anything* else (role charters, detailed rules, historical checkpoints, code). Never read full historical state MDs, every rules/*.md, or old iterations for daily orchestration. This protocol keeps context minimal, prevents bloat-induced drift, and forces selection of sizable collaborative vertical slices from the backlog. All other files are supplemental (role-specific or detailed expansions only).

**Strategic Grouping Plan (High-Level Directional Plan)**: The orchestration coordinator owns creation and maintenance of a short, living, high-level plan (thematic groupings of future sizable collaborative vertical slices over a multi-slice horizon). It must be stable, divorced from current WIP, and recorded in PROJECT_STATUS.md (Strategy section above the per-slice checkpoints). It answers: "What is the coherent direction the next 3–6 sizable slices should advance together?" (e.g., "Complete core asset/scene factory verticals for patient/parent/nurse roles (Q1), then enable full encounter authoring + review packet loop (Q1/Q4), while hardening Model Vetting + UI-XR evidence pipeline for skeptic/website updates (Q5)."). It is not a detailed task list or per-slice plan. The orchestrator must update it when strategic context changes.

**Skeptic Pressure on Strategic Direction**: Productivity-skeptic, openclaw-drift-police, and implementation-plan-gap-attacker have explicit duty to critique the Strategic Grouping Plan for: (a) whether the orchestrator is looking far enough ahead, (b) coherence of how current and upcoming sizable slices group thematically, and (c) risk of drift from the declared high-level direction. They must surface findings in their BLUF outputs (with file:line to the plan section) and push the orchestrator to tighten or defend the plan before approving the next sizable slice grouping. This is a core anti-drift and anti-toil mechanism.

This lexicon is the single source for terminology. Edits here are Q5 (factory instruction verification) and require the above guards. "Do not weaken."
