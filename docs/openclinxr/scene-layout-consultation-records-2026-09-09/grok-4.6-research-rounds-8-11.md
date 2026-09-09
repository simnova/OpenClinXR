# Grok 4.6 research review — rounds 8–11

Completed 9 September 2026: four substantive, adaptive exchanges in the original Grok conversation `0a7c4705-0b58-439b-b119-ac8dd1ed6db4`. This continues all seven earlier Grok rounds and brings that conversation to eleven review exchanges. Requested model `grok-4.6`; actual backend is recorded in receipts. All four ended normally.

The reviewer retained full repository read access, terminal inspection, native LSP and internet search/fetch tools. Scope was read-only document consultation: no product implementation, model inference or runtime benchmark. Repository HEAD was `9c6d56f0a95f46537759aa443ab27c858170ec4a`, with unrelated working changes left intact. The coordinator independently inspected primary papers, projects and license files, challenged initial findings and integrated selected changes. This is a selected research survey as of 9 September, not exhaustive coverage or dependency clearance.

Deliverables: [updated brief](../humanoid-scene-layout-research-brief-2026-09-09.md) and [complementary research note](openclinXR-complementary-scene-research.md). Earlier consultation records remain historical snapshots.

## Decisions and corrections

- **Accepted:** narrowed the main complementary set to Function2Scene, Behavior-Aware Anthropometric Scene Generation, BDDL/BEHAVIOR, SceneEval, SceneSmith and RoboCasa365. The first four inform incremental requirements, predicates and acceptance checks; the latter two remain comparison references. Existing motion candidates and licensing gates remain in the main brief.
- **Accepted with source checks:** added a compact newer-work watchlist for SceneMosaic and Affordance2Action. The coordinator independently verified primary titles/dates and SceneMosaic's code license. Corrected Grok's round-9 SceneMosaic date from 3 September to **4 September 2026**.
- **Rejected/retracted:** adopting another room generator before the one-room prototype; interpreting a paper's noncommercial license as a prohibition on independently applying its ideas; treating BDDL as inherently Isaac-bound; treating SceneEval as a turnkey three.js evaluator or its VLM support/accessibility metrics as deterministic physical proof. Grok acknowledged these distinctions in later rounds. Its initial recommendations were less precise than the final documents.
- **Rejected/retracted:** a closed 5th–95th percentile anthropometric table as the clinical clearance rule. Required thresholds need task/actor/equipment-specific justification and provenance. The final documents do not adopt that table or rely on ResearchGate for licensing.
- **Accepted:** explicitly label present/powered/connected as proposed OpenClinXR predicate vocabulary requiring actual consumer mappings. Distinguish satisfied, unsatisfied, pending and unknown check outcomes from existing asset-load status. Missing required state support is unmet; no observation or pending loading cannot count as success.
- **Accepted after independent source inspection:** startup creates session state but does not itself observe mounted geometry; the due-event helper and authored schedule do not prove production dispatch is wired. Main brief now labels readiness/snapshot/dispatch ordering as proposed integration, preserves observed domain time, and prohibits duplicate encounter transitions. LSP results alone were not treated as an exhaustive call graph; targeted text search found helper definition and test uses.
- **Coordinator-added correction:** `generated-loaders.ts` can report loaded while suppressing a mismatched GLB and retaining a fallback. Both artifacts now require exact realized identity, fallback status and actual geometry/state evidence after the relevant mount/normalization path; loaded is not equivalent to satisfying a requirement.
- **Licensing and hardware:** primary MIT files were inspected for SceneEval, BDDL3, SceneSmith, RoboCasa and SceneMosaic; RoboCasa includes a MuJoCo Apache notice and declares CC BY assets/data. No complete transitive license or exact-asset provenance audit was performed. RoboCasa documents Mac demos; no M1 benchmark was run. Neither CUDA requirements in another system nor missing Mac documentation establishes universal impossibility.
- **Review method limits:** actual web searches/fetches occurred, with repository reads and LSP in round 10. Some LSP calls returned no result or noisy generic references; a workspace-symbol query resolved startSession, and direct source reads/text searches grounded the conclusions. Full access does not mean every file or dependency was audited. BothyBoard authentication and a missing project hook emitted startup warnings; they did not prevent read-only review. No board changes were needed for this document consultation.

