---
name: supervisor-loop
description: One iteration of the four-duty supervisor loop — review agentic logs for non-self-correcting issues, keep >=10 prioritized product-forward ready cards, re-verify work reported done, and issue corrections. Load at the start of every supervisor iteration, before reading any log by hand.
---

# Supervisor loop — one iteration

**Operator directive, 2026-08-24.** Each iteration does four things:

1. Review agentic logs for issues that need addressing **and are not self-correcting**
2. Ensure at least **10 prioritized, ready items that move the PRODUCT forward substantively**
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
| 2 | `readyDepth.productForward` | ten **instrument** cards "satisfying" a product floor |
| 3 | `doneClaims[].ok` | a commit that *cites* an issue read as proof the work *landed* |

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

**Never invent a `done_when` to make a card dispatchable.** `PROTO_BOARD_LOOP.md:42`: synthesising
plausible proofs from a title makes the contract layer decorative — a worker judged against criteria
nobody chose, which is worse than no contract because it looks like one.

**If duty 2 is short, the correction is operationalizing real product cards** — not filing new ones
to make a number go up. The backlog already holds 55 open issues with no contract (#632); the
shortfall is almost never a shortage of *work*.

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
