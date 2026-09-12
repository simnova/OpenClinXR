# Render sweep after the client-graph fix (2026-09-12)

Instrument-only. Each shipped station is captured one at a time against a
shared portless ui-xr server. Failures keep the pageDiagnostics class; this
file does not repair them, change wait budgets, or grade how the rooms look.

- tree: `a6f8ba4045239204104e16b9306942aab73d3c1f`
- startedAt: 2026-09-12T08:12:34.337Z
- finishedAt: 2026-09-12T08:16:32.381Z
- server: http://127.0.0.1:49546/
- command: `captureStationEnvironmentRooms({ scenarioIds: [<one>] })` per station
- populationSource: `shippedStationIds()` (bundle dirs under apps/ui-xr/public/xr-assets/generated)
- population: 15
- rendered: 15 of 15
- timeout: 0 of 15
- other-error: 0 of 15

Count formula: rendered = count(rows where outcome=rendered).
Rendered means the capture returned and wrote one manifest entry.
It is not a pixel grade.

## Discriminator

Timeout bag (page-diagnostics.ts): pageErrors.length > 0 → page exception;
else failedRequests.length > 0 → failed request;
else all three lists empty → unresponsive main thread or silent page;
else → console output.
Predicate-error class: `wait-predicate reference error (browserPageWindow types-only alias)`.
Success class: `did not stop` (shell wait resolved; manifest written).

## Stations

### `adult_abdominal_pain_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 16498
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=adult_ed_abdominal_bay_v1 depth=3.4 floor=5594984 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `clinic_abdominal_pain_interpreter_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 15620
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=urgent_care_clinic_room_v1 depth=2.9 floor=6254951 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `ed_chest_pain_priority_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 15374
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=ed_exam_bay_v1 depth=3.45 floor=5858155 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `ed_chest_pain_priority_v2`
- outcome: rendered
- classification: did not stop
- durationMs: 16829
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=ed_exam_bay_v1 depth=3.45 floor=5858155 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `ed_stroke_alert_handoff_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 18135
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=ed_stroke_bay_v1 depth=3.6 floor=5200483 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `ob_headache_preeclampsia_triage_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 14545
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=ob_triage_room_v1 depth=3.05 floor=7696248 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `oncology_bad_news_family_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 14452
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=oncology_consult_room_v1 depth=3.1 floor=6840947 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `peds_asthma_parent_anxiety_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 16872
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=pediatric_urgent_care_bay_v1 depth=2.95 floor=6321018 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `peds_fever_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 15390
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=pediatric_fever_urgent_care_bay_v1 depth=2.95 floor=6321018 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `postop_fever_consult_pressure_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 14584
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=surgical_ward_room_v1 depth=3.2 floor=7562845 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `primary_care_dyslipidemia_joint_pain_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 14781
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=primary_care_clinic_room_v1 depth=2.8 floor=6583435 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `psych_suicidal_ideation_safety_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 16780
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=behavioral_health_private_room_v1 depth=3 floor=7041664 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `stepdown_sepsis_nurse_escalation_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 16965
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=stepdown_room_v1 depth=3.25 floor=6055536 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `telehealth_diabetes_health_literacy_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 14563
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=telehealth_home_visit_v1 depth=2.55 floor=9136404 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

### `ward_delirium_med_rec_v1`
- outcome: rendered
- classification: did not stop
- durationMs: 15875
- wait that fired: (none)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)
- live: env=inpatient_ward_room_v1 depth=3.15 floor=5923950 cam=environment_room_capture_infinigen_interior_learner_view_derived_from_room_and_actor_bounds_#342

```
capture completed without throwing
```

claimScope: how many of the shipped station-environment captures resolve
on this tree after the served client-graph no longer reaches a node: builtin.
notEvidenceFor: wait-budget changes; repairs of any failure class; whether
a rendered room is worth looking at; Quest readiness; clinical realism.

CLAIM: 15 of 15 shipped stations rendered (shell wait resolved and a manifest entry was written) on this tree after the client-graph fix.
NOT TESTED: whether any case that renders produces a room worth looking at — nobody has graded these pixels.
