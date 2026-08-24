---
name: measure-before-claiming
description: "Required before - opening or updating an issue, naming any cause or mechanism, attributing a stall/failure/red to a worker or a landing, trusting a suspiciously fast or cached gate result, closing a card, or accepting a peer/worker/superagent claim. Symptoms constrain a cause, never name it; liveness = state + git-history + tree probe; name matches are marker checks - read counts, bytes, hashes; measure through the loader the runtime uses; every proof ends with a literal NOT TESTED line. Appearance and visual claims route to pixel-grading."
when-to-use: file an issue, diagnose a failure, is this card still live, premise, withdraw a claim, attribute a stall, verify a worker report, peer consult, marker check, why did my measurement lie
---

# Measure before you claim

The single largest source of wasted slices here is a confident inference from a real observation.

## SEARCH BEFORE YOU MEASURE — the one subtraction from the 2026-08-24 orchestration review

**No probe runs until you have searched `tools/openclinxr/evidence/`, the relevant contract headers, and
the skills index for the same measurement.** If it exists, cite it and move on. If it genuinely does not,
measure ONCE and record where the next orchestrator will find it.

This replaces reaching for a fresh measurement loop, and it is a subtraction, not an addition. The review
that produced it rejected my own account of why I keep erring. I said "I verify the thing I changed, not
the thing I might have broken"; it answered that this fails on three of seven cases because **nothing had
regressed** in them, and named the real common denominator:

> "Every one had a cheap mechanical check you already possessed, and you skipped it… That is not a
> verification-coverage gap. It is acting on an unverified premise when the falsifier was one lookup
> away — the same genus as the fabrication fingerprint in your own rules file, pointed at yourself."

And the second-order shape, which is the one to watch: **you treat your own recent output as ground truth
without re-reading it** — your own skill file, your own flag, your own plant, your own header.

**The operational test for whether you are doing IC work:** *if the work could have been a `done_when`
clause, doing it yourself is IC work.* A pre-dispatch measurement to size a brief is legitimate. Five
ticks to reach a conclusion a contract header already recorded is diagnosis theatre.

**Cost that earned this:** five ticks re-deriving a dark-room defect already written down three days
earlier — including using as a "known-good column" an asset that same header flagged ANOMALOUS — plus a
hand-rolled luminance sweep duplicating `station-luminance-sweep.ts`.

## The core rule

**Symptoms constrain a cause. They never name it.**

Measured: a worker at 0.1% CPU, frozen transcript, zero files, no crash. Attributed to a bad brief.
The harness log said `inference_retry / empty_response / no_visible_content, attempt 1 of 15` - a
provider failure in backoff. Every symptom was explained by the real cause; none of them selected it.
**It was one grep away.**

Before writing a mechanism into an issue body, measure the mechanism. If you cannot, write the issue
as *"here is what I observe, cause NOT DETERMINED"* - that is a better document, and it does not send
a worker down a path you invented.

## Liveness needs THREE fields, not one

An OPEN issue is not a live issue.

1. `gh issue view N --json state,title` - drop if CLOSED, or the title says WITHDRAWN/PARKED/SUPERSEDED
2. `git log --all --grep='#N'` - if HEAD already contains the fix, close it
3. **A tree probe of the claim the title makes** - this is the one people skip

Measured: a card said *"no eyebrows, eyelashes or teeth on any of the 11 actors."* State was OPEN and
the grep found nothing, because the commit that killed the premise cited a DIFFERENT issue. Only
enumerating the actual assets showed all 11 already had them. **A premise can die by a commit that
never names the card.**

**And run this BEFORE the work, not after.** Measured 2026-08-24: a standing portfolio line listed E1
as live, so I re-measured its whole done-condition and re-graded its contact sheet — then found #499
and its gate card #416 had both been CLOSED three days earlier. The grade agreed, so the cost was only
a tick; the error was ordering. **A line in a standing prompt is not state. The board is state** — and
a prompt that is re-sent verbatim each cycle will keep asserting a finished effort is live forever.

## A name match is a marker check

`grep`-ing for a name tells you what something is CALLED. When the question is whether something
exists with substance, read the substance - counts, bounds, bytes, hashes.

- Filtering mesh names for `/garment|cloth/` to conclude "all dressed" is the same class of error as
  the gates it was meant to audit.
- When two things "share the same asset", **hash the bytes**. Names differ while bytes are identical;
  identity by id-string is not identity.
- A regex on a word boundary misses `_eyes_` because underscore is a word character. Test the regex
  against a known positive before trusting a zero result.

## Measure through the loader the runtime uses

Reading the asset answers a different question from reading what the running code sees. Names, indices,
units, axis conventions and hierarchy are all transformed on import. If the question is *"does the
running code find this"*, go through the loader.

## Instruments lie in specific ways

- **A cached measurement is green - and RED - about nothing.** A suspiciously fast pass is a failed
  run. Clear the cache before any result you intend to act on, and say you did when handing a failure
  to a worker.
- **Two instruments agreeing is not correctness.** Independence of implementation is not independence
  of blindness. State what the SHARED metric cannot see, next to the check.
- **A pipeline's exit code is its LAST command's.** `pnpm test | tail` reports `tail`. Never pipe a
  gate whose exit code you trust.
- **A responding port is not YOUR server.** When a service "does not pick up a change", first check
  the process answering is the one you started.
- **A config file can fail SILENTLY and differently at each layer.** Measured on my own skills:
  an UNQUOTED YAML `description:` containing `##` truncated at the comment marker (the skill loaded
  with half a retrieval key), and one containing `Direction: /` **dropped the skill from the listing
  entirely** - it simply was not there. Neither errored. **Always quote a YAML scalar that contains
  user prose**, and verify by reading the rendered surface, not the file you wrote.
