# Codex consultation record

Five sequential review rounds in one persistent Codex CLI conversation, completed 9 September 2026.

- Model: **GPT-5.5**; client: `codex-cli 0.146.0-alpha.3.1`.
- Conversation ID: `01a0844d-fbd3-70d1-b509-546a0cd8c857`.
- The configured `gpt-6-astra` was rejected by both installed clients as requiring a newer version. Those two startup failures contained no review response and are **not** counted among the five rounds.
- Full repository access: `/Volumes/files/src/openclinxr`, review commit `6ef95b90570b80ffe4356559704a7be88f0cd54d`; unrelated working edits were present.
- LSP: the repository’s installed TypeScript language server, invoked through a local JSON-RPC helper. Round 1 successfully returned document symbols for `shared-schemas/src/schemas.ts`. This was real LSP access through the shell, not a native Codex LSP tool; it does not establish exhaustive cross-package reference coverage.
- Internet: native live web search enabled in every round; first-party searches/opens recorded in rounds 1, 3 and 5.
- Scope: document consultation; repository reads only, no product implementation, inference, benchmarks or runtime captures.

## Review outcome and decisions

The brief retains the original architecture: extend the existing encounter factory, preserve three.js/WebXR and MPFB assets, separate authored intent from resolved placement, and evaluate learned motion against a working baseline. The review did not license-clear any dependency or establish runtime readiness.

Accepted or refined changes:

- **Slot repair and actor identity:** documented the live `ensureActorPlacementsForStagedSlots` override and the fixed four-slot assignment. Physician belongs to the clinical role class but is not guaranteed the first clinical slot. Root independently found this omitted override and required Codex to trace it.
- **Actual motion consumer:** traced UI-XR playback rather than inferring from the voice gateway alone. UI-XR consumes at most the first approved gesture; the current emotion mapper supplies an empty list. General physician motion needs its own executor/plan and coordination with dialogue.
- **Bounded placement work:** defined proposed metre-frame offsets, post-load geometry acceptance, deterministic ranking of valid anchors and explicit failure for unsatisfied authored intent. Root narrowed Codex’s offset example to an illustrative flat-deck control and retained independent contact checks; tangential motion does not guarantee contact on an articulated support.
- **Research selection:** preserved Kimodo as a conditional offline lead, with checkpoint/API/skeleton/MPFB mapping pinned. Root added the first-party model-card limitation that Kimodo is not aware of scene objects. Collision planning and validation remain OpenClinXR responsibilities.
- **Delivery sequence:** cheap source/license/interface research can run alongside the prototype. Actual learned comparison follows eligibility and a usable baseline. Local M1 failure does not invalidate a separately authorized execution option.

Rejected, retracted or limited advice:

- Codex initially proposed learner locomotion evidence and physics-touch logs as an autonomous-physician acceptance shortcut. Root challenged this type/consumer mismatch; Codex retracted it in round 2. Neither establishes an NPC trajectory or collision oracle.
- Codex initially recommended disabling environment transform-affect broadly. It later established that inspected declared equipment mounts directly under `scene`, outside the scaling branch. The brief retains an ancestry-dependent transform-stability check, not a global disable requirement.
- The round-1 single-clip evidence was initially from the voice gateway. The claim was accepted only after the actual UI-XR consumer was traced in round 2.
- A permanent prohibition on refactoring four staging blocks was not adopted. The requirement is preserving observable posture/framing/visibility behavior, not freezing file structure.
- Different 77-joint and 30-joint first-party descriptions were not called a proven upstream defect. Their exact checkpoint/interface relationship remains unverified.
- Redundant license boilerplate, blanket M1-based provider exclusion and postponing desk research until all prototype gates pass were not adopted.

Final round verdict: **accept with exact corrections**. Root applied explicit refusal to substitute another actor when the intended physician is not staged, and separate head/pillow measurement for the tangential offset control. One redundant proposal disclaimer was removed. The custom-weight-license qualifier was retained because it directly serves the user’s licensing requirement. These scoped edits were applied after round 5; no sixth review or runtime validation is claimed.


## Round receipts

| Round | Completed shell commands | Web operations | Completed response |
|---|---:|---:|---|
| 1 | 36 | 3 | Yes; same conversation |
| 2 | 22 | 0 | Yes; same conversation |
| 3 | 4 | 5 | Yes; same conversation |
| 4 | 8 | 0 | Yes; same conversation |
| 5 | 1 | 1 | Yes; same conversation |

The exchanges below preserve the exact prompts and final visible replies. Internal reasoning, raw command outputs and unrelated repository data are excluded. Reviewer assertions remain review input; the brief incorporates only the dispositions above.

## Round 1

### Prompt

You are a separate Codex reviewer in a five-round persistent consultation requested by the user. Exceed expectations: give constructive, evidence-grounded design critique, challenge weak premises, surface overlooked existing capabilities, and propose the smallest useful improvements. Do not manufacture objections or produce approval theater. You have full repository read access and live web search enabled. Read-only consultation: do not modify repository files, dequeue tasks, run autonomy/board loops, install dependencies, or delegate. Existing unrelated working changes must remain untouched. The user authorized this review and internet research.

