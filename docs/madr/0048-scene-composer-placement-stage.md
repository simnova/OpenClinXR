# 0048 — SceneComposer: an evidence-gated placement stage

- Status: **proposed**
- Date: 2026-08-07
- Deciders: Patrick (operator) — proposal supplied; corrections and evidence added here
- Relates to: MADR 0016 (provenance manifests), 0035 (digital-native station primitives)
- Issues: #169 (the measured defect), #133 (which introduced it), #143

## Context

An operator-supplied proposal (`OpenClinXRSceneComposerProof`, 2026-08-07) argues for a dedicated
**SceneComposer** stage in the Encounter Blueprint Factory: generated GLBs plus a structured
`PlacementBlueprint` produce a validated, reproducible scene layout, with an optional
schema-constrained AI proposer and an evidence gate.

Its central diagnosis is that OpenClinXR has high-quality individual assets and **no first-class,
auditable placement abstraction** — scene assembly relies on manual or lightly-scripted positioning
inside `apps/ui-xr` paths.

## Decision

**Adopt the direction.** The proposal's core claim is correct and this record supplies the
measurements that were missing from it, plus two corrections that must be applied before any agent
implements it.

## The diagnosis is correct, and here is the evidence

Measured on 2026-08-07:

- `runtime-actor-placements.ts:29-34` places **every** `primary_patient` at a single hardcoded global
  `(-0.72, 1.06, -0.12)`.
- Fixture positions are **per-environment** — telehealth's `patient_chair` sits at `(-0.4, 0, -0.2)`.
- Grepping `apps/ui-xr` and `packages/openclinxr` for a collision or reachability constraint returns
  **zero hits**. No such abstraction exists.

The consequence, **measured across all 15 shipped stations by #169**: two patients stood inside their
own support furniture — `telehealth_diabetes_health_literacy_v1` at an overlap fraction of **1.00**
(entirely inside) and `ob_headache_preeclampsia_triage_v1` at **0.57**. Independent coordinate sources
that happen to collide in some environments and not others.

> **Premise corrected 2026-08-07.** This section originally read *"patients stand waist-deep inside
> their own furniture in 3 of 3 rooms sampled"*, from my pixel grade of postop / oncology / primary
> care. Those three measured **clear** — #133's offsets had already fixed them — and the real
> offenders were two stations I had never captured. The defect was real; my inference from those
> particular pixels to that particular mechanism was not. The argument below is unaffected and the
> measured numbers are stronger than the graded ones.

That is precisely the failure a declarative `constraints: { no_collision: true }` would prevent by
construction, and it is the strongest available argument for the proposal.

## CORRECTION 1 — the runtime is three.js, not Godot

The proposal repeatedly specifies *"deterministic Godot / factory code"* and *"Godot Resource"*.

Scenes in this project render in **three.js** (`apps/ui-xr`, `"three": "catalog:"`). Godot appears in
this repo **only** as `apps/arena/ui-quest-voice-godot` — a source-level Quest **voice client**
sidecar for codec/capture/playback experiments, explicitly recorded as *"not production voice, WebXR,
or Quest readiness evidence."* No MADR adopts Godot for scene rendering.

**An agent implementing the proposal literally would build the resolver in the wrong runtime.** The
procedural core belongs in the three.js path alongside `station-environment.ts`,
`station-stretcher.ts` and `runtime-actor-placements.ts`.

### Godot re-examined, 2026-08-07 — the correction stands, with a reopen gate

Correction 1 was challenged deliberately rather than left to stand. Findings, with the claims
separated by kind:

**Godot as the learner XR runtime — no, and the reason is that nothing has been measured.** Godot 4
ships OpenXR and a native Quest APK path is real, so a long-term native case genuinely exists. What
does not exist is any evidence that WebXR is a ceiling for *this* content class. Declared budgets are
180,000 visible triangles per station against a native Quest 3 guidance band of roughly 1.3–1.8 M — so
triangles are not the pressure. The pressure, if there is any, is draw calls, overdraw, skinned-mesh
CPU and JS main-thread time, and every one of those is fixable inside WebXR. **"Browser WebXR cannot
run a three-actor clinical room" is folklore until a Quest trace says otherwise**, and this project
has never run one.

