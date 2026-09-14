# OpenClinXR humanoid-motion reassessment: delegation handoff

Prepared 2026-09-13. Status: preparation in review; do not dispatch from this file alone.

## Purpose and finish line

Reconcile the humanoid-motion architecture with current code and retained evidence, then evaluate only the unresolved jobs that could change a decision. The end result is current, evidence-bound guidance and justified follow-up work. Reinstating the superseded schema, choosing a global backend winner, or releasing every old motion card is not a success criterion.

The operator wants cleared clip catalogs with dynamic transitions, case-authored distinctive behavior, and a path toward bounded responses to previously unknown targets. Keep those requirements visible. The leading hybrid hypothesis is recorded bases plus deterministic transitions, optional offline case-specific overlays, and bounded runtime goal/contact correction. It is a hypothesis to test, not a predetermined selection.

This effort prepares delegation; it does not itself implement motion or capture new proof. A receiving owner/orchestrator must ingest this document and the supplied portable test/seeds before planting the first executable card. First-card creation remains Idle; no preparation artifact is permission to dispatch.

## Ingestion and authority

1. Put this file at `docs/openclinxr/humanoid-motion-reassessment-2026-09-13/handoff.md` in the repository. Preserve its preparation baseline as historical evidence. Copy the supplied portable test/seeds and card-contract.json into their exact listed paths; no verifier framework needs to be designed at ingestion.
2. Refresh main, AGENTS, PROJECT_STATUS and project-filtered BothyBoard state. Verify that the intended cards belong to OpenClinXR `prj_9b390b99b443a964`. Do not treat a mixed-project sync roster or stale blockedReason as current eligibility.
3. Read the board-conduit doctrine and existing motion entrypoint/full design. Identify current source files and production callers with symbol searches and LSP. Protect other workers' changes and the six blueprint files.
4. Before planting MR-01, commit the handoff, exact card-contract.json snapshot and supplied portable planted test and honest baseline seeds under `tools/openclinxr/evidence/motion-architecture-reassessment/`. The supplied test must demonstrate the actual stale guidance/evidence contradiction, not fail merely because a new file/import is absent. Record its command, failing assertion, input hashes and main revision. Independently review that it measures the claimed contradiction and that unchanged bad guidance cannot pass.
5. Read the complete MR-01 contract from the board. It is create-only. If current measurements invalidate it, recreate a corrected Idle card and cancel the superseded one with replacement IDs; comments cannot amend the contract. Do not patch doneWhen/depIds through tasks.update.
6. Commit ingestion and controls to main through the normal serial integration/lease process. Record the exact ingestion revision in the delegation manifest. Only the owner may Plant after confirming a live RED/control and a committed contract. Workers return review; the owner/orchestrator verifies and attests Landed.

Preparation approval for MR-01 is limited to factual state/link corrections in ENTRYPOINT, with no registry reclassification. Corrected current ENTRYPOINT must explicitly state registry precedence over its legacy “Read this first”/AUTHORITATIVE prose; preserve that prose only as qualified history. The receiving owner confirms that scope at ingestion. `docs/openclinxr/doc-authority-registry-2026-05-27.json` classifies the entrypoint as archive-candidate with no agent instruction weight; its prose saying “read this first” does not override the registry. This contradiction is itself a ledger topic. MR-01 must not promote its handoff or proposal to instruction authority merely by adding links.

Document authority remains explicit: the old architecture brief stays superseded except its historical clinical source ledger. The registry also classifies the full design and old brief as archive-candidate with no agent instruction weight, despite the entrypoint calling the full design AUTHORITATIVE. Preserve that historical assertion without treating it as overriding the registry. The existing full design is read-only in MR-01. Its claimed authority must be checked against the current registry and preserved as historical design context; MR-01 does not archive, rewrite or promote it. Factual correction of a stale entrypoint does not silently change registry classification. Mark unbuilt proposals and open decisions without presenting them as measured runtime behavior.

## Preparation baseline: refresh before relying on it

Main `dd074568`; only owner-memory/pulse.jsonl dirty when inspected. Board revision 4676. Code facts below were checked against this checkout; later changes require new identity-bound observations. The portable seeds are explicitly unreviewed and must be challenged by MR-01, including any tentative absent-consumer statement.

