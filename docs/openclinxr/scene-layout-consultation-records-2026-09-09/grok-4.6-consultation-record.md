# Grok 4.6 consultation record — OpenClinXR research brief

Completed **five sequential prompt/response exchanges in one persistent Grok conversation**, using the local Grok CLI and explicit session resumption. Each response ended normally. These are five substantive consultation turns, not a count of internal tool calls.

- Conversation ID: `0a7c4705-0b58-439b-b119-ac8dd1ed6db4`.
- Requested CLI model: `grok-4.6`; CLI usage reports the resolved backend as `grok-4.6-build`.
- Repository: `/Volumes/files/src/openclinxr`; code baseline `1d6d2af1eaeac9c1be5b93dd8ac9aefaba429ce9`.
- Full repository reading and terminal inspection were available. LSP, web search and web fetch were explicitly enabled. File reads, LSP document symbols/definition navigation, and first-party web lookups actually succeeded. Some reference queries were incomplete; no-result queries were not accepted as proof of absence.
- Review scope was read-only: no product implementation, motion-model inference, benchmark, installation or deployment was requested. The working tree's operational log was dirty during consultation; source citations were separately checked against the recorded code baseline.
- The record below contains the exact prompts and visible response text, including brief progress text. Internal reasoning and raw tool payloads are omitted. Reviewer statements are consultation evidence, not automatically accepted facts.

**Final outcome:** Grok accepted the research brief subject to two sentence changes: narrow the immediate milestone to authored placement reaching the final posed patient, and make M1-first work use existing pose/clip paths rather than experimental IK. Both were applied after the fifth response. This is document review, not runtime or license approval.

## Decisions incorporated

1. Specify the missing placement data path, including case vector versus admin/station scalar and runtime posture remapping.
2. Separate optional authored intent from required resolved placement; preserve legacy cases, while unresolved explicit intent blocks promotion.
3. Require full authoring/compile/bundle consumption and final posed-humanoid observations after framing and repeated frame updates.
4. Distinguish existing clip consumers from experimental runtime goals/contact; require independent mesh, rig, contact and visible-motion evidence.
5. Review exact code, checkpoint, body model, encoder, data and output terms; exclude the research-only Kimodo SMPL-X variant and keep ARDY's encoder gate explicit.
6. Preserve M1-first measurement and conditional provider choice; no backend or hardware winner was inferred from literature or the historical experiment.

## Advice corrected or not adopted

- Do not remove required runtime defaults merely because a case has no authored placement.
- Do not treat a failed LSP query as proof that TypeBox constants lack TypeScript symbols.
- Do not silently accept a fallback preview for an invalid explicit placement request.
- Do not treat a large arbitrary offset as a safe test tolerance, or a direct preview overlay as complete factory integration.
- Do not infer production contact support from a prototype or global absence from one planner's empty constraint array.
- Do not equate gated model downloads with prohibited use, an inherited MIT notice with absent permission, or pretrained inference with training-dataset redistribution.

## Execution receipt

| Exchange | Focus | Agent tool-loop rounds | Completed |
|---|---|---:|---|
| 1 | Architecture and consumer tracing | 10 | end_turn |
| 2 | Compatibility challenge and placement contract | 3 | end_turn |
| 3 | Motion maturity and independent evidence | 3 | end_turn |
| 4 | First-party licenses and hardware claims | 3 | end_turn |
| 5 | Adversarial review of amended brief | 2 | end_turn |

## Exchange 1: Architecture and consumer tracing

### Prompt

This is consultation turn 1 of at least 5 with the same Grok 4.6 conversation. You are the specialist reviewer consulting for Codex, not the repository's autonomous orchestrator. The user explicitly requests your own Grok 4.6 review with full repository access, LSP and internet search permission. Do not spawn other models. Scope is read-only research and review: do not edit files, dequeue/claim board work, run product slices, install software, commit/push or send messages. Read repository policies as context; autonomous work loops are not this assignment. You may use the terminal for inspection and LSP tools for symbol navigation, and search/fetch public first-party internet sources. Do not read credentials or secrets.

Read the COMPLETE brief at:
docs/openclinxr/scene-layout-consultation-records-2026-09-09/../humanoid-scene-layout-research-brief-2026-09-09.md
The full repository is your cwd /Volumes/files/src/openclinxr. Brief snapshot is 1d6d2af1eaeac9c1be5b93dd8ac9aefaba429ce9; current main can advance independently.

