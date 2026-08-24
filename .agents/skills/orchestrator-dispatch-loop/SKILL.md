---
name: orchestrator-dispatch-loop
description: The CEO-side board loop — plant a RED, probe it, commit, dispatch, verify, integrate, close. Exact signatures and the traps that cost real time. Read before dispatching or harvesting a slice; the worker-side contract is delegated-worker-contract.
when-to-use: dispatch a slice, harvest a worktree, contract-verify-cli, integrate, merge-kill, briefFromIssue, factory_step, done_when, plant a RED, destructive probe, close an issue
---

# Orchestrator dispatch loop

The worker's obligations live in `delegated-worker-contract`. This is the parent's side.

## Order, every tick

**HARVEST first** — a returned dispatch blocks the write root. Then killed/maxTurns recovery. Then start a slice only if its write root is free.

## Selecting the next slice — read the BOARD, not a standing prompt

**Measured 2026-08-24: this was the loop's biggest hole.** A tick ended with "nothing to delegate"
while the board held a **P0 and five P1s**, because the standing prompt's step 4 says *"lowest-id IDLE
effort"* and that was read as the named portfolio (E1–E5). When the portfolio emptied, the loop
concluded the queue was empty. **The portfolio is a subset of the board, never a substitute for it.**

Every tick, after HARVEST and before concluding anything is idle, run:

```bash
pnpm exec tsx tools/openclinxr/openclaw/board-next-cli.ts
```

**DO NOT hand-roll `gh project item-list | python3 …` for this.** That is how the queue broke.

MEASURED 2026-08-24: nine dequeue reads used `--limit 200` against a **614-item** board. The filter
and sort were CORRECT — `status == "Todo"`, required `priority`, sorted by tier. The data never
arrived:

```
P0/P1 Todo on the board .... 17
visible in the first 200 ....  3
invisible ................... 14, INCLUDING BOTH P0s   (#603 at position 597, #610 at 604)
```

`item-list` returns project position order, which here matches insertion, so the newest and most
recently prioritized cards are always LAST. **Any fixed cap below the board's eventual size fails the
same way and moves the cliff rather than removing it.** A ranked list of three looks exactly like a
ranked list of seventeen, so the failure is silent by construction.

The selector asserts `fetched === totalCount` from the server's own count and **refuses with a
non-zero exit** when they differ. A refusal is the correct output of a truncated read; a plausible
wrong pick is not. Live check on the real board: complete read picks P0 `#603`; the same call capped
at 200 returns `REFUSED (incomplete-read) fetched=200/614`.


- **Dequeue order is `priority` then number — P0 → P1 → P2. NOT lowest id.** Lowest-id picks #2 (a P2)
  ahead of the P0 and every P1. The two orderings disagree on the very first item.
- The real board fields are **`priority`** and **`status`** (`Todo`/`Done`). A guessed key name returns
  `(none)` for everything and reads as an empty board — that is your instrument, not the queue.