| Finding | Evidence and consequence |
|---|---|
| Entrypoint says nothing is built and run bake-off first | `docs/openclinxr/humanoid-motion-ENTRYPOINT.md`, one-line state and execution order. Contradicts landed work; correct the instruction without claiming a backend won. |
| Bake-off landed, verdict other | `tools/openclinxr/evidence/motion-backend-bakeoff/report.json`; neither backend produced requested clutch; pulse descriptor omitted the runtime pulse goal. Historical negative evidence is not today's solver result. |
| Actor identity stale | Current digest test failed: report `b744d3d5295e2d4840ceae586924727725667cb0260a5b1f3ee68dd2e72e136f`; actor `8409334c30861e07d7bb180b2b8f7e5d48c277bc91c4a5df8f0cb0475869c541`. No hashes were edited. Recapture must produce a new report and new review, not rubber-stamp old images. |
| Chain and limits changed | `motion-backend-bakeoff/harness.html` uses non-twist links and elbow limits. Audit actual joint/rest geometry; zero wrist error does not establish intact anatomy or skin. |
| Terminal turn node repair landed | Card `tsk_acc431bda6914e71`, `tools/openclinxr/evidence/scene-closure/proofs/sc-05/terminal-turn-foot-lock-2026-09-12.md`. Focused node test passes; browser proof remains a separate claim. |
| Floor and normal-workflow recording have live owners | Floor `tsk_a775eb9e466328a0`; SC-07 `tsk_93b6e2aa66b6c3fa`, both ready/Planted at baseline. Do not duplicate their changes or freeze-policy edits. |
| Seated correction is specialized | `asset-pipeline/makeclothes/postprocess-seated-glbs.mjs` stamps frame-1 leg quaternions onto every key. Held posture restoration is not proof of per-frame transfer or seat contact. A constant additive reference can be valid. |
| Catalog variety is limited | `docs/openclinxr/humanoid-motion-clip-deviation-2026-09-12.md` and `clip-channel-deviation.ts`. Inventory measures names/channels, not usable transition coverage or clinical fitness. |
| Factory integration and package cycle need separate classification | `factory-stations/src/station-runners.ts` actually registers motion_retarget; `motion_retarget/run.ts` plans and spawns a Blender binding stage through a fresh subprocess. That is real integration, not proof of a rendered compiled encounter. `shared-schemas/src/factory-stations.ts` retains a compat edge. Confirm full live consumer closure before proposing a new package boundary. |

Fresh parent verification: three focused test files, seven tests: six passed; current actor/report digest comparison failed. Terminal-turn and both-arms recapture checks passed within their narrow claims. No new browser/Quest/model execution was performed.

## MR-01: reconcile current architecture and evidence

One bounded documentation/evidence-instrument slice. Produce:

- `decision-ledger.md` and `decision-ledger.json`: every consequential historical claim mapped to current source symbols, production consumers (or explicitly no production consumer), revision and content identity, measured/unknown status, claim scope, notEvidenceFor and owner decision needed. Distinguish mathematics, engineering choice, protected policy, clinical authoring proposal and observed behavior.
- `comparison-proposal.md`: specify unresolved per-job comparisons, feasibility, input identity, metric definitions and owner decisions still required. It is a proposal, not authority to benchmark or implement.
- `delegation-manifest.json`: input main SHA, source/artifact hashes, project/card identities, exact preparation/RED commands and outcomes, independent review state/reference, output hashes and phase-release state. The worker records review as pending; the owner records the independent reviewer, claim-by-claim disposition and reviewed output identities before attesting Landed. A worker cannot self-certify this review. Hash outputs after their content is finalized; do not include a file's own hash inside that same file.
- Narrow factual updates to ENTRYPOINT only: identify landed/inconclusive work and link the current ledger/proposal. Preserve original rejection basis and historical revisions. Do not mark the new proposal authoritative without explicit owner approval recorded in the ledger.

Minimum ledger topics: IK blend versus target-distance completion; clinical expression versus authored cooperation; behavior/schema validation; root/pose/contact/gaze pass ordering and bone ownership; static rest suitability and seated transfer; retargeting/canonical rig capability identity; catalog quality and transitions; factory package/station/output boundary; current evidence and obsolete historical failures; runtime touch lifecycle fence; provider eligibility and local execution; all nine open design decisions (posture field, station topology, package adapter, rock frame/amplitude, cooperation join, IK blend interpretation, station schema, tolerance authority, cooperation provenance).

