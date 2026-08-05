# Topic: coordination ledgers

**Batch:** `cruft-audit-2026-08-02` (frozen)  
**Truth after 2026-08-05:** root stubs + cold warehouse bodies were **restored** after over-deletion (alignment / tooling still resolve them). They are **not** living status surfaces.  
**Manifest:** [`ARCHIVE-MANIFEST.json`](../../coordination/2026-08/ARCHIVE-MANIFEST.json)  
**Recover full historical text:** `git log --all --full-history -- AUTONOMOUS_WORK_PLAN.md PROJECT_COORDINATION_INDEX.md`

| Path | Presence | Successor SSOT |
|------|----------|----------------|
| `AUTONOMOUS_WORK_PLAN.md` (root stub) | **present** (archived stub) | `PROJECT_STATUS.md` + GitHub board (HOT) |
| `PROJECT_COORDINATION_INDEX.md` (root stub) | **present** (archived stub) | `PROJECT_STATUS.md` + GitHub board (HOT) |
| `docs/_archive/coordination/2026-08/AUTONOMOUS_WORK_PLAN.md` | **present** (cold body) | same |
| `docs/_archive/coordination/2026-08/PROJECT_COORDINATION_INDEX.md` | **present** (cold body) | same |

Do **not** expand these into living status ledgers. See purge audit: `docs/openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md`.
