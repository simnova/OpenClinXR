# 0035 — Digital-native station primitives (doorway as cargo-cult)

- Status: **proposed — Decision TBD, pending operator direction**
- Date: 2026-08-06
- Evidence: `docs/openclinxr/research/2026-08-06-step2cs-and-digital-native-primitives.md`

## Context

The runtime encodes `ExamRunStationPhase = "doorway" | "encounter" | "note" | "review"` with default
`doorwaySeconds: 60`, plus checklists and fixed timing. Those primitives were lifted from USMLE
Step 2 CS. Nobody on this project had special knowledge of that exam beyond public documentation, so
the structure was inherited rather than chosen.

Commissioned research (cited above) went through each primitive. Its verdict on the doorway:

> Pure corridor logistics. Context can be ambient, staged, interruptible, multi-source (EMS radio,
> EHR snippet, parent in hall). A mandatory 60s doorway clock is cosplay.

And the warning that makes this a decision rather than a cleanup:

> If OpenClinXR mainly rebuilds doorway + 15-minute SP + checklist + note, it will recreate a
> discontinued instrument's logistics shell while missing the only measurement frontier that
> justifies XR.

A second finding constrains how far familiarity is worth paying for: **CS validity evidence is not
inherited by copying CS phases.** The checklist-primary half of its scoring was the *weaker*
validated component; data interpretation and the note were stronger.

## Decision drivers

- Physical-logistics artifacts should not become product grammar by default.
- Multi-case sampling (Harden's actual contribution) is worth keeping; a fixed circuit shape is not.
- Familiarity for learners and faculty has real value — a format nobody recognises has adoption cost.
- Claim discipline: no change here licenses any validity claim, in either direction.

## Considered options

**A. Keep the CS shape.** Familiar, already built, matches faculty expectations. Cost: bakes a 2004
test-centre room into every scenario and forecloses the instrumented-process direction.

**B. Drop `doorway` as a phase; make context a composable channel.** Briefing becomes one or more
surfaces (chart fragment, EMS handoff, nurse aside, vitals stream) that a case can compose, rather
than a mandatory clocked gate. `encounter`, `note`, `review` retain their current roles for now.

**C. Adopt the full proposed primitive set** — Case Seed, Context Channels, Actor Policy, Session,
World Affordance Graph, Hypothesis Trace, Branch Scheduler, Critical Event Markers, Synthesis
Artifact, Process Trace, Replay Bundle, Review Packet, Sampling Plan, Pressure Profile. Highest
ceiling; a large migration of schemas, runtime and authoring surfaces.

## Outcome

**TBD.** This is a product-direction decision and belongs to the operator, not to the agent loop.
The research is recorded so the choice is informed rather than inherited by default.

Agent-side recommendation, for argument: **B now, C incrementally.** B is small, reversible, and
removes the one primitive the research names as clearest cargo-cult. C's genuinely new capability —
process traces under deterministic branchable encounters with replay — is where the research says
the only measurement frontier justifying XR actually lies, and several of its primitives (review
packet, actor policy, trace ledger) already exist here under other names.

## Consequences

- If B: `doorwaySeconds` stops being a required station parameter; existing scenarios need a
  migration path, and "briefing" needs a home that is not a phase enum.
- If C: substantial schema and runtime change, and the authoring surface changes shape.
- If A: no work, and the research stands as a recorded decision to keep the inherited shape
  knowingly rather than by accident — which is itself worth more than the status quo.
