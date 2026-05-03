# OpenClinXR Agent Factory Design

Date: 2026-05-02
Status: Draft for user review
Scope: Design the multi-agent planning system for OpenClinXR. This does not build the OpenClinXR product.

## 1. Purpose

The OpenClinXR Agent Factory is a structured multi-agent design system for turning the existing OpenClinXR business and architecture artifacts into a high-quality, implementation-ready plan.

The system must:

- Create a constructive expert team that produces a detailed solution approach.
- Create a separate adversarial team that attacks, improves, and attempts to outdo that approach.
- Create a senior leadership team that critiques both teams for feasibility, efficiency, safety, legal exposure, clinical validity, market strength, and execution realism.
- Give every agent persistent, indexed memory so the system improves across iterations instead of rediscovering the same points.
- Score every iteration with a rubric so improvement is measurable.
- Allow TypeScript/Node tools and npm packages to increase agent capabilities over time.
- Mature gradually from Codex-operable artifacts to a semi-automated and eventually orchestrated multi-agent platform.

## 2. Design Principles

1. Agents have narrow expertise and explicit ownership.
2. Every output is scored, compared to prior iterations, and archived.
3. Adversarial critique must produce a better counterplan, not only comments.
4. Senior leadership is a gate, not a rubber stamp.
5. Persistent memory is indexed by claim, decision, risk, source, iteration, and agent.
6. Legal and clinical agents flag risk and prepare counsel-ready or physician-review-ready questions, but they do not replace real licensed legal or clinical accountability.
7. The system may add tools, skills, and agents when rubric scores plateau or unresolved risks remain.
8. The first usable version is document-based and repo-native. Automation is introduced only where it improves quality or repeatability.

## 3. Maturity Ladder

### Maturity 1: Codex-Operable

The system runs through markdown artifacts, structured memory files, scorecards, and review templates. Codex can operate the loop manually inside the repo.

Capabilities:

- Agent charters.
- Per-agent memory folders.
- Indexed notes.
- Iteration packets.
- Rubric scorecards.
- Decision and risk ledgers.
- Leadership review packets.

Exit criteria:

- Agents have charters and memory structure.
- The core/adversarial/leadership loop can run at least once.
- Score deltas can be computed manually or with a simple script.

### Maturity 2: Semi-Automated

TypeScript scripts validate structure, index memory, compare iterations, and generate scorecards.

Capabilities:

- JSON schema validation.
- Markdown parsing and linting.
- Full-text search indexes.
- Score aggregation.
- Claim/source ledgers.
- Contradiction and stale-risk reports.
- Leadership packet generation.

Exit criteria:

- A single command can validate agent artifacts.
- A single command can produce an iteration scorecard.
- Memory search works across agents and prior iterations.

### Maturity 3: Orchestrated

A runtime coordinates agent tasks, memory retrieval, scoring, and review loops.

Capabilities:

- Task queue.
- Agent run records.
- Tool permission profiles.
- Internet research workflows for approved agents.
- Persistent structured storage.
- Vector and keyword retrieval.
- Automated loop control.

Exit criteria:

- The Coordinator can launch a planned iteration.
- Each agent receives relevant memory before producing output.
- The system can detect when senior leadership review is required.

### Maturity 4: Self-Improving Governance

The system evaluates its own weaknesses and proposes capability upgrades.

Capabilities:

- Agent capability audits.
- Tool and skill proposals.
- Rubric-weight tuning proposals.
- New-agent proposals.
- Deprecation of low-value agents or duplicated roles.
- Governance approvals before capability changes.

Exit criteria:

- Capability upgrades are justified by score trends or unresolved risks.
- Senior Leadership approves major changes to the agent roster, rubric, or tool permissions.

## 4. Teams And Agent Roster

### 4.1 Coordinator And Archivist Layer

These agents manage process, memory, and synthesis across all teams.

#### Agent: Chief Coordinator

Owns:

- Iteration agenda.
- Team sequencing.
- Dependency management.
- Final synthesis.
- Escalation to senior leadership.
- Decision on whether to continue, revise, or pause.