Review the full brief at docs/openclinxr/scene-layout-consultation-records-2026-09-09/../humanoid-scene-layout-research-brief-2026-09-09.md. The earlier Grok record alongside it is optional context, not authority. Repository: /Volumes/files/src/openclinxr. Inspect current commit and relevant working changes; distinguish them from the brief's pinned snapshot.

LSP access is available through the repository's installed TypeScript language server using this real JSON-RPC helper (not grep):
python3 /Users/patrick/Documents/Codex/2026-09-08/referenced-chatgpt-conversation-this-is-an/work/codex-consultation/lsp-query.py RELATIVE_FILE [documentSymbol|definition|references] [ONE_BASED_LINE ONE_BASED_COLUMN]
It initializes against the full repository. You may also invoke the installed language servers directly. Use at least one successful LSP operation and one live first-party web search in this round to establish capabilities; be accurate about limits.

Round 1 of 5: Independently reconstruct authoring → factory → runtime placement and motion ownership from source. Find at most four high-value corrections or opportunities the Grok review missed. For each show exact file/line evidence, why it matters, a concise replacement passage and a falsifiable check. Prefer observations improving delivery to generic demands for more verification. Tell us what is already strong and should stay. Finish with brief capability receipts and unanswered questions you will investigate in later rounds. Keep response under 1200 words. This is analysis only; root will edit the document.

### Codex reply

**Round 1 Review**

I inspected current checkout `6ef95b90570b80ffe4356559704a7be88f0cd54d`, not the brief’s pinned clean snapshot `1d6d2af...`. The current tree has 57 unrelated working changes, mostly narrowed entrypoints and arch-index churn; the placement/runtime files I cite below showed no local diff in my targeted `git diff` probe.

What should stay: the brief’s core recommendation is right. Preserve three.js/WebXR, MPFB/materialization, canonical motion semantics, frozen actor-turn playback, and the “authored intent is optional and must not backfill measured guesses” stance. The strongest part is the precise vector/scalar placement diagnosis.

1. **Place the new resolver at the existing actor-placement seam, not inside slot staging.**

Evidence: staged assembly makes order a type/runtime contract: room → fixtures → actors → panels → interaction in [station-scene-assembly.ts](packages/openclinxr/xr-station-room/src/station-scene-assembly.ts:31). Actor staging receives `ctx.actorPlacement` as its placement source at [actor-staging.ts](packages/openclinxr/xr-station-room/src/actor-staging.ts:54), and the four slots intentionally differ: patient loads at [actor-staging.ts](packages/openclinxr/xr-station-room/src/actor-staging.ts:95), family stamps posture before framing at [actor-staging.ts](packages/openclinxr/xr-station-room/src/actor-staging.ts:220), additional cast uses a separate fallback at [actor-staging.ts](packages/openclinxr/xr-station-room/src/actor-staging.ts:245).

Why it matters: a generic “resolve layout then loop actors” refactor would erase hard-won slot exceptions.

Replacement passage: “Implement placement resolution as the provider behind `StationActorStagingContext.actorPlacement`, before `stageStationActors` consumes it. Preserve the four slot-specific staging blocks and their stamp/framing order; do not convert slot staging into a generic loop while adding placement.”

Falsifiable check: Typecheck plus a unit test where family seated placement still stamps posture before framing and additional cast remains hidden in clean comparator capture.

2. **Freeze or fence runtime environment transform effects during layout evidence.**

Evidence: the frame loop applies dynamic affect by traversing `gltfEnvContainer` and changing `emissiveIntensity` and `obj.scale.setScalar(s)` when cues include anxious/urgent/parent at [main.ts](apps/ui-xr/src/main.ts:3475). Placement evidence later wants measured mounted geometry and clearances, but this per-frame scale can move measured bounds.

Why it matters: a solver can be correct at load and fail after one frame, or evidence can measure animated geometry rather than authored layout.

Replacement passage: “Placement and clearance evidence must run with environment transform-affect disabled or prove that affect updates are material-only. If runtime affect remains enabled, record pre/post-frame world matrices for support/equipment anchors and reject evidence when dynamic scaling changes them.”

Falsifiable check: with an anxious cue active, sample bed/support/monitor world matrices before and after `renderSceneFrame`; scale and anchor positions must remain unchanged for placement evidence.

3. **Reuse existing locomotion and physics-touch scaffolds for the physician approach milestone.**

Evidence: UI-XR already records examinee locomotion distance, turn, start/current pose and trail in [main.ts](apps/ui-xr/src/main.ts:3287) and publishes `__openClinXrExamineeLocomotionEvidence` at [main.ts](apps/ui-xr/src/main.ts:3441). The package explicitly exports `buildExamineeLocomotionEvidence` at [xr-locomotion/index.ts](packages/openclinxr/xr-locomotion/src/index.ts:24). Separately, deterministic positioning logs already model approach/contact/guide/release at [positioning.ts](packages/openclinxr/arena/physics-touch-contract/src/scenarios/positioning.ts:1).

