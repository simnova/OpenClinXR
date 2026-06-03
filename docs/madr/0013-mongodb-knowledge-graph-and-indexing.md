# MADR 0013: Store Scenario Knowledge Graph And Indexes Alongside MongoDB Documents

Status: Accepted for planning
Date: 2026-05-03

## Context

Agents and runtime services need efficient access to scenario meaning: skills tested, actors involved, environments, sources, rubrics, trace requirements, and review findings.

## Decision

Use MongoDB/Cosmos-compatible document collections for operational state, with `knowledge_nodes` and `knowledge_edges` collections for graph-like relationships. Add vector references for source summaries, actor memories, scenario descriptions, and rubric criteria as maturity increases.

## Consequences

Positive:

- Keeps operational and graph data in a familiar document-store model.
- Supports coverage queries and scenario assembly.
- Supports LLM retrieval packs.

Negative:

- Graph traversal may outgrow document-query patterns.
- Vector index choice remains open.

## Reversal Trigger

Revisit if graph traversal performance or query complexity becomes a blocking issue.

