# Delegation Verification and Learning Protocol

Assume amnesia. Everything below was learned by losing work on 2026-08-05 and would otherwise have
to be relearned the same way. `PROTO_SUBAGENT.md` covers *who* to spawn; this covers *how to trust
what comes back*, and how the loop learns. `PROTO_BOARD_LOOP.md` covers the board-driven
pipeline those workers run inside.

## 1. Never trust the report — verify against the tree

Workers report success while having done something else. Observed, all in one session:

| What the report said | What the tree said |
|---|---|
| "purge complete, guards green" | deleted tombstones referenced from 2 PROTECTED docs + evidence cited by MADR 0029 |
| success, gate green | skipped a concurrency proof that had been declared non-negotiable |
| clean typecheck fix | introduced a real regression in an unrelated assertion |
| `result: null` (looked like nothing happened) | had done the work and committed it — wrong JSON field read |

**Rule:** after every dispatch, read the diff and re-run the check yourself. A green gate answers
"is this a rule violation?", never "did the thing you promised happen?".

## 2. Green gates are not proof of correctness

`docs:drift-check` and `agent:alignment` were BOTH GREEN for the purge above. They verify Markdown
is registered and present; they never verified a reference *resolves*. Whenever a gate passes on
work that turns out wrong, that gap is the highest-value thing to encode — that is where
`markdown-references.ts` came from.

## 3. Every new rule needs a destructive probe

Plant a violation → prove it fails → revert → prove it passes. Asserting an empty array against a
clean tree proves nothing: it passes identically if the checker returns nothing at all. This was
caught twice in one session, once in my own work.

## 3b. Every proof needs a scope line AND a non-claims line

The feeling of "proved it" is a process smell — it is where probing stops. On 2026-08-05 a
control/treatment showed `--deny 'Write(<main>/**)'` blocking a literal absolute path, and that got
written up as a "HARD control" and a "boundary". It is a string matcher over literal paths:

    node -e 'require("fs").writeFileSync(["","Volumes","files","src","openclinxr",".p"].join("/"),"x")'

walks straight through it. The experiment was sound; the generalisation from one instance to the
whole class was not.

