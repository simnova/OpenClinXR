# Docs warehouse (cold archive wiki)

**Entry for archivist / historical audit only.** Not part of normal session rehydrate.

| Go | Path |
|----|------|
| Topic map | [wiki/index.md](./wiki/index.md) |
| Living warehouse process | [`docs/agent-ops/DOC-WAREHOUSE.md`](../agent-ops/DOC-WAREHOUSE.md) |
| Warm revision index | [`docs/agent-ops/REVISION-INDEX.md`](../agent-ops/REVISION-INDEX.md) |
| Cadence (when to freeze) | [`docs/agent-ops/DOC-HYGIENE-CADENCE.md`](../agent-ops/DOC-HYGIENE-CADENCE.md) |

## Structure (wiki-capable)

```
docs/_archive/
  README.md                 ← you are here
  wiki/
    index.md                ← topic map
    topics/*.md             ← multi-file topic pages
  agent-ops/<YYYY-MM>/      ← bodies + ARCHIVE-MANIFEST.json
  coordination/<YYYY-MM>/
  openclinxr/<YYYY-MM>/
  iterations/<id>/
```

## Topics

- [Agent-factory iterations](./wiki/topics/agent-factory-iterations.md) (8 files)
- [Agent-ops dated revision records](./wiki/topics/agent-ops-revisions.md) (11 files)
- [Historical coordination ledgers](./wiki/topics/coordination-ledgers.md) (2 files)
- [OpenClinXR product/process docs (cold)](./wiki/topics/openclinxr-product-docs.md) (7 files)

## Rules

1. Cold content is **historical-synthesis** — never marching orders.
2. Stubs at original paths point here + successor living SSOT.
3. Prefer `pnpm docs:archive -- plan|freeze --set cruft|agent-ops|all` over ad-hoc moves.
4. Binary/runtime evidence under `.openclinxr/` is gitignored local cache — not this warehouse.
