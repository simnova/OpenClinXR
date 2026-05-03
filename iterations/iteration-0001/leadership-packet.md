# Leadership Packet: iteration-0001

## Score Summary

```text
iterations/iteration-0001/02-core-scorecard.json
  plan_type: core-plan
  weighted_score: 3.261
  composite_score: 3.193
  confidence: 0.72
  critical_risks: 3
  evidence_debt: 2
  decision_debt: 2
```

```text
iterations/iteration-0001/04-adversarial-scorecard.json
  plan_type: adversarial-counterplan
  weighted_score: 3.930
  composite_score: 3.929
  confidence: 0.80
  critical_risks: 2
  evidence_debt: 1
  decision_debt: 1
```


---

# Iteration 0001 Brief

## Objective

Convert the existing OpenClinXR architecture and business-plan artifacts into a consolidated MVP approach that can be attacked by the Adversarial Team and reviewed by Senior Leadership.

## Source Artifacts

- `/Users/patrick/Downloads/xr-solution.zip`
- `/Users/patrick/Downloads/grok.docx`
- `/Users/patrick/Documents/agent-factory/reports/chatgpt.docx`
- `docs/superpowers/specs/2026-05-02-openclinxr-agent-factory-design.md`

## Required Core Output

The Core Design Team must produce a plan covering:

- First product wedge.
- First two clinical scenarios.
- Workflow-readiness scenario.
- Trace schema priorities.
- Faculty scoring workflow.
- Validation gates.
- Security, privacy, legal, and compliance posture.
- Open-source and marketplace governance.
- Pilot packaging and proof points.

## Required Adversarial Output

The Adversarial Team must produce a counterplan that:

- Identifies high-severity holes.
- Replaces weak assumptions with stronger alternatives.
- Challenges legal, clinical, psychometric, financial, and implementation risks.
- Activates specialty physicians where scenario scope requires it.

## Activated Agents

Minimum activation:

- Chief Coordinator.
- Memory Archivist.
- Rubric Steward.
- Source Librarian.
- Solution Architect.
- XR Systems Architect.
- Clinical Simulation Lead.
- Psychometrics Lead.
- Data And Trace Architect.
- Security And Privacy Lead.
- UX And Product Lead.
- Platform And DevOps Lead.
- Open Source And Governance Lead.
- Business And GTM Lead.
- Legal And Regulatory Counsel.
- Healthcare Compliance Counsel.
- IP And Open-Source Counsel.
- Emergency Medicine Physician.
- Internal Medicine Physician.
- Pediatrics Physician.
- Psychiatry Physician.
- Surgery Physician.
- Red-Team Coordinator.
- Feasibility Skeptic.
- Clinical Safety Critic.
- Psychometric Overclaim Critic.
- Security And Privacy Attacker.
- Cost And Performance Attacker.
- Procurement And GTM Critic.
- Legal Liability Attacker.

## Constraints

- Do not build the OpenClinXR product.
- Treat external-facing medical, legal, regulatory, and market claims as needing verification.
- Separate confirmed facts, reasonable inferences, strategic bets, and unknowns.
- Preserve a formative-only assessment posture unless evidence gates justify stronger language.

## Success Criteria

- Core and adversarial plans are both scoreable.
- Critical risks are explicit.
- Evidence debt is explicit.
- Senior Leadership can decide whether to revise, block, or proceed.




---

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



---

# Iteration 0001 Adversarial Counterplan

## Attack Summary

The Core Plan is directionally strong but still too ambitious for a first pilot. It tries to hold XR, faculty review, trace schema, scenario authoring, security packet, legal posture, validation gates, and GTM packaging in one MVP. That breadth risks a slow build and weak proof. The adversarial replacement is a sharper two-stage pilot: prove faculty-visible trace/replay and human scoring first, then layer Quest XR only where it creates evidence value.

## High-Severity Holes

1. **XR dependency could obscure the actual buyer proof.**
   Assessment leaders may care more about faculty review time and defensible evidence than headset novelty.

