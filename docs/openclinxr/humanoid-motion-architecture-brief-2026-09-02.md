# Humanoid motion architecture: research brief

Two questions were put to Grok deep research (grok-4.6 with web tools, 2026-09-02) after the operator
scoped the requirement as a baked animation catalog with dynamic transitions, plus `respondToTouch`
and physics, plus DSL-driven per-encounter motion. This brief records the answers, what was verified
here, and what the answers change.

## BLUF

**My three-layer split was wrong, and the correction is smaller than the split.** There are two
evaluation stages, not three layers: evaluate a pose (base state plus additive overlays), then run IK
as a weighted post-pass. And the reluctant reach — a patient who extends an arm incompletely and
returns to guarding — is not an arbitration problem to solve. It is a named clinical construct to
represent.

**New case-authoring vocabulary is required.** Deriving "rocking while clutching the stomach" from
demeanor, emotion policy or phenotype is the system inventing clinical content. The vocabulary should
anchor on existing pain-behaviour instruments rather than house-invented terms.

## Where my split was wrong

| my claim | correction | status |
|---|---|---|
| layer 2 is runtime IK, a peer of the clip layers | IK is a PASS that runs after pose evaluation, in every engine checked. Unity Animation Rigging runs after the Animator; Unreal Control Rig/FBIK is a later AnimGraph node; Godot `SkeletonIK3D` follows the AnimationTree; three.js `CCDIKSolver.update()` is a call you make after `mixer.update()` | CONSULTED, and confirmed locally in three@0.184.0 |
| layer 1 (catalog) and layer 3 (per-encounter) are different layers | they are the same runtime class. Both are secondary overlays on a base posture. The only difference is who authored the clip and when it was frozen, which is a compile distinction | CONSULTED |
| the seated/supine empty clip list is a layering bug | it is posture-as-filter. Production systems treat posture as the BASE STATE with overlays as deltas relative to that rest; the fix is a seated rest clip, not a filter that disables the mixer | CONSULTED |
| layers 2 and 3 need an arbitration rule | the interesting case is one motion with two constraints: a reach goal that is not fully achieved, over a rest that remains protective | CONSULTED |

Treating IK as a layer reproduces a known engine failure: putting an additive recoil "above" an IK
layer and watching IK overwrite it, because IK is not in the layer stack.

## Verified here, not taken on trust

Against `three@0.184.0`, the version this repo ships:

- `CCDIKSolver.update(globalBlendFactor = 1.0)` exists, and `updateOne(ik, overrideBlend)` resolves
  per-chain via `ik.blendFactor !== undefined ? ik.blendFactor : overrideBlend`. The per-chain weight
  the brief depends on is real.
- `AnimationMixer` contains zero occurrences of `mask`. **three.js has no bone mask**, so partial-body
  masking must happen at clip-compile time by omitting tracks. The offline compiler is already in
  position to do that; no runtime masking is available.
- `AnimationUtils.makeClipAdditive(targetClip, referenceFrame = 0, referenceClip = targetClip,
  fps = 30)` exists. Note the real signature takes `referenceFrame` second, not `referenceClip` — the
  commonly cited three-argument form is wrong and will be got wrong by anyone working from a blog.

One citation did not hold up. The brief gave MDS 3.0 J0800D as "LOINC 54838-8" while linking
`loinc.org/54562-4`; the two do not match each other and neither resolved. The CONCEPT is real —
LOINC Part `LP90057-8`, "Protective body movements or postures in last 5D" — but treat the specific
code as UNVERIFIED until someone reads the RAI manual.

## Question 1 — authoring vocabulary

**Answer: new vocabulary, anchored externally, and a hard boundary on derivation.**

The standardized-patient methodology authors the body rather than deriving it. Barrows' definition,
still quoted by ASPE and SSH, makes body language a peer of history and emotion, not a function of
them. Published SP scripts state it outright; a 2023 chest-pain packet reads *"Body language: press
the precordial area with the right hand, bent over when sitting down."*

Pain-behaviour science already carries the vocabulary that would otherwise be invented. Keefe & Block
(1982) codes guarding as abnormally slow, stiff or interrupted movement (during movement), bracing as
a limb extended for support for three or more seconds (while stationary), and rubbing as hand contact
with the painful area. Position codes — sitting, standing, reclining — are mutually exclusive, and
the pain behaviours are concomitant on top. That is the base-state-plus-overlay structure, arrived at
from the clinical side.

