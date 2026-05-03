# Claims, Consent, And Privacy Governance

Date: 2026-05-03
Status: Development handoff draft

## Claims Registry

Every external-facing claim should map to a source record or internal evidence artifact.

Allowed planning claims:

- OpenClinXR is designing a clinical skills station sequence inspired by public historical Step 2 CS structure.
- OpenClinXR supports multi-actor virtual clinical scenarios, human review, trace replay, and formative/local assessment workflows.
- OpenClinXR can use LLMs to draft scenarios and power bounded virtual actors after review and audit controls.

Blocked claims:

- Equivalent to Step 2 CS.
- Endorsed by USMLE, ECFMG, NBME, AMA, or any board unless a future agreement exists.
- Licensure-ready.
- Validated for high-stakes pass/fail decisions.
- Replacement for standardized patient programs.
- Autonomous physician competency certification.

## Consent Matrix

Consent dimensions:

| Consent item | Default | Required for |
| --- | --- | --- |
| Use synthetic scenario | On | All stations |
| Record trace events | On | Review, scoring, debrief |
| Record audio | Off until enabled | Speech replay and ASR QA |
| Record video/avatar replay | Off until enabled | Faculty review and debrief |
| Use data for product analytics | Off until tenant enables | Product improvement |
| Use de-identified data for research | Off | IRB or institutional research |
| Use learner data for model training | Off | Must require explicit approval and vendor review |

The learner should not be allowed to start an exam session unless mandatory trace recording consent is accepted for the relevant tenant policy.

## Privacy Defaults

- Use synthetic patients only.
- Do not ingest real patient records.
- Store tenant ID on all learner/session/review records.
- Separate authored hidden truth from learner-visible state.
- Encrypt secrets outside source control.
- Retain LLM audit events because they are required for review and safety investigation.
- Redact or minimize audio/video exports by default.
- Support tenant-configurable retention windows.

## Access-Control Roles

Suggested roles:

- `learner`: can take assigned sessions and view released debriefs.
- `faculty_reviewer`: can review assigned station traces and submit rubric scores.
- `scenario_author`: can draft scenarios and request review.
- `clinical_reviewer`: can approve or reject clinical content.
- `psychometric_reviewer`: can approve or reject blueprint/rubric/coverage.
- `legal_reviewer`: can approve or reject claims, IP, and compliance status.
- `tenant_admin`: can manage users, assignments, and retention policies.
- `system_admin`: can manage platform configuration without clinical score alteration.

## Audit Events

Minimum audit events:

- Scenario draft generated.
- Source retrieved.
- Scenario review submitted.
- Scenario approved/rejected.
- Exam form activated.
- Exam session started/ended.
- Station phase transition.
- Actor response generated.
- Guardrail blocked response.
- Faculty score submitted.
- Feedback released.
- Data export requested.

## Threat Model Seeds

Initial threats:

- Prompt injection by learner to reveal hidden truth.
- Actor dialogue drift changing station difficulty.
- Speech attribution error assigning family statement to patient.
- Unauthorized faculty access across tenants.
- Over-retention of audio/video.
- External marketing claim exceeds evidence.
- Scenario generator creates content too close to copyrighted or confidential exam content.

Initial mitigations:

- Actor schemas and disclosure rules.
- Guardrail cell and fallback response.
- Tenant-scoped queries and tests.
- Claims registry.
- Source ledger.
- Retention policy.
- Human review gates.
- LLM audit events.

## Deployment Gate

Before any external pilot, require:

- Claims registry approved.
- Consent matrix approved.
- Retention schedule approved.
- Data-flow appendix approved.
- Tenant isolation tests passing.
- Legal/compliance review complete.