Why it matters: “clinician approach” need not start as learned motion or a new full-body controller. First prove route/corridor and target semantics with existing deterministic evidence.

Replacement passage: “For the physician approach prototype, first express the bedside target and approach corridor using existing locomotion evidence and deterministic positioning/contact logs. Only after route/clearance checks pass should a clinician body-motion executor be compared.”

Falsifiable check: an approach-corridor test fails when `activeLocomotionSource` is none or when the deterministic path intersects forbidden equipment bounds; passes with a recorded route to the bedside target.

4. **Narrow ActorTurn motion claims to current single-clip ownership.**

Evidence: `ActorTurnPlayback` says motion plays only the named clip and drops missing adapters at [actor-turn-playback.ts](packages/openclinxr/xr-dialogue/src/actor-turn-playback.ts:1). The voice-gateway execution path uses only `plan.gestureClipIds[0]` at [actor-turn-execution.ts](packages/openclinxr/voice-gateway/src/actor-turn-execution.ts:215). Supine playback is still guarded off at [humanoid-animation.ts](packages/openclinxr/xr-asset-loading/src/humanoid-animation.ts:55), then supine pose is reapplied per frame at [animation-loop.ts](packages/openclinxr/xr-humanoid-animation/src/animation-loop.ts:121).

Why it matters: provider/executor language could imply multi-clip, continuous approach, or runtime-goal ownership already fits ActorTurnPlan. It does not yet.

Replacement passage: “Near-term ActorTurn motion ownership is a single approved gesture clip selected from `gestureClipIds[0]`. Longer approach paths, contact goals, or multi-phase clips either need a separate station-motion plan or an explicit ActorTurnPlan schema extension before being claimed as replay-owned actor behavior.”

Falsifiable check: create a frozen plan with two gesture clip ids; current execution should start only the first. A future multi-phase implementation must make the second clip or phase visible in lanes/provenance.

**Capability Receipts**

LSP: `documentSymbol` succeeded on `packages/openclinxr/shared-schemas/src/schemas.ts`, returning `ActorPlacementSchema`, `ActorCardSchema`, and `ScenarioSchema` ranges.

Web: live first-party search reached NVIDIA Research’s Kimodo page, which describes text plus kinematic-constraint motion generation, and current three.js docs including WebXRManager documentation.  

**Later Questions**

I would next verify whether any current tests already protect authored placement through bundle generation, whether dynamic environment scaling reaches support meshes in the loaded scene graph, and whether the latest narrowed entrypoint changes altered public imports relevant to the brief.

## Round 2

### Prompt

Round 2 of 5. Your first review found useful seams, but parts are too speculative. Exceed expectations by correcting your own advice, not defending it. Same read-only scope, full repo/LSP/web available. Keep targeted reads bounded; no need repeat all setup. Root has independently read these files.

1) I challenge your recommendation #3. buildExamineeLocomotionEvidence records learner rig input, not an NPC physician trajectory or collision oracle. Requiring activeLocomotionSource rejects a perfectly valid autonomous physician approach. Physics-touch positioning logs are isolated scaffold, not proof of clinical humanoid applicability. Trace the actual types/consumer and retract or narrow this advice. We want a simulated physician as an actor; the learner viewpoint remains separate. Give a genuinely usable smallest path to stationary target then physician approach, preserving current boundaries.
2) New concrete omission root found: xr-runtime-state/src/runtime-actor-placements.ts ensureActorPlacementsForStagedSlots lines 95-115 replaces existing position when slotKind differs (despite stale 'only adds' file comment); main.ts calls ensureAndPublishActorPlacementSsot around682. runtime-actor-slots.ts assigns fixed roles and caps slots. Explain how this affects authored physician placement and the minimal change the brief needs. Do not expand to arbitrary crowds or invent a parallel scene engine.
3) Your dynamic environment scaling finding needs reachability evidence: are selected support/equipment meshes actually under gltfEnvContainer? Inspect fixture mounting. Separate demonstrated writer from conditional impact. No new globally disabling affect requirement without proof; propose preservation invariant if appropriate.
4) Your single-clip finding traces voice-gateway ActorTurnExecutionPlan rather than necessarily the actual ActorTurnPlan used by UI-XR. Trace both; clarify exact plan type and consumer. Don't force actor navigation into dialogue unnecessarily.

Return a ranked disposition of your own four round-1 suggestions (retain/revise/retract), at most three exact brief edits, and a small implementation ownership table using existing package seams. Evidence file:line required. Under 1100 words. Do not edit files.

### Codex reply

**Ranked Disposition**

