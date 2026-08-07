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

The consequence, graded from three fresh room captures: **patients stand waist-deep inside their own
furniture in 3 of 3 rooms sampled**, feet protruding below the box. Two independent coordinate
sources that happen to collide in some environments and not others.

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