- **Your own tooling fails too.** A `tsc` error can be your bad path; a `no tests` result can be a
  collection failure, not a pass. Attribute the failure before reporting it.

## Attribution: stash before you blame

When a landing turns something red, the question is not "what did the slice break" but "what did that
check actually measure, and was it measuring it before?" Prove it by stashing your change and re-running
- or, if the tooling will not cooperate, argue from the diff: if the slice touched neither the subject
nor the assertion, the verdict cannot have changed.

## Accepting a claim from a peer or a worker

- **Verify tree claims before acting.** A peer can be right about structure and wrong about mechanism.
  A recommendation whose precondition is false is worse than no recommendation.
- **Hedged framing about whether the conditions held means UNOBSERVED.** Confident detail on uncertain
  premises is the fabrication fingerprint.
- **A result that would overturn a proven claim gets re-run.** Surprise is a re-run trigger by itself.
- **When a delegate overturns YOUR premise, read the SCOPE of the overturning.** A full withdrawal is
  as much an over-claim as the original; ask what it did and did not reproduce.
- **Correct a premise where it is STATED**, not in an appended note - the next reader starts at the top.

## Never pass prose through `--body` or `-m` — use a file

Measured twice in one session, hours apart: a `gh issue comment --body "…"` and a `git commit -m "…"`
both contained backticked code spans, and zsh ran them as command substitutions. Output:
`command not found: skipFraming`, `command not found: headCenterY`, `no matches found: matrixWorld[13]`.
The commit landed with a hole in it; the comment posted mangled and had to be replaced.

Any text containing backticks, `$`, or `!` goes in a heredoc file and is passed as `--body-file` /
`git commit -F -`. This is not a style preference — the shell silently deletes the most technical part
of the sentence, which is exactly the part worth writing down.

## Two sentences to end every proof

Every proof run, report and close comment ends with the exact literal line:

> `NOT TESTED: <residual>`

**A proof block without that literal string is unfinished regardless of green.** The board loop already
requires this of workers' proofs - hold yourself to the same string.

- **Claim:** exactly what was shown.
- **Not tested:** the residual.

Words that unlock architecture - *hard*, *boundary*, *guarantee* - need a higher bar than words that
describe a filter.

## Compare like with like, or the check is vacuous

Measured 2026-08-22, twice in one day, both mine.

**Wrong space.** A contract asserted a garment's `baseColorFactor` differed from the body's
`baseColorFactor`. It passed 3/3 and measured nothing: the body's colour lives in an 801 KB **texture**
and its factor is `1,1,1`, so the comparison was garment-versus-white and returned a 0.58 delta on a
figure that reads nude. The honest instrument is `texture-mean x factor` on BOTH sides, in one colour
space. A superagent named the same defect in a plan I proposed: comparing one actor's factor reading
against another's texture-mean is invalid *even when both numbers are real*.

**Substring noise.** `grep -rn '1147'` returned **896 hits** and I reported it as 896 consumers. They
were BVH motion-capture floats — `0.1147`, `-4.1147`. Word-boundary `\b1147\b` returns 84, all inside
`.bvh`, and the actual consumer count is **0**. A grep for a number needs `\b`, and a count that large
for a specific constant is itself the tell.

**Rule:** before believing a delta, state what space each side is in. Before believing a count, look at
three matches.

## `loaded` is not `rendered`, and `rendered` is not `correct`

Three questions, three instruments, and this repo's scene JSON only ever answers the first.

- `loadedCount 4, failedCount 0, fallbackActive false` — the file arrived. Says nothing about pixels.
- a room capture showing furniture and figures — it renders. Says nothing about whether the figures are
  right.
- the pixel grade — in the same frame that reported 4/4 loaded, one actor had garments within
  ΔE 11 of her own skin and read as nude, and a child intersected the exam furniture.

Same genus as presence/placement/provenance. When a report says an asset is fine, ask which of the
three it measured.

## Grade the instrument before the artifact

I graded two captures from `mouth-gaze-pose` and concluded no station renders. That mode is a
**face/pose review harness** — it hides controllers, forces evidence panels, and frames close. It is
not a scene view, and the scene-wide verdict drawn from it was withdrawn. The room-framing capture
showed 15 stations rendering correctly.

**Rule:** before grading, read what the capture mode is FOR. A harness answering a different question
looks exactly like a broken product.

## A threshold comes from a distribution, never from the observation

Having measured one bad value, the temptation is a threshold just above it. That is fitting the gate to
the finding (see `contract-design`). The defensible sequence, run 2026-08-22:

1. Measure the SAME quantity with ONE instrument across the whole population — 17 humanoids, 20
   skin-to-garment ΔE pairs.
2. Look for structure. Three bands appeared: **10.6–11.6** (2 actors), **20.6–22.0** (4), **35.8–39.1**
   (4). The gap between 11.6 and 20.6 is empty.
3. Put the threshold in the empty gap. The ambient set sets it; the offenders fall below it; the
   observation validates it.
4. Anchor to an external floor where one exists — here CIELAB ΔE against the published JND (~2.3) times
   a stated multiplier, so the number survives someone asking "why that value".

**The population measurement also found a second offender I had not seen** (`mpfb-family-partner-adult`
at 10.6/10.9, beside the peds parent at 11.1/11.6). Planting from the single graded frame would have
shipped a fix for one actor and left the other.
