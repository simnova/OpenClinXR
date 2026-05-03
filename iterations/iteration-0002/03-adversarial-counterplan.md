# Iteration 0002 Adversarial Counterplan

## Red-Team Position

The core plan is much stronger than Iteration 0001, but it still risks overbuilding a dazzling simulation before proving that the exam evidence chain is reliable. The adversarial team accepts the multi-station design goal, then forces the implementation path to prove each fragile assumption in order.

## Holes Found

1. A full 12-station XR exam is architecturally useful but too broad for the first code milestone.
2. LLM-generated stations can look clinically plausible while containing hidden psychometric defects, unfair cues, inconsistent difficulty, or biased actor behavior.
3. Multi-actor speech interactions create turn-taking, interruption, latency, and attribution problems that can corrupt trace evidence.
4. Realistic environments can distract from assessment constructs if environmental events are not mapped to rubric-relevant learner actions.
5. Automated scoring can become a liability magnet if any UI implies pass/fail certainty before validation.
6. CellixJS enthusiasm can turn into dependency lock-in before proving runtime and maintenance fit.
7. Public Step 2 CS details can inspire flow, but product messaging must avoid historical-exam equivalence.

## Counterplan

Build a proof ladder instead of a product-shaped demo.

### Proof 1: Evidence-First Station Pack

Implement one complete ED chest pain station in data before any XR polish:

- Blueprint coverage.
- Doorway instructions.
- Actor cards.
- Hidden clinical truth.
- Rubric.
- Expected trace events.
- Review packet.
- Synthetic trace replay.

Pass condition: faculty and psychometric reviewers can inspect the station and identify exactly what is being assessed.

### Proof 2: Deterministic Multi-Actor Runtime

Run the station with scripted or fixture-backed actors first:

- Patient answers from actor card.
- Nurse interruption triggered by event schedule.
- Family pressure triggered by learner delay or missed empathy.
- Timer and note auto-submit work.
- Trace events are complete.

Pass condition: the system captures the intended evidence without LLM variability.

### Proof 3: Bounded LLM Actor Adapter

Turn on LLM dialogue only after deterministic trace quality passes:

- Actor response schema is strict.
- Hidden truth is only disclosed through rules.
- All retrieved memory and prompts are auditable.
- Guardrail blocks out-of-role, unsafe, diagnosis-leaking, or station-invalid responses.
- Fallback response exists.

Pass condition: adversarial learner utterances do not break actor role, leak hidden truth, or erase required evidence.

### Proof 4: XR And Speech Slice

Only then test speech and XR:

- ASR transcript confidence thresholds.
- TTS latency and emotional tone.
- Multi-speaker turn attribution.
- Environment events visible/audible.
- Mobile/desktop fallback.

Pass condition: speech and XR improve realism without degrading station timing, trace completeness, or learner accessibility.

## Leadership Revision Demands

- Rename all "exam equivalent" language to "Step 2 CS-inspired historical flow" or "clinical skills station sequence."
- Put a visible "formative/local assessment only" score-use statement in faculty review outputs.
- Create a claims registry before outreach.
- Require a psychometrician sign-off state before an exam form can be activated.
- Treat automated scoring as "rubric suggestion" until validation gates are met.
- Add a trace-quality dashboard before any learner-facing score summary.
- Treat CellixJS as an architecture spike, not a commitment.

## Adversarial Output

The best path is not less ambitious. It is stricter. Build the full 12-station architecture into the schema and state machine now, but implement the first milestone as one high-fidelity station that proves review, trace, timing, actor boundaries, and human scoring.
