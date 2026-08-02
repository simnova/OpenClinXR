# Agent-ops revision index (warm)

**Owner:** `pmo` (temporal) · `hrbp` (process) · **Process:** [`DOC-WAREHOUSE.md`](./DOC-WAREHOUSE.md) · **CLI:** `pnpm docs:archive`  
**Wiki home (cold):** [`docs/_archive/README.md`](../_archive/README.md) · **Topic map:** [`docs/_archive/wiki/index.md`](../_archive/wiki/index.md)

Short index of **frozen** batches. Living SSOT stays under `docs/agent-ops/*.md` (non-dated) and other hot paths. **`docs/_archive/**` is out of normal rehydrate** — open only via archivist or explicit historical task.

## Batches

| Batch id | Status | Warehouse areas | Manifest(s) | Wiki topics |
|----------|--------|-----------------|-------------|-------------|
| `context-opt-2026-08-02` | **FROZEN** 2026-08-02 | [`agent-ops/2026-08/`](../_archive/agent-ops/2026-08/) | [manifest](../_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json) | [agent-ops-revisions](../_archive/wiki/topics/agent-ops-revisions.md) |
| `cruft-audit-2026-08-02` | **FROZEN** 2026-08-02 | coordination · openclinxr · iterations | per-area `ARCHIVE-MANIFEST.json` | [coordination-ledgers](../_archive/wiki/topics/coordination-ledgers.md) · [openclinxr-product-docs](../_archive/wiki/topics/openclinxr-product-docs.md) · [agent-factory-iterations](../_archive/wiki/topics/agent-factory-iterations.md) |

## Freeze set → successor (context-opt-2026-08-02)

| Dated record (stub remains in hot tree) | Successor living SSOT |
|-----------------------------------------|------------------------|
| `2026-08-02-path-scope-policy-v1.md` | `PATH-SCOPE.md` |
| `2026-08-02-context-opt-higher-v1.md` | `PATH-SCOPE.md` |
| `2026-08-02-context-opt-grok45-v2.md` | `PATH-SCOPE.md` |
| `2026-08-02-context-opt-charter-agentsmd-v3.md` | `PATH-SCOPE.md` |
| `2026-08-02-context-opt-wave-a-enforce.md` | `PATH-SCOPE.md` |
| `2026-08-02-context-opt-wave-b-tools.md` | `PATH-SCOPE.md` |
| `2026-08-02-context-opt-thrash-evidence.md` | `PATH-SCOPE.md` |
| `2026-08-02-context-opt-wave-c.md` | `PATH-SCOPE.md` + `COMPOSITION-ROOTS.md` + `WORKTREE-PROMOTE.md` |
| `2026-08-02-ceo-bod-voice-revision.md` | `CEO-VOICE.md` |
| `2026-08-02-roster-review.md` | `REVIEW-CADENCE.md` |
| `2026-08-02-docs-warehouse-v1.md` | `DOC-WAREHOUSE.md` |

## Freeze set → successor (cruft-audit-2026-08-02)

| Source (stub) | Warehouse area | Successor |
|---------------|----------------|-----------|
| `AUTONOMOUS_WORK_PLAN.md` | coordination/2026-08 | `PROJECT_STATUS.md` |
| `PROJECT_COORDINATION_INDEX.md` | coordination/2026-08 | `PROJECT_STATUS.md` |
| `docs/openclinxr/*` archive-candidates | openclinxr/2026-05 · 2026-06 | TOOLING / asset-generation-pipeline / registry / madr / AGENTS |
| `iterations/iteration-0009/*.md` | iterations/0009 | `docs/agent-factory/operating-loop.md` |

## Wiki layout

```
docs/_archive/
  README.md
  wiki/index.md
  wiki/topics/*.md
  agent-ops/<YYYY-MM>/
  coordination/<YYYY-MM>/
  openclinxr/<YYYY-MM>/
  iterations/<id>/
```

## Commands

```bash
pnpm docs:archive -- plan --set cruft|agent-ops|all
pnpm docs:archive -- freeze --set cruft --batch cruft-audit-2026-08-02
pnpm docs:archive -- wiki
pnpm docs:archive -- status
pnpm docs:authority
```

## Not in this warehouse (yet / separate)

| Bucket | Why deferred |
|--------|----------------|
| `.openclinxr/asset-production`, `tool-runtimes`, `evidence` (~2G) | Gitignored local cache; generated-artifact policy — not MD warehouse |
| Closed `.openclinxr/slices/*` (28 trees) | Small JSON handoffs; optional future slice-archive pack |
| Live skills under `plugins/**` | Never-archive path (still referenced) |
| Protected `docs/openclinxr/*` (blueprint, runbook, registries) | Hot / protected-policy |
| Large dated evidence JSON under `docs/openclinxr/*2026-05-28*` | Evidence class; phase-2 candidate after registry reclass |
