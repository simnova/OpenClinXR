---
name: measure-before-claiming
description: "Required before - opening or updating an issue, naming any cause or mechanism, attributing a stall/failure/red to a worker or a landing, trusting a suspiciously fast or cached gate result, closing a card, or accepting a peer/worker/superagent claim. Symptoms constrain a cause, never name it; liveness = state + git-history + tree probe; name matches are marker checks - read counts, bytes, hashes; measure through the loader the runtime uses; every proof ends with a literal NOT TESTED line. Appearance and visual claims route to pixel-grading."
when-to-use: file an issue, diagnose a failure, is this card still live, premise, withdraw a claim, attribute a stall, verify a worker report, peer consult, marker check, why did my measurement lie
---

# Measure before you claim

The single largest source of wasted slices here is a confident inference from a real observation.

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

## Two sentences to end every proof

Every proof run, report and close comment ends with the exact literal line:

> `NOT TESTED: <residual>`

**A proof block without that literal string is unfinished regardless of green.** The board loop already
requires this of workers' proofs - hold yourself to the same string.

- **Claim:** exactly what was shown.
- **Not tested:** the residual.

Words that unlock architecture - *hard*, *boundary*, *guarantee* - need a higher bar than words that
describe a filter.
