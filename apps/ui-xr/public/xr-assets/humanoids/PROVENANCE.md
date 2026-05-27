# OpenClinXR XR Humanoid Anny-Derived Provenance

## Artifact

- `neutral-generated-human.glb`
- SHA-256: `d3ba654c2d79cd63481756c8a14ef68043d5d7d2f855863e99daca2e0f1e8149`

## Source

- Base body mesh generated locally with Anny `0.3.1`, the preferred permissive human-generation baseline identified in the OpenClinXR technology approach.
- Anny source OBJ: `.openclinxr/asset-production/ed-chest-pain/generated-human-rigging/anny-neutral-generated-human.obj`.
- Anny source manifest: `.openclinxr/asset-production/ed-chest-pain/generated-human-rigging/anny-source-generator-manifest.json`.
- GLB generator: `tools/openclinxr/generated-human-rigging-artifacts.ts`.
- The GLB wraps the Anny-derived neutral body mesh in the OpenClinXR canonical humanoid armature and exports a browser-loadable asset for local Quest/WebXR evidence gathering.
- The current runtime candidate includes visible Anny-derived body geometry plus local hair, eyes, scrub tunic, scrub pants, shoes, face/lip/eye rig controls, and ragdoll/physician interaction proxy nodes so visual QA can distinguish the generated humanoid from removed primitive stand-ins.
- Companion reports: `.openclinxr/asset-production/ed-chest-pain/generated-human-rigging/canonical-skeleton-binding.json` and `.openclinxr/asset-production/ed-chest-pain/generated-human-rigging/skin-weight-quality.json`.
- 2026-05-23 realism refinement: local Blender pass added GLB animation channels and morph targets for mouth, brow, and cheek expression. Pre-refinement backup: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-animation-2026-05-23.glb`.
- Gate evidence: `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-animated-2026-05-23.json`.

## Policy

- Local authoring output only.
- Anny code is Apache-2.0; bundled MPFB2 asset-license posture is recorded in the Anny source manifest for review before any production asset decision.
- No cloud APIs, paid APIs, or third-party hosted generation services were used.
- Current deformation uses the OpenClinXR canonical Blender rig with heuristic skinning, face/lip/eye controls, and local interaction collision proxies; it is intended as an evidence-gated runtime candidate, not final character art.
- The current animation/morph-target pass is local deterministic authoring evidence only; it improves runtime realism gates but does not imply final production animation quality.
- No production asset readiness, Quest readiness, clinical validity, or scoring claim.
- Primitive in-scene actor geometry is no longer an accepted humanoid artifact path; if the Anny-derived GLB fails to load, evidence must report the failure rather than substituting legacy non-Anny humanoid stand-ins.

## 2026-05-27 MPFB local comparator

- Added non-promoted comparison candidate `candidates/mpfb-ob-patient-aisha-rigged-candidate.glb`.
- SHA-256: `0bf0988dd8e18bb89dcec25a70072504575cae378ba3f9444c548f20daef8d3d`
- Source tool: MPFB 2.0.15 from Blender Extensions, staged locally in `.openclinxr-local/provider-cache/mpfb/`.
- Generator: `tools/openclinxr/blender/materialize_mpfb_humanoid_candidate.py`.
- Purpose: compare a MakeHuman/MPFB-derived, rigged humanoid source against the current Anny OB patient fallback.
- Runtime use: only through the explicit `humanoidSourceComparator=mpfb_ob_patient` comparison query flag for OB screenshot evaluation; not promoted as default runtime asset.
- Claim boundary: comparator evidence only; not AAA humanoid realism, production readiness, Quest readiness, clinical validity, or scoring validity.

## 2026-05-27 CharMorph Antonia local comparator

- Added non-promoted comparison candidate `candidates/charmorph-antonia-ob-patient-candidate.glb`.
- SHA-256: `9bdb335c7e06b96ac4e0f64d59a36857e8a7449a6cc779e2c0f382ad83392b31`
- Source tool: CharMorph v0.4.0-3 with the Antonia v1.2 character pack staged locally in `.openclinxr-local/provider-cache/charmorph/`.
- Generator: `tools/openclinxr/blender/materialize_charmorph_antonia_candidate.py`.
- Purpose: compare a permissively sourced CharMorph/Antonia humanoid with skinning, morph targets, Rigify-compatible rigging, and deterministic clinical idle/expression clips against Anny and MPFB candidates.
- Runtime use: only through the explicit `humanoidSourceComparator=charmorph_antonia_patient` comparison query flag for OB screenshot evaluation; not promoted as default runtime asset.
- Claim boundary: comparator evidence only; not AAA humanoid realism, production readiness, Quest readiness, clinical validity, or scoring validity.

## 2026-05-27 CharMorph Reom local comparator

- Added non-promoted comparison candidate `candidates/charmorph-reom-ob-patient-candidate.glb`.
- SHA-256: `47640a2d45a9b5c0b3c5a93885c59870ca19bcb52eeb881017668166c612428b`
- Source tool: CharMorph v0.4.0-3 with the Reom v0.5 character pack staged locally in `.openclinxr-local/provider-cache/charmorph/`.
- Generator: `tools/openclinxr/blender/materialize_charmorph_reom_candidate.py`.
- Purpose: compare a second permissive CharMorph humanoid source with lower vertex count, skinning, morph targets, and deterministic clinical idle/expression clips against Anny, MPFB, and Antonia candidates.
- Runtime use: only through the explicit `humanoidSourceComparator=charmorph_reom_patient` comparison query flag for OB screenshot evaluation; not promoted as default runtime asset.
- Claim boundary: comparator evidence only; not AAA humanoid realism, production readiness, Quest readiness, clinical validity, or scoring validity.

## 2026-05-23 visual detail refinement

- Refinement pass: `anny_compatible_visual_detail_pass` using local Blender geometry on top of the animated/morph-ready generated humanoid.
- Added visible face, hair, brows, eyes, pupils, nose, lips, scrub tunic, sleeves, name badge, shoes, and material-detail nodes while preserving the existing animation/morph asset lane.
- Backup before visual-detail refinement: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-visual-detail-2026-05-23.glb`
- SHA-256 after refinement: `d3ba654c2d79cd63481756c8a14ef68043d5d7d2f855863e99daca2e0f1e8149`
- Evidence boundary: this improves local visual realism for review; it is not production asset readiness, validated clinical expression fidelity, or Quest readiness.

