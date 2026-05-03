# MongoDB Data Model

Date: 2026-05-03
Status: Development-readiness draft

## Design Goals

- Store exam blueprints, scenario bank entries, exam forms, station runs, actor memories, traces, reviews, and scoring artifacts.
- Preserve versioned scenario and model provenance.
- Support efficient station runtime reads.
- Support replay, faculty review, source audit, and psychometric export.
- Separate authored truth from learner-visible state.

## Collections

### `exam_blueprints`

```json
{
  "_id": "ObjectId",
  "blueprint_id": "ume_cs_blueprint_v1",
  "version": 1,
  "purpose": "formative-practice",
  "station_count": 8,
  "station_duration_seconds": 900,
  "note_duration_seconds": 600,
  "break_schedule": [
    { "after_station_order": 3, "duration_seconds": 600 },
    { "after_station_order": 6, "duration_seconds": 1800 },
    { "after_station_order": 9, "duration_seconds": 600 }
  ],
  "target_domains": ["history_physical", "oral_summary", "documentation", "teamwork", "urgent_care", "organizing_work"],
  "specialty_distribution": {
    "emergency_medicine": 2,
    "internal_medicine": 2,
    "pediatrics": 1,
    "psychiatry": 1,
    "obgyn": 1,
    "surgery": 1
  },
  "environment_requirements": ["ed_bay", "inpatient_ward", "clinic_room", "telehealth"],
  "psychometric_targets": {
    "min_cases_per_domain": 2,
    "rater_sampling_rate": 0.25,
    "required_trace_completeness": 0.95
  },
  "status": "draft",
  "created_by": "user_id",
  "created_at": "ISODate",
  "updated_at": "ISODate"
}
```

Indexes:

- Unique: `{ "blueprint_id": 1, "version": 1 }`
- Query: `{ "status": 1, "purpose": 1 }`

### `scenario_bank`

```json
{
  "_id": "ObjectId",
  "scenario_id": "ed_chest_pain_priority_v1",
  "version": 1,
  "title": "ED Chest Pain With Nurse Interruption And Family Pressure",
  "status": "clinical-review",
  "specialty": ["emergency_medicine", "internal_medicine", "cardiology"],
  "environment_id": "ed_bay_v1",
  "duration_seconds": 900,
  "note_duration_seconds": 600,
  "source_ids": ["src-usmle-2020-bulletin-step2cs", "src-ama-day-one-skills-2026"],
  "learning_targets": [
    "gather_history_physical",
    "urgent_care_recognition",
    "oral_summary",
    "documentation",
    "team_participation",
    "organizing_work"
  ],
  "hidden_clinical_truth": {
    "primary_problem": "acute coronary syndrome risk evaluation",
    "must_not_miss": ["STEMI", "aortic_dissection", "pulmonary_embolism"],
    "red_flags": ["diaphoresis", "radiating_pain", "hypotension"],
    "safe_actions": ["obtain_vitals", "focused_history", "focused_exam", "ECG_request", "escalate_to_senior"]
  },
  "doorway_instructions": "You are called to evaluate a patient with chest pain in a busy emergency department.",
  "actor_ids": ["patient_chest_pain_v1", "nurse_ed_v1", "wife_anxious_v1"],
  "rubric_id": "rubric_ed_chest_pain_v1",
  "trace_requirements": ["history_question", "physical_exam_action", "urgent_escalation", "team_communication", "patient_note"],
  "llm_policy_id": "llm_actor_policy_v1",
  "review": {
    "clinical_status": "pending",
    "psychometric_status": "pending",
    "legal_status": "pending",
    "simulation_qa_status": "pending"
  },
  "created_at": "ISODate",
  "updated_at": "ISODate"
}
```

Indexes:

- Unique: `{ "scenario_id": 1, "version": 1 }`
- Query: `{ "status": 1, "specialty": 1 }`
- Query: `{ "learning_targets": 1 }`

### `actor_cards`

```json
{
  "_id": "ObjectId",
  "actor_id": "patient_chest_pain_v1",
  "version": 1,
  "actor_type": "patient",
  "display_name": "Mr. Robert Hayes",
  "demographics": {
    "age": 54,
    "gender": "male",
    "language": "en-US"
  },
  "role_goal": "Seek help for frightening chest pain while revealing details naturally when asked.",
  "knowledge_boundaries": [
    "Does not know medical diagnosis.",
    "Can describe symptoms, history, medications, fears, and family concerns."
  ],
  "disclosure_rules": [
    {
      "trigger": "asked_about_pain_radiation",
      "response_fact": "Pain radiates to left arm."
    }
  ],
  "emotion_model": {
    "baseline": { "anxiety": 0.7, "trust": 0.3, "pain": 0.8 },
    "modifiers": [
      { "event": "empathetic_acknowledgment", "delta": { "trust": 0.1, "anxiety": -0.05 } },
      { "event": "ignored_family_question", "delta": { "anxiety": 0.1, "trust": -0.05 } }
    ]
  },
  "voice_profile_id": "voice_middle_aged_male_anxious_v1",
  "avatar_profile_id": "avatar_patient_chest_pain_v1",
  "safety_guardrails": ["no_diagnosis_self_disclosure", "no_unprompted_hidden_truth"],
  "created_at": "ISODate"
}
```

