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
pipeline, and why remains undiagnosed.** Measure continuity from the exported glTF, never from the
Blender script.

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