- **Final verdict:** round 11 accepted with two wording residuals, both applied: describe the scene-readiness boundary as proposed (not a named existing handoff), and explicitly observe both the normalized/mounted branch and suppression/fallback branch. No product implementation followed the reviewer’s suggested next step; this request was research and document review.


## Execution receipts

- Round 8: `end_turn`, same session; backend grok-4.6-build; tool calls {"read_file": 2, "Web search:": 7, "web_fetch": 4}.
- Round 9: `end_turn`, same session; backend grok-4.6-build; tool calls {"Web search:": 4, "web_fetch": 7}.
- Round 10: `end_turn`, same session; backend grok-4.6-build; tool calls {"read_file": 24, "grep": 10, "lsp": 6, "web_fetch": 12, "Web search:": 2}.
- Round 11: `end_turn`, same session; backend grok-4.6-build; tool calls {"read_file": 5, "Web search:": 1, "grep": 2}.

The round counts above count exchanges, not internal tool calls. Tool receipts distinguish actual web/LSP use from merely permitting it.

## Round 8

### Prompt

Round 8 in our original persistent Grok 4.6 conversation; first of FOUR new review rounds requested by the user. Continue all history, but read the current revised brief in full:
docs/openclinxr/scene-layout-consultation-records-2026-09-09/../humanoid-scene-layout-research-brief-2026-09-09.md
It now includes an initial scene planner (reviewed by Claude): reviewed activities→requirements→contents/room→starting states→placement. Optional context: sibling claude-initial-scene-planner-review.md. Model agreement is not evidence.

User asks for review AND research into complementary solutions from the latest field advances. Today is 9 September 2026. Conduct actual live web search, prioritize first-party papers/project pages/repositories from 2025–2026 and verify publication/release dates; older foundations are fine when labelled. Do not claim exhaustive coverage or infer newness from search rank. Full repo /Volumes/files/src/openclinxr, terminal and native LSP remain available; this is read-only consultation, no code/docs edits, task/board/autonomy actions, delegation, installation, model downloads or inference. Other working changes stay untouched.

This round: identify up to SIX complementary approaches (not simply more text-to-motion models) that could strengthen initial room requirements, task-conditioned object/room composition, meaningful object starting states, functional clearance/reach/visibility, semantic asset grounding, or independent physical validation. Consider recent scene-generation systems, functional-layout/affordance work, and scene-state benchmarks; go beyond the already listed Kimodo/ARDY/DIP/etc where justified. Preserve existing three.js/WebXR, MPFB and factory contracts. Literature ideas can be useful even when implementation licensing excludes adoption.

For each: exact name, dated first-party sources, what problem it actually solves, what it does NOT solve, specific OpenClinXR seam it complements, implementation maturity, and separately code/weights/data/assets/dependencies licensing status (unverified where not inspected). Distinguish simulator-specific toolchains from reusable representations/algorithms. No medical task requirements may be invented from general household benchmarks.

Finish with the two most promising concrete additions and the strongest counterexample to your own recommendation. Challenge whether any require changing the near-term bounded prototype; don't turn research into a new engine or endless prerequisite. Under 1300 words; aim for bounded targeted calls. Return substantive evidence rather than agreement. Do not edit files. Round 9 will challenge sources, rights and novelty; round 10 integration; round 11 final document review.

### Grok visible reply (historical, may contain corrected claims)

I’ll read the revised brief and planner review, then search first-party 2025–2026 scene/layout/affordance work rather than more text-to-motion models.Research is **not** exhaustive. Dates below are from first-party pages inspected 9 Sep 2026. None of these should delay prototype steps 0–2 (one existing room, authored offset, fail-closed intent). Do not treat household activity libraries as clinical requirements.

## Six complementary approaches