Indexes:

- Unique: `{ "actor_id": 1, "version": 1 }`
- Query: `{ "actor_type": 1 }`

### `exam_forms`

```json
{
  "_id": "ObjectId",
  "exam_form_id": "ume_cs_form_a_v1",
  "blueprint_id": "ume_cs_blueprint_v1",
  "version": 1,
  "status": "draft",
  "stations": [
    {
      "order": 1,
      "scenario_id": "ed_chest_pain_priority_v1",
      "scenario_version": 1,
      "environment_id": "ed_bay_v1"
    }
  ],
  "review_status": {
    "clinical": "pending",
    "psychometric": "pending",
    "legal": "pending"
  },
  "randomization_policy": {
    "shuffle_allowed": false,
    "fixed_order_reason": "station sequence tests escalating time pressure"
  },
  "break_schedule": [
    { "after_station_order": 3, "duration_seconds": 600 },
    { "after_station_order": 6, "duration_seconds": 1800 },
    { "after_station_order": 9, "duration_seconds": 600 }
  ],
  "created_at": "ISODate"
}
```

Indexes:

- Unique: `{ "exam_form_id": 1, "version": 1 }`
- Query: `{ "status": 1, "blueprint_id": 1 }`

### `exam_sessions`

```json
{
  "_id": "ObjectId",
  "exam_session_id": "uuid",
  "exam_form_id": "ume_cs_form_a_v1",
  "learner_id": "learner_uuid",
  "tenant_id": "tenant_uuid",
  "status": "in_progress",
  "current_station_order": 2,
  "timing": {
    "started_at": "ISODate",
    "ended_at": null,
    "accommodation_policy_id": null
  },
  "station_runs": [
    {
      "station_run_id": "uuid",
      "scenario_id": "ed_chest_pain_priority_v1",
      "status": "completed",
      "encounter_started_at": "ISODate",
      "encounter_ended_at": "ISODate",
      "note_submitted_at": "ISODate"
    }
  ],
  "consent_state": {
    "record_for_debrief": true,
    "faculty_scoring": true,
    "research_export": false,
    "improvement_analytics": true
  },
  "created_at": "ISODate"
}
```

Indexes:

- Unique: `{ "exam_session_id": 1 }`
- Query: `{ "tenant_id": 1, "learner_id": 1, "created_at": -1 }`

### `station_runs`

```json
{
  "_id": "ObjectId",
  "station_run_id": "uuid",
  "exam_session_id": "uuid",
  "scenario_id": "ed_chest_pain_priority_v1",
  "scenario_version": 1,
  "status": "encounter",
  "phase": "encounter",
  "active_actor_states": {
    "patient_chest_pain_v1": {
      "emotion": { "anxiety": 0.65, "trust": 0.42, "pain": 0.78 },
      "last_disclosures": ["pain_started_45_minutes_ago"]
    }
  },
  "timer": {
    "encounter_remaining_seconds": 422,
    "note_remaining_seconds": 600
  },
  "trace_summary": {
    "required_events_observed": 12,
    "required_events_total": 22,
    "safety_critical_actions_observed": ["asked_radiation", "requested_ecg"]
  },
  "created_at": "ISODate",
  "updated_at": "ISODate"
}
```

Indexes:

- Unique: `{ "station_run_id": 1 }`
- Query: `{ "exam_session_id": 1, "scenario_id": 1 }`

### `trace_events`

```json
{
  "_id": "ObjectId",
  "trace_id": "uuid",
  "exam_session_id": "uuid",
  "station_run_id": "uuid",
  "tenant_id": "tenant_uuid",
  "timestamp": "ISODate",
  "event_type": "learner_speech",
  "actor_id": "learner_uuid",
  "target_actor_id": "patient_chest_pain_v1",
  "payload": {
    "transcript": "Can you describe the pain?",
    "intent": "pain_characterization",
    "confidence": 0.86
  },
  "rubric_tags": ["history_gathering", "chief_complaint"],
  "epa_tags": ["EPA1"],
  "ama_day_one_tags": ["history_physical"],
  "model_provenance": {
    "asr_model": "asr_model_version",
    "intent_model": "intent_model_version"
  },
  "privacy_class": "education_record",
  "created_at": "ISODate"
}
```

