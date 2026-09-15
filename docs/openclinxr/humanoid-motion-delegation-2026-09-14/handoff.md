# Humanoid motion and scene-closure delegation handoff

**Prepared:** 2026-09-14  
**Repository:** `simnova/OpenClinXR`  
**Authority:** execution evidence. The live BothyBoard card is the worker contract; protected policy and code invariants override this handoff on conflict.

## Outcome

Close the remaining gap between the deterministic OpenClinXR factory and a rendered encounter: a case-defined patient lies on the authored bed, a physician approaches and stops at a useful bedside position, equipment remains correctly staged, and a case-authored touch response is compiled, bound to the already loaded patient skeleton, played through the normal UI-XR path, and captured with machine-readable and visual evidence.

This is a closure slice, not a new motion architecture. It uses the code already present on main:

- case intent and frozen scene-plan replay in `packages/openclinxr/asset-registry/src/`;
- the semantic scene graph, requirements, solver, admission, and runtime consumer already proven by SC-01 through SC-06;
- `planMotionProgram`, `compileMotionProgram`, deterministic GLB bake/readback, and manifest publication;
- the existing `AnimationMixer`, `playManifestMotionClip`, clinical-touch lookup, and one-shot response path;
- the current MPFB2 cast and derived skeleton profiles.

## Facts pinned from current main

The execution package was written against main after `ea0e50c3`. Re-measure before implementation if main advances materially.

| Fact | Current code evidence | Consequence |
|---|---|---|
| The scene-closure case has a supine patient and standing physician. | `apps/ui-xr/src/the-normal-encounter-physician-approaches-and-stops.test.ts`; `packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts` | Walking and patient-response work remain separate proofs. |
| The ED touch fixture is `ed_chest_pain_priority_v1 / patient_robert_hayes_v1 / abdomen_rlq`. | `packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts` | The motion chain uses one real authored row, not a synthetic payload. |
| Robert loads the promoted MPFB gown actor. | `packages/openclinxr/asset-registry/src/actor-casting.ts` | Compile and runtime bind must derive names from that exact GLB. |
| Supine actors intentionally receive no mixer. | `packages/openclinxr/xr-asset-loading/src/humanoid-animation.ts` | A bounded upper-body one-shot carveout is required before patient playback. |
| Manifest playback already selects a named clip on a mixer. | `apps/ui-xr/src/motion-manifest-motion-address.ts` | Do not introduce another player. |
| Gateway publication currently bakes from a payload rather than the real scenario planner/compiler path. | `packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts` | The real compile/publication seam remains open. |
| `compileScenarioMotion` uses the scenario id in `sourceRefs`; the requested region clip id is selected only from one `touch:<region>` ref. | `packages/openclinxr/motion-compiler/src/program/compile-scenario-motion.ts`; `compile-motion-program.ts`; `packages/openclinxr/scenario-fixtures/src/touch-response-clip.ts` | C1 must close the clip-namespace split in production, not only in a constructed test. |
| MPFB uses sanitised loaded-joint names such as `upperarm01R`; constructed Mixamo names such as `upper_armR` are not proof. | `packages/openclinxr/xr-humanoid-animation/src/pose-bone-resolver.ts` and derived-profile tests | Every emitted track must name a joint on the loaded actor profile. |
| SC-07 is ready but its blocker text is stale; the remaining question is the browser approach measurement. | BothyBoard `tsk_93b6e2aa66b6c3fa` | Hold dispatch until A1 records one of the three explicit verdicts below. |
| The broad public-surface route card predates the now-landed resolver correction. | BothyBoard `tsk_7c2a05ec168cedc5`; landed `tsk_c1a0aa430750e5d5` | Replace it with the narrower A3 card after the motion exports freeze. |

## Laws that every card preserves

1. `responseClipForBodyRegion` is the clip-name authority. A hash fallback is a failed treatment for the chosen touch row.
2. Tracks use the sanitised joint names derived from the pinned actor GLB. No second alias table and no constructed Mixamo profile may stand in for it.
3. The baked GLB is an interchange sidecar. Runtime converts `CompiledMotionClipV1` to a `THREE.AnimationClip` and binds it to the already loaded humanoid. Parenting the sidecar as another figure is forbidden.
4. A supine mixer may run only posture-compatible, translation-safe one-shot response clips. It must not autoplay a standing idle, role, or locomotion clip, and must not undo the recumbent plant.
5. Machine evidence binds the git SHA, case, actor, asset content hash, deterministic seed, motion-program hash, skeleton-profile hash, clip id, driven-bone set, and measurement units.
6. Visual media is review evidence. A byte threshold alone never proves motion. The machine gate uses `clipPlayed`, mixer root identity, scene-child count, and measured bone deltas.
7. Generated code, weights, and data remain local and permissively licensed. No external network call or unverified research asset enters this slice.
8. Do not run wholesale document-authority regeneration. Register this handoff through a bounded append only.
9. Do not weaken the supine guard, scene admission, support-instance binding, package surface ceilings, or criterion 6 to make a card green.

## Execution graph

```text
A1 browser foot truth ───────────────► SC-07 release decision

C0 safe supine one-shot mixer ─┐
                               ├──► C2 loaded-skeleton bind ─► C3 visible normal-path proof
C1 real compile/publication ───┘                 │
                                                └──► A3 truthful public-surface admission
```