## 2026-05-23 camera-facing silhouette refinement

- Refinement pass: `anny_compatible_camera_facing_silhouette_pass` to reduce the rectangular mannequin read in runtime screenshots.
- Added camera-facing skin head/neck, hair silhouette, scrub torso/leg panels, V-neck/waist shadows, and front-most eyes/brows/nose/lips so the examinee view reads as a humanoid instead of a gray slab.
- Backup before silhouette refinement: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-silhouette-refinement-2026-05-23.glb`
- SHA-256 after refinement: `d3ba654c2d79cd63481756c8a14ef68043d5d7d2f855863e99daca2e0f1e8149`
- Evidence boundary: local visual-silhouette improvement only; not production asset readiness, validated clinical expression fidelity, or Quest readiness.

## 2026-05-23 proportioned visual body pass

- Refinement pass: `anny_compatible_proportioned_visual_body_pass` to dim the legacy blocky base mesh and add a proportioned camera-facing humanoid body.
- Added proportioned head, torso, limbs, hands, legs, shoes, hair, eyes, brows, nose, lips, and scrub body primitives in front of the retained rig/morph source mesh.
- Backup before slab replacement: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-slab-replacement-2026-05-23.glb`
- SHA-256 after refinement: `d3ba654c2d79cd63481756c8a14ef68043d5d7d2f855863e99daca2e0f1e8149`
- Evidence boundary: local visual review improvement only; retained rig/morph mesh remains the evidence source for animation gates, not production human realism.

## 2026-05-23 face-layer consolidation

- Consolidated prior experimental visual layers by removing `openclinxr_visual_detail_*` and `openclinxr_camera_facing_*` nodes.
- Retained a single `openclinxr_proportioned_*` visible humanoid layer plus the dimmed legacy rig/morph source mesh.
- Backup before consolidation: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-face-layer-consolidation-2026-05-23.glb`
- SHA-256 after consolidation: `d3ba654c2d79cd63481756c8a14ef68043d5d7d2f855863e99daca2e0f1e8149`
- Evidence boundary: visual-layer cleanup only; still requires true Anny/VRM-quality base mesh before high-fidelity claims.

## 2026-05-23 primitive proxy strip

The runtime GLB was passed through `tools/openclinxr/strip-humanoid-primitive-proxies.ts` to remove legacy `local_fixture_*`, `openclinxr_proportioned_*`, `openclinxr_visual_detail_*`, and `openclinxr_camera_facing_*` visual proxy nodes. The Anny-derived skinned base mesh, canonical rig, animation/morph targets, lip/eye controls, ragdoll proxy, and physician interaction target remain in the artifact path.

- SHA-256 after primitive proxy strip: `f9cd32eb38ff3ea54573e54cf48b7b041e11b615e9951eb87af83db7d11948d9`
- Strip report: `docs/openclinxr/strip-humanoid-primitive-proxies-2026-05-23.json`
- Backup before primitive proxy strip: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-primitive-proxy-strip-2026-05-23.glb`