Outputs:

- Iteration brief.
- Team work orders.
- Synthesis memo.
- Final plan candidate.

#### Agent: Memory Archivist

Owns:

- Memory hygiene.
- Index updates.
- Superseded claims.
- Cross-agent links.
- Retrieval summaries.

Outputs:

- Memory index updates.
- Claim maps.
- Stale-memory reports.

#### Agent: Rubric Steward

Owns:

- Rubric scoring consistency.
- Weighting proposals.
- Score history.
- Plateau detection.

Outputs:

- Iteration scorecard.
- Score delta analysis.
- Rubric change recommendations.

#### Agent: Source Librarian

Owns:

- Source ledger.
- Source quality classification.
- Evidence debt tracking.
- Internet-research assignments for agents with approval.

Outputs:

- Source ledger.
- Evidence debt report.
- Claim-to-source matrix.

### 4.2 Core Design Team

The Core Design Team creates the constructive OpenClinXR solution approach.

#### Agent: Solution Architect

Owns system boundaries, component responsibilities, integration strategy, and implementation-readiness.

#### Agent: XR Systems Architect

Owns Quest-class headset constraints, WebXR/OpenXR strategy, rendering approach, interaction model, asset pipeline, latency, and device compatibility.

#### Agent: Clinical Simulation Lead

Owns scenario realism, simulation center workflows, standardized-patient analogs, faculty review, learner progression, and debriefing practices.

#### Agent: Psychometrics Lead

Owns Kane validity argument, G-theory, reliability, fairness, score use, rater calibration, consequence validity, and summative-readiness gates.

#### Agent: Data And Trace Architect

Owns trace schema, event taxonomy, replay model, audit export, analytics readiness, data lineage, and scenario versioning.

#### Agent: Security And Privacy Lead

Owns zero-trust architecture, role access, tenant isolation, audit logs, encryption, consent, retention, incident response, and third-party risk.

#### Agent: UX And Product Lead

Owns learner, faculty, admin, researcher, and reviewer workflows. Converts technical architecture into usable product surfaces.

#### Agent: Platform And DevOps Lead

Owns hosting, CI/CD, observability, runtime cost, scaling, performance testing, disaster recovery, and environment strategy.

#### Agent: Open Source And Governance Lead

Owns licensing, contributor rules, scenario certification, project governance, marketplace trust, provenance, and open-core boundaries.

#### Agent: Business And GTM Lead

Owns buyer segmentation, design partners, pilot packaging, pricing assumptions, procurement path, competitive wedge, and expansion sequencing.

#### Agent: Legal And Regulatory Counsel

Owns legal issue spotting across corporate, education, healthcare, AI, medical-device, liability, contract, procurement, and cross-border risks.

Important boundary:

- This agent prepares legal questions and risk analysis.
- It does not provide final legal advice.
- Any high-impact legal decision requires outside licensed counsel.

#### Agent: Healthcare Compliance Counsel

Owns FERPA, HIPAA-adjacent posture, BAAs, learner records, consent, privacy notices, data retention, institutional security review, and auditability.

#### Agent: IP And Open-Source Counsel

Owns copyright, licensing, contributor agreements, model and avatar asset provenance, scenario ownership, marketplace IP, and commercial use of open assets.

### 4.3 Physician Specialty Panel

The Physician Specialty Panel validates specialty realism, safety, escalation paths, learner behaviors, scoring implications, and scenario fit.

Each physician agent has persistent memory and can be called into Core, Adversarial, or Senior Leadership review depending on the iteration focus.

Initial specialty agents:

- Emergency Medicine Physician.
- Internal Medicine Physician.
- Family Medicine Physician.
- Pediatrics Physician.
- OB/GYN Physician.
- Psychiatry Physician.
- Surgery Physician.
- Anesthesiology And Critical Care Physician.
- Radiology And Imaging Physician.
- Neurology Physician.

Shared outputs:

- Specialty scenario opportunities.
- Specialty-specific safety traps.
- Workflow and escalation critique.
- Required clinical disclaimers.
- Scoring caveats.
- Faculty-review requirements.
- Pilot-specialty recommendations.

Specialty selection rule:

- All broad platform plans receive at least Emergency Medicine, Internal Medicine, Psychiatry, Surgery, and Pediatrics review.
- Scenario-specific plans receive review from the relevant specialty plus at least one adjacent specialty.
- Any high-risk scenario involving children, pregnancy, suicide risk, violence, consent, sedation, imaging, or invasive procedures requires the corresponding specialty review before senior approval.

### 4.4 Adversarial Challenge Team

The Adversarial Team attacks the Core Design Team plan and produces a stronger competing plan.

#### Agent: Red-Team Coordinator

Owns adversarial agenda, attack assignment, and counterplan synthesis.

#### Agent: Feasibility Skeptic

Attacks engineering complexity, sequencing, dependency risk, and implementation assumptions.

#### Agent: Clinical Safety Critic

Attacks unsafe clinical assumptions, scenario hazards, misleading feedback, escalation failures, and faculty oversight gaps.

#### Agent: Psychometric Overclaim Critic

Attacks score validity, fairness, reliability, hidden facets, bad extrapolations, and premature summative language.

#### Agent: Security And Privacy Attacker

Attacks threat model, role leakage, consent gaps, tenant isolation, third-party APIs, audit holes, and incident-response weaknesses.

#### Agent: Cost And Performance Attacker

Attacks latency, cloud cost, model cost, asset budget, headset performance, staffing, and operational economics.

#### Agent: Procurement And GTM Critic

Attacks buyer assumptions, procurement friction, pilots, pricing, renewal logic, and institutional adoption barriers.

#### Agent: Open-Source Sustainability Critic

Attacks contributor quality, fork risk, governance fragility, support burden, marketplace trust, and open-core monetization.

#### Agent: Competitor And Fork Strategist

Attacks competitive positioning, incumbent response, low-cost fork risk, regional competition, and platform displacement.

#### Agent: UX Friction Critic

Attacks workflow complexity, cognitive load, accessibility, faculty burden, learner trust, and adoption friction.

#### Agent: Legal Liability Attacker

Attacks malpractice framing, regulated claims, contract risk, IP contamination, privacy exposure, employment/education law exposure, and procurement claims.

#### Agent: Specialty Clinical Attackers

Selected physician agents from the Specialty Panel attack whether the plan generalizes beyond the first wedge while preserving specialty-specific safety and workflow differences.

### 4.5 Senior Leadership Team

Senior Leadership reviews Core and Adversarial outputs, forces tradeoffs, and sends the plan back for revision until approval criteria are met.

#### Agent: CEO And Strategy Chair

Owns strategic clarity, market wedge, capital story, sequencing, and organizational focus.

#### Agent: CTO

Owns technical feasibility, architecture simplicity, staffing realism, build sequencing, and platform risk.

#### Agent: Chief Medical Education Officer

Owns education value, faculty trust, learner benefit, simulation-center fit, and clinical training realism.

#### Agent: Chief Psychometrician

Owns defensible assessment posture, score interpretation, validation gates, rater process, and consequence validity.

#### Agent: Chief Security And Privacy Officer

Owns enterprise security, privacy posture, threat model, auditability, compliance readiness, and third-party risk.

#### Agent: General Counsel

Owns legal exposure, counsel-ready questions, claim discipline, contracts, procurement risk, IP, and regulatory boundaries.

#### Agent: Chief Compliance Officer

Owns FERPA/HIPAA-adjacent controls, institutional security review, retention, consent, data residency, and audit governance.

#### Agent: Chief Medical Officer

Owns patient-safety posture, clinical realism, physician acceptance, and clinical escalation guardrails.

#### Agent: Specialty Advisory Board Chair

Owns cross-specialty coherence and decides which specialty agents must review each iteration.

#### Agent: CFO And Operations Lead

