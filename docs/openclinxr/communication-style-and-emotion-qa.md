# Communication Style And Emotion QA

Date: 2026-05-03
Status: Development-team guidance

## Purpose

OpenClinXR should test more than clinical fact gathering. It should also test how examinees adapt to difficult interpersonal dynamics under time pressure. The Bodonhelyi et al. preprint gives a useful design pattern: communication style is an explicit scenario layer, not an incidental tone produced by the model.

This document translates that pattern into the multi-actor XR station architecture.

## Communication Style Layer

Each actor card should include a communication profile:

```json
{
  "communication_profile": {
    "style_family": "satir",
    "style": "accuser",
    "intensity": 0.65,
    "baseline_mood": ["frustrated", "wary", "vulnerable"],
    "communicativeness": "Open about physical symptoms; guarded and defensive about emotional stress.",
    "topics_to_avoid": ["psychological explanation", "lifestyle blame", "dismissal of pain"],
    "adverse_response": "Raises voice slightly and redirects toward physical pain when feeling dismissed.",
    "deescalation_triggers": ["emotion_acknowledged", "symptom_burden_validated", "clear_next_step"],
    "escalation_triggers": ["ignored_emotion", "premature_reassurance", "blame_language", "repeated_question"],
    "cultural_language_notes": ["plain English", "avoid caricature", "preserve respect"]
  }
}
```

Supported first-wave communication styles:

| Style | Training use | Behavior boundaries |
| --- | --- | --- |
| Congruent | Baseline cooperative patient | Clear, emotionally proportional, direct |
| Accuser | De-escalation, validation, maintaining professionalism | Frustrated and blaming without abusive or unsafe behavior |
| Rationalizer | Overly factual, resistant to emotion, demands evidence | Detailed and detached without becoming robotic |
| Appeaser | Hidden disagreement, acquiescence, teach-back | Agreeable but uncertain, not deceptive |
| Distractor | Redirects, tangential answers, poor focus | Avoids without derailing the station entirely |
| Withdrawn/guarded | Trauma-informed interviewing and privacy | Sparse answers that improve with trust |
| Angry family member | Family-centered communication and safety | Pressure without threats |

The Satir categories should be treated as authoring scaffolds, not rigid psychological labels. The scenario author must add clinical context, social context, culture/language notes, and safety boundaries.

## Prompt Scaffold

Actor prompt assembly should use four layers:

1. Stable system role with case boundaries and scoring-protection rules.
2. Author note containing the complete actor card and communication profile.
3. First assistant message that sets mood, posture, and opening line.
4. Runtime memory pack with current station phase, retrieved memories, state variables, and last two learner turns.

Author notes should refresh periodically in the model context. A practical starting point is to reinsert the compact actor profile roughly every six dialogue turns, while keeping token limits and provider behavior under test.

First-message pattern:

```json
{
  "role": "assistant",
  "content": {
    "visible_text": "I just need someone to finally tell me why this pain keeps getting worse.",
    "hidden_actor_state": {
      "thought": "I am afraid they will say it is all in my head.",
      "emotion": "frustrated_pain",
      "trust": 0.25
    },
    "gesture_cues": ["guarded_posture", "brief_eye_contact", "pain_shift"]
  }
}
```

Hidden thoughts are not shown to the learner. They are used to keep the actor consistent and drive animation, voice style, and de-escalation state.

## Bounded Stubbornness

Difficult actors should not be infinitely resistant. Use state-machine gates instead of hoping the LLM learns the educational arc.

Example:

```json
{
  "stubbornness_policy": {
    "resistant_topic": "psychological_contribution_to_pain",
    "initial_response": "skeptical",
    "acceptance_conditions": [
      "learner_validates_symptom_burden",
      "learner_explains_mind_body_link_without_blame",
      "learner_offers_concrete_follow_up"
    ],
    "premature_suggestion_response": "I do not see how talking about stress fixes this pain.",
    "after_conditions_response": "I am not fully convinced, but I can try if this is part of getting better."
  }
}
```

This keeps resistance realistic while allowing skilled communication to change the encounter.

## Nonverbal And Voice Cues

Do not let the LLM freely invent nonverbal behavior. The paper's failed prompting experiments are directly relevant to XR: free-form nonverbal cues can become repetitive or exaggerated.

Instead:

- Let the LLM output bounded `gesture_cues`.
- Map cues to approved animation clips.
- Limit each actor to a style-specific clip palette.
- Use intensity values rather than prose for repeated behaviors.
- Treat unsafe or unrealistic actions as guardrail violations.

Example cue mapping:

| Cue | Runtime mapping |
| --- | --- |
| `sigh_frustrated` | 1.2 second breath/audio clip plus shoulder motion |
| `guarded_posture` | posture blend weight 0.45 |
| `looks_to_family` | gaze target to spouse for 800 ms |
| `voice_tight_pain` | voice style preset with shorter phrases and breath pauses |

## Emotion And Sentiment QA

Every generated actor response should produce an emotion QA record:

```json
{
  "actor_response_id": "resp_00042",
  "style_expected": "accuser",
  "expected_emotions": ["pain", "distress", "annoyance", "anxiety"],
  "observed_emotions": [
    { "label": "pain", "score": 0.28 },
    { "label": "annoyance", "score": 0.21 },
    { "label": "anxiety", "score": 0.13 }
  ],
  "sentiment_bucket": 3,
  "style_adherence_score": 0.82,
  "repetition_score": 0.12,
  "exaggeration_flag": false,
  "requires_reviewer_check": false
}
```

Initial QA can use text emotion/sentiment classifiers as a development aid. It must not be treated as proof of embodied realism. The production QA loop should combine:

- Automated emotion/sentiment profile checks.
- Repetition detection.
- Gesture frequency checks.
- Human simulation review.
- Specialty clinician review when clinical meaning is affected.
- Learner/user feedback after pilots.

## Authoring UI Requirements

Scenario authors need controls for:

- Style family and style.
- Intensity slider.
- Mood descriptors.
- Topics to avoid.
- Escalation and de-escalation triggers.
- Communication-specific first message.
- Gesture cue palette.
- Voice style preset.
- Language/cultural notes.
- Review questionnaire preview.

Faculty reviewers need side-by-side views:

- Intended style profile.
- Sample dialogue.
- Emotion QA summary.
- Grounding audit.
- Repetition/exaggeration warnings.
- Reviewer override and comments.

## Case Bank Application

Use communication profiles deliberately:

- Chest pain spouse: anxious/protective, pressure rises if ignored.
- Pediatric parent: fearful/appeasing until clear explanation.
- Delirium daughter: concerned but fact-rich collateral historian.
- Diabetes patient: ashamed/guarded, improves with nonjudgmental teach-back.
- OB partner: anxious family advocate.
- Psychiatry patient: withdrawn/guarded, trust-gated disclosure.
- Stroke son: accuser-lite if last-known-well urgency is missed.
- Sepsis nurse: assertive safety advocate.
- Interpreter case father: controlling/distractor because of worry and language barrier.
- Oncology patient: congruent but emotionally stunned.
- Post-op consultant: rationalizer/efficiency pressure.
- Dyslipidemia patient: rationalizer mixed with health-literacy concern.

## Sources

- `src-local-bodonhelyi-medical-communication-pdf-2025`
- `src-local-laverde-llm-agents-pdf-2025`
- `src-jmir-llm-virtual-patients-2025`