2. **The first scenario set may still be too broad.**
   ED chest pain plus breaking bad news plus workflow queue activates many specialties and review rubrics.

3. **Scripted-first is good, but generative AI still appears too available.**
   The plan should explicitly prohibit generative clinical dialogue in the first dry run.

4. **Psychometric plan is framed correctly but not operational enough.**
   It needs a first rater-calibration protocol and a minimum viable scoring form.

5. **Legal/compliance posture is issue-aware but not contract-ready.**
   The plan needs a pilot data-flow appendix, retention schedule, and prohibited claims list.

6. **Open-source strategy is premature for MVP execution.**
   The open-source core can exist as architecture posture, but public contribution and marketplace governance should wait.

## Better Competing Approach

Replace the first MVP plan with a **Pilot Evidence Spine**:

- **M0: Faculty Evidence Prototype**
  Desktop/browser scenario playback, structured event trace, faculty rubric, audit export, and consent/data-flow packet. No headset required.

- **M1: Quest XR Interaction Slice**
  One ED chest pain encounter with limited hand/gaze/tool interactions. The XR slice exists to test whether embodied interaction adds useful trace evidence, not to prove the full platform.

- **M2: Design-Partner Pilot**
  Only after M0 and M1 pass usability, trace completeness, review-time, and safety gates.

This approach preserves the OpenClinXR vision but makes the first proof point harder to dismiss.

## Specific Replacements

| Core Assumption | Replacement | Owner | Expected Rubric Improvement |
|---|---|---|---|
| Two full scenarios plus workflow queue in MVP | One full ED chest pain scenario, one communication storyboard, and one workflow micro-module | Chief Coordinator | Higher implementation readiness |
| Quest XR is the first demonstrable surface | Desktop faculty evidence prototype comes first; Quest XR follows as interaction slice | CTO | Higher technical feasibility and cost efficiency |
| Generative dialogue can be introduced after gates | No generative clinical dialogue in M0/M1; use scripted branching only | Clinical Safety Critic | Higher clinical and legal resilience |
| Trace schema covers many event families | Minimum trace schema covers lifecycle, learner action, timing, faculty review, audit, and scenario version | Data And Trace Architect | Higher architecture coherence |
| Pilot packet can be developed alongside product | Create legal/compliance packet before design-partner contracting | General Counsel | Higher legal/regulatory resilience |
| Open-source and marketplace governance are MVP themes | Keep public marketplace out of first pilot; focus on internal source provenance and scenario certification criteria | Open-Source Sustainability Critic | Higher sustainability and focus |

## Clinical And Specialty Objections

- Emergency Medicine: ED chest pain is a strong first scenario, but escalation and red-flag handling must be faculty-reviewed before learner release.
- Internal Medicine: Diagnostic reasoning should capture uncertainty and differential evolution, not only final diagnosis.
- Pediatrics: Pediatric variants should be excluded from first pilot unless guardianship, consent, and age-specific communication are explicitly designed.
- Psychiatry: Breaking-bad-news and distress scenarios can be valuable but should not include suicide risk in the first version unless crisis escalation is built.
- Surgery: Procedure-heavy expansion should remain outside MVP.

## Psychometric Objections

- Trace completeness is not validity evidence by itself.
- Faculty score forms must define constructs before data collection.
- Two-rater sampling needs a sampling rule, not a vague aspiration.
- G-study planning should identify facets: learner, case, rater, site, device, and scenario version.
- Consequence validity should be deferred until remediation and follow-up data exist.

## Legal And Compliance Objections

- The first pilot needs a prohibited-claims list for sales, demos, and investor materials.
- Consent should distinguish debrief recording, faculty scoring, research export, and de-identified improvement analytics.
- Vendor data flow must be documented even if no real patient data is used.
- Avatar, voice, and generated asset provenance require IP review before public release.
- Any institutional pilot needs a retention and deletion schedule.

## Cost And Performance Objections