Ledger entries must carry evidence that could change the answer, not merely repeat the successor design. No production caller is a useful result when verified through consumer closure. Re-run retained evidence only to classify it; MR-01 need not turn the old capture digest test green.

Acceptance has three layers: mechanically reproducible source/input bindings; a controlled negative that rejects stale/unsupported guidance; and independent semantic review that claims match current consumers and remain within scope. Existence, keyword presence, marker flags or a green source-inspection test alone cannot prove reconciliation.

## Conditional MR-02: current-input per-job comparison

Do not create a frozen executable contract until MR-01 is reviewed and the owner resolves the decisions required for a fair feasible experiment. If measurement will not change a decision, document why and omit it.

Compare separately:

1. Static authored rock-plus-clutch and actual pulse presentation on the current supported MPFB actor. Both arms need real behavior/goal definitions and valid seat/rest/support; no missing-goal fallback may count as pulse success.
2. Response to a moving simulated target in an isolated harness. This probes live-target responsiveness; baked-only limitations here do not establish a global winner. It does not add production learner grasp.
3. Bounded correction over a recorded clip, if current catalog coverage and rights allow it. Preserve base motion, pass order, root authority and meaningful contact windows; include deterministic selection/inertialized transition baseline before complex matching.

Bind actor bytes, canonical rig/bone mapping, geometry, rest frames, proportions, joint limits, descriptor schema/data, support geometry, harness and source revision, event sequence, seed and explicit clock/deltaMs. Changed capability/rest/geometry invalidates goals even if JSON survives. Replays must reproduce metrics under specified tolerances; numeric and pixel determinism are different claims.

Predeclare metric units, sample cadence/drop rules, aggregation, engineering tolerance rationale and invalid/missing outcomes before capture. Required observations: actual behavior occurrence, FK positions, joint interior angles/limb lengths, residual, contact normal/clearance, support/floor behavior applicable to the posture, transition validity and skin deformation. Native multi-view time sequences reviewed independently accompany measurements; residual zero alone cannot pass. Do not invent clinical ROM or transfer standing-foot thresholds to arm contact.

Keep original controls and all failed runs, record paired pinned inputs and separate verdicts per job. Missing behavior, identity mismatch, invalid geometry or insufficient observations produces inconclusive/failure, never an inferred winner. Record actual M1 Max 64GB platform/backend/timing/memory/thermal conditions if executed locally; do not infer MPS support from capacity or desktop results from headset behavior.

Use a separate worktree, evidence directory and ports; coordinate scarce browser/GPU/Blender resources with SC-07 and floor repair. Normal scene-closure acceptance remains frozen.

## Conditional MR-03: decide and delegate justified implementation

After the measured comparison, record retained/rejected/unknown decisions and limitations. Choose mechanisms per job; hybrid is allowed. Create only implementation leaves with observed defects, reviewed contracts, real negative controls and current dependencies. Check for existing equivalent cards first; do not resurrect the Idle M-series children under parent `tsk_784e4714847f900b` or edit their create-only edges. A cancelled dependency may have a landed replacement: verify code, then recreate only the affected contract if necessary.

Implementations must advance visible case-to-runtime behavior with deterministic replay and evidence; docs-only closure cannot imply the original product goal is fully implemented. Require regression proof through the real production consumer, independent normal-workflow video when affected, and an explicit downstream handoff to any outstanding scene-closure card. Clinical authoring and protected input policies require their own reviewed decisions.

## Research and licensing boundaries

Use first-party sources and exact revision/checkpoint records. Candidate availability does not establish adoption clearance.

