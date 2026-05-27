# Faculty Review Decision Panel Design

Date: 2026-05-21

## Goal

Advance the Worker 7/8 completed-station faculty/admin review lane by adding a small review-safe decision handoff surface for completed-station replay. The panel should help faculty and operators decide whether a replay is ready for debrief, needs scenario iteration, or is blocked by missing review evidence.

This is a product-advancement slice, not an evidence refresh. It uses already available replay, safety, durable-event, and scenario-review summaries.

## Scope

Build a read-only admin UI surface for the Review Replay workbench.

In scope:

- Show a concise review posture derived from existing review-safe data.
- Summarize why that posture was chosen.
- Highlight missing required behaviors, unsafe or late signals, redacted durable clinical-event status counts, and available replay/timeline evidence.
- Preserve existing scenario status, score-use, and faculty-review gates.
- Keep raw/private clinical-event payloads out of the UI.
- Keep `App.tsx` thin by using a focused component and local helper logic.

Out of scope:

- Persisting reviewer decisions.
- Adding new API/runtime wiring for durable clinical events.
- Adding scoring, clinical validity, USMLE/ECFMG equivalence, licensure, diagnosis, or high-stakes readiness claims.
- Refreshing Quest, IWSDK, provider, voice, model, or benchmark evidence.
- Enabling cloud, paid APIs, live providers, production deployment, Redis/Redka, WebTransport, QUIC, Web3, Colyseus, or new production dependencies.

## Recommended Approach

Add a focused `FacultyReviewDecisionPanel` in `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx` and mount it in the existing Review Replay workbench.

The panel derives one of three local review postures:

- `Ready for faculty debrief`: replay evidence exists, durable-event summaries are review-safe, and no blocking safety/missing-behavior signals dominate the packet.
- `Needs scenario iteration`: replay exists but missing behaviors, safety flags, late signals, or scenario-review gaps suggest faculty should revise the scenario before learner use.
- `Blocked by missing evidence`: replay/timeline/durable summary evidence is absent or insufficient for a useful faculty handoff.

The panel should use simple, explicit rule ordering rather than an abstract scoring engine. This keeps the surface auditable for future agents and prevents accidental score-use claims.

## Data Flow

Inputs should come from data already available to the Review Replay route, especially:

- Timeline/replay evidence counts.
- Trace metadata event counts.
- Missing required behavior summaries.
- Safety flags and late/unsafe signal indicators.
- Clinical-event review summary, including durable status counts and redaction posture.
- Scenario status and review-gate posture when already available in the route.

The panel should render only summary fields and counts. It must not display raw actor turns, private clinical-event payloads, hidden-fact canaries, or unredacted notes.

## Component Boundaries

Use a focused component with intention-revealing props rather than expanding `App.tsx` logic.

Expected files:

- `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`
- `apps/ui-admin/src/App.tsx`
- `apps/ui-admin/src/App.test.tsx`

Optional only if needed:

- A focused test file for the new panel if the existing app test becomes too broad.

Do not introduce a generic review-decision framework until there are multiple concrete decision surfaces.

## Error And Empty-State Handling

The panel should degrade safely:

- Missing replay summary: show `Blocked by missing evidence`.
- Missing durable clinical-event summary: show that durable event evidence is not attached, without treating absence as production failure.
- Safety/missing-behavior signals present: prefer `Needs scenario iteration` over readiness language.
- Partial data: show what is known, state what is absent, and avoid confidence language.

## Testing

Focused verification after implementation:

- `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`
- `pnpm --filter @openclinxr/ui-admin typecheck`

If a separate component test is added, include it in the focused test command.

## Documentation Updates

After implementation, update:

- `AUTONOMOUS_WORK_PLAN.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`

The update should state the product advancement, touched files, alignment guard, and focused verification result.

## Risks And Guards

Risk: the panel could imply scoring or exam validity.
Guard: use faculty-review, debrief, and scenario-iteration language only.

Risk: raw clinical payloads could leak into review UI.
Guard: render counts/statuses/summaries only and reference redaction posture.

Risk: `App.tsx` could grow harder for future agents to reason about.
Guard: keep decision logic in a focused component/helper.

Risk: the work could drift into evidence refresh or production readiness claims.
Guard: do not refresh external/runtime evidence and do not alter readiness gates.

## Approval State

Patrick approved continuing with the Worker 7/8 faculty/admin completed-station review lane and the review-safe decision/readiness surface design in chat on 2026-05-21.
