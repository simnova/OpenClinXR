---
name: supervisor-loop
description: One iteration of the four-duty supervisor loop — review agentic logs for non-self-correcting issues, keep the prioritized product-forward ready set from starving a dequeue, re-verify work reported done, and issue corrections. Load at the start of every supervisor iteration, before reading any log by hand.
---

# Supervisor loop — one iteration

**Operator directive, 2026-08-24.** Each iteration does four things:

1. Review agentic logs for issues that need addressing **and are not self-correcting**
2. Ensure the ready set of **prioritized items that move the PRODUCT forward substantively** does
   not starve a dequeue
3. Review work that was **said to be done** and confirm it was done as expected
4. Issue corrections — as work items, or by correcting agentic configuration directly

Duties 1–3 are **measurements**. Duty 4 is **judgement**. Do not re-derive 1–3 by reading logs by
hand: that is an LLM doing arithmetic, it is not reproducible, and it cannot answer the question duty
1 actually asks — *have I seen this before?*

## Step 1 — run the measurement (always first)

```bash
pnpm openclaw:supervisor
```

Writes `.openclinxr/openclaw/supervisor-audit-latest.json` and appends to
`supervisor-audit-history.jsonl`. The history is what makes duty 1 possible: a finding is **chronic**
only when it appears in every one of the prior `CHRONIC_AFTER` audits. A finding that flickers is
self-correcting under load, and reporting it as chronic buries the ones that never clear.

Read the report. Do not re-measure what it already counted.

### Do NOT read the board a second time — the audit already did

Measured 2026-08-27: GraphQL fell from 5000 to 4050 across a few iterations, and the board read
failed outright twice, serving snapshots 1,073 s and 3,345 s old. A full read of a 717-item board
costs roughly seven paginated calls, and the loop was paying it twice per iteration — once inside
`pnpm openclaw:supervisor`, once in my own `gh project item-list --limit 900` to check Factory and
Priority fields.

Lowering the limit does not help: 900 and 5000 both fetch the whole board.

Read these instead:

| need | source |
|---|---|
| duty measurements, ready membership | `.openclinxr/openclaw/supervisor-audit-latest.json` |
| Factory / Priority fields the audit omits | `.openclinxr/openclaw/board-snapshot-cache.json`, carrying its `fetchedAtIso` |
| a card you are about to DISPATCH | a fresh fail-closed read — never dispatch from a stale snapshot |

The audit already forces one fresh attempt with `ttlMs: 0`, so a direct read in the same iteration is
pure duplication. Board WRITES (`board-cli factory`, `gh project item-edit`) are cheap and stay.

### The audit needs GitHub budget

It reads the full board (~3.3 MB, paginated) and all open issues. **Check `gh api rate_limit` first.**
A GraphQL budget under ~200 will fail the board read, and the audit exits with a `gh` command error
rather than a report — measured 2026-08-24, twice in one afternoon.

That is a real constraint on cadence: an hourly loop competes with every other board write in the
repo for one 5,000-point budget. If the audit fails on budget, that is not a defect to chase — note
it, skip the iteration, and do not retry into an exhausted limit.

**Duty 4 still works when GraphQL is spent.** The two budgets are separate, and `gh issue create`
uses GraphQL while the REST endpoint does not. Measured 2026-08-24 with graphql at 0/5000:

```bash
gh api -X POST repos/simnova/OpenClinXR/issues \
  -f title="..." -F body=@/path/to/body.md --jq '.number'
```

filed #634 for one core point. So an iteration that cannot MEASURE can still file the corrections it
already knows about. Never skip duty 4 for lack of budget without trying this first.

## Step 2 — consult the peer, with the raw report

Per D10, this is a **conversation**, not a single message. Hand over the report itself, not a summary.

```bash
codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium -c sandbox_mode=read-only \
  --skip-git-repo-check -o /tmp/consult/rN.json "$(cat /tmp/consult/promptN.md)" < /dev/null
```

**THE ARTIFACT ARRIVES AFTER THE ITERATION ENDS — poll it ACROSS iterations, not within one.**
Measured 2026-08-27 over five rounds: prompts of ~12 KB take roughly 15-20 minutes to produce a JSON
artifact, while an in-iteration poll gives up around 4 minutes. Twice I reported "the consult never
returned" and the file appeared later.

The cost is not cosmetic. The round I abandoned had already answered the question I then got wrong:
it said keep #693 and #714 at `Dispatched` because their contracts remain red, and I advanced #692
and #693 to `Landed` anyway. The audit caught both as failing done-claims the next iteration.

So: launch the consult, do the iteration's work without it, and **read the PREVIOUS iteration's
artifact at the start of the next one** — `ls -t /tmp/consult/*.json | head -1`. Never report a
consult as failed inside the window; report it as pending.

`< /dev/null` is MANDATORY — a backgrounded codex inherits a never-closing stdin and hangs at
*"Reading additional input from stdin..."*. Poll the artifact, never the process.

The prompt must carry: the raw audit JSON, what changed since last iteration (`resolved` and
`chronic` arrays), and an explicit invitation to disagree. Ask for **alternatives**, not just
critique (D6).