1. **Revise R1 #3, mostly retract.** The challenge is correct. `buildExamineeLocomotionEvidence` is learner-rig evidence: it requires `activeLocomotionSource` and `locomotionDelta` before returning anything in [portal-trail.ts](packages/openclinxr/xr-locomotion/src/portal-trail.ts:147), and UI-XR writes it from the camera/locomotion rig path in [main.ts](apps/ui-xr/src/main.ts:3381) and [main.ts](apps/ui-xr/src/main.ts:3441). It must not gate autonomous physician motion. Physics-touch positioning logs are useful vocabulary/test inspiration only; they simulate hand/contact input logs, not a humanoid physician trajectory or collision oracle [positioning.ts](packages/openclinxr/arena/physics-touch-contract/src/scenarios/positioning.ts:1).

Usable smallest path: first resolve a **stationary physician target** as a staged actor placement, then add a separate NPC actor-motion plan/executor that moves that actor to the target. Keep learner locomotion evidence separate.

2. **Retain and strengthen R1 #1.** The correct insertion point remains before `stageStationActors`, but the missing `ensureActorPlacementsForStagedSlots` behavior is decisive. Despite the “only adds” comment in [runtime-actor-placements.ts](packages/openclinxr/xr-runtime-state/src/runtime-actor-placements.ts:15), the implementation overwrites position/scale from slot anchors whenever existing `slotKind` differs [runtime-actor-placements.ts](packages/openclinxr/xr-runtime-state/src/runtime-actor-placements.ts:98). UI-XR calls this during bundle activation [main.ts](apps/ui-xr/src/main.ts:669). Physician placement is therefore also governed by fixed slot assignment: patient, clinical, family, additional, max four [runtime-actor-slots.ts](packages/openclinxr/xr-runtime-state/src/runtime-actor-slots.ts:19), with physician in clinical role class [runtime-actor-slots.ts](packages/openclinxr/xr-runtime-state/src/runtime-actor-slots.ts:31).

3. **Revise R1 #2.** Demonstrated writer: yes, `gltfEnvContainer.traverse` can mutate child scale [main.ts](apps/ui-xr/src/main.ts:3475). Demonstrated impact on selected support/equipment: not from inspected mounting. Generated room GLB is added under `gltfEnvContainer` [xr-station-room/index.ts](packages/openclinxr/xr-station-room/src/index.ts:188), but fallback bed/monitor are added directly to `scene` [xr-station-room/index.ts](packages/openclinxr/xr-station-room/src/index.ts:323), and declared equipment slots are also added directly to `scene` [main.ts](apps/ui-xr/src/main.ts:3032). So no global affect disable recommendation. The invariant should be: support/equipment anchors used for placement evidence must be outside dynamic transform writers or prove stable world matrices across a frame.

4. **Retain R1 #4, but clarify consumer.** I over-emphasized voice-gateway. The shared `ActorTurnPlanSchema` has `gestureClipIds` [schemas.ts](packages/openclinxr/shared-schemas/src/schemas.ts:115); scenario-runtime fills them from emotion-performance mapping [actor-turn-plan.ts](packages/openclinxr/scenario-runtime/src/actor-turn-plan.ts:157), which currently returns an empty array [emotion-performance-mapper.ts](packages/openclinxr/conversation-policy/src/emotion-performance-mapper.ts:235). UI-XR’s actual path calls `playFrozenActorTurnOnSlot` [main.ts](apps/ui-xr/src/main.ts:4349), which passes response clip names as approved clip IDs [actor-turn-playback.ts](packages/openclinxr/xr-dialogue/src/actor-turn-playback.ts:297), and `playFrozenActorTurn` consumes only `gestureClipIds[0]` [actor-turn-playback.ts](packages/openclinxr/xr-dialogue/src/actor-turn-playback.ts:206). Actor navigation should not be forced into dialogue.

**Exact Brief Edits**

1. Add to the placement gap paragraph:

“Current runtime placement has a second override point: `ensureActorPlacementsForStagedSlots` mutates the activated bundle and re-anchors an existing placement when the assigned runtime slot kind differs. This protects stale slot tags, but it means authored physician placement must either match the assigned fixed slot or carry explicit precedence/provenance through this function. Physician is assigned as `clinical_team` before family/additional; the runtime currently stages at most four humanoid slots.”

2. Replace the physician approach milestone wording with:

“First prove a stationary physician target: a physician actor assigned through the existing clinical slot class receives a resolved world position/orientation without being overwritten by slot fallback repair. Then add a separate NPC actor-motion plan that moves the staged physician to that target. Learner locomotion evidence may remain useful for learner-route QA, but it is not acceptance for autonomous physician motion.”

3. Add to motion ownership:

“Do not route general navigation through `ActorTurnPlan` unless the schema is deliberately extended. Today UI-XR actor-turn playback consumes a frozen `ActorTurnPlan` for speech/viseme/affect/gaze/posture and at most the first approved gesture clip; stationary placement and longer physician approach should be owned by scene placement plus a separate actor-motion executor.”