Owns budget, unit economics, headcount, cloud/model cost, pilot economics, margin path, and operational practicality.

#### Agent: Product And Growth Executive

Owns product packaging, design partner value, adoption friction, user segmentation, onboarding, and retention.

#### Agent: External Academic Advisor

Owns academic credibility, study design practicality, faculty incentives, publication path, and institutional trust.

#### Agent: Investor And Board Skeptic

Owns venture-scale plausibility, kill criteria, defensibility, risk-adjusted return, and opportunity cost.

#### Agent: Rotating Specialty Physician Reviewer

Selected from the Specialty Panel based on the current plan's scenario or product focus.

## 5. Persistent Memory Model

Each agent receives a durable folder:

```text
agents/<team>/<agent-id>/
  charter.md
  memory.md
  index.json
  notes/
  critiques/
  decisions/
  sources/
  score-history.json
```

### 5.1 Charter

The charter defines:

- Mission.
- Domain boundaries.
- Required outputs.
- Decision rights.
- Escalation triggers.
- Memory update rules.
- Tool permissions by maturity level.

### 5.2 Memory

The `memory.md` file stores human-readable long-form memory:

- Durable lessons.
- Prior conclusions.
- Known risks.
- Preferred design patterns.
- Open questions.
- Agent-specific heuristics.

### 5.3 Index

The `index.json` file stores machine-readable pointers:

```json
{
  "agent_id": "psychometrics-lead",
  "team": "core",
  "last_updated": "2026-05-02",
  "entries": [
    {
      "id": "claim-0001",
      "type": "claim",
      "topic": "summative-readiness",
      "summary": "Summative claims require Kane argument, G-study, fairness review, and external review.",
      "confidence": 0.86,
      "source_ids": ["src-standards-educational-testing", "src-cook-hatala-2016"],
      "iteration": 1,
      "status": "active",
      "supersedes": []
    }
  ]
}
```

### 5.4 Notes

Notes are iteration-specific working records:

```text
notes/iteration-0001.md
notes/iteration-0002.md
```

### 5.5 Critiques

Critiques preserve review comments and adversarial attacks:

```text
critiques/iteration-0001-core-plan.md
critiques/iteration-0001-counterplan.md
```

### 5.6 Decisions

Decision records preserve accepted or rejected choices:

```text
decisions/decision-0001-use-quest-class-baseline.md
```

Decision records include:

- Context.
- Decision.
- Alternatives.
- Rationale.
- Consequences.
- Reversal trigger.
- Linked rubric dimensions.

### 5.7 Sources

Source records preserve evidence:

```text
sources/source-0001.md
```

Source records include:

- Citation.
- URL or file path.
- Access date.
- Source tier.
- Permitted use.
- Claims supported.
- Claims not supported.
- Confidence.

## 6. Iteration Artifacts

Each iteration creates a packet:

```text
iterations/iteration-0001/
  00-brief.md
  01-core-plan.md
  02-core-scorecard.json
  03-adversarial-counterplan.md
  04-adversarial-scorecard.json
  05-core-revision.md
  06-leadership-review.md
  07-final-synthesis.md
  08-memory-update-log.md
```

### 6.1 Iteration Brief

Defines:

- Iteration objective.
- Source artifacts to use.
- Agents activated.
- Constraints.
- Rubric weights.
- Required outputs.

### 6.2 Core Plan

Constructive plan from Core Design Team.

Required sections:

- Problem framing.
- Proposed approach.
- Architecture.
- Clinical and educational model.
- Psychometric model.
- Data and trace model.
- Security/privacy model.
- Legal/compliance model.
- UX and workflow model.
- Business/GTM model.
- Open risks.
- Next decisions.

### 6.3 Adversarial Counterplan

Required sections:

- Attack summary.
- High-severity holes.
- Better competing approach.
- Specific replacements or revisions.
- Risks the Core Team missed.
- Specialty objections.
- Legal/compliance objections.
- Evidence debt.
- Decision debt.

### 6.4 Leadership Review

