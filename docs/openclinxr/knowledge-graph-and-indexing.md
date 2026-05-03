# Knowledge Graph And Indexing Model

Date: 2026-05-03
Status: Development-readiness draft

## Goal

The system needs a knowledge layer that lets agents, scenario generators, reviewers, and runtime actor cells understand what each exam station is testing and why. The knowledge graph should connect blueprints, scenarios, actors, environments, rubrics, trace events, sources, review findings, and psychometric facets.

## Graph Node Types

- `Source`
- `Claim`
- `ExamBlueprint`
- `ExamForm`
- `Station`
- `Environment`
- `Actor`
- `ClinicalTruth`
- `Rubric`
- `RubricCriterion`
- `TraceEventType`
- `EPA`
- `AMADayOneSkill`
- `Specialty`
- `Risk`
- `ReviewFinding`
- `ModelPolicy`
- `PromptTemplate`
- `Memory`

## Graph Edge Types

- `SUPPORTS_CLAIM`
- `DERIVED_FROM`
- `COVERS_SKILL`
- `COVERS_EPA`
- `USES_ENVIRONMENT`
- `HAS_ACTOR`
- `HAS_RUBRIC`
- `REQUIRES_TRACE_EVENT`
- `HAS_RISK`
- `BLOCKED_BY`
- `APPROVED_BY`
- `USES_MODEL_POLICY`
- `RETRIEVES_MEMORY`
- `SUPERSEDES`

## Storage Strategy

Maturity 1:

- Store graph edges in MongoDB collections and JSON indexes.
- Use keyword indexes for source IDs, skill tags, specialty, and trace tags.

Maturity 2:

- Add embeddings for scenario descriptions, actor cards, rubric criteria, source summaries, and memory entries.
- Store vector references in MongoDB or a dedicated vector index.

Maturity 3:

- Add graph traversal API for coverage checks, contradiction detection, and scenario assembly.

## Suggested Collections

### `knowledge_nodes`

```json
{
  "_id": "ObjectId",
  "node_id": "skill_urgent_care_recognition",
  "node_type": "AMADayOneSkill",
  "label": "Recognize urgent or emergent care and initiate evaluation and management",
  "summary": "Day-one residency skill target.",
  "source_ids": ["src-ama-day-one-skills-2026"],
  "embedding_ref": "vector://knowledge/node/skill_urgent_care_recognition",
  "status": "active"
}
```

### `knowledge_edges`

```json
{
  "_id": "ObjectId",
  "edge_id": "edge_station_ed_chest_pain_covers_urgent_care",
  "from_node_id": "station_ed_chest_pain_priority_v1",
  "to_node_id": "skill_urgent_care_recognition",
  "edge_type": "COVERS_SKILL",
  "confidence": 0.88,
  "source_ids": ["src-ama-day-one-skills-2026"],
  "status": "active"
}
```

## Retrieval Packs

Before an LLM generates or reviews a station, the system should assemble a retrieval pack:

- Blueprint constraints.
- Related prior stations.
- Required skills and EPAs.
- Specialty safety notes.
- Environment affordances.
- Actor cards.
- Relevant source records.
- Prior review findings.
- Prohibited claims.
- Rubric patterns.

## Runtime Actor Memory Retrieval

Actor response generation should retrieve:

- Static actor card.
- Hidden clinical truth permitted for that actor.
- Recent learner utterances/actions.
- Important prior disclosures.
- Emotion and pain state.
- Environment state.
- Safety guardrails.

Ranking formula:

```text
retrieval_score =
  0.45 * semantic_relevance +
  0.25 * importance +
  0.20 * recency +
  0.10 * station_phase_match
```

## Coverage Queries

Examples:

- Which approved stations cover urgent-care recognition?
- Which exam forms include oral-summary scoring?
- Which scenarios have unverified external claims?
- Which stations use a nurse actor and an ED bay environment?
- Which rubric criteria have no trace event evidence?
- Which LLM policies were active for a station run?

## Agent Factory Integration

Agent memory and OpenClinXR scenario knowledge should remain separate but linkable.

- Agent Factory memory answers: What have the design agents learned?
- OpenClinXR knowledge graph answers: What does the exam system know about scenarios, actors, rubrics, traces, and evidence?

