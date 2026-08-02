# Archive wiki — topic map

Cold multi-file index. Agents: **do not rehydrate** unless archivist/historical task.
Living law stays in hot SSOT (`docs/agent-ops/*`, `PROJECT_STATUS.md`, protected 6).

| Topic | Page | Files |
|-------|------|-------|
| Agent-factory iterations | [topics/agent-factory-iterations.md](./topics/agent-factory-iterations.md) | 8 |
| Agent-ops dated revision records | [topics/agent-ops-revisions.md](./topics/agent-ops-revisions.md) | 11 |
| Historical coordination ledgers | [topics/coordination-ledgers.md](./topics/coordination-ledgers.md) | 2 |
| OpenClinXR product/process docs (cold) | [topics/openclinxr-product-docs.md](./topics/openclinxr-product-docs.md) | 7 |

## Area folders (body storage)

- `docs/_archive/agent-ops/<YYYY-MM>/` — dated agent-ops revision bodies
- `docs/_archive/coordination/<YYYY-MM>/` — root historical ledgers
- `docs/_archive/openclinxr/<YYYY-MM>/` — product/process archive-candidates
- `docs/_archive/iterations/<id>/` — completed agent-factory iterations

Each area folder may contain `ARCHIVE-MANIFEST.json` (machine index).

Rebuild: `pnpm docs:archive -- wiki`