Required sections:

- Approval status.
- Required revisions.
- Optional improvements.
- Deferred issues.
- Kill criteria.
- Readiness judgment.

## 7. Rubric

Each output is scored from 0 to 5.

Score meanings:

- 0: Missing or dangerous.
- 1: Present but weak, vague, or misleading.
- 2: Partially useful but materially incomplete.
- 3: Adequate for early planning.
- 4: Strong and actionable.
- 5: Excellent, defensible, and ready for the next maturity gate.

### 7.1 Dimensions

1. Clinical Validity

Measures whether the plan avoids unsafe or unsupported clinical education claims and preserves human oversight.

2. Psychometric Defensibility

Measures whether validity, reliability, fairness, rater calibration, score use, and consequence claims are properly gated.

3. Technical Feasibility

Measures whether the plan could plausibly be built with the selected stack, team, time, and device constraints.

4. Architecture Coherence

Measures whether components, data flow, APIs, responsibilities, and boundaries fit together cleanly.

5. Security And Privacy

Measures whether access control, tenant isolation, consent, retention, audit, encryption, incident response, and third-party risk are handled.

6. UX And Workflow Fit

Measures whether the design fits learners, faculty, admins, researchers, reviewers, simulation centers, and institutional buyers.

7. Cost And Performance Efficiency

Measures runtime cost, model cost, cloud cost, asset cost, headset performance, latency, and staffing realism.

8. Open-Source Sustainability

Measures governance, licensing, contribution quality, fork risk, marketplace trust, support burden, and open-core value capture.

9. Market And GTM Strength

Measures buyer clarity, pilot motion, procurement path, wedge strength, pricing assumptions, renewal logic, and competitive positioning.

10. Evidence Discipline

Measures source quality, claim boundaries, distinction between fact/inference/hypothesis, and source-use compliance.

11. Implementation Readiness

Measures whether the plan can later become a concrete implementation plan with sequenced milestones, dependencies, and acceptance criteria.

12. Adversarial Robustness

Measures whether the plan survived serious attacks and incorporated the strongest objections.

13. Legal And Regulatory Resilience

Measures whether the plan avoids preventable legal exposure, unsupported regulated claims, weak consent posture, IP risk, contract risk, and procurement assumptions.

14. Specialty Clinical Generalizability

Measures whether the plan can extend beyond one use case while preserving specialty-specific safety, workflow, and scoring differences.

### 7.2 Default Weights

Default weights total 100:

```json
{
  "clinical_validity": 10,
  "psychometric_defensibility": 10,
  "technical_feasibility": 9,
  "architecture_coherence": 7,
  "security_privacy": 9,
  "ux_workflow_fit": 7,
  "cost_performance_efficiency": 7,
  "open_source_sustainability": 5,
  "market_gtm_strength": 6,
  "evidence_discipline": 8,
  "implementation_readiness": 6,
  "adversarial_robustness": 5,
  "legal_regulatory_resilience": 6,
  "specialty_clinical_generalizability": 5
}
```

Weighting can change per iteration, but changes must be recorded by the Rubric Steward and approved by the Chief Coordinator. Major rubric changes require Senior Leadership approval.

### 7.3 Output Metrics

Every scorecard includes:

- Composite score.
- Weighted score.
- Dimension scores.
- Delta from prior iteration.
- Highest regressions.
- Highest improvements.
- Critical risks.
- Evidence debt.
- Decision debt.
- Confidence score.
- Leadership readiness status.

### 7.4 Improvement Rules

An iteration is improving if:

- Composite score increases or remains stable while critical risks decrease.
- No high-weight dimension regresses by more than 0.3 without explanation.
- Evidence debt decreases or is explicitly reclassified.
- Decision debt decreases or is moved into a documented deferred-decision list.
- Adversarial robustness increases after challenge cycles.

An iteration is plateauing if:

- Composite score changes by less than 0.1 for two consecutive loops.
- The same critical risk appears in three consecutive loops.
- Evidence debt remains unchanged for two consecutive loops.
- Senior Leadership repeats the same rejection reason.

