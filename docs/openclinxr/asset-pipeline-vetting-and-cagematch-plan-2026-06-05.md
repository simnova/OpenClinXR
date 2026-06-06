# Asset Pipeline Vetting And Technology Cagematch Plan

Date: 2026-06-05

Status: forward-looking plan for future slices. This document does not promote any generated humanoid, provider, Quest runtime, learner launch, clinical, scoring, or production readiness claim.

## Purpose

OpenClinXR needs two separate proof ladders for generated humanoids:

1. Isolated model vetting, where a single candidate actor is inspected on its own merits in a neutral lab scene.
2. Scene placement vetting, where an already-vetted candidate is tested inside a case-defined station with lighting, props, dialogue, locomotion, spacing, and multi-actor pressure.

This separation keeps model quality problems from being hidden by scene composition, and it keeps scene/runtime problems from being misdiagnosed as asset-generation failures. It also creates a fair place to compare Anny, MakeHuman/MPFB, MakeClothes, StableGen, SMPLitex, Hunyuan3D, Meshy, Tripo, Audio2Face, Speech2Motion, Mesh2Motion, MisoTTS, Moshi, Qwen TTS, and other future providers without letting any experiment bypass provenance, license, runtime, or false-readiness gates.

## Tracking Decision

Use repo markdown as the canonical plan and GitHub Projects as the execution mirror.

Repo markdown remains canonical because it is versioned with the code, covered by drift guards, available to local subagents, and close to the architecture rules. GitHub Projects are better for assignment, status boards, due dates, discussions, and cross-agent work packets, but should not become the only place where gates, evidence requirements, or promotion rules live.

Verified GitHub surface: `simnova/OpenClinXR` is accessible and `simnova` project 7, `OpenClinXR-Planning`, exists. Do not bulk-create board items until the first model-vetting report schema lands, because stable task fields should mirror the schema rather than chase a planning draft.

### Canonical Locations

| Need | Canonical location | GitHub mirror posture |
| --- | --- | --- |
| Architecture, gates, promotion policy | This document plus MADRs and `agents/rules/**` | Link from tracking epic |
| Active continuation state | `AUTONOMOUS_WORK_PLAN.md`, `PROJECT_COORDINATION_INDEX.md`, worker matrix | Mirror as project item status |
| Per-candidate evidence | `docs/openclinxr/model-vetting-report-<actor>-<date>.json` plus screenshots/video paths | Link from issue checklist |
| Runnable isolated harness | Future `apps/arena/model-vetting-studio` | Issue milestone and reviewer checklist |
| Package-level scoring/schema | Future `packages/openclinxr/arena/model-vetting` | Issue milestone and test checklist |
| Provider execution boundaries | `.agents/skills/provider-boundary/SKILL.md` and provider reports | Issue labels and blocked fields |

### GitHub Project Fields

Use the board after the first schema slice with these fields:

| Field | Values |
| --- | --- |
| Lane | Isolated model vetting, Scene placement vetting, Provider cagematch, Voice/animation cagematch, Governance |
| Worker | Worker 9, Worker 10, Worker 11, Worker 7, Worker 8, Worker 0 |
| Agent lens | Asset Pipeline Lead, Rigging/Animation Specialist, License/Provenance Specialist, Visual Realism Adversary, XR Systems Architect, Chief Coordinator |
| Gate | Draft, Local schema, Local evidence, Adversarial review, Promotion proposal, Blocked |
| Provider boundary | Local-only, Approval-gated, Cloud/paid blocked, License blocked |
| Evidence required | Structural JSON, screenshot, turntable video, animation capture, VLM/adversarial note, browser/WebXR proof, manual Quest proof |

Suggested labels: `openclinxr:asset-pipeline`, `openclinxr:model-vetting`, `openclinxr:cagematch`, `gate:false-readiness`, `provider:local-only`, `provider:approval-gated`, `worker-9`, `worker-10`, `worker-11`.

## Isolated Model Vetting Studio

Create a neutral, sidecar arena app before adding more scene-level evidence. The first app should be an independent model laboratory, not a station, and should live under `apps/arena/model-vetting-studio` once implementation begins. Package-level schemas and scoring helpers should live under `packages/openclinxr/arena/model-vetting`.

### Required Lab Modes