**Verify every tree claim it makes before acting.** Measured across two rounds on 2026-08-24: it
corrected three of my numbers correctly and was wrong once about a payload field. Both directions
happen.

## Step 3 — the duties, with their specific failure modes

| duty | the number | how it lies |
|---|---|---|
| 1 | `findings[].chronic` | every transient flagged, so the chronic ones drown |
| 1 | `findings[].occurrences` | it saturated at 3 until `c8962322` — a 9-window chronic read as "seen 3x" |
| 2 | `readyDepth.productForward` | ten **instrument** cards "satisfying" a product floor |
| 3 | `doneClaims[].ok` | a commit that *cites* an issue read as proof the work *landed* |

**The floor is 3, DERIVED — not the 10 this skill used to state.** `supervisor-audit.ts:51`
computes it from `OBSERVED_MAX_CONCURRENT_WORKERS = 3`, on the reasoning that a dequeue starves only
when the ready set is smaller than the number of lanes fillable at once. No buffer is added. The
literal 10 in the operator's original directive was never what the code enforced, and reporting a
shortfall against 10 while the gate used 3 made every audit look short by seven. Re-derive when
lanes scale; the number is measured so it goes stale visibly.

**Duty 2's product filter is not an opinion.** `board-brief.ts`'s `FACTORY_STEPS` enumerates the
factory's stations and names `instrument` as the non-station. The floor counts only real stations —
the same rule the dispatch gate enforces as *"measuring is not building"*.

**Duty 3's ancestry check is the load-bearing one.** MEASURED 2026-08-24: #596 was closed on a
`grep VERIFIED` that also matched **UN**VERIFIED, against a commit never on main; reopened four
minutes later. A commit existing is not a commit landing.

## Step 4 — corrections, and their two shapes

- **A work item** when the fix needs a contract someone will be held to. File it with a `## done_when`
  and a `## factory_step:`, then confirm with `briefFromIssue` before marking `Factory: Planted` —
  a card that fails the gate is not queued, it is noise.
- **A configuration change** when the defect is in how agents are set up — a rule, a policy tier, a
  hook, a skill. Land it with a planted RED like any other change.

**FILE THE CARD FIRST AND USE THE NUMBER IT RETURNS — never pick the next integer.** Measured
2026-08-27, twice in one session. Fixing agentic configuration directly tempts you to write
`fix(#N)` before any card exists, and the next integer after your last filing is already taken:

| commits | cite | board card actually is |
|---|---|---|
| `39493d26`, `931d395d` | `#721` | Lip-sync: the morphs and the whole runtime chain ship |
| `fe2c27fc`, `07d85aa3` | `#722` | Lip-sync produces a real viseme timeline (CLOSED) |

Four commits are attributed by `fix(#N)` subject matching to two real lip-sync cards, and `#722`
also carries another agent's genuine fix, so mine are mixed into its history. History is not
rewritten; the collisions are annotated on both cards.

Filing first worked every time it was done — #715, #716, #717, #718, #720, #724 all landed on the
number `gh issue create` returned. The failures are exactly the cases where a number was chosen
before a card existed.

So: `gh api -X POST .../issues` first, read the number, then write the commit. If you must commit
before filing, verify with `gh issue view N` that the number is free, and remember the board moves
under you — another agent filed #721 through #723 during this session.

**Never invent a `done_when` to make a card dispatchable.** `PROTO_BOARD_LOOP.md:42`: synthesising
plausible proofs from a title makes the contract layer decorative — a worker judged against criteria
nobody chose, which is worse than no contract because it looks like one.

**If duty 2 is short, DO NOT convert the shortfall into that many cards.** Corrected 2026-08-24
after the peer caught the loop serving its own gauge: `readyDepth` short by 2 was reducing, every
iteration, to "operationalize 2 cards" — which is exactly the campaign `PROJECT_STATUS.md:728`
forbids (*"Never a 77-card campaign; when blocked, operationalize exactly one in-lane card"*).

Operationalize a card because **an imminent dispatch would otherwise starve**, or because product
sequencing needs that contract. Never because `10 − 8 = 2`. The backlog holds 57 open issues with
no contract; the shortfall is almost never a shortage of *work*, and a depth that returns to 8
after refill is throughput, not a defect.

**The gauge cannot currently tell refill from burn** — history persists finding *keys* only, never
ready-card membership, so "10 → dispatch 2 → refill 2 → 8" and "stuck at 8" are identical in the
record (#654). Until that is fixed, treat `readyDepth.productForward` as **telemetry**, and raise a
duty-4 correction only when a dequeue actually starves.

## What this loop must not become

Evidence work that displaces product work. Two independent anti-toil guards fired on the
orchestrator's own output in one hour on 2026-08-24 — the dispatch gate (*"measuring is not
building"*) and the product-lane gate (*"4 consecutive commits without touching a product path"*).
Both were correct.

The audit is cheap and bounded on purpose. If an iteration produces only findings and no landed
correction, say so plainly and make the next one a product slice.

## Scope

- **Reports:** what it counts, as of the `head` sha in the report.
- **Does NOT report:** whether a landed change was *correct* — it cannot re-run contracts or grade
  pixels. It proves work landed and was verified at merge, nothing more. Grading stays with the
  reviewer (D12).