First prove capabilities with actual operations: read the brief and git HEAD; use LSP definition/references on a placement or station-assembly symbol and report the result (or exact failure); use web_search or web_fetch on a first-party research source from the brief. Then review architecture and implementation sequencing with particular focus on whether authored ActorCard placement actually reaches the UI-XR consumer. Follow real call sites, not comments or tests alone. Identify the 3 highest-impact weaknesses and precise amendments, distinguish implementation from proposal/history, cite path:line and external URLs. Limit final response to ~700 words; save depth for subsequent turns. Begin with a compact capabilities receipt and do not claim a capability worked without a tool result.

### Grok response

I'll start by proving the requested capabilities: read the brief and git HEAD, then LSP a placement/station-assembly symbol and fetch a first-party source from the brief.HEAD matches the brief snapshot. Next I’ll LSP a placement/assembly symbol, fetch a first-party source, and trace ActorCard.placement into UI-XR.Kimodo fetch and document symbols succeeded. Next I’ll LSP definition/references and follow ActorCard.placement through real runtime call sites.Authored `ActorCard.placement` does not control UI-XR actor transforms. The live scene still mounts from hardcoded `sceneManifest.actorPlacements` plus posture remaps.

## Capabilities receipt

| Probe | Result |
|---|---|
| Brief | Full 145-line file read. |
| git HEAD | `1d6d2af1eaeac9c1be5b93dd8ac9aefaba429ce9` matches the brief snapshot. Tree is dirty and 6 commits ahead of `origin/main`. |
| LSP `documentSymbol` | `station-scene-assembly.ts`: `assembleStationScene` at L153, staged builder, `actors` at L110. |
| LSP `goToDefinition` | `apps/ui-xr/src/main.ts:2986` `assembleStationScene` → `packages/openclinxr/xr-station-room/src/station-scene-assembly.ts:153:17`. |
| LSP `findReferences` on that export | 2 same-file hits. Missed the live caller at `main.ts:2987`. |
| LSP on `ActorPlacementSchema` (`schemas.ts:227`) | `goToDefinition` and `findReferences` returned **No results found**. TypeBox const is not a TS symbol. |
| LSP `findReferences` `generatedActorPlacement` (`actor-placement.ts:24`) | 3 hits in `asset-registry` (`runtime-bundles.ts:3`, `:1415`). Missed `tools/openclinxr/dark-factory/multi-case-runner.ts:802`. |
| First-party fetch | https://github.com/nv-tlabs/kimodo — Apache-2.0 code; SOMA checkpoints NVIDIA Open Model; `Kimodo-SMPLX-RP-v1` NVIDIA R&D Model; Linux/NVIDIA; default ~17 GB VRAM; `TEXT_ENCODER_DEVICE=cpu` drops VRAM under 3 GB. |

## What is implemented vs proposed

**Implemented, live UI-XR path.** `assembleStationScene` is wired (`main.ts:2987` → `3095`). Actor mounts go `stageStationActors(..., actorPlacement: runtimeActorPlacement)` (`main.ts:3096-3101`). `runtimeActorPlacement` reads `encounterRuntimeAssetBundle.sceneManifest.actorPlacements` (`main.ts:817-853`). Those records come from `runtimeActorPlacementsForScenario` (`generated-ed-station-runtime-bundle.ts:1248-1275`) or `generatedActorPlacement` (`actor-placement.ts:24-59`). Both choose slot by role/index and write fixed xyz. Neither reads `actor.placement`.

**Implemented, authored, unused for layout.** `ActorPlacementSchema` (`schemas.ts:227-241`) is optional on `ActorCardSchema` (`schemas.ts:304`). The only bank fixture with it is `clinic-knee-pain.ts:51-99` (`chair` / `chair` / `none` plus `{x,y,z}` offsets). Compile emits `family: "Placement"` with `status: "planned_unsplit"` and `supportSurface` only (`encounter-materialization-evidence.ts:299-321`). Admin writes the same fields as metadata (`environment-generation-queue-panel.tsx:117-123`, `:476`).

