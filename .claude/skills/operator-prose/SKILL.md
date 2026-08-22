---
name: "operator-prose"
description: "Style contract for OPERATOR-FACING prose only - plain declarative reporting with hard numeric limits: max 2 bold spans per message (identifiers/numbers only), max 1 em-dash, no 'not X but Y' reframes, no setup-payoff reveals, no verdict-fragment openers, error reports as fact-action-correction without self-drama, tables only at 3 rows x 2 columns minimum. Load BEFORE writing any report, summary, or message addressed to the human operator. NOT for product-owner wire reports (delegator-comms governs those), worker briefs, issue bodies, or code - scope is stated in the body."
when-to-use: "operator report, write to operator, status summary for human, message to patrick, prose report, clickbait feedback, style feedback, before sending a report"
---

# Operator-facing prose

Scope: messages addressed to the human operator. The product-owner wire format
(`delegator-comms`) governs TICK blocks and is untouched by this file. Worker
briefs, issue bodies, commits, and code comments follow their own conventions.
When in doubt about audience: operator = human reads for substance fast;
everyone else = mechanical parse.

Research basis (2026-08 searches, r/ClaudeAI + anthropics/claude-code#77136 +
style guides): the most-cited complaints about current Claude prose are em-dash
density (measured 9-12+ per 1k words, several times human rates), the
"It's not X, it's Y" contrastive reframe read as fake depth, bold/formatting
over-emphasis flattening into noise, hype vocabulary ("load-bearing", "the
unlock"), and setup-payoff reveal structure read as performing insight. This
file bans each mechanically below.

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

1. **Open with the result.** First line is a complete declarative sentence
   naming what happened or changed, under 25 words. No fragment openers
   ("Worse — ...", "Baked in — ...", "Notable: ..."). A section header must
   name its content ("Audit results"), never its attitude ("the uncomfortable
   one").
2. **Finding, then evidence.** Never setup-then-reveal. If the interesting part
   arrives in the second half of a paragraph, invert it.
3. **Errors as three parts:** what I did, what it produced, what changes. No
   drama about having been corrected, no "and it was right" applause tracks.
4. **Tables** only for >= 3 rows x >= 2 columns of genuinely parallel facts.
   Two or three related facts are a sentence. Existing data tables in reports
   were justified; this rule guards drift, do not retrofit deletions.
5. **Length:** <= 300 words unless an incident needs the detail. Every
   paragraph earns its place by carrying a fact not stated elsewhere.

## Before / after (from real reports)

BEFORE: `## The audit's verdict, and it's the uncomfortable one`
AFTER: `## Audit results`

BEFORE: `Across the three planes: 376 transcript lines, **0 inference retries**, and — the thing #556 never managed — **2 artifacts on disk**:`
AFTER: `Three planes: 376 transcript lines, 0 inference retries, 2 artifacts on disk. #556 produced 82 correct actions with nothing on disk.`

BEFORE: `**52 entries, not 66.** That's the §6n magnet defused: my brief said the number was context, and it sized to what the clip actually needs.`
AFTER: `Source map settled at 52 entries, under the 66 in the brief; the "number is context" instruction held.`

BEFORE: `That's the thesis of the slice confirmed by measurement, and it retroactively vindicates #546.`
AFTER: `This confirms #546: those map entries were inert because the CMU source has no finger channels.`

BEFORE: `**I raised one objection rather than silently complying** — it directed me to stop issuing visual verdicts...`
AFTER: `One objection filed: workers are ox instances, so owner-grading could collapse the producer/grader split.`

## Self-check (one pass, end of draft)

Count bold spans (>2?), em-dashes (>1?), "not...but" reframes (any?), verdict
openers (any?), payoff sentences starting "That's" (any?). Any hit: revise that
sentence, do not soften it — delete the flourish and keep the fact.
