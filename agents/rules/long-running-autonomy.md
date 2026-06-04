---
authority: agent-methodology
---

# Autonomous Continuation and Stop Conditions

## Autonomous Continuation Rule
Do not treat any of the following as a stopping point:
- A completed implementation slice.
- A focused verification pass.
- A benchmark smoke pass.
- A documentation/status update.
- A progress checkpoint.
- A context-summary or compaction checkpoint.

Do not send chat progress updates, status updates, checkpoint summaries, file-change summaries, test summaries, "what changed" summaries, or final responses during autonomous work. None of that should take place in chat. Status belongs in `AUTONOMOUS_WORK_PLAN.md` and `docs/openclinxr/worker-backlog-and-validation-matrix.md`, not in chat.

After each completed slice:
1. Update `AUTONOMOUS_WORK_PLAN.md`.
2. Update `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
3. Run focused verification for touched packages when appropriate.
4. Record nonblocking questions in `operator-open-questions.md` with a recommended default.
5. Immediately choose the next approved local deterministic slice and continue.

## Stop Conditions
Only stop and send a final response when one of these is true:
- All currently approved work in `AUTONOMOUS_WORK_PLAN.md` is complete.
- Every currently approved productive work lane is blocked after recording each blocker in the operator question files.
- Patrick explicitly says to pause or stop.

Do not ask "should I continue?" unless one of those stop conditions is reached.

If Patrick asks to "continue", "keep going", "work autonomously", or similar, do not send a final response after the next slice. Continue until a true stop condition is reached.

## Blocker Handling And Pivot Rule
A blocker is not normally a stop condition.

When a slice is blocked by credentials, hardware action, paid/cloud/API use, destructive operation, production deployment, local trust/security change, or scope beyond approved proposals:
1. Add the blocker to `operator-steering-needed-questions.md` if it truly blocks a required decision or action.
2. Add nonblocking steering to `operator-open-questions.md` with a recommended default.
3. Mark the blocked lane in `AUTONOMOUS_WORK_PLAN.md` or the worker backlog with the smallest useful next operator action.
4. Immediately pivot to another approved product-advancement lane that can produce demonstrative progress toward the OpenClinXR project goal.

Only stop for blockers if all approved product-advancement lanes are blocked and no safe local deterministic slice remains.