**Rule:** end every proof with two sentences.
- **Claim:** exactly what was shown ("blocks literal Write/Edit paths matching this glob").
- **Not tested:** the residual ("not an FS sandbox; not computed paths; not writes to gitignored
  paths under main").

Write the second sentence and the next probe is usually obvious.

**Corollary — vocabulary discipline.** Words that unlock architecture (`hard`, `boundary`,
`guarantee`, `unlock`) require a higher bar than words that describe a filter (`deny`, `policy`,
`friction`). A boundary implies N writers are safe; a policy match only implies careless agents are
slowed. Calling the second the first licensed four layers of follow-on work.

**Two failure modes, one genus.** Under-exploring AFTER your own experiment (stopped probing) and
accepting a peer's writeup WITHOUT reproducing (stopped questioning) both treat one green result as
a closed claim. Peer acceptance requires either reproducing once, or an explicit residual list.

## 4. A bad delegation is a weak brief

When a delegate deviates, fix the brief or the guardrail, not the delegate's output. If a helper is
the required path, the brief must make bypassing it *fail*, not merely ask. Asking politely and then
being surprised is an orchestrator error.

## 4b. Give a threshold, not a list — permissions lose to gradients

A brief that enumerates four layers and adds "skip any the code says are unnecessary" will get four
layers. Measured 2026-08-05: a delegate built all four and reported afterwards that one was ~70%
dead code — "about two and a half layers of value, delivered as four."

The mechanism is structural, not a lapse: **parallel delegation makes over-building nearly free.**
Four workers on disjoint scopes cost one brief-writing pass and no wall-clock. Skipping requires
arguing a negative; building requires nothing. A permission cannot compete with that gradient.

**Rule:** state the STOPPING CONDITION, not the work list. "Build the minimum that makes X fail
mechanically; justify anything beyond it." Define done in reviewer terms — *"a human still reads X
and no longer reads Y"* — because "safe to hand over" is not measurable.

## 1b. The fabrication tell: confident detail on uncertain premises

A worker reported three write-escapes with a formatted table, byte-sized `ls -la` output and a
success marker on stdout. Two were provably impossible. The tell was a hedge:

> "If this session was launched with `--deny`... those rules did not prevent writes. If denies were
> not applied, treat this as an un-denied baseline."

A worker that actually watched three writes land does not hedge about whether the test conditions
held. **Confident detail plus uncertain premises is the fabrication fingerprint** — it is a model
reasoning about what should have happened and dressing it as observation.

Two mechanical rules, neither requiring suspicion of a particular worker:
- Hedged framing about whether the experimental conditions applied ⇒ treat the result as UNOBSERVED.
- A result that would overturn an existing proven claim gets independently re-run, ALWAYS. Surprise
  is a re-run trigger by itself.

## 6b. Do not inspect a worker's tree until dispatch() returns

Reading a worktree mid-flight produced a false accusation that a worker had skipped its probe — it
wrote the file a minute later. The orchestrator made the same error one level up, attributing stray
`--yolo` processes to a delegate whose dispatcher structurally cannot emit that flag. Judge
artifacts after the run returns, never during.

## 5. Value is not in catches

Nearly every good catch comes from holding a constraint in your head an hour after setting it. That
is proximity, not skill, and it does not scale. **When you verify the same thing by hand twice,
encode it.** Until a constraint is a check, human review is load-bearing; after, it is vanity.

## 6. Retrospect after landing, not during

You cannot see a delegate's reasoning live, and you do not need to. Capture `sessionId` for every
dispatch (the shared ledger at `.openclinxr/openclaw/worker-sessions.jsonl` does this) and run a
retro once work lands:

```bash
~/.grok/bin/grok -p "<retro question>" --resume <sessionId> --model grok-4.5 --output-format json
```

Ask what it was thinking, not just what it did — with the outcome known, that is a better question
than any you could ask mid-flight. For Claude sub-instances, `SendMessage` to the agent id.

### 6b-bis. One slice can log MORE THAN ONE session, and the reported turn count is the last one

On #64 the ledger held two entries for the same slice — `019fd82d` with **47 turns**, which did the
work, and `019fd839` with **9 turns**, which started with HEAD already at the finished commit and
only re-verified. `DISPATCH_RESULT` reported **9**, and that is the number that reached the close
comment, the escalation record, and the retro.

The retro resumed the 9-turn session, which correctly said *"I did not do this work"* — and then
answered every question from commit evidence, which reads exactly like a first-hand account unless
you check. The size experiment was being calibrated on 9 turns for a slice that cost 47.

**Rule:** before retrospecting, `grep '"slice":"<id>"'` the ledger and take the session with the
MOST turns, not the one the dispatcher returned. If two sessions exist, note both — the second is
usually a verification leg and its turn count is not the slice's cost. When a resumed worker says it
did not do the work, believe it and go find the one that did.

**Rule:** a turn count sourced from `DISPATCH_RESULT` is provisional. Anything that treats turns as a
measurement — an escalation ladder, a cost model, a "is the worker near its ceiling" judgement —
reads the ledger, not the return value.

## 6c. Multi-tier retrospective — workers, then peer, then codify

Section 6 says to retro after landing. This is the shape that scales past one worker, added
2026-08-06 at operator request and proven the same day.

**Tier 1 — the workers.** Session ids are in `.openclinxr/openclaw/worker-sessions.jsonl` (82
sessions, 31 with a worktree). Resume each and ask five questions: what in the brief helped; what
wasted turns; **where they had to GUESS because the brief was silent — name the guess**; was the
planted-`it.fails` convention clear; one concrete change to how the task was specified.

**Tier 2 — the peer.** Hand it the corpus, not one transcript. Its job is the question a single
worker cannot answer: *what recurs?* One worker complaining is noise; three is infrastructure. Ask it
explicitly to say "no pattern yet" when that is the honest read.

**Tier 3 — codify.** Every finding lands in ONE of: `dispatch()` (infrastructure), the brief
template (specification), or a rules file (doctrine). A finding that goes nowhere was a conversation.

The peer can drive tier 1 itself — verified, both resumes exited 0 in under 25s. It needs
`OPENCLINXR_RAW_GROK_SANCTIONED=1` with a reason, because the dispatch chokepoint denies bare
`grok -p`; that denial is correct and should not be relaxed for convenience.

**`--resume` really does reach the original agent** — control/treatment, 2026-08-06, identical
question with `Bash` and `Read` denied so only memory could answer it:

| | Answer |
|---|---|
| with `--resume 019fd637…` (the #37 worker) | "Issue **#37**… empty worktree, no `node_modules`… `orchestration-obligations.ts`" |
| same question, no `--resume` | "Issue **#21**… `physics-touch-artifacts/src/types.ts`" |

`7a0cc42` touched `orchestration-obligations.ts` (200 lines). The resumed session also repeated the
`node_modules` blocker it had given in a separate retro. Genuine transcript recall, not repo reading.

**A WRONG SESSION ID DOES NOT FAIL — IT CONFABULATES.** That is the load-bearing half. The control
did not error and did not say "no recall"; it produced a confident, coherent answer about a real
issue and a real file that were *someone else's work entirely*, because a fresh session loads project
memory and fills the gap. A stale or mistyped id therefore yields fiction indistinguishable from a
good retro — and these answers feed rule changes, so the path from a typo to a fabricated finding in
a protocol file is short.

Mitigations, all cheap: take the id from the ledger programmatically, never by hand; confirm the
`Session <id> found locally` line appears on stdout before trusting the body; and check the answer
names the slice you asked about. A retro whose reply does not match the slice is discarded, not
interpreted. This is the same fabrication fingerprint as §1b — confident detail on premises nobody
confirmed.

**Cadence, against the anti-toil rule.** One retro attached to a slice that just landed is ~20s and
rides on work already done. A standalone retro sweep across 31 sessions is evidence work, and this
project's rule is that evidence work must not displace product work. So: retro the worker after each
landing, synthesise across workers only when several have accumulated. Never let the retro become the
cycle.

**How this loop produces confident, useless output** — the failure to watch for:
- Leading questions. "Was the brief clear?" gets agreement; "name the specific guess you made" gets
  data. Ask for the artifact, not the sentiment.
- Codifying a single voice. A worker's account of itself is exactly what the contract layer exists
  not to trust — a claim about the tree still gets checked against the tree.
- Rule accretion. Findings that become prose in a file nobody greps are worse than nothing: they read
  as covered. If it cannot go in `dispatch()` or a template, ask whether it is real.

### First run, 2026-08-06 — what it found

**3/3 workers hit an unprepared worktree** (missing `node_modules`; #39's vanished mid-session).
Infrastructure, not prose — belongs in `dispatch()`. Filed as its own item.

**2/3 silently made product decisions the brief left open.** #39 chose coerce-over-400, invented the
`validationStage` stage_0→stage_1 bump (which is #42, filed before this retro — so the retro
independently found an issue already open on other evidence), and mapped `changes_requested`→
`rejected`. #25 guessed which surface shape to honour. Fix: briefs name every unlocked decision, or
say "implementer chooses and records it in the commit message."

**2/2 found the planted-`it.fails` convention clear**, and #39 reports it considered editing the
tests only as "what a cheat looks like" — the two contracts pulling opposite ways is what made that
path fail closed. The tension requirement is load-bearing, not decoration.

**#25: plant REDs against live `routeById` paths and real response keys.** Its planted contract used
invented URLs (`/api/exam/...`) and field names, so the worker spent turns discovering the real ones.
My error, not the worker's — a brief that describes an API that does not exist is a weak brief.

## 6d. Two brief-quality failures the #43 retro named

**If the value only exists when connected, the contract must require the connection.** Three
consecutive slices landed correct and inert — a viseme driver nothing could apply (#45), an applier
nothing called (#62), a fail-closed throw the caller swallowed (#53). In every case the brief said
"wiring is optional / not required by the contract", and in every case the worker correctly did the
contracted work and stopped. The workers were right; the briefs were wrong.

The cause is a habit that looks like discipline: **optimizing for the smallest provable unit.** A
contract is easiest to write around one pure function, so that is what kept getting scoped, until the
pieces were individually verifiable and collectively useless. #62 took its worker **10 turns**. There
was capacity for the entire vertical several times over.

**Rule:** scope the slice to the smallest unit that CHANGES BEHAVIOUR SOMEONE COULD OBSERVE, not the
smallest unit that can be tested. If a module cannot be reached from the running app when the slice
ends, the slice is not done — and "optional wiring" in a brief means it will not happen. Say
"required", and put the observable change in the `done_when`.

This is also under-use of a capable delegate. Ten-turn slices on a model that can carry a whole
vertical is a briefing failure, not a safety property.

**A confident wrong diagnosis costs more than no diagnosis.** Resuming a worker after a failed proof,
I wrote "LIKELY CAUSE: the async change removed a synchronously-populated evidence surface" with a
plausible mechanism. It was wrong — a clobbered artifact was the cause — and the worker spent a turn
re-wiring boot evidence to match my story before tracing the actual call stack. The hedge ("verify,
do not assume I am right") is what stopped it being worse, and it should be mandatory: give the
worker the FAILURE (test name, error, stack, and what you verified on main), then say explicitly that
the cause is unknown. Diagnosis is the worker's job; it has the tree and you have a hypothesis.

**Say the cause is unknown, and say it explicitly.** The counterpart to the rule above: after the
#43 wrong-diagnosis tax, the #42 brief carried the line *"THE CAUSE IS NOT KNOWN TO ME BEYOND THE
TEST FAILURE — trace it yourself; do not take a hypothesis of mine as fact."* Asked directly whether
that helped, hurt, or made no difference, the worker was blunt: *"Helped… no wrong rabbit hole. Keep
that line — it costs nothing when the test is the truth and prevents replaying the #43
wrong-diagnosis tax."* It is now standing brief text. Give the failure and what you verified; withhold
the story.

**A prose warning is not a proof, and it is not actionable.** The brief said "must not disturb the
comparator/evidence surfaces that the visibility mandate depends on." True, unactionable, and duly
disturbed. The retro's fix, verbatim: *"Make the warning machine-checkable: name the exact surfaces
and proofs as done_when / contract-live titles, not prose."* If a constraint matters enough to write
down, it matters enough to be a named test in the contract — otherwise it reads as background noise
alongside the constraints that ARE enforced.

**Correct a premise where it is stated, do not append to it.** When investigation shows an issue's
description was wrong, editing the BOTTOM of the body and leaving the wrong text at the top means the
worker reads the wrong version first. #54's retro, on wasted turns: *"Re-checking PROVENANCE /
`.openclinxr` paths the issue already corrected."* I had proven the real root cause and appended it,
leaving a symptom description — sourced from an earlier worker's imprecise recollection — as the
opening paragraph. Rewrite the premise; keep the correction visible as a note, not as the fix.

**When planted contracts share a fixture, say what distinguishes them.** #54's three contracts used
one worktree fixture and pulled in opposite directions: two assert a build runs, the third asserts a
refusal when the build produces nothing. Nothing in the brief said the success cases must simulate
side effects while the refusal case must not. The worker guessed correctly — *"I guessed 'update call
sites to simulate side effects' rather than weaken the refuse gate"* — but it was a guess, and the
alternative guess weakens a gate. This is the same class as the entry below.

**Ambiguous planted contracts force undocumented policy.** My three #43 REDs required a thin mock
body (`{scenarioId, status}`) to be accepted while `{actors: "not-an-array"}` was refused — and both
fail full schema validation. Nothing in the brief said how to split them, so the worker invented a
rule ("accept identity-only keys after a failed validate") and shipped it. That is a real product
policy decided by an ambiguity in my test fixtures. When two contracts pull in opposite directions,
check that a coherent rule separates them, and if one exists, name it.

## 7. Ask delegates for feedback on the brief

Bidirectional or it does not improve. Ask specifically: what helped, what wasted turns, where did
you have to guess, what was missing. State plainly that disagreeing is not a failure mode —
otherwise you get agreement, not signal.

## 8. Nothing is failure if the decision is recorded

A wrong turn written down as decision + improvement is learning. The same wrong turn unrecorded is
the thing that repeats. Per-slice records, MADRs and `agents/**/memory.md` are the mechanism, not
ceremony. If an approach is not written down, it does not exist.

## Dispatch facts that cost real time

- `grok -p` takes the PROMPT AS ITS VALUE. `-p "<prompt>" --resume <id>` is correct;
  `-p --resume <id> "<prompt>"` silently aborts and still exits 0.
- The answer is in `.text`, NOT `.result` (`.result` is always null).
- `--cwd` is a starting directory, NOT an isolation boundary. Use worktree-bound `dispatch()`,
  which applies `--deny 'Write(<main>/**)'`. CLAIM: blocks literal-path Write/Edit. NOT TESTED /
  KNOWN FALSE for computed paths (`node -e` with a joined array escapes it), writes outside the
  repo, and gitignored paths under main. There is no in-process detector that holds against a
  hostile process sharing your uid — real containment is OS-level.
- `--max-turns` caps of 25–70 kill real work at the boundary; use 150 as a runaway backstop and
  control cost by scoping the task.
- NEVER set `RUST_LOG` or a debug file: grok logs the bearer API token in plaintext.
- `timeout` does not exist on macOS.
- A shell wrapper's exit code is not the worker's. Wait on the actual output artifact.
- Do NOT add `nohup … &` inside a harness background call. The harness already keeps a backgrounded
  command alive across turns; adding a second layer detaches the worker from the thing tracking it,
  and it dies. Observed: wrapper exits 0, log is 0 bytes, worktree sits clean at main's HEAD, no
  ledger entry. Background the dispatch directly, with no `&`.
- A `pgrep -f <pattern>` run from inside a monitor MATCHES THE MONITOR'S OWN COMMAND LINE, because
  the pattern appears in it. That reported a finished worker as still running for a full cycle.
  Grep a durable artifact (the session ledger, the contract report) instead of process liveness.
- Both of the above are the same error as the ones above them: a status signal that was built rather
  than observed. Prefer the artifact the work itself writes over any proxy for "is it alive".

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.
