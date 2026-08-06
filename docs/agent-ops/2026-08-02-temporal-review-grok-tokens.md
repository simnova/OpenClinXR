# Temporal review — Grok token accounting (2026-08-02)

**Items:** `grok-subagent-token-emit`, `ccusage-grok-token-workaround`  
**Cadence:** weekly (7d)  
**Analyst:** orchestrator (PMO catalog) + harness implementation  
**Verdict:**

| Item | Verdict | Next review |
|------|---------|-------------|
| `grok-subagent-token-emit` | **REPLACE** primary path | 2026-08-09 |
| `ccusage-grok-token-workaround` | **KEEP** as secondary only | 2026-08-09 |

## Findings

1. **Grok already emits tokens** on session updates (`params._meta.totalTokens` in `updates.jsonl`).
2. **`signals.json`** provides structured `contextTokensUsed`, `modelsUsed`, `primaryModelId`, tool/turn counts.
3. **Subagent meta.json** still has no `totalTokens` field, but **child sessions** do — under worktree session dirs (`sessions/<encoded worktree path>/<childId>/`).
4. Live probe: **31/31** recent subagents resolved with peaks (e.g. explore flash ~89k, GP pro ~56–104k).
5. Prior dual-path weakness: we only scanned workspace parent sessions, **not** child subagent sessions.

## Code change

- `parseGrokSubagentCompletions()` in `tools/openclinxr/openclaw/grok-token-io.ts`
- Prefer `signals.json` + updates peaks on parent sessions
- Wire into slice baseline + post-slice report (`subagents=N subPeak=…` on stateRecordLine)
- Classify `grok-4.5` as composer-class for thrash detection

## Operating posture

- **Primary:** Grok native (parent + subagent child peaks)
- **Secondary:** ccusage daily (Codex/cross-harness only; OK if zero on Grok-only days)
- **Do not retire ccusage yet** until weekly review confirms no needed Codex cross-check

## Residual

- Prefer Grok to put `totalTokens` on `subagents/*/meta.json` at completion (upstream ask) — still useful if child session path layout changes
- Revisit weekly
