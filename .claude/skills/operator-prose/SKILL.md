---
name: "operator-prose"
description: "Style contract for OPERATOR-FACING prose only - plain declarative reporting with hard numeric limits: max 2 bold spans per message (identifiers/numbers only), max 1 em-dash, no 'not X but Y' reframes, no setup-payoff reveals, no verdict-fragment openers, error reports as fact-action-correction without self-drama, tables only at 3 rows x 2 columns minimum, and every count must name its own set rather than chaining cardinals the reader has to repartition. Load BEFORE writing any report, summary, or message addressed to the human operator. NOT for product-owner wire reports (delegator-comms governs those), worker briefs, issue bodies, or code - scope is stated in the body."
when-to-use: "operator report, cardinal chaining, numbers in prose, write to operator, status summary for human, message to patrick, prose report, clickbait feedback, style feedback, before sending a report"
---

# Operator-facing prose

Scope: messages addressed to the human operator. The product-owner wire format
(`delegator-comms`) governs TICK blocks and is untouched by this file. Worker
briefs, issue bodies, commits, and code comments follow their own conventions.
When in doubt about audience: operator = human reads for substance fast;
everyone else = mechanical parse.

## Hard limits (count before sending)

| item | limit | notes |
|---|---|---|
| bold spans | max 2 per message | only on identifiers/numbers the reader must relocate (path, commit, gate name). Never bold a clause, punchline, or words inside a quotation |
| em-dashes | max 1 per message | default replacement: separate sentence. Parentheses acceptable for short asides |
| "not X, it's/but Y" constructions | 0 | banned outright, including "isn't just X — it's Y" |
| "That's the X defused/vindicated/confirmed" payoffs | 0 | state the finding and its evidence instead |
| evaluative adjectives on findings ("sharp", "uncomfortable", "dangerous one", "elegant") | 0 | measurable adjectives only (faster, larger, failing) |
| first-person virtue framing ("I raised an objection rather than silently complying") | 0 | state action and outcome; drop the character |
| sentence-initial And/But/So | unrestricted | measured at 2 per 12 reports; not a defect, leave alone |

## Structure

1. **Open with the result as a complete claim.** First line is a declarative
   sentence naming what happened or changed, under 25 words. No fragment openers
   ("Worse — ...", "Baked in — ...", "Notable: ..."). A section header names its
   content ("Audit results"), never its attitude ("the uncomfortable one").
2. **ORDER IS FIXED: decision-changing failures first, wins after, no closing
   summary.** The report is single-pass: every failure, blocker, or NOT TESTED
   item that would change what the reader does is stated before any success. A
   limitation that qualifies one specific result is the exception: put it beside
   that result, not in the opening block, because moving it away from its
   evidence costs the reader the link. Never append a caveat to a run of wins:
   that is the wins-then-caveat shape, and moving a decision-changing failure to
   a later paragraph is the same defect with a different surface. The last line is a complete fact
   or `NEXT: <action>`; there is no summary section at the end (the report just
   gave it).
3. **Finding, then evidence; every count names its set.** Identifiers, dates,
   versions, issue numbers, line numbers and paths are not counts. For each
   count, name the population, unit, threshold, result or object when it is
   introduced and whenever it changes; coordinated counts may share one explicit
   referent in the same sentence or a named row. Check each count supports the
   claim beside it. Never make the reader rebuild a subset through "of those",
   "the remaining one", "that last one",
   "one of its two" or a bare "all three" - repeat the noun or identifier, or
   use named rows. A count does not establish an unmeasured judgement. Never
   setup-then-reveal: if the interesting part arrives in the second half of a
   paragraph, invert it.
4. **Errors as three parts:** what I did, what it produced, what changes. No
   drama about having been corrected, no applause tracks.
5. **Tables** only for >= 3 rows x >= 2 columns of genuinely parallel facts.
   Two or three related facts are a sentence.
6. **Length:** <= 300 words unless an incident needs the detail. Every
   paragraph earns its place by carrying a fact not stated elsewhere.

## Voice rules (the copyable style)

- State conclusions as plain claims; attach evidence in the same sentence or the next ("Measured:", "verified by", path). No verdict fragments, no headline tone.
- Attack premises before answering questions built on them; attribute every claim (measured / inferred / consulted) and label UNKNOWN rather than hedging.
- Narrate zero process: no "I noticed", "I raised", "checking now". Report state and decisions only.
- Structure (lists/tables) appears only when comparing parallel items; sequential facts are sentences.
- No emphasis inflation: bold reserved for identifiers/numbers the reader must relocate; never bold clauses or punchlines.
- Endings are decisions, actions, or facts. Teasers ("Checking X:", "Not yet landed…") are banned.

## Before / after (from real reports)

BEFORE: `## The audit's verdict, and it's the uncomfortable one`
AFTER: `## Audit results`

BEFORE: `Across the three planes: 376 transcript lines, **0 inference retries**, and — the thing #556 never managed — **2 artifacts on disk**:`
AFTER: `Three planes: 376 transcript lines, 0 inference retries, 2 artifacts on disk. #556 produced 82 correct actions with nothing on disk.`

BEFORE: `**52 entries, not 66.** That's the §6n magnet defused: my brief said the number was context, and it sized to what the clip actually needs.`
AFTER: `Source map settled at 52 entries, under the 66 in the brief; the "number is context" instruction held.`

BEFORE: `That's the thesis of the slice confirmed by measurement, and it retroactively vindicates #546.`
AFTER: `This confirms #546: those map entries were inert because the CMU source has no finger channels.`

BEFORE: `Of the 4 I landed, 3 went well; of those 2 were great, and the remaining 1 had 5 issues. That last one was profound.`
AFTER: `Four changes landed. A, B and C met the gate. D had five named issues. These counts do not measure D's importance.`

BEFORE: `Two cards are ready and the one you asked about is the second.`
AFTER: `#683 and #681 are ready. You asked about #683.`

BEFORE: `**I raised one objection rather than silently complying** — it directed me to stop issuing visual verdicts...`
AFTER: `One objection filed: workers are ox instances, so owner-grading could collapse the producer/grader split.`

## Self-check (one pass, end of draft)

Count bold spans (>2?), em-dashes (>1?), "not...but" reframes (any?), verdict
openers (any?), payoff sentences starting "That's" (any?), wins-then-caveat
orderings (any failure or caveat stated after a success?), count references
(does every count name its set or unit in its own clause, support the claim
beside it, and avoid a backward subset reference?). Any hit: revise that
sentence, do not soften it — delete the flourish and keep the fact.
