# OpenClinXR humanoid and scene-layout research brief

**Rebuilt 8 September; reviewed and revised 9 September 2026 · codebase-grounded research and implementation brief**

**Recommendation:** extend the existing encounter factory with initial scene planning, authored spatial relationships, measurable placement constraints and interchangeable motion executors. Preserve three.js/WebXR, the MPFB2 pipeline, canonical motion semantics and the actor-performance/replay system. Evaluate learned providers against that baseline before adopting one.

## 1. Scope, evidence and goals

Repository: `/Volumes/files/src/openclinxr`. The original rebuild inspected clean commit `1d6d2af1eaeac9c1be5b93dd8ac9aefaba429ce9`; the Codex consultation rechecked placement and playback at **`6ef95b90570b80ffe4356559704a7be88f0cd54d`** amid unrelated local edits. Recent commits narrow package entrypoints and preserve the wired scene builder, reinforcing explicit package contracts. Grok’s additional review checked `155e35ba618ba6a4da0023fa81c7c2d41196e39a`; the cited placement mechanisms remain unchanged across these commits. Local links follow the checkout; the recorded commits anchor the observations. External sources were inspected on 8–9 September 2026. No motion-model inference, runtime captures or benchmarks were performed for this brief.

Consultation: five sequential exchanges with Grok 4.6 through the local CLI, with repository inspection, LSP and first-party web access. The fifth review accepted the brief subject to two wording corrections, applied here. The [Grok record](docs/openclinxr/scene-layout-consultation-records-2026-09-09/grok-4.6-consultation-record.md) preserves those exchanges. Five further rounds with Codex **GPT-5.5** used the full repository, TypeScript LSP and live web access; the configured Astra model was unavailable through the installed CLI. Its final review accepted with two targeted corrections, applied here. The [Codex record](docs/openclinxr/scene-layout-consultation-records-2026-09-09/codex-consultation-record.md) records the challenges, retractions and decisions. Two additional Grok rounds then reviewed the Codex revision in the original conversation; the [rounds 6–7 record](docs/openclinxr/scene-layout-consultation-records-2026-09-09/grok-4.6-additional-rounds-6-7.md) records further corrections and retractions. The initial-scene scope addition was subsequently reviewed by Claude Opus 5 against `9c6d56f0a95f46537759aa443ab27c858170ec4a`; source-backed corrections and one rejected transition suggestion are in the [Claude review](docs/openclinxr/scene-layout-consultation-records-2026-09-09/claude-initial-scene-planner-review.md). Four further Grok exchanges continued the original conversation with current first-party research and repository/LSP checks; the [rounds 8–11 record](docs/openclinxr/scene-layout-consultation-records-2026-09-09/grok-4.6-research-rounds-8-11.md) records challenges, retractions and the final accepted wording corrections. Model agreement is not runtime or license verification.

Evidence labels distinguish **implemented** source paths, **recorded** earlier measurements, **proposed** extensions and **unverified** claims. Source inspection establishes a mechanism, not end-to-end readiness. This brief supersedes the earlier conversation-derived artifact; it does not supersede repository policy or settle unresolved product decisions.

Prototype scope: the physician is a simulated humanoid actor; the learner’s camera/locomotion rig is separate. Existing learner movement logs do not validate an autonomous physician path. [Learner evidence][R36]

Goals: produce case-driven encounters with correctly supported patients, useful clinician positions, accessible equipment and reproducible variation; keep assets and behavior reviewable through the real learner runtime. The product is a clinical-skills simulation platform, and geometry or animation evidence alone does not establish clinical validity. The repository's governing direction is blueprint-to-runtime generation, review/persistence/replay and factory verification—not a collection of separately authored demonstrations. [Project contract][R1], [factory guardrails][R2]

## 2. Current foundation and the gaps to close

