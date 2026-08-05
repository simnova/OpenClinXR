# Archive wiki — topic map

Cold multi-file index. Agents: **do not rehydrate** unless archivist/historical task.
Living law stays in hot SSOT (`docs/agent-ops/*`, `PROJECT_STATUS.md`, protected policy set).

**2026-08-05:** most historical status bodies purged (git retains text). Topics below are recovery maps + successor pointers.

| Topic | Page | Posture |
|-------|------|---------|
| Agent-factory iterations | [topics/agent-factory-iterations.md](./topics/agent-factory-iterations.md) | 07-final-synthesis retained |
| Agent-ops dated revision records | [topics/agent-ops-revisions.md](./topics/agent-ops-revisions.md) | manifests + successors |
| Historical coordination ledgers | [topics/coordination-ledgers.md](./topics/coordination-ledgers.md) | purged → PROJECT_STATUS + board |
| OpenClinXR product/process docs (cold) | [topics/openclinxr-product-docs.md](./topics/openclinxr-product-docs.md) | turbo KEPT; strictness #28 |

## Area folders

- `docs/_archive/agent-ops/<YYYY-MM>/` — batch manifests
- `docs/_archive/coordination/<YYYY-MM>/` — batch manifests
- `docs/_archive/openclinxr/<YYYY-MM>/` — batch manifests
- `docs/_archive/iterations/<id>/` — retained synthesis body + manifests

Each area folder may contain `ARCHIVE-MANIFEST.json` (machine index of former paths).

Rebuild: `pnpm docs:archive -- wiki`