**Implemented, conflicting owners.** `resolveActorPosture` prefers scenario/env markers over declared posture (`actor-posture.ts:130-149`). For seated/supine, `runtimeActorPlacement` replaces bundle xyz with `seatedActorWorldPosition` / `supineActorWorldPosition({})` (`main.ts:846-848`). `compileScenarioMotion` maps `supportSurface` → posture (`compile-scenario-motion.ts:18-20`, `:291-307`) and has no callers under `apps/ui-xr` or factory. Dark-factory `staging_placement` calls `generatedActorPlacement`, then `runStaging({ supportSurface: placement.posture, plantOffsetMeters: 0 })` (`multi-case-runner.ts:802-808`).

**Proposed / historical, not this tree.** Brief §3 solver, operational volumes, and learned streaming. MADR 0048 “extend existing placement, do not add a second graph” (`docs/madr/0048-scene-composer-placement-stage.md:165-196`). Kimodo/ARDY remain evaluation leads.

## Three weaknesses and amendments

**1. Authored offsets never reach the consumer.** Changing `clinic-knee-pain` `plantOffsetMeters` cannot move the learner scene. `generatedActorPlacement` ignores the field (`actor-placement.ts:43-50`). Amendment: one resolver used by both bundle writers and `runtimeActorPlacement`. If `placement` is present, resolve `supportSurface` to a named fixture anchor and add `{x,y,z}`. If absent, emit no placement. RED: change `clinic-knee-pain.ts:53` `x: 0.4` and require a UI-XR capture delta.

**2. Posture remap discards even bundle xyz.** Env/scenario markers win (`actor-posture.ts:137-145`), then seated/supine world helpers overwrite position (`main.ts:846-848`). Amendment: when `supportSurface` is authored, it owns posture; env markers are defaults only. Apply offset relative to the support fixture. Wire `compileScenarioMotion`’s existing map or delete the duplicate.

**3. Three schemas, no baker.** Case uses `{x,y,z}` (`schemas.ts:235-241`); admin and `staging` station use a scalar (`environment-generation-queue-panel.tsx:123`; `catalog.ts:206`; `staging/run.ts:8`). Compile nodes stay `planned_unsplit` and omit offset. Amendment: one record `{supportSurface, plantOffsetMeters:{x,y,z}, anchorId}`; split `actor_placement` so it writes `sceneManifest.actorPlacements`. Do not start Kimodo, a layout solver, or physician approach until brief §7 item 2 is true.

Brief milestone 2 is the right next slice. Milestones 3–6 assume a control that does not exist.

STATUS: ok  
VERDICT: factory-to-runtime gap confirmed  
SUMMARY: Placement authoring and UI-XR assembly both exist; they do not share a data path.  
Recommended next: authored-placement-to-ui-xr-control (Q1)

## Exchange 2: Compatibility challenge and placement contract

### Prompt

Consultation turn 2 of 5, same conversation. Thank you: the exact consumer trace and vector-versus-scalar mismatch sharpen the brief. I challenge two recommendations before accepting them:
1. 'If absent, emit no placement' could break existing un-authored cases: runtime fallback placement is currently required. Distinguish absent AUTHORED INTENT from a resolved legacy/default placement. Preserve absence in the case; do not delete runtime compatibility by accident.
2. TypeBox consts still have TypeScript symbols; an LSP no-result is not proof they are unresolvable language constructs. Report only that this query failed or was incomplete, with grep fallback. Do not infer whole-repo absence from LSP scope.

Please refine the smallest end-to-end placement milestone against these counterexamples. Use existing context, plus at most 6 targeted tool calls if needed. Verify current consumers for support offsets and framing/planting after actor mount; inspect one actual authored case and one un-authored supine case. Specify (a) authored vs resolved record responsibilities, coordinate units/frame, full xyz vector and support instance identity; (b) how to preserve legacy behavior when no intent exists and refuse authored missing/ambiguous supports; (c) which final runtime observation proves the field survives pose/framing rather than merely appearing in a bundle; (d) minimal edited sections to strengthen the brief without prescribing a giant new subsystem. Cite actual files/lines. No code edits, tests that write, board changes, or new agents. Return <=650 words then end this turn.

### Grok response

I’ll treat the two challenges as constraints and verify post-mount plant/framing plus one authored and one un-authored supine case before refining the milestone.Both challenges hold. Absence of authored intent must leave today’s resolved placement in place, and the TypeBox LSP miss is an incomplete query.

## Corrections

