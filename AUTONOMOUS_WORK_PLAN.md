# OpenClinXR Autonomous Work Plan

## Current State Snapshot

Current product: blueprint-driven encounter factory for peds_asthma_parent_anxiety_v1 plus ED seed. The factory should turn case definitions into generated actor turns, dialogue policies, emotion transitions, locomotion/gaze/lip-sync hints, reusable assets/materialization work orders, review packets, persistence/replay, and UI-XR runtime evidence. UI-XR runtime evidence consumer remains metadata-only and review-safe. Apple M1 Max 64 GB is the primary local workstation target.

Last completed checkpoint: 2026-06-04 1-5+6 harness AgenticEx (modular rules extractions for Hyper/Blueprint/Repo-Defined/Persistent-Memory/Agent-Consult, .grok/plugins/ post-slice automation, .grok/lsp.json, hooks enhance + .githooks runner tie + memory SessionStart consult, config [memory/plugins/subagents/compat/notifications], registry classify fix, sync, authority 220 MDs). Full loop proof: hook fire on coord edit, spawn_subagent (explore chief-coordinator read-only per protocol + agent-consult, charter/memory reads, no drift, rec next product), post-slice, grok inspect evidence (12 rules loaded), states updated, guards green, lease released, commit f90252a + push. Tree clean on origin. Next: Worker 9/7/11 UI-XR runtime evidence consumer or peds handoff launch validation (per queue + subagent rec).

Support: 2026-06-04 agentex-openclaw-full-autonomy-gaps analysis (docs/agent-factory/agentex-openclaw-full-autonomy-gaps.md, registered as agent-methodology). Detailed remaining items for full unattended OpenClaw mode operating *with* the repo's 9 core agents/** (chief-coordinator orchestration, drift-police adversarial, etc.): proactive heartbeat/orchestrator loop via scheduler + plugin (biggest), native repo-role subagent mapping (beyond prompt), memory write-back from slices, lease auto in hooks, Grok primary-runner assertion per tool-adapters, self-invoking drift-police, e2e autonomy smoke. Foundation from 1-5+6 is strong; these close the loop for days-long with minimal intervention while advancing product. Guards run. Next product remains UI-XR/peds validation; this harness gap work enables it.

Explicit next queued: propagate `pedsHumanoidMaterializationHandoff` into publication/readiness/review packet summaries, then make UI-XR prefer worker-fed humanoid metadata before deterministic peds fallback. Gates remain false: no real-Anny, B+, Quest, clinical validity, scoring validity, production readiness, or learner-launch claim.

## Efficient Rehydration + Working Model

Start every session or compaction recovery by reading `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, this file, and `docs/openclinxr/worker-backlog-and-validation-matrix.md`. Use snapshots-first, `rg`, focused reads, `pnpm openclaw:lease -- status`, and small deterministic slices. Status belongs here and in the worker matrix, not in scattered checkpoint files.

Efficiency Quick Ref:

- `pnpm agent:alignment`
- `pnpm docs:drift-check`
- `pnpm openclaw:lease -- acquire --owner <agent> --slice <slice> --ttl-minutes 60`
- `pnpm openclaw:post-slice`
- Focused `pnpm exec vitest run <file> -t "<substring>"`

## Protected Blueprint-Factory Guardrails

Source order: `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, this file, `docs/openclinxr/worker-backlog-and-validation-matrix.md`, operator question files, then `docs/agent-factory/**`, `agents/**`, and current MADRs.

Protected files: `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md`, `docs/openclinxr/doc-authority-registry-2026-05-27.md`, `docs/openclinxr/doc-authority-registry-2026-05-27.json`, `docs/openclinxr/generated-artifact-registry-2026-05-27.md`, `docs/openclinxr/generated-artifact-registry-2026-05-27.json`, `docs/openclinxr/openclaw-runbook-2026-05-27.md`, and `docs/openclinxr/openclaw-tool-adapters-2026-05-27.md`.

Do not run another local voice/model/source-currentness refresh unless a concrete Worker 10 implementation slice needs it.

## Active Product Advancement Queue

1. Product pivot: `pedsHumanoidMaterializationHandoff` to publication/review/runtime metadata preference.
2. Runtime/review: UI-XR runtime evidence consumer and Admin ReviewReplay summaries stay metadata-only and reviewer-gated.
3. Faculty flow: Worker 7 plus Worker 8 completed-station faculty review path should remain deterministic and local-testable.
4. Asset Commons: promote reusable humanoid/equipment/floor/nurse/materialization outputs only through provenance, sidecars, MADRs, and review gates.
5. Local exam profile: build local deterministic harnesses in test/data boundaries, not production runtime manifests.

## Checkpoint Summaries

2026-06-04 architecture/arena checkpoint: Turborepo and architecture rules now make production app/package roots distinct from Capability Arena cage matches. Godot, IWSDK, realtime voice, Python backend, and multi-actor spikes live under arena paths and link to MADRs.