Plateau response:

1. Identify stuck dimensions.
2. Add or activate specialist agents.
3. Add tools or skills.
4. Update research assignments.
5. Narrow the plan scope if needed.

### 7.5 Senior Approval Threshold

The plan can be considered senior-approved only when:

- Weighted score is at least 4.5 out of 5.
- No critical unresolved risks remain.
- Legal and regulatory resilience is at least 4.3.
- Specialty clinical generalizability is at least 4.2.
- Clinical validity is at least 4.5.
- Psychometric defensibility is at least 4.5.
- Evidence debt is below the iteration-defined threshold.
- Decision debt is limited to explicitly deferred items.
- At least two consecutive iterations have non-negative score movement.
- Senior Leadership majority approves.
- General Counsel, Chief Medical Education Officer, Chief Psychometrician, and Chief Security And Privacy Officer do not block approval.

## 8. Operating Loop

### 8.1 Standard Loop

1. Chief Coordinator creates iteration brief.
2. Memory Archivist retrieves relevant memory.
3. Source Librarian attaches source and evidence context.
4. Core Design Team produces Plan vN.
5. Rubric Steward scores Plan vN.
6. Adversarial Challenge Team attacks Plan vN.
7. Adversarial Challenge Team produces Counterplan vN.
8. Rubric Steward scores Counterplan vN.
9. Core Design Team incorporates valid objections into Plan vN+1.
10. Rubric Steward compares score deltas.
11. Coordinator decides whether to iterate, add capabilities, or escalate.
12. Senior Leadership reviews when threshold conditions are close or when blockers persist.
13. Required revisions are returned to Core and Adversarial teams.
14. Memory Archivist updates memory and index records.

### 8.2 Capability Upgrade Loop

Agents may propose new capabilities when:

- A rubric dimension plateaus.
- A required source class is missing.
- A specialty scenario exposes a knowledge gap.
- Legal or compliance risk cannot be resolved with existing expertise.
- Manual work becomes repetitive and error-prone.
- The same unresolved issue appears across multiple iterations.

Capability proposal format:

- Problem.
- Proposed agent, skill, or tool.
- Expected rubric improvement.
- Risks or costs.
- Owner.
- Maturity level.
- Acceptance criteria.

### 8.3 Internet Access Policy

Internet access is allowed for designated agents at Maturity 2 and above, or manually by Codex at Maturity 1 when current facts are needed.

Agents requiring internet access:

- Source Librarian.
- Business And GTM Lead.
- Legal And Regulatory Counsel.
- Healthcare Compliance Counsel.
- IP And Open-Source Counsel.
- Competitor And Fork Strategist.
- Chief Compliance Officer.
- General Counsel.
- Investor And Board Skeptic.
- Specialty physicians when validating current specialty standards or guidelines.

Rules:

- Current or unstable claims must be verified.
- Source tier and permitted use must be recorded.
- Vendor claims may support capability presence but not validation, regulatory, or market-demand conclusions by themselves.
- Legal and clinical sources should be treated as issue-spotting context unless reviewed by qualified human experts.

## 9. TypeScript/Node Capability Layer

The TypeScript/Node layer adds repeatability and scale without building OpenClinXR itself.

### 9.1 Initial Scripts

Proposed scripts:

```text
tools/agent-factory/
  validate-artifacts.ts
  build-memory-index.ts
  score-iteration.ts
  compare-iterations.ts
  generate-leadership-packet.ts
  find-stale-risks.ts
  find-evidence-debt.ts
  check-source-ledger.ts
```

### 9.2 Package Categories

Exact packages should be chosen at implementation time after checking current versions. Useful categories:

- TypeScript runtime and build tooling.
- JSON schema validation.
- Markdown parsing.
- Frontmatter parsing.
- Full-text search indexing.
- Vector search or embedding storage.
- Graph analysis.
- Table/report generation.
- CLI command framework.
- Test runner.

### 9.3 Capability Boundaries