**LSP.** `goToDefinition`/`findReferences` on `ActorPlacementSchema` at `schemas.ts:227` returned no results. Grep fallback: the const is there (`schemas.ts:227`), `ActorCard.placement` is at `schemas.ts:304`, and `export type ActorCard = Static<typeof ActorCardSchema>` is at `schema-types.ts:57`. That is a failed/incomplete symbol query, not proof TypeBox consts lack TypeScript types.

**Absence.** `plantOffsetMeters` / `supportSurface` have **no** consumers under `apps/ui-xr` or `packages/openclinxr/xr-*`. Runtime still requires a resolved record: `actor-staging.ts:95-104` (and `:140`, `:185`, `:248`) always `position.set` from `ctx.actorPlacement`. Unauthored `ed-chest-pain.ts:41-43` has no `placement` key; the patient still mounts from hardcoded bundle xyz (`runtime-bundles.ts:1457`) plus `resolveActorPosture` (`actor-posture.ts:130-149`) and `applySupine` (`generated-loaders.ts:140` → `plantSupineBodyOnDeck` at `supine-deck-plant.ts:156`, `:405`). Deleting that fallback would break every bank case except `clinic-knee-pain.ts`.

## Two cases

Authored: `clinic-knee-pain.ts:51-99` — patient/parent `chair` with `{x,y,z}` metres; MA `none` + offset. Unauthored supine: `ed-chest-pain.ts` patient `patient_robert_hayes_v1` with no `placement`; recumbency is scenario/bundle posture, then plant.

## Refined smallest milestone

One overlay, two observations. No solver, no new scene graph.

**(a) Two records, different jobs.**

- **Authored intent** (case only): optional `ActorCard.placement`. `supportSurface: stretcher|chair|none`. `plantOffsetMeters: {x,y,z}` metres from the support origin (`schemas.ts:234-241`). Add **support instance identity** as an existing fixture/equipment id (`stretcher`, `patient_chair`, `family_chair` from current slots), not a new layout type. `none` means standing; offset is then room/world metres on the resolved floor slot. Absence stays absence on the case. Do not backfill the 13 unauthored fixtures.
- **Resolved placement** (runtime compatibility): `sceneManifest.actorPlacements` as today (`slotKind`, world `{x,y,z}`, `verticalOffsetMeters`, `posture`). Produced by `generatedActorPlacement` / `runtimeActorPlacementsForScenario` / `ensureActorPlacementsForStagedSlots`. World metres, station frame used by `actor-staging.ts:104`.

Overlay: if intent exists, write support-relative offset onto the resolved record **after** slot/posture defaults, **before** `position.set`. If intent is absent, leave the resolved record unchanged.

**(b) Legacy vs refuse.** Unauthored (ed chest pain): current path untouched, including supine plant and framing (`main.ts:3120` `applyCleanEncounterVisualReviewActorFraming`). Authored present but invalid (`supportSurface` missing/unknown, `stretcher|chair` with no matching support instance, scalar `plantOffsetMeters` as in `environment-generation-queue-panel.tsx:123`): refuse that actor’s overlay; do not guess a support. Keep the resolved fallback so the station still mounts. Align admin/station scalar to `{x,y,z}` later; this milestone only consumes the case vector.

**(c) Proof that is not the bundle.** After `position.set`, after framing, and after `applySupine`/`plantSupineBodyOnDeck` when supine: read the mounted humanoid **world** XZ (and support-relative delta). Treatment: change `clinic-knee-pain.ts:53` `x: 0.4` → `0.9` and require that delta on the patient Group in UI-XR, surviving seated remap (`main.ts:846-848`). Control: ed chest pain with no case `placement` keeps current stretcher plant (same world pose as today). `window.__openClinXrActorPlacementSsot` and compile `planned_unsplit` nodes are insufficient.

**(d) Brief edits only.** §2 split “authored intent” vs “resolved runtime”; note xr-* does not read `plantOffsetMeters`. §7.1 keep ed chest pain as unauthored supine control. §7.2 replace “emit no placement” with overlay-or-legacy, plus the post-plant/framing observation and support instance id. Do not add §3 volumes/solver.

STATUS: ok  
VERDICT: overlay authored intent onto required resolved placement; prove after plant/framing.

## Exchange 3: Motion maturity and independent evidence

### Prompt

