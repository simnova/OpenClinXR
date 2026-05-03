# Station Pack: ED Chest Pain With Nurse Interruption And Family Pressure

Date: 2026-05-03
Status: First deterministic implementation seed
Scenario ID: `ed_chest_pain_priority_v1`

## Purpose

This station pack translates the architecture into a concrete seed scenario. It is intentionally deterministic first: the same authored station should run without LLM dialogue before the bounded LLM actor adapter is enabled.

## Blueprint Mapping

Primary domains:

- Gather history and perform focused physical examination.
- Recognize urgent or emergent care needs and initiate evaluation.
- Participate in an interprofessional team.
- Communicate empathetically with patient and family.
- Organize work under time pressure.
- Document a clinical encounter.

Specialty relevance:

- Emergency medicine.
- Internal medicine.
- Cardiology.

Environment:

- Busy emergency department bay.

Timing:

- Doorway reading: 60 seconds.
- Encounter: 15 minutes.
- Patient note: 10 minutes.
- Station transition: configurable.

## Doorway Instructions

You are the physician assigned to evaluate a 54-year-old patient with chest pain in a busy emergency department. The triage nurse reports that the patient is anxious and that a family member is at bedside. Take a focused history, perform or request a focused exam as appropriate, respond to team updates, and document your assessment and plan after the encounter.

## Hidden Clinical Truth

Working concern:

- Acute coronary syndrome risk evaluation.

Must-not-miss diagnoses:

- STEMI or NSTEMI.
- Aortic dissection.
- Pulmonary embolism.
- Tension pneumothorax.
- Pericarditis or myocarditis.

Expected safe actions:

- Establish immediate safety and assess ABCs if unstable.
- Ask about onset, provoking factors, quality, radiation, severity, timing, and associated symptoms.
- Ask about cardiac risk factors and relevant past history.
- Request or review vital signs.
- Request ECG promptly.
- Recognize concerning features and escalate to senior/ED team.
- Communicate plan to patient, family, and nurse.
- Document differential, key history, focused exam, tests, and initial management.

Forbidden station behavior:

- Patient self-diagnoses myocardial infarction.
- Family member reveals the diagnosis.
- Nurse tells learner the correct answer unless escalation criteria are met.
- LLM actor changes the hidden truth or invents incompatible findings.

## Actor Cards

### Patient Actor

Actor ID: `patient_robert_hayes_v1`

Profile:

- Name: Robert Hayes.
- Age: 54.
- Language: English.
- Baseline emotion: anxious.
- Baseline pain: 8/10.
- Trust starts low and improves with empathy and clear plan.

Knows:

- Chest pressure started 45 minutes ago while carrying boxes.
- Pain is central, heavy, and radiates to the left arm if asked.
- Associated nausea and sweating if asked.
- No prior heart attack.
- Hypertension and high cholesterol.
- Smoked for 20 years, quit 5 years ago.
- Father died of a heart attack at 61.

Does not know:

- Diagnosis.
- ECG results.
- Troponin status.

Disclosure rules:

- Radiation only if asked about radiation, arm/jaw/back pain, or pain location spread.
- Diaphoresis only if asked about sweating or associated symptoms.
- Family history only if asked about family history.
- Medication adherence only if asked about medications.
- Anxiety increases if learner ignores severe pain for more than 3 minutes.

### Nurse Actor

Actor ID: `nurse_ed_maria_v1`

Role:

- Provides interruptions, vital updates, and task friction.

Initial behavior:

- Says the patient was triaged with chest pain and looks uncomfortable.
- Does not volunteer ECG unless learner asks or deterioration trigger fires.

Event behaviors:

- At minute 4, reports new blood pressure and asks whether the learner wants an ECG.
- If learner requests ECG early, returns at minute 6 with "ECG is being done now" and asks whether to notify the senior clinician.
- If learner has not requested ECG by minute 7, asks directly whether to order one.
- If learner recognizes instability, offers to call the attending and place patient on monitor.

### Family Actor

Actor ID: `wife_anna_hayes_v1`

Role:

- Adds emotional pressure and collateral history.

