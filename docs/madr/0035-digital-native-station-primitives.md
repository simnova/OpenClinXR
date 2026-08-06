# 0035 — Digital-native station primitives (doorway as cargo-cult)

- Status: **accepted — Option B**, decided by the agent loop 2026-08-06 on explicit operator delegation
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

**Option B.** `doorway` stops being a mandatory phase; briefing becomes a composable context
channel. Option C's primitives are adopted incrementally where they earn their place, not as a
migration.

The decision was initially left TBD on the grounds that product direction belongs to the operator.
That was half right and half avoidance: the operator had already said they hold no special knowledge
here that this research could not reach, so the call had been delegated and was handed back. The
honest reason for hesitating was that this decision has no gate — nothing fails in a minute if it is
wrong, unlike everything else built today. That is a reason to write the reasoning down, not a
reason to abstain.

Why B rather than A: the only strong argument for keeping the doorway is familiarity, and
familiarity here means resembling a discontinued instrument whose most faithfully-copied parts were
its least validated. Why B rather than C now: C is a schema-and-runtime migration across 34 files
touching `doorway` alone; taking it in one step would repeat the "build the mechanism, leave it
unconnected" failure at product scale.

Original recommendation, kept for the record: **B now, C incrementally.** B is small, reversible, and
removes the one primitive the research names as clearest cargo-cult. C's genuinely new capability —
process traces under deterministic branchable encounters with replay — is where the research says
the only measurement frontier justifying XR actually lies, and several of its primitives (review
packet, actor policy, trace ledger) already exist here under other names.

## Consequences

- **First slice (this decision):** a station may start directly in `encounter`. `doorway` becomes
  optional rather than removed — 34 files reference it and 10 reference `doorwaySeconds`, so
  deleting it outright would be a big-bang change with no rollback. Optional-first is reversible;
  removal can follow once nothing depends on it.
- Existing scenarios keep working unchanged: a scenario that specifies a doorway still gets one.
- If C: substantial schema and runtime change, and the authoring surface changes shape.
- If A: no work, and the research stands as a recorded decision to keep the inherited shape
  knowingly rather than by accident — which is itself worth more than the status quo.