Consultation turn 3 of 5. I accept the authored-intent/resolved-placement distinction and post-framing/post-plant observations. Two corrections: an invalid authored support must block candidate acceptance/promotion; a visible, flagged legacy preview may remain usable but cannot silently satisfy the authored request. Also the example +0.5m offset is not an acceptance tolerance: choose a delta within the measured support envelope. We should not label a direct runtime overlay as fully connected faculty->compile->bundle authoring while the vector/scalar mismatch remains. Please explicitly accept or rebut these constraints.

Now review the MOTION portion of the brief, using ~6 targeted tool calls and <=650 words. Test its claim that canonical semantics + per-rig profile and three executor options are the right boundary. Inspect current implementation (not just September 2 design) for mixer/pose/gaze/physics order, rig alias/twist-chain constraints, contact lifecycle and ActorTurnPlan ownership. Is deterministic runtime goals truly an available baseline or only partially prototyped? Does the historical bakeoff support any architecture recommendation today? What concrete minimum evidence must a motion provider produce to avoid zero-residual/broken-arm and successful-load/no-visible-motion failures? Distinguish imported code, exposed schema, implemented consumer and measured runtime behavior. Recommend exact edits, and identify one tempting overbuild to avoid. No edits, board activity, new agents, tests that write or installs. You remain Grok 4.6 with full repo/LSP/web access. End the turn after your answer.

### Grok response

I’ll accept or rebut those placement constraints first, then inspect the live motion path (mixer/pose/gaze/physics, rig aliases, ActorTurnPlan, bakeoff) rather than the September 2 design.**Accepted, all three constraints.** Invalid authored support fails promotion/acceptance; a flagged legacy preview may still mount and must not count as satisfying the request. The RED offset must stay inside the named support’s measured envelope (AABB/deck), not a 0.5 m jump. A UI-XR overlay of the case vector is a control spike, not faculty→compile→bundle, while admin/staging still use a scalar (`environment-generation-queue-panel.tsx:123`) and Placement nodes stay `planned_unsplit`.

## Motion boundary

Canonical semantics plus a per-rig profile is the right **wire** boundary. Treating three executors as equally available **baselines** is not.

| Layer | What exists |
|---|---|
| Imported | three.js `AnimationMixer`; CCDIK only in the bakeoff harness (`report.json:51`) |
| Schema | `compiled-motion-clip.v1` absolute node-local tracks (`canonical-motion-contract.ts:41-69`); `MotionProgram`; `ActorTurnPlan` |
| Consumer | Mixer policy (`humanoid-animation.ts:55-70`); frame loop (`animation-loop.ts:111-162`); MPFB/Mixamo aliases (`pose-bone-resolver.ts:38-54`) |
| Measured | Bakeoff `verdict: other` on commit `6f5d05d4` (`report.json:67-68`) |

**Frame order (implemented).** `mixer.update` → idle/role posture unless supine or seated-clip-performing → `applyPosturePose("seated")` / `applySupinePoseHoldingIncline` → optional drive gaze/viseme/locomotion (skipped if supine) → `holdSupinePlantFrame` or root breathing sway (`animation-loop.ts:111-162`). Pose is written to survive the mixer (`clinical-idle-posture.ts:168`, `seated-pose.ts:226`). Physics-touch is not in this loop. Contact lifecycle is not: `compileScenarioMotion` emits `constraints: []` (`compile-scenario-motion.ts:280-283`).

**Rig profile.** Aliases map landmarks to **01** segments (`upperarm01L`, `lowerarm01L`), not twist `02` (`pose-bone-resolver.ts:38-42`). Bakeoff notes `chainRoles` used `lowerarm02.R` / `upperarm02.R` as IK hinges (`report.json:68`). Silent skip on unresolved names is still the pose-consumer failure mode (`pose-bone-resolver.ts:4-8`).

**ActorTurnPlan.** `playFrozenActorTurn` owns voice, viseme, affect, gaze/posture, and **named** motion; missing clip drops; no mixer stand-in (`actor-turn-playback.ts:1-7`, `:64-65`). Supine has no mixer (`humanoid-animation.ts:55-57`), so a named body clip cannot play there today.