- Smooth foot/contact locking, inertialized transitions and offline cleanup: [Holden article](https://theorangeduck.com/page/inverse-kinematics-foot-locking), [MIT example license](https://github.com/orangeduck/GenoView-InverseKinematics/blob/main/LICENSE). Relevant to contacts/transitions, not automatic proof of arm contact or local runtime quality.
- [Motion matching](https://github.com/orangeduck/Motion-Matching) and its [MIT code license](https://github.com/orangeduck/Motion-Matching/blob/main/LICENSE). Demo motion rights are separate. [LaFAN1 license](https://github.com/ubisoft/ubisoft-laforge-animation-dataset/blob/master/license.txt) includes NC/ND terms and is ineligible for unrestricted adoption.
- [GMR](https://github.com/YanjieZe/GMR) is robot retargeting research, not a verified MPFB integration. Exact dependencies, robot/SMPL assets and data require their own review.
- [Kimodo](https://research.nvidia.com/labs/sil/projects/kimodo/), [code license](https://github.com/nv-tlabs/kimodo/blob/main/LICENSE), and [ARDY](https://github.com/nv-tlabs/ardy) may inform an offline, swappable motion provider. Exact weights/data/dependency/output terms and Apple Silicon execution remain unverified for adoption.

Require permissive/non-copyleft licensing and permitted intended commercial distribution across code, dependencies, weights, datasets, assets and output. Non-copyleft alone does not permit NC/ND material. MPFB/MakeHuman tool licenses must be distinguished from generated asset terms and linked provenance; do not conflate authoring tools with redistributed runtime components. Retain canonical skeleton/retargeting capability contracts rather than forcing a provider's skeleton into the public API. No live generative-motion dependency is selected here.

## Out of scope and NOT TESTED

No new clinical validity claims, clinical enum/ROM thresholds, production grasp/touch lifecycle, frozen scene-closure acceptance changes, asset rights assumptions, headset performance claims, global backend winner, public marketing publication or automatic old-card release. New sequences, qualified clinical review, eligible model execution, seated support and Quest validation remain NOT TESTED until performed and recorded by the appropriate later card.

## Release and acceptance ownership

MR-01 worker returns a reconciled ledger/proposal and corrected factual ENTRYPOINT in review. The owner independently checks the consequential claims against current consumers and evidence, rejects unsupported authority/clinical/quality claims, then records acceptance and output identities before Landed. The owner may reject or request revision through mailbox without changing the immutable contract.

MR-02 is created only if the accepted ledger identifies an unresolved comparison that could change a decision, owner decisions required for its scope are recorded, and input/metric/resource/rights feasibility is established. A proposal with unresolved posture/schema/contact/tolerance authority is not dispatch-ready. MR-03 leaves are created only from reviewed evidence or an already independently demonstrated defect. An omitted phase requires a recorded rationale; omission does not imply the full product capability exists.

## Board operating rules

Card body is the contract; read it directly. Supply explicit projectId, current required fields, writeRoots containing writes only, separate transitive read-closure, known-good/failed-treatment rows and TREE doneWhen. Treat pointers/parents as non-executable. Preserve contract immutability after creation, not just Plant. Leave MR-01 Idle until ingestion controls are committed. Later phases are conditional specifications in this handoff, not placeholder cards that cannot be amended.

Use returned dispatch/session/worktree protocol for actual workers, heartbeat and poll mailbox. Worker finishes review; independent proof evaluation precedes owner Landed. A live process/session must be checked before reclaiming a reaped card. Recovery preserves failure evidence and recreates obsolete contracts rather than quietly rewriting them.

## Code navigation anchors for the receiving agent

All repository paths in this handoff are relative to the OpenClinXR checkout unless explicitly absolute. Repository paths below are read-closure anchors, not new public APIs or write permission. Resolve symbols against the refreshed commit rather than assuming these line numbers stay fixed.

- `packages/openclinxr/motion-compiler/src/canonical-motion-contract.ts`: `CLIP_SCHEMA_VERSION`, canonical compiled clip wire contract; separate contract/unit coverage from a live runtime consumer.
- `packages/openclinxr/motion-compiler/src/program/`: closed planner schema and validated program pipeline; test provenance is not clinical authoring approval.
- `packages/openclinxr/motion-compiler/src/ik/solve-chain.ts`: actual solver chain semantics and input frames.
- `packages/openclinxr/factory-stations/src/station-runners.ts`: `motion_retarget` registration.
- `packages/openclinxr/factory-stations/src/motion_retarget/run.ts`: `planMotionRetarget`, `runMotionRetarget`, subprocess boundary and returned artifact/exit semantics.
- `packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime-mod.ts`, `station-bedside-approach-mod.ts`, `settling-step-turn-mod.ts`, `stance-lock-mod.ts`: current root/contact ownership and approach pass sequence. Follow the caller into asset-registry and ui-xr rather than stopping at exports/tests.
- `packages/openclinxr/shared-schemas/src/factory-stations.ts`: compatibility re-export; inspect its actual admin consumers before recommending dependency changes.

For the wider case-to-rendered-encounter pipeline, the current room-state/layout and scene-closure work is a dependency/context, not an invitation to reimplement it here. Review how case intent, initial room requirements, semantic scene graph, affordance/operational-volume constraints, seeded layout, actor/equipment placement and motion inputs join. Identify a missing or mismatched consumer as a ledger gap; route any repair through existing owners or a later narrowly scoped card.

## Supplied portable files and precise first-card proof

The accompanying `openclinxr-humanoid-motion-reassessment-package/` directory contains the handoff, honest unreviewed ledger/proposal/manifest seeds, the complete planted test, a retained stale-current-instruction fixture, the immutable first-card create payload and ingestion README. Preserve relative paths. If any destination already exists, compare and reconcile rather than overwriting it. These seeds are starting evidence, not accepted current architecture.

The test has two raw expected-failure clauses for factual instruction and one owner-controlled acceptance clause. The factual clauses for genuinely stale current ENTRYPOINT instruction, with all referenced files present. Other ordinary clauses check non-vacuity, the retained negative control, topic/source binding, dynamic actor/report classification and limited proposal completeness. Historical quotes may remain. It does not infer consumer behavior, clinical validity or motion quality from text.

Run from repository root after ingestion:

```sh
pnpm exec vitest run --root . tools/openclinxr/evidence/motion-architecture-reassessment/the-entrypoint-current-state-matches-landed-evidence.test.ts
```

At the preparation baseline, the suite exits successfully because the two genuinely wrong instructions are wrapped in `it.fails`. That is NOT completion. Confirm those assertions really fail when run as ordinary tests in a separate temporary control copy, then retain the raw plants before dispatch. Worker corrects factual clauses (2)/(3) but leaves acceptance clause (7) planted. After worker returns review, owner verifies actual worker session against the board and distinct reviewer session against its retained session output, records independent claim-by-claim review acceptance and final ENTRYPOINT/ledger/proposal hashes, then flips clause (7). Labels alone do not authenticate review; the owner must verify them. No Landed attestation is allowed while review is pending. At landing, both `live:` (zero remaining raw expected-failure clauses) and the actual suite run must pass after correction. Keep the stale fixture and diagnosis unchanged. `changed:` requires actual updates relative to ingestion for ENTRYPOINT, ledger JSON/Markdown, comparison proposal and manifest; neither retained report nor actor asset is a write target.

Refresh source hashes and actor/report classification before Plant even if HEAD is unchanged, because generated bytes can change outside tracked code. If stale current instruction is already fixed or current evidence changes the objective, recreate the contract and controls before release. Do not manufacture a new failure to preserve this card.

## Required factual authority notice

The corrected current ENTRYPOINT section must include this notice, checked by the supplied plant:

> The doc-authority-registry-2026-05-27.json takes precedence over this ENTRYPOINT’s “Read this first” and historical “AUTHORITATIVE” wording.

Use actual native worker/reviewer session identifiers. The acceptance check supports native identifier formats; do not mint a pretend UUID to satisfy it. Owner verifies both identifiers against their authoritative board/session records.

## Actual prepared board state

MR-01 is `tsk_7177631409c3d441`, an Idle/backlog child of `tsk_e8ac84dd9cb6ac06` in OpenClinXR. It has not been planted or dispatched. Read board-manifest.json and normalized board-task-snapshot.json; do not create another card from the archived create payload. An incomplete formatting draft `tsk_09d3ca349f40f120` was cancelled after read-back exposed lost custom sections. Replacement structured fields and every substantive instruction paragraph were verified against the live board.

The receiver commits this handoff, exact card-contract.json, board manifest/snapshot, supplied test/control and honest seeds before owner release. MR-02/MR-03 remain conditional specifications. Use the board body as current contract and the committed documents as supporting context, subordinate to protected rules. No motion implementation, new capture or main commit was performed in this preparation.
