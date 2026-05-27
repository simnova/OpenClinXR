# Faculty Review Decision Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a review-safe faculty decision handoff panel to the completed-station Review Replay workbench.

**Architecture:** Keep `App.tsx` thin by introducing a focused `FacultyReviewDecisionPanel` that derives a local review posture from already-loaded replay, safety, and durable-event summaries. The panel is read-only, summary-only, and avoids score-use, clinical-validity, Quest, provider, or production-readiness claims.

**Tech Stack:** React, TypeScript, Ant Design, Vitest/Testing Library, pnpm workspace filters.

---

### Task 1: Add the focused decision handoff component

**Files:**
- Create: `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`

- [x] Create `FacultyReviewDecisionPanel.tsx` with props for `packet`, optional `clinicalEventReviewSummary`, `traceEventCount`, and `safetyFlagLabels`.
- [x] Derive one of three postures in explicit rule order: blocked by missing evidence, needs scenario iteration, ready for faculty debrief.
- [x] Render summary-only reasons and next actions without raw clinical-event payloads.

### Task 2: Mount the component in Review Replay

**Files:**
- Modify: `apps/ui-admin/src/App.tsx`

- [x] Import `FacultyReviewDecisionPanel`.
- [x] Render it after the existing review-safe evidence boundary for every loaded review packet.
- [x] Pass existing packet, clinical-event summary, trace-event count, and safety labels.

### Task 3: Extend focused UI coverage

**Files:**
- Modify: `apps/ui-admin/src/App.test.tsx`

- [x] Add assertions to the existing review replay test for the new panel heading, derived posture, summary-only durable evidence wording, and missing-behavior next action.

### Task 4: Verify and document

**Files:**
- Modify: `AUTONOMOUS_WORK_PLAN.md`
- Modify: `docs/openclinxr/worker-backlog-and-validation-matrix.md`

- [x] Run `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`.
- [x] Run `pnpm --filter @openclinxr/ui-admin typecheck`.
- [x] Record product impact, touched files, alignment guard, and focused verification results.