**Runtime goals.** Isolated CCDIK prototype, not a UI-XR baseline. Zero `CCDIK` hits in `xr-humanoid-animation` / `xr-pose` / `apps/ui-xr`. Planner has no contact solver. `motion_retarget` **runs** Blender `motion_bind_stage.py`; `adapter: "@openclinxr/motion-compiler"` is a plan string (`motion_retarget/run.ts:11-21`).

**Bakeoff today.** Supports one architecture rule: residual-to-goal is not validity (0.0000 m wrist residual with a destroyed right arm, `report.json:51,68`). It does not pick baked vs goals. `baked_tracks` left anatomy intact and still did not clutch.

**Minimum provider evidence** (all of these, after mixer then pose/plant): named clip id actually sampled; visible mesh motion (not `clipPlayed`); limb length/joint graph intact vs rest (blocks zero-residual collapse); if contact is claimed, support or hand mesh within a measured envelope, not wrist residual; twist bones excluded from IK hinges unless the profile marks them effectors; `ActorTurnPlan` identity (planId+turnId+clipId); rig profile hash. Frozen-pose sample (`humanoid-animation.ts:72-76`) is not playback.

**Brief edits.** §4 table: baked clips = partial consumer (idle/role + seated carve-out; supine blocked). Runtime goals = harness-only. Learned = unevaluated. Keep bakeoff as anti-residual-gate, not a winner. Add mixer→pose→plant order and twist-exclusion. Do not call `motion_retarget` compiler integration. Contact/IK after a named clip survives that order on one standing or seated actor.

**Overbuild to avoid:** shipping CCDIK (or Kimodo) into the learner loop as the “available baseline.” That repeats the bakeoff failure class before a clip survives mixer+plant with an intact arm.

## Exchange 4: First-party licenses and hardware claims

### Prompt

Consultation turn 4 of 5. I accept the maturity correction: current clip consumers exist; general runtime-goal/contact execution is experimental, not an established UI-XR baseline. We'll describe only the inspected consumer scope, not infer absence everywhere from an empty planner constraint array. We'll verify bend-vs-twist joint roles rather than imply every twist bone is categorically forbidden, and retain explicit authored failure/promotion behavior.

Now independently pressure-test external research, licensing, and M1 viability. Internet search/fetch is explicitly authorized and enabled. Actually use web_search and primary sources (official repos/model cards/license files). Focus on the highest-impact ~4-6 sources, not an exhaustive survey: Kimodo's exact variant and separately licensed weights/data, ARDY's hardware/streaming vs local deterministic goals, PlaceIt3D's non-commercial license, MPFB code/assets split and build-tool treatment, and optionally the DIP/DiP naming ambiguity. Check whether our sentence requiring permissive code/weights/data overclaims that a permissive code LICENSE clears all assets or unfairly treats pretrained model users as automatically needing training-dataset redistribution rights. The user requires a permissive/non-copyleft stack, so do not relax this requirement; distinguish stages/rights and mark unresolved terms.

Return <=650 words: first-party URLs, verified vs unresolved facts, any concrete correction to the candidate table/hardware plan, and a small decision procedure for choosing ONE candidate after the deterministic control works. Prioritize factual disconfirmation. No installs, paid API experiments, repo edits, board changes, code execution or agents. End this response after answering; final turn will review the amended brief.

### Grok response

I’ll pressure-test licenses and hardware from first-party pages: Kimodo variants, ARDY, PlaceIt3D, MPFB’s split, and the DIP/DiP name collision.NVIDIA Open Model is not Apache, Kimodo-SMPLX is research-only, and ARDY’s text encoder is gated Llama-3. Those three facts change the candidate table.

## License overclaim

Keep the permissive/non-copyleft bar. Split artifacts:

| Artifact | What “permissive” must cover | What it must not demand |
|---|---|---|
| Code | SPDX of the repo | Does not clear weights |
| Checkpoints | The model card license | Does not require redistributing Rigplay/AMASS |
| Body model | SOMA vs SMPL-X, separately | |
| Encoder/runtime deps | Llama, LLM2Vec, CUDA wheels | |
| Outputs | Model license’s output clause | |

Using a pretrained checkpoint is a **weight-license** question. Requiring training-dataset redistribution rights overclaims. Clearing Apache on `LICENSE` and stopping there underclaims.

NVIDIA Open Model Agreement (2 Apr 2026): commercial use and derivatives claimed; NVIDIA does not claim outputs; NOTICE + patent-termination. It is **not** Apache-2.0 / OSI. Unresolved: whether this repo treats that custom grant as “permissive enough” to ship. Do not write “Apache weights.”