- `board-cli.ts:25-36` also defines a `Factory` single-select (`Idle → Planted → Dispatched → Landed →
  Graded`, issue #448) for slice lifecycle. It is NOT exposed by `item-list --format json`; read it via
  the GraphQL field id when you need lifecycle rather than priority.
- **`board -- next` does not exist.** `board-conduit` instructs the delegator to run it; `board-cli`
  implements only `slice-open|status|close|review|merge|factory`. Until it exists, the query above IS
  the dequeue.

**A tick may end without a dispatch — but only for a stated reason**, and "the portfolio is empty" is
not one. Legitimate: the write root is held by a live worker; the top card is operator-gated; the top
card is parked. Name the card and the reason in the tick report.

## Signatures — get these wrong and you lose a tick

```ts
dispatch(repoRoot, options)                  // TWO args; not dispatch(options)
briefFromIssue(issue)                        // a BoardIssue OBJECT from `gh issue view --json number,title,body`
integrate({ repoRoot, base, head, slice, contract })
contractForSlice(repoRoot, slice, head)      // MUST be passed to integrate
```

`dispatch()` composes the role's charter via `buildRepoAgentSpawnPrompt` (`dispatch-worker.ts:561`) and **fails closed** on an empty appendix. `role` also resolves the model from `role-harness-policy` — passing a lower model without `modelDowngradeReason` throws (#461). **Never hand-pick a model** — EXCEPT from the operator ladders in the `model-routing` skill,
which are the one standing exception and are NOT enforced by `MODEL_RANK`. Load `model-routing`
before passing `model:`.

## Traps, each paid for

| trap | symptom | fix |
|---|---|---|
| runner script outside the repo | `Top-level await is not supported with the "cjs" output format` | wrap in `async function main(){…} main().catch(…)` |
| `integrate` without `contract` | `merge-kill: contract-not-verified`, refuses | pass `contractForSlice(root, slice, head)` |
| `## factory_step` wrong enum | brief refused: *"no valid factory_step line"* | one of `body_param clothing_consume clothing_generate motion_retarget lip_sync room_generate equipment_generate staging dialogue_runtime instrument`; `instrument` also needs `unblocks: <step>` |
| colon on `done_when` | brief refused | `## factory_step:` HAS a colon, `## done_when` has NONE |
| brief delta posted as a COMMENT | worker never sees it | the dispatcher reads `body` only — edit the body with `--body-file` |
| `exists:` under `.openclinxr/evidence/**` | passes in the worktree, never lands | gitignored; use a tracked path (`tools/openclinxr/evidence/…`) |
| plant not committed before dispatch | merge fails on *untracked working tree files would be overwritten* | commit the RED to main first |
| `board slice-open` on a card that ALREADY exists | **mints a duplicate issue** (#26 -> minted #617) and points `board-<slice>.json` at the new number | `slice-open` is for NEW slices. For an existing card, write `.openclinxr/openclaw/board-<slice>.json` by hand with the real `issueNumber`, then `board close`. The dry-run tell is `issue=n/a` — it is about to CREATE, not attach |
| `board close` arg names | `close requires --slice-id`, then `close requires --body` | it is `--slice-id <id> --body "<text>"` — **not** `--issue`, **not** `--body-file`. Use `--body "$(cat file)"` |

## The worker report — four literals, and three workers dropped the SAME one

`integrate.ts:393` matches these unanchored, and merge-kill refuses with `worker-never-spoke` unless
**all four** appear in a comment on the card:

```
IN-SCOPE:      OUT-OF-SCOPE:      CLAIM:      NOT TESTED:
```

**Measured 2026-08-24: #576, #609 and #608 each shipped correct, contract-green work and each omitted
exactly `OUT-OF-SCOPE:`.** Three resume cycles for one missing heading. That is a brief-template
defect, not three worker defects — so put this in every brief, verbatim:

> Your report MUST be ONE comment on the card containing all four of these literals, each at LINE
> START with its trailing colon: `IN-SCOPE:`, `OUT-OF-SCOPE:`, `CLAIM:`, `NOT TESTED:`.
> **`OUT-OF-SCOPE:` is the one workers forget.** If you genuinely touched nothing outside the slice,
> write the heading and say so — do not omit it. Do not decorate the literal: one worker wrote
> `OUT-OF-SCOPE (seen, not fixed):` and the parenthetical broke the exact match.

**You cannot repair this yourself.** A comment of YOURS carrying those markers satisfies the mute gate
on the worker's behalf — the laundering the check exists to prevent. Resume the worker for a
report-only turn instead, and say plainly that the code is fine and only the heading is missing.

**Check before integrating, not after:**

```bash
gh issue view <N> --json comments -q '.comments[-1].body' > /tmp/r.txt
for m in 'IN-SCOPE:' 'OUT-OF-SCOPE:' 'CLAIM:' 'NOT TESTED:'; do printf '%-14s %s\n' "$m" "$(grep -ci -- "$m" /tmp/r.txt)"; done
```

**Ask for two things beyond the gate** — they cost the worker nothing and have twice been worth more
than the fix. On #609 they produced *"patient_robert_hayes_v1 (male) derives gender_presentation:
adult_female_parent"*; on #608, *"the chain bakes exactly ONE utterance per case"*, which named the
next slice:

1. the one question whose answer you cannot infer from a green contract, phrased so that the
   unwelcome answer is explicitly acceptable;
2. any out-of-scope wrongness seen and not fixed — **name the object and what it looks like**, never a
   category word like "deformed".

## Planting a RED — clause hygiene the probe will otherwise teach you

- **A vacuity guard cannot live inside the `it.fails` it guards.** An `it.fails` is satisfied by ANY failure including the guard's own throw. Put length/population guards in a plain `it`.
- **A guard must not forbid the fix.** A clause asserting "the collision still exists" fails on every genuine repair.
- **Substring checks are prefix-matchable.** `includes("function requireRows")` still matched after a rename to `requireRowsDISABLED`. Assert the declaration with a regex AND that it is invoked.
- **`new Set([null, a, b]).size` counts the null.** Reject nulls before testing distinctness.
- **Floating point defeats a boundary.** `1.6669 - 1.6269 > 0.04` is TRUE. Derive bounds with headroom, from a constant already in the file.
- **Declare REDs vs NETS (#227).** When the deliverable is one artifact, every clause reading it is red on a clean tree — only a clause reading the TREE can be a true net. A clause that fails today is a RED even if you meant it as a net.

## Destructive probe — mandatory, and confirm two things

Run the honest treatment AND each cheap fix. For every treatment confirm **(a) the substitution matched** and **(b) the file still parses** — `Tests no tests` means it did not, and a grep for the inserted string will still succeed while the file is broken. Restore from a `.bak` and assert `git diff --stat` is 0 lines.

If the honest treatment does not flip the RED, **do not dispatch** — that is a brief whose proof cannot pass.

## Harvest

```bash
pnpm exec tsx tools/openclinxr/openclaw/contract-verify-cli.ts --slice issue-N --tree <worktree>
```

Then read the diff yourself. Check specifically that the worker **flipped `it.fails` → `it`** and did not weaken an assertion, and that any `## FIXED` block was appended rather than the planted header rewritten. Land ONE at a time. Grade pixels yourself for any appearance claim. Close with a CLAIM and a NOT TESTED line.

## Never clear the evidence directory of a slice with `exists:` proofs

`git clean -fdx .openclinxr/evidence` destroys the worker's deliverables and the pre-fix artifact, which cannot be honestly regenerated. Clear only the module's cache subdirectory, and run `contract-verify-cli` BEFORE any cache-cleared re-run.
