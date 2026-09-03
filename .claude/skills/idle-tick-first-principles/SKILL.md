---
name: idle-tick-first-principles
description: "Load when a loop tick finds NOTHING to do — no card to unblock, no work in flight, nothing unpushed. Instead of a noop, take on a hard part of the project from first principles: read the direction out of the briefs rather than inventing one, decompose it, SEARCH for proven open-source work and for research published after the training cutoff, and land a card with a RED rather than prose. Carries the idle test that must be measured not assumed, and the guards that stop this becoming speculative drift."
when-to-use: nothing to unblock, quiet tick, noop, idle loop, what should I work on, no ready cards, take on something hard, first principles, decompose, is there prior art, new research
---

# The quiet tick is the one that compounds

A loop that only reacts stops the moment the queue drains. This is what a tick does instead — and
it is bounded work with a board card at the end, not licence to think out loud.

## First, prove the tick is actually idle

Assumed idleness is how this becomes drift. All four must hold, measured:

```bash
git -C "$WT" status --porcelain | grep -v '^??' | wc -l     # 0: nothing uncommitted of mine
git -C "$WT" rev-list --count origin/main..HEAD             # 0: nothing unpushed
# no card assigned to me in progress; no card I am blocking; no peer waiting on a mailbox reply
```

If any is non-zero, finish that instead. **Unfinished work outranks a new idea every time.**

## Read the direction; do not invent one

The project's direction is written down. Start at
`docs/openclinxr/humanoid-motion-ENTRYPOINT.md`, which indexes the motion briefs in reading order
and marks which are superseded. Then `PROJECT_STATUS.md`'s Strategic Grouping Plan, then the
worker-backlog matrix. An idea that does not advance something those record is a different project.

The briefs also carry their own open questions — the "Open decisions" and "Not tested" sections
exist precisely to hand the next reader a real problem. Those are the first place to look, and they
beat anything you would think of unaided.

## Then, from first principles

1. **State the hard part in one sentence**, in terms of what a learner or a case author would
   observe, never in terms of a file.
2. **Ask what would have to be true** for it to work, and which of those the tree already satisfies.
   Measure; do not recall.
3. **Decompose to chunks that each leave the tree green** and each show a skeptic something. A chunk
   that produces bytes nothing loads is the orphan this repo keeps paying for.
4. **Name the chunk you would do first and why**, and what would falsify the whole approach.

## Search before you invent — the cutoff is the point

Two searches, both mandatory, both cheap:

- **Proven work that already does this.** `PROTO_CURIOUS_RESEARCHER.md` records three cases where a
  shipped API was hand-rolled instead — `bake_modifiers_remove_helpers`, `create_human(feet_on_ground=…)`,
  `anny.Anthropometry.waist_circumference`. You cannot grep for an API whose name you do not know, so
  search the web and the upstream repos, not just the tree.
- **Research newer than your training data.** The model's knowledge stops months before today. Whole
  techniques land in that gap, and the gap is invisible from the inside — you will not feel ignorant,
  you will feel confident. Search for the current year explicitly.

Licence status is part of the finding: CC0/CC-BY is the bar and **unspecified is a refusal**. Record
refusals in `docs/openclinxr/third-party-asset-licence-ledger.md` so nobody re-litigates them.

Label every finding VERIFIED (you read the source or the page), INFERRED (you reasoned), or
NOT FOUND. **NOT FOUND is a result worth recording** — it stops the next cycle re-searching the same
ground, and a confabulated API name costs more than an honest blank.

## Novel combination is allowed; novel invention usually is not

The interesting move is almost always composing two proven things the way nobody has here — a
retargeting library plus this repo's canonical joint aliases, a statechart runtime plus the existing
touch events. Inventing a new mechanism where a proven one exists is D1's exact prohibition.

If you do land on something genuinely new, say plainly which part is unproven and what would test it
cheaply.

## The output is a card, not an essay

End the tick with one of:

- **A board card** with a RED committed to main first, contracts written per `contract-design`, and
  `pre-dispatch-alignment`'s four labelled lines (Direction, Prior art, Collision, Size) in the body.
- **A short brief** in `docs/openclinxr/`, registered in the doc authority registry, when the work
  needs a decision before it can be scoped — with the decision stated as a question the operator can
  answer in one line.
- **Nothing, said plainly.** If the search found the ground already covered, say so and stop. An
  honest empty tick beats a manufactured card, and the anti-toil gate in `GUARD_DRIFT.md` is not
  suspended because the queue is empty.

## Guards

- One idea per idle tick. A tick that opens four cards has not thought about any of them.
- Do not re-open a question the briefs already settled; the withdrawn-claims tables exist so nobody
  re-derives them.
- Do not schedule the same hard part twice — check whether a card already carries it.
- Anything speculative is labelled speculative in the card body, not smuggled in as measured.
