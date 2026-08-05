# Agent-ops revision index (warm)

**Owner:** `pmo` (temporal) · `hrbp` (process) · **Process:** [`DOC-WAREHOUSE.md`](./DOC-WAREHOUSE.md) · **CLI:** `pnpm docs:archive`  
**Wiki home (cold):** [`docs/_archive/README.md`](../_archive/README.md) · **Topic map:** [`docs/_archive/wiki/index.md`](../_archive/wiki/index.md)

Short index of **frozen** batches. Living SSOT stays under `docs/agent-ops/*.md` (non-dated) and other hot paths. **`docs/_archive/**` is out of normal rehydrate** — open only via archivist or explicit historical task.

## Status-doc purge (2026-08-05)

Hot-path archive **stubs** and most cold warehouse **bodies** that were pure historical status were **removed** (git history retains full text). See:

- Audit: [`docs/openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md`](../openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md)
- Migrated open item: [issue #28](https://github.com/simnova/OpenClinXR/issues/28) (deferred TypeScript strictness)
- Restored living guide: [`docs/openclinxr/turbo-remote-cache-setup.md`](../openclinxr/turbo-remote-cache-setup.md)
- **Alignment-required cold retain:** [`docs/_archive/iterations/0009/07-final-synthesis.md`](../_archive/iterations/0009/07-final-synthesis.md)

JSON `ARCHIVE-MANIFEST.json` files under `docs/_archive/**` remain as **catalog of purged paths** (bodies deleted; recover via `git log -- <path>`).

## Batches

| Batch id | Status | Warehouse areas | Manifest(s) | Wiki topics |
|----------|--------|-----------------|-------------|-------------|
| `context-opt-2026-08-02` | **FROZEN** 2026-08-02 · **bodies purged** 2026-08-05 | [`agent-ops/2026-08/`](../_archive/agent-ops/2026-08/) (manifest only) | [manifest](../_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json) | [agent-ops-revisions](../_archive/wiki/topics/agent-ops-revisions.md) |
| `cruft-audit-2026-08-02` | **FROZEN** 2026-08-02 · **bodies purged** 2026-08-05 | coordination · openclinxr · iterations (07 retained) | per-area `ARCHIVE-MANIFEST.json` | [coordination-ledgers](../_archive/wiki/topics/coordination-ledgers.md) · [openclinxr-product-docs](../_archive/wiki/topics/openclinxr-product-docs.md) · [agent-factory-iterations](../_archive/wiki/topics/agent-factory-iterations.md) |

## Freeze set → successor (context-opt-2026-08-02)

| Dated record (removed; git history) | Successor living SSOT |
|-------------------------------------|------------------------|
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

| Source (removed; git history) | Successor |
|-------------------------------|-----------|
| `AUTONOMOUS_WORK_PLAN.md` | `PROJECT_STATUS.md` |
| `PROJECT_COORDINATION_INDEX.md` | `PROJECT_STATUS.md` |
| `docs/openclinxr/*` archive-candidates (except turbo restored) | TOOLING / asset-generation-pipeline / registry / madr / AGENTS / #28 |
| `iterations/iteration-0009/*.md` hot stubs | `docs/agent-factory/operating-loop.md` + cold `07-final-synthesis.md` |

## Wiki layout

```
docs/_archive/
  README.md
  wiki/index.md
  wiki/topics/*.md
  agent-ops/<YYYY-MM>/   # manifests; MD bodies purged 2026-08-05
  coordination/<YYYY-MM>/
  openclinxr/<YYYY-MM>/
  iterations/<id>/       # 07-final-synthesis retained
```

## Commands

```bash
pnpm docs:archive -- plan --set cruft|agent-ops|all
pnpm docs:archive -- freeze --set cruft --batch <batch-id>
pnpm docs:archive -- wiki
pnpm docs:archive -- status
pnpm docs:authority
```

## Not in this warehouse (yet / separate)

| Bucket | Why deferred |
|--------|----------------|
| `.openclinxr/asset-production`, `tool-runtimes`, `evidence` (~2G) | Gitignored local cache; generated-artifact policy — not MD warehouse |
| Closed `.openclinxr/slices/*` | Small JSON handoffs; optional future slice-archive pack |
| Live skills under `plugins/**` | Never-archive path (still referenced) |
| Protected `docs/openclinxr/*` (blueprint, runbook, registries) | Hot / protected-policy |
| Large dated evidence JSON under `docs/openclinxr/*2026-05-28*` | Evidence class; phase-2 candidate after registry reclass |
