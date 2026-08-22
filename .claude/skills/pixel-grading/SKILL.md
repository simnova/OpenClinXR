---
name: pixel-grading
description: How to grade a rendered artifact without inventing the defect. Native resolution only, thumbnails cannot support fine verdicts, structure pass vs lit pass, and the producer/grader split that a multimodal worker does not dissolve. Read before judging any image or accepting a visual claim.
when-to-use: grade an image, pixel grade, capture, render, still, contact sheet, does it look right, upscale, thumbnail, visual verdict, appearance claim, screenshot evidence
---

# Grading pixels

Grading is the orchestrator's duty and the last line where a green contract meets reality. It is also
where I have manufactured defects that were not there.

## Grade at NATIVE resolution

**Upscaling a pixel-scale feature invents structure.** LANCZOS rings a 2-3 px feature into scallops;
NEAREST squares it into stairs. Both look exactly like manufacturing defects.

Measured: three separate false findings in one day - "blocky atlas boundaries", a "stair-stepped
hairline", a "toothed wedge" - all of them the interpolator, none of them the mesh.

- Upscale only to LOCATE something already seen at 1x, never to discover it.
- If a claim rests on an enlarged crop, state the factor and filter beside it. **Native wins.**
- To inspect a small region, **crop and paste at 1:1** - that is not a resample. Or use NEAREST, which
  only shows existing pixels larger.
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
- **Check what a shared convention hides.** A root rotation identical across standing AND lying clips
  is a coordinate convention, not pose information. Find the joint that actually discriminates.

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

## After grading

Say which verdict is yours and which is consulted. "Upright, limbs present, proportions plausible" is a
pixel grade. "A patient here would be gowned" is a consulted clinical opinion, and neither is a
clinician sign-off.