This is a local deterministic visual-realism refinement only. It is not evidence of production avatar readiness, Quest readiness, clinical validity, scoring validity, or motion-comfort validation.

## 2026-05-23 surface face refinement

Converted visible face/lip/eye/ragdoll/interaction control boxes into semantic non-rendering empties while preserving required node names. Added `anny_surface_*` eyes, pupils, lips, brows, and scrub torso tint so the Anny-derived humanoid face is no longer blocked by rig-debug geometry.

- SHA-256 after surface face refinement: `22546177191e12c8dba454a922658bca2de8e3eda104530d0a5272700df23c4a`
- Backup before surface face refinement: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-surface-face-refinement-2026-05-23.glb`
- Evidence boundary: local visual-realism refinement only; not production avatar readiness, Quest readiness, clinical validity, scoring validity, or motion-comfort validation.

## 2026-05-23 surface torso cleanup

Removed the oversized `anny_surface_scrub_torso_tint` panel after Blender visual review showed it occluded anatomy. Reduced lip and brow surface cue dimensions so they read as facial affordances rather than debug bars.

- SHA-256 after surface torso cleanup: `602a4149ded945105582a911d540c9b3d4c1b6b4d898ec018c77fdfac8cb2bf2`
- Backup before cleanup: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-surface-torso-removal-2026-05-23.glb`
- Evidence boundary: local visual-realism refinement only; not production avatar readiness, Quest readiness, clinical validity, scoring validity, or motion-comfort validation.

## 2026-05-23 Anny surface clothing refinement

Added surface-following scrub shirt, sleeve, pants, and hair meshes derived from the Anny body vertices instead of blocky clothing proxies. These meshes use `anny_surface_*` names and retain the local visual-refinement claim boundary.

- SHA-256 after Anny surface clothing refinement: `c38dd5187137883cd2995b428e379edb2e79f990ac350262aec3f07466ca29ec`
- Backup before refinement: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-surface-clothing-2026-05-23.glb`
- Evidence boundary: local visual-realism refinement only; not production avatar readiness, Quest readiness, clinical validity, scoring validity, or motion-comfort validation.

## 2026-05-23 misaligned face-surface removal

Removed asset-level `anny_surface_*` eye, brow, and lip meshes after runtime screenshot review showed they drifted from the face in the encounter renderer. The asset keeps surface-following hair and clothing meshes plus semantic non-rendering lip/eye control nodes for runtime dialogue mapping.

- SHA-256 after misaligned face-surface removal: `168d42144f895ead37594295256644046c42fd2ac953fa3e4100ce9fddb3cfdc`
- Backup before removal: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-misaligned-face-surface-removal-2026-05-23.glb`
- Evidence boundary: local visual-realism refinement only; not production avatar readiness, Quest readiness, clinical validity, scoring validity, or motion-comfort validation.

## 2026-05-23 Anny mesh face-region paint

Painted eye, pupil, lip, nose-shadow, and warm face regions directly onto the Anny base mesh material assignments. This avoids separate floating face props and keeps facial readability tied to the generated mesh surface.

