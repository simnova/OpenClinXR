# UI-XR Encounter Realism Screenshot Review - 2026-05-26

## Scope

Local desktop-browser screenshots were captured in actor-realism mode for the pediatric asthma visual-review scene and the five default exam-sequence encounters. This is local browser visual evidence only, not Quest readiness, production asset readiness, clinical validity, or scoring validity.

Evidence bundle: `docs/openclinxr/ui-xr-realism-review-screenshots-2026-05-26.json`

## Screenshots reviewed

- Pediatric Asthma: `docs/openclinxr/screenshots/ui-xr-realism-review-pediatric-asthma-2026-05-26.png`
- ED Chest Pain: `docs/openclinxr/screenshots/ui-xr-realism-review-ed-chest-pain-2026-05-26.png`
- OB Headache/Preeclampsia: `docs/openclinxr/screenshots/ui-xr-realism-review-ob-preeclampsia-2026-05-26.png`
- Clinic Abdominal Pain/Interpreter: `docs/openclinxr/screenshots/ui-xr-realism-review-clinic-abdominal-pain-2026-05-26.png`
- Oncology Bad News/Family: `docs/openclinxr/screenshots/ui-xr-realism-review-oncology-bad-news-2026-05-26.png`
- Postop Fever/Consult Pressure: `docs/openclinxr/screenshots/ui-xr-realism-review-postop-fever-2026-05-26.png`

## Findings

1. Pediatric Asthma is currently the only screenshot that reads as a pediatric-specific encounter.
   - The scene is less cluttered than prior captures and the panel/pose proxy clutter is reduced.
   - The patient is smaller and the room includes pediatric/asthma cues.
   - Remaining realism gap: all actors still share the same underlying humanoid mesh family and neutral stance language. Runtime clothing/accessory cues help, but actor-specific Anny humanoid GLBs are still required.

2. ED Chest Pain actor-realism capture booted into a blocked 3D scene.
   - The visible error is `Cannot read properties of undefined (reading 'x')`.
   - This is a functional blocker for ED visual realism review because no 3D actors or environment are visible.
   - Priority: fix ED fallback/runtime placement data before judging ED realism.

3. OB, Clinic, Oncology, and Postop captures are not scenario-specific.
   - The right panel and 3D scene still show ED Chest Pain content and ED-like clutter.
   - These cannot be accepted as encounter realism evidence for their requested scenarios.
   - Priority: prevent non-ED scenarios from falling back to ED visual content when generated learner bundles are missing or blocked.

4. Shared visual weaknesses across visible 3D scenes.
   - Humanoids still read as duplicated mannequin-like bodies.
   - Actor poses remain too similar at a glance.
   - Environment objects are blocky and many props lack clear clinical purpose.
   - Facial expression, gaze, and mouth realism are not provable from these stills.

## Recommended next implementation order

1. Fix ED runtime boot blocker so ED Chest Pain can render for review.
2. Add a non-ED scenario fallback guard: if a generated bundle is missing, show an explicit scenario-unavailable review state rather than ED Chest Pain visuals.
3. Materialize actor-specific humanoid variant assets from the factory contract instead of adding more runtime overlays.
4. Generate scenario-specific minimal room manifests for OB, Clinic, Oncology, and Postop before claiming visual review coverage.
5. Re-capture the same six screenshots after each lane has a scenario-specific rendered scene.

## Follow-up capture/fix pass: 2026-05-26, runtime fallback and placement hardening

Evidence set:
- Contact sheet: `docs/openclinxr/screenshots/ui-xr-realism-review-fixed3-contact-sheet-2026-05-26.png`
- Evidence JSON: `docs/openclinxr/ui-xr-realism-review-fixed3-screenshots-2026-05-26.json`
- Per-encounter screenshots: `docs/openclinxr/screenshots/ui-xr-realism-review-fixed3-*.png`

Fixes applied:
- ED Chest Pain no longer boot-blocks on malformed generated room prop metadata; room prop position, scale, label, affordance cue, and color values now normalize to safe scenario-bounded fallbacks before Three.js object creation.
- Non-materialized encounters no longer render ED Chest Pain clutter as false realism evidence. OB, clinic, oncology, and postop now show their scenario-specific UI text plus a left-side 3D-pending panel that hides the mismatched ED fallback bundle until the encounter factory materializes their own scene bundles.
- Runtime actor/equipment placement now validates vector fields before applying `position` and `scale`, preventing incomplete generated manifest data from crashing scene boot.
- Rig-control base transforms now require stored `scale` before reuse, preventing stale partial base-transform data from breaking procedural pose scaling.
- A debug-only station boot error stack is stored on `window.__openClinXrLastStationSceneBootErrorStack` to shorten future visual evidence triage.