| Mode | Goal | Evidence |
| --- | --- | --- |
| Static model inspection | Verify scale, orientation, mesh bounds, material names, texture slots, hair, skin, clothing, and visible body/clothing intersections | GLB structure JSON, screenshots from fixed front/side/three-quarter cameras |
| Rig inspection | Verify skeleton naming, bone hierarchy, skin weights, rest pose, eye/head/neck controls, face/gaze/blink control nodes, collider anchors, and retargeting hooks | Rig report JSON, skeleton overlay screenshot |
| Morph and phoneme inspection | Verify expression morph targets, viseme/phoneme mapping, mouth shapes, jaw motion, brows, cheeks, eyelids, gaze aversion, blink, and emotion transition curves | Deterministic utterance/emotion timeline, morph coverage JSON, capture video |
| Animation clip inspection | Verify idle breathing, conversation listening, posture shift, pain/anxiety/concern gestures, and locomotion-ready root motion metadata | Clip inventory JSON, fixed-camera animation captures |
| Material realism inspection | Verify skin tone, roughness, normal maps, hair cards/strands, clothing fit, visible seams, texture resolution, and WebXR material suitability | Material budget JSON, screenshots under fixed lighting |
| Optimization inspection | Verify triangle count, draw calls, texture sizes, animation count, morph count, file size, Draco/Meshopt posture, and Quest/WebXR budgets | Budget report JSON with pass/warn/block |

The lab scene should use fixed lighting, neutral background, metric floor grid, named cameras, deterministic animation timelines, and a fixed screenshot/video recipe. A report generated from the same candidate should be reproducible unless the source asset or toolchain version changes.

### Lab Gate Outcomes

| Outcome | Meaning |
| --- | --- |
| `blocked_before_scene` | Candidate has license, provenance, source, structure, rig, material, or visible realism failures that make scene testing misleading. |
| `ready_for_scene_placement_evidence` | Candidate is suitable for review-safe station placement tests, but not for learner, Quest, production, clinical, or scoring claims. |
| `needs_provider_iteration` | Candidate is structurally usable but needs a provider or Blender cleanup loop before scene placement. |
| `archive_as_reference_only` | Candidate should remain as evidence or fallback reference, not an active runtime option. |

Isolated lab success never means locomotion readiness, scene integration readiness, Quest readiness, production readiness, learner readiness, clinical validity, or scoring validity.

## Scene Placement Vetting

Only candidates that clear the isolated model gate should move into case-defined scenes. Scene placement vetting answers different questions:

| Question | Scene evidence |
| --- | --- |
| Does the actor fit the clinical role and station context? | Case-defined role mapping, review packet link, screenshot/video evidence |
| Does lighting/environment change realism? | Same actor under station lighting with material comparisons |
| Do props, beds, chairs, doors, and occluders expose rig or scale problems? | Collision/placement report, screenshots from learner and reviewer cameras |
| Do multi-actor interactions hold up? | Patient/parent/nurse/consultant spacing, gaze targets, interruption turns, trace tags |
| Do locomotion and posture hooks work? | Walk/turn/sit/stand/posture transitions in the station, not the lab |
| Does dialogue and emotion drive visible behavior? | Replayable actor turns, emotion timeline, lip-sync/viseme captures, review-safe evidence |

Scene placement evidence remains metadata-only until review gates explicitly promote it. It cannot override isolated license/provenance, rig, or material blockers.

## Technology Cagematches

Technology cagematches should be treated as arena experiments with fixed inputs, repeatable outputs, and explicit promotion gates. Do not compare providers using one-off screenshots or cherry-picked prompts.

### Cagematch Template

| Field | Requirement |
| --- | --- |
| Candidate set | Name providers/tools and exact versions or commit SHAs when available |
| Case actor profile | Use one case-defined actor profile such as peds patient, anxious parent, nurse, interpreter, or consultant |
| Input contract | Same age/body/role/clothing/skin/hair/expression/voice parameters across candidates where possible |
| Provider boundary | Local-only by default; cloud, paid APIs, model downloads, credentials, or license-restricted assets require explicit approval |
| Output artifacts | Source directory, generated GLB, provenance sidecar, rigging report, model-vetting report, screenshots/captures |
| Scoring | License/provenance, visible realism, rig quality, morph/viseme coverage, animation suitability, material quality, optimization, WebXR fit, repeatability, cost, runtime risk |
| Review agents | Asset Pipeline Lead, License/Provenance, Rigging/Animation, Visual Realism Adversary, XR Systems Architect |
| Promotion result | Archive, retry provider, move to scene placement, or propose production-facing adapter/MADR update |

### Initial Cagematch Families