Scripts should:

- Validate structure.
- Aggregate scores.
- Detect stale risks.
- Build indexes.
- Generate reports.
- Compare iterations.

Scripts should not:

- Decide clinical truth.
- Decide legal compliance.
- Invent evidence.
- Override Senior Leadership blocks.
- Turn planning artifacts into product code without a separate approved implementation plan.

## 10. File And Artifact Structure

The repo should eventually contain:

```text
docs/
  superpowers/
    specs/
      2026-05-02-openclinxr-agent-factory-design.md
  agent-factory/
    README.md
    maturity-model.md
    operating-loop.md
    rubric.md
    source-policy.md
    leadership-gates.md

agents/
  coordinator/
  core/
  adversarial/
  leadership/
  physicians/
  legal/

iterations/
  iteration-0001/

schemas/
  agent-charter.schema.json
  agent-index.schema.json
  scorecard.schema.json
  source-record.schema.json
  decision-record.schema.json

tools/
  agent-factory/
```

At the current design stage, only the design spec is required. The rest should be created in the implementation planning stage after user review.

## 11. First Usable Version

The first usable version should create enough structure to run Iteration 1 manually:

1. Agent roster and charters.
2. Memory folders and index templates.
3. Rubric and scorecard template.
4. Iteration packet template.
5. Leadership review template.
6. Source ledger template.
7. Decision/risk ledger template.
8. Basic TypeScript validation and scoring scripts if approved for Maturity 2.

Iteration 1 objective:

- Convert the existing OpenClinXR architecture and business-plan artifacts into a consolidated MVP approach.
- Identify the first product wedge, first two scenarios, trace schema priorities, faculty workflow, validation gates, legal/compliance posture, and pilot plan.
- Produce a scorecard and adversarial counterplan.
- Send the revised plan to Senior Leadership only after the Core and Adversarial loop produces measurable improvement.

## 12. Risks In The Agent Factory Design

### Risk: Too many agents create process drag

Mitigation:

- Activate only relevant agents per iteration.
- Keep a required minimum roster.
- Use Specialty Panel agents on demand.

### Risk: Agents produce confident but unsupported claims

Mitigation:

- Evidence Discipline rubric.
- Source Librarian.
- Source-use policy.
- Evidence debt ledger.

### Risk: Adversarial team becomes performative

Mitigation:

- Require a competing counterplan.
- Score adversarial output separately.
- Reward replacements, not only objections.

### Risk: Senior Leadership slows progress

Mitigation:

- Escalate only when threshold is close, critical risks persist, or major tradeoffs require governance.
- Separate blocking revisions from optional improvements.

### Risk: Legal and physician agents are mistaken for real professional advice

Mitigation:

- Keep explicit boundaries.
- Require outside counsel for high-impact legal choices.
- Require qualified human physician review for clinical scenario release or validation claims.

### Risk: Tooling becomes a distraction

Mitigation:

- Tool proposals must map to stuck rubric dimensions.
- Build only scripts that improve repeatability or reduce error.
- Keep product implementation out of scope until a separate plan is approved.

## 13. Acceptance Criteria For This Design

The design is acceptable when:

- The three-team structure is clear.
- Legal and specialty physician roles are first-class.
- Persistent memory is concrete and indexable.
- Iteration artifacts are defined.
- Rubric dimensions and thresholds are measurable.
- TypeScript/Node capabilities are included without prematurely building OpenClinXR.
- The maturity ladder supports growth over time.
- The design can become an implementation plan after user review.

## 14. Open Decisions For The Implementation Plan

These should be resolved in the next planning phase:

1. Whether to create all agent charters immediately or start with a minimum viable roster.
2. Whether TypeScript tooling begins in Maturity 1 or waits until Maturity 2.
3. Whether memory search should start as keyword-only or include vector search.
4. Which source classes require live internet verification in Iteration 1.
5. Which physician specialties are mandatory for the first MVP scenario set.
6. Whether score thresholds should be stricter before any external-facing business plan is produced.
