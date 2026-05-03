# Agent Factory Maturity Model

The Agent Factory grows in controlled stages. Each maturity level must make the design process more repeatable, auditable, and useful.

## Maturity 1: Codex-Operable

The factory runs through markdown, JSON, and manual Codex execution.

Required capabilities:

- Agent charters.
- Per-agent memory.
- Agent index files.
- Iteration packets.
- Rubric scorecards.
- Source, decision, and risk ledgers.

Exit criteria:

- Every active agent has a charter and index.
- Iteration 1 can run from brief to leadership review.
- Score deltas can be calculated.

## Maturity 2: Semi-Automated

TypeScript scripts validate, index, score, and summarize the factory.

Required capabilities:

- JSON schema validation.
- Memory index generation.
- Score aggregation.
- Iteration comparison.
- Source-ledger checks.
- Machine-readable evidence-debt and stale-risk reports.

Exit criteria:

- `pnpm agent:verify` exits 0.
- `.agent-factory/memory-index.json` is generated.
- `.agent-factory/evidence-debt-report.json` is generated.
- Leadership packets can be generated from iteration folders.

## Maturity 3: Orchestrated

A runtime coordinates agent work, retrieval, task sequencing, and review gates.

Required capabilities:

- Agent task queue.
- Agent run records.
- Tool permission profiles.
- Retrieval before generation.
- Automated escalation to leadership.

Exit criteria:

- The Coordinator can start an iteration from a brief.
- Each agent receives relevant memory.
- The system detects unresolved blocking risks.

## Maturity 4: Self-Improving Governance

The factory proposes its own improvements based on score trends and unresolved risk.

Required capabilities:

- Capability proposals.
- Rubric-weight change proposals.
- New-agent proposals.
- Tool and skill proposals.
- Senior Leadership approval for major changes.

Exit criteria:

- Capability upgrades are linked to measurable score problems.
- Repeated risks trigger specialist activation or scope reduction.
- Low-value agents can be merged, retired, or demoted.