| Family | Candidates | First useful question |
| --- | --- | --- |
| Humanoid source generation | Anny, MakeHuman/MPFB, Hunyuan3D, Meshy, Tripo | Which source produces legally usable, riggable, role-believable base humans for OpenClinXR? |
| Clothing and fit | MakeClothes, Blender cleanup, provider-native garments | Which path yields believable clinical clothing without mesh clipping or license ambiguity? |
| Skin and texture | StableGen, SMPLitex, Blender procedural/material cleanup | Which path improves close-range skin realism while staying review-safe and locally reproducible? |
| Rigging and retargeting | Blender pipeline, Mesh2Motion, provider rigs | Which path creates WebXR-suitable skeletons, skin weights, and clip compatibility? |
| Speech and affect | Audio2Face, deterministic viseme curves, MisoTTS, Moshi, Qwen TTS | Which path gives low-latency, reviewable speech/viseme/emotion evidence without cloud dependency? |
| Body gesture | Speech2Motion, deterministic gesture clips, manual Blender library | Which path maps case-defined turns to believable posture and gesture without overclaiming realism? |

## First Implementation Slices

1. Add `packages/openclinxr/arena/model-vetting` with a report schema covering provenance, GLB structure, rig, morph/phoneme, animation, materials, optimization, screenshots, and false gates.
2. Add a deterministic report generator for the current peds patient and anxious-parent GLBs, reusing the existing Anny candidate preflight rather than duplicating GLB parsing.
3. Add `apps/arena/model-vetting-studio` as a minimal Three.js viewer with fixed cameras, fixed lights, turntable, clip selector, morph/viseme timeline, and screenshot capture hooks.
4. Generate the first isolated lab reports for the peds patient and anxious parent. Outcome target: `ready_for_scene_placement_evidence`, not production or learner readiness.
5. Add the first cagematch manifest for Anny-compatible Blender output versus MakeHuman/MPFB/MakeClothes source candidates, with provider execution still disabled until explicitly approved.
6. Mirror the implementation slices into GitHub project 7 once the schema field names settle, using one epic issue plus child issues for lab app, report schema, cagematch manifest, and adversarial review.

## Subagent And Review Use

The main worker owns implementation, integration, verification, and state updates. Use agents as advisory or independent review lenses:

| Role | Use |
| --- | --- |
| Chief Coordinator | Keep slices tied to blueprint-to-runtime progress and prevent evidence toil. |
| Asset Pipeline Lead | Check model-vetting workflow, reports, and promotion ladder. |
| License/Provenance Specialist | Review source rights, generated hashes, reuse keys, third-party restrictions, and false claim gates. |
| Rigging/Animation Specialist | Review skeleton, skin weights, animation clips, morph targets, visemes, gaze, posture, and WebXR GLB suitability. |
| Visual Realism Adversary | Compare screenshots/captures against the intended role and call out visible believability gaps without granting clinical or production claims. |
| XR Systems Architect | Check WebXR, Quest, scene-placement, performance, interaction, and IWSDK sidecar posture. |
| OpenClaw Drift Police | Intervene if cagematches become scattered screenshots, unregistered artifacts, stale reports, or provider-currentness toil. |

## False Gates

Keep these gates false until later explicit promotion:

- Isolated model vetting is not station readiness.
- Scene placement vetting is not learner readiness.
- Browser/WebXR evidence is not Quest readiness.
- IWSDK sidecar evidence is not production WebXR adoption.
- Local Anny import is not real Anny generation.
- Provider cagematch ranking is not a production dependency decision.
- Voice/viseme evidence is not clinical communication validity.
- Actor realism evidence is not scoring validity, clinical validity, or exam equivalence.
- No cloud, paid API, credentialed provider, model download, or restricted-license execution may run without explicit approval.

## Status Template

Future slices should record this compact status in the three canonical state files:

```text
Asset pipeline vetting slice: <name>.
Product path advanced: isolated model vetting | scene placement vetting | cagematch schema | provider boundary.
Candidate/provider: <actor or tool>.
Blueprint/factory tie: <case actor profile -> asset evidence -> review/runtime decision>.
Touched files: <paths>.
Evidence: <commands/reports/screenshots>.
Gate result: blocked_before_scene | ready_for_scene_placement_evidence | needs_provider_iteration | archive_as_reference_only.
GitHub mirror: none | project 7 item/issue link.
Next queued slice: <smallest product-advancing follow-up>.
False gates preserved: real-Anny, B+, Quest, production, learner, clinical, scoring.
```

## Recommended Next Slice

Start with the model-vetting report schema and generator because it creates the task vocabulary for both repo state and GitHub project fields. Then build the isolated viewer. This keeps future provider cagematches honest: every candidate must produce the same report shape before it earns scene-placement evidence.
