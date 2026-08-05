# Docs warehouse (cold archive wiki)

**Entry for archivist / historical audit only.** Not part of normal session rehydrate.

| Go | Path |
|----|------|
| Topic map | [wiki/index.md](./wiki/index.md) |
| Living warehouse process | [`docs/agent-ops/DOC-WAREHOUSE.md`](../agent-ops/DOC-WAREHOUSE.md) |
| Warm revision index | [`docs/agent-ops/REVISION-INDEX.md`](../agent-ops/REVISION-INDEX.md) |
| Cadence (when to freeze) | [`docs/agent-ops/DOC-HYGIENE-CADENCE.md`](../agent-ops/DOC-HYGIENE-CADENCE.md) |
| Status-doc purge audit | [`docs/openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md`](../openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md) |

## Structure (wiki-capable)

```
docs/_archive/
  README.md                 ← you are here
  wiki/
    index.md                ← topic map
    topics/*.md             ← multi-file topic pages (successors + git recovery)
  agent-ops/<YYYY-MM>/      ← ARCHIVE-MANIFEST.json only (MD bodies purged 2026-08-05)
  coordination/<YYYY-MM>/   ← RESTORED cold ledger bodies + manifest
  openclinxr/<YYYY-MM>/     ← manifests only (MD bodies purged)
  iterations/<id>/          ← retained: 0009/07-final-synthesis.md
```

## Topics (post 2026-08-05 purge + restores)

- [Agent-factory iterations](./wiki/topics/agent-factory-iterations.md) — 07-final-synthesis retained; other bodies in git history
- [Agent-ops dated revision records](./wiki/topics/agent-ops-revisions.md) — bodies purged; successors living
- [Historical coordination ledgers](./wiki/topics/coordination-ledgers.md) — root stubs + cold bodies **restored** (audit only); HOT → PROJECT_STATUS + GitHub board
- [OpenClinXR product/process docs (cold)](./wiki/topics/openclinxr-product-docs.md) — turbo + arena-physics restored living; strictness → #28

## Rules

1. Cold content is **historical-synthesis** — never marching orders.
2. HOT status belongs on the **GitHub board**; durable cold records stay in `PROJECT_STATUS.md` snapshot / Strategy — not long-lived status MDs.
3. Prefer `pnpm docs:archive -- plan|freeze --set cruft|agent-ops|all` over ad-hoc moves when freezing **new** dated revisions.
4. Binary/runtime evidence under `.openclinxr/` is gitignored local cache — not this warehouse.
5. Purged bodies: recover with `git log --all --full-history -- <path>`. Manifests use `bodyStatus` (`present` | `purged-2026-08-05` | `living-restored`) so the catalog does not imply on-disk bodies.