- Quest performance risk should not block the faculty evidence prototype.
- Real-time voice and avatar generation should not be on the pilot critical path.
- WebTransport should remain an abstraction until measured against fallback options.
- Cloud/model cost should be capped per learner-hour before paid pilot terms are proposed.
- Staffing plan should prioritize trace/replay, scenario design, faculty UX, and compliance before marketplace features.

## Evidence Debt

- Verify current WebXR/OpenXR status and headset browser capability.
- Verify current regulatory/non-device framing with counsel.
- Verify AAMC/ACGME/NBME/USMLE facts before external use.
- Verify competitor and market-size claims before investor use.
- Verify FERPA/HIPAA/data-residency obligations with counsel for the first design-partner state/institution.

## Decision Debt

- M0 desktop evidence prototype before M1 Quest XR.
- First scenario scope and excluded specialty variants.
- Generative dialogue prohibition duration.
- Minimum rater-calibration protocol.
- Allowed external claims for design-partner outreach.



---

# Iteration 0001 Core Revision

## Accepted Adversarial Findings

- The MVP should be split into M0 faculty evidence prototype, M1 Quest XR interaction slice, and M2 design-partner pilot.
- The first build path should not depend on headset performance, real-time voice generation, or generative clinical dialogue.
- ED chest pain should be the first full scenario because it exercises diagnostic reasoning, prioritization, escalation, and trace value.
- The communication scenario should start as a storyboard and rubric package before becoming a full XR module.
- Public marketplace and broad open-source contribution workflows should be deferred until scenario provenance and review governance are stronger.
- The pilot needs a prohibited-claims list, retention schedule, consent matrix, and data-flow appendix before external outreach.

## Rejected Adversarial Findings

- The Core Team does not accept removing Quest XR from the plan entirely. XR remains central to the OpenClinXR thesis, but it should be tested as an M1 interaction slice after M0 proves the evidence workflow.
- The Core Team does not accept deferring all open-source thinking. Open-source architecture, trace schema posture, and provenance discipline should remain in the plan even if public contribution is deferred.

## Revised MVP Approach

The revised approach is the **Pilot Evidence Spine**:

1. **M0 Faculty Evidence Prototype**
   Browser-based scenario review, trace ledger, replay timeline, faculty rubric, consent/data-flow packet, and audit export. Uses scripted cases and no real-time generative dialogue.

2. **M1 Quest XR Interaction Slice**
   One ED chest pain encounter with limited embodied interactions: gaze/attention, selected history prompts, basic physical exam zones, task prioritization, and handoff/documentation events.

3. **M2 Design-Partner Pilot**
   Runs after M0 and M1 pass usability and evidence-readiness gates. Adds design-partner evaluation protocol, faculty scoring dry run, rater calibration, and pilot security/privacy packet.

## Score Improvement Hypothesis

- Technical feasibility improves because desktop evidence workflow is decoupled from Quest runtime risk.
- Cost/performance improves because real-time AI and full avatar pipeline are off the critical path.
- Legal/regulatory resilience improves because the plan now requires prohibited claims, consent matrix, and data-flow appendix.
- Psychometric defensibility improves because rater calibration and construct definition are required before score claims.
- Specialty generalizability improves because pediatric, psychiatry crisis, and procedure-heavy variants are explicitly deferred until reviewed.

## Remaining Risks

| Severity | Risk | Owner | Status |
|---|---|---|---|
| High | External source verification is still incomplete. | Source Librarian | Open |
| High | Counsel has not reviewed prohibited claims, consent, data flow, or pilot contracting. | General Counsel | Open |
| High | First faculty rubric and rater-calibration protocol are not yet drafted. | Chief Psychometrician | Open |
| High | Quest browser/WebXR performance remains unmeasured. | XR Systems Architect | Open |
| Medium | The communication scenario needs a specialty-specific choice. | Specialty Advisory Board Chair | Open |
| Medium | Open-source license and contribution boundary are not yet chosen. | IP And Open-Source Counsel | Open |

