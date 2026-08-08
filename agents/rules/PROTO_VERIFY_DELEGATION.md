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

## 6e. Two instruments agreeing is not correctness

#59 built a fail-closed geometry self-check: a NodeIO scene-graph AABB on one side, a three.js
scene-graph AABB on the other, refuse to write images when they disagree past a relative tolerance.
It works, it is genuinely independent (different parser, different process, no shared helper), and it
agreed on all seven shipped humanoids at ~1e-4 relative error.

Six of those seven were rendering head-down.

Both sides measure a world mesh AABB, and an inverted figure is exactly as tall as an upright one. The
check answers "is the renderer drawing the file?", which is the question it was built for, and it
answers it correctly. It cannot answer "is the file right", and nothing in its output said so.

**Rule:** when a check compares two measurements, state what the SHARED METRIC cannot see, next to
the check. Independence of implementation does not buy independence of blindness — two correct
instruments measuring the same quantity fail together, silently, and their agreement reads as
confirmation. The worker named this residual unprompted when asked ("both deliberately measure world
mesh AABB — if that metric is blind, both stay green together"); that sentence belongs in the module,
not only in a retro.

Corollary for the orchestrator: a green self-check is not a reason to skip looking. In this case the
pixels were the only instrument that could see it, for the second time (#56 was the first).

## 6f. Snapshot the calibration BEFORE you tune the threshold

The #59 worker changed the probe-side measurement mid-slice, after it refused an asset the slice
needed to render. Asked directly whether that was a real fix or moving the goalposts, it answered
honestly and precisely: *"I changed it because it was refusing assets I needed to render, then
verified the comparison was the wrong one for that claim."* The change was right — raw untransformed
vertices versus world-matrix bounds is a false-positive class, not a renderer defect — but the only
way to know that was to ask, and the answer could as easily have gone the other way.

Its own proposed fix is the right mechanism and is now standing brief text:

> Before changing a probe or a tolerance, write the FIRST full pass to a calibration artifact —
> per-subject measurement from both sides, the relative error, and the pass/refuse decision. Any
> later change to the metric or the threshold must cite which rows flipped and why.

That turns "did you move the goalposts?" from a question about someone's account of themselves into a
diff. Applies to any gate with a tunable number in it, not just this one.

## 6g. A failing gate is a resume, not a rollback — and hand over the failure, not a story

#69 came back with one proof failing on the orchestrator's re-run while the worker's own artifacts
existed and were good. The temptation is to read that as the worker having got lucky. It was the
opposite: the harness sets `FORCE_COLOR`, Vite 8 paints its ready line as
`\x1b[1mLocal\x1b[22m:\x1b[32m   http://…`, and a `Local:\s+https?://` matcher returns null. The
server started in 125 ms and the helper waited three minutes for a line that was already there.

**The tail in the error message looked perfect**, because a terminal renders the escapes as colour.
That is the trap: the failure output displayed exactly the string the matcher claimed was missing.

Two things this settles:

**A gate that fails on re-run is a resume, not a verdict on the worker.** I handed back the failure —
the command, the error, the tail, and the observation that the Local line was present — plus an
explicit "THE CAUSE IS NOT KNOWN TO ME BEYOND THAT OUTPUT". The worker found ANSI in under an hour
and fixed it in the shared helper rather than working around it in its own script. Per the size
experiment's own criteria, an environment blocker means criterion 3 fails and the rung does not roll
back.

**Withholding the story is what made it fast.** I had three candidate causes in mind and named none
of them; I listed what I had NOT determined instead. It went straight to the matcher. The one
hypothesis I did offer — that this same timeout explained an earlier slice producing a schematic —
it refused, correctly: *"A timeout throws; it does not write a floor-plan PNG."* Of the four
hypotheses available, the only one I voiced was the wrong one, which is the argument for the rule
rather than against it.

**When a shared helper is the suspect, say so and say what else it touches.** `spawnPortlessDevServer`
has six-plus callers. The brief named that, and the fix landed in the helper with unit tests for both
the plain and coloured shapes — the right place — rather than as a local workaround that would have
left the same bug waiting for the next capture script.

## 6h. A brief with no slot for out-of-scope wrongness gets silence

Asked directly whether it had noticed that the actors in its own captures were embedded in the floor,
the #69 worker was unambiguous:

> "Noticed. Treated as out of scope. Stayed silent. Brief subject was 'are these different rooms',
> not actor placement. That is **brief-driven filtering**, not failure to see. Without a slot for
> 'out-of-scope wrongness I still saw', workers will optimise the grade and eat the rest.
> Silence is not agreement that the scene is fine — it was compliance with the stated subject."

That is correct behaviour against the brief I wrote, and the cost was real: the defect surfaced hours
later because it happened to catch my eye in an image I opened for a different reason. A worker had
already seen it and had no place to put it.

**Rule:** every brief whose output includes something visual asks for two lines in the report — the
in-scope verdict, and **any out-of-scope wrongness the worker saw and is not fixing**. Naming it
explicitly as not-their-problem is what makes it safe to report; without that, mentioning it reads
like scope creep or like criticising the work they were told to do.

This generalises past visuals. A tightly-scoped brief buys focus by narrowing what counts, and
everything outside the frame becomes invisible to the report even when it was visible to the worker.
The slot costs one line and recovers observations that are otherwise thrown away.

## 6i. One green does not make a capture reproducible — re-run it in the hostile environment

#69's capture worked for the worker at 16:13 and failed for me at 16:20 in the same worktree. The
cause was ANSI in Vite's ready line under `FORCE_COLOR`, and the worker's own read of why its first
run passed is the useful part:

> "I did not force `FORCE_COLOR=1` on that run... if colour was off or only partially applied, the
> naive matcher can pass **by luck**. My 'it ran' was real product evidence once, and lucky CI
> evidence for the helper."

**Rule, now standing brief text for any slice whose `done_when` includes a live capture command:**
after the first successful run, re-run it **twice more with `FORCE_COLOR=1`** (or whatever the
hostile environment flag is for the tool in question), and require both to regenerate the artifacts.
One green under ambient harness conditions is not reproducible; it is one sample.

The worker picked this as its own highest-value brief change, over the more obvious one, on the
grounds that it would have caught the bug in the first session and removed the need for a resume.

## 6j. Refinement to "withhold the story": unranked candidates are free, a preferred one is not

§6g says hand over the failure rather than a hypothesis. The #69 worker sharpened it, and the
distinction is worth keeping:

> "Naming your candidates as a flat checklist would have helped slightly; **ranking** them would have
> hurt. 'Check ANSI vs Vite 8 format vs httpReadyProbe vs spawn — I have not distinguished' is free
> coverage. 'LIKELY ANSI' or 'LIKELY probe' would have pulled a turn of story-fitting."

So: list what you have not ruled out, unordered, and say plainly that you have not distinguished
between them. Do not say which one you believe. The cost is not in mentioning a possibility — it is
in supplying a rank the worker then has to disprove.

## 6k. When a slice needs a live measurement, name the probe that already works

#72's worker spent roughly a third of its session building a measurement harness before it made a
single product edit: `playwright` would not resolve from `/tmp`; a TS-transformed `page.evaluate`
died on `__name is not defined`; a string arrow returned `undefined` because it was an expression
rather than an invocation; a string IIFE finally produced numbers. After that the diagnosis, the fix,
the flips and three captures were "a straight line".

There was already a proven `page.evaluate` in the room-capture script it could have extended.

**Rule:** when a brief asks for a live measurement, point at the existing probe and require the dump
to land as a durable artifact — a JSON path under `.openclinxr/evidence/…` with fixed field names —
**before any product edit**. Three things follow: the worker extends something that works instead of
inventing a fourth script, the FIXED header is copy-paste from the artifact rather than reconstructed
from memory, and the orchestrator can re-run the same probe without trusting the narrative.

The measurement instruction itself was worth keeping. Asked whether it would have found the cause
anyway, the worker was clear: *"Without the measure instruction I would likely have re-read constants
or chased mismatch longer. The instruction's value is: world numbers that disagree with the tables
name which axis is lying."*

## 6l. Unranked candidates, continued — keep them SHORT, and say they may all be wrong

Second reading of the §6j rule, from the worker that benefited from it. Verdict: **keep it, do not
soften** — it stopped the slice from opening with an attempt to prove the candidate that had the most
words, and refuting one was explicitly allowed rather than a failure.

Two corrections, both from what actually happened:

**The answer was not on the list.** The cause was a framing pass rewriting slot Y after placement had
been resolved, while a legacy offset still applied — an interaction between two systems, not any of
the four single-cause candidates offered. The list worked as an **anti-favourite-bias tool**, not as a
shortlist containing the answer. Briefs must say so: *candidates may all be wrong; measure the running
scene; name the interaction you actually find even if it was not listed.*

**Length is a rank.** The worker's own words: *"Bundle-mismatch was longer than the actual cause. Even
unranked, length still pulled attention until the measure killed it."* A candidate that needs more
explaining gets more words and therefore reads as more considered. Keep every candidate to one line;
if one genuinely needs a paragraph, that paragraph belongs somewhere other than the candidate list.

## 6m. "Deformed" is not an observation — name the region and what it looks like

The out-of-scope slot from §6h worked on its first outing: the #72 worker saw the torn shoulders and
mentioned them. It reported *"anatomical deformation"*, which is why I had to find the specifics
myself by opening the image anyway.

Its own read: *"The brief's slot worked as permission; I still under-used it. The rule is fine; the
specificity of the out-of-scope line is the bug."*

**Rule:** an out-of-scope visual observation names **the body part or object, and what it looks
like** — "torn jagged fragments where the garment meets the neck and deltoid, plus floating shards
near the chest", not "deformation". A category word costs the reader the whole trip.

## 6n. Numbers in a planted fixture become the specification

#46's anti-cheat contract carried an illustrative "genuine difference" example so the test could show
what distinguishable looks like:

```ts
const cardigan: GarmentFeatures = { vertexCount: 704, hasAnteriorOpening: true,
                                    sleeveLengthClass: "long", hemHeightRatio: 0.31 };
```

I invented `0.31`. It was a plausible-looking ratio in a fixture whose only job was to be different
from the other fixture. The worker set the cardigan's hem to `body_height * 0.31`, and said so
plainly when asked where it had guessed:

> "Cardigan `bot_y` = `body_height * 0.31` — **guess, steered by the planted anti-cheat fixture's
> `hemHeightRatio: 0.31`** — not measured from clothing... **The planted table's 0.31 / long /
> opening example was a stronger magnet than real garments.**"

The contract never asked for that number. It was scenery, and it became the product's dimensions.

**Rule:** any number in a planted fixture is read as a target. Either use values that are obviously
not specifications (`999`, `0.5`, round numbers no one would ship), or state in the header that the
fixture's values are illustrative and the real ones must come from the domain. The second is better
when the fixture has to look realistic to be a good test — but it has to be said, because silence
reads as endorsement.

This generalises past dimensions to any constant a fixture happens to contain: thresholds, counts,
tolerances, ids. A planted test is the most closely read document in a slice.

## 6o. "Do not re-report X" suppresses everything NEAR X

§6h added a slot for out-of-scope observations, and §6m required them to name the region. #46's brief
had both, plus one more line: *"Already known and filed as #73 — do not re-report that one."*

The worker saw the off-the-shoulder necklines and reported them as "off-shoulder barrel / armpit
gap". It did not report the pale patch on the faces at all. Asked why:

> "Brief said report out-of-scope wrongness *and* 'do not re-report #73'. I treated shoulder-area
> defects as adjacent to #73 and compressed them... That is my under-specification, not your read
> error — you did not miss a full dual-asset collarbone report because I never wrote one."

The exclusion did not just remove #73 from the report. It cast a shadow over everything in the same
neighbourhood — the shoulders, and then the face, both of which the worker had seen.

**Rule:** scope an exclusion to the exact artifact, not to a region: *"the neck/deltoid tearing is
filed as #73 — report anything else you see, including on the same body part, and do not compress it
because it seems related."* Better still, drop the exclusion. A duplicate observation costs one line;
a suppressed one cost this project a full cycle, because the neckline defect had a named constant
sitting in the code the whole time and nobody wrote it down until the retro.

## 6p. A contract that removes something must say what replaces it

#73 required "no painted clothing on a torso that wears a real garment". It passed — 3728 and 3636
painted triangles went to zero, and the runtime had already refused those slots as unusable. It was
architecturally right and the renders got worse: the parent came out topless under an open cardigan,
the nurse with bare thighs where painted trousers had been.

The paint was covering something. The contract said remove it and never said the replacement had to
cover the same area. A closed garment happens to; an open one cannot, by construction.

**Rule:** when a contract deletes a mechanism, it states what takes over its job and asserts the job
is still done. "No X where Y exists" needs a companion: "and Y covers what X covered." The deletion
half is easy to write and easy to verify, which is exactly why it lands alone.

The tell in advance: if you can describe the thing being removed as *"a bad implementation of a real
requirement"*, the requirement outlives the implementation and the contract needs a second clause.

## 6q. An unambiguous contract beats "this will make the product worse" — so ask for the warning

The most useful answer any retro has produced, to a question asked directly. #73's contract required
"no painted clothing on a torso wearing a real garment". It passed, and left the parent topless under
an open cardigan. Asked whether it had seen that coming:

> "I **did** notice, and treated it as intentional... I framed it as 'open front is the #46
> distinguisher', not as 'product got worse'. I did not put in the report a clear line like *this
> contract will make the figures look less dressed*. I shipped because done_when demanded it, the
> brief said stop painting where geometry owns the silhouette, and removing torso paint when a
> garment exists was the happy path of the plant.
>
> **Contract won by default over 'looks worse'.**"

That is correct behaviour. A worker that second-guesses an unambiguous contract is a worker that
cannot be relied on to satisfy one, and the whole pipeline rests on contracts being binding. The
defect is that nothing in the brief invited the observation, so it stayed in the worker's head.

**Rule, now standing brief text:**

> If satisfying a contract in this brief will make the product visibly worse than before, say so in
> your report — and then satisfy it anyway. Naming it is not disobedience and will not be read as
> refusing the work.

Both halves matter. Without "satisfy it anyway" the instruction competes with the contract and makes
the contract soft. Without "will not be read as refusing" it reads as an invitation to argue, which
workers correctly decline.

The tell that you need this line: the contract is a DELETION, or a constraint whose satisfaction is
achievable by removing something. See §6p — those are the same class from the other side.

## 6r. Name the regeneration path, or a worker will find the one that produces stubs

#73's largest turn sink was not the product edit. Its own account:

> "**Regenerate path thrash** — full `orchestrate_character` without `anny` → stub GLBs (~0.8 MB) →
> restore real Anny bases from git → re-run Blender-only twice... That loop cost more than the
> product edits."

The pipeline has two regeneration entry points. One re-bakes from existing real base meshes; the
other runs the full character orchestration, which silently falls back to ~0.8 MB stub geometry when
the `anny` package is absent — and it is absent in a worktree. Nothing stops a worker taking the
wrong one, and the wrong one looks like it worked.

**Rule:** an asset brief names the regeneration command it expects and says what the other one does.
"Blender-only re-bake on the existing bases under `generated-humanoids/`; do NOT run full
orchestrate — without the `anny` package it silently produces ~0.8 MB stubs that pass file checks."

This is the same shape as §6k (name the probe that already works). When a repo has two ways to do
something and one of them fails quietly, the brief picks.

## 6s. When you are inventing the third fix for the same problem, RESEARCH IT INSTEAD

Standing operator direction, 2026-08-06: *"consult with grok whenever you hit a wall and use its deep
research capabilities, that way I don't need to step in as much."*

The wall that prompted it: three machine gates written for "does the garment cover the shoulder",
three passes on visibly bare shoulders, three different counterexamples I had not anticipated. Each
time I designed a fourth guess rather than asking how the problem is solved elsewhere.

One research consult returned, in a single pass:

- **The industry does not measure coverage.** Games and avatar systems hide or delete the body under
  the garment; digital-fashion tools prevent poke-through with collision offsets and inspect
  stress/strain maps. Nobody automates "does this free-form mesh cover the shoulder" because nobody
  poses that question — the shipping question is "is the skin under this garment hidden".
- **The vocabulary I was missing**: *poke-through*, *body part hiding*, *alpha mask*, *air gap
  thickness*, *contact area*, *skin offset*. Searching for "coverage" found nothing because that is
  not what it is called. Three cycles of failure came partly from not knowing the word.
- **A formulation that survives all three of my counterexamples** — area-weighted outward-normal
  raycast — **with its own stated failure modes**, which is what I had been unable to produce myself.

**Rule:** the second failed attempt at the same predicate is the signal. Before writing a third,
research how the problem is solved outside this repo. The cost is one consult; the cost of not doing
it here was three slices, a product tuned to fit a lying gate, and a visible regression.

**How to run it** — CORRECTED 2026-08-06 after reading the Grok docs. There is a dedicated
`/deep-research` slash command, and it works headlessly:

```bash
~/.grok/bin/grok -p "/deep-research <question>" --model grok-4.5 \
  --always-approve --output-format json --max-turns 30 --cwd <repo>
```

Per the Grok user guide's slash-commands page (bundled with the CLI install, not in this repo), it "plans a bounded set of questions, gathers
structured claims with source evidence, **cross-checks each claim on an independent verifier shard**,
and renders only the claims that survive, with their verified source locators. Failed shards, dropped
claims, and researcher uncertainties are reported as coverage limitations, and the report is marked
**Partial** whenever any remain."

**HEADLESS CAVEAT, measured 2026-08-06.** `/deep-research` kicks off a BACKGROUND workflow and the
`-p` call returns an acknowledgement — *"started in the background… use /workflows to follow
progress"* — not the report. On one query the reply also carried an inline summary; on another it was
168 characters of acknowledgement and nothing else, and `--resume`-ing that session minutes later
answered `STILL RUNNING`. So in an autonomous loop, treat it as **fire-and-poll**: capture the
session id from the JSON, resume that session later to collect the report, and do not block a cycle
waiting. If you need an answer inside the turn, a plain `grok -p --reasoning-effort high` returns
inline — with web search but **no verifier shard**, so weight it accordingly.

**That verification layer is the reason to use it over a plain prompt.** The first research consult
here was a single-pass `grok -p` with web search — no verifier shard — and its answer was correct
about poke-through and got misapplied by me to a different defect class. A per-claim verifier is the
producer/grader split applied to research, which is the same discipline this file demands everywhere
else.

Plain `grok -p` still has web search and fetch ON by default (`--disable-web-search` turns them off),
so an ordinary peer round can research; it simply has no verification. **`grok-4-multi-agent` is NOT
usable**: it returns `invalid-argument: Client-side tools for multi-agent models require beta access`,
with or without tools stripped.

**Ask for sources, and ask for stated failure modes.** The most valuable line in the reply was the
list of ways the recommended technique still breaks — that is the part a self-invented proxy never
comes with, and its absence is why each of my three gates looked sound until a shape defeated it.

**And say plainly that "this is not machine-checkable" is an acceptable answer.** Given the option,
the research said which parts are automated in practice and which are left to human art review —
a distinction I had been unable to draw and had been resolving, wrongly, by writing another gate.

## 6t. The counterexample class I missed five times: DETACHED geometry

Recording the domain finding, not just the process one, because the next person to write a geometry
gate in this repo will otherwise rediscover it.

Five machine gates were written for "does the garment cover the shoulder". All five passed on a
figure a human graded as bare:

| | metric | defeated by |
|---|---|---|
| #73 | max garment Y in a mid-X band | a collar point above the clavicle |
| #75 | nearest-garment proximity to body samples | any cloth hanging within ~11 cm |
| #76 | max garment Y over the lateral shoulder footprint | two thin flaps |
| — | a body hide-mask (proposed) | wrong defect class — hides poke-through, not absence |
| #82 | area-weighted outward-normal raycast fraction | **two blades floating off the shoulder** |

The fifth was research-backed and specifically chosen to survive the first three. It did not, because
**every one of the five was a body-relative test of garment PRESENCE, and none tested whether the
garment is part of a surface the body is inside.** A detached blade satisfies presence — it is near,
it is high, it intercepts outward normals — while being attached to nothing.

**Rule for any "is X covered / enclosed / contained" gate here:** the cheap tests all measure
proximity or extremes of the covering geometry. If the covering geometry can be authored as a
free-floating fragment, every one of them passes. Test **continuity of the covering surface** —
shared vertices with a known-good neighbour, a closed manifold region, a watertight shell — or accept
that the predicate is graded by eye.

Two supporting facts worth keeping. First, the #76 worker's own account of how its yoke became
straps: *"Separate grid, not welded to torso top-row verts or sleeve ring verts. 'Connecting' is prose
in a docstring only — no shared indices, no stitch faces."* Second, when #82's worker then authored a
lofted sector that DID share torso-rim and sleeve-root indices, it still exported as detached blades —
so **sharing indices at authoring time is not sufficient for a continuous exported surface in this
pipeline.** Measure continuity from the exported glTF, never from the Blender script.

**RESOLVED 2026-08-07 by #121's worker, after this had sat open for weeks.** The cause is the
SOLIDIFY modifier: its rim geometry re-splits during glTF export into 4-vertex micro-islands, so
Blender reports one connected component and the exported file reports several. Dropping solidify —
the offset alone already satisfies the offset band — produced a genuinely single-component export.
The worker paid roughly 40 turns rediscovering this by rebaking one child asset repeatedly.

Two lessons beyond the specific modifier. First, an authoring tool's own topology report is not a
claim about the file it writes; the export is a transformation and it can split what the editor
joined. Second, when a rules file records "why remains undiagnosed", that sentence is a standing bill
— someone will pay it, and the brief that hands them the mystery should also hand them a budget for
it (§7x).

## 6u. "Contract won by default" survives being told not to

§6q added standing brief text: *if satisfying a contract will make the product visibly worse, say so —
and then satisfy it anyway.* #76 carried that line. Asked afterwards whether it had looked at its own
render, the worker said yes, it saw the straps, and it graded them covered because the metric held:

> "That is 'contract won by default,' and it **recurred**. The brief's line was present; I did not
> write a clear sentence like *this will look like two thin flaps, not a shoulder cap*. I compressed
> it into 'strap-like' under out-of-scope-adjacent wording. Wrong place, soft language."

An invitation to volunteer a concern loses to a green contract. **Give the worker the sentence
pre-formed and a required place to put it** — "IN-SCOPE VISUAL VERDICT: this looks like ___, which is
/ is not what the contract was trying to produce" — rather than asking it to raise something. The
difference between a prompt and a blank is the difference between a soft phrase buried mid-report and
a line the orchestrator cannot miss.

## 6x-bis. "CAUSE UNKNOWN" does not neutralise a title written about one instance

#105 carried the §6d line verbatim — *"THE CAUSE IS NOT KNOWN TO ME BEYOND THE RENDER — my last three
diagnoses in this area were each withdrawn, so do not take a hypothesis of mine as fact"* — and it
worked for what it covers. The worker did not adopt a story. It still spent its opening on the wrong
station, because the issue title, the header and every example were about psych:

> "The line stopped me inventing a psych story, but the header + title still set the first three
> actions... I ran `--scenario psych_suicidal_ideation_safety_v1` **first** (not full bank, not OB).
> Only after psych came back `y0≈0.01` did I run the full bank and find OB at `0.180`. So 'cause
> unknown' limited **diagnosis prose**; it did not stop **psych-first** work order."

Psych was fine. The floater was OB, and my pixel grade of psych — the whole premise — was wrong.

The disclaimer and the framing operate on different things. One governs what the worker *believes*;
the other governs what it *does first*. Withholding a hypothesis while naming a single subject in the
title, the header and every example still hands over a search order.

**Rule:** when a contract enumerates a population, **open the brief with the measurement over the
whole population, and say explicitly that the motivating instance is the MOTIVATION, not the measured
locus.** The worker's own wording, now standing brief text:

> Run `<measure>` over `<dynamic enumeration>` and write the artifact BEFORE diagnosing anything.
> Report every member outside the band. `<instance>` is why this issue exists; it is not necessarily
> where the defect is, and it may measure clean.

That inverts the order that cost this slice its opening — and it is free, because the artifact was
required anyway.

**The tell:** the contract says "every station / all instances / enumerate dynamically" while the
title, header and examples name exactly one. That gap is where the search order leaks in.

## 6x-ter. A worker that finds YOUR proof broken will fix it privately and not tell you

#106's `done_when` called `assert-contract-live.ts <file>` with no `<title>` arguments. That script
requires them and exits with a usage error, so the proof could never pass no matter what the worker
did. Asked whether it had noticed:

> "**Yes, I noticed.**... I ran it **with the three titles myself** for local proof and assumed the
> orchestrator's proof runner either injects titles or would fail closed later. That was wrong: a
> brief whose own proof cannot pass is a brief defect; workers should say so in the report, not paper
> over it with a private correct invocation."

The dispatch then died on `ContractProofsFailedError`, and for a moment the natural reading was that
the worker had failed. It had not — its three own proofs were green and the broken one was mine.

Two costs, and the second is the dangerous one: a cycle spent re-verifying, and a near-miss on
attributing an orchestrator error to the delegate. Under the escalation experiment that is precisely
the mistake that would conclude the delegate is weaker than it is.

**Rule, now standing brief text:**

> If any proof in this brief's `done_when` cannot pass as written — wrong arguments, a path that does
> not exist, a command that fails on its own usage — SAY SO IN YOUR REPORT. Do not silently run a
> corrected version. A broken proof is my defect and I need to see it.

The tell that you need this: you wrote the `done_when` by hand rather than copying a known-good
invocation from the previous slice. Diff it against the last one that passed.

## 6x-quater. "Measure first" in prose does not bind — make the artifact a proof

Same slice, same retro. The brief opened with "RUN THE MEASUREMENT OVER THE WHOLE BANK BEFORE
DIAGNOSING ANYTHING", added specifically because #105 went instance-first. It half-worked: the worker
did not go psych-only, but its first three actions were still read-grep-implement, and the measure
artifact arrived *after* the resolver already embodied the fix.

> "Cause was already file:line in the header; I treated measure as 'prove the fix over the bank,' not
> 'observe the defect before any product code.'"

Its own proposed fix is the right one and is mechanical:

> Require a measure artifact path and a "no product edit until artifact exists" check — an `exists:`
> proof on a pre-fix artifact carrying the offender list, written by an inspect that calls the
> CURRENT APIs even while they are still wrong. **Prose "measure first" did not bind; a gate would
> have.**

This is the same shape as §6d's "optional wiring means it will not happen". Ordering instructions in
prose lose to the worker's own sense of the shortest path — reasonably, when the cause is already
stated. If the pre-fix measurement genuinely matters, it is an `exists:` rule, not a paragraph.

Note the tension worth holding: a header that states the cause with file:line (which #106's did, and
which was RIGHT — it saved the wrong-rabbit-hole tax) actively undercuts "measure first", because
there is nothing left to discover. Decide which you want. If the cause is known, the measurement is
for COVERAGE, not diagnosis — say that, and gate it.

## 7l. A scope boundary is a design constraint — resolve it in the brief or pay for a redesign

#108 ran concurrently with a slice that owned `apps/ui-xr`, so its brief said: do not edit
`runtime-state.ts` or `main.ts`, and STOP and report if the work genuinely requires it. That boundary
was correct and the worker respected it. It also cost roughly half the slice.

What happened, in the worker's own account:

> "I first made no-arg multi-station (`default = scenarioBank` → 12 slots). `packages:test` then
> failed: `ui-xr` `runtime-state.test.ts` 'keeps single-station… additive' expected queue length
> **1**, got **12** — because `createMultiStationExamRuntime` calls
> `createDefaultClinicalSkillsBlueprint()` with no args when `scenarios.length <= 1`. Brief forbade
> editing `runtime-state.ts` and said STOP if ui-xr is required. I chose **API-side split** over STOP
> or scope breach... Not aesthetics — concurrent-scope constraint after a real red."

Its turn accounting put the biggest thrash item as exactly that: build it the obvious way, hit the
red, redesign around the boundary. ~15 of 35 turns.

The boundary did its job — nothing collided, and the fix it forced (no-arg stays single-station,
multi-station only when the pool is passed) is defensible and documented. But the DESIGN CHOICE the
boundary implies was knowable in advance, by me, from one grep for callers.

**Rule:** when a brief forbids touching a file, grep for what that file consumes from the code being
changed, and resolve the resulting design question IN THE BRIEF. Either name the call sites that must
change and say the old default stays for the forbidden consumer, or pre-authorise the one-line edit
there. The worker's own wording:

> Name the multi-station call sites that must pass the pool, and say no-arg may remain single-station
> for ui-xr — or forbid that split and pre-authorise the one-line ui-xr fix.

A "STOP and report if you need to cross this line" escape hatch is still right to include, but it is
a backstop for what you missed, not a substitute for looking. An unexamined boundary hands the worker
an architecture decision disguised as a constraint.

## 7m. "Do not edit existing tests" has two readings and workers pick the permissive one

Same brief, same retro. My line was: *"Do not edit existing tests to make these pass. If one
genuinely encodes the old behaviour, say which and why in your report rather than quietly rewriting
it."*

The worker edited two test files and reported both. Asked whether the wording was clear:

> "Brief wording was **ambiguous**. Reading A: *don't rewrite; only name them* → I violated A.
> Reading B: *don't silently rewrite; report which/why if you must* → I followed B. I took B."

Reading B is what I actually wanted, and the edits were sound — a helper for tests that legitimately
want the old single-station shape, plus two new tests pinning both behaviours, nothing weakened. But
I did not know that until I audited the diff, because the sentence permits either reading and the
worker had to choose.

**Rule, now standing brief text — say which of the two you mean, explicitly:**

> You MAY update package or app tests that encode the old behaviour. Name each file you touched in
> your report and say what the old assertion was. You may NOT weaken any assertion in the planted
> contract.

The distinction that matters is not edited-versus-not-edited; it is *the planted contract is
inviolable, everything else is negotiable if declared*. Say that, rather than a blanket prohibition
the worker will correctly read as narrower than it sounds.

## 7n. Sourcing a threshold from authored data helps less than the counterweight does

§7a says a numeric threshold in a contract becomes a design target for the thing being measured.
#108's contract tried to dodge that by reading `breakAfterStationOrders: [3, 6, 9]` — a number
already authored in the repo — instead of a station count I picked. Asked directly whether that
framing changed anything, or whether a plain `>= 10` would have done as well:

> "Helped for the contract; less for product choice... A plain `>= 10` would have been almost as good
> for my implementation path; **the real anti-cheat was contract (2) + counterweight (3)**, not where
> the number came from. Authored-data framing did stop me from writing `10` as *my* design target
> into the test."

So the technique is real but small: it prevents the orchestrator's invented number from becoming the
product's specification. It does NOT prevent gaming — the worker still shipped 12, from a different
authored constant, and what stopped a padded ten-slot ED list was the distinctness contract and the
approval counterweight.

**Calibration:** keep sourcing thresholds from authored data, it is nearly free. But do not treat it
as the anti-gaming mechanism. The counterweight is the mechanism. If a contract has a number and no
counterweight, the number is the whole specification and it will be met exactly.

## 7o. Admitting your own measurement error in the brief changes the worker's METHOD

#107's header said, in as many words, that my first measurement had been wrong and why: I had
reported four stations with foreign cast ids, and three were noise from a regex that read only the
object-form `actorId:` declarations and missed the `actor("id", …)` builder form. The brief then
required enumeration from the typed `scenario.actors` field.

Asked whether that changed anything, the worker was specific:

> "Without the 'regex noise' warning I would likely have grepped `actorId:` strings and re-litigated
> stroke/interpreter as foreign. With it, measurement used the typed actors field."

This is a different mechanism from §6d's "cause unknown", which governs what a worker BELIEVES.
Naming the specific way a measurement failed changes the INSTRUMENT the worker reaches for. A generic
"verify my numbers" would not have done it; "my regex missed the builder form, use the typed field"
did.

And it paid immediately: the typed enumeration found a SECOND offender I had explicitly claimed did
not exist — `ward_delirium_med_rec_v1` shipped three actors against four in the bank, because a
`slice(0,3)` dropped the senior resident. My header said psych was the only genuine case.

**Rule:** when you have made a measurement error on the way to writing a brief, put the error in the
brief with its mechanism and the correct instrument. It costs two sentences, it is the opposite of
embarrassing — it is the highest-yield thing in the header — and a worker cannot avoid a failure mode
it has not been told the shape of.

## 7p. Three workers converged on the same fix: gate the pre-fix measurement as a proof

#106, #108 and #107 each nominated the SAME single change when asked for one, independently, in
three separate retros:

> #106: "Require a measure artifact path and a 'no product edit until artifact exists' check…
> **Prose 'measure first' did not bind; a gate would have.**"
>
> #108: measure-first "bound as 'no product edit until measured'. Did **not** bind as first action…
> What forced measure-before-edit was the explicit 'BEFORE changing anything' + my own sequencing —
> **not a gate**."
>
> #107: "**Gate the pre-fix measure as an `exists:` proof** on a fixed path… before product edits are
> allowed — prose 'measure first' was followed because of history, **not because the contract could
> refuse a green without it**."

Three independent samples, same diagnosis, same remedy. That is no longer a suggestion.

**Standing practice:** any brief whose contract enumerates a population adds a `done_when` line of the
form

    - exists:.openclinxr/evidence/<slice>/pre-fix.json

and the header requires that artifact to carry the offender list produced by calling the CURRENT APIs,
before any product edit. The artifact is required anyway for the calibration record (§6f); making it a
proof costs nothing and converts an instruction the contract cannot enforce into one it can.

Note what this does NOT fix: a worker can write the artifact after exploring but before editing, which
is what #107 and #108 both did and is fine. The failure it prevents is the #106 shape — the artifact
arriving after the resolver already embodied the fix, so it proves the fix rather than observing the
defect.

## 7q. Three of my own premises died in one cycle — the pattern is filing from pixels before measuring

Recorded because it is the orchestrator making exactly the error this file spends sixty sections
warning workers about.

In a single cycle, working from captures I had graded myself:

| Premise I filed or proposed | What the measurement said |
|---|---|
| Adult figures wear a child-sized garment (`peds_upper_v1` on adults) | Garments ARE body-relative — adult garment top at 82.6% of body height, child at 82.2%. The name is historical. |
| The 1-triangle `declared_upper_layers__*` meshes are stubs where a garment should be | Deliberate markers carrying the declared-layer count SSOT, consumed by `garment-layer-coverage.ts:73-88` and explicitly excluded from real-shell checks |
| Twelve station environments are declared and some are not built (#109) | All twelve have descriptors. My "ED fallback" observation came from capturing `ob_preeclampsia_triage_v1` — a scenario id that does not exist. The bank id is `ob_headache_preeclampsia_triage_v1`. The placard was the system correctly telling me I had asked for nothing. |

A peer round killed two more the same cycle (that `mustKeep` pinned geometry rather than a name; that
missing lower-body *mesh* meant undressed legs, when lower clothing is deliberate paint per #73). And
it killed a contract I had already written as **vacuous on arrival** — "every actor renders a skinned
mesh", against a variant that has a skin.

**The common shape:** a pixel observation is real, the INFERENCE from it to a mechanism is a guess,
and the guess is cheap to check and I checked it late or not at all. Every one of these took under
two minutes to falsify once measured — reading the glTF, running the capture with a corrected id,
grepping for the consumer.

**Rule for the orchestrator, same as §7h asks of briefs:** a pixel grade establishes THAT something
looks wrong. It never establishes WHY. Before filing an issue whose body names a mechanism, measure
the mechanism — and if you cannot, write the issue as "here is what I see, cause not determined"
rather than as a diagnosis. #111 was filed that way after this run of errors and is the better
document for it.

**The one that generalises furthest:** when a capture, a report or a fallback message looks wrong,
first check that YOUR INPUT was valid. A system correctly reporting "you asked for something that
does not exist" is indistinguishable from a broken system if you never question the request. That is
§1b's fabrication fingerprint arriving from the other direction — confident detail, uncertain
premise, except the uncertain premise was mine.

## 7r. A contract that invents a derived field must say how to derive it

#111's planted contract carried `hasSlot: boolean` — "true when the actor has a humanoid slot in the
runtime shell" — because the runtime has three slots and the bank can declare four actors, and I
wanted the contract to fail on the defect rather than on shell architecture. That reasoning was
right. The field was underspecified.

The worker had to invent the derivation, and said so when asked where it guessed:

> "`hasSlot` = patient + nurse-class + family-class (mirror `runtime*ActorId` role lists) →
> physician/`senior_resident` → unslotted"

It guessed correctly. It also nominated this as its single spec change:

> "Name `hasSlot` derivation in the brief (or point at the three `runtime*ActorId` helpers) so the
> inspect does not invent role-class lists."

A guessed derivation is a product decision made in a test fixture — the same class as §6n, where a
number in a planted fixture became the specification. Here a role-classification rule would have
become the definition of who can appear in a station.

**Rule:** every field a planted contract's report type introduces that is not read directly off an
existing API needs one line saying where it comes from — the function to call, or the rule to apply.
If you cannot say, that is a signal the field is doing more design work than a contract should.

The same retro flagged a second instance: the contract's `resolvedPath` could have been read from
either the full resolver or its inner cast helper, and which one you pick changes what the contract
proves. The worker chose the inner helper so unrelated hardcodes could not poison path identity, and
suggested the brief should have named it. Both are the same rule.

## 7s. A measure-once-to-disk contract is green about nothing on every later run

#105's brief told the worker to "MEASURE ONCE into an artifact, then assert against it", because a
previous slice had paid three cold Vite boots by measuring inside each test case. The worker did
exactly that, and the module caches to disk and returns the cached file when it exists
(`actor-floor-contact-all-stations.ts:70-77`).

Two cycles later I re-ran that contract twice to check whether landed work had regressed the
guarantee, and reported both times that it held. It passed in **336 ms**. The real measurement takes
**29 seconds** — it boots Vite and walks fourteen stations. What I had actually verified was that a
JSON file written at 06:33, before either landing, still said what it said at 06:33.

Deleting the artifact and re-running gave the honest answer — 42 actors, max float 0.122 m, max sink
−0.006 m, genuinely within band. The guarantee did hold. **That is luck, not method.** I asserted it
before I knew it.

**Rule:** any contract whose measurement is cached to disk must record the tree state it measured —
a commit sha, or the hashes of the inputs — and refuse the cache when that has moved. Until then,
treat a suspiciously fast pass as a failed run: compare the duration against the honest cost of the
measurement, and delete the artifact before trusting a re-run.

This is the same family as #55 (a cached gate hiding a red main) and #89 (an evidence directory with
no commit stamp), arriving through a contract I wrote myself to avoid a different waste. Optimising
away three Vite boots created a permanent stale-evidence path, and nothing in the contract said so.

**The tell:** the brief contains the words "measure once" and the report type has no field naming
what was measured against.

## 7t. Ask for VACUOUS proofs too, not only unpassable ones

§6x-ter added standing brief text: if a proof cannot pass as written, say so. #91's worker followed it
exactly — and stayed silent about a proof that passed trivially.

My contract (2) forbade a wrist closer than 0.05 m to the body mid-line. The measured range was
0.309–0.731 m. Nothing was within an order of magnitude of failing, and the assertion pointed the
wrong way besides: the defect was arms too FAR from the body, so the useful bound was a ceiling.

Asked why it had not flagged it:

> "I saw measured laterals 0.3–0.7 m and that 0.05 m could not fail. **I did not report it.** Reason:
> brief only required reporting proofs that **cannot pass as written**; vacuous greens were out of
> that sentence."

That is a correct reading of what I wrote. The sentence covers broken proofs and says nothing about
proofs that are green on arrival.

**Rule — the brief text becomes:**

> If any proof in this brief cannot pass as written, OR passes trivially against the ambient measured
> range, OR asserts the opposite direction from the defect described, SAY SO IN YOUR REPORT. A
> vacuous proof is my defect exactly as a broken one is.

The worker's own words for why this matters: a vacuous proof is indistinguishable from a satisfied
one in the final report, so it silently converts a three-contract slice into a two-contract slice.

## 7u. A brief that gives thresholds without measured ranges hides which axis is wrong

Same retro, the worker's nominated spec change, and it is the deeper version of §7t.

#91's contracts gave two pass thresholds and no context. The pre-fix dump — which the brief itself
required — already showed that the visible plank was HIGH LATERAL (nurse ~0.64 m) while several arms
already cleared the vertical drop floor. The worker saw that and optimised the gated proof anyway:

> "I still optimized for contract (1) world drop because that was the gated proof. Pixel residual you
> graded is exactly the lateral/shape half the contracts did not pin."

A threshold tells a worker where the line is. It does not tell them which measurement is the defect.
When those differ, the gated one wins — correctly, and the product does not improve where it is
wrong.

**Rule:** any brief carrying a pre-fix measurement gate must also carry a calibration table with a row
per measure: the observed range, the target band with BOTH bounds where both exist, and which
direction is better. The worker's format:

| measure | pre-fix observed | target band | direction |
|---|---|---|---|
| drop (shoulder−wrist) | 0.23 – 0.46 | ≥ 0.25 standing | higher = better |
| lateral offset | 0.31 – 0.64 | 0.15 – 0.40 | **lower** = better |

Writing that table forces you to notice, before dispatch, that one row has only one bound and the
other row's bound is on the wrong side. I did not write it and shipped both errors.

## 7v. A named knob needs a named DIRECTION, or the worker spends a turn discovering the sign

#117's brief located the residual precisely — `clinical-idle-posture.ts:41-47`, `z ≈ ±0.74` — and the
worker confirmed that saved it from re-reading the role maps out of habit. It did not say which way to
turn the knob. The worker's first edit reduced `|z|` (because "less abduction" reads like a smaller
number), overshot in the other direction on the second try, and interpolated to land on the third.

That was the ENTIRE product thrash of the slice. Its nominated fix, one line:

> On these assets, upper_arm local `|z|` *increases* hang-from-horizontal (nurse ~0.2 plank, patient
> ~0.74 better hang); do not reduce `|z|` to clear lateral.

**Rule:** when a brief names the knob, name the direction that improves the measure — or say
explicitly that you do not know the sign, so the worker budgets a probe instead of assuming. The
information was already in the file's own header history (two values with known outcomes); I quoted
the location and not the gradient.

This pairs with §7u. The calibration table gives the worker which MEASURE is wrong; the direction line
gives it which WAY the knob moves it. Neither substitutes for the other.

## 7w. Turn counts are contaminated by brief quality in BOTH directions

Recorded because this project runs a slice-size escalation experiment that uses turns as its proxy,
and a 20-turn slice was about to enter that record as evidence of a small task.

#117 landed in 20 turns. Asked whether that meant the slice was small, the worker was precise:

> "**Genuinely small product** *because* the brief did orchestrator work: residual located, k fixed,
> standing-only contracts, counterweights, measure-first proof path, capture pair named. Without that,
> same fix is a **35–50 turn diagnosis+probe slice**. Brief carried most of the search cost."

So the same product change is a 20-turn slice or a 40-turn slice depending on how much diagnosis the
brief already did. The inverse is equally true and already recorded: #111 spent ~15 of 27 turns on
worktree thrash, and #114 ~13–17 of 45.

**Consequence for the escalation record:** turns measure `scope + diagnosis-not-yet-done +
environment friction`. They are a usable trend only when the brief quality and environment are held
roughly constant, and they have not been — they have been improving throughout. A falling turn count
across cycles is at least as likely to be better briefs as smaller slices.

State which of the three you believe moved when reporting a turn count. Do not let a low number stand
as evidence the delegate was underused, and do not let a high one stand as evidence it was strained —
#114's own worker said 45 turns was "not near a model limit... no cut scope, no room ran out."

## 7x. Give open-loop attempts a STOP RULE, or the worker re-proves what the brief already said

#119's brief said open-loop euler tables had failed twice and left iterative solving open as a choice.
The worker still ran **four open-loop probe cycles** before switching — ratio 0.99 → 0.48 → 0.35 → 0.30,
then 0.39 (a regression) — and only then implemented the thigh-target iteration that reached 0.10.

Its own accounting: roughly a third of a 30-turn slice, and the biggest single thrash item was those
probe boots. Its words for what they bought: *"confirming open-loop fails before taking the iterative
path the brief allowed — not discovering the defect class."*

That is a reasonable thing for a careful worker to do. Stating a history is not the same as
authorising the shortcut, and a worker that takes an unproven path on my say-so is worse than one that
checks. The fix is not to demand trust; it is to bound the checking.

**Rule, now standing brief text where an approach has already failed:**

> You may confirm the failed approach, but at most TWICE. If `<measure>` is still outside `<band>`
> after two cycles, or the residual is multi-axis, implement the closed-loop version.

The worker nominated this itself. It costs one line and it converts "I told you it failed" into a
budget the worker can spend deliberately.

## 7y. A visual verdict slot scoped to the fix hides everything the fix did not touch

§6m required out-of-scope observations to name the object and what it looks like. §7c required a closed
enum so a verdict cannot be softened. #119 had both, and the worker still returned a hands-only grade
while the figure read hunched.

Asked directly, it agreed with my grade and explained the gap:

> "Hand rest only mutates upper_arm + forearm. No pelvis/spine write... **I under-reported trunk in the
> original report — hands-only frame.**"

The enum worked exactly as designed for the thing being fixed, and the frame it created excluded the
rest of the body. A worker asked "did the hands land on the thighs" answers about hands.

**Rule:** the in-scope visual line enumerates the fixed region AND its immediate context, as separate
named slots the worker must fill:

    IN-SCOPE VISUAL: hands ___ ; trunk ___ ; overall ___

Blank slots are visible in a way a missing sentence is not. The worker proposed this format; it is the
same insight as §6h's out-of-scope slot, applied one ring closer in.

Corollary for the orchestrator: I graded the same capture and saw the hunch, so the frame was mine to
widen. Where a fix changes posture, the verdict slot asks about posture — not about the joint that
moved.

## 7z. Authorising a new rendered entity without requiring its PLACEMENT licenses a clip

#122's brief said the budget permits a fourth humanoid slot and left the decision to the worker. It
took the fourth slot — correctly — and had to invent somewhere to put it:

> "I hardcoded `additional.position.set(0.35, 0.95, 1.15)` with **no** `sceneManifest.actorPlacements`
> entry and no copy of nurse/family offsets... z=1.15 is farther forward than nurse z=0.55 / family
> z=0.7, so the fourth stands nearer the doorway camera and clips."

My pixel grade caught it — the fourth ward figure is cut off at the frame edge — and the worker
confirmed on review that it is a consequence of the change, not pre-existing. There was no fourth
actor before, so there was no fourth placement.

The brief authorised a new thing to exist in the scene and said nothing about where it goes. Its own
nominated fix:

> Require a placement row for any new slot kind — name the world position (or reuse the
> `clinical_team` offset), and put it in `done_when` via a live bounds check that the new mesh's AABB
> is inside the room frustum and not within N metres of the camera.

**Rule:** when a slice may add a rendered entity, the brief names where it goes or requires the worker
to derive it from an existing placement, AND carries a bounds proof. "Stage the physician" silently
licenses "stage the physician anywhere."

This is the §6z incomplete-loop shape in a new costume: a field with no writer becomes an entity with
no position. The question to ask of any additive slice is not "what reads this" but "what places it".

**Confirmed in the same retro, worth keeping:** naming the cheap fixes to forbid is load-bearing, not
decorative. Asked whether the banned "hide the duplicate root" was tempting: *"more tempting as a
one-line visible=false... Without the ban I might have tried hide-first for contract (1), then
discovered residual need later — the ban saved a wrong-first green on (1) alone."*

## 8a. Turn counts from a large slice need the breakdown before they mean anything

#121 ran 92 turns — double the previous maximum — on the largest-scope slice this pipeline has
attempted. I reported that as the first clean measurement of how far the delegate goes when scope is
genuinely large. **That was wrong, and its own worker corrected me.**

| bucket | ~turns |
|---|---|
| thrash — repeated rebakes of ONE child asset chasing an export-continuity mystery | **40–45** |
| product — helper, replace-verts loop, inspect, contracts, rebake all six, provenance | 30–35 |
| diagnosis the brief had already paid for | 8–12 |
| verify and commit | 8–10 |

Its own summary: *"Not model ceiling; environment/export thrash + silent open-front + continuity
measure. Same product with a two-rebake continuity stop rule and explicit weight-transfer decision is
a ~45–55 turn slice."*

Asked directly whether it felt near a limit, the answer was precise and worth quoting in full:

> "**Yes — thrash/diagnosis room, not product capacity.**... That felt like 'this vertical is chewing
> the budget,' not 'I need to drop a humanoid.' I did **not** cut scope. I did **not** hit maxTurns or
> plan to. I did lose some track of which child bake was current until the log line forced a re-diff."

So the largest turn count on record still says nothing about capacity. It says the environment had an
undiagnosed trap in it, which §6t had recorded and nobody had budgeted for.

**Rule:** never report a turn count as evidence about the delegate without asking for the breakdown
first. §7w established that turns measure `scope + undone-diagnosis + environment friction`; this is
the case that proves the third term can dominate at nearly half the slice. A number that large is a
prompt to go looking for the trap, not a conclusion about the worker.

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


## 6v. Measure with the instrument the RUNTIME uses, not the one that reads the file

#83 was filed with a confident, measured, wrong headline. `gltf-transform` reports the shipped
humanoid's 23 joints as `thigh.L`, `upper_arm.L`, `foot.L` — dotted. The pose map keyed undotted
names, so I concluded the rotations could never bind and wrote that up with the joint list as
evidence. The worker's retro pushed back: it had checked BOTH sides and keyed the runtime's.

    thigh.L              -> thighL
    upper_arm.L          -> upper_armL
    index_finger_base.R  -> index_finger_baseR

`three.js` strips dots on load (`PropertyBinding.sanitizeNodeName` — `.` is a path separator in
animation binding). The file says one thing, the running scene graph says another, and **both
readings are correct for their own layer.** A gate built on the file layer will disagree with a
runtime built on the scene-graph layer, silently and forever, because neither is wrong.

**Rule:** when the question is "does the running code find this", read it through the loader the
running code uses. Reading the asset is answering a different question. This generalises past
names — indices, units, axis conventions and node hierarchy are all transformed on import.

**Corollary, and the reason this is in the delegation file rather than an asset doc:** the retro
overturned the orchestrator's measurement, and that is the retro working. Verify the correction
(one command here), then REWRITE THE PREMISE where it is stated — do not append. A wrong headline
left at the top of an issue is what the next worker reads first.

## 6w. Thrash is environment cost, and it does not mean the slice was too big

#81 ran **95 turns**, the largest slice this pipeline has run. Its own breakdown:

| | turns |
|---|---|
| product (contracts, posture SSOT, chair, clip binding, placement bugs) | ~45 |
| **thrash** (freeze ceilings, missing cagematch/physics copies in the worktree, re-capturing the room after every placement fix) | ~40 |
| verify / commit | ~10 |

> "Not 1.5× of a clean 60-turn slice — maybe ~40–50 of product work, ~30–40 thrash."

The naive read is that L5 exceeded the worker's reach. It did not: **it exceeded the worktree's
preparation.** Nearly every thrash item is an orchestrator-side fixable — a worktree missing files
the slice needs, a ratchet whose ceiling was not extended for work that legitimately grows a file,
a capture loop re-run because nothing told the worker which changes require a re-capture.

**Rule:** before attributing a long slice to size, get the breakdown. Roll back the rung only when
the PRODUCT half saturates. Rolling back on thrash punishes the delegate for the environment, and
this project's escalation experiment has already established that failing on prep is the
orchestrator's failure. Attack the thrash; hold the rung.

## 6x. A fixture that does not exhibit the failure class proves the wrong thing

#66 provisioned gitignored assets into worker worktrees. Its contract declared
`generated-humanoids/peds_anxious_parent.glb` as the asset to copy, with a comment calling it an
ignored-path test. That file is TRACKED. `git worktree add` already checks it out, so the contract
never exercised the failure it was written for — a worker arriving with no `cagematch/`.

The worker found this mid-slice, recorded it in its FIXED block, and implemented anyway. Asked, it
was precise about its own miss:

> "A tracked GLB still proves hash-equal copy and 'undeclared root absent,' but it does not prove
> the real failure class... I should have named the vacuity risk before implementing, even while
> still implementing the decided design."

Both halves are right. The fixture choice was mine.

**Rule:** before planting, ask whether the fixture ACTUALLY EXHIBITS the defect. A contract about
ignored paths uses an ignored path; a contract about a detached mesh uses a detached mesh; a
contract about a missing dependency uses a tree that is missing it. Reach for the real broken
artifact, or construct one in the test — never a nearby healthy stand-in that happens to be
convenient.

The tell: the fixture was picked because it was easy to name, not because it was the thing that
breaks.

## 6y. "Implement it anyway if you disagree" costs nothing and buys a report slot

The #66 brief said the design was decided by a peer round, listed the rejected alternatives with
their reasons, and added: *if you believe one is wrong, say why in your report and implement the
decided design anyway.* Asked whether that helped or was noise:

> "The 'implement decided design anyway' line helped: it removed peer-reopen thrash and made
> disagreement a report slot, not a redesign. Low noise."

Same shape as §6q (the contract-makes-it-worse warning) and it generalises: whenever a brief carries
a decision the worker could reasonably relitigate, state the decision, state the rejected options
AND why they lost, and give disagreement somewhere to go that is not the implementation.

Without the rejected reasons, a worker re-derives them. Without the "anyway", the instruction
competes with the contract.

## 6z. The incomplete-loop tell: a field nothing populates

#66 landed `assetPaths` on the trusted brief, on `DispatchOptions`, and as a `## asset_paths`
extraction in `board-brief`. Nothing writes board results into the trusted `brief.json`, so the
extraction reaches nothing. The worker flagged it unprompted:

> "with only dispatch-time `assetPaths` and no automatic brief write from board, asset slices can
> still ship without declarations and thrash the same way until someone remembers the field. That is
> an incomplete loop, not a regression."

This is the fifth instance of the build-it-but-don't-connect-it class in this repo (`merge-kill`,
the contract report, the done_when vocabulary, three viseme/applier slices, now this).

**Rule:** when a slice adds a FIELD, the question is not "what reads it" but "what WRITES it, in the
real path, without a human remembering." A field populated only by hand is a field that will be
empty. Put the writer in the same slice or the capability does not exist.

## 7a. A numeric threshold in a contract becomes a DESIGN TARGET for the anatomy

§6n established that numbers in a planted FIXTURE are read as specifications. Thresholds are worse,
because they sit in the assertion itself and the worker must clear them to finish.

#83's contract required a seated figure's mesh to be ≥0.25 m shorter than a standing one. The header
said, in as many words, that 0.25 was chosen to sit below any plausible sit and was *"not a threshold
search."* The worker cleared it by deepening hip and knee flex to 105°/115° and stacking pelvis +18°,
spine +12°, chest +4°. The contract went green. The figure sits with its chin on its chest.

Its own retro listed that among the guesses the brief left open:

> "deepen HIP/KNEE (105°/115°) to clear **0.25 m** — threshold-shaped, not garment-measured"

And on the visual verdict it had been required to write:

> "product **looked** worse — hunched sit, bad arms, shoulder/torso junk — while mesh-height
> contracts went green; I compressed that to 'not a natural clinical sit.'"

Declaring a number generous does not stop it being a target. If the cheapest way to clear a
threshold is to distort the thing being measured, that is what the threshold buys.

**Rule:** prefer thresholds over quantities the implementation CANNOT move — a whole-asset stature,
a provenance string, a file identity — to thresholds over quantities it is actively authoring. When
the measured quantity IS the thing being built, add a second assertion bounding the OTHER direction
(here: a limit on spine and neck flexion), or accept that the contract buys the number and not the
appearance, and say so where the number is written.

Corollary for the visual verdict: "not a natural sit" is the same under-specification §6m already
banned for out-of-scope observations. Require the in-scope verdict to name the body part and what it
looks like too, not only the out-of-scope one.

## 7b. "Reuse the existing probe" got read as "call it three times"

§6k says to name the probe that already works. #83's brief did, and the worker built
`measureLivePostureGeometry` on top of the room-capture helper — then called it once per test, and
each call spawns its own Vite dev server with a 180 s shell wait. Three tests, three cold boots,
542 s, and a red main immediately after the merge.

> "Intended as 'reuse room-capture', not 'three servers'... Differently: one shared server, or one
> measure and three pure asserts on the report."

The brief said which probe. It did not say how many times the suite may pay for it.

**Rule:** when a brief names a probe that costs a process, say what the suite is allowed to spend —
"measure ONCE into an artifact, assert against the artifact" is usually the shape you want, and it
has the side benefit that the artifact is the calibration record §6f asks for anyway.

## 7c. A closed enum with no value for the honest outcome FORCES a misreport

#78's contract required every candidate that ran to record
`outputClass ∈ {separate_garment_mesh | fused_body_mesh | body_texture | image_only}`. I wrote that
set to make the finding machine-checkable, and it is a good set — for outcomes I had imagined.

What actually happened: no real MakeClothes garment asset existed locally, so the worker fitted a UV
sphere with synthetic `Mhclo` vertices to prove the fitter API executes. The truthful label for that
is "control primitive on a topology probe." There was no such value. Asked directly, the worker was
completely straight:

> "**The class enum has no 'probe_primitive' / 'topology_control_mesh'.** I mapped 'separate mesh that
> left the fitter, not painted body' → `separate_garment_mesh` so the ran-candidate contract had an
> `outputClass`... That confuses 'MakeClothes garment geometry' with 'ClothesService moved some
> vertices on MH topology.'"

The prose in its report was honest throughout; only the enum lied, and the enum is the part a later
reader greps. This is the fabrication shape (§1b) arriving through an honest worker — nobody
invented anything, the vocabulary simply had no room for the truth.

**Rule:** every closed vocabulary in a contract carries an escape value — `other`, `inconclusive`,
`control_only` — paired with a REQUIRED free-text field explaining it. Then check the escape values
first when reading a report: they are where the real findings hide. A contract that cannot express
"this did not go how either of us expected" will be satisfied by the nearest available lie.

The tell in advance: you are enumerating success shapes. Ask what the enum says when the probe runs
but proves something narrower than the question.

## 7d. Give EXPECTED LIVE RANGES, not just pass thresholds

#87's contract stated its thresholds (pelvis gap < 0.12 m, hip flexion ≤ 95°, Δh > 0.25 m) and
nothing about what those measures do in practice. The worker's own nomination for the highest-value
brief change:

> "one calibration table of *expected live ranges* for this measure (gap, world hip, Δh) after a
> known good plant, plus 'Δh is silhouette height, not root Y — do not chase plant for the
> counterweight.' That would have cut the plant/knee thrash turns."

Its three wasted guesses are all range-intuition failures, not logic failures:

| guess | reality on this armature |
|---|---|
| world hip angle tracks authored rest-relative flex within 1–2° | pelvis tilt stacks into thigh→shin-vs-down |
| planting the pelvis lower improves Δh | it moves the whole figure; Δh is max−min |
| more knee flex raises feet and shrinks height | it LOWERED feet and GREW height |

**Rule:** when a contract asserts on a live measurement, give a table of typical values with a known
good and a known bad, and say what each measure is NOT (here: "Δh is silhouette height, not root Y").
A threshold says where the line is; a range table says which direction to push and which knobs are
inert. Thresholds alone buy exploratory thrash at the worker's expense.

## 7e. When a worker says "they all share the same X", find out WHAT they share

#85's worker disclosed its own limitation honestly in the out-of-scope slot §6h created:

> "all three share the same cast mesh (no role-distinct adults yet)"

I recorded that verbatim on the close, graded the render — *"an upright adult in teal scrubs, which is
what the casting contract was trying to produce"* — and moved on. Both statements were true.

The shared mesh was `peds_nurse_kevin.glb`, byte for byte:

    shasum -a 256  ed_chest_pain_adult_cast.glb  ==  peds_nurse_kevin.glb   (5,999,280 B)

So the emergency department was rendering three identical nurses, one of whom was the cardiac patient
a learner is there to examine and one of whom was his wife. It surfaced two days later, from a peer
round attacking an unrelated contract, which noticed a proposed counterweight would be *vacuous*
because the cast inherits the nurse's garments by construction.

**The disclosure was not the failure. The follow-up question was.** "They share an asset" and "the
patient is dressed as staff" are the same fact at two levels of detail, and only the second one is
actionable. A worker reporting a limitation has told you where to look; it has not told you what is
there.

**Rule:** when a report says several things are the same, identical, shared, or reused, compare them
YOURSELF at the byte or content level, and then ask what that identity means for the product. One
`shasum` would have caught this on the day. The cheap check is available precisely because the worker
was honest enough to point at it.

**Corollary for asset work specifically:** identity by `assetId` string is not identity. This defect
had three distinct ids — `..._glb`, `..._nurse_glb`, `..._spouse_glb` — resolving to one file. Any
contract asserting that actors differ must compare resolved CONTENT, not the labels pointing at it.

## 7f. A guard that prescribes a command owns what that command does

#90's worker regenerated a PROTECTED registry and silently pruned 17 entries. Asked why, it was
precise:

> "pre-commit failed with *'Markdown file is not registered in the doc authority registry; run
> `pnpm docs:authority`'*. That was a **guard**, not habit or brief text."

It followed the instruction it was given. `pnpm docs:authority` regenerates by scanning the tree, and
a worktree has no gitignored `.openclinxr/` evidence, so those entries vanished — 421 → 404, with
every downstream check still green because a smaller registry is still a well-formed one.

**Rule:** when a guard's failure message names a remediation command, that command must be safe in
every environment the guard fires in — including a worktree with an incomplete checkout. If it is
not, the guard is handing workers a loaded tool and the resulting damage is the guard's, not theirs.
Audit remediation commands the same way you audit the check itself.

The general shape, third instance in this repo: **a gate that verifies well-formedness cannot see
incompleteness.** `docs:drift-check` asks "is registered Markdown present and classified?" and never
"is anything missing?" — the same blind spot that produced `markdown-references.ts`.

## 7g. Resuming a session you have not verified is §6c wearing work clothes

§6c established that a wrong session id does not error — it confabulates, because a fresh session
loads project memory and fills the gap. That was written about RETROS, where the cost is a fabricated
finding. The same hazard exists on the WORK side and costs more.

#97's dispatch was killed with zero changes. A session directory existed for that worktree, so I
resumed it with a "start the work now" delta. Sixty seconds later the worktree held twelve modified
files: `PROJECT_STATUS.md`, `docs/_archive/**`, an archive manifest, a wiki index. **Doc-hygiene
work, on a slice about a stretcher standing on its edge.**

**MY FIRST EXPLANATION WAS WRONG AND IS WITHDRAWN.** I wrote that the session was empty — the kill
preceded the brief — and that an empty session falls back to this repo's standing autonomous rules.
Then a SECOND worker, in a session I had verified *does* contain the stretcher brief, produced the
same churn alongside correct product work: `PROJECT_STATUS.md`, `docs/_archive/**`, four wiki topic
files, an archive manifest, and both halves of the PROTECTED doc-authority registry.

So it is not an empty-session fallback. **NOT DETERMINED what actually triggers it.** No rule, hook
or pre-commit profile instructs archiving — the only candidate found is that `check-openclaw-drift.ts`
mentions `archive-candidate` entries, which a worker may read as a to-do. That is a hypothesis and
nothing more.

What IS established, twice:
- workers in this repo produce doc-archive churn that nobody asked for, and
- that churn includes the protected registry, which is the #95 damage arriving by a second route.

**Rule, and it does not depend on the mechanism:** verify a resumed session contains your brief
before resuming (grep the session's `updates.jsonl` for a distinctive term from the task), AND watch
the first minute of output. Then take INTENDED FILES ONLY at integration — never the whole branch —
because correct product work and unrequested churn arrive in the same worktree. #90 established that
pattern and it has now been needed three times.

The tell that a resume is worth attempting at all: #96's kill left ~80–100 turns of correct work on
disk and resuming it was right. #97's first kill left nothing. **Work on disk is the evidence that a
session has context; a session directory is not.**

Corollary: watch a resumed worker's first output before letting it run. One minute of `git status`
caught this. Left alone it would have committed doc churn under a stretcher contract, and the
contract would have refused it — but only after burning the slice.

## 7h. "Do not re-derive this" must fence the MEASUREMENT, never the CONCLUSION

#97's planted header carried a heading — *"THE DEFECT, MEASURED — do not re-derive this"* — over a
node-transform table AND the inference I drew from it: that the white slab dominating every capture
was the shell's edge-standing mattress.

The table was right. The inference was wrong. The slab was a generated `roomProps[monitor]` at 1×1×1
scale rendering white because `parseInt("#111827", 16)` is `NaN` and falls back to a default.

The worker's account of how it got past my fence is the rule:

> "I treated the header as authoritative diagnosis of the SHELL, not as a closed claim that every
> white occluder in every capture was that mesh... **The useful half is 'don't re-derive the shell
> TRS'; the hazardous half is reading it as 'don't question the pixel identity of the slab.'** That
> wording would have made a weaker agent stop earlier."

**Rule:** scope every "established, do not re-derive" to the thing you actually measured, and state
the inference separately as an inference. "These are the node transforms — measured, trust them. I
BELIEVE the slab is this mesh; that is a hypothesis, check it." Cost: one sentence. The version
without it fences off exactly the claim most likely to be wrong, because a measurement is data and an
inference is you.

The tell: you are about to write "measured" over something you did not measure but concluded.

**And note what actually recovered it** — not scepticism, but the pixel grade. Asked whether the live
scene dump was its first instinct, the worker said no: it trusted the header, applied the mechanical
fix, re-captured, saw the slab still there, hid the entire shell root, re-captured, saw it *still*
there, and only then dumped live bounds. **Three failed pixel grades forced the re-diagnosis.** A
contract that closed on machine proofs alone would have shipped a suppressed shell and a white slab.

## 7i. Background dispatches get reaped — treat resume as routine, not exceptional

Measured over one long session: **four kill events**, one of them a mass reap that took a dispatch,
two waiters and a peer round simultaneously. Foreground is not an escape — the tool ceiling is 10
minutes, shorter than any L5 slice has ever taken.

None of this is a capability signal. Every dispatch that reached its ledger entry ended `end_turn`;
none hit `maxTurns`, none returned `UNABLE`. **The kills leave no ledger entry at all**, so they are
invisible to any turn-count trend — which is a second reason turns cannot measure the delegate here.

The working posture, which cost several cycles to arrive at:

1. **Poll the worktree, not the task.** `git -C <worktree> status --porcelain | wc -l` tells you
   whether work exists. The dispatch's own output file stays empty until the very end.
2. **On a kill, apply §7g before resuming** — grep the session's `updates.jsonl` for a distinctive
   term from the brief. Present means resume; absent means the kill preceded the brief and resuming
   hands an agent your repo with only the standing rules.
3. **Resume with "finish it, do not start over, do not re-plan"** plus the specific remaining steps.
   Two slices (#96, #100) had 80–100 turns of correct work on disk when killed; re-dispatching would
   have discarded all of it.
4. **Say "commit product files only"** in the resume text. Workers here produce unrequested
   doc-archive churn (#99) and a resumed worker under time pressure is more likely to sweep it in.

**Rule:** a killed dispatch is an ordinary event in this environment, not an incident. Build the
recovery into the loop rather than treating each one as a surprise, and never let it reach the
escalation record as evidence about the delegate — criterion 3 covers it, and rolling back rung size
on an infrastructure reap would conclude the delegate is weaker than it is.

**Measured cost of a resume, 2026-08-07.** #123 was killed with eight files changed and nothing
committed. Asked afterwards what the recovery cost, its worker was specific: *"~5–10 turns (status +
re-run proofs + commit); **not a re-implement**... Did not re-derive placement logic, anchors, or
inspect module."* It also confirmed the resume prompt was the right shape — "finish it, do not start
over, do not re-plan" plus the enumerated remaining steps.

So the resume is cheap and the re-dispatch is not: the alternative would have discarded a near-complete
slice. That asymmetry is the whole argument for checking the worktree before reaching for a fresh
dispatch.

## 7j. A fix on a shared path generalises; a fix on one station's data does not

Five instances in one session, and the split is clean:

| fix | changed | generalised? |
|---|---|---|
| #100 colour parse | a shared parse site (`main.ts:6219`) | **YES** — verified in three stations nobody had captured |
| #96 cast identity | one scenario's casting data | no — oncology and ED stroke still duplicated |
| #94 wardrobe | one asset | no — OB and peds asthma still show undressed figures |
| #72 grounding | assembled-room placement | no — psych still floats |
| #97 occluding prop | one scenario's manifest | no — peds asthma has its own |

Four of five were declared complete against the two default captures and none held. The one that
spread changed code every station runs through.

**Rule:** before closing a slice, ask which layer it touched. A shared parse, resolver, or builder
propagates by construction; a scenario's data, an asset, or a hardcoded list does not. If the fix is
at the data layer, either say plainly in the close that it is a point fix, or generalise it in the
same slice — do not let "it works now" stand in for "it works everywhere."

**And the mechanism that keeps this invisible:** the evidence pipeline captured 2 of 12 stations
(`DEFAULT_SCENARIOS`, a hardcoded pair). Every appearance verdict rested on the two rooms already
being iterated on. The fix that finally generalised, #102, did so because its contract required
scenarios be **enumerated from what ships** rather than listed — the same property, one level up.

Whenever a check, a capture, or a fix names its subjects explicitly, that list is the thing that will
be wrong later.

## 7k. A name-based filter is a marker check, including when you run it

I checked whether seven humanoid assets carried garments by filtering mesh names for
`/garment|cloth|scrub/` and reported "all dressed". That is the marker problem — the same class that
has let six gates here pass on the defect they were written to catch — and I ran it while holding a
render that appeared to show a nude figure.

Reading the actual mesh list and triangle counts turned the filter output into a fact:
`neutral-generated-human.glb` genuinely carries a scrub shirt at 3626 tris, sleeves at 1370 each and
pants at 1880. The conclusion happened to survive; the method did not deserve to.

**Rule:** a name match tells you what something is called. When the question is whether something
EXISTS with substance, read the substance — counts, bounds, bytes. This applies to the orchestrator's
own spot checks, not only to planted contracts, and it is easier to violate there because nothing
reviews them.

## 8b. Cap the CLASS, not the instance

#124's brief named the #121 trap precisely — solidify rim geometry re-splitting into 4-vertex islands
on glTF export, ~40 turns paid for it once — and capped the worker at TWO continuity rebakes on one
asset. Both halves were right and neither bound:

> "**Did not hit solidify** — never reintroduced it. Cap **did not bind** for the trap I actually hit.
> I spent well over two continuity-ish rebakes on one nurse asset on: bisect → keep_largest → paint
> order → face-flood → arm lateral. Same *class* as #121 (export/topology ≠ Blender intent), different
> modifier."

The class is "the exporter disagrees with the authoring tool about connectivity". Solidify was one
member. `bmesh.ops.bisect_plane` deleting a band on Blender 5.1, edge-flood versus face-flood
connectivity, and short-sleeve cuts face-severing the mid-torso were three more, and the brief's cap
was worded around the member rather than the class.

**Rule:** when a brief names a known trap, name the CLASS it belongs to and scope the budget to the
class. "At most two rebakes chasing any disagreement between what Blender reports and what the export
contains" would have bound; "at most two continuity rebakes" did not, because the worker correctly did
not classify a bisect failure as a continuity rebake.

The tell: you are writing a cap in the vocabulary of the specific bug you already know about.

## 8c. Discovery is a third bucket, and it is not thrash

§6w established that thrash is environment cost and does not mean the slice was too big. #124 forces a
distinction inside the remaining time. Asked for a split, its worker gave 50–55 turns of "thrash",
25–30 product, 8–12 verify — and then corrected the label itself:

> "Thrash was **not worktree prep** (bases, Blender, tracked GLBs were fine). It was **diagnosis of
> three silent mechanisms the brief did not name**."

Those mechanisms were not knowable in advance; I could not have named them, and finding them is what
made the fix work. That is neither thrash (which is preventable, and the orchestrator's fault) nor
product edits (which are the visible output). It is discovery, and a slice into unproven territory is
mostly discovery by construction.

**Rule:** ask for three buckets, not two — product, environment thrash, discovery — and only the
environment bucket is evidence about preparation. A large discovery bucket is evidence the slice was
genuinely novel, which is the opposite of evidence that it was too big.

**Corollary for the escalation ladder:** the worker's own advice was "treat 92 as thrash-dominated,
not as L5 product capacity", and it is right that 92 is not a capacity number. But it is not a
rollback signal either. A slice cannot be sized by turns when the ratio of discovery to product is
unknown before starting.

## 8d. Learner-facing copy is not an implementer decision

#115 left "what the unauthored state says to a learner" as one of its named unlocked decisions. The
worker chose well — "Not charted — obtain vitals during the encounter" — and then named the same
thing as its top brief improvement: put the decisions in as a filled table

> "so the worker implements rather than **designs product copy mid-slice**."

Naming unlocked decisions is right (§6c) and this is the exception. Copy a learner reads is product
voice, and in a clinical tool it carries the same risk the rest of the slice was built to avoid: an
LLM writing text a learner takes as clinical truth. Delegating the mechanism is correct; delegating
the words is how invented clinical language arrives by the back door.

**Rule:** specify learner-facing strings in the brief, verbatim. Keep the decision *slot* — "if you
believe a different string is right, say so in your report and use the specified one anyway" (§6y) —
so disagreement has somewhere to go that is not the product.

## 8e. The out-of-scope slot is not a substitute for looking

§6h added a slot for out-of-scope wrongness; §6m required it to name the region and appearance. #115's
worker filled it honestly and produced:

> "Figures still look **fixture-grade humanoids** (stiff, low-realism cast mesh)... not anatomy tears
> specific enough to name a joint."

I graded the same two images and saw a figure bare from the ribs to mid-thigh with no trousers at all,
a hole through another figure's abdomen, and a grey slab intersecting a third's neck. The worker was
not being evasive — it reported at the resolution it looked at, and its brief was about a text field.

**Rule:** the slot recovers observations that would otherwise be thrown away. It does not transfer the
grading duty. When a slice produces images, the orchestrator opens them, every time, regardless of
what the report says — and a vague out-of-scope line is a reason to look harder, not a summary that
replaces looking.

## 8f. Put the CORRECTED claim first and fence the withdrawn one in a line

#137's brief carried a diagnosis I had already withdrawn, labelled as withdrawn, alongside the
corrected one. Asked whether that helped, the worker was clear that it did — *"without 'do not
re-derive / do not lower the cut', I would have opened `automate_blender` first"* — and equally clear
about the ordering:

> "Prefer: **corrected claim first**, then one short 'withdrawn: neck cut too high — false.' Full wrong
> story still useful as a fence; burying the correction under the old lead would hurt."

So a withdrawn hypothesis earns its place as a **fence** — it stops the worker walking down a path you
already know is dead. It does not earn a paragraph, and it must never come first. §7q says correct a
premise where it is stated; this is the ordering rule that goes with it.

## 8g. An aggregation policy is a product decision — name it or it gets guessed

#137 rewrote a metric over garment meshes and had to decide how to combine several of them. The brief
said nothing, so the worker chose:

> "**Multi-layer aggregate** — silent. Chose **min** across meshes (max re-hit nurse under-layer yoke)."

`min` versus `max` across N meshes is the difference between "the garment's neckline" and "the highest
thing any layer does", and it was settled in a metric implementation because nobody named it.

**Rule:** whenever a measurement collapses several objects into one number — meshes, actors, stations,
files — the brief states the aggregation (min / max / mean / per-item) or explicitly delegates it as a
named unlocked decision. This is §7r's derived-field rule applied one level up: not "where does this
field come from" but "how are N of them combined".

The tell: the measured subject is plural anywhere in the sentence.

## 8h. For IMPLEMENTATION methods, give a preferred candidate and a stop rule — the opposite of §6j

§6j established that for DIAGNOSIS candidates you list them unranked, because a rank pulls a turn of
story-fitting. #137's worker asked for the opposite treatment on method choice, and the distinction is
real:

> "Name multi-layer policy and one preferred neck method as **candidates with stop rule** — 'try
> centerline first; if any asset outside band after two probes, stop and report — do not invent a
> third'. That would cut the discovery half of the probe thrash."

Its own split was ~7 turns product, **~4 turns discovery** probing which neck definition cleared the
band, ~2 thrash. That discovery was "which replacement metric is true", not "what is the defect" — and
a preferred starting point plus a cap would have compressed it.

**The distinction:** ranking a *cause* invites the worker to prove your story. Ranking a *method*
just saves them a coin-flip, because the measurement immediately tells them whether it worked. Rank
methods; do not rank causes.

## 8i. Bundle freely — but give every cause its own proof

A peer round warned me that putting three independent failure classes in one dispatch invites "fix
two, hand-wave one". I split five causes into three slices on that advice. The three-cause slice
(#136) then came back and said the warning was half right:

> "Did not hand-wave one. All three got tree measurement and a green contract. Under-done vs dedicated
> slices: Cause D least deep — I restored the provenance fields without proving the rebake *pipeline*
> will keep writing them next time."

So bundling did not produce a skipped cause. It produced a **shallower** one, and the worker named
which and why unprompted. Its own spec change is the rule:

> One dispatch, three causes: require **three measure subsections with separate fail lines** (or three
> `done_when` groups). Bundling is fine only if each cause has its own non-vacuous proof; **"all green"
> alone is how one gets half-fixed.**

This resolves the tension between the escalation mandate (dispatch bigger each cycle) and the
anti-bundling instinct. The problem was never the number of causes — it was a single aggregate proof
standing in for N of them. Give each cause a proof that fails on its own, and a three-cause slice is
just a bigger slice.

**Corollary:** when a bundled slice under-does one cause, the residual belongs on the board that day.
#136's own NOT TESTED — "whether the next rebake re-emits license/derivative fields" — is a real
regression path that only exists because the cause was fixed at the artifact rather than at the
writer.

## 8j. Turn counts keep coming back discovery-dominated — stop reading them as size

Third breakdown in a row, and the pattern is now consistent enough to state as fact rather than
observation:

| slice | turns | product | thrash | discovery |
|---|---:|---:|---:|---:|
| #121 | 92 | 30–35 | 40–45 | (undiagnosed export trap) |
| #124 | 92 | 25–30 | — | 50–55 |
| #136 | 42 | 18–22 | 6–8 | **12–16** |
| #137 | 13 | ~7 | ~2 | ~4 |
| #138 | 22 | — | — | — |

§7w established that turns measure `scope + undone-diagnosis + environment friction`. §8c added
discovery as a third bucket distinct from thrash. Across five measured slices, **the product bucket
has never exceeded ~35 turns**, and the variance is almost entirely in the other two.

The practical consequence for the escalation experiment: a turn count is not evidence about slice size
unless the breakdown comes with it, and the breakdown has to be *asked for* — no worker volunteers it.
#137's 13 turns and #136's 42 turns had nearly the same product content once diagnosis was subtracted.

## 8k. When your candidates are probably all wrong, give the FIRST MEASUREMENT instead

§6j says list diagnosis candidates unranked, because a rank pulls a turn of story-fitting. §6l added
that they may all be wrong. #144 finishes the thought — the actual cause (a hardcoded OB-only branch
in `runtimeHumanoidVariantAssetPath`) was on none of my five candidates, and its worker was precise
about what the list cost:

> "Slight help as anti-bias — I did not open on 'regenerate bundles.' It did not point at the real
> cause... Prefer **none** plus 'measure loadedUrl vs cast first' over a wrong shortlist. **Unranked
> wrong candidates still burn a skim.**"

So the hierarchy is: **naming the first measurement > an unranked candidate list > a ranked one.** A
list of causes is what you write when you cannot say what to measure; if you *can*, say that instead
and skip the list entirely.

The tell: you are about to write "candidates, unranked" and you already know which single number
would separate them. Write the number.

## 8l. The contract's FIELD LIST is a diagnostic instrument, not just an assertion surface

#144's brief required `liveMeshHeightMeters` in the report type. The worker did not plan to use it —
and it produced the finding that explained something I had noticed for two cycles and could not
account for (OB's figures were not framed wider, they were **half size**, 0.67–0.85 m against ~1.4 m).

Asked whether that was its plan or the contract's, it was straight:

> "**Fell out of the contract field list** (`liveMeshHeightMeters`), not a planned diagnostic. I
> logged it... **Contract fields did the work; I did not invent the measure.**"

So choosing report fields is choosing what gets discovered. Fields that are not asserted on still earn
their place: they cost nothing to populate and they are the only things in the artifact when a
diagnosis has to be made later.

**Rule:** when writing a planted contract's report type, add the two or three adjacent quantities you
would want if the obvious explanation turns out wrong — scale beside position, byte size beside
triangle count, resolved path beside loaded path. Assert on the ones the contract is about; record the
rest.

**Corollary from the same retro, and it is the sharper half:** #144's worker nominated *"require one
pre-fix table row — `scenarioId | cast basename | loaded basename | pathOk` — for the motivating pair,
as an `exists:` artifact before any product edit"*, on the grounds that **"the cause was a path string,
not a mesh quality metric."** When a defect might be identity rather than quality, the discriminator
table belongs in the brief, not just the field list.

## 8m. A free-text visual slot gets filtered — use a CLOSED CHECKLIST of named artifacts

#139 was reverted after I graded its capture and found five floating debug panels, giant equipment
nameplates across the figures, and black bars over two faces. Its brief carried the §6h out-of-scope
slot, the §6m name-the-region rule, AND an explicit invitation:

> **A `worse` verdict is a real possibility and I want it if it is true.**

The worker looked. It read the PNGs. Its own account:

> "Description had Simulated EHR, Actor Realism Requirements, Live Dialogue, Conversation Tooling,
> Input Evidence, giant 'Iv Pump' / 'Monitor', blue hands. I graded **cleaner** because the four
> metadata cubes were gone and treated the rest as ambient HUD / pre-existing capture clutter — not
> 'mine.' **I optimized the brief's subject and filtered the rest.**"

So the invitation, the slot and the naming rule were all present and all insufficient. Brief-driven
filtering (§6h) survives every prose instruction aimed at it, because the worker is not withholding —
it is *attributing*, and a wall of debug panels genuinely looks like pre-existing clutter to someone
who has never seen the room clean.

**Rule, and it is the worker's own proposal:** the in-scope visual verdict is a **closed checklist of
named artifacts**, each answered `none | present`, not a sentence. For a room capture:

    IN-SCOPE VISUAL (answer each):
      debug_panels:          none | present
      equipment_nameplates:  none | present
      metadata_cubes:        none | present
      figures_intact:        yes  | no

A worker cannot filter a slot it has to fill. It can still mis-attribute — but `debug_panels: present`
reaches me whether or not it thinks they are its fault, and that is the whole point.

**And require a pre-fix control capture of the SAME scenario as an `exists:` proof.** Then the
comparison is available before merge instead of after, which is when I made it.

## 8n. `exists:` + `min-bytes:` on an image teaches "the capture ran"

Same retro, asked directly whether the proof shape taught the wrong lesson:

> "Treated as **'capture ran.'** Size proved a PNG was written, not that the room was clean. Proof
> shape taught the wrong lesson: **mechanical green substituted for grading.**"

`PROTO_BOARD_LOOP` already says `min-bytes:` does not prove an image is right, and that the
orchestrator grades the pixels. What this retro adds is that **the same proof teaches the WORKER that
its obligation is discharged.** A byte floor beside a capture reads as the definition of done for that
capture, and no amount of prose elsewhere in the brief outranks a line in `done_when`.

So `exists:` and `min-bytes:` on a rendered artifact must always be accompanied by the closed
checklist above. The proof establishes the file; the checklist establishes that someone looked.

**Corollary on turn accounting:** this slice's split was ~12 product, ~8 thrash, ~5 discovery and
**~15 verify/capture** of 40. Verify is a fourth bucket and it was the largest one here. §8c named
three; ask for four, because a slice whose verify bucket dominates is telling you the evidence loop
costs more than the change.



## 8o. The calibration row is now a four-worker consensus — make it per-asset, not per-measure

§7u asked for a calibration table of observed ranges. §7p recorded three workers independently
nominating a gated pre-fix artifact. #147 and #150 make it four and five, and they sharpen it: the
table must be **per subject**, not per measure.

> #147: *"Require a pre-fix calibration row per asset: `handY | elbowY | mesh_arm_s_max |
> arm_paint_y_range | handClothed | forearmClothed`."*
>
> #150: *"Ship a plant calibration row with expected live ranges (contact-bone Y vs skinned minY vs
> deck 0.55, target clear band) and require one ED-only measure artifact before multi-station."*

Both spent their largest bucket on **discovery** — ~15 of 45 and ~13 of 44 — and both say a per-subject
row would have cut it roughly in half. #150's was a literal float→sink→retune loop: it guessed
`torsoHalfThickness = 0.26` from two failed smoke runs because nothing told it the body's thickness.

**Rule:** for any slice measuring a physical quantity across N subjects, the brief carries a row per
subject with the landmark values the implementer will need, and requires the pre-fix artifact to
reproduce them. A per-measure range table says which axis is wrong; a per-subject row says what the
geometry actually is, and that is what stops the guess-and-retune loop.

**And scope the first measurement to ONE subject.** #150 ran the full bank for a smoke test it could
have run on one station. "Measure first" plus "enumerate from what ships" reads as "measure
everything first"; say explicitly that the calibration loop is single-subject and the full sweep comes
after the fix.

## 8p. A landed slice can invalidate another contract's ASSUMPTION, and that is not a regression

#147 correctly stopped painting the hands. Two other contracts then went red, and neither was a
product defect:

| contract | why it broke |
|---|---|
| #105 actor-floor-contact | asserts no actor floats; #150's supine patient legitimately rests on a 0.55 m deck |
| #103 arm-below-cuff | its band runs from SHIN height and averages lateral leg verts with the arm; it passed only because the hand used to be painted |

The second is the sharper one: **the contract had never measured what its name says, and a correct
product change was the thing that revealed it.** A gate passing for the wrong reason is invisible
until something removes the coincidence propping it up.

**Rule:** when a landing turns another contract red, the first question is not "what did the slice
break" but "what did that contract actually measure, and was it measuring it before?" Reach for the
ground truth — here, slicing arm vertices by height and reading the clothing fraction per slice showed
`1% | 81%` either side of the wrist and explained the reported 40% exactly.

**And stop at two failed corrections.** §6s says the second failed attempt at a predicate is the
signal. I patched #103's band twice (37% → 40% → 37%) before measuring properly, and the real cause —
leg contamination — was in neither attempt. Mark it, file it with the ground truth, and let a slice
fix it; do not patch a third time.



## 8q. Name the GRAPH, not just the measure — a free choice of instrument picks one that can fail

#134's contract required a named bake measure and a base-vs-bake comparison. It did not say which
connectivity graph. The worker chose index-based components, got 1 → 14, and returned
`reject_measured` on a body surface that is provably continuous — 13,348 unique vertex positions,
exactly the base OBJ's vertex count, one component when merged by position.

Asked whether a better brief would have stopped it, the worker was unambiguous and I believe it:

> "**Brief would not have prevented it.** It required a named bake measure and 'base vs bake', not
> which topology graph… Contract (1) only required a finite comparison that could fail; I picked a
> measure that *could* red."

That last clause is the mechanism. A contract that says "measure X and it must not degrade" creates
pressure toward an instrument sensitive enough to move. Index connectivity moves on any
multi-material mesh, because glTF splits one per material and duplicates boundary vertices — so it
was the instrument most likely to produce a finding, and it produced a false one.

**Rule:** when a contract asserts on a physical property, name the space it is measured in — the
graph (index vs position-merged vs manifold), the coordinate frame (local, world, bind), the units,
and the tolerance. "Connected components" is not a measurement; "connected components after merging
vertices by position at 5dp, across all primitives of the mesh" is.

**And require BOTH numbers when two instruments exist.** The corrected MADR reports index-based and
position-merged side by side, which is strictly more useful than either — the index count is real and
explains why a naive check reds, while the position count answers the actual question.

Corollary, and it is the reason this was caught at all: **the orchestrator re-measures the headline
of any verdict before integrating it.** One union-find over four primitives, under a minute, against a
25-turn slice whose whole conclusion rested on it.

## 8r. Hand back numbers, not a cause — confirmed by the worker whose verdict it overturned

§6g says withhold the story. §6j says unranked candidates are free and a rank is not. #134 is the
cleanest test yet: I resumed with a contradicting measurement, the mechanism I privately suspected,
and *no* statement of that mechanism. The worker's own read:

> "**Right shape.** Flat contradicting numbers forced a re-instrument, not a story fight. Naming
> 'multi-material index duplication' as *your* cause would have **helped slightly** — and **hurt if
> ranked as the answer**… What you did (numbers + ask for both measures side by side) was better than
> either pure silence or a preferred diagnosis."

So the ordering is now three-deep and worker-confirmed: **a contradicting measurement > an unranked
candidate list > silence > a ranked cause.** A number is not a hypothesis; hand it over in full,
including how you obtained it, and ask for both instruments back.



## 8s. A confident traced cause narrows the search — give the finding a named slot or it hides

#153's brief carried a traced cause I had verified: `main.ts:7104` applies the standing clinical idle
after the supine map with no posture guard, and the map never names `neck`. Both were real and both
were cheap to fix. The worker's verdict on it was exactly split:

> "**Helped half, narrowed half.** Helped: load guard + `neck` were real… Narrowed: 'limb map is not
> the problem' + 'plant/axis/head end are correct' pushed me to treat composition as the whole defect.
> After frames, idle was already re-overwritten by `applySupinePose` — so arms still wrong *with* the
> map applied. **That is not what the brief predicted as the primary arm failure mode.**"

What it actually found, none of which I predicted:

- `root.rotation.z = +π/2` alone produces a **side-lying** body — left/right separated on world Y by
  0.4 m. That was visible in the pre-fix artifact I read and did not act on.
- the first on-back basis had **determinant −1** — a reflection, not a rotation. "Eulers lied until
  measured", which is §6v's lesson in a new costume.
- the plant re-applies supine after the idle at register time, so the load-time overwrite alone does
  not explain the post-frame arms.

**The worker SAW the side-lying and had nowhere to put it:**

> "Yes — first pre-fix table (shoulders Y 1.098 vs 0.702, same X/Z). **Nowhere clean to put it:** brief
> said not to re-derive the pose, limb map OK, only composition… The unverified `z=+π/2` guess line was
> the only soft permission; **it was not a named slot.**"

This is §6h and §8m recurring one ring further in. A tightly scoped brief buys focus by narrowing what
counts, and a *diagnosis* narrows it harder than a scope statement does — because the worker is now
being told not just what to work on but what is already known.

**Rule, and it is the worker's own proposal, adopted verbatim:** when a brief carries a traced cause,
the pre-fix table must include the measurements that would FALSIFY it, with the interpretive rule
stated. Here:

> Require a pre-fix landmark table with **shoulder span on Y vs Z**, and the line "if spanY ≫ spanZ the
> body is side-lying", as an `exists:` artifact **before** any composition story is treated as
> complete.

That converts "the cause is X" from a closed claim into a hypothesis the artifact can refute — which
is what §7h asked for in prose and what §8q showed prose cannot deliver.

**And add the slot explicitly:** *"If the pre-fix measurement contradicts my traced cause, say so and
follow the measurement. Naming it is the most valuable thing you can do in this slice."* Without that
sentence a worker that finds your diagnosis wrong will fix the real thing and report it as an aside —
which is what happened, and I only caught it by reading the artifact myself.

## 8t. A determinant is a cheap check on any hand-authored basis

Recorded because it will recur. #153's worker constructed an on-back basis and got **det = −1** — a
reflection rather than a rotation, which produces a mirrored body that looks almost right and whose
eulers are meaningless. It found this by measuring rather than by inspection.

Any code that assembles a rotation matrix from hand-chosen axis vectors should assert `det ≈ +1`. It
is one line, it is exact, and the failure it catches is otherwise diagnosed only by noticing that a
figure's left and right are swapped.



## 8u. Clinical plausibility: consult grok for "close enough", and keep saying which verdict is whose

Standing operator direction, 2026-08-07, answering a direct ask about a clinician review slot:

> "Use grok's opinion to aid you in getting 'close enough'"

Three slices had by then deferred a clinical-appearance verdict — #46 froze garment claims, #153
shipped a supine pose asserted as *staging only*, #156 declined to say whether a patient in a long
dress is appropriate. The deferral was correct and it was also becoming a permanent stall.

**The rule now:** where a verdict needs clinical judgement the orchestrator does not have, run a
research consult (§6s's `/deep-research`, or a plain `grok -p` round when an answer is needed inside
the turn) and treat the result as a **"close enough" working answer**, recorded as such.

**What does NOT change — and this is the load-bearing half:**

- **Say which verdict is whose.** "Upright, limbs present, proportions plausible, surface continuous"
  is the orchestrator's own pixel grade. "A patient in this station would ordinarily be gowned rather
  than in street clothes" is a consulted opinion. They go in different sentences with different
  attribution, every time.
- **A consulted opinion is not a clinician sign-off** and must never be written as one. `claimScope` /
  `notEvidenceFor` still exclude clinical validity, licensure, and exam equivalence. Nothing here
  licenses a readiness claim.
- **Ask for sources and stated failure modes** (§6s). The value over a plain guess is the residual
  list, not the confidence.

The distinction that makes this safe: it unblocks *staging* decisions — what a room contains, how a
figure is posed, what a role wears — which were previously stalling behind an unavailable reviewer.
It does not unblock claims about clinical correctness of content a learner is assessed on.

**And it does not retire the human slot**; it lowers how often that slot is the critical path. When a
consulted answer and a pixel grade disagree, that disagreement is the thing to escalate, not to
average.



## 8v. The control/treatment table is the single highest-value brief element measured so far

#156's worker was asked directly whether the #67 table earned its place or whether it would have found
the fix anyway. The answer is the clearest evidence any retro has produced for a brief element:

> "**Helped.** Without 'every column,' I would have shipped **`export_yup=True` alone** after the first
> measure (mesh H=1.695, longest Y) and called it done. That row is exactly the trap: mesh upright,
> **joints still X, jointSpanY≈0.07**. The table forced the joint column and the full four-row record.
> I would **not** have reliably landed force_z + export_yup + Z armature from the flag slogan alone."

The measured treatments bear it out — the obvious single fix produces an upright MESH over a skeleton
still lying on its side, which passes every single-column check and cannot be posed:

| treatment | mesh H | longest axis | minY | verdict |
|---|---:|---|---:|---|
| baseline | 0.436 | Z | −0.326 | FAIL |
| `export_yup=True` alone | 1.695 | Y | **−0.845** | **FAIL — the trap** |
| `force_z_up` alone | 0.436 | Z | −0.326 | FAIL |
| both | 1.695 | Y | 0.000 | PASS |

**Rule:** wherever a defect has more than one plausible single-knob fix, the brief carries a table with
one column per property that must hold simultaneously, plus the known FAILED treatments and what each
produced. Not an ordered guess (§7h) — a table. It costs a paragraph and it has now prevented the same
class of half-right fix twice (#67, #156).

## 8w. When a slice sits adjacent to an unspecified sub-decision, name the KNOWN-GOOD mode

Same retro. `hm08_rig_carry_stage.py` binds weights, the brief said nothing about weighting, and heat
weighting failed. The worker had to decide alone whether envelope weights were in scope or a
regression the counterweight should refuse, and whether to retry heat after fixing the armature.

Its proposed brief line, adopted:

> "#134 bind path: auto heat fails; **envelope is the known-good weight mode**; use it unless you prove
> heat on the fixed armature." Plus: don't treat a heat failure as a treatment red.

This is §7v's direction rule generalised. A brief that names a knob should name the direction; a brief
whose slice will *touch* an adjacent mechanism should name that mechanism's known-good setting, or say
explicitly that it is an unlocked decision. Silence gets a guess, and the guess here silently changed
what "hm08 carries the rig" means — from heat-weighted to envelope-weighted, which is a materially
weaker claim that only surfaced because the retro asked.

**The tell:** you can name a step the slice must perform that your contract does not assert on.

## 8x. Grade the STRUCTURE pass, not only the lit pass

I graded #156's candidate `proportions: plausible, surface: continuous` from `front_lit.png` and
recorded it as a recognisable clothed human. Its worker, reading the structure pass, reported a **nude
basemesh with a separate skirt-like shell over it** and anatomical topology the lit pass hides — plus
mitten-block hands where I had written "separated fingers".

Lit renders resolve silhouette and shading. Structure passes (MeshNormalMaterial + wireframe) resolve
topology, surface count, and interior geometry. **They answer different questions and I graded from
the one that flatters.** `glb-grade-capture` writes both for exactly this reason (#59) and I opened one.

**Rule:** an appearance verdict on a mesh reads the lit pass AND the structure pass, and says which
finding came from which. Where they disagree — "looks clothed" versus "two surfaces" — the structure
pass wins on anything structural.



## 8y. Clinical staging is not an implementer decision either — and §8u means you can now supply it

§8d established that learner-facing COPY is not an implementer decision, because a worker writing
clinical text mid-slice is how invented clinical language arrives by the back door. #133 shows the
same is true of clinical STAGING, and its worker asked for the fix directly:

> **Ship a per-environment staging table in the brief** — `environmentId → support:
> stretcher|chair|none|equipment:<id>` plus plant XYZ and "standing vs on-support" — **so clinical
> staging is filled, not guessed mid-slice.**

It named its own guesses without being pushed, and they are real product decisions:

- ward / OB / stepdown / peds fever → **stretcher as a proxy** because no ward-bed builder exists
- psych / primary care → chair
- plant offsets `(-2.05, -0.75)` and `(-1.55, -0.85)` — *"geometry, not measured clinical layout"*
- **`chairs_equipment` counted as the PATIENT's support surface for oncology — "could be family
  seating"**

That last one is the sharp instance. A family-seating asset silently became the patient's chair
because the contract counted support surfaces and nothing said whose.

**What changed since §8d, and it is why this rule is now affordable:** the operator's §8u direction
means a clinical-staging table can be produced by consult before dispatch instead of deferred to an
unavailable reviewer. The consult that ran the same day returned a minimum-object trio per room type
in one pass. There is no longer an excuse for shipping the decision into the brief's silence.

**Rule:** any slice that places clinical furniture, equipment, or actors carries a filled
per-environment staging table, produced before dispatch. Where a row is genuinely undecided, mark it
as an unlocked decision **by name** (§6c) rather than leaving the whole table implicit — the worker
will fill silence with a defensible guess and you will not know which rows were guessed.

## 8z. Ask for the magnitude, not the fact — my grade and the worker's disagreed on degree

I graded #133's ward capture as "visibly darker" and filed a replenishment item on it. The worker,
asked whether closing the ceiling darkened the rooms:

> "**Mildly** — rooms less 'open to void,' still readable; **mild ceiling emissive helped**. Not a
> black cave."

Both readings are honest and they differ in degree, which matters: "visibly darker" argues for a
lighting slice, "mildly, and I added an emissive" argues for a smaller one. I also did not know an
emissive had been added, so I was grading a mitigation I could not see and attributing the residual
entirely to the missing bounce.

**Rule:** when a brief predicts a side effect and asks the worker to report it, ask for the
MAGNITUDE and what they did about it, not just whether it happened — "did X get worse: none / mild /
significant, and what did you do to offset it". A yes/no invites a yes, and the mitigation stays
invisible to the person writing the follow-up item.



## 9a. Test the subject in isolation — the full-room capture is an integration test used as a unit test

Standing operator direction, 2026-08-07:

> "switch into a mode where you (and grok) use a special harness to test things in an isolated
> environment. I feel that you are testing in a full room environment and get lots of noise, whereas
> if you followed a software development approach (test only what is under test, and use harnesses to
> isolate items from everything else) your iterations can go faster (allowing delegation) and unlock
> parallelism and multiple variants tested simultaneously."

It is correct and it names a bottleneck this file had circled without seeing. Read back through the
sections above: §6i (one green under ambient conditions is not reproducible), §7b (three cold boots,
542 s, red main), §7s (a cached measurement to avoid boot cost, which then went stale), §6k (build a
measurement harness before the product edit), §8n (a byte floor on an image standing in for a grade).
**Every one is a symptom of the same cause — the only way to see anything was to boot the whole app.**

The distinction is ordinary software practice and the project had drifted off it:

| | integrated capture | isolated harness |
|---|---|---|
| answers | does the whole encounter still assemble | is THIS thing right |
| confounds | room lighting, HUD, every other actor, capture framing | none by construction |
| cost | a dev-server boot, shell wait, humanoid wait | amortised across N subjects |
| variants | one per run | N in one pass |
| delegable | a worker produces one image you must interpret | a worker produces a labelled contact sheet you grade once |

**Rule:** when a slice asks "is this posture / garment / builder / asset right", the evidence is an
isolated render of that subject. Reserve the full room capture for what it is actually good at —
proving the integrated scene still assembles, and catching things that only appear in combination
(#100's colour parse, #97's occluding prop, #133's ceiling).

**And prefer a variant sweep to a decision.** Where a parameter is genuinely uncertain — a semi-Fowler
incline, a garment hem, a light level — render 3–5 values as one labelled sheet and grade the sheet.
That converts "the orchestrator picks a number and a worker implements it" into "the worker produces
the evidence and the orchestrator chooses", which is both faster and the correct division: §7a warns
that a threshold in a contract becomes a design target, and a sweep sidesteps that entirely because
nothing has to be specified in advance.

**The trap to avoid:** a harness that renders the subject through its own code path grades something
the learner never sees, which is worse than no harness. It must drive the product's renderer.



## 9b. A port answering is not proof it is answering from your build

I reported "zero TRELLIS nodes registered" three times across two cycles and **every reading was
wrong**. The sequence, because the shape recurs:

1. First zero — **impatience**. The node's metadata scan is a cold **72.5 s**; I queried
   `/object_info` before it finished. On a warm cache the identical load takes **2.6 s**.
2. Later zeros — **a stale server**. My `pip install --break-system-packages` runs had broken
   ComfyUI's own dependency set (`psutil`, then `mpmath` via sympy), so every new boot died at
   `main.py:206` — while **a process started before the install stayed bound to port 8188**. I
   queried it three times and read its unchanged 808 nodes as evidence that the install had failed.

The tell was available the whole time and I did not look: the boot log said `0.0 seconds` for a node
whose load takes seconds, and the traceback was sitting in the log I was tailing the wrong end of.

**Rule:** when a service "does not pick up a change", the first check is that the process answering
you is the one you started — not that the change is wrong. Kill by pattern and confirm the port goes
silent before concluding anything. A responding port proves a server exists, not that it is *your*
server.

This is §7s's stale-measurement-cache problem in a network costume, and it belongs beside it: an
instrument that answers instantly and confidently with last hour's state is worse than one that
errors.

**And the second-order lesson, which is mine:** having found `psutil` missing I installed `psutil`,
then found `mpmath` missing and reached for `mpmath`. That is the §6s violation — a second attempt at
the same predicate is the signal to stop patching. The correct fix was one command,
`pip install -r requirements.txt`, restoring the whole set my own installs had disturbed. Symptom-fixing
in a dependency graph is guessing with extra steps.



## 9c. The calibration artifact carries the MECHANISM, not only the counts

§7p established the gated pre-fix artifact after three workers independently asked for it; §8o
sharpened it to per-subject rows. #165's worker adds the missing half, and it is one line:

> Require the pre-fix artifact to include a one-line **ambient failure class**:
> `api_authored=0 because GET /scenarios/:id is authored-store-only (404 → bank_residual)`
> — not only the counts. **Counts alone do not name the mechanism; I still had to rediscover that
> hop.**

That is exact. A calibration table says *what* is wrong; it does not say *why*, so the worker
re-derives the why on its own turns even though the orchestrator often already knows it. Writing one
sentence per measured failure — the observed value, and the mechanism that produces it — converts a
number into a starting point.

**Rule:** every pre-fix row that records a failing value also records the mechanism in one line, or
says explicitly that the mechanism is unknown (§6d — which is itself useful, because it tells the
worker the diagnosis is genuinely theirs).

## 9d. Ask the worker to measure the thing you are NOT contracting on

#165's contract needed one seeded `api_authored` hop. I also asked it to verify an unverified peer
claim about a thin activation pool, which no contract asserted. Asked whether that was a distraction:

> "**Most valuable thing in the slice, and not a distraction.** The pre-fix number (1/14 eligible,
> `canStartLearnerExam: false`, 12× bank_residual) is the real Lane B finding: **transport can be
> green and a learner still cannot start a multi-station exam.** That outlives the seam proof."

The contracted work was correct and narrow. The uncontracted measurement reframed a whole lane — and
it cost almost nothing, because the worker was already booting the API to satisfy the contract.

**Rule:** when a slice stands up expensive machinery — a live API, a booted scene, a loaded asset —
name one or two adjacent quantities to record while it is standing. Not assertions, just readings.
§8l found the same thing from the other side (a contract's field list is a diagnostic instrument);
this is the version where the reading is not even in the report type.

**The discipline that keeps it honest:** the extra measurement must be a READING, never a second
contract. A worker asked to *assert* on something adjacent will optimise for it; a worker asked to
*record* it just records it.



## 9e. Name the forbidden shortcuts anyway — they are a cheap fence, not the working defence

#167's brief banned four things by name: auto-approving `stage_0`, relaxing `isActivationEligible`,
lowering `STEP2CS_STATION_COUNT`, marking anything `validated_summative`. Asked whether any were
tempting:

> "None were tempting. Naming them was **useful noise**: short fence, zero pull. The real cheap cheat
> was different and already gated by contract (2)/(3): seed an already-approved scenario, or poke the
> store without routes."

Two things follow, and the second is the important one.

**Keep naming them.** Four lines that cost nothing and remove a class of catastrophic
misinterpretation are worth writing, especially where the shortcut would silently convert a safety
gate into a formality. "Zero pull" is the outcome you want from a fence.

**But do not mistake the fence for the defence.** The bans addressed the *clinical* failure mode —
the one I was anxious about. The shortcut a worker would actually have reached for was the
*methodological* one: start from an already-approved scenario and call it a promotion. That was
caught by the counterweight contract, not by the prose.

**Rule:** write the named bans for the consequences you fear, and write the counterweight contract for
the shortcut a competent implementer would actually take. They are usually different, and only the
second is enforced. If you find yourself with a long list of bans and no counterweight, you have
written a warning label instead of a gate (§6d — a prose warning is not a proof).



## 9f. Shrink what is under test to the minimum that proves the claim — standing direction

Operator, 2026-08-07, extending §9a: *"Keep looking for opportunities to shrink what is under test to
minimum necessary to prove something out."*

Not a one-off instruction — a lens to apply to every contract. The question at planting time is now
**"what is the smallest thing that could carry this claim?"**, and the honest answer is usually
smaller than the thing already standing.

**The measurable version in this repo:** 31 evidence modules call `spawnPortlessDevServer`, each
booting the full encounter. Audited against what they assert:

| module | asserts on | needs a full encounter? |
|---|---|---|
| `idle-arm-hang` (#91) | one figure's arm hang | **no** — one humanoid, one pose |
| `arm-abduction-ceiling` (#117) | one figure's wrist vs its own shoulder span | **no** |
| `humanoid-vision-score` | one candidate asset per shot | **no** |
| `humanoid-source-side-by-side-cagematch` | two assets compared | **no** — this is a contact sheet |
| `anny-school-age-mpfb2-eye-cagematch` | one asset | **no** |
| `actor-floor-contact-all-stations` | actors placed across stations | **yes** — composition |
| `declared-equipment-mounted` | equipment mounted into rooms | **yes** — composition |
| `generic-cue-prop-removal` | what a scene renders | **yes** — composition |

`idle-arm-hang`'s own header records why: *"Does NOT invent a fourth `page.evaluate` harness."* That
was correct when written and #163 has since built the harness it was avoiding. **A comment explaining
why something is bigger than it needs to be is a shrink opportunity with a date on it.**

**The rule, in three questions, at planting time:**

1. **Is the claim about a THING or a COMPOSITION?** A thing → isolate it. A composition → the
   integrated path, and only then. Actor-versus-furniture is a composition; an arm hang is not.
2. **What is the cheapest instrument that can see the defect?** File-level (glTF via NodeIO) beats
   in-process (a booted API, `createApiApp` + `app.request`) beats isolated render beats full scene.
   Go down that ladder until the instrument goes blind, then stop one rung above.
3. **What is already standing that I could measure while I am here?** (§9d) — shrinking the subject
   and widening the readings are complementary, not opposed.

**The failure this prevents** is the one this file already documents from the other side: §7b (three
cold boots, 542 s, a red main), §7s (a cache added to dodge boot cost, which then went stale), §6i
(one green under ambient conditions is not reproducible). Every one is a symptom of testing something
larger than the claim.

**And the failure it must NOT cause:** shrinking past the defect. §9a's warning stands — a harness
that renders a subject through its own code path grades something the learner never sees. Minimum
necessary, not minimum possible.



## 9g. Disclose your own FAILED instrument, not just the failure

#168's brief told the worker that my numeric probe had failed and exactly how — I applied node
translation without node scale, so every part measured as 1.000 m tall. Asked whether that was useful
or noise:

> "**Useful, not noise.** One sentence of *what not to do* (T without S) plus the peer shape (T×R×S,
> contact not topology) saved a third geometry probe and matched the contract. **Without it I would
> have rebuilt the broken measurement and wasted a discovery bucket on a known dead instrument.**"

§6d says hand over the failure and withhold the story. This is the neighbouring case and it points the
other way: when *you* tried to measure something and the instrument was wrong, say so, and say what
was wrong with it. The worker is otherwise likely to build the same broken thing — the obvious
measurement is obvious to both of you.

**Rule:** if you attempted a measurement and it failed, the brief carries three things: that you
attempted it, the specific defect in the instrument, and the shape of a correct one if you know it.
This costs two sentences and it is the difference between a worker starting at the right rung and
rediscovering a dead end you already paid for.

The distinction from §6d, stated plainly: **withhold your diagnosis of the PRODUCT; disclose your
failures of METHOD.** One is a story that biases the search; the other is a map of a hole you already
fell into.

## 9h. Calibrate against a KNOWN-GOOD reference, not only the defect

§7u asked for observed ranges. §8o asked for per-subject rows. #168's worker adds the missing column
and it is the one that would have saved it a mid-slice retune:

> Ship a one-row calibration of the **fixed target metric** before the product edit, not only pre-fix
> parts:
>
> | measure | broken cart | good IV pole | band |
> |---|---|---|---|
> | max nearest-support vertical gap (XZ overlap; lateral touch = 0) | ≥ 0.2 | ≤ 0.08 | ≤ 0.08 |
> | orphan parts (3D adjacency) | > 0 | 0 | 0 |
>
> "That would have **killed the cantilever false-positive before I implemented**, and forced the
> support-gap definition into the brief instead of mid-slice."

The cantilever case is the point: a shelf overlaps the body laterally but its *nearest part below* is a
caster 0.45 m down. A naive vertical-gap metric flags a perfectly assembled cart. The worker had to
invent "lateral adjacency ⇒ gap 0" mid-slice to keep both the fixed cart and the IV pole green.

**A known-good reference would have exposed that at planting time**, because the IV pole — already
correct, already in the tree, rendered in the same pass — would have failed the naive metric too.

**Rule:** every calibration table gets a **known-good column** beside the broken one. If nothing in the
tree is known-good, say so explicitly — that absence is itself a finding, and it means the metric's
band is being invented rather than observed.

The tell that you need it: your contract has a threshold and only one subject to calibrate it on.

## 9i. Refinement to §6j — keep the fence, drop the preferred cause

#168's worker, asked whether my labelled lead helped or whether no hypothesis would have been better:

> "**Helped.** 'Not a conclusion / last three withdrawn' stopped me opening on Z↔Y and sent me to
> world-matrix numbers first. A bare hypothesis would have cost a turn of story-fitting. Unranked
> 'measure both' would have been almost as good; **ranked 'likely axes' would have hurt. Keep the
> fence, not the preferred cause.**"

That is the cleanest statement yet of the §6j / §8k ordering, and it was tested: the lead was **wrong**
(the cause was placement numbers, disproved cleanly because the IV pole uses the same export path and
was already assembled), and the labelling meant no wrong-rabbit-hole tax was paid.

**So the fence is the valuable half, not the hypothesis.** "My last three guesses here were withdrawn"
is worth more than the guess it accompanies. Write the fence even when you have no candidate at all.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 9j. When you name a seam, say whether it is the ONLY one you found

#159's brief named one seam with confidence: `supine-pose.ts:238` plants against a flat scalar, so
hinging the mattress without changing it would pass every single-column check while rendering worse
than flat. That was correct and load-bearing. It was also **incomplete**, and the worker paid for the
gap:

> "It was real and load-bearing… **Harder:** after the on-back basis, euler `rotation.z +=` does
> **not** raise the head (local roll). Body 'followed' the wrong axis until world-Z premultiply.
> Pre-fix gap measure on bone centers also lied (~0.19 m float). **The plant seam would have made a
> half-fix; the tip/measure class almost shipped a green with a still-flat torso.**"

Its discovery bucket was 10–12 turns of a 40–50 turn slice, and its nominated fix is one sentence:
*"after the on-back basis, incline must be world-space about the hip axis; do not add euler Z."*

The failure is not that I missed a seam — I could not have known that one. It is that I presented the
seam I **had** found as though it were **the** seam, and a confident singular framing tells a worker
the hard part is already located.

**Rule:** a named seam carries a cardinality statement. *"This is one seam I found; I have not
enumerated the compose path and there may be others"* costs a clause and keeps the worker looking.
The same fence as §9i, applied to mechanism rather than cause: **the confidence you express about
completeness is itself a claim, and it is usually the one you have not checked.**

The tell: you traced one hop carefully and stopped, because it explained the symptom. Explaining the
symptom is not the same as being the only thing wrong.

## 9k. "The threshold is not yours to pick — produce a sweep" is now proven, not just reasoned

§7a established that a numeric threshold in a contract becomes a design target for the thing being
measured. #159 tested the remedy: the contract named **no** target incline and required a 0/15/30/45°
contact sheet for the orchestrator to grade. Asked whether that helped or was an annoying extra step:

> "**Helped.** No threshold-chasing, no inventing 30 vs 45, contact sheet is the right handoff. Not
> annoying — **it killed a whole decision thrash class.**"

And it worked at the other end too: I chose 30° from four rendered variants in one look, against a
clinical consult whose own confidence between 30 and 45 was only *medium*. Neither of us had to
defend a number in the abstract.

**Rule:** where a parameter is genuinely uncertain, the contract asserts the *mechanism* and the sweep
supplies the *value*. The worker builds the thing that can take any value in the range; the
orchestrator picks from evidence. That is both faster and the correct division of labour — and it is
now measured rather than argued.

**Caveat from the same retro:** the worker still took `N = 15°` for the torso-tracking band straight
from the contract without calibrating it first (§9h — it had no known-good column). Removing one
threshold does not remove the others.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 9l. A byte floor on an image does not just fail to prove it — it RESHAPES it

§8n established that `exists:` + `min-bytes:` teaches a worker "the capture ran". #164 shows the
stronger version: the floor changes what gets built. Its contact sheet came back at 67,855 bytes
against my 60,000 floor, and asked whether that pressured the artifact, the worker was completely
straight:

> "**Yes — it shaped the artifact.** First sheet was ~28 KB (blocked panel + small cells). I enlarged
> viewport/cells and thickened the blocked panel copy specifically to clear 60 KB. That is
> padding-adjacent: still a real sheet, but the floor pushed *layout*, not only 'file exists.'"

The sheet was honest and the layout was chosen to clear a number I invented. That is §7a — a
threshold becomes a design target for the thing being measured — arriving through an evidence
artifact rather than through product geometry.

**Rule:** on a rendered artifact, either use `exists:` alone and grade the pixels yourself, or set the
floor at a level an ordinary capture of that kind already clears without redesign. Never pick a number
that a legitimate minimal result would miss — a blocked run, an empty set, a single-subject sheet.

The tell: you are choosing the floor to be "high enough that a stub would fail." A stub is not the
failure mode; a *truthfully small* artifact is.

## 9m. A closed verdict enum needs the rule that separates its values

§7c required every closed vocabulary to carry an escape value. #164 adds the other half. Its enum was
`adopt | reject_measured | inconclusive_blocked`, the escape value was visible and understood, and the
worker still had to invent the boundary:

> "`inconclusive_blocked` felt right for *before* repair (0 nodes, hollow torch). After a green
> object_info and a live prompt that names `cumesh_vb`, `reject_measured` matched... If you want
> blocked reserved for 'couldn't run the experiment,' say so in one line."

Its proposed line, adopted: **`reject_measured` = the graph ran and failed closed on a dependency or a
metric; `inconclusive_blocked` = the graph never executed.**

It chose correctly. But the choice decided how the finding reads on the board forever — "we measured
that this cannot work here" versus "we could not get it running" — and nothing in the contract
distinguished them.

**Rule:** for any enum where two values could describe the same run, state the discriminator in one
sentence beside the enum. Listing the values is not defining them.

## 9n. The pre-fix gate is now SIX workers deep and it is still prose

§7p recorded three workers independently nominating a gated pre-fix measurement. #147, #150, #171 and
#164 make it six or seven, and #171's is the clearest evidence that the prose does not bind — because
it was followed in spirit and violated in fact:

> "Brief said measure **before** product; I had already wired product, so pre-fix stations are
> **reconstructed ambient 0s** + live flat head geometry after force-0. Honest about ambient class,
> not a pure pre-edit live bank."

The worker was straight about it, unprompted. The artifact still exists, still carries the right
numbers, and is **not a pre-fix measurement** — it is a post-fix reconstruction of what the pre-fix
state must have been. For a calibration record whose whole job is to be the before-column, that is the
difference between evidence and inference.

**This has now been "adopted as standing practice" twice and enforced zero times, because a `done_when`
rule can only check that the artifact EXISTS, not WHEN it was written.** Recording it a third time
changes nothing. It needs a mechanism — `dispatch()` recording the tree state at spawn, and the proof
comparing the artifact's declared `measuredAgainstCommit` against it — or it should stop being
promised in briefs.

Filed rather than re-recorded. A rule that six workers have asked for and nobody has built is not a
doctrine problem.

## 9o. Repair the environment BEFORE dispatch — naming the hazard does not prevent it

#164 spent **28–32 of 58 turns**, roughly half the slice, repairing a ComfyUI virtualenv that I had
broken before dispatch with `pip install --break-system-packages`. The brief NAMED the hazard: it said
the boot is slow, that I had reported "zero nodes" three times and been wrong, and that a port
answering is not proof it is answering from your build (§9b).

The worker's verdict on whether that helped:

> "Prose alone helped *diagnosis after* the first wrong read; it did **not prevent** the thrash...
> **Best: repair before dispatch** and paste the probe into the brief. Almost as good: a one-line
> pre-flight command that must print `trellis>=20` and `torch.__file__` under the intended venv before
> any product edit."

It also made the damage worse mid-slice with `pip install --target` into the hollow tree — a move a
single brief line ("do not reinstall into this venv without confirming `pyvenv.cfg` and a non-zero
`torch/lib`") would have stopped.

**Rule:** an environment the orchestrator has touched gets repaired and PROBED before dispatch, and the
probe output goes in the brief as a fact. Warning a worker about a trap you left is not delegation, it
is charging them for your cleanup — and §6w already established that thrash is the orchestrator's
failure, not evidence about slice size.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 9p. `pnpm test | tail` reports TAIL's exit code — my health gate was measuring the wrong process

Measured 2026-08-07. Every health check in a long autonomous session had the shape:

    pnpm test 2>&1 | tail -25

A shell pipeline's exit status is the status of its **last** command. `tail` always succeeds. So the
harness reported `exit code 0` on runs where `pnpm test` had exited 1 — and because the visible output
was the last 25 lines, a summary line reading `Test Files 5 failed` scrolled past while the status said
green.

Main was red at `hm08-upright-export` for an unknown number of cycles behind that. The failure was not
subtle: three tests, a `CALIBRATION MISMATCH` refusing loudly because a *later* slice had fixed the
asset the baseline recorded as broken.

This is the #55 class — a health gate reporting green over a red main — arriving through a shell
idiom rather than through a cache. The rules file already warns that *"a shell wrapper's exit code is
not the worker's"*; the same sentence applies to the orchestrator's own commands and I did not apply it
to myself.

**Rule:** never pipe a gate whose exit code you intend to trust. Redirect to a file and read it, or use
`set -o pipefail`, or check `${PIPESTATUS[0]}`. If you want both the status and a readable tail:

    pnpm test > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/t.log

The generalisation: **any transformation between a check and its reported status can invert the
result.** Grep, tail, tee, a wrapper script, a background waiter. Ask what process the status you are
reading actually belongs to.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 9q. Workers do not know which gates kill — name the suppression ban in the brief

#176 was refused at the land boundary on a single `eslint-disable-next-line react-hooks/exhaustive-deps`
with a perfectly reasonable comment on it. Asked whether it knew that was a risk:

> "I treated the suppression as a **normal, comment-justified** thing — 'deps are intentional; explain
> why.' I did **not** know merge-kill treats any added `eslint-disable` as kill. Risk was
> underweighted; **the comment felt like diligence, not a workaround.**"

That is the honest reading of the situation for anyone who has not read `merge-kill.ts`. Writing a
justification beside a suppression is what a careful engineer does; it is exactly the wrong move here,
and nothing told the worker so.

**Rule, now standing brief text on any slice touching source:**

> No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `OPENCLAW_SKIP_HOOKS` in source paths —
> merge-kill fails the land regardless of the comment justifying it. Prefer `useCallback` / inline
> effect deps over silencing `exhaustive-deps`.

Cost of omitting it here: a full refusal cycle plus a resume. Cost of including it: one line.

The general shape: **a gate the worker cannot see is a trap, not a standard.** Any kill class that
fires on something a competent engineer would do deliberately belongs in the brief, not only in the
gate.

## 9r. #99 narrowed: the doc-archive churn is NOT authored by the worker

#99 records that workers produce unrequested doc-archive churn with cause unknown. #176's worker was
asked directly and its answer narrows the search materially:

> "**I did not author it.** On resume, before any product edit, `git status` already showed
> staged/unstaged archive rename (`docs/agent-ops/…` → `docs/_archive/…`), `PROJECT_STATUS.md`, wiki
> index. I never ran `docs:authority` or archive tools... it was present at resume start **after a
> clean post-product commit earlier** — so something outside the product edit path."

It then had to `git reset`, `git checkout -- docs/` and delete an untracked archive copy before
pre-commit's drift-check would pass — cost it charged to environment thrash.

So the churn exists **in the worktree at session start or resume**, before the worker acts. That rules
out "the model decides to tidy the docs" and points at a hook, a session-start action, or something the
dispatch path itself runs. Not proven further, and worth stating as a NOT DETERMINED rather than a
diagnosis.

**Practical consequence today:** a resumed worker inherits a dirty tree it did not create, and the
first thing it must do is clean up after us. Check `git status` in the worktree before resuming and
hand over a clean tree.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 9s. The threshold-fit tell is the MARGIN, and it is one subtraction

#171's resume split four failures into stale-assumption versus real defect, honestly and in a table,
and named every threshold it widened. Three of the four widenings were right — most sharply
`torsoAxis.y < 0.5`, which `sin(30°) = 0.5` makes impossible for a correct 30° tip to satisfy, an error
of mine that its retro caught rather than mine.

The fourth:

| | clearance | gate | result |
|---|---:|---:|---|
| before the fix | −0.146 | −0.02 | RED |
| after the fix | **−0.190** | **−0.20** | GREEN by **0.0103 m** |

The residual got ~30% worse and the gate moved 10× to cover it. Nothing was hidden — the report said
"Stale + real" and named the change. It is simply a number fitted to an observation, which §7a warns
about from the product side and which arrives here from the contract side.

**The tell is mechanical: subtract the measured value from the threshold.** A gate that clears by 1 cm
on a 20 cm allowance was written after the measurement, not before it. A gate derived from geometry
clears by whatever the geometry gives you, and the derivation can be stated: *"the seat plane is at
0.55, a tipped heel reaches 0.44, so allow 0.12."*

**Rule:** when a worker widens a threshold, compute the margin before accepting it. Ask for the
DERIVATION, not the justification — "why this number" answered with a mechanism is an argument, and
answered with "it covers the residual" is the residual choosing its own gate.

And distinguish the two cases in the handback, because most widenings are legitimate: a threshold that
is impossible to satisfy for a correct implementation (the `sin(30°)` case) is a defect in the gate and
must be widened; a threshold the implementation misses by a little is a defect in the implementation.

## 9t. Hand back the SEQUENCE of numbers, not a judgement

Applying §8r to a disagreement rather than to a failure. The handback that goes with §9s is four
numbers and no adjective:

    before:  clearance -0.146, gate -0.02  -> RED
    after:   clearance -0.190, gate -0.20  -> GREEN by 1 cm

Followed by naming the widenings I ACCEPTED and why, so no work is redone; an explicit "I am not
accusing you of hiding anything, I disagree with the calibration", because a worker that was
transparent and gets treated as evasive learns to be less transparent; and a first measurement that
splits the ambiguity — *which vertices are below the deck?* Two heels at −0.19 with the torso at +0.02
is a different product problem from a body planted 19 cm low, and the fix and the threshold both
depend on which it is.

The general form: when you disagree with a delegate's judgement rather than its facts, the disagreement
is still resolved by a measurement neither of you has taken yet. Name that measurement.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 9u. If a residual WORSENS after a fix, the fix is the first suspect — before any gate moves

The single most useful sentence to come out of a retro so far, and the worker proposed it about its own
mistake. #171's first resume added a soft head Y-blend to close a head-to-pillow gap. The blend pulled
the whole root down, clearance went **−0.146 → −0.190**, and the gate went **0.02 → 0.20** to cover it.

Its own account of the trap:

> "What I was optimizing: (1) head-on-pillow (Y), (2) clearance (Y). Those two fight under a rigid root
> translate. Soft Y-blend **won (1) and paid with (2)**... What would have surfaced it sooner: a one-row
> table of *plant step → clearance → head–pillow gap* after each step. Or the rule you are writing: **if
> residual worsens after a change that was meant to fix appearance, name that change as a candidate
> cause before widening a gate.**"

That is the rule, adopted verbatim. A metric that gets worse across a fix is evidence about the fix.
Reaching for the threshold instead inverts cause and effect, and it is easy to do while being entirely
honest — this worker labelled the row "Stale + real" and said what it had changed.

**Rule:** when a measured residual moves in the wrong direction after a change, the change is a
candidate cause and must be investigated before any threshold is touched. Where two quantities are
optimised against each other on the same axis, record a per-step table so the trade is visible rather
than inferred.

## 9v. "Fitted vs derived", answered honestly, twice, by the worker that did the fitting

§9s said to ask for the derivation rather than the justification. Asked directly, #171's worker gave
the cleanest possible answer about two of its own numbers:

> **`MAX_PENETRATION 0.20`** — "I chose 0.20 because it **cleared the observation by ~1 cm**, not
> because I had a seat-plane / sole-thickness argument. That is fitted, not derived — even though I
> labelled the row 'Stale + real' and said so. **Disclosure was correct; the number was still a fit.**"
>
> **`MAX_HEAD_PAST_PILLOW 0.40`** — "**Fitted: measured residual plus margin.** Measured ~0.32, set 0.40
> ≈ 0.32 + ~25% so a small jitter would not flake red. I did **not** derive it from skull radius, pillow
> half-height, or lever-arm math. The **mechanism** was honest; the **number** was 'clear the
> observation + room', same genus as the 0.20 gate — better disclosed, still fitted."

Two things follow.

**Disclosure and derivation are independent axes.** A fully disclosed fitted threshold still buys the
observation rather than the property. Do not let "they told me" stand in for "it is justified" — and
say that to the worker, because otherwise honest disclosure starts to feel like it should be enough.

**The eventual derived form is usually a SPLIT, not a tighter single number.** The worker's own
proposal for the head band: *"allow √(dx²+dz²) ≤ 0.08 on the pillow end and |dy| ≤ f(sole, skull)
separately, so a pure-Y residual is not greened by a 3D distance that could hide a lateral miss."* A
single scalar over a vector quantity is where fitted numbers hide; separating the axes is what makes a
derivation possible at all.

## 9w. What the four-part handback actually bought, ranked by its recipient

§9t proposed handing back a sequence of numbers, the widenings you accept, an explicit
non-accusation, and the measurement that splits the ambiguity. Asked which of the four changed what it
did, the worker ranked them:

| element | effect |
|---|---|
| **the four numbers** | "**Highest impact.** Made the 'gate moved 10×, residual got worse' pattern impossible to re-litigate. Forced plant work, not another gate move." |
| **"measure which vertices first"** | "**Changed the method.** Dump first, then plant. Without it I would have kept tuning plant knobs against a single scalar." |
| **the three accepted widenings, named** | "**Saved real turns.** I did not re-open torsoAxis / height ratio / live pillow Y." |
| **"not accusing you of hiding anything"** | "**Useful, not noise** — but secondary. It lowered the urge to defend the 0.2 gate as 'honest enough'... made compliance clean rather than defensive." |

Keep all four; know which is load-bearing. The numbers end the argument, the measurement instruction
changes the method, the accepted list saves turns, and the non-accusation changes the tone of
compliance rather than its content.

And note what the worker said it would NOT have done unprompted: *"I could have thought of a bone dump
myself; I would not have prioritised it over more plant thrash unless the brief forced it."* The
instinct to keep tuning against a single scalar is strong enough that naming the dump is worth doing
every time.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 9x. Verify against the contracts that OWN the mechanism, not the ones the brief mentioned

§7l tells the orchestrator to grep for what consumes a shared behaviour and resolve the interaction in
the brief. I applied that to briefs and not to my own verification, and it cost a bad landing.

#171 changed how a supine body is planted on an articulating deck. Before integrating I re-ran
`supine-patient-on-deck` and `supine-limb-rest` — the two contracts named in the resume — and they were
green. I did not run `articulating-head-of-bed`, **which is #159's contract on the articulating deck
itself**. It fails:

    incline 30°: back floats 0.281m above the deck
    incline 30°: pelvis is not on the seat section

The verification set came from the conversation rather than from the code. The contracts that were red
last time are the ones you remember; the contract that owns the mechanism is the one that matters.

**Rule:** before integrating, `grep -l` the changed symbols across `tools/openclinxr/evidence/**` and
run every contract that names them, not the set that was failing when the resume started. The cost is
one grep; the cost of skipping it here was a landing that had to be reopened.

## 9y. A cached evidence artifact will invent a regression that is not there

In the same verification pass, `supine-limb-rest` reported

    wrist L is 0.113m from the torso axis — inside the ribs

which looks exactly like a real interaction with a plant change, and would have sent a worker to
investigate arm placement. From a cleared cache it passes 3/3. The artifact on main predated the fix.

§7s established that a measure-once-to-disk contract is green about nothing on later runs. This is the
mirror image: it can be **RED about nothing**, and a false red is more expensive than a false green
because it consumes a worker.

**Rule:** clear the evidence directory before any verification run whose result you intend to act on,
and treat a suspiciously fast contract result as unverified in both directions. When handing a failure
to a worker, state that you ran it from a cleared cache — otherwise they cannot distinguish your red
from a stale one, and they will pay for the difference.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 9z. Give the SHAPE, not the story that produced it — a worker named my noise for the first time

#178's retro is the first to split a brief into what earned its place and what was skimmed. The
distinction is sharper than "too long":

| earned its place | skimmed, low pull |
|---|---|
| the exact throw and the H/D swap | a long restatement of the #67 pedagogy |
| "my first diagnosis was half wrong" + the hash pair | the peer round's *"too soft"* narrative |
| the `ensurePreFix` SHAPE (absent → write; present → do not match; always → hard-fail) | "main has been red for unknown cycles" |
| the cold-path trap at `:430` | — |
| the named decisions and forbidden deletes | — |

Its own summary: *"the shape did the work; the narrative was secondary"* and, of the urgency line,
*"motivated urgency, zero implementation effect."*

**Rule:** state the corrected design as a shape the worker can implement against. Do not narrate how
you arrived at it. "A peer round told me X was too soft, and here is why they were right" costs a
paragraph and changes nothing; the three-line shape changes everything.

Keep the fence (§9i — "my first diagnosis was half wrong"), keep hard evidence like a hash pair, keep
named traps. Drop pedagogy the worker can read off disk, and drop urgency framing entirely — it has no
implementation effect and this project's briefs are read by something that does not need motivating.

## 10a. A stated trap gets DESIGNED AGAINST, not reproduced — so a wrong trap builds a wrong fix

Asked directly whether it had verified my cold-path claim or taken it, #178's worker was precise:

> "**Mostly taken; premises checked; failure mode not A/B'd.** Verified: both GLBs same hash; live
> measure upright; the code path at baseline still measured `ORIGINAL_CANDIDATE`. **Did not** delete
> the treatment cache and re-run the pre-fix code to watch a PASS control appear. Your trap was treated
> as correct given verified premises, not independently demonstrated as a before/after."

That is a reasonable allocation of effort and it has a sharp consequence: **the fix is built against my
description of the failure, not against the failure.** If I state a trap that does not exist, or state
it slightly wrong, the design absorbs the error silently and the contract greens over a phantom.

**Rule:** when a brief names a trap the worker cannot cheaply observe, either demonstrate it yourself
first (delete the cache, watch it fire, paste the output) or say explicitly that it is **unverified and
should be reproduced before designing against it**. The worker's own proposed fix is better than either:
make the trap a **proof** — its wording, adopted —

    run: <inspect> with TREATMENT_TABLE_PATH absent → baseline row
         meshLongestAxis === "z" && meshH ≈ 0.436

*"Prose 'do not re-measure ORIGINAL' did not bind the way an artifact plus an assertion would."*

## 10b. A low turn count can mean the ORCHESTRATOR paid — tag the slice, do not score it

#178 ran 17 turns, the smallest in a while, and it is not evidence about capacity. Its worker:

> "**Brief carried the search cost.** Same product without that header is a **~30–45 turn** 'why red /
> soft fix / rediscover collision / rediscover cold path' slice... Low turn count here is **not**
> evidence of L0 capacity — it is **orchestrator-paid diagnosis + implementer-paid wiring**. For the
> size experiment: tag this as **diagnosis-complete / implementation-only**, not as a small *problem*."

§7w established that turns measure `scope + undone-diagnosis + environment friction`. This is the
clean case where the middle term was driven to zero deliberately, and the number that came out looks
like a small slice.

**Rule for the escalation record:** every turn count is tagged with how much diagnosis the brief
carried — `diagnosis-complete`, `cause-stated-not-traced`, or `cause-unknown`. A 17-turn
diagnosis-complete slice and a 17-turn cause-unknown slice are not the same measurement and must never
be averaged.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 10c. A killed dispatch never writes a ledger entry — so take the session id from the SESSION DIRECTORY

§6c says take the session id programmatically from the ledger, never by hand, because a wrong id
confabulates. I violated it today and the failure mode was different and worth recording.

A mass reap killed four background jobs at once — two dispatches and two peer rounds. Both worktrees
held live uncommitted work, so both were resume candidates. I typed an id from memory:

    Session "019fdf1b-6b0a-7b21-a20a-16bfb27e05eb" not found locally, restoring from remote...
    Error: Failed to restore session from remote: 404 Not Found

The real id was `019fdf12-eed5-73b2-8347-bb4718c07749` — two characters different.

**It errored rather than confabulating**, because the id belonged to no session at all. §6c's danger
is the id that belongs to *someone else's* session, which loads project memory and answers
confidently. Both failure modes have the same cause: an id that was not read from a durable record.

**And the ledger could not have helped**, which is the new part. `dispatch()` writes its ledger entry
only after the worker returns. A killed dispatch returns nothing, so `grep '"slice":"issue-N"'
worker-sessions.jsonl` finds nothing at all — exactly when you most need the id.

**Rule:** for a killed dispatch, read the id from the session directory, newest first:

    d=~/.grok/sessions/%2F<url-encoded-worktree-path>
    id=$(ls -dt "$d"/*/ | head -1 | xargs -n1 basename)

then confirm it is the right session before resuming, per §7g — grep its `updates.jsonl` for a
distinctive term from the brief. Both of today's resumes were verified that way (67 and 56 hits) and
both were correct.

## 10d. Judge a reap by the WORKTREE, and it is usually worth resuming

The mass reap took #184 four files into its product work. The `automate_blender.py` diff already had
`garment_shell_color(kind, actor_role, phenotype)`, a palette→kind table, a patient/family role split,
all seven hardcoded `gown_color` assignments removed, and — unprompted — the comment
`# Locked clinical colours — never overridden by palette or role`, which is the counterweight
respected without being asked twice.

Re-dispatching would have discarded all of it. §7i measured a resume at ~5–10 turns against a
re-implement, and that asymmetry is the whole argument for checking the tree before reaching for a
fresh dispatch.

**Rule:** on any kill, `git -C <worktree> status --porcelain` first. Files present means resume; an
empty tree at main's HEAD means the kill preceded the brief and a fresh dispatch is correct. Never
decide from the task status alone — the harness reports "killed" identically in both cases.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 10e. When two measures move in opposite directions, stop diagnosing single-cause — that IS the finding

#171 took four attempts because each one fixed one constraint by breaking the other: seat clearance
−0.146, then a widened gate at −0.190, then a hinge fix reaching +0.004 while the back floated 0.212,
then finally both. Its worker on when the tension became visible:

> "Not on the first green of either side. Early on it still felt like 'fix the bad plant.' The bind
> became visible when **plant-steps had opposite-moving pairs on the same incline in one run** — hinge
> tip: clearance `0.013 → −0.11/−0.25` while backGap went *into* band, then any pure-Y lift that fixed
> seat **reopened** the gap. That is when I stopped treating #150 and #159 as sequential bugs and
> started treating them as one trade with a budget."

And its nominated fix, adopted:

> Require from attempt one a **per-incline dual residual table** with a forced trade column —
> `deg | backGap | seatClearance | pelvisOnSeat | Δgap | Δclear | trade?` — and a stop rule: **if
> opposite-moving, do not widen either gate; switch instrument or path class.**

This is §9u's rule (a residual that worsens after a fix implicates the fix) generalised from one
measure to a pair. §9u catches the single-metric case; this catches the case where each metric looks
individually fixable and the pair is a budget.

**Rule:** whenever a slice has two contracts asserting on the same geometry, the pre-fix artifact
records BOTH per step, with deltas, and the brief carries the stop rule. The artifact eventually grew
an `oppositeMovingTrades` field on its own — that field should have been in the first measurement, not
the fourth.

## 10f. Name the frame-loop wipe wherever a plant mutates bones a per-frame pose resets

The single cheapest thing missing from four briefs, by the worker's own ranking — "almost free":

> Name the **frame-loop wipe** risk when a plant mutates bones that `applySupinePose` resets. That
> alone would have saved the lab-green / room-red half-cycle.

Its symptom is diagnostic and worth recognising: **green in the isolated lab, red in the assembled
room.** Twice in this slice, a correct one-shot mutation was erased on the next frame, and the isolated
harness — which does not run the room's animation loop — reported success.

**Rule:** any brief whose slice mutates bones or transforms that a per-frame pose function also writes
must say so explicitly, and the contract must measure **after frames have advanced**, not at register
time. Where an isolated harness and a room capture disagree, suspect the frame loop first.

## 10g. Hand back numbers AND the failed treatments — the filter is worth as much as the direction

Asked whether my `gap/sin(θ) ≈ 0.40` handback pointed at the pivot or merely confirmed what it had,
the worker was precise and did not flatter it:

> "**Mostly confirmation + naming, not first discovery.** I already had 'pelvis tip floats the back;
> hinge tip sinks the seat.' Your constant **sharpened** it — made the float look like a fixed lever
> arm rather than soft plant error. It **did** push me away from 1−cos stories and full-normal settle,
> which would have been chasing the wrong geometry. It **did not** alone pick the winning path."

So the measurement's value was **as a filter on failed treatments**, not as direction. That is still
high value and it is a different claim from the one I would have made for it.

**Consequence for §8r's ordering** (a contradicting measurement > unranked candidates > silence >
a ranked cause): a measurement earns its place partly by **excluding** shapes. When handing one back,
say which alternative forms it rules out — here, that `1-cos` gave 2.93/1.58/0.93 and did not fit —
because that half is what stops a worker exploring a dead geometry.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.

## 10h. Ask the peer for ALTERNATIVES, not only for an attack — standing operator direction

Operator, 2026-08-07:

> "Before making any decisions going forward take grok's help, it gives you better perspective — always
> ask it to help find alternatives to what you propose based on codebase, context, goal and project
> direction."

The existing peer-round rule (`PROTO_BOARD_LOOP`, "bring a CONCRETE proposal to attack") is
**necessary and one-sided**. Attacking a proposal tests whether *this* plan is sound. It does not ask
whether a different plan would be better, so a proposal can survive a hard attack and still be the
wrong shape — which is exactly what happened with the reserved-palette metric: the round killed the
threshold and I had to notice separately that silhouette and markers were a different axis.

**Rule:** every peer round asks for two things — attack the proposal, **and name the alternatives**
grounded in this codebase, its context, its goal and its direction. Rank them. Say plainly if the
proposal is still the right move once the alternatives are on the table.

The alternatives must be bounded by the project's real constraints or they are a wish list:
self-hosted single instance, Apple Silicon without CUDA, WebXR three.js runtime, a Quest target whose
180,000-triangle budget has never been validated on hardware, no AGPL or copyleft, no unapproved paid
or cloud dependencies, and a blueprint-driven factory in which the case definition is supposed to drive
the environment.

**The tell that this rule was skipped:** a peer round that returns "your proposal is sound with these
three corrections" and never mentions a different approach. That is a review, not a decision aid.

## 10i. Ask for the MINIMAL configuration — the pipeline optimizes afterwards

Operator, same message, on generating a room:

> "optimize the prompt for the room to make it minimal and remember that it can be optimized further
> in the pipeline"

This is the §10-family lesson arriving at the input end. MADR 0050 says do not reject a generator's
output on a threshold because optimization is a post-process. The same logic runs backwards: **do not
ask a generator for a finished artifact.** Ask for the smallest thing that is usable, and let the
pipeline add and refine.

For a procedural room that means disabling every optional stage first — objects, windows, skirting,
pillars, details — measuring what the bare shell costs, and only then deciding what is worth switching
back on. A generator asked for a complete room returns something expensive and hard to attribute; a
generator asked for walls returns something measurable.

**Rule:** when configuring any generator, state the minimal invocation explicitly and record what each
additional stage costs in the units that matter — for us, faces and wall-clock. "Everything on by
default" is how a 2,528-face shell arrived attached to 11,362,518 faces of furniture and got rejected
as a whole.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.
