# Iteration 0001 Core Plan

## Problem Framing

OpenClinXR needs a credible first MVP plan that narrows the broad architecture and business-plan artifacts into a testable institutional pilot. The first plan should prove that XR can improve access to formative clinical-skills practice while producing audit-ready evidence for human-governed faculty review. The plan must not claim autonomous licensure scoring, patient-care decision support, clinical effectiveness, or regulatory clearance.

The MVP should answer four questions:

- Can learners complete realistic communication and diagnostic-reasoning encounters in a Quest-class XR environment?
- Can faculty review traces and replay artifacts quickly enough to save time compared with purely manual OSCE workflows?
- Can the trace schema support later psychometric analysis without overclaiming score meaning?
- Can institutions understand the security, privacy, legal, and procurement posture well enough to approve a design-partner pilot?

## Proposed MVP Approach

The initial wedge is UME OSCE/EPA formative practice for communication, diagnostic reasoning, and organizing work. The first institutional promise is not "better doctors" or "automated assessment." It is: lower-friction repeatable practice, faculty-visible evidence, and a trace ledger that can support future validation.

First scenario set:

- **Scenario 1: ED Chest Pain And Prioritization**
  Emergency-medicine and internal-medicine focused. Trains history taking, differential diagnosis, urgency recognition, escalation, and task prioritization under time pressure.

- **Scenario 2: Breaking Bad News / Goals Of Care**
  Internal-medicine, family-medicine, psychiatry, and pediatrics review required depending on case variant. Trains empathy, communication, uncertainty, documentation, and faculty-reviewed professionalism.

- **Workflow-Readiness Queue**
  A short multi-patient prioritization module layered around Scenario 1. Captures task ordering, interruptions, escalation timing, handoff clarity, and documentation completeness.

Deliberately excluded from MVP:

- Autonomous high-stakes scoring.
- Procedure-heavy modules.
- Marketplace launch.
- Multi-site benchmarking.
- Real patient data.
- EHR integration.
- On-prem deployment.
- Specialty certification claims.

## Architecture

The MVP architecture should be staged.

**M0 planning/demo architecture**

- Browser-based faculty/admin surfaces.
- Scenario authoring through structured JSON and a lightweight Case Builder screen.
- Desktop preview and trace viewer.
- Scripted or constrained patient responses.
- Synthetic replay timeline from trace events.

**M1 Quest-class XR pilot architecture**

- React 19 plus React Three Fiber and WebXR client for Quest-class pass-through AR.
- Bun/Hono TypeScript API for scenario, session, trace, review, and audit endpoints.
- WebTransport or fallback WebSocket event stream for session interactions, selected after latency proof.
- Mongo-compatible document store for scenarios, sessions, traces, reviews, audit events, source metadata, and tenant settings.
- Python service only for offline or pre-baked avatar/voice/asset generation; no real-time ML dependency in the first pilot unless latency is proven.
- Object storage/CDN for GLB assets, audio, and session artifacts.

Architecture principle:

- The first pilot should be scripted-first and trace-first. AI-generated dialogue can be introduced behind faculty-reviewed content gates after the safety and review workflow is stable.

## Clinical And Educational Model

Target users:

- M3/M4 medical students practicing OSCE/EPA-aligned communication and diagnostic reasoning.
- Faculty reviewers and simulation-center staff.
- Assessment deans and simulation leaders evaluating the design-partner pilot.

Educational flow:

1. Faculty selects scenario version.
2. Learner completes XR session.
3. System records trace and replay artifacts.
4. Automated checks calculate trace completeness and flag review moments.
5. Faculty scores sampled or assigned sessions using human rubric.
6. Learner receives debrief with faculty comments and non-summative formative feedback.

Required specialty review:

- Emergency Medicine and Internal Medicine for ED chest pain.
- Psychiatry for emotional distress, suicidality, capacity, or difficult conversations.
- Pediatrics for any child/guardian variant.
- Surgery, Anesthesiology/Critical Care, Radiology, Cardiology, and Infectious Disease only when scenario variants enter those domains.

## Psychometric Model

The MVP score posture is formative and programmatic support only.

Allowed:

- Trace completeness checks.
- Faculty rubric scores.
- Two-rater sampling on selected encounters.
- Rater calibration dry runs.
- Generalizability-study planning.
- Fairness and differential item/functioning planning.
- Consequence-validity hypotheses.

Not allowed:

- Licensure-adjacent claims.
- Autonomous pass/fail decisions.
- Claims that XR trace scores predict workplace performance.
- Claims that AI feedback is clinically validated.

Initial gates:

- Trace completeness above 95% for required event families.
- Faculty can complete a review within an agreed time budget.
- Two-rater sampled encounters show enough agreement to justify a formal pilot G-study.
- Bias and fairness review is designed before cross-site comparison.