**Implementation Ownership**

| Slice | Owner Seam | Scope |
|---|---|---|
| Authored stationary physician target | `xr-runtime-state/runtime-actor-slots.ts`, `runtime-actor-placements.ts` | Slot assignment and precedence so authored clinical placement survives repair. |
| Runtime staging consumption | `xr-station-room/actor-staging.ts`, `apps/ui-xr/main.ts` | Consume resolved actor placement through existing `ctx.actorPlacement`, preserve four slot-specific blocks. |
| Equipment/support invariant | `xr-station`, `xr-station-room`, UI-XR evidence | Prove placement anchors are not under dynamic transform writers or record stable pre/post-frame matrices. |
| Physician approach | `motion-compiler` plus `xr-humanoid-animation`/actor runtime adapter | Separate NPC motion plan/executor targeting the resolved physician placement; dialogue only triggers gestures when appropriate. |

## Round 3

### Prompt

Round 3 of 5. Retractions from round 2 are valuable: keep simulated physician and learner locomotion separate; treat gltfEnvContainer scaling impact as conditional. Now improve the research decision, not its volume. Same read-only scope; internet explicitly permitted. Do not repeat setup/skill reads; use targeted first-party checks.

The brief already distinguishes factory governance from baked clips and unproven runtime IK, and lists every candidate requested by the user. Challenge whether its candidate prioritization is actionable. Test the strongest case AGAINST Kimodo-SOMA as the first conditional offline lead, and the strongest case FOR it, using exact control coverage and MPFB retargeting burden (not attractive videos). Check official source for its skeleton/interface and installed/execution assumptions. Contrast ARDY streaming and a scene-aware candidate (DIP or AffordMotion) only where it changes the prototype choice. Do not remove any named candidate from the brief.

Critically evaluate the permissive/non-copyleft requirement (code, weights, data, dependencies, outputs). Do not silently relax it, or equate commercial permission with clearance, or require distributing training data merely to infer. Existing MPFB is a GPL build-tool/assets split with an existing scoped repository exception; do not invent blanket approval. Exact unsupported details stay marked unverified.

Deliver: (1) a compact go/no-go decision path for first learned-provider evaluation including when to stop and keep baseline; (2) up to three concrete factual corrections or useful improvements with first-party URLs and source file:lines where relevant; (3) an honest M1 Max 64GB evaluation order requiring neither a CUDA purchase nor a false MPS claim. For any claimed license inspect the actual license/model-card source, not search snippets or website footer. No model downloads/inference/installs. Under 900 words, preferably <=10 targeted tool calls. Do not edit files.

### Codex reply

**Decision Path**

Go/no-go for first learned-provider evaluation:

1. **Baseline first.** Keep deterministic/static supine + stationary physician target as the acceptance control. A learned provider is only evaluated after the target world transform, actor slot, support/contact windows, and replay identity are measurable in UI-XR.

2. **Legal gate.** Stop before install/inference if code, model weights, required encoder/body model, sample data, dependencies, or output rights are incompatible or unclear. Kimodo code is Apache-2.0 in its repo license, but SOMA-RP-v1.1 weights are under NVIDIA Open Model, not Apache; that license allows commercial use and says NVIDIA claims no output ownership, but has conditions, termination clauses, Trustworthy AI terms, and separate-component carveouts.  

3. **Interface gate.** Stop if Kimodo output cannot be deterministically converted to OpenClinXR’s compiled motion contract: absolute node-local rotations/translations with explicit interpolation [canonical-motion-contract.ts](packages/openclinxr/motion-compiler/src/canonical-motion-contract.ts:35). SOMA-to-MPFB is not a simple name map; MPFB has a richer 137-joint hierarchy and existing aliases only solve landmark lookup, not retarget quality [pose-bone-resolver.ts](packages/openclinxr/asset-registry/src/pose-bone-resolver.ts:4).

4. **Local execution gate.** Stop and keep baseline if an existing M1 path cannot run without new CUDA hardware, unsupported MPS claims, or unacceptable cold/warm generation time. Do not buy hardware for round one.

5. **Value gate.** Stop and keep baseline if Kimodo cannot beat the deterministic/baked baseline on the same case, rig, target, contact/support, visible quality, retarget cost, and evidence survival.

**Kimodo Case**

Strongest case **for** Kimodo-SOMA first: it has the most directly relevant control surface for the prototype. Official README lists text plus full-body keyframes, end-effector positions/rotations, 2D paths, and waypoints; CLI output includes root positions, local/global rotations, and foot contacts. That maps better to “physician approaches target” than pure scene affordance demos. It is offline, so it fits factory governance better than a streaming runtime service. 