EmoPain splits Keefe further for movement and names **hesitation**: *"stopping part way through a
continuous movement with the movement appearing broken into stages."* That is the reluctant reach,
already coded. CPOT scores body movements as absent, protection, or restlessness, and muscle tension
on passive ROM as no resistance, resistance, or **inability to complete the movement** — the clinical
name for incomplete compliance with an examiner-imposed limb motion.

### The boundary

| author states | system may derive | must not derive |
|---|---|---|
| pain site and laterality; protective patterns present at rest; which hand; intensity; behaviour under examiner demand; peritoneal versus voluntary guarding | EMOTE-style Effort qualities from demeanor; breathing rate from phenotype and respiratory findings; facial expression from the emotion policy; generic catalog additives | "abdominal pain plus anxious therefore rock and clutch"; phenotype to protective pattern |

The reason is clinical, not architectural. Plenty of abdominal-pain patients sit still, or lean
forward, or hold still and grimace. A gastroenteritis case and a peritonitis case must not share a
derived clutch. Age and BMI change how a clutch looks, never whether it exists.

**A category error to avoid, and it is specific to this product.** Keefe "guarding" is a visible
motor pattern. "Abdominal guarding" in the acute-abdomen exam is involuntary wall rigidity, SNOMED
`249545003`, and the voluntary-versus-involuntary distinction is itself taught. Our `TouchResponse`
already has `responseKind: guarding`. If a case author writes that and the runtime produces a
hand-on-belly clutch, the peritonitis teaching point is destroyed. These must be separate fields.

### Shape

One block per actor, frozen in the case definition, compiled by the existing DSL:

```text
protectiveBehavior:
  scheme: keefe_emopain_mds            # external anchor, not a house enum
  patterns: [clutch, rock]             # from {guard, brace, clutch, rub, rock,
                                       #       splint, hesitate, antalgic, none}
  site: abdomen_epigastrium            # the same region ids TouchResponse uses
  effectors: [handR]                   # the canonical joint aliases we have
  magnitude: 0.7                       # 0..1; drives overlay weight AND the IK ceiling
  posture: seated                      # base state, required, not a filter
  onDemand: { compliance: incomplete, returnToProtect: true, hesitate: true }
  claimScope: portrayal                # not a diagnosis
```

`TouchResponse` stays the event table. This is the baseline pattern, present before anyone touches
the patient, and overloading `TouchResponse` to mean both is the mistake to avoid.

**Do not expose the motion DSL to case authors.** `effector: handL, target: body_region,
preserveWhileActive` is a compiler IR. Authoring in it is how a second unconsumed compiler gets
built.

**No single ontology covers both halves.** SNOMED carries findings but no effectors, no laterality of
a clutch and no oscillator; the animation literature carries movement quality but no clinical
content. Composing Keefe/EmoPain/MDS for the names with our joint-alias resolver for the skeleton is
the honest answer, and inventing an in-house pain ontology would be worse.

## Question 2 — arbitration

**Answer: a weighted IK post-pass with a ceiling. Not a priority stack, and never a pose average.**

The established pattern across engines is: evaluate the pose graph, run IK as a post-pass with a 0..1
weight blending the solved pose back toward the input pose, then optional later passes. Unreal's FBIK
`Position Alpha` is documented as 0 meaning remain at the input pose and 1 meaning best-effort reach;
Unity's `Target Position Weight` is the same knob; three.js `blendFactor` is the same knob as a
quaternion slerp back to the pre-solve pose.

A priority stack that picks a winner is used for gameplay ability arbitration, not for simultaneous
clutch-and-reach. And a 50/50 pose average of a clutch and a reach puts the hand midway between the
abdomen and the learner, which reads as a broken shoulder. **That is the failure mode we already
have**, since concurrent Normal-mode clips average.

The clinically correct setting is a ceiling: the hand moves toward the learner and does not arrive.
That is CPOT muscle tension 1 to 2 and EmoPain hesitation, implemented as an IK alpha ceiling derived
from `magnitude`. Return-to-guard is a weight ramp of 300 to 800 ms, not a state switch; a hard cut
back to the clutch pops.

Concretely, in this repo's terms: base clip in Normal at weight 1; catalog additives via
`makeClipAdditive` against that rest rather than against T-pose; the case-compiled protective overlay,
additive, track-masked to the named effectors, at weight `magnitude`; then after `mixer.update`, per
requested chain, `CCDIKSolver.updateOne(ik, alpha)` with `alpha` ceilinged against `magnitude`; then
ease alpha to zero when the request ends, with the overlay never stopping.

