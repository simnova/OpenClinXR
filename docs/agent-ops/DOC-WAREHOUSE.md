# Doc warehouse (ODS → cold archive)

**Owner:** `hrbp` (process SSOT + roster) · **`pmo`** (temporal hygiene / when to freeze) · **`archivist`** (cold retrieval; dual-stack read-only) · orchestrator (respect force gate before product dequeue)  
**Policy tier:** standard_execution · **BOD status:** APPROVED 2026-08-02 (Option 1)  
**CLI:** `pnpm docs:archive` · **Authority:** `pnpm docs:authority`

## Why

Agent rehydrate must stay **hot/warm only**. Dated revision records and completed slice dumps are valuable history but **must not** crowd the living SSOT surface agents open every session. This warehouse is the process + CLI for moving cold content out of the hot path without losing successor pointers.

**Periodic enough, not per-task:** freeze and checkpoint archive run on **thresholds and cadence** (e.g. ≥5 dated bodies, `###` blocks >20, weekly Sunday keep-14, biweekly freeze check, session-start force when cold candidates > N) — never after every slice. Cadence SSOT: [`DOC-HYGIENE-CADENCE.md`](./DOC-HYGIENE-CADENCE.md) (mermaid lifecycle + workflow, trigger matrix, anti-backlog).

OpenClinXR is not a product document store for clinical content; this is **agent-ops + coordination** warehouse only.

## Tiers (ODS model)

| Tier | What lives here | Agent behavior |
|------|-----------------|----------------|
| **Hot** | Current law / SSOT that agents must obey on rehydrate | Open first; never archive while living |
| **Warm** | Recent checkpoints, revision index, capability request queue | Open when the slice needs recent history |
| **Cold** | Frozen dated revisions, slice archives, warehouse manifests | **Do not open** unless archivist/historical task |

### Hot (current law — never-archive list)

Protected + living agent-ops SSOT (non-dated):

| Path | Role |
|------|------|
| `AGENTS.md` | Operating contract |
| `PROJECT_STATUS.md` (header / snapshot only for rehydrate) | Canonical state |
| `docs/openclinxr/worker-backlog-and-validation-matrix.md` | Ownership matrix |
| Protected 6 (blueprint guardrails, doc-authority registry md+json, generated-artifact registry md+json, openclaw runbook, openclaw tool adapters) | Non-negotiable policy |
| `docs/TOOLING.md` | CLI-first barrier policy |
| `docs/agent-ops/README.md` | Agent-ops index |
| `docs/agent-ops/PATH-SCOPE.md` | Path-scope hard law |
| `docs/agent-ops/CEO-VOICE.md` | CEO → BOD voice SSOT |
| `docs/agent-ops/COMPOSITION-ROOTS.md` | Composition / package topology law |
| `docs/agent-ops/WORKTREE-PROMOTE.md` | Worktree promote loop |
| `docs/agent-ops/DOC-WAREHOUSE.md` | This file |
| `docs/agent-ops/DOC-HYGIENE-CADENCE.md` | Periodic enough cadence + SessionStart catch-up |
| `docs/agent-ops/DOC-HYGIENE-CADENCE.md` | When to freeze/archive (periodic; never per-task) |
| `docs/agent-ops/MAIN-SESSION-ORCHESTRATOR-ONLY.md` | Main = orchestrator CEO only |
| `docs/agent-ops/RACI.md` | RACI |
| `docs/agent-ops/REVIEW-CADENCE.md` | Roster review cadence |
| `docs/agent-ops/CAPABILITY-EVOLUTION.md` | Capability request path |
| `.grok/prompts/agentic-io-contract.md` | Child agent I/O contract |

### Warm

| Path | Role |
|------|------|
| Last N `###` checkpoints in `PROJECT_STATUS.md` (see `pnpm openclaw:checkpoint:archive`) | Recent slice ledger |
| `docs/agent-ops/REVISION-INDEX.md` | Index of frozen warehouse batches |
| `docs/agent-ops/capability-requests/**` | Living request queue (not dated freeze) |
| Active `.openclinxr/slices/<id>/**` | In-flight slice brief/handoffs |

### Cold (wiki-capable multi-file archive)

| Path | Role |
|------|------|
| `docs/_archive/README.md` | **Wiki home** — archivist entry only |
| `docs/_archive/wiki/index.md` | Topic map (multi-file index) |
| `docs/_archive/wiki/topics/*.md` | Topic pages linking stubs → bodies → successors |
| `docs/_archive/agent-ops/<YYYY-MM>/` | Dated agent-ops revision bodies + manifest |
| `docs/_archive/coordination/<YYYY-MM>/` | Root historical ledgers |
| `docs/_archive/openclinxr/<YYYY-MM>/` | Product/process archive-candidates |
| `docs/_archive/iterations/<id>/` | Completed agent-factory iterations |
| `.openclinxr/slice-archive/**` | Checkpoint JSONL cold store (local; often gitignored parent) |
| Dated/hot stubs at original paths | Pointers only — not law |

**Wiki model:** cold storage is multi-file + index (not a single dump). Prefer topic pages over flat month-only browsing. Rebuild: `pnpm docs:archive -- wiki`.

## Never-archive list (hard)

Do **not** move, stub, or cold-store:

1. All **Hot** paths above (protected 6 + living agent-ops SSOT + TOOLING + agentic-io-contract).
2. `docs/agent-ops/REVISION-INDEX.md` (warm index stays hot-adjacent).
3. `docs/agent-ops/capability-requests/**` (living queue, not dated revision freeze).
4. Active slice trees under `.openclinxr/slices/<in-flight-id>/` (hygiene only; not warehouse freeze).

