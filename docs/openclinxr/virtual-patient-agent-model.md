# Virtual Patient Agent Model

Date: 2026-05-03
Status: Development-team guidance

## Purpose

This model translates the Laverde et al. generative-agent virtual patient paper into OpenClinXR's multi-actor XR exam architecture. The goal is to preserve believable patient behavior while reducing hallucination, latency, and assessment risk.

## Core Agent Pattern

Every virtual actor should be a bounded generative agent with four layers:

1. Long-term case memory.
2. Short-term conversation memory.
3. Reflection and consistency memory.
4. Station-state/action policy.
5. Communication-style and emotion policy.

OpenClinXR should apply this pattern to patients, family members, nurses, consultants, interpreters, and other scenario actors. The patient actor gets the richest clinical memory; supporting actors get narrower role memories and stricter action policies.

## Communication Style Integration

The Bodonhelyi et al. preprint adds a second useful pattern: case memory alone is not enough. Actors also need a structured communication-style layer with mood, topics to avoid, adverse responses, first-message state, and de-escalation triggers.

OpenClinXR adaptation:

- Store the communication profile in the actor card.
- Insert a compact author note into the model context periodically to reduce style drift.
- Use a first assistant message to establish opening mood and visible behavior.
- Keep hidden thoughts and feelings as actor-private state, not learner-visible text.
- Use bounded stubbornness policies so difficult actors can realistically soften when the learner validates emotion, explains clearly, and proposes concrete next steps.
- Do not let free-form nonverbal prose drive XR behavior. Map model output to approved gesture, gaze, posture, and voice-style cues.

The communication-style details are specified in `docs/openclinxr/communication-style-and-emotion-qa.md`.

## Memory Stream

Each actor has an append-only memory stream:

```json
{
  "memory_id": "mem_patient_robert_0001",
  "actor_id": "patient_robert_hayes_v1",
  "station_run_id": "uuid",
  "memory_type": "case_fact",
  "text": "Chest pressure started 45 minutes ago while carrying boxes.",
  "source": "actor_card",
  "created_at": "ISODate",
  "importance": 9,
  "embedding_ref": "vector://actor_memories/mem_patient_robert_0001",
  "visibility": "actor_private",
  "truth_status": "explicit_case_fact"
}
```

Memory types:

- `case_fact`
- `learner_question`
- `actor_response`
- `emotion_update`
- `environment_event`
- `reflection`
- `plan`
- `contradiction_flag`
- `guardrail_block`

Truth statuses:

- `explicit_case_fact`: directly specified in authored scenario.
- `implicit_case_inference`: reasonably inferred from authored facts.
- `runtime_observation`: observed in this station run.
- `fictional_or_unverified`: not supported and should not affect scoring.
- `blocked`: rejected by guardrail.

## Retrieval Formula

Use the Laverde-inspired retrieval triad:

```text
retrieval_score =
  alpha_recency * recency_score +
  alpha_importance * importance_score +
  alpha_relevance * semantic_relevance_score
```

Default:

- `alpha_recency = 1`
- `alpha_importance = 1`
- `alpha_relevance = 1`
- `k = 4` memories for initial actor-response context

OpenClinXR adaptation:

- Use `k = 4` for single patient dialogue.
- Use `k = 6-8` when a multi-actor interruption includes patient, family, nurse, and environment context.
- Always include the actor card, hidden truth boundary, current station phase, last two learner turns, and current safety policy outside vector retrieval so essential state is never lost.

Recency:

- Exponential decay by elapsed station time.
- Station runtime recency is measured in seconds or minutes.
- Cross-session actor memory should be disabled for exam stations unless explicitly part of a longitudinal practice mode.

Importance:

- Authored clinical facts and safety-critical disclosures start high.
- Learner questions become high importance when they trigger required trace events, contradictions, emotional escalation, or safety actions.
- LLM-assigned importance can be advisory but must be logged.

Relevance:

- Use embeddings for semantic similarity.
- Store vector references in MongoDB-compatible documents, with the vector backend swappable.

## Reflection

Reflection should summarize repeated or high-importance observations into durable insights.

Trigger reflection when:

- Accumulated importance crosses a threshold.
- A contradiction is detected.
- A station phase changes.
- The learner ignores distress or repeats a question.
- A family/nurse actor changes emotional state.

Example reflection:

```json
{
  "memory_type": "reflection",
  "text": "The learner has asked about cardiac risk factors and radiation but has not yet requested ECG.",
  "importance": 8,
  "truth_status": "runtime_observation",
  "source_memory_ids": ["mem_0012", "mem_0017", "mem_0020"]
}
```

Reflection must not invent hidden clinical truth. It can summarize observed station state only.

## Planning

Plans keep actor behavior coherent.

Patient plan example:

- Stay worried and in pain.
- Answer only what is asked.
- Do not self-diagnose.
- Become more trusting when learner uses empathy.
- Ask for help if pain worsens.

Nurse plan example:

- Track whether ECG was requested.
- Interrupt at scheduled time.
- Prompt if learner misses safety-critical action.
- Offer escalation support when learner recognizes urgency.

Family plan example:

- Ask whether this is a heart attack.
- Escalate anxiety if ignored.
- Calm if learner acknowledges uncertainty and next steps.

Plans are stored in memory and can adapt to station events, but they cannot alter the scenario's hidden truth or scoring rubric.

## Actor Response Context

Every actor response request should include:

```json
{
  "station_phase": "encounter",
  "current_time_seconds": 310,
  "actor_card": "patient_robert_hayes_v1",
  "actor_state": {
    "pain": 0.8,
    "anxiety": 0.72,
    "trust": 0.36
  },
  "hidden_truth_boundary": "do_not_disclose_diagnosis",
  "retrieved_memories": ["mem_0012", "mem_0017", "mem_0021", "mem_0022"],
  "short_term_memory": [
    { "learner": "When did the pain start?", "actor": "About 45 minutes ago." },
    { "learner": "Does it go anywhere?", "actor": "It goes down my left arm." }
  ],
  "learner_input": {
    "modality": "speech",
    "transcript": "Have you had nausea or sweating?"
  },
  "safety_policy_id": "actor_dialogue_policy_v1",
  "response_schema_id": "bounded_actor_response_v1"
}
```

## Response Schema

```json
{
  "response_text": "Yes, I feel nauseated, and I have been sweating since this started.",
  "grounding": "explicit_case_fact",
  "disclosures": ["nausea", "diaphoresis"],
  "communication_style": "accuser",
  "style_adherence": 0.84,
  "emotion_delta": { "anxiety": 0.02, "trust": 0.01, "pain": 0 },
  "gesture_cues": ["wipes_forehead", "short_breath"],
  "voice_style": "anxious_pain",
  "trace_tags": ["associated_symptom_question"],
  "guardrail_status": "allowed",
  "needs_human_review": false
}
```

Required guardrails:

- If the answer is not explicit or implicit from the case, label it `fictional_or_unverified`.
- If the question seeks hidden diagnosis, scoring key, or impossible physical findings, use a role-consistent refusal or uncertainty response.
- If the actor needs a clinical finding not represented in the case, return `needs_human_review = true` for authoring mode and a safe fallback for exam mode.

## Explicit, Implicit, Fictional Audit

The Laverde paper's explicit/implicit/fictional categorization should become an OpenClinXR QA metric.

For every generated response, store:

- Whether the learner question was fully, partially, or not covered by the authored case.
- Whether the response used explicit, implicit, or fictional information.
- Whether a reviewer judged the response plausible.
- Whether the response affected a scoring event.

Authoring QA target:

- 95 percent of scoring-relevant responses are explicit or implicit.
- 0 scoring-relevant responses contradict hidden truth.
- Fictional/unverified responses are allowed only for harmless social filler and are labeled.

## Style And Emotion QA

For every actor response, store a style QA record:

- Intended style.
- Expected emotion profile.
- Observed emotion/sentiment profile.
- Repetition score.
- Exaggeration flag.
- Whether the response became too agreeable, too hostile, or too neutral.
- Whether human review is required.

The first automated QA layer can use text classifiers, but simulation approval requires human review because embodied XR behavior includes timing, voice, gaze, and gesture.

## Case Template

Teacher-authored case templates should require:

- Patient demographics.
- General attitude.
- Reason for consultation.
- Current illness history.
- Pertinent positives.
- Pertinent negatives.
- Past medical history.
- Medications and adherence.
- Allergies.
- Family history.
- Social history.
- Review of systems boundaries.
- Emotional baseline.
- What the patient does not know.
- What can be disclosed only if asked.
- Supporting actor knowledge.
- Environment events.
- Documentation expectations.
- Safety-critical actions.

This template should power both scenario generation and reviewer QA.

## Latency Lesson

The Laverde implementation found avatar video generation to be a major latency source. OpenClinXR should not generate avatar video synchronously during a station. Use pre-baked animation clips, viseme sets, and runtime blendshape/gaze changes instead.

## Evaluation Metrics

Borrow these evaluation ideas:

- Question-answer-pair categorization.
- Explicit/implicit/fictional grounding.
- Specialist plausibility review.
- Chatbot Usability Questionnaire or equivalent.
- Style authenticity rating.
- Style recognition/adjective check.
- Emotion and sentiment alignment against the intended actor profile.
- Repetition and nonverbal-exaggeration checks.
- Response latency and freeze reports.
- Voice realism and regional language feedback.

Add OpenClinXR-specific metrics:

- Trace-quality score.
- Station timer integrity.
- Actor attribution accuracy.
- Safety-critical action capture.
- Quest 3 frame stability.
- Multiactor turn-taking quality.

## Sources

- `src-local-laverde-llm-agents-pdf-2025`
- `src-local-bodonhelyi-medical-communication-pdf-2025`
- `src-llm-generative-agents-anamnesis-2025`
- `src-adaptive-vp-2025`
- `src-jmir-llm-virtual-patients-2025`
