---
name: mouth-tuning
description: "Gate for any request that changes how a humanoid's mouth looks or moves: lips, jaw, teeth, tongue, visemes, lip-sync timing, mouth realism vs the Oculus references. Measure with the headless evaluator, verify the design premise with a one-minute probe, then dispatch with evaluator gates; never iterate on browser captures."
when-to-use: mouth, lips, jaw, teeth, tongue, viseme, lip-sync, mouth realism, teeth gap, creepy mouth, Oculus viseme comparison, teeth coupling producer
---

# Mouth tuning

Measured 2026-10-05 on the parent humanoid: of about 3 h 24 min of mouth work, about 1 h 30 min went on
runs whose starting assumption was false. Each could have been refuted in under a minute with the evaluator.
The order below exists to prevent that.

## 1. Baseline with the evaluator, not a capture

```bash
pnpm exec tsx tools/openclinxr/mouth-solver/evaluate.ts --glb <glb> --track docs/openclinxr/mouth-dynamics/step3/metrics.json --out <json>
```

About 0.5 s per run. It poses the GLB through the runtime's own public drive (no reimplementation) and reports
per frame, in named spaces: lower-teeth to lower-lip inner-rim gap, upper-teeth head-local displacement,
penetration, jaw travel. Its vertical projection is gated against browser tooth pixels
(|signed-median bias| <= 3 px, detrended median <= 2 px, max <= 5 px: the capture's
visible crown set shifts through the lip aperture with teeth depth while the model
projects the full shell, so constant offset is composition, spread is tracking);
horizontal is a known limitation. A browser capture is for the final video only.

## 2. Probe the premise before writing a brief

```bash
pnpm exec tsx tools/openclinxr/mouth-solver/evaluate.ts --probe [--glb <glb>]
```

About 0.1 s. Static morph response per viseme at its runtime jaw angle, no drive: outer-lip landmark, inner-rim
mean, lower-teeth, and upper-teeth head-local z displacement, plus the jaw-weight share of rim vs lower teeth.
Reports all 15 OVR visemes present in the GLB. Use it to refute tracking premises before any producer run.

Write the design's premise as one measurable sentence, then measure it with the evaluator or a scratch script
that imports it. Premises that were false and cost a full worker run each:

| premise | what was true |
|---|---|
| the runtime can hold the teeth-lip gap | no runtime control moves only the lower teeth; the 7 teeth morphs move both arches |
| teeth should track the outer-lip landmark | the crowns face the inner mucosa; on aa the outer lip recedes ~9 mm while the inner rim stays |
| a rigid per-viseme delta cancels the gap change | teeth fully jaw-weighted vs lip partly jaw-weighted adds ~7 mm at full aa |
| a "surface gap" stays on the lip | at open poses it finds tongue/throat; measure against the inner rim only |
| zeroing teeth morphs changes a gauge | a gauge that skips morph targets reads identical numbers; the evaluator has a discrimination test for this |

## 3. Fixed facts about the parent mouth (as of the producer fix on branch mouth-solver)

- Lower teeth share the lower-lip inner rim's skinning and per-viseme movement (producer
  `tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts`), so the gap is near-constant by construction: 6.1-6.9 mm on all 124 fixed-capture frames. The rim seat drives to the 3.743 mm directed target, then per-vertex pullback clears the #739 face (560 central lower-front verts, iterated quadratic falloff, worst 5.876 mm) to the cap-median-minus-0.5 mm plane; honest rest gap 6.387 mm. Teeth stay behind the face median at rest and at the runtime cap weight.
- Upper teeth are head-fixed: zero viseme deltas.
- Jaw timing: critically damped spring and lip follower at 240 Hz in xr-dialogue internals.
- A GLB change goes through a committed producer only, with the receipt updated by that run in the same
  commit. Never hand-edit GLB bytes or stamp a hash read off disk.

## 4. Procedural and deterministic first (D1, D9)

Prefer, in this order, and say in the brief which rung the design uses and why a higher one does not work:

1. A standard geometric operation with no free parameters: weight transfer, morph transfer, projection onto a
   surface, nearest-point binding (what Blender's Data Transfer does).
2. A closed-form solve: linear least squares or a fixed-point with a stated bound and tolerance.
3. A deterministic search (grid or coordinate descent, fixed order, no randomness) over a small, named
   parameter set, with the solver id, version, input hashes and chosen values written to a JSON record.
4. A hand-chosen constant only when it is a target the operator set (e.g. the teeth gap they judged right),
   recorded with its source.

Not allowed: per-pixel or per-vertex lists tuned against renders, values nudged until a capture "looks right",
an LLM writing geometry, or any step that a rerun cannot reproduce byte for byte. Every producer run must be
deterministic (two runs, byte-identical GLB) and that must be a test, not a one-off check.

## 5. Dispatch with evaluator gates

Every mouth brief carries: the premise and the probe result, evaluator gates with numeric targets and their
source, "stop and report if a premise measures false", and one final runtime-path video (no injected sampler).
The orchestrator grades the video frames at native resolution before calling it done.
Briefs say "iterate with pnpm test:touched; commit is the full gate".