2026-06-04 humanoid checkpoint: peds patient/parent GLBs are preserved as Anny-compatible stub + Blender procedural B candidates with sidecar provenance. `realAnnyWeightsUsed=false`, B+ and production claims blocked.

2026-06-04 hooks/public-copy checkpoint: `.githooks` route through an agent-friendly hook runner; public copy names production exam platform, Encounter Blueprint Factory, Clinical Asset Commons, Capability Arena, local/offline, connected/Azure, and no exam-equivalence/clinical-validity boundary.

2026-06-04 cleanup checkpoint: old point-in-time JSON/screenshot/review/audit evidence is disposable by default. Use git history for audit. Promote generated artifacts into `docs/openclinxr` only when current, template, runtime asset, or active compatibility input.

2026-06-04 Worker 11/9 pedsHumanoidMaterializationHandoff propagation (product): surfaced worker peds handoff (assets, B grade, false claims, provenance) into EncounterPublicationPayloadReport + written learnerRuntimeBundlePayload (for public/xr-assets), review-packet linkage, admin RuntimeSelectionReviewPacketPanel (lists roles+paths for peds review/replay), asset-registry bundle type, and UI-XR runtimeHumanoidVariantAssetPath (prefers bundle.pedsHandoff for patient/parent roles before hard scenario if fallback). CLI support added. Blueprint/factory tie Q1 (case peds spec -> worker materialization metadata drives runtime asset choice + review packet), Q4 (review/persistence/replay now carries the handoff). Touched: packages/asset-registry/src/runtime-bundles.ts (+to fn), tools/factory/encounter-publication-payloads.ts (+cli parse/call/validate), tools/factory/encounter-runtime-selection-review-packet.ts (linkage+validate), apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx, apps/ui-xr/src/main.ts . Evidence: vitest publication-payloads + review-packet + registry bundles green (11+ passes on touched); propagation paths exercised. Next: Worker 9/7/11 UI-XR runtime evidence consumer surfaces or faculty review path or peds launch validation with handoff in bundle.