Baseline:

- Anxious, protective, occasionally interrupts.

Knows:

- Patient has been under work stress.
- Patient stopped taking cholesterol medicine for a few weeks if asked about medications or adherence.
- Patient minimized the pain before arrival.

Behavior:

- At minute 5, asks whether this is a heart attack.
- If learner ignores her twice, anxiety rises and she interrupts more often.
- If learner acknowledges concern and explains next steps, interruptions decrease.

## Environment Events

| Time | Trigger | Event | Trace |
| --- | --- | --- | --- |
| 00:00 | station start | Patient on stretcher, family at bedside, nurse nearby | `environment_loaded` |
| 04:00 | scheduled | Nurse reports vital update | `nurse_interruption` |
| 05:00 | scheduled unless already addressed | Family asks about heart attack | `family_question` |
| 07:00 | if no ECG requested | Nurse prompts ECG decision | `missed_priority_prompt` |
| 10:00 | if no escalation and concerning features elicited | Monitor alarm or worsening pain | `deterioration_event` |
| encounter end | timer | Transition to patient note | `encounter_ended` |
| note end | timer | Note auto-submit | `note_auto_submitted` |

## Trace Requirements

Required event categories:

- `history_question`
- `risk_factor_question`
- `associated_symptom_question`
- `focused_exam_action`
- `vital_sign_review`
- `ecg_request`
- `urgent_escalation`
- `team_communication`
- `family_communication`
- `empathy_statement`
- `patient_note_submitted`

Safety-critical event checks:

- ECG requested or reviewed.
- Senior/ED team escalation when concerning features are recognized.
- Immediate response to deterioration.
- No unsafe reassurance before risk evaluation.

Trace-quality minimum for deterministic milestone:

- 95 percent required event capture.
- 100 percent timer and note transition capture.
- 100 percent LLM audit capture once LLM adapter is enabled.

## Deterministic Actor Fixture

The first implementation should store deterministic fixture responses keyed by normalized learner intent:

```json
{
  "actor_id": "patient_robert_hayes_v1",
  "intent": "ask_pain_radiation",
  "response_text": "It goes down my left arm. That is what scared me.",
  "emotion_delta": { "anxiety": 0.02, "trust": 0 },
  "disclosures": ["pain_radiates_left_arm"],
  "trace_tags": ["history_question", "associated_symptom_question"]
}
```

LLM actor responses must match this schema or fail closed to a safe fallback.

## Rubric Draft

Each criterion is scored by a human reviewer. Automated scoring may only pre-highlight evidence.

| Domain | Weight | Full-credit evidence |
| --- | ---: | --- |
| Focused history | 20 | Onset, quality, severity, radiation, timing, provoking factors, associated symptoms, medications, allergies, PMH, family history, social risk |
| Focused exam/actions | 15 | Requests/reviews vitals, performs/request focused cardiopulmonary exam, places patient on monitor if unstable |
| Urgent recognition | 20 | Recognizes possible ACS or other life-threatening causes, requests ECG promptly, escalates appropriately |
| Team participation | 15 | Uses nurse effectively, communicates priorities, responds to interruptions, delegates appropriately |
| Patient/family communication | 15 | Uses empathy, explains uncertainty and next steps, manages family concern without false reassurance |
| Documentation | 15 | Captures pertinent positives/negatives, differential, initial tests, escalation, and plan |

## Failure Flags

Immediate faculty review flags:

- Learner provides definitive reassurance before urgent evaluation.
- Learner ignores deterioration event.
- Learner fails to request ECG after multiple prompts.
- Actor response leaks diagnosis or contradicts hidden truth.
- Speech attribution failure changes who said clinically important information.

## Implementation Acceptance

The deterministic station milestone passes when:

- Station can be loaded from seed data.
- Doorway, encounter, note, transition, and auto-submit states execute.
- Patient, nurse, and family fixtures respond to at least 20 learner intents.
- Event schedule triggers interruptions and deterioration.
- Trace ledger records all required categories.
- Faculty review packet shows timeline, highlights, rubric, note, and comments.
- No LLM is required to pass the deterministic run.