A1 and C0 are lane A and therefore execute serially. C1 is lane B and may execute in parallel. C2 waits for C0 and C1. C3 waits for C2. A3 waits for C1, C2, and the already-landed review-group resolver correction.

### A1 — Browser foot truth

Run two successful browser captures on the same SHA through the existing SC-05 UI-XR capture. Produce a tracked compact JSON report under `tools/openclinxr/evidence/scene-closure/proofs/sc-05/current-main-browser-foot-truth/`; raw recordings may remain in the authorised artifact store, but the report must include their hashes and retrieval references. Both runs must have samples, a non-`None` drive source, phase rows, and left/right toe depths. Compare them with the node known-good for the shipped physician and walk clip.

The card records exactly one verdict:

- `instruments_agree`: browser and node both show no over-limit penetration. Release SC-07; never create A1b; cancel or retain blocked the old standing-foot card.
- `browser_submerged`: settling/arrived remains at least 0.03 m while walking is at most 0.005 m. Hold SC-07; create A1b from the conditional contract in `plan.json`.
- `capture_null`: either run has zero samples or no drive source. Hold SC-07 and repair the instrument before any foot correction.

A1 does not edit animation product code and does not judge pixels.

### C0 — Safe supine upper-body one-shot mixer

Add the smallest carveout that lets `patient_robert_hayes_v1` own a mixer for an explicitly selected, posture-compatible response clip. The control is the current supine rule: standing idle, role, locomotion, root translation, and leg translation tracks remain refused or unplayed. The patient stays on the same stretcher support with the same world transform before, during, and after the response. This card does not compile a clip and does not touch UI-XR.

Stop if the compatibility rule cannot be expressed from clip metadata and track inspection without an actor-specific string exception. Report the missing contract rather than making every supine actor mixable.

### C1 — Real scenario compile and publication

Feed the real authored RLQ row through planner, profile derivation from Robert's promoted GLB, canonical compiler, deterministic bake, and manifest publication. Emit the sidecar GLB and `CompiledMotionClipV1` JSON. The clip id must equal the fixture row's `responseClip` and GLB readback. Every driven bone must exist on the derived profile. Region mutation must change the identity and bytes; identical input must be byte-identical. Missing program, profile, or landmarks refuses. External network and spend remain zero.

This card may add only the public compiler symbol a real gateway consumer requires. It must not pre-approve that export; A3 inventories the final surface after C2.

### C2 — Bind the sidecar to the loaded patient

Convert the compiled JSON tracks into a `THREE.AnimationClip`, verify its identity and driven-bone set against the GLB readback, register it in Robert's existing animation slot, and play it on the mixer whose root is the already loaded MPFB patient. At a pinned mid-clip time at least one named upper-body bone must move from bind pose by the specified epsilon. Scene root and skinned-mesh counts must not increase.

Do not load or parent the bake GLB as a second actor. Do not bind to a dummy group, a standing physician, or a constructed skeleton.

### C3 — One visible normal-path response

Use the production clinical-touch route for the pinned fixture: `handleClinicalTouch` → `respondToTouch` → `playOneShotResponseClip`. Require `clipPlayed === true`, the selected slot contains the authored response clip, the mixer root is Robert's loaded humanoid, and a driven upper-body bone moves while the supine support/world transform remains fixed. Produce a compact measurement JSON and isolated native front, three-quarter, and short motion-probe media. The owner reviews the pixels after the worker reaches review; the TREE proof rests on measurements, not file size.

### A3 — Truthful public-surface admission

After C1 and C2 freeze their consumer-facing symbols, inventory the live barrels and create a new approval group. Preserve the landed resolver rule that unknown group ids resolve to `undefined`. Criterion 5 should stop naming the admitted symbols; criterion 6 remains independently red, so acceptance may still refuse. A second session distinct from the worker must review the group before landing. Do not edit an existing closed approval or fabricate its hash.

## Board and dispatch policy

- The operator starts with the A1 task id recorded in `plan.json`. C1 is the parallel lane-B starter when capacity permits.
- SC-07 (`tsk_93b6e2aa66b6c3fa`) stays undispatched until A1 records a verdict. Its immutable dependencies are not rewritten.
- The standing-foot card (`tsk_560ff7627adfecf5`) stays blocked and undispatched. A1 decides whether its premise survives.
- The old broad public-surface card (`tsk_7c2a05ec168cedc5`) is superseded by A3 and should not be dispatched.
- A1b is not pre-created. Only the `browser_submerged` verdict authorises creating it from `plan.json`.
- Workers read their live card first, then this handoff and the corresponding JSON artifact. On any conflict, the live card wins.
- Workers stop at `review`. The owner grades visual evidence, performs any independent approval review, and lands through proofs.

## Research boundary

Kimodo, Ardy, DIP, CLoSD, CHOICE, ReMoGen, SceMoS, affordance-motion work, PlaceIt3D, PhyScensis, MPFB2/MakeHuman, and the cited foot-locking technique remain research inputs rather than dependencies. Their code, weights, datasets, model terms, and output licences require first-party verification before adoption. This closure chain uses the repository's deterministic local path and validates on the existing Apple Silicon M1 Max 64 GB workflow.

## Artifact map

- `plan.json` contains the graph, laws, stop policy, and board ids.
- `cards/a1.json`, `cards/c0.json`, `cards/c1.json`, `cards/c2.json`, `cards/c3.json`, and `cards/a3.json` contain the exact immutable creation payloads and resulting task ids.
- The live BothyBoard task remains authoritative after Plant.

