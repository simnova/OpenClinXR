# Research Brief: Step 2 CS-Inspired XR Exam And LLM Virtual Patients

Date: 2026-05-03
Status: Agent Factory Iteration 0002 research brief

## Why This Matters

The OpenClinXR system should no longer be framed as a single-scenario training tool. The design target is a sequence of timed, realistic clinical encounters inspired by the public structure of the former USMLE Step 2 Clinical Skills exam, expanded into richer XR environments with multiple actors, environmental pressure, speech, emotion, and team workflows.

The architecture must still avoid claiming that it replaces Step 2 CS, ECFMG certification, USMLE, NBME, or medical licensure assessment.

## Public Step 2 CS Model

Public USMLE materials describe Step 2 CS as a separate Step 2 component that used standardized patients to test information gathering, physical examination, and communication of findings. The 2020 Bulletin describes 12 patient cases, 15 minutes per patient encounter, and 10 minutes to record each patient note. It also describes three subcomponents: Communication and Interpersonal Skills, Integrated Clinical Encounter, and Spoken English Proficiency. Passing required all three subcomponents in one administration. ECFMG public notices add operational details useful for simulation design: the exam lasted approximately 8 hours, included breaks after the 3rd, 6th, and 9th patient encounters, and patient notes could auto-submit at the end of the 25-minute station window.

Architecture implications:

- OpenClinXR needs an **exam session** containing a sequence of **stations**.
- Each station needs a timer, doorway instructions, encounter phase, post-encounter note phase, and station transition.
- Each station needs scoring facets comparable in spirit to communication, clinical encounter/information gathering, documentation, and language clarity, but adapted to OpenClinXR's formative and programmatic posture.
- Patient-note scoring should remain human-governed because the NBME patient-note corpus paper emphasizes physician-rated case-specific rubrics and the high cost of automated scoring errors.

## Expanded Encounter Model

The historical standardized-patient room was mostly physician plus single patient. OpenClinXR should support richer station environments:

- ED bay with nurse interruptions, family pressure, monitor alarms, limited time, and urgent-care escalation.
- Inpatient ward room with team handoff, senior resident/attending questions, medication reconciliation, and documentation burden.
- Clinic room with standardized patient plus family member, interpreter, or caregiver.
- Pediatrics room with guardian, child patient, consent/assent, and age-specific communication.
- ICU or rapid response environment with nurse, respiratory therapist, consultant, family, and dynamic deterioration.
- Telehealth/phone environment for remote triage, abnormal result disclosure, or medication counseling.

Each station should model:

- Physical environment.
- Actor roster.
- Hidden clinical truth.
- Actor knowledge and disclosure rules.
- Time pressure.
- Interruptions.
- Environmental events.
- Expected learner tasks.
- Safety-critical actions.
- Documentation requirements.
- Scoring rubric.

## AMA Day-One Skill Targets

AMA's day-one residency readiness article highlights five skills that should be first-class station targets:

- Gather a history and perform a physical examination.
- Give an oral summary of a patient encounter.
- Document a clinical encounter.
- Participate as a contributing member of an interprofessional team.
- Recognize urgent or emergent care needs and initiate evaluation and management.

It also flags time management, prioritization, and organizing work as major transition pain points.

Architecture implications:

- Each exam blueprint must map stations to EPAs and day-one skill targets.
- At least one station per exam should include organizing work under pace and volume.
- Oral summary, documentation, team participation, and urgent recognition must be captured as traceable events, not buried in a free-text note only.

## LLM Virtual Patient Literature

The LLM generative-agent anamnesis article supports using LLM-based virtual patients with memory retrieval, cognitive mechanisms, and teacher-created cases for flexible history-taking practice. RasPatient Pi supports a low-cost customizable architecture using automatic speech recognition, LLMs, text-to-speech, teacher scenario descriptions, and browser/3D-avatar deployment.

Architecture implications:

- Use LLMs as **bounded actor engines**, not unbounded exam arbiters.
- Separate scenario generation, actor dialogue, speech synthesis, and scoring.
- Require psychometric and clinical review before generated scenarios enter an exam bank.
- Use memory/retrieval to preserve patient consistency, actor roles, emotional state, and prior disclosures during the station.
- Store every LLM prompt, model version, retrieved memory, tool call, and generated response in trace/audit logs.

## CellixJS Forethought

Public CellixJS documentation emphasizes DDD boundaries, application services, infrastructure services, domain contexts, aggregate roots, repositories, unit of work, monorepo structure, and Turborepo affected-package analysis. The earlier OpenClinXR artifacts used "CellixJS actor/cell" language. Because public docs do not prove an exact actor-cell runtime, OpenClinXR should treat CellixJS as a design influence until a spike verifies fit.

Architecture implication:

- Model scenario runtime as actor-like cells with explicit message contracts.
- Use DDD context boundaries compatible with CellixJS style.
- Do not make CellixJS a hard dependency until a proof-of-fit spike validates package reality, runtime behavior, and developer ergonomics.

## Design Constraints

- Do not reproduce confidential USMLE content.
- Do not claim equivalence to Step 2 CS.
- Use public exam structure only as inspiration.
- Keep generated scenario content behind clinical and psychometric review.
- Keep automated scoring advisory until validation supports stronger use.
- Preserve full traceability from source materials to generated scenario bank to administered exam form.

## Sources

- `src-usmle-2020-bulletin-step2cs`
- `src-usmle-step2cs-discontinuation`
- `src-ecfmg-step2cs-break-schedule-2015`
- `src-ecfmg-step2cs-patient-note-auto-submit-2017`
- `src-ama-day-one-skills-2026`
- `src-llm-generative-agents-anamnesis-2025`
- `src-raspatient-pi-2024`
- `src-nbme-step2cs-patient-note-corpus-2022`
- `src-cellixjs-ddd-docs-2026`
- `src-cellixjs-monorepo-pipeline-docs-2026`
