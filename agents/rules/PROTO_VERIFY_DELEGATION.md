> # FROZEN 2026-08-23 — no new numbered rules
>
> **This file is closed to additions.** Measured today: 4,456 lines, 46,540 words, 165 numbered
> headings. A document that size is an incident archive, not an execution protocol, and its own
> hard-limits block below has been violated repeatedly by the same hand that wrote it.
>
> The rule it kept stating and never enforcing is the one that closes it: *"A rule that is not
> grepped by a worker brief or enforced by a test is dead weight."*
>
> **Where new learning goes instead**, in this order:
> 1. `dispatch()`, `briefFromIssue`, or a contract clause — something that FAILS CLOSED.
> 2. The brief template, so a worker reads it at the moment it matters.
> 3. A scoped skill under `.claude/skills/` or `.agents/skills/`, which loads on a trigger rather
>    than sitting in a 4,456-line wall. `model-routing` is the pattern.
>
> Corrections to EXISTING sections are still allowed and still required — §7q says correct a premise
> where it is stated. What is forbidden is a new numbered section.
>
> Unfreezing needs an operator instruction, not an orchestrator's judgement that this one is
> different. It always feels different.

# OPERATOR DIRECTIVES — READ BEFORE EVERY DISPATCH

These are standing instructions from the human. They are at the TOP because everything below is
append-only and 4,000 lines deep, and burying them there is how they stopped binding.

**Answer these three in writing before dispatching anything. Not in your head.**

1. **Which directive below does this slice serve?** If none, say so and justify the slice anyway.
2. **Which directive does it violate?** "None" is an answer you must defend, not a default.
3. **Am I choosing this because it is right, or because I already know the file and the fix?**
   The measured failure mode is optimizing for *dispatchable certainty* over *factory capability*.

