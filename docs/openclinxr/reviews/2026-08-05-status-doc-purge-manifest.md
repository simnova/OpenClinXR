# Status-doc purge audit manifest — 2026-08-05

**Goal:** Move HOT status to the GitHub board; remove rotting progress Markdown; keep durable how-tos/policies.  
**Scope:** Markdown + regenerated authority registry only (no product `.ts`/`.tsx`/`.py`).  
**Protected policy set:** untouched (AGENTS, PROJECT_STATUS header/Strategy, 8 protected openclinxr docs, MADRs, agents/rules, harness mirrors, skills).  
**New GitHub issues:** [#28](https://github.com/simnova/OpenClinXR/issues/28) deferred TypeScript strictness (no duplicates of #11–12, #16–27).  
**Verify:** `pnpm docs:authority` · `pnpm docs:drift-check` · `pnpm agent:alignment` · inbound link sweep.

Legend: **MIGRATED #n** = open item captured on GitHub then file removed · **REMOVED** = historical only (git history) · **KEPT** = durable reference / process / tool-required · **KEPT (uncertain)** = conservative retain.

---

## Summary counts

| Decision | Count (approx) |
|----------|----------------|
| REMOVED | 55 markdown paths |
| MIGRATED | 1 path → #28 |
| KEPT (restored living) | 1 (`turbo-remote-cache-setup.md`) |
| KEPT (tool-required cold) | 1 (`docs/_archive/iterations/0009/07-final-synthesis.md`) |
| KEPT (examined, not purged) | warehouse shell + living guides + evidence/operator surfaces |

---

## archive-candidate (16)

| path | classification | decision | one-line reason |
|------|----------------|----------|-----------------|
| `.openclinxr/README.md` | archive-candidate | KEPT | Local-only runtime map (gitignored tree); how-to, not progress status. |
| `.openclinxr/openclaw/task-cost-latest.md` | archive-candidate | KEPT (uncertain) | Generated local cost snapshot under gitignore; not in git purge scope. |
| `.openclinxr/slice-archive/worker-backlog-pre-optimization-2026-06-07.md` | archive-candidate | KEPT (uncertain) | Gitignored historical snapshot; no commit surface. |
| `AUTONOMOUS_WORK_PLAN.md` | archive-candidate | REMOVED | Historical ledger stub; HOT state → `PROJECT_STATUS.md` + board. |
| `PROJECT_COORDINATION_INDEX.md` | archive-candidate | REMOVED | Historical ledger stub; HOT state → `PROJECT_STATUS.md` + board. |
| `docs/openclinxr/anny-character-asset-pipeline-implementation-2026-06-03.md` | archive-candidate | REMOVED | Stub; successor `asset-generation-pipeline.md`. |
| `docs/openclinxr/arena-physics-clinical-touch-cagematch-2026-08-01.md` | archive-candidate | REMOVED | Closed residual ledger; open D1–D5 live in realbind brief. |
| `docs/openclinxr/dependency-hygiene-and-e18e-policy.md` | archive-candidate | REMOVED | Stub; successor `docs/TOOLING.md`. |
| `docs/openclinxr/generated-output-storage-policy-2026-06-06.md` | archive-candidate | REMOVED | Stub; successor generated-artifact registry. |
| `docs/openclinxr/gltf-transform-replacement-decision-2026-05-27.md` | archive-candidate | REMOVED | Stub; successor `docs/madr/`. |
| `docs/openclinxr/turbo-remote-cache-setup.md` | archive-candidate | KEPT | Usable setup guide restored from cold body; turbo cache is parallel-agent throughput SSOT. |
| `docs/openclinxr/typescript-strictness-gap-matrix-2026-05-27.md` | archive-candidate | MIGRATED #28 | Deferred strictness flags still open; captured in #28 then removed. |
| `plugins/openclinxr-openclaw-style/README.md` | archive-candidate | KEPT | Plugin install how-to; not status. |
| `plugins/openclinxr-openclaw-style/skills/openclinxr-openclaw-style/SKILL.md` | archive-candidate | KEPT | Skill start steps updated to PROJECT_STATUS; durable harness bridge. |
| `tools/openclinxr/asset-pipeline/anny/BVH-RETARGET-GUIDE-2026-08-03.md` | archive-candidate | KEPT | Durable retarget how-to for next agent (claim-scoped). |
| `tools/openclinxr/asset-pipeline/anny/README-rest-skeleton.md` | archive-candidate | KEPT | Durable rest-skeleton export path. |

---

## historical-synthesis (56 → examined)

### Hot dated stubs / iteration stubs (REMOVED)

| path | classification | decision | one-line reason |
|------|----------------|----------|-----------------|
| `docs/agent-ops/2026-08-02-ceo-bod-voice-revision.md` | historical-synthesis | REMOVED | Stub; successor `CEO-VOICE.md`. |
| `docs/agent-ops/2026-08-02-context-opt-charter-agentsmd-v3.md` | historical-synthesis | REMOVED | Stub; successor `PATH-SCOPE.md`. |
| `docs/agent-ops/2026-08-02-context-opt-grok45-v2.md` | historical-synthesis | REMOVED | Stub; successor `PATH-SCOPE.md`. |
| `docs/agent-ops/2026-08-02-context-opt-higher-v1.md` | historical-synthesis | REMOVED | Stub; successor `PATH-SCOPE.md`. |
| `docs/agent-ops/2026-08-02-context-opt-thrash-evidence.md` | historical-synthesis | REMOVED | Stub; successor `PATH-SCOPE.md`. |
| `docs/agent-ops/2026-08-02-context-opt-wave-a-enforce.md` | historical-synthesis | REMOVED | Stub; successor `PATH-SCOPE.md`. |
| `docs/agent-ops/2026-08-02-context-opt-wave-b-tools.md` | historical-synthesis | REMOVED | Stub; successor `PATH-SCOPE.md`. |
| `docs/agent-ops/2026-08-02-context-opt-wave-c.md` | historical-synthesis | REMOVED | Stub; successors PATH-SCOPE + composition/worktree. |
| `docs/agent-ops/2026-08-02-docs-warehouse-v1.md` | historical-synthesis | REMOVED | Stub; successor `DOC-WAREHOUSE.md`. |
| `docs/agent-ops/2026-08-02-path-scope-policy-v1.md` | historical-synthesis | REMOVED | Stub; successor `PATH-SCOPE.md`. |
| `docs/agent-ops/2026-08-02-roster-review.md` | historical-synthesis | REMOVED | Stub; successor `REVIEW-CADENCE.md`. |
| `docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md` | historical-synthesis | KEPT | Warm temporal review with next-review cadence + residual upstream ask; not pure dead status. |
| `docs/openclinxr/research-brief-step2cs-llm-vsp.md` | historical-synthesis | REMOVED | Stub; mission lives in AGENTS product goal. |
| `iterations/README.md` | historical-synthesis | KEPT | Index rewritten to cold retain + living process. |
| `iterations/iteration-0009/00-brief.md` | historical-synthesis | REMOVED | Hot stub; historical iteration dump. |
| `iterations/iteration-0009/01-core-plan.md` | historical-synthesis | REMOVED | Hot stub. |
| `iterations/iteration-0009/03-adversarial-counterplan.md` | historical-synthesis | REMOVED | Hot stub. |
| `iterations/iteration-0009/05-core-revision.md` | historical-synthesis | REMOVED | Hot stub. |
| `iterations/iteration-0009/06-leadership-review.md` | historical-synthesis | REMOVED | Hot stub. |
| `iterations/iteration-0009/07-final-synthesis.md` | historical-synthesis | REMOVED | Hot stub only; cold body KEPT (below). |
| `iterations/iteration-0009/08-memory-update-log.md` | historical-synthesis | REMOVED | Hot stub. |
| `iterations/iteration-0009/leadership-packet.md` | historical-synthesis | REMOVED | Hot stub. |

### Cold warehouse bodies (REMOVED unless noted)

| path | classification | decision | one-line reason |
|------|----------------|----------|-----------------|
| `docs/_archive/README.md` | historical-synthesis | KEPT | Warehouse entry rewritten for purge posture. |
| `docs/_archive/wiki/index.md` | historical-synthesis | KEPT | Topic map rewritten. |
| `docs/_archive/wiki/topics/agent-factory-iterations.md` | historical-synthesis | KEPT | Recovery map + retain note. |
| `docs/_archive/wiki/topics/agent-ops-revisions.md` | historical-synthesis | KEPT | Recovery map + successors. |
| `docs/_archive/wiki/topics/coordination-ledgers.md` | historical-synthesis | KEPT | Recovery map + successors. |
| `docs/_archive/wiki/topics/openclinxr-product-docs.md` | historical-synthesis | KEPT | Recovery map; turbo/strictness outcomes. |
| `docs/_archive/agent-ops/2026-08/2026-08-02-*.md` (11 bodies) | historical-synthesis | REMOVED | Superseded living agent-ops SSOT; git history. |
| `docs/_archive/coordination/2026-08/AUTONOMOUS_WORK_PLAN.md` | historical-synthesis | REMOVED | Historical status ledger body. |
| `docs/_archive/coordination/2026-08/PROJECT_COORDINATION_INDEX.md` | historical-synthesis | REMOVED | Historical status ledger body. |
| `docs/_archive/iterations/0009/00-brief.md` | historical-synthesis | REMOVED | Historical iteration dump. |
| `docs/_archive/iterations/0009/01-core-plan.md` | historical-synthesis | REMOVED | Historical iteration dump. |
| `docs/_archive/iterations/0009/03-adversarial-counterplan.md` | historical-synthesis | REMOVED | Historical iteration dump. |
| `docs/_archive/iterations/0009/05-core-revision.md` | historical-synthesis | REMOVED | Historical iteration dump. |
| `docs/_archive/iterations/0009/06-leadership-review.md` | historical-synthesis | REMOVED | Historical iteration dump. |
| `docs/_archive/iterations/0009/07-final-synthesis.md` | historical-synthesis | KEPT | **Required** by `agent:alignment` markers + durable anti-toil lesson. |
| `docs/_archive/iterations/0009/08-memory-update-log.md` | historical-synthesis | REMOVED | Historical iteration dump. |
| `docs/_archive/iterations/0009/leadership-packet.md` | historical-synthesis | REMOVED | Historical iteration dump. |
| `docs/_archive/openclinxr/2026-05/gltf-transform-replacement-decision-2026-05-27.md` | historical-synthesis | REMOVED | Historical decision note; MADRs supersede. |
| `docs/_archive/openclinxr/2026-05/research-brief-step2cs-llm-vsp.md` | historical-synthesis | REMOVED | Historical research; mission in AGENTS. |
| `docs/_archive/openclinxr/2026-05/typescript-strictness-gap-matrix-2026-05-27.md` | historical-synthesis | MIGRATED #28 | Deferred gaps → #28; body removed. |
| `docs/_archive/openclinxr/2026-06/anny-character-asset-pipeline-implementation-2026-06-03.md` | historical-synthesis | REMOVED | Superseded implementation note. |
| `docs/_archive/openclinxr/2026-06/dependency-hygiene-and-e18e-policy.md` | historical-synthesis | REMOVED | Superseded by TOOLING. |
| `docs/_archive/openclinxr/2026-06/generated-output-storage-policy-2026-06-06.md` | historical-synthesis | REMOVED | Superseded by registry. |
| `docs/_archive/openclinxr/2026-06/turbo-remote-cache-setup.md` | historical-synthesis | REMOVED | Content restored to hot living guide (not dual-stored). |

---

## evidence (36) — examined; conservative

| path | classification | decision | one-line reason |
|------|----------------|----------|-----------------|
| `operator-open-questions.md` | evidence | KEPT | Living nonblocking operator Qs; not a purge target. |
| `operator-steering-needed-questions.md` | evidence | KEPT | Living true blockers surface. |
| `docs/openclinxr/cagematch-spec-local-stt-and-quest-transport-2026-08-05.md` | evidence | KEPT | Spec/how-to for cagematch lane; still referenced by product work. |
| `docs/openclinxr/godot-quest-voice-client-spike.md` | evidence | KEPT | Spike reference for voice path. |
| `docs/openclinxr/humanoid-source-quality-gate-2026-05-27.md` | evidence | KEPT | Quality-gate reference. |
| `docs/openclinxr/iwsdk-codex-mcp-runbook.md` | evidence | KEPT | Runbook/how-to. |
| `docs/openclinxr/local-hardware-spike-results.md` | evidence | KEPT (uncertain) | Hardware facts still cited; keep until replaced by fresher evidence index. |
| `docs/openclinxr/psychometric-and-review-governance.md` | evidence | KEPT | Governance reference (claim control). |
| `docs/openclinxr/quest3-usb-webxr-smoke-checklist.md` | evidence | KEPT | Operator checklist how-to. |
| `docs/openclinxr/reviews/2026-08-05-cellix-typescript-pnpm-second-opinion.md` | evidence | KEPT | Recent second-opinion review; still actionable context for #18–21. |
| `docs/openclinxr/security-audit-cadence.md` | evidence | KEPT | Cadence policy. |
| `docs/openclinxr/security-audit-exceptions.md` | evidence | KEPT | Exception register. |
| `docs/openclinxr/spikes/vibevoice-local-voice-spike.md` | evidence | KEPT | Spike reference. |
| `docs/openclinxr/webxr-azure-quest-performance-brief.md` | evidence | KEPT (uncertain) | Performance brief; keep pending quest evidence gates. |
| `apps/arena/ui-quest-voice-godot/README.md` | evidence | KEPT | App how-to. |
| `apps/arena/ui-xr-iwsdk-spike/README.md` | evidence | KEPT | Spike app how-to. |
| `packages/openclinxr/arena/iwsdk-spike/README.md` | evidence | KEPT | Package how-to. |
| `benchmarks/glb-optimization/README.md` | evidence | KEPT | Benchmark harness docs. |
| `benchmarks/glb-optimization/latest-report.md` | evidence | KEPT (uncertain) | Latest report pointer; may regenerate; not pure rotting status narrative. |
| `benchmarks/glb-optimization/reports/glb-optimization-cagematch-2026-06-07-openclinxr-samples-final.md` | evidence | KEPT (uncertain) | Dated run report; keep for gate comparison until evidence-index reclass. |
| `.openclinxr/delegation/scorecard.md` | evidence | KEPT (uncertain) | Local gitignored. |
| `.openclinxr/evidence/**/*.md` | evidence | KEPT (uncertain) | Local run notes (gitignored). |
| `.openclinxr/tool-runtimes/**/LICENSE.md` (+ numpy/torch licenses) | evidence | KEPT | Third-party license texts; never purge. |

---

## Other KEPT living surfaces (examined; not status dumps)

| path | classification | decision | one-line reason |
|------|----------------|----------|-----------------|
| `AGENTS.md` | protected-policy | KEPT | Protected; still names legacy ledgers as audit-only strings (alignment markers). |
| `PROJECT_STATUS.md` | protected-policy | KEPT | Header/Strategy intact; historical checkpoints not hand-edited. |
| `docs/openclinxr/worker-backlog-and-validation-matrix.md` | protected-policy | KEPT | Ownership matrix (fixed via #27 workstream). |
| `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md` | protected-policy | KEPT | Protected; may still name historical ledger filenames. |
| `docs/openclinxr/codex-openclaw-operating-bridge-2026-05-27.md` | protected-policy | KEPT | Protected; still documents legacy queue file names (do not weaken). |
| `docs/openclinxr/doc-authority-registry-2026-05-27.md` + `.json` | protected-policy | KEPT | Regenerated via `pnpm docs:authority` after removals. |
| `docs/openclinxr/generated-artifact-registry-2026-05-27.md` + `.json` | protected-policy | KEPT | Protected. |
| `docs/openclinxr/openclaw-runbook-2026-05-27.md` | protected-policy | KEPT | Protected. |
| `docs/openclinxr/openclaw-tool-adapters-2026-05-27.md` | protected-policy | KEPT | Protected. |
| `docs/openclinxr/evidence-index-2026-05-27.md` + `.json` | protected-policy | KEPT | Protected. |
| `docs/madr/**` | decision-record | KEPT | Off-limits permanent decisions (incl. MADR 0029 pointer to purged residual ledger — intentional historical cite). |
| `docs/agent-ops/DOC-WAREHOUSE.md` | current-reference | KEPT | Living warehouse process updated for purge. |
| `docs/agent-ops/REVISION-INDEX.md` | current-reference | KEPT | Warm index updated for purge. |
| `docs/agent-ops/*` non-dated SSOT (PATH-SCOPE, CEO-VOICE, …) | current-reference | KEPT | Living law; never-archive list. |
| `docs/openclinxr/arena-physics-clinical-touch-realbind-2026-08-02.md` | current-reference | KEPT | **Active** epic brief (open D1–D5); not residual status. |
| `docs/openclinxr/physics-realbind-pre-production-readiness-checklist-2026-08-02.md` | current-reference | KEPT | Checklist for realbind lane. |
| `docs/TOOLING.md` | current-reference | KEPT | CLI-first policy. |
| `docs/agent-factory/**` | agent-methodology | KEPT | Factory operating manual; links updated. |
| `agents/**` charters/memories | agent-memory | KEPT | Off-limits instruction surfaces; some still name legacy ledgers (see inbound). |
| `agents/rules/**` · `.grok/.claude/.cursor/.codex/**` · `.agents/skills/**` | methodology | KEPT | Explicitly out of scope. |

---

## Inbound links after purge

### Fixed (non-protected MD)

- Root `README.md`, `docs/openclinxr/README.md`, `iterations/README.md`
- `docs/agent-factory/README.md`, `operating-loop.md`
- `docs/agent-ops/DOC-WAREHOUSE.md`, `REVISION-INDEX.md`
- `docs/_archive/**` wiki shell
- `plugins/.../SKILL.md`
- `packages/openclinxr/arena/physics-touch-contract/README.md` → MADR 0029 + realbind
- `docs/openclinxr/code-implementation-plan.md`, `asset-pipeline-vetting-and-cagematch-plan-2026-06-05.md`, realbind brief

### Surviving references (intentional / off-limits)

| Location | Why left |
|----------|----------|
| `AGENTS.md` | Alignment marker requires string `PROJECT_COORDINATION_INDEX.md`; text already “audit-only”. |
| `PROJECT_STATUS.md` per-slice checkpoints | Historical checkpoint text; no hand-delete from this file. |
| Protected openclinxr bridge / guardrails | May name legacy queue files; must not weaken. |
| `docs/madr/0029-*.md` | Off-limits MADR still cites purged residual ledger as historical provenance. |
| `agents/**` charters (chief-coordinator, drift-police, productivity-skeptic) | Agent memory; out of narrow MD purge scope; still name legacy ledger basenames as rehydrate vocabulary. |
| `agents/rules/source-of-truth.md` | Off-limits rules; historical ledger names in SoT order. |

---

## Warehouse keep/remove judgment

| Area | Judgment |
|------|----------|
| `docs/_archive/**` process shell (README, wiki, manifests) | **KEPT** — earns keep as freeze catalog + archivist entry; bodies largely purged. |
| Cold status **bodies** | **Mostly REMOVED** — git history is the archive; coordination ledgers + `07-final-synthesis` **restored** (see post-purge restores). |
| JSON `ARCHIVE-MANIFEST.json` | **KEPT** — path catalogs with `bodyStatus` after index-truth pass. |

---

## Operator notes

1. HOT operational work continues on GitHub issues/board (`gh`). Root `AUTONOMOUS_WORK_PLAN.md` / `PROJECT_COORDINATION_INDEX.md` exist again as **archived audit stubs** only (see post-purge restores) — do not expand them into living status surfaces.
2. Turbo remote cache: enable via restored guide when worktrees thrash local `.turbo/cache`.
3. Strictness paydown: track in #28 (alongside #18/#19/#21 for project references / emit).
4. If alignment ever drops the hard dependency on `docs/_archive/iterations/0009/07-final-synthesis.md`, that body can be purged too (git history).

---

## Post-purge restores (must keep resolving)

After the purge, some paths were **deliberately restored** because alignment, MADRs, or tooling still resolve them. Indexes and manifests were updated 2026-08-05 to record disk truth (`bodyStatus` on `ARCHIVE-MANIFEST.json`).

| Path | Role |
|------|------|
| `AUTONOMOUS_WORK_PLAN.md` | Root archived stub (not living status) |
| `PROJECT_COORDINATION_INDEX.md` | Root archived stub (not living status) |
| `docs/_archive/coordination/2026-08/AUTONOMOUS_WORK_PLAN.md` | Cold warehouse body |
| `docs/_archive/coordination/2026-08/PROJECT_COORDINATION_INDEX.md` | Cold warehouse body |
| `docs/openclinxr/arena-physics-clinical-touch-cagematch-2026-08-01.md` | Cited by MADR 0029 |
| `docs/_archive/iterations/0009/07-final-synthesis.md` | Alignment + durable lesson |
| `docs/openclinxr/turbo-remote-cache-setup.md` | Living setup guide |

Do **not** re-remove these without updating every pointer in the same change.