| Area | Current codebase state | Consequence for this work |
|---|---|---|
| Runtime and package structure | **Implemented:** three.js/WebXR; ordered room → fixtures → actors → panels → interaction assembly is wired into UI-XR. Runtime responsibilities are being extracted into focused packages. | Extend existing assembly and package boundaries; no second rendering engine or parallel scene graph. [Assembly contract][R3], [live caller][R4] |
| Authored placement | **Implemented:** `ActorCard.placement` supports `stretcher`, `chair`, `none` and support-relative offsets. Authored placement emits compile nodes marked `planned_unsplit`. | The case vector, admin/station scalar and compile-node payload disagree; no complete authored-placement consumption path is established. [Schema][R5], [compile nodes][R6] |
| Runtime layout | **Implemented:** generated bundles still contain fixed actor positions and cycle equipment through fixed anchors; posture logic also adjusts placement. | Connect authored intent to one resolved layout; preserve legacy defaults only where intent is absent. [Bundle placement][R7] |
| Equipment | **Accepted direction:** bank-and-place, thin parametric builders and modular kits. Existing metadata identifies equipment and deck heights. | Reuse catalogue assets and support metadata; add functional envelopes to those records. [Equipment lanes][R8], [support metadata][R9] |
| Humanoids and motion | **Implemented:** MPFB materialization, rig aliases, retargeting and a motion compiler contract. The `motion_retarget` station executes Blender; its compiler adapter name is a plan string. | Build on these seams, but require proof that exact generated motion reaches the consumer. A named adapter is not integration. [MPFB bind stage][R10], [retarget runner][R11] |
| Supine support | **Implemented:** deck planting and per-frame posture preservation; normal ongoing animation playback is disabled for supine actors to preserve planting; temporary fixed-pose sampling remains possible. | Use static supine support as an existing control. Patient animation needs a posture-safe playback path. [Deck plant][R12], [mixer guard][R13] |
| Coordinated performance | **Implemented:** frozen `ActorTurnPlan` playback joins voice, visemes, facial affect, gaze/posture and named motion. | New motion must respect existing event ownership, identity, interruption and replay. [Playback contract][R14] |

MADR 0048 already argues for extending existing placement with resolve-and-validate behavior and evolving fixture slots into anchors. Its historical measurements are not current defect counts; its anti-duplication reasoning remains relevant. Also, the production station catalogue and dark-factory execution chain are distinct: adding a catalogue entry does not wire a new producing/consuming stage. [Placement rationale][R15], [catalogue][R16], [execution chain][R17]

**The placement gap is specific.** Case `plantOffsetMeters` is `{x,y,z}`, while admin authoring and the staging station accept a number. Placement compile nodes omit the authored vector; the dark-factory placement stage supplies `0` and passes posture under `supportSurface`. UI-XR reads resolved bundle placements, then replaces seated/supine positions through posture helpers. Fixing one displayed node or adding an offset only in a runtime preview does not close this chain. [Admin value][R27], [station payload][R28], [factory caller][R29], [runtime remap][R30] Runtime activation also re-anchors existing records when their `slotKind` differs from the assigned slot, despite an older “only adds” comment. Preserve authored placement through this repair seam. Fixed assignment prioritizes patient, first clinical actor, family and additional cast, with at most four visible humanoids; physician belongs to the clinical role class but is not guaranteed the first clinical slot. [Slot repair][R37], [assignment][R38]

## 3. Recommended pipeline and ownership

```text
Reviewed case activities + existing room/asset catalogue + variation identity
  → Initial scene planner: required contents, room and starting states
  → Reviewed initial scene specification in the existing authoring / compile graph
  → Resolved semantic relationships, anchors and operational volumes
  → Deterministic placement resolution + independent geometry checks
  → Equipment transforms, patient support, clinician target and approach corridor
  → Motion plan in canonical semantics + actual rig capability profile
      ├─ existing / offline-generated validated clips
      └─ deterministic runtime goals, where supported and validated
  → Candidate assets / descriptors + provenance + measured evidence
  → Real UI-XR consumption, review and promotion
  → three.js/WebXR playback, coordinated actor performance and replay

Later research option: learned streaming motion behind the same governed interface
```

This pipeline is **proposed integration**, not a claim that every arrow is wired. Preserve case authoring and faculty locks; record generated proposals before execution. Align the case, admin, compile-node and station payloads before claiming faculty-to-runtime placement is connected. An LLM may propose structured relationships or authoring choices, but should not write live transforms or invent clinical signs from emotion or phenotype. Keep the motion DSL as compiler input rather than faculty-facing authoring vocabulary. The repository's full motion design makes that authored-content boundary explicit. [Motion design][R18]

**Implementation seams:** align authoring/compile/staging payloads in `shared-schemas`, admin and factory code; resolve slot identity and placement precedence in `xr-runtime-state`; consume placement through `StationActorStagingContext.actorPlacement` in `xr-station-room`. Preserve slot-specific framing/posture order. Add motion execution through the existing compiler/animation adapters and explicit package exports, rather than expanding UI-XR orchestration. These are proposed integration owners. [Staging seam][R35], [slot repair][R37]

### Initial scene planner: requirements before placement

**Scope addition — proposed:** decide what the selected encounter needs in the room and its starting condition, before solving positions. Extend the existing case/factory graph with a reviewable **initial scene specification**; this is a compiled view of case intent, not a second source of clinical truth. Existing `ScenarioSchema` provides objectives, actors, event schedule and optional environment/equipment/asset needs; `EnvironmentManifestSchema` groups asset requirements. These are inputs, not proof of a complete requirements-to-starting-scene planner. [Case inputs][R50], [environment manifest][R51]

The planner performs four bounded steps:

1. **Resolve activity requirements.** Map reviewed case activities to required people, equipment capabilities, access and visibility needs using explicit authored choices and reviewed rules. Each requirement records its source activity/rule. An LLM may suggest additions for review; it must not infer authoritative clinical setup solely from a diagnosis or fill missing case facts silently.
2. **Choose contents and room.** Select a compatible existing room template, retaining fixed doors, walls and installed services. Case `equipment` currently contains descriptive strings while `assetNeeds` carries asset IDs; define an explicit reviewed binding and precedence, rather than assuming the strings are catalogue keys. [Authored equipment][R55] Bind the first slice to existing catalogue assets and runtime `equipmentId` values, distinguishing required-at-start, optional and intentionally absent items. Runtime placements are keyed by `equipmentId`; multiple copies of an asset need distinct realized identities and proven consumer support, not an assumed separate instance facility. [Equipment identity][R54] Record unavailable requirements and explicit approved alternatives. If no permitted combination fits, return the conflict rather than silently dropping items or generating a new room. “Needed later” does not automatically mean present or connected at the start.
3. **Specify initial state.** Record each actor's presence, pose and starting anchor; each object's relevant authored state, such as support incline, rail position, power or connection status, only where a runtime consumer can represent it. Keep actor starting poses separate from later destination poses. A monitor being present does not prove it is powered, connected or showing the correct case data. Use case-owned values and existing session-state owners; do not invent physiology or duplicate mutable runtime state. Session startup already creates run, multi-actor and emotion state. [Existing startup][R52]
4. **Hand off spatial intent.** Emit entity identities, fixed/movable classification, initial-state requirements, support/access/view relations and candidate anchors to the existing placement pipeline. The resolver assigns positions/headings and validates mounted geometry. A rejected layout returns a specific conflict to the planner; only review-permitted alternatives may be tried. Preserve explicit authored choices and recorded variation identity.

**Output and boundary:** the versioned initial scene specification references the case, selected room, catalogue assets/instances, requirement provenance, starting states and unresolved items. It feeds the existing compile/bundle path. Runtime initialization must acknowledge each required state through its actual consumer; unsupported state is an explicit unmet requirement, not a metadata-only success. Preserve the approved specification and realized starting snapshot for review/replay; subsequent changes remain owned by the existing runtime systems. Proposed acceptance is a pre-event starting snapshot after required scene initialization, at a proposed scene-readiness boundary within the existing startup flow; record its actual phase and domain time. The planner must not create a phase, reset the clock or issue a second `START_ENCOUNTER`. Current session startup uses the default doorway run; the domain helper also permits direct encounter entry, which must not be mistaken for a wired option in that startup call. Scheduled-event dispatch, including second-zero events, must remain runtime-owned; the specification defines initial conditions and never pre-applies events. This is a proposed ownership requirement: the authored schedule and domain due-event helper do not establish a wired production dispatcher. The inspected helper references are its definition and tests. Existing UI-XR remote startup issues the later encounter command using observed form time, without awaiting these proposed state checks. Integrating scene readiness, the starting snapshot and any required dispatch ordering is new work; preserve the existing clock and transition contract. [Due-event helper][R57], [remote startup][R58] [Session startup][R52], [phase contract][R53], [event contract][R56] Keep hidden case information under existing visibility rules.

**First planner slice:** use the same supine-patient/physician encounter and one existing room template. Produce an approved contents/start-state specification for the patient, physician, support and case-required monitor/cart; do not assume every case requires both. Demonstrate that required content is realized, intentionally absent equipment stays absent, and the physician starts separately from the bedside destination. Reject a missing required asset, an unsupported required state and a room/clearance conflict. If connecting equipment is a learner task, do not pre-complete it. This adds initial setup planning only; dynamic task planning, new physiology, general room synthesis and inventory/procurement systems remain outside scope.

### Complementary research: requirements, starting state and acceptance