## Verified (first-party)

**Kimodo code** Apache-2.0: https://raw.githubusercontent.com/nv-tlabs/kimodo/main/LICENSE  

**Kimodo-SOMA-RP-v1.1** NVIDIA Open Model, “ready for commercial use”: https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1 — SOMA skeleton, Bones Rigplay 1 (proprietary). SOMA-X listed Apache-2.0: https://huggingface.co/nvidia/SOMA-X  

**Kimodo-SMPLX-RP-v1** NVIDIA R&D Model, “non-commercial research use only,” no production, no generating works for sale: https://huggingface.co/nvidia/Kimodo-SMPLX-RP-v1 and https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-internal-scientific-research-and-development-model-license/ — **exclude**.

Hardware (Kimodo docs): Linux, NVIDIA Ampere+, ~17 GB VRAM; `TEXT_ENCODER_DEVICE=cpu` is a CUDA-VRAM split, not an M1 path. https://research.nvidia.com/labs/sil/projects/kimodo/docs/getting_started/quick_start.html  

**ARDY** Apache-2.0 code; checkpoints NVIDIA Open Model; tested Ubuntu 22.04 / RTX 4090; **gated** `meta-llama/Meta-Llama-3-8B-Instruct` for the encoder (~14 GB default). Official: Kimodo = offline authoring, ARDY = online/streaming. https://github.com/nv-tlabs/ardy — Llama is a separate non-Apache gate. ARDY is not a local deterministic-goals substitute.

**PlaceIt3D** non-commercial only; commercially-sponsored research and commercial-lab use excluded; modifications redistributable only back to that GitHub: https://raw.githubusercontent.com/nianticlabs/placeit3d/main/LICENSE.txt — literature, not a candidate.

**MPFB2** code GPLv3 (not AGPL): https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/LICENSE.CODE.md — assets CC0: https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/LICENSE.ASSETS.md — keep as unshipped build tool; do not ship GPL plugin code. Installed third-party packs: unresolved.