Indexes:

- Compound: `{ "station_run_id": 1, "timestamp": 1 }`
- Query: `{ "exam_session_id": 1 }`
- Query: `{ "rubric_tags": 1 }`
- Query: `{ "ama_day_one_tags": 1 }`

### `actor_memories`

```json
{
  "_id": "ObjectId",
  "memory_id": "uuid",
  "station_run_id": "uuid",
  "actor_id": "patient_chest_pain_v1",
  "memory_type": "observation",
  "text": "Learner asked about radiation and patient disclosed left arm radiation.",
  "importance": 0.82,
  "recency_timestamp": "ISODate",
  "embedding_ref": "vector://actor-memory/patient_chest_pain_v1/uuid",
  "source_trace_ids": ["trace_uuid"],
  "status": "active"
}
```

Indexes:

- Query: `{ "station_run_id": 1, "actor_id": 1, "status": 1 }`
- Vector index: memory text embeddings for retrieval.

### `llm_audit_events`

```json
{
  "_id": "ObjectId",
  "llm_event_id": "uuid",
  "station_run_id": "uuid",
  "actor_id": "patient_chest_pain_v1",
  "purpose": "actor_dialogue",
  "model": "frontier_model_name",
  "model_version": "version_or_snapshot",
  "prompt_policy_id": "llm_actor_policy_v1",
  "retrieved_memory_ids": ["uuid"],
  "input_hash": "sha256",
  "output_hash": "sha256",
  "safety_flags": [],
  "latency_ms": 612,
  "created_at": "ISODate"
}
```

Indexes:

- Query: `{ "station_run_id": 1, "actor_id": 1, "created_at": 1 }`
- Query: `{ "model": 1, "model_version": 1 }`

### `review_packets`

```json
{
  "_id": "ObjectId",
  "review_packet_id": "uuid",
  "target_type": "scenario",
  "target_id": "ed_chest_pain_priority_v1",
  "target_version": 1,
  "review_type": "psychometric",
  "assigned_to": ["psychometrician_user_id"],
  "status": "changes_requested",
  "findings": [
    {
      "severity": "high",
      "summary": "Rubric does not define oral summary scoring anchors.",
      "required_change": "Add behavioral anchors for oral summary."
    }
  ],
  "created_at": "ISODate",
  "updated_at": "ISODate"
}
```

Indexes:

- Query: `{ "target_type": 1, "target_id": 1, "status": 1 }`
- Query: `{ "assigned_to": 1, "status": 1 }`

## Data Boundaries

Hidden clinical truth must not be sent to the XR client. The Station Runtime should send only learner-visible actor and environment state. LLM prompts should receive only the minimum hidden truth needed for the actor role and should be audited.

## Repository And Mongoose Boundary

The implementation should support the development team's Mongoose familiarity without putting latency-sensitive replay paths behind unnecessary ODM overhead.

Use Mongoose first for admin and control-plane collections where schema validation, middleware, discriminators, and reviewer workflow ergonomics are valuable:

- `exam_blueprints`
- `scenario_bank`
- `actor_cards`
- `exam_forms`
- `review_packets`
- asset manifests and generation jobs
- source, claim, consent, and governance ledgers

Executable model ownership starts in `packages/data-sources-mongoose-models`. The first model is the scenario-bank control-plane schema with publication indexes and an explicit learner projection that redacts hidden clinical truth.

Keep thin MongoDB-driver repositories first for high-write or runtime-critical collections:

- `trace_events`
- station runtime snapshots
- actor memory retrieval snapshots
- model, voice, and ASR audit events
- OpenTelemetry-correlated latency samples

The recommended boundary is:

- Mongoose models validate admin writes and authored content before publication.
- Shared TypeScript schemas remain the cross-package contract for XR runtime, API responses, tests, and generated GraphQL types.
- Thin repositories own deterministic replay, idempotent upsert snapshots, and compound-index performance tests.
- `mongodb-memory-server` remains the default integration-test harness for both repository styles.
- Any Mongoose projection exposed to the learner must explicitly redact hidden clinical truth and reviewer-only fields.
- Runtime traces should store OpenTelemetry trace/span correlation IDs only as low-cardinality audit references, not raw prompts, transcripts, or patient-note text in span attributes.

## Psychometric Export

Psychometric exports should be generated from:

- `exam_forms`
- `scenario_bank`
- `exam_sessions`
- `station_runs`
- `trace_events`
- `review_packets`
- `faculty_scores`

Exports should include scenario version, rubric version, rater version, device/runtime version, and model policy version as facets.