**Godot as an offline placement solver — no, and this one is not close.** The v1 constraints are AABB
overlap, vertical pierce, seat/deck plant and yaw facing. That is static layout validation, not
simulation. Routing it through a second scene graph adds a third hop (descriptors → Godot nodes →
JSON → three.js) to a defect whose entire cause is that placement already has **three** uncoupled
sources. Porting engines before collapsing them produces the same bug in GDScript.

**What should own the deterministic core:** TypeScript pure functions over the same world AABBs the
three.js builders already produce. `three-mesh-bvh` (MIT, not currently in the tree) if boxes ever
lie. `@dimforge/rapier3d-compat` (Apache-2.0) only if constraints outgrow geometry — **verified
already in the tree** at `apps/arena/physics-clinical-touch` and
`packages/openclinxr/arena/physics-touch-contract`, for clinical touch rather than layout. No AGPL in
any of it.

**Switching cost, for the record:** the learner shell, fourteen environment descriptors and their
builders, the skin/bind/pose path, the React overlays, and the entire evidence harness — which
measures the **live three.js scene graph** — would all be rewritten. Against days-to-weeks for the
anchor binding this record already sequences.

**The reopen gate, and it is the only thing that changes this:** native OpenXR is out of scope until a
three-actor station is measured on a Quest and fails a written frame budget *after* budgeted
optimization. That measurement is the one missing fact that could move the runtime half of this
decision, and it belongs in a new MADR rather than inside SceneComposer implementation.

One precision on the original wording: Correction 1 said the runtime is three.js and an agent
implementing the proposal literally would build in the wrong runtime. That is correct and
load-bearing. It should not be read as "Godot is irrelevant forever" — it remains a valid future
native-runtime candidate under evidence.

## CORRECTION 2 — the status-quo risk rating is too generous

The proposal's comparison table rates the current approach **"Risk of clinical invalid layouts: Low
(manual)"**.

Measurement contradicts this. Three of three sampled rooms ship an invalid layout today. Worse, the
defect had already been **predicted, contracted against, and the contract passed** — #133's
`actorsIntersectingFurniture` check required the actor's XZ centre inside a footprint shrunk 0.12 m
per side, so a figure standing half in and half out is invisible to it.

The honest baseline is **High, and undetected**. This strengthens the case for the proposal rather
than weakening it: manual placement is not low-risk, it is unmeasured.

## Sequencing: the evidence gate comes before the schema

The proposal lists four next actions beginning with *"Formalize `PlacementBlueprint` schema"*. This
record inverts the first two, deliberately:

1. **A gate that can detect the defect** (#169) — enumerating every station, covering
   equipment-mounted supports as well as fixtures, calibrated against a known-good control.
2. **Then** the `PlacementBlueprint` schema and procedural resolver, which have something to be
   gated against.

Rationale: #133 is proof that a placement assumption written without a working detector produces a
green contract over a broken scene. A schema built first would encode `no_collision: true` as an
assertion nobody can verify.

## The AI boundary is right and should not be relaxed

The proposal's §3.2 — the AI proposer *"converts natural language + case context into a valid
PlacementBlueprint only. Never writes raw transforms into the live scene"* — matches the operator's
standing framing of AI inside a deterministic building block, and matches this repo's posture of
procedural-first generation.

**Caveat on `must_be_reachable`:** §6t of `agents/rules/PROTO_VERIFY_DELEGATION.md` records **five**
geometric gates in this repo that passed on figures a human graded as wrong, each defeated by a shape
its author had not anticipated. Reachability is a harder predicate than coverage. It needs a
definition and a known-good control before it becomes a constraint, or it will be the sixth.

## Consequences

- `PlacementBlueprint` becomes a factory artifact alongside actor, dialogue and asset materialization
  outputs, with provenance per MADR 0016.
- The hardcoded global patient anchor becomes a candidate for removal — it is arguably the root cause
  of #169 and is deliberately **out of scope** for that issue, which resolves the collision rather
  than restructuring the coordinate model.
- Nothing here is a clinical-validity claim. Placement constraints are **staging**; clinical
  positioning correctness needs a clinician.

## NOT DETERMINED

- whether `PlacementBlueprint` is authored per station, per room template, or generated from the case
  definition — the proposal implies the last but does not say
- what `must_be_reachable` means numerically, and against which control
- whether anchors are named semantic points (`bed_center`, `headwall`) resolved per room template, or
  coordinates. The proposal's example uses names, which is the better shape and is not yet built
- how this interacts with the fourteen shipped environment descriptors, which already carry
  `fixtureSlots` that are a partial, unversioned form of the same idea

## Analysis, 2026-08-07 — adversarial review of the proposal

Reviewed against the tree. Verdict: **direction sound; the full stage as specified is oversized and
will drift unless it OWNS the existing placement surfaces rather than paralleling them.** Both
corrections above were confirmed correct.

### The runtime already IS the composer

`station-environment.ts`, the #140 equipment mount and `runtime-actor-placements.ts` together already
resolve and instantiate a scene. The proposal reads as though placement is unbuilt; it is built and
**uncoupled**. So the work is **add resolve + validate to what exists**, not introduce a second scene
graph. That is the single most important framing correction.

### Sequencing is three steps, not two

The record above inverted the proposal's first two actions (gate before schema). That is right for
this defect and **incomplete**:

| # | step | why |
|---|---|---|
| 1 | a gate that fails **today** | without it, `no_collision: true` is another green lie (#133) |
| 2 | **bind the patient to a support anchor** | the smallest procedural fix; a gate alone "only measures pain forever" |
| 3 | formalise the schema that **describes that binding** | the schema documents a working mechanism instead of asserting one |

### `fixtureSlots` — superset, not replacement, and not a parallel system

This was the open question in NOT DETERMINED and it now has an answer:

| model | verdict |
|---|---|
| PlacementBlueprint **replaces** `fixtureSlots` | bad — slots already drive the chair and stretcher builders |
| PlacementBlueprint as a **second system** | **high drift risk** — the tree would then hold four layout sources |
| PlacementBlueprint as a **superset / evolution** | **correct** — the blueprint resolves actors and equipment *relative to* named anchors, and those anchors ARE the existing `slotId`s plus equipment ids |

v1 shape: `primary_patient` placement becomes `anchor: patient_chair | stretcher` plus an offset —
**not a parallel global XYZ table**.

### `must_be_reachable` — cut from v1

No navmesh, no hand IK, no Quest locomotion evidence exists. §6t of
`agents/rules/PROTO_VERIFY_DELEGATION.md` records five geometric gates that passed on figures a human
graded wrong; reachability would be the sixth. Keep `no_collision` (AABB overlap plus vertical
pierce), `facing` (yaw) and `height_offset` (seat/deck plant). If the field is retained at all it
carries `notEvidenceFor: reachability`.

### THREE placement sources today — measured, and it corrects this record

The review flagged bundle overrides as a third source. Verified:

| source | count |
|---|---|
| `runtime-actor-placements.ts` hardcoded `slotKind` table | 10 entries |
| `environment-descriptors.ts` `fixtureSlots` | 11 slots |
| shipped bundle `sceneManifest.actorPlacements` | **9 of 14 scenarios** |

And the sharp part: **the bundle placements carry the same coordinates as the hardcoded fallback.**
`oncology_bad_news_family_v1` and `postop_fever_consult_pressure_v1` both record
`{x: -0.72, y: 1.06, z: -0.12}` — byte-identical to `runtime-actor-placements.ts:29-34`. The factory
generated them by copying the fallback.

**Consequence:** changing the hardcoded table alone fixes 5 of 14 stations and leaves 9 unchanged,
because their bundles override with the same value. Any fix must address all three sources or
collapse them. #169's contract enumerates every station, so a partial fix fails by construction.

### What else the proposal misses in this codebase

| miss | why it bites |
|---|---|
| **posture** | seated / supine / standing change what a *valid* collision is — #133's check skips seated and supine outright |
| **two support paths** | fixtures versus #140 equipment; a fixture-only gate reports zero on oncology |
| **global anchors as SSOT** | the fix is not only to report collisions but to stop absolute patient XYZ being the source of truth |
| **AI proposer priority** | second, not core — procedural binding first |
| **review-packet ceremony** | provenance yes; do not block the learner path on full packet emission |