**DIP vs DiP:** CLoSD’s **DiP** is Diffusion Planner (https://github.com/GuyTevet/CLoSD/blob/main/README.md). jingyugong/DIP `LICENSE` is MIT text **copyright Guy Tevet 2022** (https://raw.githubusercontent.com/jingyugong/DIP/main/LICENSE) — not independent authorship clearance; SMPL-X/weights still separate.

## Unresolved

M1/MPS for Kimodo or ARDY (no first-party claim). Whether Kimodo’s LLM2Vec path is the same gated Llama. NVIDIA Open Model vs this repo’s OSI bar. Output rights after retarget onto MPFB. Every installed MPFB pack.

## Table / hardware corrections

Name **Kimodo-SOMA-RP-v1.1** (or SEED if public-data lineage is required). Drop SMPLX-RP. Do not list ARDY as the M1 or “reactive goals” path. PlaceIt3D stays citation-only. Fix MPFB row: GPL-3.0-or-later code / CC0 assets. Hardware: eval on CUDA Linux/NVIDIA; M1 Max is not an official runtime.

## One-candidate procedure (after deterministic control)

1. Fail closed: R&D Model, PlaceIt3D, SMPL-X, any Llama-gated encoder unless Llama is separately accepted.  
2. Remaining motion lead: Kimodo-SOMA-RP-v1.1 as **offline clip factory** behind the existing named-clip consumer, if NVIDIA Open Model is accepted as the weight license.  
3. Same frozen case/rig, same bakeoff-class grade (intact limb + visible mesh motion after mixer→pose/plant).  
4. Adopt only if it beats the deterministic clip baseline on that grade. Else keep the baseline; do not start ARDY.

## Exchange 5: Adversarial review of amended brief

### Prompt

Consultation turn 5 of 5, final adversarial editorial review. I have amended the actual brief based on our exchanges. Read it again in full:
docs/openclinxr/scene-layout-consultation-records-2026-09-09/../humanoid-scene-layout-research-brief-2026-09-09.md

Our synthesis deliberately keeps M1-first measurement rather than buying/requiring CUDA hardware, while saying neither official neural setup proves M1 support. It distinguishes download gating from license compatibility (gated does not itself mean prohibited). It does not infer lack of copyright permission from an inherited MIT copyright name. It neither declares NVIDIA Open Model Apache nor relaxes the user's permissive/non-copyleft requirement; adoption is conditional on explicit compatibility and data-provenance review. Invalid authored supports block acceptance/promotion; legacy preview may remain flagged. Case/admin/station vector/scalar alignment and actual final posed-mesh evidence are required before claiming full authoring integration.

Please judge this revised document as the delivered research/architecture brief, NOT as a fully implemented product. Use your prior verified context plus at most 3 targeted checks if necessary. Give: (1) any material factual or architectural errors remaining, with exact replacement wording; (2) whether prototype ordering is strong and appropriately scoped; (3) accepted vs rejected earlier advice, including our corrections to yours; (4) document verdict with any specific unresolved conditions. Do not call runtime functionality or licensing fully proven. If no material issue remains, say that clearly; do not invent extra scope. <=600 words. No editing, board changes, installs, new agents or tests. End the conversation turn after your response.

### Grok response

I’ll re-read the amended brief in full and only run a check if a claim still looks unsupported.The revised brief is a sound research/architecture document. Two wording collisions remain; nothing else is a factual error that would change a decision.

## 1. Remaining issues (replace as written)

**A. Next-milestone sentence pulls in §7.3.** Line 131 asks for authored placement plus correctly placed equipment plus a stationary physician on one slice. §7.1–7.2 already freeze the unauthored supine control and require vector-aligned, post-plant mesh evidence. Physician target is §7.3.

Replace L131 with:  
`**Next implementation milestone:** after the unauthored supine control keeps its resolved defaults, an authored support-relative offset on that same existing supine station (case/admin/compile/bundle vector aligned) is visible on the posed, skinned mesh after framing, pose/plant, and later frame updates. Invalid authored support cannot promote. Stationary physician target stays §7.3.`

**B. “Deterministic goals first” on M1 reopens the maturity correction.** §4 table correctly marks general IK/contact as experimental. L89 can be read as making those the first M1 work.

Replace the first sentence of L89 with:  
`**Apple Silicon M1 Max, 64 GB:** use this machine first for factory output, retargeting, named-clip playback, and already-wired pose/plant. Do not treat general runtime-goal/IK execution as an established local baseline.`

No other material error. PlaceIt3D’s extra commercial-lab ban is already covered by exclusion. Snapshot `1d6d2af1` is the right pin; “clean when inspected” is historical and non-blocking.

## 2. Prototype order

§7.1 → §7.2 → §7.3 → approach → variation/failure → one learned compare is the right order and the right size for a brief. Clinic (authored, not supine) plus ed-chest-pain (supine, unauthored) then authoring onto the supine station is the correct control/treatment, not an overbuild. Learned compare stays behind a legal/execution filter. After L131 is fixed, do not start volumes, a layout solver, CCDIK, or Kimodo in the first slice.

## 3. Advice disposition

**Kept from the reviews:** authored vs resolved records; vector/scalar gap; compile `planned_unsplit`; UI-XR bundle+posture remap; overlay ≠ faculty→runtime; post-framing/plant/mesh evidence; invalid support fails promotion; residual ≠ validity; `motion_retarget` adapter is a plan string; Kimodo-SOMA-RP-v1.1 vs excluded SMPLX-RP; NVIDIA Open Model ≠ Apache; Llama gated ≠ cleared; MPFB GPL not AGPL; DIP ≠ CLoSD DiP.

**Corrected against earlier review advice (accept those corrections):** do not drop resolved placement when intent is absent; do not treat an LSP miss as “TypeBox has no types”; do not infer no-contact from `constraints: []`; do not ban every twist bone; do not treat gated download as prohibited; do not infer missing permission from an inherited MIT copyright line; do not require CUDA hardware; do not use a 0.5 m jump as the RED; flagged legacy preview may mount and must not satisfy the authored request.

## 4. Verdict

**Accept as the delivered research brief** after A and B. It does not prove runtime behavior or license clearance. Unresolved, and already stated: NVIDIA Open Model compatibility and data-provenance review; encoder/body/output terms per checkpoint; M1 neural inference; installed MPFB packs vs the AGPL row; clinician/Quest stages.

STATUS: ok  
VERDICT: brief ready with two sentence replacements; not an implementation claim.

