# Station-environment capture render cause (one case)

Instrument-only. The wait-name + three-way pageDiagnostics bag landed;
this file records what they said on one real capture, not a repair.

- caseId: `ed_chest_pain_priority_v2`
- tree: `71762e2e034c82e4e227e615db0f617f0e89ea1e`
- startedAt: 2026-09-12T03:48:17.352Z
- finishedAt: 2026-09-12T03:48:18.621Z
- command: `captureStationEnvironmentRooms({ scenarioIds: [ed_chest_pain_priority_v2] })` via `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`
- outcome: other-error
- wait that fired: (none — rethrowNamedWaitTimeout only prefixes Timeout)
- classification: wait-predicate reference error (browserPageWindow types-only alias)
- pageErrors: (none)
- console: (none)
- failedRequests: (none)

## Discriminator

Timeout bag (page-diagnostics.ts): pageErrors.length > 0 → page exception;
else failedRequests.length > 0 → failed request;
else all three lists empty → unresponsive main thread or silent page;
else → console output.

Predicate-error class (this run): Playwright `page.waitForFunction` throws
`ReferenceError: browserPageWindow is not defined` on the first eval.
`browserPageWindow` is types-only (`tools/openclinxr/evidence/browser-dom.d.ts`).
Sibling measured 2026-09-11: `model-vetting-glb-grade-capture.ts` switched the
same closure to `globalThis` for that reason. `rethrowNamedWaitTimeout` does
not decorate this path because the message does not include `Timeout`.
The 2026-09-03 rollup's 180 s Timeout is therefore a different (older) class;
on this tree the render station never reaches a wait budget.

## Full error / completion message

```
page.waitForFunction: ReferenceError: browserPageWindow is not defined
    at eval (eval at predicate (eval at evaluate (:302:30)), <anonymous>:1:18)
    at predicate (eval at evaluate (:302:30), <anonymous>:7:23)
    at next (eval at evaluate (:302:30), <anonymous>:29:29)
    at eval (eval at evaluate (:302:30), <anonymous>:42:9)
    at UtilityScript.evaluate (<anonymous>:304:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
```

claimScope: which diagnostic class stopped this one case's station-environment capture.
notEvidenceFor: the fix for that class; the other fourteen cases; wait budgets; the rollup.

CLAIM: one live capture of ed_chest_pain_priority_v2 classified as wait-predicate reference error (browserPageWindow types-only alias) (wait=none).
NOT TESTED: the fix; the other fourteen cases.

## MEASURED AFTER THE FIX — 2026-09-12 (orchestrator, foreground run)

- command: `pnpm exec tsx tools/openclinxr/evidence/ui-xr-environment-room-capture.ts --scenario ed_chest_pain_priority_v2`
- tree: this branch at db5f2bbe (wait predicates on `globalThis`)
- startedAt: 2026-09-12T04:08:44Z
- finishedAt: 2026-09-12T04:11:46Z (3 m 02 s)
- outcome: timed_out_at_budget
- thrown: `station shell wait timed out: page.waitForFunction: Timeout 180000ms exceeded.`
- pageDiagnostics classification: page exception
- pageErrors: `Module "node:crypto" has been externalized for browser compatibility. Cannot access "node:crypto.createHash" in client code.`
- console: (none)
- failedRequests: (none)

The ReferenceError is gone: the run reaches `goto` and then the page's own exception. The 180-second
timeout is now DIAGNOSED rather than bare — the shell is never published because the page throws on
`node:crypto.createHash` before it can publish.

CLAIM: on this tree, one capture of ed_chest_pain_priority_v2 fails as a page exception naming
`node:crypto.createHash`, and the wait then burns its full 180 s budget.
NOT TESTED: the other fourteen cases; whether removing that import lets the shell publish; the rollup.

## FIXED (#0) — 2026-09-12 (served client graph)

The page exception names `node:crypto.createHash` because
`packages/openclinxr/asset-registry/src/encounter-bundle-admission-mod.ts`
value-imported `node:crypto` and `scene-plan-freeze-mod` (which imports
`node:crypto` + `node:fs`). `apps/ui-xr/src/main.ts` imports
`@openclinxr/asset-registry/encounter-bundle-admission`, so Vite served that
graph to the learner client.

The admission module now hashes through browser-safe `canonical-json.ts` and
`sha256-hex.ts`. `verifyCommittedScenePlanAgainstDisk` remains a VALUE export
of `./encounter-bundle-admission`. The freeze subpath still uses `node:crypto`.

claimScope: the served ui-xr import graph no longer reaches a `node:` builtin.
notEvidenceFor: the other fourteen cases; the 15-case rollup; wait budgets;
that a capture now publishes a shell.

CLAIM: the served client graph from apps/ui-xr/src/main.ts reaches no node: builtin.
NOT TESTED: the other fourteen cases; whether the rollup's render lane clears once this is fixed.

## MEASURED AFTER THE CLIENT-GRAPH FIX — 2026-09-12 (orchestrator, foreground run)

- command: `pnpm exec tsx tools/openclinxr/evidence/ui-xr-environment-room-capture.ts --scenario ed_chest_pain_priority_v2`
- startedAt: 2026-09-12T04:28:57Z
- finishedAt: 2026-09-12T04:29:17Z (20 s)
- exit code: 0
- outcome: shell_wait_resolved
- artifact: `.openclinxr/evidence/ui-xr-environment-room/latest/capture-manifest.json` (1 entry)
- live line: `ed_chest_pain_priority_v2 live env=ed_exam_bay_v1 depth=3.45 floor=5858155 cam=roomCam(derived)=-1.26,1.71,1.87 nearestActor=1.06m interiorMaxZ=2.11 wallThickness=0.118`

The same case that burned its full 180-second budget before this fix now completes in 20 seconds and
writes a manifest. The shell publishes; the wait no longer fires.

CLAIM: one capture of ed_chest_pain_priority_v2 resolves and writes one manifest entry on this tree.
NOT TESTED: the other fourteen cases; the 15-case rollup's render lane; any judgement about how the
captured room looks.