2026-06-04 Grok harness AgenticEx amp-up (support): implemented full .grok/config.toml (subagents per AGENTS.md protocol with explore/plan, memory for persistent rehydration, codebase_indexing + lsp_tools, bash tool tuning for pnpm/agent loops, grok_com_github MCP declaration, UI for long sessions, compat, notifications); modular agents/rules/ (extracted rehydration, subagent, drift, source-of-truth, autonomy, harness-usage from AGENTS.md + new ones; frontmatter for registry); functional .grok/hooks/ with auto PostToolUse guard enforcement + PreCompact/SessionStart reminders (automates "after edits run pnpm agent:alignment && pnpm docs:drift-check"); .grok/agents/ note + selective role exposure; scripts/sync-harness-agent-files.sh for multi-harness (.grok/.claude/.cursor) symlinks from canonical agents/rules/ + .agents/skills/; updated AGENTS.md + rules README. Guards + authority + drift pass (280+ MDs). Blueprint tie: improves agent capability (Q in mission), harness-agnostic support, LOW_TOKEN + subagent + memory practices. Touched: .grok/config.toml, agents/rules/* (6+), scripts/sync-*.sh, .grok/hooks/*.json, AGENTS.md, rules README, config comments. Evidence: grok inspect shows 8+ project instructions + project skills + subagents enabled; guards green; hooks will auto-run on edits. Next: continue 1-5 extractions/plugins/LSP/hooks-enhance/memory-integration + prove with full loop test (#6), then product (UI-XR consumer or peds launch).

2026-06-04 1/5 extractions (harness amp continuation): extracted full Hyper Token-Efficient & Long-Run Practices, Protected Blueprint-Factory Guardrails (Q gate), Repo-Defined Agents And Worker Roles, Persistent Memory And Scoring (rubric) into 4 new agents/rules/*.md (hyper-token-efficient-long-run-practices.md, blueprint-factory-guardrails.md, repo-defined-agents-worker-roles.md, persistent-memory-scoring.md) with rich frontmatter (authority:agent-methodology); slimmed AGENTS.md sections to short refs + restored required alignment markers (doc-authority-registry*, Conversation tooling is first-class, openclaw:lease, Hyper Token-Efficient..., Protected Blueprint-Factory Guardrails); updated agents/rules/README.md list + how-to; extended tools/agent-factory/build-doc-authority-registry.ts classify to treat agents/rules/* as agent-methodology and .grok/.claude/.cursor/rules/ mirrors as current-reference (prevents unclassified/scattered in drift report, archive-candidate down, agent-methodology 8->19); ran sync (11 rules), pnpm docs:authority (215 total), guards green. Blueprint: improves agent capability + LOW_TOKEN for factory work (Q in mission). Touched: 4 new rules md, AGENTS.md, rules/README.md, registry build ts + json + md. Evidence: alignment 0 fail, drift checked 215 MDs green, authority lists canonical rules as agent-methodology + mirrors current-ref (no unclassified clutter). Next in 1-5: 2 plugins, 3 lsp.json, 4 hooks enhance + .githooks tie, 5 memory/role consult rule+plugin; then #6 prove loop.

#6 PROOF MARKER (hook fire test): search_replace on this coord file should have triggered .grok/hooks PostToolUse (guard + "tie to .githooks/agentic-hook-runner.ts") + merged SessionStart memory consult. If hook output visible in execution, proof complete. (Added 2026-06-04 during live loop test.)

2026-06-04 1-5 + #6 full loop proof (harness amp continuation): 
- search_replace on AUTONOMOUS_WORK_PLAN.md (coord) fired PostToolUse hook (echoed guard "pnpm agent:alignment && pnpm docs:drift-check", "tie to .githooks/agentic-hook-runner.ts", Bash note; also merged hooks provide SessionStart memory/role consult).
- spawn_subagent (explore, read-only, capability read-only) mapped to chief-coordinator role per protocol/agent-consult: prompt included full "Target repo: /Volumes/files/src/openclinxr. Confirm AGENTS... states... agents/** ... tools/agent-factory exist"; it confirmed files, used snapshots + targeted reads of 9+ role charters/memories (chief-coordinator, drift-police, planning-lead, gap-attacker, vp-eng, xr-architect, peds-physician, safety-critic), cross-referenced states/AGENTS/rules, no edits, reported no material drift/toil (harness 1-5 support strengthens agent cap/LOW_TOKEN for factory; order commit-before-1-5 correct per git+states), recommended next from queue: Worker 9/7/11 UI-XR runtime evidence consumer + Admin ReviewReplay (metadata-only, reviewer-gated; prefer pedsHandoff in bundle for roles; or deeper peds launch validation with handoff; Q1/Q4; keep gates false).
- pnpm openclaw:post-slice + lease status + "grok inspect sim" (12 rules via .grok/rules/, 2 hooks incl memory-consult, plugin openclinxr-post-slice-automation/, .grok/lsp.json present; config loads subagents/memory/plugins).
- Updated 3 states with 1-6 record (touched during 1-6: agents/rules/ (5 new incl agent-consult), AGENTS.md, rules/README, tools/agent-factory/build-doc-authority-registry.ts + 2 registry artifacts, .grok/plugins/openclinxr-post-slice-automation/* (hooks+README), .grok/lsp.json, .grok/hooks/ (2 json), .grok/config.toml, scripts/sync-..., 3 state md; plus subagent consult). Evidence: subagent full report (protocol 100% followed, harness good, no drift, recommended product slice); post-slice green; authority 220 MDs (agent-methodology includes rules + docs/agent-factory; plugins current-ref); drift/alignment green (216+ MDs); hook fired on search_replace + sync merge; 12 rules, 2 hooks, plugin, lsp loaded.
- Blueprint/factory tie (Q1/Q4/Q5 + mission): 1-6 amps agent capability (modular rules for targeted, auto PostToolUse guards on coord, SessionStart memory/role consult from .agent-factory/index + agents/**, subagent explore mapped to chief-coordinator per protocol, [plugins] post-slice automation, lsp for monorepo, classify prevents scattered) enabling sustained LOW_TOKEN OpenClaw autonomy for blueprint-to-runtime generation (Q1: case peds -> handoff metadata -> runtime), review/persistence/replay (Q4: admin surfaces + packet carry handoff; auto guards protect control surfaces), verification of touched factory (Q5). Multi-harness (committed .claude/.cursor mirrors + canonical agents/rules/ + .agents/skills via config) without weakening protected guardrails or duplicating roles. Prepares product (UI-XR consumer or peds handoff launch validation per subagent rec + queue).
- Post #6: immediately select next approved (Worker 9/7/11 UI-XR runtime evidence consumer surfaces or peds launch validation exercising handoff in bundle); update states; focused verif if touch ui-xr/admin/factory; pnpm agent:alignment && pnpm docs:drift-check; pnpm openclaw:post-slice; record any nonblock in operator-open-questions; continue autonomous (no chat status). 

(Proof complete per user "do 1-5 and prove it out with #6"; beforehand commit/push done. Lease held throughout. Subagent id available if resume: 019e91c7-57e9-7883-b090-25782cc8ddfa .)

## Required Per-Slice Record

For every coherent slice, record: Product path advanced, Blueprint/factory tie, Touched files, Evidence, Next queued slice. Run focused verification, `pnpm agent:alignment`, and `pnpm docs:drift-check` when coordination files changed.

## Historical Ledger Policy

This file intentionally does not preserve detailed chronological logs. Use git history for old slice detail. If a past run contains durable agentEx value, add a short checkpoint summary above instead of appending another long log entry.