Adversarial visual review after fixes:
- Pediatric Asthma: still scenario-specific and decluttered relative to the original user screenshot; remaining realism gap is actor-specific high-fidelity humanoid materialization and more visible role-specific pose differentiation.
- ED Chest Pain: scene now renders instead of showing a boot blocker; remaining realism gap is same shared low-fidelity mannequin source and weak visible pose differentiation.
- OB Preeclampsia, Clinic Abdominal Pain Interpreter, Oncology Bad News Family, Postop Fever Consult Pressure: UI now reflects the selected encounter instead of ED. 3D remains intentionally blocked/pending until scenario-specific runtime bundles are generated, which is preferable to showing misleading ED assets.

Verification:
- `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts` passed.
- `pnpm --filter @openclinxr/ui-xr typecheck` passed.

Next appropriate product slice:
- Materialize scenario-specific runtime bundles for OB, clinic, oncology, and postop from the encounter factory, reusing the shared asset library where possible, then repeat this screenshot review with real generated encounter geometry instead of the honest 3D-pending panel.
- Upgrade humanoid actor variants so patient, nurse/clinician, family/observer, and child actors are not the same neutral mesh with only minor cues.

## Multimodal adversarial scene comparison pass: 2026-05-26

Evidence set:
- Before cue additions: `docs/openclinxr/screenshots/ui-xr-multimodal-review-contact-sheet-2026-05-26.png`
- After cue additions: `docs/openclinxr/screenshots/ui-xr-multimodal-review-cued-contact-sheet-2026-05-26.png`
- Runtime evidence JSON: `docs/openclinxr/ui-xr-multimodal-review-cued-evidence-2026-05-26.json`

Scene description from visual evidence before adjustment:
- All loaded encounters presented as a sparse dark room with the same neutral humanoid body type, similar standing posture, and mostly generic white/gray blocks.
- The side panel carried the correct encounter identity, but the 3D scene itself did not clearly communicate OB triage, interpreter-mediated abdominal pain, oncology serious-news, or postop fever without reading the UI text.
- The generated bundles were loading, but visual expectations remained under-specified in-scene.

Expected representation:
- The 3D scene should visibly reinforce the encounter definition: chief concern, vitals/interruption context, and role-specific clinical cues should be legible inside the room.
- Actors should not depend only on text labels; patient/clinician/family cues should be visible as attached body/role artifacts.

Adjustments made:
- Added an in-scene scenario expectation panel for loaded generated bundles, displaying chief concern, vitals, and interruption so multimodal review can compare scene intent directly against the encounter definition.
- Added actor-attached scenario cues: OB pregnancy abdomen and BP workflow cue, clinic right-lower-quadrant pain and interpreter-boundary cues, oncology tissue/emotion and soft-consult cues, postop abdominal dressing and surgery-resident cue.
- Reframed the expectation panel to avoid left-edge clipping in actor-realism captures.

Residual adversarial findings:
- This improves scenario recognizability but remains a cue-layer over low-fidelity shared humanoid assets.
- Next realism step should replace shared neutral humanoids with actor-specific generated variants and improve pose/locomotion clips per role.

## WebXR-only screencap refinement round 2: 2026-05-26

Evidence set:
- Initial WebXR-only contact sheet: `docs/openclinxr/screenshots/ui-xr-webxr-only-round2-contact-sheet-2026-05-26.png`
- Refined WebXR-only contact sheet: `docs/openclinxr/screenshots/ui-xr-webxr-only-round2-final-contact-sheet-2026-05-26.png`
- Final evidence JSON: `docs/openclinxr/ui-xr-webxr-only-round2-final-evidence-2026-05-26.json`

Multimodal scene-only review:
- The WebXR scene now shows scenario-specific in-room expectation panels and actor-level role cues without relying on the right-side runtime panel.
- OB, clinic, oncology, and postop are distinguishable from each other by patient/body cues, clinical-role accents, and scenario expectation text.
- The first round revealed the actor-specific hair cue was oversized and visually crossed eyes/mouth like a visor; it was refined upward/back and reduced in scale.

Residual gap:
- The scenes are more semantically legible, but actor bodies remain shared low-fidelity mannequin variants. Next refinement should replace cue overlays with real actor-specific generated humanoid meshes, authored facial/eye/lip rig behavior, and role-specific idle/locomotion clips.

## WebXR-only artifact removal/refinement round: 2026-05-26

Evidence set:
- Before contact sheet: `docs/openclinxr/screenshots/ui-xr-webxr-only-artifact-review-before-contact-sheet-2026-05-26.png`
- After contact sheet: `docs/openclinxr/screenshots/ui-xr-webxr-only-artifact-review-after-contact-sheet-2026-05-26.png`
- After evidence JSON: `docs/openclinxr/ui-xr-webxr-only-artifact-review-after-evidence-2026-05-26.json`

Scene-only finding:
- The repeated artifact was not just reused humanoids; it was the shared dark backdrop, gray floor, and generic blue/white reused prop identity that made doorway views feel like the same world.