Strongest case **against** Kimodo-SOMA first: it is not MPFB-native. The repo README says current inputs/outputs use SOMA 77-joint `somaskel77`, while the SOMA-RP-v1.1 model card says joint rotations are `num_frames x 30 x 3 x 3`; the brief should flag this apparent first-party mismatch instead of assuming a settled skeleton size.   OpenClinXR’s retarget station is only a Blender subprocess seam plus adapter label today [motion_retarget/run.ts](packages/openclinxr/factory-stations/src/motion_retarget/run.ts:11), and supine playback still disables normal mixer playback [humanoid-animation.ts](packages/openclinxr/xr-asset-loading/src/humanoid-animation.ts:55). So Kimodo is a candidate, not a shortcut.

ARDY changes the decision only by being a worse first fit: official ARDY currently lists Core and G1 checkpoints, says SOMA is “coming soon,” requires a gated Meta-Llama-3-8B-Instruct text encoder, and has TensorRT/NVIDIA-specific acceleration notes. Streaming is interesting later, but it adds live latency/cancellation burden before MPFB retargeting is solved. 

AffordMotion changes the decision by reinforcing the “scene-aware later” lane. It is attractive for affordance maps, but first-party setup uses PyTorch 1.12/CUDA 11.3, preprocessed data/checkpoints from OneDrive/Baidu, and body model folders; MIT code does not clear weights/data/body models. ([github.com](https://github.com/afford-motion/afford-motion)) ([raw.githubusercontent.com](https://raw.githubusercontent.com/afford-motion/afford-motion/main/LICENSE))

**Brief Improvements**

1. Add: “Kimodo-SOMA is the first conditional offline lead because its official controls cover root paths/waypoints and effectors, not because of visual demos. The go/no-go hinge is SOMA-to-MPFB retargeting into OpenClinXR’s absolute node-local motion contract.”

2. Add correction: “First-party Kimodo materials appear inconsistent or underspecified on SOMA joint count: README says `somaskel77`; SOMA-RP-v1.1 model card lists joint rotations with 30 joints. Treat skeleton/interface as unresolved until the exact downloaded checkpoint config is inspected.”

3. Tighten licensing: “Commercial permission and ‘no output ownership claim’ are positive signals, not clearance. Record model license conditions, separate components, encoder/body-model terms, and output use terms. Inference does not require redistributing training data, but proprietary training data still belongs in the provenance/risk manifest.”

**M1 Max Order**

1. Legal/interface review only, no downloads.
2. Inspect Kimodo package metadata and checkpoint config only if legally allowed.
3. Try existing local Python/PyTorch capability without installing or purchasing CUDA; do not claim MPS support unless upstream or a local dry run proves it.
4. If text encoder can be CPU-offloaded and model can run on available hardware, measure one <=10s constrained path clip.
5. If not, stop and keep deterministic/baked baseline; optionally run Kimodo later on already-authorized remote NVIDIA hardware, still behind the same evidence gates.

## Round 4

### Prompt

Round 4 of 5. Root has revised the output brief with source-verified round-2 findings; read it again at the same outputs path. All 41 local references matched review commit 6ef95b90; working changes are unrelated and remain untouched.

Challenge your round-3 advice constructively: legal/interface desk review can occur before the baseline demonstration; learned inference/comparison remains later. Avoid implying we must postpone cheap research until every prototype check passes. A missing M1 implementation need not globally disqualify a provider with an already-authorized execution path. We retain Kimodo as a conditional lead, not a ranked winner. README77 vs model-card30 may describe different abstraction/version levels: specify exact checkpoint/API/rig pinning, not assert a defect or guess which is true. Most license text you propose repeats the current brief; don't add redundant gates.

Now focus on implementability and concision. Find two or three high-value remaining weaknesses; if fewer exist, say so. Specific questions:
- 'Support-local offsets in metres' plus 'account for scale once' is ambiguous with a scaled/rotated GLB. Recommend a small testable coordinate contract and example that preserves mattress contact (tangential offset versus normal lift); distinguish proposed semantics from current code. Do not invent clinical clearance dimensions.
- Should first resolver use bounded enumerated anchors with deterministic tie-breaking instead of suggesting a general optimizer prerequisite? Ground in existing fixed anchors. Keep eventual seeded variation without claiming bit-identical learned inference or cross-platform physics.
- Does concise package ownership accurately reflect runtime slot repair, async mounted support geometry, and existing slot-specific staging? No arbitrary 'never refactor four blocks' restriction unless required by behavior.
- Current ActorTurn mapper emits empty gestureClipIds; should one short qualifier prevent support-for-a-lane being mistaken for automatically produced gestures?

Return exact short replacements plus the strongest objection to each recommendation and your response. Keep under 900 words and minimize repeated source reads. No edits. Round 5 will review the actual final amended document, so make this round decisive rather than another generic wish list.

### Codex reply

I find three remaining weaknesses worth fixing. The revised brief is otherwise strong enough; I would not add more provider/licensing boilerplate.

**1. Coordinate Contract**

Replacement for “support-local `{x,y,z}` offset… account for mount rotation, scale and support geometry once”:

“Proposed placement semantics: resolve a named support anchor after the selected fixture/equipment has been mounted, footprint-fit, grounded and deck metadata stamped. Interpret `plantOffsetMeters` in the support deck frame: `x` and `z` are tangential metre offsets on the deck plane, `y` is a normal offset from the deck contact plane. Apply the support’s world rotation once and use normalized frame axes so GLB scale/footprint fitting is not double-applied. For the first milestone, accept tangential offsets with `y = 0`; a positive `y` is a deliberate lift and is not support-contact evidence unless a later contract explicitly authorizes it. Example: on the stretcher deck, `{x: 0.15, y: 0, z: 0}` shifts the actor 15 cm along the deck while preserving measured mattress/back contact; `{x: 0.15, y: 0.03, z: 0}` is a 3 cm normal lift and should fail the contact-control check.”

Evidence: support surfaces expose deck top metadata in [station-equipment-support-surfaces.ts](packages/openclinxr/xr-station/src/station-equipment-support-surfaces.ts:47); GLB equipment fitting/grounding runs before support metadata stamping in [station-equipment.ts](packages/openclinxr/xr-station/src/station-equipment.ts:345); equipment placement currently supplies world position only in [station-equipment.ts](packages/openclinxr/xr-station/src/station-equipment.ts:428).

Strongest objection: “This invents a detailed coordinate system before the resolver exists.”  
Response: yes, but it is the smallest testable contract. Without it, “support-local” and “scale once” are not falsifiable, especially for scaled GLB supports.

**2. First Resolver Scope**

Replacement for deterministic solving paragraph / step 3:

“First resolver: use a bounded enumerated-anchor resolver, not a general optimizer. Inputs are authored actor/support IDs plus existing runtime anchors: fixed slot anchors, declared equipment placements, and support deck anchors after mounting. Tie-break deterministically by explicit authored target first, then exact actor ID, then existing slot priority and stable ID order. Return either one resolved transform with provenance or explicit unsatisfied constraints. Seeded variation may later choose among equivalent valid anchors, but do not claim bit-identical learned inference or cross-platform physics.”

Evidence: fixed slot anchors are already enumerated in [runtime-actor-placements.ts](packages/openclinxr/xr-runtime-state/src/runtime-actor-placements.ts:27), runtime repair maps staged slot index to slot kind in [runtime-actor-placements.ts](packages/openclinxr/xr-runtime-state/src/runtime-actor-placements.ts:73), and actor staging consumes placement through one seam in [actor-staging.ts](packages/openclinxr/xr-station-room/src/actor-staging.ts:54).

Strongest objection: “A bounded resolver may underfit real rooms.”  
Response: true later. For the first milestone, underfitting is a feature: it makes authored placement, slot repair, and support contact debuggable before adding solver search.

**3. Ownership And Gesture Qualifier**

Replacement for “Implementation seams” and ActorTurn sentence:

“Implementation seams: align authoring/compile/staging payloads in `shared-schemas`, admin and factory code; resolve slot identity and placement precedence in `xr-runtime-state`; consume resolved placement through `StationActorStagingContext.actorPlacement` in `xr-station-room`. Preserve observable slot-specific behavior, including posture/framing order and comparator visibility, with tests; refactoring the four staging blocks is acceptable only if those behaviours remain protected. Add physician approach as a separate actor-motion executor/plan, coordinated with dialogue only when a dialogue turn owns a gesture.”

Add short qualifier near ActorTurn playback:

“Current emotion-performance mapping emits `gestureClipIds: []`; the motion lane exists, but gestures are not automatically produced by today’s mapper.”

Evidence: slot staging has special observable behavior around placement/framing [actor-staging.ts](packages/openclinxr/xr-station-room/src/actor-staging.ts:90); runtime slot repair may overwrite mismatched placements [runtime-actor-placements.ts](packages/openclinxr/xr-runtime-state/src/runtime-actor-placements.ts:98); playback consumes only the first approved gesture clip [actor-turn-playback.ts](packages/openclinxr/xr-dialogue/src/actor-turn-playback.ts:206); the current mapper emits no gesture clips [emotion-performance-mapper.ts](packages/openclinxr/conversation-policy/src/emotion-performance-mapper.ts:235).

Strongest objection: “This weakens the useful warning against collapsing slot staging.”  
Response: it makes the warning enforceable. The real requirement is behavior preservation, not the current file shape forever.

One round-3 correction to carry forward: cheap legal/interface desk review can happen now, before the baseline demo. Only learned inference/comparison waits for the baseline. A missing M1 path should block local-first claims, not disqualify a provider that has an already-authorized execution path.

## Round 5

### Prompt

Round 5 of 5: final adversarial review of the ACTUAL amended brief at the same outputs path. Read it in full. Do not give ceremonial approval: challenge whether a competent implementer could choose the wrong next action or falsely claim readiness. Same read-only repo/LSP/web permissions; no setup repetition, no file edits.

Root incorporated: optional intent vs resolved defaults, fixed-slot repair, simulated physician vs learner rig, true UI-XR first-gesture path plus empty mapper qualifier, conditional affect impact, normalized metre-frame offsets with a 5 cm illustrative flat-deck control (not clinical dimensions), post-load support geometry, bounded anchor search with hard constraints before ranking, deterministic resolver vs learned inference distinction, cheap desk review allowed early, and checkpoint/API/rig pinning. Root independently checked Kimodo model-card statement that it is not aware of scene objects and added external collision planning/validation responsibility. This is more important than treating 77-vs30 as a proven upstream defect. All named user candidates remain.

Final scrutiny:
1) Any new assertion false, unsupported, or too strict? In particular factory metadata vs runtime async load, deck-frame example vs head/pillow contact, physician not guaranteed first clinical slot, and hardware/licensing gates.
2) Does 'canonical semantics with per-rig mappings' preserve existing assets and architecture without implying learned generation already plugs in? Is there an exact next deliverable, not a giant all-at-once rebuild?
3) User requested concise, strong brief. Identify up to TWO short cuts that remove repetition without losing requested topics. Do not replace it with a new long checklist.
4) Give accept / accept with exact corrections / reject and no more than three prioritized residual items. For each separate proven issue from proposal. List suggestions from earlier rounds you now consider retracted or conditional, so record is honest. Under 700 words. Prefer <=6 targeted source/tool calls after reading doc. No need rerun source scans that already established the same claim.