- SHA-256 after mesh face-region paint: `c72e35169411a56e6e2ab04788cb21be9fa9cefb61d937e66b9f33c93377b83d`
- Backup before paint: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-mesh-face-region-paint-2026-05-23.glb`
- Evidence boundary: local visual-realism refinement only; not production avatar readiness, Quest readiness, clinical validity, scoring validity, or motion-comfort validation.

## Clinical idle conversation pose clip pass - 2026-05-23

- Added `clinical_idle_conversation_pose` to the generated humanoid GLB through `tools/openclinxr/materialize-clinical-idle-pose-clip.ts`.
- The clip targets head, upper-arm, forearm, and hand bones using both canonical dotted glTF bone names and runtime-sanitized aliases.
- Purpose: move posture evidence from runtime-only bone tweaks into a repeatable asset-pipeline step that can be rerun before Quest/WebXR visual QA.
- Evidence: `docs/openclinxr/materialize-clinical-idle-pose-clip-rerun-2026-05-23.json`.
- SHA-256 after clinical idle pose clip rerun: `d2c55b0c788b79b569641f75bd3e78f985d0ca1e3896dc43e475affbca176682`.
- Claim boundary: this is not production animation quality, biomechanical validity, Quest readiness, clinical validity, or scoring validity.

## Clinical idle conversation pose refinement v2 - 2026-05-23

- Refined the authored `clinical_idle_conversation_pose` upper-arm and forearm rotations after actor-close screenshot review showed the first authored clip still read as a wide mannequin pose.
- Evidence: `docs/openclinxr/materialize-clinical-idle-pose-clip-v2-2026-05-23.json`.
- SHA-256 after clinical idle pose refinement v2: `4f6c328c11658861979ba86236fd47458d9768366ca64825a0cebe05bffcba44`.
- Claim boundary: this is an iterative visual realism improvement, not production animation quality, biomechanical validity, Quest readiness, clinical validity, or scoring validity.

## Clinical idle conversation pose refinement v3 - 2026-05-23

- Further reduced shoulder abduction in the authored `clinical_idle_conversation_pose` after deoccluded actor-pose review showed v2 still held arms too wide.
- Evidence: `docs/openclinxr/materialize-clinical-idle-pose-clip-v3-2026-05-23.json`.
- SHA-256 after clinical idle pose refinement v3: `4705d0d8b4e30237dbbdcf3917ecd545bea8371bbe42c42cd68c5b7d3b6fa3ca`.
- Claim boundary: iterative visual realism improvement only, not production animation quality, biomechanical validity, Quest readiness, clinical validity, or scoring validity.

## Humanoid material contrast refinement v2 - 2026-05-23

- Added `tools/openclinxr/refine-humanoid-material-contrast.ts` and refined GLB material base colors/roughness for hair, scrubs, skin, lip region, and nose-mouth shadow after screenshot review showed washed-out face/skin readability.
- Evidence: `docs/openclinxr/refine-humanoid-material-contrast-v2-2026-05-23.json`.
- SHA-256 after material contrast refinement v2: `6e217073f8bb1a7ad6ca62bb04ed31b772483347ea85295d9c5b527962130f80`.
- Claim boundary: not production skin shader quality, photorealism, Quest readiness, clinical validity, or scoring validity.

## Humanoid material contrast refinement v3 - 2026-05-23

- Reduced the lip/nose-mouth material contrast after v2 screenshot review showed an over-strong red facial patch.
- Evidence: `docs/openclinxr/refine-humanoid-material-contrast-v3-2026-05-23.json`.
- SHA-256 after material contrast refinement v3: `36161ebdbf368d07a921f05571f2cff8d9709fd1343a4e38d12a2559e8307ae8`.
- Claim boundary: iterative readability improvement only, not production skin shader quality, photorealism, Quest readiness, clinical validity, or scoring validity.

## Material contrast rollback - 2026-05-23

- Rolled back material contrast v2/v3 because screenshot review showed a mask-like red face patch that reduced realism despite improving feature contrast.
- Restored `neutral-generated-human.glb` from `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-material-contrast-v2-2026-05-23.glb`, preserving clinical idle pose refinement v3.
- SHA-256 after rollback to pose-v3/pre-material-contrast asset: `4705d0d8b4e30237dbbdcf3917ecd545bea8371bbe42c42cd68c5b7d3b6fa3ca`.
- Next material work should use localized mesh-region authoring or texture maps, not broad material reassignment.

## Clinical idle pose refinement v4 - 2026-05-24

- Updated `clinical_idle_conversation_pose` to reduce over-abducted arms and prioritize the generated GLB animation over runtime fallback posture for mouth/gaze/pose realism evidence.
- Static unskinned sleeve artifacts are hidden in review capture mode so screenshots evaluate the rigged humanoid arms rather than offset clothing geometry.
- SHA-256 after clinical idle pose refinement v4: `91bfefd24cc94c56c72d69669811c64b7de6661f79e780d74bb61762b89d2651`.
- Claim boundary: local deterministic realism iteration only, not production animation quality, biomechanical validity, Quest readiness, clinical validity, or scoring validity.

## Clinical idle pose refinement v6 - 2026-05-24

- Moved the better lower-arm fallback rotations into the generated  clip so the GLB, not runtime-only code, owns the clinical-idle posture candidate.
- SHA-256 after clinical idle pose refinement v6: .
- Claim boundary: local deterministic realism iteration only; visual QA remains required before learner-use or Quest-readiness claims.

## Clinical idle pose refinement v6b - 2026-05-24

- Moved the better lower-arm fallback rotations into the generated clinical_idle_conversation_pose clip so the GLB, not runtime-only code, owns the clinical-idle posture candidate.
- SHA-256 after clinical idle pose refinement v6b: 91bfefd24cc94c56c72d69669811c64b7de6661f79e780d74bb61762b89d2651.
- Claim boundary: local deterministic realism iteration only; visual QA remains required before learner-use or Quest-readiness claims.

## Clinical idle pose lower-arm refinement - 2026-05-27

- Updated `tools/openclinxr/materialize-clinical-idle-pose-clip.ts` and rematerialized `clinical_idle_conversation_pose` with lower, less abducted non-pediatric arm rotations after OB portal-entry screenshot review still showed repeated wide/mannequin arm silhouettes.
- Evidence: `docs/openclinxr/materialize-clinical-idle-pose-lower-arms-2026-05-27.json`.
- Backup before lower-arm refinement: `.openclinxr/asset-production/realism-backups/neutral-generated-human-pre-lower-arm-idle-pose-2026-05-27.glb`.
- SHA-256 after lower-arm refinement: `6f7bd1f5fe0be492f1054aa838188df9efafb1de42430db59da809b50576bc0f`.
- Claim boundary: local deterministic realism iteration only; not production animation quality, biomechanical validity, Quest readiness, clinical validity, or scoring validity.

## Runtime body-profile variant publication - 2026-05-27

- Published local generated-human rigging variant-matrix GLBs into `apps/ui-xr/public/xr-assets/humanoids/variants/` so runtime actors can select case/role-appropriate body-profile variants rather than every encounter role using the same neutral fixture.
- `variants/adult-standard-generated-human.glb` SHA-256: `7af1fcbe930f3301575bc6d8311490f39438754e0555aa2166af5e929969ec4b`.
- `variants/bariatric-adult-generated-human.glb` SHA-256: `2b54a9003226e66090618639a0fada160749d10163e7c1354511209c2474d7a3`.
- `variants/older-adult-kyphotic-generated-human.glb` SHA-256: `3bc0db604978629e736b3e97cc2138d07a3a8241e6afcba57727149c46bd695c`.
- `variants/pediatric-school-age-generated-human.glb` SHA-256: `3afe6dc736655c90e6e10b02df65090bb3ca971464411f54fdec26cf102cb71e`.
- Source artifacts: `.openclinxr/asset-production/ed-chest-pain/generated-human-rigging-variant-matrix/*/neutral-generated-human.glb`.
- Claim boundary: local deterministic actor-variety improvement only; not production avatar readiness, Quest readiness, clinical validity, scoring validity, or validated demographic representation.

## OB actor-specific generated humanoid source variants - 2026-05-27

- Generated by `tools/openclinxr/materialize-ob-humanoid-source-variants.ts` from `apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb`.
- Report: `docs/openclinxr/ob-humanoid-source-variants-2026-05-27.json`.
- Purpose: route OB patient, nurse, and partner through actor-specific generated-humanoid source files rather than reusing one neutral runtime source or masking defects with overlay geometry.
- `variants/ob-patient-aisha-generated-human.glb` SHA-256: `ad2ad124d56b1f5ccaa2f61a75d08cac865c57ae22b999744f5ce3459037f4f2`.
- `variants/ob-nurse-williams-generated-human.glb` SHA-256: `6f2261b1b0c83d5417d219b070ee0f704e008eec208b073a3e7586faac7b3c67`.
- `variants/ob-partner-omar-generated-human.glb` SHA-256: `06ee1ba01fc2d195babdff3d26d366c2028042f815a2bbc27e8ad3a5e6c34abc`.
- Claim boundary: improves actor-specific source routing and role differentiation only; not evidence for AAA humanoid realism, Quest readiness, production readiness, clinical validity, or scoring validity.

- 2026-05-27 source-fit refinement: expanded scrub sleeves/shirt surfaces inside the actor-specific GLB sources to reduce shoulder/clothing artifacts without runtime overlay masks.

- 2026-05-27 visual rejection: source-fit sleeve geometry deformation was rejected after WebXR evidence showed detached arm-like artifacts; current hashes preserve actor-specific source materials without geometry deformation.

- 2026-05-27 Blender normal refinement: actor-specific OB GLBs exported through Blender weighted-normal/smooth-shading pass with no intended geometry deformation; visual evidence required before promotion beyond B+ practical source differentiation.