Refinement:
- Added encounter-derived doorway visual themes from the selected runtime bundle: background, floor, panel accent, and reused-asset accent colors now vary by encounter.
- Reused assets remain allowed, but the runtime scene records an explicit policy that reused objects are dynamically themed for the encounter rather than hardcoded as one shared scene identity.
- Added a distinct ED theme so ED no longer shares the default/fallback look with other encounters.

Verification:
- `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts` passed.
- `pnpm --filter @openclinxr/ui-xr typecheck` passed.

Residual gap:
- This removes a major same-world artifact. Next quality step is moving from dynamically themed reused assets to actor/environment assets materialized per encounter from the factory and shared-asset-library references.

## WebXR-only dynamic-cleanup refinement round: 2026-05-26

Evidence set:
- Contact sheet: `docs/openclinxr/screenshots/ui-xr-webxr-only-dynamic-cleanup-contact-sheet-2026-05-26.png`
- Evidence JSON: `docs/openclinxr/ui-xr-webxr-only-dynamic-cleanup-evidence-2026-05-26.json`
- Per-encounter WebXR-only crops: `docs/openclinxr/screenshots/ui-xr-webxr-only-dynamic-cleanup-*-2026-05-26.png`

Scene-only review:
- The WebXR crop now excludes the side panel and captures each encounter doorway under `dynamic-only-visual-cleanup`.
- Same-world artifact reduction improved: each encounter now carries a distinct runtime-derived room theme, no hardcoded ED object-prefix leaks were detected in the capture evidence, and room props in cleanup mode are rendered only when supplied by the active encounter scene manifest or explicitly allowed as essential scene anchors.
- Actor pose differentiation improved for non-ED generated encounters: OB, clinic/interpreter, oncology/family, and postop now apply case-derived root posture profiles instead of inheriting the ED chest-pain guarding pose.
- Pediatric and ED captures exposed unavailable generated humanoid GLB paths in this local evidence run. The runtime now restores primitive actor fallbacks instead of showing an empty doorway, while preserving a clear fallback policy and avoiding readiness claims.

Residual adversarial findings:
- Primitive fallback actors in pediatric and ED are visibly lower fidelity than the generated humanoid captures and should be treated as asset-availability blockers, not acceptable realism output.
- Non-ED generated actors are more distinguishable by theme, posture, and role cues, but still rely on shared mesh family and cue overlays. The next product slice remains actor-specific generated humanoid materialization with validated face/eye/lip rigging and generated idle/locomotion clips.

Verification:
- `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts` passed.
- `pnpm --filter @openclinxr/ui-xr typecheck` passed.

## Reusable exterior room plus dynamic encounter portal: 2026-05-26

Evidence set:
- Contact sheet: `docs/openclinxr/screenshots/ui-xr-webxr-only-portal-anteroom-contact-sheet-2026-05-26.png`
- Evidence JSON: `docs/openclinxr/ui-xr-webxr-only-dynamic-cleanup-evidence-2026-05-26.json`

Refinement:
- Added a reusable pre-encounter anteroom that can be shared across stations for doorway orientation and patient-note capture only.
- Added a portal threshold with encounter-derived accent color and policy metadata stating that the clinical world beyond the door is generated from the active runtime bundle.
- Split the floor semantics: the anteroom floor is reusable, while the clinical encounter floor beyond the threshold is encounter-specific and runtime-themed.
- Corrected the portal wall so it acts as an open frame/transparent threshold rather than a solid occluder.

Scene-only finding:
- The WebXR-only capture now shows a reusable exterior doorway in front, with visually distinct encounter worlds visible through the portal.
- This supports the intended mental model: notes and transition happen outside the room; the world entered through the doorway belongs to the selected encounter.

Residual gap:
- The portal is currently visual/semantic; next implementation should bind locomotion/entry state so crossing the threshold can trigger encounter start, timer policy, and in-room interaction mode.

## Portal-entry interior evidence refinement: 2026-05-26

Evidence set:
- In-room portal-entry screenshot: `docs/openclinxr/screenshots/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.png`
- Portal-entry evidence JSON: `docs/openclinxr/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.json`

Refinement:
- Captured `openclinxrPortalStart=encounter` for OB Preeclampsia to prove deterministic entry into the dynamic encounter world.
- Evidence reports `side: dynamic_encounter_world`, `encounterEntered: true`, `encounterStartedByPortal: true`, and `reusableExteriorHiddenForEncounterView: true`.
- A visual pass showed the portal frame still occluded the left actor after entry; the interior visibility policy now hides the reusable note shell and the portal frame/opening/threshold when inside the encounter world.

Scene-only finding:
- The latest in-room screenshot no longer shows the exterior note panel, exterior floor, or portal frame occluding the clinical scene.
- The remaining visible artifacts are humanoid realism issues and generated prop quality, not doorway architecture bleed-through.