**1. SceneEval (independent physical/semantic checks)**  
WACV 2026 Oral. Paper [arXiv:2503.14756](https://arxiv.org/abs/2503.14756) (v1 18 Mar 2025, v3 7 Mar 2026). Code [3dlg-hcvc/SceneEval](https://github.com/3dlg-hcvc/SceneEval) (v0.9 10 Jun 2025; v1.1 27 Oct 2025 adds Opening Clearance).  
**Solves:** Interpretable metrics for counts/relations **and** implicit plausibility: collision, navigability, out-of-bounds, opening clearance. The `no_llm_plan` demo runs the last four **without** a VLM.  
**Does not:** Generate rooms, powered-monitor state, or clinical visibility.  
**Seam:** “Independent geometry checks” after the existing resolver; not a second scene graph.  
**Maturity:** Released evaluator + SceneEval-500; docs still list scene-state format as TODO.  
**Rights:** Code MIT (2025 3dlg-hcvc). Weights: none. Data/assets: 3D-FUTURE / Objathor / HSSD **unverified** and method-specific. Optional GPT-4o for VLM metrics.

**2. BDDL initial/goal predicates (starting-state language)**  
First-party: [BEHAVIOR tasks](https://behavior.stanford.edu/behavior_components/behavior_tasks.html) (docs current 2026), [bddl](https://github.com/StanfordVL/bddl). Language older (MIT 2021); still the live BEHAVIOR-1K task carrier.  
**Solves:** Explicit `:objects`, ground `:init` literals, separate `:goal`. Present vs ready (`ontop` ≠ `toggledon`).  
**Does not:** Place metres, validate WebXR meshes, or encode vitals. Household synsets are not exam setup.  
**Seam:** Planner step 3 (“only where a runtime consumer can represent it”).  
**Maturity:** Production OmniGibson/Isaac.  
**Rights:** BDDL **code MIT**. OmniGibson runtime = Isaac/PhysX (**simulator-specific**). BEHAVIOR-1K assets/data **unverified**. Reuse the **predicate shape**, not the sim.

**3. HSM support-region hierarchy**  
3DV 2026. [arXiv:2503.16848](https://arxiv.org/abs/2503.16848) (v2 27 Aug 2025), [project](https://3dlg-hcvc.github.io/hsm/), [code](https://github.com/3dlg-hcvc/hsm).  
**Solves:** Recurring support patterns (floor → furniture → small objects); annotated support regions on meshes.  
**Does not:** Choose ED vs clinic from case activities; object power/connection.  
**Seam:** Named support anchors / operational volumes on **catalogue** beds/carts, not new rooms.  
**Maturity:** Code + SceneEval export.  
**Rights:** Support-region **dataset CC-BY-NC-4.0** ([HF](https://huggingface.co/datasets/3dlg-hcvc/hsm)). Code license **unverified**. HSSD gated.

**4. LayoutVLM (VLM proposal + differentiable physical layout)**  
CVPR 2025. [arXiv:2412.02193](https://arxiv.org/abs/2412.02193) (v3 11 Mar 2025), [code](https://github.com/sunfanyunn/LayoutVLM).  
**Solves:** Task/criteria JSON → poses/orientations with a physical objective (collision/IoU).  
**Does not:** Freeze an existing room template; equipment start-state. Needs OpenAI key + CUDA Rotated-IoU.  
**Seam:** Optional later **optimizer behind** the bounded resolver, if it consumes OpenClinXR assets.  
**Maturity:** Runnable research code.  
**Rights:** Paper **CC BY-NC-ND 4.0**. Repo license **not stated** in README. Objaverse/Objathor **unverified**.

**5. Holodeck constraint layout (labelled 2024 foundation)**  
CVPR 2024. [arXiv:2312.09067](https://arxiv.org/abs/2312.09067) (v2 22 Apr 2024), [allenai/Holodeck](https://github.com/allenai/Holodeck) Apache-2.0.  
**Solves:** LLM spatial relations → DFS/MILP layout (doors/windows/assets).  
**Does not:** Clinical starting state; three.js. **AI2-THOR/Unity-specific.** Holodeck 2.0 ([arXiv:2508.05899](https://arxiv.org/abs/2508.05899), v2 19 Dec 2025) claims editing; public code **not verified here**.  
**Seam:** Relation vocabulary (`supported_by`, facing) for the spec, not a THOR runtime.  
**Rights:** Code Apache-2.0. GPT API + Objaverse **separate**.

**6. PhyScensis physical predicates + engine feedback (already in §5; role clarified)**  
ICLR 2026. [arXiv:2602.14968](https://arxiv.org/abs/2602.14968) (16 Feb 2026), [physcensis.github.io](https://physcensis.github.io/).  
**Solves:** Contact/support/balance/containment via LLM predicates **and** a physics solver loop.  
**Does not:** ED catalogue binding; Quest playback. **Genesis/physics-engine specific.**  
**Seam:** Independent support/contact checks; not room synthesis.  
**Rights:** Paper CC BY 4.0. Code/weights/engine **unverified** (same as current table).

## Two additions worth writing into the brief

1. **SceneEval `no_llm_plan` metrics** as the first **independent** collision/navigability/opening-clearance checks on the **existing** three.js scene after mount/ground. Map “opening clearance” to **this station’s** door/approach, not SceneEval-500 living rooms.  
2. **BDDL-style ground `:init` literals** as the **schema** for planner step 3 (present vs powered vs connected), bound only to states UI-XR can actually consume.

Neither is a new engine. Neither replaces the catalogue.

## Strongest counterexample to that recommendation

Using **SceneEval-500 / BDDL-1000 household activities as the requirement source**. Those corpora list candles, coffee makers, stained pools. Feeding them as “activities → contents” would invent non-clinical setup. SceneEval’s Opening Clearance is furniture-door geometry; it is not stretcher-rail or monitor-visibility. VLM requirement metrics need GPT-4o. HSM’s NC dataset and LayoutVLM’s NC-ND paper/API path fail the permissive-adoption bar if treated as dependencies.

**Prototype:** do **not** insert Holodeck/HSM/LayoutVLM room generation before the one-room supine control. Infinigen remains the existing procedural **asset** lane, not the planner. Learned layout comparison, if any, waits on the same fail-closed contents spec and mounted-geometry evidence already required.

## Round 9

### Prompt

Round 9, second of four new rounds, continue this conversation. Challenge your shortlist with actual first-party research rather than repeating it. Current date9Sep2026. Same read-only repo/LSP/web access; no changes or delegation.
You missed several closer recent complements. Inspect:
https://function2scene.github.io/ and https://arxiv.org/abs/2605.30819 (29May2026)
https://kindohyoku.github.io/BehaviorAware/ and https://arxiv.org/abs/2603.02662 (CHI2026)
https://github.com/nepfaff/scenesmith and https://arxiv.org/abs/2602.09153 (9Feb2026,ICML2026)
https://github.com/robocasa/robocasa and https://arxiv.org/abs/2603.04356 (RoboCasa365,4March2026; repo documents Mac mjpython support)
Compare usefulness to initial requirements→contents/state→existing bounded placement. Which merit replacing redundant shortlist entries? Root independently found SceneSmith MIT LICENSE but SAM3D32GB/Hunyuan24GB defaultGPU+API and separate assets; RoboCasa MIT plus MuJoCoApache notice and declared CC BY4 assets/data, but exact assets not audited. Verify rather than accept these assertions.
Correct potential overclaims: SceneEval support/accessibility metrics require VLM, unlike its four no-VLM geometry metrics. A paper's NC license alone does not prohibit independently implementing its idea. BDDL parser/predicate concepts are not inherently Isaac-dependent; current BEHAVIOR repo bddl3/LICENSE is MIT, full simulator/assets separate. Do not call geometry checks turnkey three.js checks; export/frame adapters and actual consumer evidence needed.
Return a narrowed six-item complement set, dates and exact first-party licenses where inspectable, actual Mac limits, what you retract from round8, and <=3 practical design changes. Prefer task-derived anthropometric operational constraints and typed initial predicates without new engines. <=1200words. Actual web searches required to seek any closer 2026 work beyond these leads; label older foundations and unknown rights clearly.

### Grok visible reply (historical, may contain corrected claims)

I’ll inspect the four named 2026 systems first-party, then search for any closer complements before replacing the round-8 shortlist.Round-8 shortlist was too generator-heavy. Closer 2026 work is **function → constraints → volumes**, not another text-to-room model.

**Retract:** Holodeck/LayoutVLM/HSM/PhyScensis as planner complements; calling SceneEval geometry “turnkey three.js”; treating paper NC as a bar on implementing the idea; treating BDDL as Isaac-bound; listing SceneEval support/accessibility with the no-VLM set.

**Verified vs root:** SceneSmith `LICENSE` is MIT (© 2026 Pfaff). README: SAM3D **32 GB**, Hunyuan3D-2 **24 GB** (worse quality), full pipeline **≥45 GB**, tested **L40S**, OpenAI key, NVIDIA Docker/bubblewrap; HSSD/Objaverse/ArtVIP **separate**. RoboCasa `LICENSE` is MIT plus an Apache-2.0 MuJoCo notice. README: code MIT, **assets/datasets CC BY 4.0**; **exact 3,200+ objects not audited**. Mac: `mjpython` for demos; **10 GB** kitchen download.

## Narrowed six

| Item | Date / first-party | Role for OpenClinXR | Rights / Mac |
|---|---|---|---|
| **Function2Scene** | 29 May 2026, [arXiv:2605.30819](https://arxiv.org/abs/2605.30819) CC BY 4.0; [function2scene.github.io](https://function2scene.github.io/) | Activities×persona → 17 Spatial/Ergonomic/Activity/Environmental constraints; **T1** `bbox_collision` / `boundary_check` before LLM/VLM tools | **No code repo on the project page.** Idea ≠ engine. Residential/AD cases, not exams. |
| **Behavior-Aware Anthropometric** | CHI 2026, [arXiv:2603.02662](https://arxiv.org/abs/2603.02662) 3 Mar 2026; [kindohyoku.github.io/BehaviorAware](https://kindohyoku.github.io/BehaviorAware/); ACM 10.1145/3772318.3790341 | **Manipulation volume** vs passage-only; 5th–95th reach/breadth; `d_clearance` / `L_point_towards` | ResearchGate lists paper **CC BY-NC-ND 4.0**. **No GitHub found.** GPT-4o + Objaverse + LayoutVLM optimizer. NC paper ≠ idea ban. |
| **BDDL3 predicates** | [BEHAVIOR-1K/bddl3/LICENSE](https://raw.githubusercontent.com/StanfordVL/BEHAVIOR-1K/main/bddl3/LICENSE) **MIT** | Typed `:init` (`present`, `ontop`, not `toggledon`) for planner step 3 | Parser/language **not Isaac**. OmniGibson/assets **separate, unaudited**. |
| **SceneEval no-VLM four** | WACV 2026; code MIT 2025; v1.1 27 Oct 2025 | Collision, navigability, OOB, **opening clearance** as **metric definitions** | Support/accessibility/counts **need VLM**. Not a three.js drop-in: needs export/frame adapter + consumer evidence. |
| **SceneSmith** | ICML 2026 Spotlight, [arXiv:2602.09153](https://arxiv.org/abs/2602.09153) 9 Feb 2026; [github.com/nepfaff/scenesmith](https://github.com/nepfaff/scenesmith) MIT | Simulation-ready stages + `house_state.json` **literature**; robot-eval prompt→scene is a **new engine** | **No Mac generation path.** CUDA 24–45 GB + APIs. Do not adopt. |
| **RoboCasa365** | ICLR 2026, [arXiv:2603.04356](https://arxiv.org/abs/2603.04356) 4 Mar 2026; [robocasa/robocasa](https://github.com/robocasa/robocasa) | Kitchen **object/task initial conditions** in MuJoCo; **Mac `mjpython`** | MIT code; declared CC BY 4.0 assets **unaudited**; **kitchen household**, not ED. |

**Closer 2026 search beyond these:** SceneMosaic ([arXiv:2609.05594](https://arxiv.org/abs/2609.05594), 3 Sep 2026) is more room generation (same class as SceneSmith). Affordance2Action ([arXiv:2606.04172](https://arxiv.org/abs/2606.04172), 2 Jun 2026) is real-time part affordance, not initial setup. Neither replaces the six.

**Drop from round 8:** Holodeck (2024 THOR+GPT), LayoutVLM-as-engine (2025, BehaviorAware already wraps that optimizer), HSM (support-region dataset NC; weaker than Function2Scene/BehaviorAware for *activities*), PhyScensis (already in §5; tabletop packing).

## ≤3 design changes (no new engine)

1. **Operational volumes from case activities**, parameterized by a **closed 5th–95th anthropometric table** (reach, body breadth, pull-out), for bedside exam, rail/drawer swing, approach width. Author numbers on the spec; do not run Function2Scene/BehaviorAware solvers.
2. **BDDL-shaped initial predicates** only for states a consumer can represent (`present` / `powered` / `connected` / `incline` / `rail`). Unmet = reject; do not pre-complete learner connect tasks.
3. **Independent checks** reimplemented on **mounted** catalogue meshes after load/ground: overlap, path width, opening/approach clearance. SceneEval’s four names are the checklist; an adapter and UI-XR evidence are required.

**Mac:** RoboCasa demos via `mjpython` are the only inspected 2026 stack that documents Mac. SceneSmith generation is CUDA/Linux. Function2Scene/BehaviorAware have no inspectable Mac runtime.

**Prototype:** keep one existing room. Do not insert SceneSmith/RoboCasa kitchens or Function2Scene room synthesis before the supine contents/offset control.

## Round 10

### Prompt

Round10, third of four new exchanges. Read these actual updated artifacts fully:
docs/openclinxr/scene-layout-consultation-records-2026-09-09/../humanoid-scene-layout-research-brief-2026-09-09.md
docs/openclinxr/scene-layout-consultation-records-2026-09-09/openclinXR-complementary-scene-research.md
Read-only repo/LSP/web permitted. Review integration, not a fresh wish list. Inspect at least relevant runtime/schema/source seams and use LSP for a concrete symbol where useful. Verify whether proposed typed initial predicates and mounted-geometry acceptance fit actual startup/event ownership. Are UNKNOWN/pending vs UNSAT semantics clear? Identify actual needed adapter work without prescribing second state engine.
Challenge your round9 suggestions: a closed 5th–95th table is NOT an authorized clinical standard, can exclude users, and needs provenance and task/actor-specific limits. I did not adopt that prescription. Paper licensing should use first-party publisher/arxiv, not ResearchGate. Your SceneMosaic2609.05594/Affordance2Action2606.04172 leads require exact first-party title/date verification; do not repeat if mismatch. Do not imply BDDL has our literal present/powered predicates without backend mapping; terms here are proposed OpenClinXR vocabulary.
Review six-source note for misleading capability/licenses/hardware claims. No local benchmark was run; 'no inspected Mac path' ≠ impossible. Give at most five source-backed actionable corrections, acceptance or remaining gaps, and exact source links/file lines. Do not edit. <=1100 words.

### Grok visible reply (historical, may contain corrected claims)

I’ll read both updated artifacts, then check startup/event ownership and the six-source note against live schema and first-party pages.I'll re-read both updated artifacts and the runtime/schema seams they attach to, then check first-party paper titles before writing the integration review.Next I’ll inspect the cited startup, event, and loader seams plus first-party paper pages, then use LSP on one concrete symbol.I’ll verify event-schedule ownership, the equipment-normalize seam, BDDL predicates, and the six-source license/hardware claims before writing.BOTTOM LINE: Typed starting-state checks belong on existing load and mount consumers; **startSession** does not observe geometry, and **getScheduledEventsDue** has no production caller.

## Five corrections

1. Complementary L14 (“Adapt the distinction between present, powered and connected”) treats those tokens as BDDL’s. First-party BDDL examples are `ontop`, `stained`, `inroom`, `cooked`, `saturated` ([bddl3 README](https://github.com/StanfordVL/BEHAVIOR-1K/blob/main/bddl3/README.md)). Label `present` / `powered` / `connected` as proposed OpenClinXR predicates that still need a backend mapping. Brief L77 already borrows objects/init/goals only.

2. Brief L69 (“Runtime dispatch owns scheduled events, including second-zero events”) overstates current ownership. `EventScheduleEntrySchema` is authored data (`shared-schemas/src/schemas.ts:307-312`). Domain helper `getScheduledEventsDue` (`domain/src/station-state.ts:105-111`) is covered in `station-state.test.ts:55,81`; LSP `findReferences` on that symbol returned only the definition. `packages/openclinxr/scenario-runtime` has zero `eventSchedule` matches. `startSession` (`scenario-runtime.ts:93-101`) calls `createStationRun` with no options (doorway, `startedAtSecond` 0, traces at 0), does not wait for GLB, and does not issue `START_ENCOUNTER`. `startEncounter` (`scenario-runtime.ts:137-140`) is a later command; UI-XR passes `observedFormAtSecond` (`apps/ui-xr/src/main.ts:2358-2359`); the learner test forbids `atSecond: 0` (`the-learner-runtime-consumes-canonical-exam-phase-traces.test.ts:271`). The runtime tag consumer is actor lookup (`xr-runtime-state/src/scenario-conversation-surface.ts:232`).

3. Complementary L30 and brief L77 collapse `unknown` and `pending` into one result while giving them different promotion rules. Map onto existing statuses: `recordSceneAssetStatus({status:"pending"})` at `xr-asset-loading/src/generated-loaders.ts:433-439` (equipment) and `:510-516` (environment); `"loaded"` after the GLTF callback (`:473-484`); `"failed"` (`:492-498`). Identified consumer still loading: pending, withhold promotion. Missing or unsupported consumer: unsatisfied. No observation yet: unknown. Unknown must never count as satisfied and must never be coerced to false. A `present` check at `startSession` return is early: loaders have not completed.

4. Complementary L34 cites `ScenarioSchema` (`schemas.ts:472`) and `runtime-bundles.ts:85`. `EnvironmentManifestSchema.equipment` (`schemas.ts:396-398`) is the same `Type.Array` of strings as `ScenarioSchema.equipment` (`:490`). Brief L66 already flags case `equipment` strings versus `assetNeeds` IDs. The cited manifest carries the same binding gap.

5. Complementary L34 lists `scenario-runtime.ts:93` as the starting-state seam. Mounted-geometry acceptance is after load, footprint fit, and grounding: `normalizeGltfEquipmentMount` (`xr-station/src/station-equipment.ts:345-378`). Adapter work: observe `recordSceneAssetStatus` plus post-normalize bounds and deck metadata on the mounted `Group`. No second mutable state store.

## Acceptance

Planner as a compiled view, with no second `START_ENCOUNTER`, fits `transitionStation` (`station-state.ts:63-70`) and `createStationRun` doorway default (`:57`). `options.doorway===false` is unused by `startSession`.

A closed 5th–95th table is absent from both artifacts. Complementary L12 and L28 keep envelopes actor-, task-, and equipment-specific; clinical reviewers own thresholds. I retract the round-9 percentile table: it is not an authorized clinical standard, can exclude users, and needs provenance plus those task and actor limits.

Paper links are first-party arxiv, CVF, and GitHub. Neither artifact uses ResearchGate.

SceneMosaic title and date match [arXiv:2609.05594](https://arxiv.org/abs/2609.05594) (submitted 4 Sep 2026). Affordance2Action matches [arXiv:2606.04172](https://arxiv.org/abs/2606.04172) (submitted 2 Jun 2026). Function2Scene matches [arXiv:2605.30819](https://arxiv.org/abs/2605.30819) (29 May 2026). Behavior-Aware matches [arXiv:2603.02662](https://arxiv.org/abs/2603.02662) (3 Mar 2026).

## Six-source note

SceneEval MIT [LICENSE.txt](https://raw.githubusercontent.com/3dlg-hcvc/SceneEval/main/LICENSE.txt) verified; WACV 2026 CVF title matches. “Oral” is not on the inspected CVF HTML. BDDL MIT is the cited component license; L14 is the remaining capability misread. SceneMosaic README requires Linux x86-64, NVIDIA ≥32 GB VRAM, gated SAM3 / SAM 3D Objects, and an OpenAI-compatible API ([repo](https://github.com/rxjfighting/SceneMosaic)). RoboCasa README: MIT code, CC BY 4.0 assets/datasets, “works across all major computing platforms,” Mac demo scripts use `mjpython` ([repo](https://github.com/robocasa/robocasa)). Complementary L16 records that documentation and states no M1 Max benchmark was run. That Mac path is documented; absence of a local benchmark does not make M1 execution impossible.

Remaining gap: no inspected runtime consumer for `powered` or `connected`; requiring those at start reports unsatisfied until a consumer exists.

NEXT: keep the first planner slice on one room and existing catalogue IDs; attach check observations to load/normalize callbacks. Clocked `eventSchedule` dispatch is a separate wiring of the existing helper, if product needs it.

## Round 11

### Prompt

Round11, fourth and FINAL requested new exchange, continuing original conversation. Re-read both final artifacts at paths from round10. Final bounded adversarial review, <=700words, at most3 residual corrections; no new broad survey. All repo/LSP/web access remains available; inspect narrowly as needed. Do not edit.
I applied your round10 corrections with qualifications: explicit proposed OpenClinXR predicate names/backendmapping; four check outcomes satisfied/unsatisfied/pending/unknown separate from assetloadstatus; manifeststringbindinggap; actual load/normalize observation; runtime eventdispatch wording now proposed requirement, helper definition+tests not assumed wired dispatcher; remote startup observedformtime and integration gap explicit.
I independently caught a further trap in generated-loaders.ts433–484: suppressEquipmentModel branch records status loaded with fallbackActive true and returns BEFORE mounting requestedGLB. Thus check loaded is NOT sufficient; both artifacts now require exactrealizedidentity/fallback/geometry/state. Verify no text still infers loaded=satisfied. Also do not describe startSession as geometrycheckboundary.
Newer watchlist uses independentlyverified SceneMosaic4Sep2026 (your round9said3Sep), MITcode with separate gatedmodelrights, and Affordance2Action2Jun2026, without prototype adoption. Main sixreferences retained; round9closedpercentiletable rejected.
Review only if recommendations are implementable incremental extensions, faithful to current code, and precisely sourced. Do not demand more code/modeltesting for a document review or reopen approved scope. Please give verdict accept/acceptwithspecificcorrections, strongest remaining implementation risk, and anything in your earlier advice that should be explicitly retracted. LSP no-result or huge generic references are not proof of absent integration; grep/directreads support findings.

### Grok visible reply (historical, may contain corrected claims)

I'll re-read both final artifacts and the suppress-equipment loader branch, then check that `loaded` is never treated as satisfied.I’ll grep both artifacts for leftover `loaded`=satisfied wording, `startSession` as a geometry boundary, and the SceneEval Oral claim.**Accept** with two wording residuals. Round-10 items land; `generated-loaders.ts:447-462` remains the implementation trap.

## Residuals

1. Brief L69 still names an “existing runtime's scene-entry handoff.” No inspected symbol has that name. Keep the proposed pre-event snapshot, recorded against actual `phase` and domain time, after consumer-observed identity, fallback, geometry and state. Complementary L34 already calls session startup a state-ownership seam.

2. Complementary L34 “Observe load/mount callbacks after normalization” does not match the suppress path. `shouldSuppressEquipmentModel` records `status: "loaded"`, `fallbackActive: true`, then `return` before `normalizeEquipmentMount` / `sceneSlot.add` (`generated-loaders.ts:447-462`, `:467`). Align that sentence with brief L77: observe the callback; if suppress returned, the fallback is the realized geometry.

No remaining sentence treats asset-load `loaded` as check-outcome satisfied. Brief L77 and complementary L34 both require exact realized identity, fallback status and required geometry/state. Brief L87 / L158 “loaded humanoid” names the animation child node, not SAT.

## Retract from earlier Grok advice

Closed 5th–95th anthropometric table (not an authorized clinical standard; can exclude users; needs provenance and task/actor limits). BDDL as owner of `present` / `powered` / `connected`. `getScheduledEventsDue` as a wired production dispatcher. `startSession` as a geometry-check boundary. Asset-load `loaded` as satisfied. SceneMosaic submitted 3 Sep 2026 (first-party [arXiv:2609.05594](https://arxiv.org/abs/2609.05594) is 4 Sep). Mac/`mjpython` as impossible. Round 10 “Oral unverified on CVF HTML”: WACV lists SceneEval in Oral Session 9A ([session 1147](https://wacv.thecvf.com/virtual/2026/session/1147)). LSP empty results or `node_modules` floods as proof of missing integration.

## Landed (grep/direct read)

Four check outcomes, separate from asset-load status: brief L77, complementary L30. BDDL pattern with proposed OpenClinXR names and backend mapping: complementary L14. Manifest free-text equipment strings: complementary L34, `schemas.ts:396`. Event dispatch is a proposed ownership requirement; helper definition/tests are not a wired dispatcher (brief L69, R57 `station-state.ts:104`). Remote startup uses observed form time and does not await these checks (`main.ts:2345-2359`, R58). SceneMosaic 4 Sep 2026, MIT code, gated model rights, outside prototype; Affordance2Action 2 Jun 2026 likewise. Main six references retained. No percentile table.

## Strongest remaining implementation risk

A worker who waits for normalize, or who promotes on `loaded`, will accept a suppressed mismatched GLB whose requested mesh never mounts. The documents now forbid that; the branch still exists.

NEXT: implement the bounded one-room planner slice on existing catalogue IDs, with identity/fallback/geometry/state observed on both loader exits.

## Artifact integrity

Final brief SHA-256: `caf27580d2956310fe463f5bfc36a471844ec6d7a35a0c5bd0249b08938245bb`.

Final research note SHA-256: `ca85a61a9fe98bde843fbdc58704f05484cef41a6000880cbb0885165ee9eab0`.

Internal reasoning and raw tool outputs are omitted. Model agreement is not runtime, hardware, clinical or license validation.
