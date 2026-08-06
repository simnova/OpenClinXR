# Task cost rollup (subagent + model → total)

**Owner:** pmo (cadence / catalog) · **Harness implementers:** openclaw-drift-police / IPL  
**Primary signal:** Grok native subagent child sessions  
**CLI:** `pnpm openclaw:slice-token:finish` (alias `pnpm grok:tier:post-slice`)  
**Artifacts:** local gitignored `.openclinxr/openclaw/` rollups (`task-cost-latest.json` + markdown companion)  
**Rates:** `packages/openclinxr/agent-loop/src/model-pricing.ts`

## Goal

On **every slice/task completion**, produce:

1. **Per-subagent** token usage + **estimated USD** (with model)  
2. **Rollup by model**  
3. **Parent/main Δ peak** estimate  
4. **Grand total (est.)**  
5. One-line **`Cost line:`** for `PROJECT_STATUS` / post-slice ledgers  

## How to run

```bash
# At slice start (captures baseline time + token peaks)
pnpm openclaw:slice-token:start -- --slice-id <slice-id> --current-tier tier3_deepseek_pro_execute

# …spawn subagents, do work…

# At slice end
pnpm openclaw:slice-token:finish
# or: pnpm grok:tier:post-slice
```

### Outputs

| Path | Content |
|------|---------|
| local `.openclinxr/openclaw/task-cost-latest.json` (gitignored) | Machine rollup (`openclinxr.task-cost-rollup.v1`) |
| local task-cost markdown companion (gitignored) | Markdown tables for humans |
| local grok-subagent-tokens-latest.json (gitignored) | Raw subagent token probes |
| `.openclinxr/openclaw/grok-tier-slice-token-latest.json` | Token thrash/posture report |
| Ledger lines | `Token introspection: …` **and** `Task cost: $X est; subagents=…; models=…` |

Paste **both** lines into the per-slice `PROJECT_STATUS.md` checkpoint when recording the slice.

## Estimate method (read this)

| Fact | Implication |
|------|-------------|
| Grok gives **context / peak totals**, not exact billed input+output | We use **blended $/1M tokens** |
| Window = subagents with `completed_at` (or `started_at`) in `[baseline.capturedAt, finish]` | Start ritual required for accurate per-task scope |
| Parent line uses **workspace peak Δ** since baseline | Rough attribution of main-session growth |
| ccusage | Optional **Codex/cross-harness** only — not per-subagent |

**Disclaimer on every rollup:** estimate only — not a provider invoice.

## Pricing table

Living rates: `MODEL_PRICE_ROWS` in `model-pricing.ts` (`openclinxr.model-pricing.v1`).

| Model (match) | Blended $/1M (est.) | Role |
|---------------|---------------------|------|
| deepseek-v4-flash | 0.20 | Scouts |
| deepseek-v4-pro | 1.80 | Bounded writers |
| grok-4.5 / composer | 6.00 | Parent + some GP |
| grok-build | 10.00 | Frontier rare |
| unknown | 4.00 | Fallback |

Update rates when providers change; keep **weekly temporal review** on Grok/DeepSeek token items (`pnpm temporal:review`).

## Architecture

```
slice-token:start  → baseline (time + peaks)
       ↓
  spawn_subagent(s)  → child sessions write signals.json / updates.jsonl
       ↓
slice-token:finish
  → parseGrokSubagentCompletions()
  → filter by baseline.capturedAt
  → buildTaskCostRollup()  [by subagent, by model, grand total]
  → write task-cost-latest.{json,md}
  → print Cost line
```

## Example Cost line

```text
Task cost: $1.24 est; subagents=4; subTokens=412000; subUsd=$0.89; parentTokens=50000; parentUsd=$0.30; models=deepseek-v4-pro:$0.54|deepseek-v4-flash:$0.20|grok-4.5:$0.50
```

## Related

- Token thrash / tier: `agents/rules/grok-harness-usage.md`, `grok-token-introspection.ts`  
- Temporal revisit: `TEMPORAL-DECISIONS.md` (`grok-subagent-token-emit`, `ccusage-grok-token-workaround`)  
- Subagent parse: `tools/openclinxr/openclaw/grok-token-io.ts`
