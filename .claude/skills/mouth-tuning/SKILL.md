---
name: mouth-tuning
description: "Gate for any request that changes how a humanoid's mouth looks or moves: lips, jaw, teeth, tongue, visemes, lip-sync timing. Measure with the headless evaluator, verify the premise with a one-minute probe, then dispatch with evaluator gates."
when-to-use: mouth, lips, jaw, teeth, tongue, viseme, lip-sync, mouth realism, teeth gap, creepy mouth, Oculus viseme comparison, teeth coupling producer
---

# Mouth tuning

Measured 2026-10-05 on the parent humanoid: of about 3 h 24 min mouth work, about 1 h 30 min went on
runs on false starting assumptions. Each refutable in under a minute with the evaluator.
The order below prevents that.

## 1. Baseline with the evaluator, not a capture

```bash
pnpm exec tsx tools/openclinxr/mouth-solver/evaluate.ts --glb <glb> --track docs/openclinxr/mouth-dynamics/step3/metrics.json --out <json>
```

About 0.5 s per run. The CLI wraps `@openclinxr/station-mouth-verifier`
(no solver id, no tuning value); implementation changes go in
`packages/openclinxr/stations/mouth-verifier`, never in `tools/`. It poses the GLB via the runtime public drive and reports
per frame, in named spaces: lower-teeth to lower-lip inner-rim gap, upper-teeth head-local displacement,
penetration, jaw travel. Its vertical projection is gated against browser tooth pixels
(|signed-median bias| <= 3 px, detrended median <= 2 px, max <= 5 px: the capture's
visible crowns shift through the aperture with depth while the model
projects the full shell, so constant offset is composition, spread is tracking);
horizontal is a known limit. A browser capture is for the final video only.

## 2. Probe the premise before writing a brief

```bash
pnpm exec tsx tools/openclinxr/mouth-solver/evaluate.ts --probe [--glb <glb>]
```

About 0.1 s. Same wrapper, over the verifier `probePremise`. Static morph response per viseme at its runtime jaw, no drive: outer-lip landmark, inner-rim
mean, lower-teeth, upper-teeth head-local z displacement, plus the jaw-weight share of rim vs lower teeth.
Reports all 15 OVR visemes in the GLB. Use it to refute premises before producer runs.

Write the premise as one measurable sentence, then measure with the evaluator or a scratch script
that imports it. False premises that cost a full worker run each:

| premise | what was true |
|---|---|
| the runtime can hold the teeth-lip gap | no runtime control moves only the lower teeth; the 7 teeth morphs move both arches |
| teeth should track the outer-lip landmark | the crowns face the inner mucosa; on aa the outer lip recedes ~9 mm while the inner rim stays |
| a rigid per-viseme delta cancels the gap change | teeth fully jaw-weighted vs lip partly jaw-weighted adds ~7 mm at full aa |
| a "surface gap" stays on the lip | at open poses it finds tongue/throat; measure against the inner rim only |
| zeroing teeth morphs changes a gauge | a gauge that skips morph targets reads identical numbers; the evaluator has a discrimination test |

## 3. Fixed facts about the parent mouth (as of the station-mouth pilot)

- Lower teeth share the lower-lip inner rim's skinning and per-viseme movement (seat
  pipeline in `packages/openclinxr/stations/mouth-executor`, via the CLI wrapper
  `tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts` via the
  pinned registry `run`), so the gap stays near-constant by construction: 6.1-6.9 mm on all 124 fixed-capture frames. The rim seat drives to the 3.743 mm directed target, then per-vertex pullback clears the #739 face (560 central lower-front verts, iterated quadratic falloff, worst 5.876 mm) to the cap-median-minus-0.5 mm plane; honest rest gap 6.387 mm. Teeth stay behind the face median at rest and at the runtime cap weight.
- Upper-lip raise on aa only: mouth-elevation = clamp(2 x viseme_aa, 0, 1) on every mouth-elevation host, the lip seal zeroes it on sealed frames (applyUpperLipRaiseToRoot / UPPER_LIP_RAISE_GAIN in xr-dialogue upper-lip-raise.ts); fitted teeth viseme_aa moves the upper central incisor +4.0 mm z / -3.5 mm y head-local on Aisha, Kevin, physician.
- Jaw timing: critically damped spring and lip follower at 240 Hz in xr-dialogue.
- A GLB change goes through a committed producer only, with its receipt updated in the same
  commit. Never hand-edit GLB bytes or stamp a hash read off disk.

## 4. Procedural and deterministic first (D1, D9)

Prefer, in order; state the rung used and why higher ones fail:

1. A standard geometric operation with no free parameters: weight transfer, morph transfer, projection onto a
   surface, nearest-point binding (Blender's Data Transfer).
2. A closed-form solve: linear least squares or a fixed-point with a stated bound and tolerance.
3. A deterministic search (grid or coordinate descent, fixed order, no randomness) over a small, named
   parameter set, with solver id, version, input hashes and chosen values written to JSON.
4. A hand-chosen constant only for an operator-set target (e.g. the teeth gap they judged right),
   recorded with its source.

Not allowed: per-pixel or per-vertex lists tuned on renders, values nudged until a capture "looks right",
an LLM writing geometry, or any step a rerun cannot reproduce byte for byte. Every producer run must be
deterministic (two runs, byte-identical GLB) as a test, not a one-off.

## 5. Dispatch with evaluator gates

Every mouth brief carries: premise plus probe result, evaluator gates with numeric targets and their
source, "stop and report if a premise measures false", and one final runtime-path video (no injected sampler).
The orchestrator grades native-resolution video frames before calling it done.
Briefs say "iterate with pnpm test:touched; commit is the full gate".
