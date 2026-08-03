# Delegation scorecard (measured, 2026-08-03)

Self-optimizing multi-provider delegation. Every routing decision is backed by a measured
cost/quality ledger row — no priors survive contact with data.

## Measured spend (delegated workers)

| model | $ | calls |
|---|---|---|
| deepseek-v4-flash | $0.000 | 1 |
| deepseek-v4-pro | $0.041 | 2 |
| grok-4.5 | $0.932 | 4 |
| **total** | **$0.97** | |

> Manager (Claude) cost is NOT in this total — ccusage did not capture this harness; it is the larger unmeasured line.

## Router picks (highest measured value per class)

| class | model | value | $/task | n |
|---|---|---|---|---|
| mechanical-wiring | deepseek-v4-pro | 50.61 | $0.020 | 1 |
| bounded-impl | claude-opus | 8000.0 | $0.000 | 2 |
| frontend-surface | grok-4.5 | 0.31 | $0.249 | 2 |
| visual-quality-judgment | grok-4.5 | 2.42 | $0.413 | 1 |

## Assumptions overturned by data (the loop learns)

- 'Claude cannot drive DeepSeek' -> false
- 'Grok 4.5 has no/weak vision' -> false (accurate, cost ~$0.25/judgment)
- '--yolo bounded worker stays in scope' -> false: overreached into doc-maintenance; read-only-propose is safer at equal cost
- 'multi-level auto-happens' -> false: grok-4.5 built solo; AND 'deterministic gate is trustworthy alone' -> false: it false-negatived, visual/manager check was the backstop
- '--rules stops the doc-overreach' -> false: repo SessionStart hook overrides prompt rules; containment still required

notEvidenceFor: clinical validity / production readiness. Estimates, re-verified weekly.