## Memory Updates Needed

- Chief Coordinator: record Pilot Evidence Spine as the preferred first-loop structure.
- Psychometrics Lead: record that trace completeness is an evidence prerequisite, not validity evidence.
- Legal And Regulatory Counsel: record that prohibited claims and data-flow appendix are pre-pilot requirements.
- XR Systems Architect: record that Quest runtime should be M1, not M0.
- Open Source And Governance Lead: record that marketplace launch is outside MVP.



---

# Iteration 0001 Leadership Review

## Approval Status

**Revise.** Senior Leadership does not approve the plan for implementation yet, but approves the direction of the Pilot Evidence Spine as the next planning baseline.

## Required Reviewers

- CEO And Strategy Chair: revise.
- CTO: revise.
- Chief Medical Education Officer: revise.
- Chief Psychometrician: revise.
- Chief Security And Privacy Officer: revise.
- General Counsel: revise.
- Chief Compliance Officer: revise.
- Chief Medical Officer: revise.
- Specialty Advisory Board Chair: revise.
- CFO And Operations Lead: revise.
- Product And Growth Executive: revise.
- External Academic Advisor: revise.
- Investor And Board Skeptic: revise.
- Rotating Specialty Physician Reviewer: revise.

## Blocking Issues

- No counsel-reviewed prohibited-claims list exists.
- No minimum viable faculty rubric exists.
- No rater-calibration protocol exists.
- No source verification package exists for external claims.
- No measured evidence supports Quest/WebXR performance assumptions.
- No finalized scenario scope exists for the communication module.

## Required Revisions

1. Create a one-page M0/M1/M2 milestone plan with acceptance criteria.
2. Draft the ED chest pain scenario brief with Emergency Medicine and Internal Medicine review.
3. Draft a minimum viable faculty scoring rubric and rater-calibration protocol.
4. Draft a consent matrix covering debrief recording, faculty scoring, research export, and improvement analytics.
5. Draft a prohibited-claims list for demos, pilots, investor materials, and sales conversations.
6. Verify the top external facts required for the pilot packet using authoritative or primary sources.
7. Define the first Quest XR performance test and fallback criteria.

## Optional Improvements

- Create an initial visual workflow map for learner, faculty, admin, and reviewer surfaces.
- Draft a source-ledger import process for the existing DOCX and ZIP artifacts.
- Add vector search in a later maturity level if keyword indexing becomes insufficient.

## Deferred Decisions

| Decision | Owner | Review Trigger |
|---|---|---|
| Communication scenario choice | Specialty Advisory Board Chair | After ED chest pain brief is drafted |
| WebTransport versus WebSocket pilot path | CTO | After latency test design |
| Open-source license | IP And Open-Source Counsel | Before public repository release |
| Pricing for paid design partners | CFO And Operations Lead | After pilot scope and acceptance criteria |

## Kill Criteria

- Faculty review workflow does not reduce review burden or improve evidence visibility in dry run.
- Trace completeness cannot reach 95% for required event families.
- Counsel blocks the planned claims or data-flow posture.
- Quest interaction slice cannot meet minimum usability and latency thresholds.
- Design partners reject the validation and faculty-review posture.

## Next Review Trigger

Senior Leadership should review again after the required M0/M1/M2 milestone plan, ED chest pain scenario brief, faculty rubric, rater-calibration protocol, consent matrix, prohibited-claims list, and source verification packet are drafted.



---

# Iteration 0001 Final Synthesis

## Final Planning Judgment

Iteration 0001 improved the OpenClinXR planning approach by narrowing the first MVP from a broad XR platform concept into a staged Pilot Evidence Spine. The plan is not ready for implementation, but it is now sharper: prove faculty-visible evidence and human review first, then test Quest XR as a focused interaction slice, then recruit design partners.

## Highest-Value Changes

