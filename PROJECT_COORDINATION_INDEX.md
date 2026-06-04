# OpenClinXR Project Coordination Index

Last updated: 2026-06-04 (compact checkpoint edition after historical evidence/log pruning).

## Current State Snapshot

**Product focus**: OpenClinXR is a blueprint-driven encounter factory for a Step 2 CS-inspired XR clinical-skills exam platform. Current primary slice family: peds_asthma_parent_anxiety_v1 plus ED seed, with case definitions driving generated runtime behavior, review packets, persistence/replay, reusable assets, and WebXR evidence. Target workstation: Apple M1 Max 64 GB.

**Current emphasis**: convert case spec fields (communication profiles, escalation/deescalation triggers, empathy and parent-communication tags, clinical objectives, event schedule) into actor turns, dialogue cue policies, emotion transitions, locomotion/gaze/lip-sync hints, materialization work orders, review-safe handoffs, and replay surfaces. Supporting lane: UI-XR runtime evidence consumer for operator-selected manual realism evidence as review metadata only. Gates remain false for learner, Quest, production, clinical validity, scoring validity, and real-Anny/B+ claims unless explicitly promoted.

**Last completed checkpoint**: 2026-06-04 1-5+6 harness AgenticEx amp-up continuation + proof (4+1 new agents/rules/ MDs with frontmatter, AGENTS slim + markers, .grok/plugins/openclinxr-post-slice-automation, .grok/lsp.json, hooks + runner tie + memory consult hook, config tuning, classify extension so authority/drift clean, sync, authority to 220 MDs/agent-methodology ~20). #6 loop: search_replace fired PostToolUse hooks, spawn_subagent as explore chief-coordinator (full protocol, role memory consults, no drift/toil, recommended next), post-slice/inspect green (12 rules etc loaded), states updated with 1-6 record, guards green, committed f90252a + pushed. Tree clean. Next: Worker 9/7/11 UI-XR consumer/Admin ReviewReplay (metadata-only, handoff preference) or peds launch validation (Q1/Q4).

**Support checkpoint (harness AgenticEx amp-up)**: 2026-06-04 Grok/OpenClaw harness standardization for long unattended autonomy + multi-harness. Full .grok/config.toml (skills via .agents/skills + config, subagents with explore/plan per AGENTS subagent-protocol, memory injection + save, codebase_indexing + lsp_tools, bash timeouts for pnpm/agent/openclaw, grok_com_github MCP, ui + notifications for turn_complete, compat all true for rules/skills/hooks/agents, [plugins] note); agents/rules/ (6+ modular MDs extracted from AGENTS.md with authority:agent-methodology frontmatter: rehydration-low-token, subagent-protocol, drift-toil-prevention, source-of-truth, long-running-autonomy, grok-harness-usage + README); functional .grok/hooks/post-coord-edit-guards.json (PostToolUse matcher on Edit/search_replace triggers pnpm agent:alignment && pnpm docs:drift-check; PreCompact + SessionStart rehydrate reminders per resume); .claude/hooks.json + .cursor/hooks.json mirrors + .claude/rules/ .cursor/rules/ symlinks via updated scripts/sync-harness-agent-files.sh (skills symlinks removed; config-only); AGENTS.md slimmed + source-of-truth updated to reference agents/rules/; workflow-skill-policy.md multi-harness section. Guards + authority (280+ MDs) + drift green. grok inspect loads 8+ instructions + skills + subagents + hooks. Blueprint tie: materially improves agent capability (mission), harness-agnostic LOW_TOKEN + subagent + memory + auto-guard practices, supports sustained OpenClaw autonomy. Prepares 1-5 extractions/plugins/LSP/hooks-enhance/memory-role + #6 full loop proof. Touched: .grok/* (config/hooks), agents/rules/* (7), scripts/sync-*.sh, .claude/*, .cursor/*, AGENTS.md, docs/agent-factory/workflow-skill-policy.md, doc-authority-registry* + 3 state files.

**1/5 extractions continuation**: 4 more rules (hyper-token-efficient-long-run-practices.md, blueprint-factory-guardrails.md, repo-defined-agents-worker-roles.md, persistent-memory-scoring.md); AGENTS slim + marker restore; registry build extended + authority now 19 agent-methodology / mirrors current-ref (archive down); sync + guards green. Touched 4 md + AGENTS + registry ts/json/md + rules README.

**#6 full loop proof**: search_replace on coord fired PostToolUse hook (guard + runner tie + memory consult); spawn_subagent (explore, chief-coordinator read-only) followed protocol (confirmed files, read 9 role charter/memory, no drift, rec next Worker 9/7/11 UI-XR or peds handoff launch); post-slice/lease/inspect-sim green (12 rules, 2 hooks, plugin, lsp); states updated; guards green; 220 MDs. Blueprint Q1/Q4. Next: select UI-XR consumer / peds validation from queue + continue.

