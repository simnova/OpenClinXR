# OpenClinXR Autonomous Work Plan

## Current State Snapshot

Current product: blueprint-driven encounter factory for peds_asthma_parent_anxiety_v1 plus ED seed. The factory should turn case definitions into generated actor turns, dialogue policies, emotion transitions, locomotion/gaze/lip-sync hints, reusable assets/materialization work orders, review packets, persistence/replay, and UI-XR runtime evidence. UI-XR runtime evidence consumer remains metadata-only and review-safe. Apple M1 Max 64 GB is the primary local workstation target.

Last completed checkpoint: 2026-06-04 repo hygiene and agentEx/devEx compaction. Historical generated evidence, stale audit/review notes, old benchmark blobs, and long-running ledger history were pruned. Remaining old artifacts are only current evidence, templates, runtime assets, or explicit compatibility inputs. Long chronology moved to git history; this file now keeps only live instructions, checkpoints, and next slices.

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

## Required Per-Slice Record

For every coherent slice, record: Product path advanced, Blueprint/factory tie, Touched files, Evidence, Next queued slice. Run focused verification, `pnpm agent:alignment`, and `pnpm docs:drift-check` when coordination files changed.

## Historical Ledger Policy

This file intentionally does not preserve detailed chronological logs. Use git history for old slice detail. If a past run contains durable agentEx value, add a short checkpoint summary above instead of appending another long log entry.