- Split the MVP into M0 faculty evidence prototype, M1 Quest XR interaction slice, and M2 design-partner pilot.
- Made scripted-first content mandatory for the first dry run.
- Deferred generative clinical dialogue, marketplace launch, procedure-heavy modules, EHR integration, and on-prem deployment.
- Elevated prohibited claims, consent matrix, retention schedule, and data-flow appendix to pre-pilot requirements.
- Clarified that trace completeness is a prerequisite for evidence, not validity evidence by itself.
- Scoped ED chest pain as the first full scenario and pushed the communication scenario into a specialty-reviewed storyboard.

## Remaining Critical Risks

No critical risks were classified in this loop, but several high risks remain open:

- Source verification incomplete.
- Counsel review incomplete.
- Faculty rubric and rater calibration missing.
- Quest/WebXR performance unmeasured.
- Communication scenario scope unresolved.

## Evidence Debt

- Verify current WebXR/OpenXR/headset browser capability.
- Verify official education/assessment facts used in the business plan.
- Verify regulatory/non-device framing with counsel.
- Verify privacy, education-record, data-retention, and data-residency obligations for pilot institutions.
- Verify competitor, pricing, and market-size claims before investor use.

## Decision Debt

- Whether M0 must pass before M1 starts.
- Which communication scenario is second.
- Whether any generative dialogue is allowed before M2.
- Which trace events define the 95% completeness threshold.
- Which external claims are permitted before legal review.

## Next Iteration Objective

Iteration 0002 should produce the M0/M1/M2 milestone plan, ED chest pain scenario brief, minimum viable faculty rubric, rater-calibration protocol, consent matrix, prohibited-claims list, first source-verification packet, and Quest XR performance-test plan.



---

# Iteration 0001 Memory Update Log

## Agent Memory Updates

- Agent: `chief-coordinator`
- Entry ID: `chief-coordinator-decision-0002`
- Type: decision
- Topic: pilot-evidence-spine
- Summary: Use M0 faculty evidence prototype, M1 Quest XR interaction slice, and M2 design-partner pilot as the next planning baseline.
- Confidence: 0.82
- Source IDs: `src-internal-openclinxr-architecture-bundle`, `src-internal-chatgpt-business-plan`, `src-internal-agent-factory-design-spec`
- Status: active

- Agent: `psychometrics-lead`
- Entry ID: `psychometrics-lead-lesson-0002`
- Type: lesson
- Topic: trace-completeness
- Summary: Trace completeness is a prerequisite for defensible evidence but is not validity evidence by itself.
- Confidence: 0.9
- Source IDs: `src-internal-chatgpt-business-plan`
- Status: active

- Agent: `legal-regulatory-counsel`
- Entry ID: `legal-regulatory-counsel-risk-0002`
- Type: risk
- Topic: prohibited-claims
- Summary: Prohibited claims, consent matrix, retention schedule, and data-flow appendix are required before design-partner outreach.
- Confidence: 0.84
- Source IDs: `src-internal-chatgpt-business-plan`, `src-internal-agent-factory-design-spec`
- Status: active

- Agent: `xr-systems-architect`
- Entry ID: `xr-systems-architect-decision-0002`
- Type: decision
- Topic: quest-runtime-stage
- Summary: Quest XR should be treated as an M1 interaction slice after the M0 evidence workflow is clear.
- Confidence: 0.78
- Source IDs: `src-internal-openclinxr-architecture-bundle`
- Status: active

- Agent: `open-source-governance-lead`
- Entry ID: `open-source-governance-lead-decision-0002`
- Type: decision
- Topic: marketplace-deferral
- Summary: Public marketplace launch should remain outside the first MVP until scenario provenance and certification governance mature.
- Confidence: 0.81
- Source IDs: `src-internal-chatgpt-business-plan`, `src-internal-grok-business-plan`
- Status: active

## Superseded Entries

No entries are superseded in this first loop.

## Shared Memory Index Action

After memory updates are written to agent indexes, run:

```bash
npm run agent:index
```