**Support (harness)**: 2026-06-04 agentex-openclaw-full-autonomy-gaps analysis (new doc in docs/agent-factory/, 21 agent-methodology). Gaps for full autonomy using repo agents/**: orchestration heartbeat loop (scheduler+plugin), native role subagent mapping, memory write-back, auto-lease in hooks, Grok primary runner assertion, self drift-police, e2e smoke. 1-5+6 foundation strong.

**Next queued slice**: Worker 9/7/11 UI-XR runtime evidence consumer + Admin ReviewReplay stay metadata-only; or faculty review path determinism; or deeper peds launch with handoff in runtime bundle (post 11/9 propagation). Keep IWSDK sidecar on approved 0.3.1 packages unless explicitly upgraded. No real-Anny, B+, Quest, clinical, scoring, production, or learner-readiness claims.

## Efficient Rehydration + Working Model

Read this file, `AUTONOMOUS_WORK_PLAN.md`, `docs/openclinxr/worker-backlog-and-validation-matrix.md`, and `AGENTS.md` first. Use snapshots-first, targeted `rg`, focused tests, and `pnpm openclaw:lease -- status` before editing during autonomous work. The OpenClaw daily driver is repo-native, not an external daemon: small deterministic slices, durable state in the three control files, focused verification, then immediate product pivot.

Efficiency Quick Ref:

- `pnpm agent:alignment` is the fast guard.
- `pnpm docs:drift-check` protects the control surfaces.
- `pnpm openclaw:lease -- acquire --owner <agent> --slice <slice> --ttl-minutes 60` prevents overlapping edits.
- `pnpm openclaw:post-slice` after each coherent slice.
- Prefer focused `pnpm exec vitest run <file> -t "<substring>"`.
- Do not read or recreate historical ledgers; use git history for audit.

## Protected Blueprint-Factory Guardrails

Do not weaken or reinterpret:

- `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md`
- `docs/openclinxr/doc-authority-registry-2026-05-27.md`
- `docs/openclinxr/doc-authority-registry-2026-05-27.json`
- `docs/openclinxr/generated-artifact-registry-2026-05-27.md`
- `docs/openclinxr/generated-artifact-registry-2026-05-27.json`
- `docs/openclinxr/openclaw-runbook-2026-05-27.md`
- `docs/openclinxr/openclaw-tool-adapters-2026-05-27.md`

Conversation tooling is first-class. OpenClinXR is not a collection of handcrafted scenes; the blueprint must drive actors, dialogue, emotional state, locomotion, reusable assets, traces, persistence, review packets, and runtime evidence.

## Active Product Advancement Queue

1. Worker 11/9: surface `pedsHumanoidMaterializationHandoff` through publication/readiness/review packets and runtime metadata preference.
2. Worker 9/7/11: keep UI-XR runtime evidence consumer and Admin ReviewReplay surfaces review-safe, metadata-only, and operator-selectable.
3. Worker 7 plus Worker 8 completed-station faculty review path: ensure faculty/admin review, replay, station completion, and local exam smoke stay deterministic.
4. Worker 11: keep Clinical Asset Commons reusable and provenance-gated; materialization evidence must be sidecar-backed and reviewable.
5. Worker 10/local runtime: local AI/voice/model work only when tied to a concrete implementation slice, not source-currentness refreshes.

Evidence-Toil Stop Rule: evidence-only work is allowed only to verify just-touched behavior, unblock a product decision, or capture current runtime truth. After one evidence-only slice, pivot to product construction. After two, consult Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, VP Engineering Delivery, and OpenClaw Drift Police.

## Agent Use

OpenClaw Drift Police: consult `agents/adversarial/openclaw-drift-police/charter.md` and memory when artifacts scatter, one-off screenshots/logs proliferate, or a slice stops advancing the case-definition-driven factory.

Sub-Agent Work Order Template:

```text
Target repo: /Volumes/files/src/openclinxr.
Confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, and tools/agent-factory/** exist.
Role/nickname:
Scope:
Read-only or write scope:
Return: concise findings, blockers, and recommended next slice.
```

## Commit-History Drift Analysis

Checkpoint summary: May work drifted toward evidence churn and one-off visual reports; early June corrected by pruning historical artifacts, slimming agents, separating production apps/packages from the Capability Arena, linking arena work to MADRs, adding architecture fitness rules, and keeping the peds/ED blueprint-to-runtime path as the product pivot. Full counts and old ledger entries were removed from active context; use git history for audit.

## Required Per-Slice Record

Record slices in `AUTONOMOUS_WORK_PLAN.md` and the worker matrix with: Product path advanced, Blueprint/factory tie, Touched files, Evidence, Next queued slice. Then run focused verification plus `pnpm agent:alignment` and `pnpm docs:drift-check` when coordination files changed.
