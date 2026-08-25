---
name: pixel-grading
description: "Fires whenever a render, screenshot, capture PNG, contact sheet, or webm ARRIVES for judgment, before writing any visual verdict or appearance claim, and when writing the visual requirements inside a worker brief. Native resolution only (upscaling invents defects); thumbnails prove presence, never absence; structure pass outranks lit pass on structure; prefer the geometric measurement; demand named renderer + subject + input provenance; closed checklists whose cells the suspected defect FAILS; the producer/grader split survives multimodal workers; label MY GRADE vs CONSULTED on every verdict."
when-to-use: grade an image, pixel grade, capture, render, still, contact sheet, does it look right, upscale, thumbnail, visual verdict, appearance claim, screenshot evidence
---

# Grading pixels

Grading is the orchestrator's duty and the last line where a green contract meets reality. It is also
where I have manufactured defects that were not there.

## ISOLATE THE SUBJECT FIRST — operator directive, 2026-08-25

> "Evaluation of models should be done in isolation first - not within an environment."

This is D3/D4 applied to grading. A full-room capture proves ASSEMBLY. It cannot diagnose a
SUBJECT, because room lighting, framing, occlusion and every other asset are confounds.

**Rule: if the question names one asset, the first artifact is that asset alone.** In-situ
capture comes second, and only to answer a composition question ("does it fit the room").

The harness already exists and takes one flag — do not build another:

```bash
pnpm asset:model-vetting:glb-grade -- --glb <path-to.glb>
```

It emits exactly four images — `front` and `three_quarter`, each `lit` and `structure` — and
runs an independent self-check (glTF-Transform NodeIO probe outside the browser vs the
in-page three.js scene-graph AABB; it REFUSES above 15% relative error). Compose those four
into one sheet and grade that.

**Measured cost of getting this wrong, 2026-08-25:** #646 asked "do these chairs read as
clinic or domestic?" — a subject question — and its grade request captured
`captureMode: "scene-overview"` of a whole oncology room at `nearestActorM: 1.78`. The
principal chair was partially framed and the verdict could not be settled. The isolated 4-up
took one command and agreed with its own probe at 0.03% relative error.

**The tell:** the grade question names an asset, a material, a garment or a body, and the
capture you are about to send contains a room.

## Grade at NATIVE resolution

**Upscaling a pixel-scale feature invents structure.** LANCZOS rings a 2-3 px feature into scallops;
NEAREST squares it into stairs. Both look exactly like manufacturing defects.

Measured: three separate false findings in one day - "blocky atlas boundaries", a "stair-stepped
hairline", a "toothed wedge" - all of them the interpolator, none of them the mesh.

- Upscale only to LOCATE something already seen at 1x, never to discover it.
- If a claim rests on an enlarged crop, state the factor and filter beside it. **Native wins.**
- To inspect a small region, **crop and paste at 1:1** - that is not a resample. Or use NEAREST, which
  only shows existing pixels larger.
- **Compared captures must share their render conditions.** Measured: a measurement pass ran with
  lighting OFF, produced a finding AND a ranking inversion, and had to be withdrawn -
  *"confirm you're using lighting when doing readings"*. Record lighting state, exposure and camera
  beside the artifact; a ranking built on mismatched captures passes every other rule in this file.
- The tell: you are describing texture - *ragged, toothed, blocky, stair-stepped* - from an image you
  enlarged.

## A thumbnail cannot support a fine verdict

A small preview supports COMPARATIVE and POSITIVE verdicts (this cell differs from that; this cell
contains a figure). It cannot support "X is absent" or a fine pose/quality call. Absence needs a
single-subject capture at full framing, or a measurement.

Measured: an issue filed as "this station renders no actors" from one panel of a multi-panel sheet.
All three actors were present at 32-38k triangles each.

## Structure pass AND lit pass answer different questions

Lit renders resolve silhouette and shading; structure passes (normals/wireframe) resolve topology and
interior geometry. **Grading only the lit pass flatters.** Where they disagree, the structure pass wins
on anything structural. Say which finding came from which.

## Prefer a measurement when one exists

Geometry beats eyeballs and is cheaper. A pose question answered by quaternions and joint angles is
decisive where a thumbnail is not. Two useful habits:

- **Locate the feature before measuring it.** A box placed by guessed coordinates reported 0% on every
  frame - the box was off the subject. Find it by colour/landmark first, then measure.
- **One run is one sample.** Measured: I had to be told *"run the sweep three times to measure
  instrument variance"*. A verdict from a single sweep has unknown noise - repeat before ranking.
- **Check what a shared convention hides.** A root rotation identical across standing AND lying clips
  is a coordinate convention, not pose information. Find the joint that actually discriminates.

## Video

- Grade motion at **native frame rate**. A frame-stepped or re-encoded playback changes what motion
  looks like, the same way an upscale changes what an edge looks like.
- **A single watched playthrough supports motion-present / motion-absent only** - never amplitude,
  smoothness, or plausibility. Those need a per-frame measurement.

## WHO GRADES - changed 2026-08-22 by product-owner decision

**I no longer issue visual verdicts.** The product owner (ox standing thread) holds the JUDGMENT
plane; I hold the MEASUREMENT plane. My prose verdicts stop; my probes do not.

It corrected my objection and the correction is right: *same model* is not *same producer*. The #17
rule bars an agent grading its OWN output; the owner grading a worker artifact it did not produce
preserves the split. The real reason this division is better is **instrument independence** - a numeric
probe catches the case where its vision fails or flatters.

Binding amendments, from that ruling:

- **A1 - fixed probe menu, declared PRE-dispatch.** Each artifact class gets its metric written into
  the brief BEFORE dispatch, from: atlas perceptual-hash distance / lip-aperture px / joint angular
  deltas / garment-hue pixel fraction / luminance stats. **No post-hoc metric selection** - a number
  chosen after seeing a grade is threshold-fitting.
- **A2 - disagreement protocol.** Its grade vs my numbers disagreeing means neither side wins: I send
  `CONTRADICTED` with both values, it re-grades from a 1:1 native crop, we reconcile on the card.
  **Silent resolution is banned in both directions.**
- **A3 - calibration strikes.** Each time a decisive measurement overturns its grade, log one strike
  against that artifact class. **Two strikes flips the class measurement-primary** until it passes a
  fresh ground-truth pair (the smooth/ragged control pattern).
- **A4 - citation shape.** Close comments carry `GRADE: <owner>` and `MEASURE: <mine>` lines. Worker
  visual claims remain EVIDENCE-not-verdict everywhere, so no self-graded visual exists anywhere.

Everything below still governs HOW to measure and how to specify a capture in a brief - that work is
still mine. Only the verdict moved.

## The producer/grader split - and multimodal workers do NOT dissolve it

This repo has already shipped a fabricated score from an agent grading its own output.

- A worker may grade ANOTHER slice's artifacts, or a control/treatment pair it did not author.
- A worker may NOT be the sole grader of its own output. Put it in the brief verbatim: **your visual
  report on your own output is EVIDENCE, not a verdict.**
- Vision being verified does not make a model disinterested. Calibrate it against traps with known
  ground truth, and **use a control** - a model that always answers "smooth" passes any single
  smooth-is-correct probe. The discriminating pair is the proof.

## Asking a worker for a visual report

- A free-text slot gets filtered to the brief's subject. Use a **closed checklist of named artifacts**,
  each `none | present`, that the worker must fill.
- **Every cell must be a feature the suspected defect FAILS.** A cell that restates the question
  (`reads_as_footwear`) is answered `yes` by the blob you are worried about. Decompose it
  (`toe_defined`, `heel_defined`, `sole_plane`).
- Ask for the in-scope verdict AND **out-of-scope wrongness seen but not fixed**, naming the object and
  what it looks like. "Deformation" costs the reader the trip.
- Scope an exclusion to the exact artifact, never a region - "do not re-report X" suppresses everything
  near X.
- Ask for MAGNITUDE, not just whether a side effect happened, and what they did to offset it.

## Naming the artifact in the brief

Name the RENDERER and the SUBJECT, or silence is resolved in favour of whatever is cheapest to produce
(a point cloud, a schematic, a floor plan). "Capture" does not mean "render". If a structural artifact
is sufficient, say so explicitly.

**Demand the INPUTS too, not just the output.** Measured: I could not evaluate a generated asset until
I asked for the source images and the prompts fed to the generator. A polished output from unknown
inputs is ungradeable - require the input provenance in the same artifact.

## After grading

**Every written visual verdict contains two prefixed lines:** `MY GRADE:` and - only if a consult
occurred - `CONSULTED (<who>):`. **A verdict paragraph containing neither prefix is ungraded; do not
publish or file it.** "Upright, limbs present, proportions plausible" is a
pixel grade. "A patient here would be gowned" is a consulted clinical opinion, and neither is a
clinician sign-off.

## Read what the capture mode is FOR before grading it

Measured 2026-08-22. I graded two frames from `openclinxrCaptureMode=mouth-gaze-pose`, saw a blank 3D
viewport with a fully-rendered HUD, and concluded no station renders. **Withdrawn.** That mode is a
face/pose review harness — `main.ts:1248-1255` sets `actorPoseReviewCapture`, hides XR controllers,
forces in-scene evidence panels and stretches the window to 45 s. It is not a scene view.

`asset:ui-xr:environment-room-capture` — the room-framing capture — showed **15 stations rendering**,
manifest `infinigenRoom: present, effectivelyVisible: true` for every one.

**Rule:** a harness answering a different question looks exactly like a broken product. Before grading,
name the mode and what it frames. If the verdict is scene-wide, the capture must be scene-framed.

## Both files were 113 KB — a byte floor cannot tell them apart

The blank-viewport frame was **113,516 bytes**. `exists:` passed. `min-bytes:` passed. This repo already
shipped 113 KB error screenshots once as "WebXR Sample Scene Evidence". A byte floor proves a renderer
ran; it says nothing about content, and it is satisfied identically by a good frame and an empty one.

## A known-good figure in the SAME frame is the strongest grade you can get

In the peds bay: the nurse renders correctly — teal scrubs, brown boots, upright, plausible proportions
— while the parent beside her reads nude and the child intersects the exam furniture. Same lighting,
same camera, same pass.

That co-presence is what makes the verdict unambiguous rather than a lighting or exposure artifact, and
it is what let the follow-up measurement use the nurse as the ambient reference. **When grading a
multi-actor frame, say explicitly which figure is the known-good and why** — and if every figure is
wrong, say that too, because then the defect may be the pass rather than the assets.

## Name the region and what it looks like, then go measure it

"The parent looks nude" was a correct pixel observation and a wrong mechanism. Her GLB carries a t-shirt
(2,700 tris) and cargo pants (2,782 tris), both weighted, both `loaded`. Measured properly — texture-mean
x baseColorFactor, CIELAB — her garments sit at **ΔE 11.1/11.6** from her own skin against a working
population at **20.6–39.1**. The clothing is present, placed, and effectively invisible.

The grade told me WHERE to look. It did not tell me WHAT was wrong, and the two are not the same claim.
