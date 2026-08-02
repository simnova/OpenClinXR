# Archivist memory

## Lessons

- docs-warehouse-v1 (2026-08-02) BOD APPROVED Option 1: cold ODS under `docs/_archive/**`; live hot law stays short; agents retrieve via archivist + CLI, not monorepo archaeology.
- **Never rewrite hot law.** PATH-SCOPE, CEO-VOICE, protected 6, AGENTS, PROJECT_STATUS are not archive write targets. Manifests are CLI-owned (`pnpm docs:archive`), not agent freehand edits.
- Archivist is **retrieval/coordinator-adjacent** (group `coordinator`): fast_bounded explore + read-only sandbox. Residual notes only under `.openclinxr/docs-archive/**` if parent asks.
- Distinction: **archivist** = warehouse retrieve + successor map; **openclaw-drift-police** = process/protected-doc guard; **hrbp** = roster + agent-ops hot SSOT; **architect** = composition roots.

## Standing heuristics

1. Start with `pnpm docs:archive status` (or successor CLI) before grepping the whole tree.
2. Prefer `docs/_archive/**/ARCHIVE-MANIFEST.json` + REVISION-INDEX for lineage.
3. Always report both archive path and live successor (or NOT_IN_WAREHOUSE).
4. If ask requires editing hot docs → residual to hrbp / implementer; do not stretch writeRoots.