## Data And Trace Model

First trace families:

- Session lifecycle: start, pause, resume, end, abandon.
- Learner actions: voice intent, selected question, physical interaction, tool selection, note entry, order/task selection.
- Timing: response latency, escalation time, interruption handling, task order.
- Clinical reasoning: hypothesis updates, requested tests, red-flag recognition, differential rank changes.
- Communication: empathy statements, clarification, teach-back, handoff, documentation.
- Faculty review: rubric item score, comment, override, rater ID, rater version.
- Audit: scenario version, model/content version, asset version, consent state, access event.

Replay requirement:

- Reconstruct a timeline for faculty review without needing full video in the first pilot.

Research export boundary:

- De-identified or coded exports only after institutional approval and consent choices are recorded.

## Security, Privacy, Legal, And Compliance Model

Security posture:

- Tenant isolation from day one.
- Role-based access for learner, faculty, admin, researcher, reviewer, and support.
- Audit log for session access, score changes, exports, and administrative actions.
- Encryption in transit and at rest.
- No real patient identifiers in scenarios or traces.
- Third-party API use recorded in source and data-flow ledgers.

Compliance posture:

- Treat learner sessions and scoring artifacts as education records.
- Prepare FERPA-forward privacy language.
- Maintain HIPAA-like safeguards, while avoiding claims that no HIPAA obligations can ever arise.
- Create counsel-ready questions for BAA, data residency, retention, AI vendor terms, scenario IP, avatar/asset provenance, and institutional procurement terms.

Legal posture:

- Keep the product framed as educational simulation and formative practice.
- Require counsel review before any marketing language about assessment readiness, clinical outcomes, diagnostic accuracy, or regulated medical-device boundaries.

## UX And Workflow Model

Learner workflow:

- Assigned scenario.
- Consent and expectations screen.
- XR readiness check.
- Scenario session.
- Immediate formative debrief summary.
- Faculty feedback when available.

Faculty workflow:

- Review queue.
- Timeline/replay view.
- Trace highlights.
- Rubric scoring.
- Comment entry.
- Submit feedback.
- Rater calibration reminders.

Admin workflow:

- Scenario library.
- Version status.
- Reviewer assignment.
- Consent and retention settings.
- Export and audit controls.

Researcher workflow:

- Query approved data sets.
- Export coded trace data.
- View trace completeness and rater metadata.

## Business And GTM Model

Design-partner target:

- Three UME assessment/simulation leaders and two simulation centers.

Pilot package:

- Two scenarios plus workflow-readiness queue.
- Faculty review dashboard.
- Trace ledger.
- Security/privacy packet.
- Pilot evaluation protocol.

Proof points:

- Repeat usage.
- Faculty review time.
- Trace completeness.
- Learner satisfaction and usability.
- Faculty trust in replay and scoring workflow.
- Evidence that the validation protocol is acceptable to assessment leaders.

Commercial posture:

- Paid design-partner pilot where possible.
- Hosted enterprise later.
- Validation network later.
- Marketplace only after scenario governance and review board processes are proven.

## Open Risks

| Severity | Risk | Owner | Mitigation |
|---|---|---|---|
| High | External source claims in prior plans are not yet independently verified. | Source Librarian | Create source ledger and verify current claims before external use. |
| High | WebXR/WebTransport and Quest performance may not meet live interaction targets. | XR Systems Architect | Stage M0 desktop and M1 Quest pilot; allow WebSocket fallback; measure latency before commitment. |
| High | AI-generated patient dialogue can create clinical safety and liability issues. | Clinical Simulation Lead | Use scripted-first content and faculty review gates before generative dialogue. |
| High | Faculty review may not save time if replay and trace views are cluttered. | UX And Product Lead | Prototype review queue and measure review time during dry runs. |
| High | Psychometric evidence may be overclaimed by sales or product language. | Psychometrics Lead | Maintain formative-only posture and leadership gate on score-use claims. |
| Medium | Open-source governance may invite low-quality scenarios. | Open Source And Governance Lead | Keep marketplace out of MVP; define certified scenario tier later. |
| Medium | Legal boundaries around education records, consent, and vendor data flow need counsel review. | Legal And Regulatory Counsel | Produce counsel-ready issue list before pilot contracting. |

## Next Decisions

1. Whether MVP should start with desktop/faculty-review M0 before Quest pilot M1.
2. Whether the first communication scenario should be adult goals-of-care or pediatric family communication.
3. Whether WebTransport is required for pilot or should remain behind fallback abstraction.
4. Whether any generative voice/dialogue should be included in the first pilot.
5. Which institution-facing claims are allowed before source verification and counsel review.