This is the final consultation turn. Root will independently verify and apply any justified exact corrections and save the five-round record, then deliver the brief. Your agreement is not runtime or licensing clearance.

### Codex reply

**Decision: Accept With Exact Corrections**

The amended brief is now implementable. I do not see a false readiness claim. It still avoids the big failure modes: it does not treat learned motion as plugged in, does not confuse learner locomotion with a simulated physician, does not claim Kimodo scene awareness, and gives an exact next milestone instead of a giant rebuild.

**Residual Items**

1. **Proven Issue: Step 3 still lets an implementer assume the intended physician will be staged.**  
The brief correctly says earlier that physician is in the clinical role class but is not guaranteed first clinical slot. Later, step 3 says “Place the intended physician actor, identified through existing slot assignment,” which is close but should explicitly fail if that actor is not staged. Otherwise an implementer might place the first clinical actor and claim physician placement.

Exact correction:
“Place the intended physician actor only if fixed slot assignment stages that actor; otherwise report `intended_physician_not_staged` and do not claim physician placement. If staged, resolve that actor’s bedside target facing the patient, with equipment/body checks, approach-zone check and monitor visibility.”

2. **Proposal: Clarify the flat-deck offset control is not expected to preserve pillow contact automatically.**  
The amended coordinate contract is good: normalized metre-frame, `x/z` tangential, `y` normal, no double scale, proposed not current. The only subtle risk is the example. A 5 cm tangential shift can preserve mattress contact but may alter head/pillow contact depending on axis and pillow size. The paragraph already says “subject to contact/envelope checks,” so this is not false, but one word would prevent a bad test.

