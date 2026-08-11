# MADR 0051: Anny-as-reference → MPFB body match — the operational protocol

Status: Accepted
Date: 2026-08-10
Issue: #296
Related: MADR 0044 (decision: adopt the MH body for garment fit, Anny stays the proportional reference), MADR 0047 (hm08 rig carry), D11 (MPFB and Anny both first-class, split by job)

## Context

Operator direction, 2026-08-10, verbatim:

> Anny is used for a reference (e.g. ask Anny to generate a man, mid 40's, with a BMI of 45) then make
> images of it in T-pose, then go to MPFB and attempt to create the same human, but compare against the
> ANNY output to see if there's any tweaks necessary as Anny will be very accurate as to how the human
> should look but MPFB renders more "usable" assets (e.g. pre-rigged, has eyes, easier to clothe etc)

MADR 0044 already decided *that* Anny is the proportional reference and the MH/MPFB body is the
practical runtime body. It did not say **how** to carry a specific human across. This MADR is that
procedure.

**Why the split is the right one, measured 2026-08-10 (#296):**

| | Anny rail | MPFB rail |
|---|---:|---:|
| joints | 23 | **137** |
| finger chains | none | `finger1-1…finger5-3` + metacarpals |
| wrist bones | none | `wrist.L/R` |
| face / jaw | none | jaw, `tongue00–07`, levator / orbicularis / risorius / oris |
| unique positions | 13,380 (library export) | **19,158** (helpers retained) |
| `.mhclo` fitting | refuses non-basemesh topology | the topology the wardrobe is authored against |

On the Anny child, `hand.L/R`, `index_finger_base.L/R` and `foot.L/R` carry **zero dominant vertices** —
hands and feet do not articulate, which is why they grade as mittens and blobs. That is the concrete
content of "MPFB renders more usable assets". Anny's value is the opposite and equally real: it is the
rail whose phenotype drives the body, so it is the authority on *what the person should look like*.

## Decision

Adopt the following protocol whenever a case needs a body that is both **anthropometrically right** and
**riggable / clotheable**. Anny answers "is this the right human"; MPFB answers "is this a usable
asset"; the protocol is the bridge, and its output is reusable so the second case is cheaper than the
first.

### 1. State the human as a case-definition phenotype, not a prompt

The request — *man, mid-40s, BMI 45* — is authored on the scenario fixture actor record as
`phenotype` (`ActorPhenotypeSchema`, landed #291), not typed into a generator invocation. Both rails
then consume the same authored input, and the sufficiency gate (#294) refuses a phenotype with no
body-geometry field. This is what makes the protocol a factory step rather than a one-off.

### 2. Generate the Anny reference

Drive the Anny rail from that phenotype. **Export the reference mesh, and record which path produced
it** — the real Anny forward pass or the parametric stub. These are not interchangeable and the
distinction must be in the artifact (see BLOCKER below).

### 3. Normalize both bodies to T-pose *before* measuring

The operator asked for T-pose images. Extend it to the measurement: girths and spans are
pose-dependent, so a waist circumference measured on a hanging-arm body is not comparable to one
measured in T-pose. Same pose, same up-axis, same scale, or the comparison is meaningless.

### 4. Measure landmarks, do not eyeball

Extract from **both** meshes, in T-pose, in metres:

| landmark | definition |
|---|---|
| stature | mesh AABB height |
| shoulder span | max lateral extent in the deltoid height band |
| chest girth | convex-hull perimeter of the horizontal slice at chest height |
| waist girth | perimeter at the narrowest slice between chest and hip |
| hip girth | perimeter at the widest slice below the waist |
| upper-arm / forearm / thigh / shin length | joint-to-joint along the rig |
| head height | crown to chin |

The paired **T-pose renders** (front + three-quarter, lit *and* structure, identical camera) are
produced alongside as the human grade. Both are required: the numbers say how far apart the bodies are,
the pictures say whether the result reads as a person. Neither substitutes for the other — a body can
match every girth and still look wrong.

### 5. Accept on bands derived from the INPUT, never from the observed gap

A tolerance computed as a fraction of the measured difference passes by construction. Derive each band
from the request or from anthropometry:

- **stature** — ±1 cm of the phenotype's `height_cm`. Fixed by the input.
- **BMI** — ±1.0 BMI unit of the requested value, computed from measured stature and an estimated
  volume, not from a girth the match is tuning.
- **girths** — ±2 cm, the ordinary between-observer tolerance for a tape measurement on a live subject.
  An external floor, not a fitted one.

Record the band, its source, and the measured margin. If a band is later widened, cite which rows
flipped and why.

### 6. Solve the MPFB macros toward the reference, with a stop rule

MPFB's macro targets (gender, age, muscle, weight, proportions, plus the ethnicity mix — the ten
observed on the shipped asset) are the knobs. Adjust, re-measure, repeat.

**Stop rule:** at most **three** solve cycles. If any landmark is still outside its band after three,
stop and report which landmark and which macro failed to move it. Do not invent a fourth knob and do not
widen the band to close the gap. An honest "MPFB cannot reach BMI 45 on this basemesh, here is how close
it got and which landmark is stuck" is a successful outcome of this protocol.

### 7. Emit the tuning table — this is the durable output

Record, per macro slider, the measured **∂landmark/∂slider** observed during the solve. That converts
the next case from a guess into a deterministic solve, and it is the whole D9 argument for doing this
properly once: case 1 pays for the table, cases 2..n read it.

### 8. Carry the MPFB body forward, keep the Anny mesh as the reference artifact

The matched MPFB body becomes the runtime asset — it is the one with the rig, the eyes and the
`.mhclo`-compatible topology. The Anny mesh is retained as provenance: the thing the match was judged
against.

## Consequences

- Anny is never required at runtime. It is an authoring-time oracle.
- The wardrobe problem largely dissolves: a matched MPFB body is hm08-family with helpers retained, and
  `.mhclo` fitting is already wired (`ClothesService.fit_clothes_to_human`, `body_param_stage.py`).
- Hands, feet, jaw and eyes come for free with the MPFB rig, which is the class of defect the Anny rail
  keeps producing.
- Cost is one solve loop per body *class*, not per actor — bodies within a class differ by macro values
  the table already maps.

## BLOCKER — step 2 cannot run on this machine today

`import anny` raises `ModuleNotFoundError: No module named 'anny'` (verified 2026-08-10). The Anny rail
therefore falls back to `smooth_uv_parametric_stub_v2_not_real_anny`, and a stub reference would make
the whole protocol circular — matching MPFB to a parametric approximation rather than to Anny's
anatomy.

Two honest consequences:

1. **A new reference — including the operator's "man, mid-40s, BMI 45" — cannot be generated today.**
2. The only genuine Anny geometry available is the **seven tracked `.anny_base.obj`** under
   `apps/ui-xr/public/generated-humanoids/`. They are fixed identities (one child, six adults) and none
   is a BMI-45 mid-forties man. The protocol can be *exercised and its tuning table started* against
   those, which is worth doing, but the specific requested subject needs Anny installed.

Any artifact produced under this protocol must record `annyPath: real_anny_forward_pass | parametric_stub`.
A match against a stub is not evidence for this MADR's claim.

## What this does not claim

Not evidence for clinical or anthropometric validity of any generated body, for learner readiness, or
for Quest performance. The landmark set is a *comparison* instrument chosen so two meshes can be judged
against each other; it is not a clinical measurement standard, and no clinician has reviewed it. The
±2 cm girth band is an ordinary tape-measurement tolerance, not a validated threshold for this use.