If a living SSOT is superseded, **edit the living file** and freeze the **dated revision record**, never the living basename.

## Rehydrate rule

1. Session / compaction rehydrate = **Hot + warm index only** (AGENTS BLUF, PROJECT_STATUS header ~60–80 lines, worker-backlog snapshot, living agent-ops SSOT as needed).
2. **`docs/_archive/**` is out of normal rehydrate** — never open unless the task is explicitly **archivist**, historical audit, or successor-pointer verification.
3. Dated stubs under `docs/agent-ops/YYYY-MM-DD-*.md` are pointers only — follow **Successor SSOT**, do not treat stub body as law.
4. Cold content is **historical-synthesis** in the doc authority registry (`pnpm docs:authority`).
5. **Archivist** role (`agents/coordinator/archivist/`): read-only retrieval from warehouse + catalogs; **never** rewrites hot SSOT / living agent-ops law.

## Freeze process

```bash
# Sets: agent-ops | cruft | all
pnpm docs:archive -- plan --set cruft
pnpm docs:archive -- freeze --set cruft --batch cruft-audit-2026-08-02
pnpm docs:archive -- freeze --set agent-ops --batch context-opt-2026-08-02
pnpm docs:archive -- wiki          # rebuild multi-file topic index
pnpm docs:archive -- status
pnpm docs:authority
pnpm openclaw:checkpoint:archive -- --keep 14
```

| `--set` | What freezes |
|---------|----------------|
| `agent-ops` | Dated `docs/agent-ops/YYYY-MM-DD-*.md` (stubs remain) |
| `cruft` | Root historical ledgers + openclinxr archive-candidates + completed iterations (catalog in CLI) |
| `all` | Union |

### Freeze batches (executed)

| batchId | Status | Warehouse | Wiki topics |
|---------|--------|-----------|-------------|
| `context-opt-2026-08-02` | **FROZEN** | `docs/_archive/agent-ops/2026-08/` | agent-ops-revisions |
| `cruft-audit-2026-08-02` | **FROZEN** | coordination / openclinxr / iterations areas | coordination-ledgers, openclinxr-product-docs, agent-factory-iterations |

Successors (examples):

| Dated / cold record | Successor SSOT |
|---------------------|----------------|
| `2026-08-02-path-scope-policy-v1.md` | `docs/agent-ops/PATH-SCOPE.md` |
| `2026-08-02-context-opt-*.md` | `PATH-SCOPE.md` (+ `COMPOSITION-ROOTS.md` / `WORKTREE-PROMOTE.md` when wave-c/worktree) |
| `2026-08-02-ceo-bod-voice-revision.md` | `docs/agent-ops/CEO-VOICE.md` |
| `AUTONOMOUS_WORK_PLAN.md` / `PROJECT_COORDINATION_INDEX.md` | `PROJECT_STATUS.md` |
| `iterations/iteration-0009/*` | `docs/agent-factory/operating-loop.md` |

## Manifest schema

Each freeze batch writes `docs/_archive/agent-ops/<YYYY-MM>/ARCHIVE-MANIFEST.json`:

```json
{
  "schemaVersion": "openclinxr.docs-archive-manifest.v1",
  "batchId": "context-opt-2026-08-02",
  "archivedAt": "2026-08-02T00:00:00.000Z",
  "warehouseDir": "docs/_archive/agent-ops/2026-08",
  "dryRun": false,
  "files": [
    {
      "source": "docs/agent-ops/2026-08-02-path-scope-policy-v1.md",
      "basename": "2026-08-02-path-scope-policy-v1.md",
      "warehouse": "docs/_archive/agent-ops/2026-08/2026-08-02-path-scope-policy-v1.md",
      "successor": "docs/agent-ops/PATH-SCOPE.md",
      "reason": "dated revision freeze; living SSOT supersedes"
    }
  ]
}
```

Stubs left at `source` are 5–10 lines: archived status, warehouse path, successor SSOT, batch id, pointers to this doc + `REVISION-INDEX.md`. Prefer `git mv` into warehouse when git is available.

## Authority classification (machine)

`tools/agent-factory/build-doc-authority-registry.ts`:

- Living agent-ops SSOT + `docs/TOOLING.md` → `current-reference` (high weight for core SSOT basenames).
- Dated `docs/agent-ops/YYYY-MM-DD-*` → `historical-synthesis`.
- `docs/_archive/**` → `historical-synthesis` (warehouse cold).
- `.grok/prompts/agentic-io-contract.md` → `current-reference` / agent-methodology weight.

## Related

- `docs/agent-ops/DOC-HYGIENE-CADENCE.md` — **when** to freeze/archive (periodic; never per-task)
- `docs/agent-ops/REVISION-INDEX.md` — batch table (warm)
- `docs/agent-ops/PATH-SCOPE.md` §docs-warehouse-v1 — archivist path-scope + rehydrate exclusion
- `docs/agent-ops/CEO-VOICE.md`, `COMPOSITION-ROOTS.md`, `WORKTREE-PROMOTE.md`
- `docs/agent-ops/REVIEW-CADENCE.md` — roster monthly (+ hygiene row → DOC-HYGIENE-CADENCE)
- `agents/coordinator/archivist/` — dual-stack cold retrieval role
- `pnpm openclaw:checkpoint:archive` — PROJECT_STATUS cold tail
- `docs/openclinxr/doc-authority-registry-2026-05-27.md` — generated authority
- `docs/_archive/agent-ops/2026-08/2026-08-02-docs-warehouse-v1.md` — frozen slice revision record (stub at hot path)