### What it fails at

Stated rather than papered over. A two-handed clutch where the clutching hand is also the IK effector
will drag the clutch off the abdomen; either the other hand takes over, which is new authored
content, or the case honestly cannot offer that arm. Pelvic rocking moves the shoulder origin every
frame, so IK chases a moving rest and looks drunk at high alpha. Stock `CCDIKSolver` joint limits
exist but must be authored per rig family, and our alias resolver carries no limit cones. And none of
this puts the patient's palm on the learner's fingers, which is a contact constraint the DSL names
and runtime IK does not give for free.

Head look-at versus an arm overlay is fine, since the chains are disjoint. Do not generalise the arm
rule to the head.

## What this changes

1. **Two stages, not three layers.** Authoring surfaces: the case file. Compile: rest clip, masked
   additive overlay, catalog additives converted against the rest. Runtime: mixer, then IK.
2. **The DSL is the right compiler and the wrong authoring language.** It compiles
   `protectiveBehavior` into `clutch_body_region` plus a pelvic oscillator. Authors never see it.
3. **The seated rest clip is a prerequisite**, not a nicety. Additive conversion against a T-pose
   reference will not fix standing-authored full-body takes on a seated actor.
4. **The `responseKind: guarding` overload is a live clinical defect**, independent of everything
   else here.

## Sources

Engine and library: [Unity Two Bone IK](https://docs.unity3d.com/Packages/com.unity.animation.rigging@6.6/manual/constraints/TwoBoneIKConstraint.html),
[Unity animation layers](https://docs.unity3d.com/6000.6/Documentation/Manual/AnimationLayers.html),
[Unity IK and layers discussion](https://discussions.unity.com/t/ik-and-animation-layers/763528),
[Unreal blend nodes](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-blueprint-blend-nodes-in-unreal-engine/?application_version=5.4),
[Unreal Control Rig FBIK](https://docs.unrealengine.com/5.0/en-US/control-rig-full-body-ik-in-unreal-engine/),
[Godot AnimationTree](https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html),
[three.js CCDIKSolver](https://github.com/mrdoob/three.js/blob/master/examples/jsm/animation/CCDIKSolver.js),
[three.js AnimationAction](https://threejs.org/docs/#api/en/animation/AnimationAction),
[additive blend mode pitfall](https://discourse.threejs.org/t/changing-animationactions-blendmode-to-additiveanimationblendmode-leads-to-incorrect-results/46994).

Clinical: [Keefe protocol reproduction](https://pmc.ncbi.nlm.nih.gov/articles/PMC3875313/),
[UNBC coding manual](https://unbc.arcabc.ca/_flysystem/repo-bin/2017-03/unbc_15778.pdf),
[EmoPain, Aung et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC6430129/),
[EmoPain protective-behaviour table](https://arxiv.org/pdf/1902.08990v1),
[CPOT directives](https://cdn.prod.website-files.com/5b0849daec50243a0a1e5e0c/5bacdfd4c007ad7ae656801b_CPOT-description-and-directives-020616.pdf),
[PAINAD body language LL6393-4](https://loinc.org/LL6393-4),
[LOINC part LP90057-8](https://loinc.org/LP90057-8),
[abdominal exam, StatPearls](https://www.ncbi.nlm.nih.gov/books/NBK459220/),
[ASPE case development template](https://www.aspeducators.org/aspe-case-development-template),
[SSH human simulation standards](https://ssih.org/sites/default/files/2025-04/2024%20SSH%20Provisional%20Human%20Simulation%20Standards_0.pdf),
[SP chest-pain script, Med Educ Online 2023](https://www.tandfonline.com/doi/full/10.1080/10872981.2023.2187954),
[EMOTE, Chi et al. SIGGRAPH 2000](https://history.siggraph.org/learning/the-emote-model-for-effort-and-shape-by-chi-costa-zhao-and-badler/).

## Not tested

The MDS J0800D LOINC code, as above. Whether stock `CCDIKSolver` joint limits can be authored once
across the Anny and MPFB2 rails, or need per-rail limit cones. Whether a seated rest clip exists for
either rail. The kinematic-substitution claim for high-fear patients was reported from a secondary
source and the primary was not retrieved. Grok reported reading repo files; those readings were not
independently reproduced except where marked verified above.