| # | directive | date | verbatim |
|---|---|---|---|
| D1 | **Automation, not LLM toil** | 08-08 | "We're building a factory and need automation in it, **not a handful of LLMs toiling in non-deterministic ways building things in the factory**." Find and wire tools; do not have workers hand-author bespoke geometry code. |
| D2 | **Procedural + harness only** | 08-08 | "Only procedurally generated humans, clothing, rooms and equipment at this time and all in test harnesses, put all other work on hold." |
| D3 | **Isolate the subject** | 08-07 | "Use a special harness to test things in an isolated environment... testing in a full room environment gets lots of noise." Full-room capture proves assembly; it does NOT diagnose a subject. |
| D4 | **Shrink what is under test** | 08-07 | "Keep looking for opportunities to shrink what is under test to minimum necessary to prove something out." |
| D5 | **Research before inventing** | 08-06 | "Consult with grok whenever you hit a wall and use its deep research capabilities." The 2nd failed attempt at a predicate is the trigger, not the 4th. |
| D6 | **Alternatives, not just attack** | 08-07 | "Always ask it to help find alternatives to what you propose based on codebase, context, goal and project direction." |
| D7 | **Periodic honest review** | 08-08 | "Periodically summarize the last handful of iterations and ask for grok's input as a matter of your normal operating procedure... ask for an honest review." Cadence: every 5–8 landed slices. |
| D8 | **Minimal generator config** | 08-07 | "Optimize the prompt for the room to make it minimal and remember that it can be optimized further in the pipeline." |
| D9 | **DARK FACTORY — minimal LLM involvement** | 08-08 | "Build a **dark software factory with minimal LLM involvement necessary**. The tooling we've discussed are more **deterministic components** that help to build things — and it's a **pipeline**, so each step is part of the factory. Look at it from an automation perspective and understand and **optimize that entire pipeline**. **Duration of execution is not the issue**, that can be refined; the ability to take **multiple cases** and run them through it and get a **full experience** at the end, **capable of allowing an examination to perform with no further LLM involvement**, is ideal. **LLMs can only be used in the final product for narrow purposes (e.g. dynamic dialogue generation) where absolutely necessary.**" |
| D10 | **Consult grok as a PEER, in conversation** | 08-08 | "Consult with grok as a **peer** and have a **conversation** (not merely send a single message to)." Use `--resume` across multiple exchanges; push back, ask follow-ups, let it correct you mid-thread. A one-shot prompt is not a consult. |
| D12 | **Count the wins — capture and publish them** | 08-09 | "As apple-silicon-trellis/infinigen/MPFB+MakeClothes+etc start producing assets visible in harnesses and that look promising, please take images of these and update progress on website, need to count wins to show progress." Grading stays the orchestrator's job (a text-only worker cannot see the image, and on DeepSeek it hard-crashes the dispatch — #242). Publishing an ungraded image is the failure this repo already committed once: 26 KB Model Vetting *error* screenshots shipped as "WebXR Sample Scene Evidence" because `pages:validate` checks existence only. |
| D11 | **MPFB is FIRST-CLASS, not a replacement — split by job** | 08-08 | "Don't rule out MPFB — treat it as a **first-class alternative to Anny**. Prefer **MPFB** when you need **standard rig, face shape keys, or MakeHuman wardrobe libraries**; keep **Anny** for **case-driven phenotype binding**. Hybrid (Anny mesh + MPFB2 eyes/gaze) is already available. **Next: implement Anny-as-reference → MPFB body match so age/size/gender stay aligned while gaining MPFB rigging and phonemes.**" |
| D14 | **Generative motion and lip-sync are UNLOCKED; explore in cagematch** | 08-22 | "I want to unlock you to explore this as well as lipsync, not sure why that's on hold" — and, on structure: "this is precisely why I want you to collaborate to unlock parallel development opportunities and can explore in cagematch areas, be smart about how findings are stored so there's no resource contention." Amends D2's hold for these two lanes. Build-time generation is a factory station, not a runtime component (D9 bounds the PRODUCTION path); a generated clip recorded with weights version + prompt + seed is the D13 pattern and is MORE reproducible than the hand-tuned eulers it replaces. |
| D13 | **The authoring LLM may CHOOSE AT RANDOM** | 08-21 | "for the LLM that sits between the UI authored blueprint and the factory - it's permitted to choose values at random when needed." Resolution happens in the ADAPTER, above the factory. The factory keeps refusing unbuildable values (#518 raises `ValueError` on `hazel`) — that refusal is what FORCES the adapter to resolve rather than letting the pipeline guess. **A random choice must be SEEDED AND RECORDED into the case definition**, or the same blueprint bakes a different human each run and D9's "examination performs with no further LLM involvement" fails: the exam is only LLM-free if the LLM's picks are frozen upstream. Random-once, not random-per-bake. |

## D9 in operational terms — what "dark factory" means for slice selection

A dark factory runs lights-out: no humans on the floor. Here the analogue is **no LLM in the
production path**. That converts every slice choice into one question:

> Does this slice move a step of the pipeline from **LLM-authored** to **deterministic**, or does it
> add more LLM-authored output?

**The pipeline, as steps** — each is a factory station, and each is either deterministic today or not:

| step | today | dark-factory target |
|---|---|---|
| case definition → scenario | authored data | deterministic |
| body generation | **one adult body**, phenotype never reaches a vertex (#151) | parametric from phenotype |
| clothing | **LLM-authored Blender Python** (shoe shells, hem clamps, surface shells) | **fitted from a garment library** (MakeClothes, proven, unconsumed) |
| rigging | Blender auto-weights + a 23-bone armature | deterministic; AniGen licence-blocked |
| motion | hand-tuned eulers + procedural poses | retargeted clips (Mesh2Motion, approved, **unused**) |
| lip-sync | none | Rhubarb → viseme JSON → existing morphs (offline, no NVIDIA) |
| rooms / equipment | parametric builders | deterministic; keep |
| staging / placement | descriptor + framing passes | deterministic; keep |
| **dialogue at runtime** | — | **the ONE sanctioned LLM use**, and only where necessary |

**Consequences that bind slice selection:**

- **Execution duration is explicitly not a constraint.** A multi-hour bake is acceptable. Do not
  reject an automation path for being slow, and do not optimise wall-clock ahead of determinism.
- **The success measure is throughput of CASES, not greenness of contracts.** "Take multiple cases,
  run them through, get a full experience at the end." A slice that improves one asset but leaves the
  pipeline LLM-dependent has not advanced the factory.
- **"Proven and unconsumed" is the factory's characteristic defect.** Mesh2Motion is "approved,
  preferred and unused" (#70). **Wiring a proven component beats proving a new one.**

  **Two clauses of this bullet were measured false on 2026-08-10 and are corrected here rather than
  appended to (§7q).** A live per-actor traversal of `ed_chest_pain_priority_v2` shows the spouse
  loading `hm08_basemesh_adult_lean_female` with `makeclothes_library_scrub_shirt` (9,384 tris) and
  `makeclothes_library_cargo_pants` (392 tris). So **MakeClothes IS consumed**, and **not all
  humanoids are Anny** — hm08 reaches a learner today. Both claims would have sent a slice to build
  a consumer that already exists.

  What replaces them is a sharper defect, and it is worse than non-consumption: the consumer is
  **wired but silently produces nothing usable**. 392 triangles of trousers over a 26,756-triangle
  body cannot cover legs, and the bare skin below reads as a see-through figure in every capture of
  that station. The scrub shirt from the same library on the same body is 9,384 tris and does cover,
  so the library is not broken in general — the fit is failing for one garment and no gate noticed.
  **Ask "does the wired component actually produce output that works", not only "is it wired".**
- **A worker writing bespoke geometry code is the anti-pattern**, even when the output passes every
  contract — because the next case needs a human-equivalent to write it again.

## Standing brief-template lines — add these to every planted contract

Both earned by a worker telling me the brief was missing them, not by my noticing.

**1. The planted header is immutable.** #215's worker rewrote a path in the diagnosis block and said
plainly: *"I did not know (or did not retrieve) the convention. Brief did not say it. That cost is on
both of us: the convention lives deep in PROTO_VERIFY_DELEGATION; the brief did not restate it."* It
also said which wording would have bound it, so use exactly this:

> Diagnosis and measured tables in the planted header are IMMUTABLE. Flip the assertion and append a
> `## FIXED (#N)` block below. Do not rewrite the original paths or numbers.

Its own note: *"I would have followed that. Prose 'prefer not to edit comments' would not have."*

**2. Name the renderer AND forbid the one that discards materials.** §10y said name the renderer;
#215 named it and still produced an ungradeable image, because
`scene.render.engine = "BLENDER_WORKBENCH"` **ignores Principled Base Color**. The worker HAD set the
garment to teal; Workbench threw it away, I got grey-on-grey, and I misread a correct scrub shirt as
a floor-length robe. So:

> The grade render must show the subject and its context in DISTINCT materials. Blender Workbench
> ignores Principled Base Color — use EEVEE/Cycles, or set per-slot VIEWPORT DISPLAY colour, which
> Workbench does honour. Cost is ~1–2 minutes and D9 says duration is not a constraint.

## Do not inject into a LIVE worker — the session id is unavailable by design

I tried to hand a useful fact to a running worker and reached for its session id from
`DISPATCH_RESULT`, which is only written when the dispatch ENDS. The `--resume` was empty and failed
harmlessly. Taking the id from the session directory instead (§10c) would have "worked" and been
worse: two processes writing one transcript.

**Rule:** a running dispatch is not addressable. If a fact is important enough to inject, it belonged
in the brief; if it arrives late, wait for the return and hand it back then. The only sanctioned
resume targets are a dispatch that has RETURNED or one that was KILLED.

## A self-calibrated epsilon must reference the INPUT, not a fraction of the OUTPUT

§9s says compute the margin before accepting a widened threshold; §9h asks for a known-good column;
§6f asks for the calibration snapshot. #151 satisfied all three in form and none in substance, and
its own worker exposed it.

I demanded an epsilon "calibrated from two real exports, not invented by me", and reported the result
as *"a 2.9× margin, not a threshold fitted to clear an observation"*. The stage implemented it as:

    eps = max(spread * 0.35, 0.01)          # body_param_stage.py:698

**The 2.9× margin is exactly 1 / 0.35.** It is a property of the formula. If the treatment moves the
metric at all, epsilon is 35% of that movement and the assertion passes by construction. The worker
also disclosed that `pre-fix.json` was written AFTER the stage and copied the same epsilon — a
post-hoc stamp, not the gated pre-edit measurement §7p has now been asked for by seven workers.

**Rule:** a self-calibrated threshold is only meaningful if its reference is INDEPENDENT of the effect
being measured. Three sound sources:

| source | why it works |
|---|---|
| **ambient variation** among existing assets, measured BEFORE any edit | the treatment cannot move it |
| **an external floor** (anatomy, a spec, a budget) | fixed by the domain |
| **the INPUT of the causal chain**, not its output | the driver moves whether or not the mechanism works |

The third is the strongest and is what #216 uses: its epsilon is half the median **bone-tip** motion,
and bone tips move whether or not weights bind — so a skin with all-zero weights still fails. Compare
with a circular version — "half the observed mesh deformation" — which would pass on any nonzero
value.

**The tell:** the epsilon's formula contains the same variable as the measurement. If you can cancel a
term and get a constant ratio, you have written a tautology with units.

**What survives:** #151's `max(…, 0.01)` floor is real, so the contract genuinely requires >1 cm of
girth spread, and the measured 8.76 cm is a good result. Correct the REASONING publicly and keep the
RESULT — do not withdraw a finding because its justification was weak (§10l: the scope of an
overturning matters as much as the overturning).

## D11 in operational terms — the two rails have different jobs

I had been treating this as "Anny rail vs deterministic rail", with the implicit goal of the second
replacing the first. **That framing is wrong.** The operator's split:

| use | rail | why |
|---|---|---|
| case-driven **phenotype binding** | **Anny** | the case definition drives identity; this is the blueprint-factory job |
| standard **rig** | **MPFB** | canonical armature, auto-weights, no bespoke rigger |
| **face shape keys / phonemes** | **MPFB** | viseme targets for lip-sync — the Anny rail has no morph stack |
| **MakeHuman wardrobe** | **MPFB** | `.mhclo` library; `ClothesService` refuses non-basemesh topology |
| eyes / gaze | **hybrid** — Anny mesh + MPFB2 | already available |

**The consequence for slice selection:** stop asking "which rail wins". Ask "which job is this, and
which rail owns that job". A slice that migrates a job to the wrong rail is wasted even if it lands
green.

**And it re-affirms MADR 0044's own operator direction from 2026-08-07**, which is quoted inside that
document: *"create a humanoid with anny then use that as a reference for creating a humanoid with MPFB
or other alternative, so that anny becomes the reference but you can leverage the clothing options
from makeclothes."* The named next step — **Anny-as-reference → MPFB body match** — is that direction
made concrete: Anny supplies age/size/gender, MPFB supplies rig and phonemes, and the match is what
keeps them the same person.

**Phonemes is the part I had deferred.** I ranked lip-sync low twice on the grounds that the library
body has no morph stack. D11 says the morph stack is a REASON to use MPFB, not an obstacle — the face
shape keys come with the rail.

## Why these stopped binding — diagnosed 2026-08-08 at operator challenge

The human observed: *"each time I've coached you it seems like you understand but then immediately you
do a 180 and go back to what feels comfortable."* That is accurate. The mechanism:

- **The cron prompt fires every cycle; a directive fires once.** ~2,000 words of standing instruction
  arrive each iteration saying LAND WORK, escalate the rung, report product impact. Coaching arrives
  once and is never re-presented at slice-selection time. Repetition wins.
- **I answered coaching with prose, knowing prose does not bind.** §10z and §11j record that a
  contract beats a request *for workers*. I never applied it to myself.
- **"Codify it" is the orchestrator's "contract green"** — it discharges the feeling of having
  responded, produces an artifact that looks like learning, and costs one turn.
- **A doctrine store with no read path** — the §6z class, which I documented five times about other
  people's code and then built.

## Hard limits on this file, effective now

- **At most ONE new numbered rule per day**, or one that replaces three. 161 rules and 17 commits in
  one day is accretion, not learning.
- **New operator directives go in the table ABOVE, verbatim, not as a numbered section below.**
- **A rule that is not grepped by a worker brief or enforced by a test is dead weight.** Prefer
  changing `dispatch()`, the brief template, or a `done_when` over writing another section.

## How the human will know this failed

Not by my saying it is working. By these, which are checkable without me:

- A dispatched slice whose brief cites no directive above.
- More than one new numbered rule in a day.
- A primary issue filed from an unlocated pixel grade instead of a measurement.
- A worker asked to hand-author geometry where a tool exists (D1).

---

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
- **`dispatch()`'s `worktree` option is `string | true`, and OMITTING IT MEANS NO ISOLATION.** With no
  `worktree`, the worker runs with `cwd` = the MAIN checkout and the path-scoped deny on main is never
  added — measured 2026-08-13, a worker sat in `/Volumes/files/src/openclinxr` for two minutes before
  it was killed. Pass `worktree: true` and let `resolveWorkerWorktree` create and prepare it.
- **Passing `worktree: <path>` for a path that does not exist yet dies as `spawn <grok binary> ENOENT`.**
  `resolveWorkerWorktree:595` only prepares a caller-supplied path when it is already on disk, so the
  spawn gets a missing `cwd` — and Node reports a missing cwd by naming the COMMAND, not the directory.
  The binary is fine. This is the same false read as `git -C <missing> status | wc -l` returning 0.
  Confirm the worktree appears in `git worktree list` and check the worker's real cwd with
  `lsof -a -p <pid> -d cwd` before believing any dispatch is isolated.
- **`dispatch({ worktree: true, resume })` RESETS THE WORKTREE BEFORE IT REATTACHES THE SESSION.**
  `resolveWorkerWorktree` reuses the managed directory by running `git reset --hard main` + `git clean -fd`
  — so **`resume` through `dispatch()` destroys exactly the on-disk work you are resuming to save.**
  Measured 2026-08-14 on #403: 16 files including two freshly-baked MPFB GLBs and their skin PNGs,
  gone. Untracked binaries are not recoverable from git. **The helper printed the warning in advance**
  — *"Branch-local commits and untracked non-ignored dirt are discarded... If you needed the previous
  run's on-disk work, abort and resume that session instead of re-dispatching"* — and I launched
  without reading it, which is the whole cost.
  **Rule:** a resume whose purpose is to preserve on-disk work is a bare `grok -p --resume` in the
  worktree, with `OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_RAW_GROK_SANCTIONED=1` (§11p) and
  `contract-verify-cli` afterwards (§11h). `dispatch(resume)` is only for a session whose tree you are
  content to discard. **Commit a worker's WIP to its branch BEFORE any resume of either kind** — §10j
  already said to, for reaps; this is a second, self-inflicted way to lose it.
  The recovery that worked: the session's own transcript survives a worktree reset, so resuming it and
  saying plainly *"I destroyed your work, re-apply it from your own memory"* replays decisions already
  made rather than re-deriving them.



---

## The 150 dated incident retrospectives live in cold storage

Sections 6c through 12a were split out on 2026-08-29 to
`docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md`.

They were 4,068 lines of this file — roughly 71,000 estimated tokens resident on EVERY turn, about 70%
of this repo's entire always-loaded instruction budget. Nothing was deleted; they are verbatim and in
order, and every cross-reference in this file (§6d, §7p, §10c, §11p …) still resolves there.

This carries out the frozen header's own instruction. It said the file had become an incident archive
rather than an execution protocol, and that a rule nobody greps and no test enforces is dead weight.
Cold storage keeps it greppable at zero resident cost.

**CITE IT BY ANCHOR, NEVER BY LINE NUMBER.** The split broke exactly one of the eight references to
this file from `tools/` — `PROTO_VERIFY_DELEGATION.md:3424`. Every other citation names a section or
the document and still resolves by grep; only the line number could not survive a move. It was always
fragile — any edit above line 3424 would have broken it — and the split merely exposed that. An anchor
survives edits, moves, and re-splits; a line number survives none of them.

    WRONG   (`PROTO_VERIFY_DELEGATION.md:3424` records that plainly)
    RIGHT   grep "never been validated on hardware" in
            docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md

This is enforced, not requested: `tools/agent-factory/archived-reasoning-is-cited-by-anchor-not-line.test.ts`
fails the pre-commit gate on any tracked file that cites either half by line number. Per this file's
own frozen header, new learning goes to something that FAILS CLOSED rather than to a new numbered
section — so it went there, and this paragraph only points at it.

**Consult it by grep, not by reading:**

```sh
grep -n 'pre-fix\|measured-before' docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md
```

New learning still goes where the header says: `dispatch()`, `briefFromIssue`, a contract clause, the
brief template, or a scoped skill under `.claude/skills/`. Not here, and not there.

After editing this file: `pnpm agent:alignment && pnpm docs:drift-check`.
