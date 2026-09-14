I'll critique the handoff and card contracts against current repo code and board rows, read-only. First pass: the deliverables, PROJECT_STATUS, and the portable package.Next I’ll read the portable package, check live board rows, and verify the handoff’s code/authority premises against the current tree.Checking the planted test, live-rule semantics, board overlap, and whether the cited hashes and callers still match the tree.Filtering OpenClinXR board rows and checking `live:` semantics, hashes, and the cited production callers.**NOT READY** to create or plant from the named `card-contracts.json`. Idle create is viable only from the package `card-mr-01.json` after the P0 correction below. Do not dispatch. I did not mutate the repo or board.

Checked at main `dd074568` (matches origin/main). OpenClinXR project `prj_9b390b99b443a964`. Board revision 4676. Cited hashes for ENTRYPOINT, full design, brief, registry, bake-off `report.json`, harness, actor GLB, seated postprocessor, clip-deviation instrument, shared-schemas shim, `static-assets.test.ts`, and `motion_retarget/run.ts` all match disk. `report.json` `verdict` is `other`; actor digest `b744d3d5…` vs disk `8409334c…` is `identity-stale`. Registry still marks ENTRYPOINT / full design / brief `archive-candidate` / `agentInstructionWeight: none`.

## P0 (fix before create)

1. **Two create payloads disagree on a create-only field.**  
   `openclinxr-humanoid-motion-reassessment-card-contracts.json` `firstExecutableCard` has `depIds: []` and **no** `parentId`. Package `card-mr-01.json` sets `parentId: tsk_e8ac84dd9cb6ac06` (Idle pointer, 20 children, all Landed or cancelled). `tasks.update` cannot repair `parentId`/`doneWhen` after create.  
   **Correction:** treat `package/card-mr-01.json` as the only create body; add the same `parentId` to `card-contracts.json` or mark that file non-authoritative. Read the card back after create.

2. **Landing proofs can go green without the stated third acceptance layer.**  
   `live:` (`done-when-rules.ts` / `countPlantedItFails`) + `run:` + `changed:` match repo semantics: `live:` is zero remaining `it.fails(` after comment/string strip; `run:` still exits 0 on expected-fail. Clause (4) only checks topic ids, enums, path existence, and `currentSource.sha256`. A worker can keep seed `caller.kind: "none"` text, flip two ENTRYPOINT sentences, and satisfy TREE. Independent claim-to-consumer review is prose in the body/manifest, not a landing predicate.  
   **Correction:** before Plant, add a landing clause that `delegation-manifest.json` `independentSemanticReview` is an object with `status: "accepted"`, named reviewer ≠ worker, and output hashes recorded **after** that review. Owner fills that object; worker must leave it pending. Refuse `proofs.set` if it is still the seed string.

## P1 (do not freeze these)

- README says `changed:` includes the test file; the contract does not. `live:` already covers the `it.fails` flip. Align README.  
- Known-good cites `the-bakeoff-report-digests-match-the-files-on-disk.test.ts:69`. Line 69 is the digest-field vacuity guard. Identity is clause (1) at line 74 and is currently red. Point known-good at the vacuity clause only.  
- Seed `package-station-boundary` still uses `caller.kind: "none"` on the shim while `apps/ui-admin/src/the-factory-station-cards-derive-from-schema.test.tsx` already imports `@openclinxr/factory-stations/catalog`. The claim text is ahead of the caller field; MR-01 must close that, not copy the seed.  
- `pass-order-bone-ownership` sources the full design, not `xr-humanoid-animation` mods. `apps/ui-xr` already imports `@openclinxr/xr-humanoid-animation/mounted-approach-geometry`; floor card `tsk_a775eb9e466328a0` writes `packages/openclinxr/xr-humanoid-animation/src` and `asset-registry/src/approach-executor.ts`. Worker must not treat “no CCDIK in ui-xr” as “no production motion caller.”  
- Duplicate risk for **MR-03** is the other parent `tsk_784e4714847f900b` (Idle M-series children with `apps/ui-xr` / compiler write roots), not eight live children of `tsk_e8ac84dd9cb6ac06`.  
- ENTRYPOINT still says “Read this first” and calls the full design **AUTHORITATIVE**. Clauses (2)(3) do not require removing that. After a factual fix the file can still impersonate instruction while the registry says none. Keep the historical table; add a current-instruction sentence that the registry wins.

## What is already sound

Ingestion paths, Idle-until-commit, recreate-don’t-patch, no MR-02/MR-03 placeholder cards, no bake-off winner (`verdict: other`, proposal clause (6)), claim classes `math|engineering|policy|authoring|observed`, LaFAN1 NC/ND and unverified Kimodo/GMR/ARDY on M1, physics-touch fence left up, write roots disjoint from Planted SC-07 `tsk_93b6e2aa66b6c3fa` and floor `tsk_a775eb9e466328a0` (SC-07 `blockedReason` is stale; status is ready/Planted). `motion_retarget` is registered in `station-runners.ts`; `planMotionRetarget` / `runMotionRetarget` are imported from `@openclinxr/factory-stations` in `motion-bind-cli.ts`. No `CCDIKSolver` under `apps/ui-xr`. Conditional MR-02/03 stay owner-gated specs. Product requirements (catalog transitions, case-authored behavior, bounded unknown-target response) stay in the handoff and are not success criteria for MR-01.

## Direct answers

| Question | Answer |
|---|---|
| Executable after defined ingestion? | Yes, from `card-mr-01.json` after commit + control unflip + read-back. Not from `card-contracts.json` as written. |
| Conditional stages? | Real path: create only after owner decisions. Not frozen placeholders. |
| Follow without chat? | Yes if the owner uses the package README + `card-mr-01.json` and refreshes HEAD/board. Dual JSON is the trap. |
| Clinical / quality from text hashes? | MR-01 tests do not invent ROM. They also do not prove quality. |
| Video / artifact binding? | No video in MR-01 (correct). Hash binding is current and strong enough for reconciliation only. Recapture + independent picture/video review belong to a later released MR-02. |

Passing TREE checks prove: ENTRYPOINT current-instruction REDs were flipped, the suite exits 0, listed files changed vs ingestion, ledger **shape** and source hashes match, identity **classification** follows live actor/report bytes, proposal does not crown a backend. They do not prove consumer closure, independent review, motion quality, or that the original product goal is implemented.

I did not re-run the three validation-repo Vitest invocations; I checked clause structure, `live:` mechanics, and current-tree hashes. LSP `workspaceSymbol` failed (`No Project`) in this session; callers were confirmed by search.

**Exact next owner action:** merge the two JSON create bodies (`parentId` + parent/staging section), add the manifest review predicate to the plant, copy/commit the package, create Idle, read `doneWhen` back, unflip the two REDs in a throwaway copy, then Plant.