**Proposed refinements:** [Function2Scene](https://function2scene.github.io/) (May 2026) and [Behavior-Aware Anthropometric Scene Generation](https://kindohyoku.github.io/BehaviorAware/) (CHI 2026) strengthen the activity → functional constraint → actor/task-specific operational-envelope approach. Their household/interior studies do not establish clinical requirements, and implementation/data rights remain unverified. Keep reviewed case rules and existing catalogue assets authoritative.

Borrow the separation of objects, initial predicates and goals from [BDDL](https://github.com/StanfordVL/BEHAVIOR-1K/blob/main/bddl3/README.md), without requiring its DSL or simulator. Each required starting-state check should identify its entity, expected predicate/value, provenance and actual runtime consumer, returning **satisfied, unsatisfied, pending or unknown** with observed evidence. Pending means an identified consumer is still loading; unknown means no adequate observation yet. Neither permits required-state promotion. An unsupported required state is unsatisfied. These are proposed check outcomes, distinct from existing asset-load statuses. Observe the existing load/mount consumers after normalization; a returned session or a `loaded` asset status alone is insufficient. The loader can report loaded while suppressing a mismatched GLB and retaining a fallback, so verify exact realized identity, fallback status and required geometry/state. [Load branches][R59] Do not duplicate runtime state or pre-complete learner goals.

Use [SceneEval](https://github.com/3dlg-hcvc/SceneEval) to inform independent acceptance categories: collision, bounds, navigability and opening clearance can be checked without a VLM; its support/accessibility metrics are VLM-based and are not physical proof. Actual mounted-geometry/frame adapters and calibrated controls are new work. Task-specific support, reach and viewing checks remain necessary. These refinements attach to the existing planner and resolver; no new engine is needed. The [complementary research note](docs/openclinxr/scene-layout-consultation-records-2026-09-09/openclinXR-complementary-scene-research.md) compares six references, including SceneSmith and RoboCasa365, with dated primary sources, separate licensing limits and M1 implications.

### Authored intent versus resolved placement

Keep authored intent optional and separate from required runtime placement. With no intent, retain the existing resolved defaults and label their provenance; do not copy them back into the case as faculty decisions. With explicit intent, resolve its support and posture without allowing environment defaults to silently override them.

The proposed contract needs an exact fixture/equipment instance ID and a named support anchor. Define a right-handed orthonormal frame in world metres: `x/z` tangent to the selected contact plane, `y` its normal. Transform the anchor origin through the mounted asset, but do not multiply metre offsets by GLB scale again. Resolve ambiguous or sheared frames explicitly. For standing, name a floor anchor; “none” is not itself a frame. For the first flat-deck control, `{x: 0.05, y: 0, z: 0}` requests a 5 cm tangential shift, subject to mattress/support contact and envelope checks; measure head/pillow contact separately. A nonzero normal offset fails this supported-patient control. This is proposed semantics, not current implementation or a clinically prescribed distance. Missing or ambiguous authored supports, malformed offsets and violated hard constraints block candidate acceptance/promotion. A clearly flagged fallback preview may remain usable, but is not evidence of satisfying the request. [Current posture precedence][R31]

Factory resolution can use versioned asset metadata; runtime acceptance must check the actual mounted support after loading, footprint fitting and grounding. Construction order alone does not await GLB completion. Keep placement provisional until that geometry is ready; a pending exact support withholds promotion while loading, without silently selecting another instance. Animation registration stores bases on the loaded humanoid child, separately from its outer `actorSlot`; supine hold restores those local bases and non-supine sway replaces child-local X. Define which node owns placement, convert world targets into that node’s parent frame, and preserve the composed world pose through plant/animation updates. Writing world coordinates into local bases is not a fix. [Equipment normalization][R43], [registered nodes/bases][R44], [frame writes][R32]

### Semantic relationships and operational volumes

Existing environment zones already name `examiner_standing_zone`, `left_bed_rail` and workflow anchors; reuse those identifiers where appropriate, but their strings are not resolved poses or measured operational volumes. Fixture-slot resolution supplies positions for a separate set of fixture records; bind identities explicitly. [Semantic zones][R47], [fixture resolver][R48]

Extend existing entities with relations such as `patient supported_by bed`, `physician faces patient`, `monitor visible_from physician_target`, and `cart outside approach_corridor`. Resolve named fixture/equipment anchors to world transforms.

Affordances identify actions and targets: lying support, examination side, display viewing and control operation. Operational volumes identify the space those actions need: bedside workspace, approach corridor, door swing, drawer opening and operator standing/reaching envelopes. These richer envelopes are **new work**; generic affordance tags and deck heights are not substitutes.

Start with authored metadata for the selected bed, monitor and cart. Validate after mounting, scaling and grounding, and across runtime frame updates. UI-XR has an affect-driven scale writer under `gltfEnvContainer`; inspected declared-equipment slots mount directly under `scene`, so its impact on a selected support depends on actual ancestry. Keep physical anchors stable or revalidate their changed geometry. [Equipment mount][R39], [affect writer][R40] Later, learned/VLM affordance proposals can populate the same representation, subject to review and measurement.

### Deterministic solving and variation

Hard constraints: required support/contact, prohibited collision, specified clearance, unblocked route and case-required access. Soft preferences: bedside choice, path length, orientation and equipment proximity. Define tolerances and known-good/known-bad controls before calling a check “reachability.” A nearby hand target does not prove anatomical reach or a traversable route.

Start with bounded authored/fixture anchors and existing slot defaults; a general optimizer is not a prerequisite. Apply hard constraints before ranking valid alternatives, break equal scores by stable anchor ID, and fail unsatisfied explicit intent rather than substituting a different target. Return a resolved layout or explicit unsatisfied constraints. [Existing anchors][R37] Derive variation from stable case/asset/solver identities and a variation index; record the resulting seed and output. Existing motion seeding already follows a versioned, content-based scheme, but does **not** supply seeded room-layout optimization. Reuse the principle, with a layout-specific identity. Reproducibility covers the versioned resolver and recorded artifacts; a seed alone does not guarantee identical learned inference or cross-platform physics. [Motion seed contract][R19]

## 4. Motion, retargeting and local execution

**Factory-first describes asset preparation and governance; it need not require every behavior to be baked into a new GLB.** Keep three options distinct:

| Option | Near-term role | Required evidence |
|---|---|---|
| Baked clips, including offline learned generation | Existing idle/role and selected seated playback; clinician approach still to prove; ongoing supine playback blocked | Retargeted deformation, support/contact, transitions, exact clip loading and rebake survival |
| Deterministic runtime goals / IK | Experimental general executor; isolated IK work does not establish a UI-XR contact baseline | Joint limits, support preservation, contact lifecycle, deterministic event replay and frame cost |
| Learned streaming service | Later reactive motion research | All previous checks plus latency, jitter, cancellation, buffering, fallback, service rights and concurrency |

The implemented frame loop applies mixer updates, posture correction, and root/support updates; it is not the proposed general controller/IK/contact pipeline. Any new executor must survive those later writes and declare ownership of roots and joints. [Current frame loop][R32]

The repo's full design explicitly leaves baked tracks versus runtime goals open. A **recorded historical bake-off** returned `other`: neither path achieved the requested clutch, and zero wrist residual accompanied broken deformation. This is evidence that target error alone is inadequate, not a current benchmark or backend winner. [Design comparison][R18], [recorded experiment][R20]

Use **canonical motion semantics with per-rig mappings**, preserving MPFB's richer hierarchy. Existing aliases resolve landmarks without stripping fingers, facial bones or twist segments. The interchange defines absolute node-local rotations/translations, canonical landmarks and interpolation. Extend those contracts with supported effectors, rest/support dependencies, contact goals, capability refusals and output provenance. Distinguish bend joints from twist segments using actual hierarchy and weights; landmark aliases alone are not an IK-chain or deformation guarantee. Do not invent a second reduced skeleton. [Rig mapping][R21], [motion interchange][R22]

A provider request should identify authored action, scene/asset revision, start state, destination/path, contact targets, timing, rig profile and variation identity. Results should be clips or supported goal descriptors, with root motion, contacts, provenance and failures. The executor must preserve which system owns each body chain. UI-XR frozen `ActorTurnPlan` playback consumes at most the first approved gesture clip; the current emotion-performance mapper emits an empty clip list. A motion lane is supported, but that mapper does not yet supply gestures or navigation. [Current mapper][R42] Current runtime placement has no heading field. Add and consume a persistent body-heading contract on the chosen placement owner, with its parent frame stated. Idle returns child yaw toward `baseRotationY`; speech may add bounded child yaw toward a gaze target. Measure the composed body direction and define allowed speech deviations rather than equating instantaneous gaze-directed yaw with the placement heading. [Speech yaw][R49] A path is later motion-plan data, not implicit in a slot position. Keep the physician approach in an actor-motion plan/executor with replay identity, coordinating with dialogue where needed. [Placement shape][R45], [idle yaw][R46] [Actual gesture consumer][R41] The full design's controller/IK pass order remains a design reference, not proof that the current runtime implements it. [Playback][R14], [design][R18]

**Apple Silicon M1 Max, 64 GB:** use this machine first for factory output, retargeting, named-clip playback and already-wired pose/plant behavior. General runtime-goal/IK execution is not an established local baseline. For learned models, measure installation/CUDA blockers, peak unified memory, cold/warm generation time, retarget cost, rebake invalidation, frame cost and visible quality. Kimodo's official setup emphasizes Linux/NVIDIA and offers CPU text encoding; ARDY documents Ubuntu/RTX testing. CPU text encoding is a memory-offload option, not proof of M1-compatible motion inference. Neither official setup establishes M1 performance. Community MPS ports require separate verification. Cheap license/interface and local dependency inspection can proceed alongside prototype work; inference/comparison follows eligibility and a usable baseline. An unavailable M1 path blocks local-execution claims, not a separately authorized execution option. No new hardware recommendation follows from this brief. [Kimodo setup](https://github.com/nv-tlabs/kimodo), [ARDY setup](https://github.com/nv-tlabs/ardy)

Desktop evidence and worn-headset Quest evidence remain separate acceptance stages. [Project boundaries][R1]

## 5. Research candidates and verification status

These are evaluation leads, not adopted dependencies. **Observed code licensing does not clear weights, datasets, body models, simulators or generated-output rights.** Capability descriptions below come from first-party sources; OpenClinXR integration and M1 suitability remain unverified.

| Candidate / first-party reference | Relevance | License and adoption status |
|---|---|---|
| [Kimodo](https://github.com/nv-tlabs/kimodo) | Paths and effectors suit offline approach clips. The model card says scene objects are not represented; OpenClinXR must supply collision-aware planning and validation. | Apache-2.0 code observed. [SOMA-RP-v1.1](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1) lists NVIDIA Open Model and commercial use; that custom weight license still needs project compatibility review. [SMPLX-RP-v1](https://huggingface.co/nvidia/Kimodo-SMPLX-RP-v1) is explicitly non-commercial research-only: exclude from adoption. Audit the exact checkpoint, encoder, body model, data and output terms. |
| [ARDY](https://github.com/nv-tlabs/ardy) | Online autoregressive motion with text, waypoint and pose constraints. | Apache-2.0 code observed; checkpoints/data separate. Its documented encoder requires gated Meta-Llama-3-8B-Instruct access and separate terms. Download permission is not license clearance. Streaming research lane, not the prerequisite for deterministic interaction. |
| [DIP: Diffusion Implicit Policy](https://github.com/jingyugong/DIP) | Scene-aware walk/sit/lie generation. | [MIT code](https://raw.githubusercontent.com/jingyugong/DIP/main/LICENSE) observed; SMPL-X, datasets and weights need review. Distinct from CLoSD's **DiP, Diffusion Planner**. |
| [CLoSD](https://github.com/GuyTevet/CLoSD) | Closed-loop diffusion and simulation for text/goal-driven control. | [MIT code](https://raw.githubusercontent.com/GuyTevet/CLoSD/main/LICENSE) observed; Isaac Gym, SMPL, AMASS, HumanML3D and weights require separate review. |
| [CHOICE](https://lujintaozju.github.io/publications/CHOICE/) | Hierarchical pick-and-place and bimanual interaction. | Project/paper inspected; code archive not inspectable here. Earlier MIT claim **unverified**. Later manipulation lead. |
| [ReMoGen](https://github.com/4DVLab/ReMoGen) | Reaction generation conditioned on another person, scene and/or text. | No project code/weight license established in inspected material; body-model/data terms separate. Later multi-actor research. |
| [SceMoS](https://anindita127.github.io/SceMoS/) | Global scene planning with local geometry-conditioned motion. | Implementation/weight terms **unverified**. Website licensing must not be treated as model licensing. |
| [AffordMotion](https://github.com/afford-motion/afford-motion) | Predict an affordance map, then generate language/scene-conditioned motion. | [MIT code](https://raw.githubusercontent.com/afford-motion/afford-motion/main/LICENSE) observed; weights/data/dependencies unverified. Corrects the transcribed “a Ford-motion” lead. |
| [PlaceIt3D](https://github.com/nianticlabs/placeit3d) | Language-guided object placement in scene point clouds; useful placement benchmark ideas. | Published [software license](https://raw.githubusercontent.com/nianticlabs/placeit3d/main/LICENSE.txt) is **non-commercial**, outside the permissive adoption requirement. Retain as literature reference. |
| [PhyScensis](https://physcensis.github.io/) | Arrangement informed by support, contact, balance and containment. | First-party project description inspected; deployable code/weights/data licenses **unverified**. Research reference. |

Related affordance/interaction names from the conversation—InteractMove, HOI-Diff, HOI-PAGE and InteractAnything—remain secondary leads requiring exact project and license verification. None displaces a working deterministic baseline merely by demonstrating an attractive research video.

## 6. Licensing requirement and MPFB2 treatment

Require permissive, non-copyleft licenses for adopted/shipped code, weights, data and dependencies; inspect output rights and each asset component as well. Record version/hash, first-party license source, modifications, attribution, redistribution and use restrictions. Missing or incompatible terms block adoption, while the work can remain a literature reference. Separate inference, evaluation, retraining and redistribution in the rights manifest: identify data actually consumed, upstream pretraining provenance, checkpoint/body/encoder terms and output rights. An inference-only workflow does not mean we redistribute the training dataset; it also does not waive the project's data-provenance requirement. Custom weight licenses need explicit compatibility review rather than being called Apache or automatically accepted because commercial use is mentioned.

**MPFB is an existing build tool with separately licensed assets.** Upstream publishes [GPLv3 code terms](https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/LICENSE.CODE.md) and [CC0 asset terms](https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/LICENSE.ASSETS.md). The repository records an unshipped-build-tool distinction, but its extension row says AGPL-3 while its split-license row says GPL-3.0-or-later. Correct that record against the exact installed release before future clearance. Current upstream inspection supports GPL rather than the AGPL label; it does not audit every installed third-party pack. [Extension record][R23], [split-license record][R24]

Use three evidence levels: **upstream inspected for this brief**, **repository-recorded verification**, and **not independently verified**. None is blanket product approval. Existing public-motion clearance is deliberately limited to particular body/hair/shirt/motion components and a cropped video; it does not clear every garment or viseme source. [Scoped public review][R25]

## 7. Prioritized prototype and acceptance

0. **Specify the starting scene.** From reviewed case activities, produce the bounded initial scene specification described above. Required contents and states must have actual consumers; report missing/unsupported requirements and preserve deliberately absent or unconnected items. Freeze the approved room and setup for the following placement controls.
1. **Freeze one existing supine station as a control.** Reuse shipped MPFB patient, bed/support and staging evidence. Record asset hashes and verify support, incline and pose preservation. Do not begin by regenerating all assets. [Existing staging instrument][R26]
2. **Prove authoring reaches the scene.** Reconcile vector/scalar payloads and preserve the vector through compile and bundle production. Use the existing authored clinic placement and an unauthored supine station as controls, then author the target supine encounter. Change an offset within the measured support envelope; require the expected support-relative/world delta on the actual loaded humanoid after framing, pose application and subsequent frame updates. Verify an unauthored control retains its defaults and an invalid authored support cannot promote. Bundle metadata, a primitive proxy, or a direct preview-only overlay is insufficient. [Authored control][R33], [supine control][R34], [mount/framing path][R35]
3. **Solve stationary clinical staging.** Verify that fixed slot assignment stages the intended physician ID; if omitted, report that outcome rather than substituting another clinical actor. Place that physician at a case-specified bedside target oriented toward the patient, with the proposed persistent heading consumed and composed body direction checked during idle and speech, including allowed speech deviations, with equipment/body clearance, an unobstructed approach zone and monitor visibility. Select bed/monitor/cart through the existing catalogue. Report violations against measured mounted geometry.
4. **Add the physician approach.** Start with a bounded actor path and validated clip/goal executor, stopping at the proven target. Preserve the actor ID and resolved placement through slot repair; do not gate autonomous motion on learner input. Measure continuous-path collisions, foot sliding, final pose and equipment clearance. Keep the patient statically supine until posture-safe animation is separately demonstrated. General navigation and hand-contact procedures are later scope.
5. **Prove variation, replay and failure behavior.** Exercise multiple variation indices and an impossible layout. Same versioned inputs reproduce the result; changed asset geometry invalidates dependent placement/motion evidence. Corrupt or remove a produced artifact and require the consumer to refuse it. Capture actual displayed motion, not merely successful loading or a `clipPlayed` flag. Independently sample the final posed skeleton and skinned mesh across time: required tracks/effectors present, joint limits and limb integrity, support/contact windows, deformation and collision. Bind the result to exact asset/clip bytes and rig profile; include actor-turn identity when the motion belongs to a dialogue turn.
6. **Compare one legally eligible learned provider.** Filter by the required motion controls, then the exact code/checkpoint/encoder/body/data/output manifest, then a verified local or otherwise authorized execution path. Kimodo-SOMA-RP-v1.1 is a conditional offline lead, not a cleared dependency or automatic winner. Pin checkpoint, API revision, output skeleton/axes and MPFB mapping: its README describes `somaskel77` while the model card describes 30-joint outputs; their exact relationship remains unverified. [README](https://github.com/nv-tlabs/kimodo), [model card](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1). Use identical case, frozen rig, target and grading conditions; measure visible quality, constraints, turnaround, memory and integration cost against the baseline. No eligible provider or no demonstrated benefit means retain the baseline.

Deliverables: reviewed case delta, initial scene specification and realized starting snapshot, resolved layout/constraints, candidate GLB or goal descriptor, provenance/license manifest, repeatable run identity, per-check measurements, real UI-XR capture and replay record. Require support/contact, joint/deformation and visibility evidence independently of the solver's self-reported success. Clinical positioning receives clinician review; Quest performance receives worn-headset measurement.

**Next implementation milestone:** approve the contents/start-state specification for one existing room and encounter, preserve the unauthored supine control, then prove that an authored support-relative offset on that same station survives the aligned case/admin/compile/bundle path and appears on the posed, skinned humanoid after framing, pose/plant and later frame updates. Invalid authored support cannot promote. Equipment and the stationary physician target follow in step 3.

[R1]: AGENTS.md
[R2]: agents/rules/GUARD_BLUEPRINT.md:21
[R3]: packages/openclinxr/xr-station-room/src/station-scene-assembly.ts:31
[R4]: apps/ui-xr/src/main.ts:2987
[R5]: packages/openclinxr/shared-schemas/src/schemas.ts:227
[R6]: tools/openclinxr/factory/encounter-materialization-evidence.ts:299
[R7]: tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts:1248
[R8]: docs/madr/0054-equipment-three-lane-factory.md:28
[R9]: packages/openclinxr/xr-station/src/station-equipment-support-surfaces.ts:35
[R10]: tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py:2880
[R11]: packages/openclinxr/factory-stations/src/motion_retarget/run.ts:11
[R12]: packages/openclinxr/xr-pose/src/supine-deck-plant.ts:51
[R13]: packages/openclinxr/xr-asset-loading/src/humanoid-animation.ts:55
[R14]: packages/openclinxr/xr-dialogue/src/actor-turn-playback.ts:1
[R15]: docs/madr/0048-scene-composer-placement-stage.md:165
[R16]: packages/openclinxr/factory-stations/src/catalog.ts:9
[R17]: tools/openclinxr/dark-factory/multi-case-runner.ts:126
[R18]: docs/openclinxr/humanoid-motion-full-design-2026-09-02.md:9
[R19]: packages/openclinxr/motion-compiler/src/trajectory/deterministic-variation.ts:1
[R20]: tools/openclinxr/evidence/motion-backend-bakeoff/report.json:67
[R21]: packages/openclinxr/asset-registry/src/pose-bone-resolver.ts:12
[R22]: packages/openclinxr/motion-compiler/src/canonical-motion-contract.ts:35
[R23]: docs/openclinxr/asset-licence-records/row-24-mpfb2-blender-extension.json:7
[R24]: docs/openclinxr/asset-licence-records/row-25-mpfb2-bundled-data-textures-mpfbface-jpg-mpfblips-jpg-mpfbea.json:7
[R25]: docs/openclinxr/public-humanoid-motion-license-review-2026-09-04.md:13
[R26]: tools/openclinxr/evidence/inpatient-supine-staging.ts:259

[R27]: packages/openclinxr/ui-route-admin/src/environment-generation-queue-panel.tsx:117
[R28]: packages/openclinxr/factory-stations/src/catalog.ts:203
[R29]: tools/openclinxr/dark-factory/multi-case-runner.ts:800
[R30]: apps/ui-xr/src/main.ts:817
[R31]: packages/openclinxr/asset-registry/src/actor-posture.ts:130
[R32]: packages/openclinxr/xr-humanoid-animation/src/animation-loop.ts:111
[R33]: packages/openclinxr/scenario-fixtures/src/clinic-knee-pain.ts:51
[R34]: packages/openclinxr/scenario-fixtures/src/ed-chest-pain.ts:41
[R35]: packages/openclinxr/xr-station-room/src/actor-staging.ts:95

[R36]: packages/openclinxr/xr-locomotion/src/portal-trail.ts:147
[R37]: packages/openclinxr/xr-runtime-state/src/runtime-actor-placements.ts:98
[R38]: packages/openclinxr/xr-runtime-state/src/runtime-actor-slots.ts:88
[R39]: apps/ui-xr/src/main.ts:3032
[R40]: apps/ui-xr/src/main.ts:3475
[R41]: packages/openclinxr/xr-dialogue/src/actor-turn-playback.ts:206

[R42]: packages/openclinxr/conversation-policy/src/emotion-performance-mapper.ts:235
[R43]: packages/openclinxr/xr-station/src/station-equipment.ts:345

[R44]: packages/openclinxr/xr-asset-loading/src/humanoid-animation.ts:113
[R45]: packages/openclinxr/asset-registry/src/runtime-bundles.ts:162
[R46]: packages/openclinxr/xr-humanoid-animation/src/animation-loop.ts:217
[R47]: packages/openclinxr/asset-registry/src/environment-zone-templates.ts:26
[R48]: packages/openclinxr/asset-registry/src/environment-zone-templates.ts:336

[R49]: packages/openclinxr/xr-humanoid-animation/src/gaze-evidence.ts:76

[R50]: packages/openclinxr/shared-schemas/src/schemas.ts:472
[R51]: packages/openclinxr/shared-schemas/src/schemas.ts:396
[R52]: packages/openclinxr/scenario-runtime/src/scenario-runtime.ts:93

[R53]: packages/openclinxr/domain/src/station-state.ts:3
[R54]: packages/openclinxr/asset-registry/src/runtime-bundles.ts:85
[R55]: packages/openclinxr/scenario-fixtures/src/ed-chest-pain.ts:266
[R56]: packages/openclinxr/shared-schemas/src/schemas.ts:307

[R57]: packages/openclinxr/domain/src/station-state.ts:104
[R58]: apps/ui-xr/src/main.ts:2344
[R59]: packages/openclinxr/xr-asset-loading/src/generated-loaders.ts:433