Exact correction:
“For the first flat-deck control, `{x: 0.05, y: 0, z: 0}` requests a 5 cm tangential shift, subject to mattress/support contact and envelope checks; pillow/head contact is measured separately.”

3. **Proposal: Keep cheap provider desk review clearly parallel to prototype work.**  
The hardware/licensing section is now balanced: early desk review allowed, inference waits, missing M1 does not disqualify an authorized path. No correction required unless root wants even tighter wording.

**Two Short Cuts**

1. In the authored placement paragraph, remove the second sentence ending “These are proposed rules, not currently implemented fields or precedence.” The paragraph already says “This is proposed semantics, not current implementation...” and the repetition slows the brief.

2. In §6, cut the final sentence of the first paragraph if length matters: “Custom weight licenses need explicit compatibility review...” is already covered by the preceding “Record version/hash...” and the Kimodo table row. Keep it only if the audience tends to equate “commercial use” with clearance.

**Earlier Advice Retracted Or Conditional**

Retracted: using `buildExamineeLocomotionEvidence` as an acceptance gate for autonomous physician motion. It is learner rig evidence only.

Retracted as global claim: disabling affect-driven `gltfEnvContainer` scaling. The writer is real, but support/equipment impact is ancestry-dependent; the correct requirement is a stable-anchor invariant or revalidation.

Conditional: “single first gesture clip” remains true for current UI-XR ActorTurn playback, but it should not force navigation into dialogue. Physician approach belongs in a separate actor-motion executor unless a dialogue turn explicitly owns a gesture.

Conditional: Kimodo-SOMA remains a reasonable first learned-provider desk-review lead, not a winner. Checkpoint/API/rig pinning and scene-collision validation are still required before inference comparison.

## Artifact integrity

Final brief SHA-256: `e39499c95209837a03ff281a4e166e69020581e858c1e4aa95d691aaf9bc26e9`. This identifies the reviewed deliverable; model agreement is not runtime validation or license clearance.
