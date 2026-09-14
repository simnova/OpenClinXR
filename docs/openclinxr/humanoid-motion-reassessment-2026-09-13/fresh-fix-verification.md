I’ll re-read the current payloads, planted test, README, and validation runs — not the earlier copies — then check the remaining READY conditions.**READY FOR PREPARED IDLE CARD + RECEIVING AGENT INGESTION.** Not permission to Plant or dispatch. I did not mutate repo or board. I did not re-run Vitest; counts below are from the recorded `final-*-validation.txt` files.

## Verified current artifacts

Three create payloads are byte-equal (`parentId: tsk_e8ac84dd9cb6ac06`): `package/card-mr-01.json`, `docs/.../card-contract.json`, and `...-card-contracts.json` `firstExecutableCard`. Known-good now points at digest-test **:63** vacuity; line 74 identity drift is named as failing diagnostic evidence.

Clause set is 8 tests. Required topic IDs must be present without duplicates; extra justified topics are allowed. Clause **(7)** is `it.fails` until `independentSemanticReview.status === "accepted"`, distinct UUID `worker.sessionId` / `reviewerSessionId`, named reviewer, review record, timestamp, and live sha256 of ENTRYPOINT + ledger md/json + proposal. Seed manifest is `pending-owner-review` with null identities. Worker is instructed to leave (7) planted.

Recorded isolated runs: baseline `5 passed | 3 expected fail` exit 0; ordinary unflip `3 failed | 5 passed` exit 1; pending review `1 failed | 7 passed` exit 1 (clause 7); accepted synthetic metadata `8 passed` exit 0; self-review and stale output binding each `1 failed | 7 passed` exit 1. README matches those counts and states the synthetic 8-pass is detector feasibility, not review.

Caller seeds: seated production path is `seated_clip_bind_stage.py` (not the postprocessor); `static-assets.test.ts` is a policy guard; pass-order and shim topics explicitly unreviewed with real ui-xr/admin consumers named. `seedStatus` says caller statements need MR-01 closure. Full design read-only; no registry reclassify. Hybrid remains a hypothesis. Write roots still miss floor/SC-07.

LSP was `No Project` in the prior turn; callers were confirmed by search (`motion-bind-cli.ts` → `planMotionRetarget`; ui-admin → `@openclinxr/factory-stations/catalog`; no `CCDIKSolver` under `apps/ui-xr`).

## Remaining P1 (fix in the committed plant, before Plant)

Registry precedence is required in the card body and handoff. Clauses (2)/(3) still only forbid “nothing is built” / “run the bake-off first” and require verdict + ledger path. Current-prose is only `## The one-line state` and `## Do this, in this order`; the intro “Read this first” is untested. A worker can flip stale orders and leave live AUTHORITATIVE instruction.

**Correction:** in clause (3), assert current one-line/do-this prose states that `doc-authority-registry-2026-05-27.json` outranks ENTRYPOINT “Read this first” / historical AUTHORITATIVE wording. Do that before the ingestion commit so `live:` owns it.

Also refresh `delegation-manifest.json` `expectedBeforeEntrypointEdit` so it names clause (7), not only (2)–(3).

Clause (7) still cannot authenticate sessions or grade claim quality. Distinct UUID labels plus matching hashes are the checker; owner must compare worker id to the live board card and reviewer id to retained independent CLI/session output. Do not `sessions.bind` the reviewer onto the worker task. If a real session id is not UUID-shaped, record a UUID and keep the native id in the review record; otherwise (7) stays red for the wrong reason.

## What landing proofs will prove

`live:` = zero `it.fails`. `run:` = eight ordinary passes. `changed:` = those five docs/manifest files moved after ingestion. Clause (7) = accepted metadata bound to then-current output bytes, with two different UUID fields. They do not prove consumer-closure truth, visual quality, clinical fitness, or that the owner actually read the independent review.

Idle create from the equal payload, copy/commit the package, throwaway unflip of (2)(3)(7), read `doneWhen` back, then Plant. Add the registry assertion first.