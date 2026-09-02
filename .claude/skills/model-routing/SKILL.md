---
name: model-routing
description: "The operator's model ladders for worker agents and the superagent, with the fallback rule and the probe. Load BEFORE passing `model:` to dispatch(), before spawning any worker or subagent, before opening or resuming a superagent consult, and whenever a dispatch dies on a provider error. Carries what is enforced in code and what is NOT, so a wrong model is never assumed to be caught by a guard. ALSO load before writing that a model is broken, dead, stalled, unresponsive, or returning nothing: LADDER 2026-08-26: deepseek-v4-flash is PRIMARY, flash-vision-exp when an image is needed, ox-alpha only on measured failure and CURRENTLY 404-retired. Also carries why a write-role dispatch on flash needs modelDowngradeReason. ox measured 85% delegation success and 7 of 8 \"ox is down\" claims in one session were the caller's own invocation error (nohup, missing key, buffered json, wrong signature, missing role)."
when-to-use: "ox is down, ox not working, model is broken, dispatch died, 0 bytes, empty response, no_visible_content, stalled, unresponsive, step down a rung, dispatch a worker, pass a model, which model, spawn subagent, resume superagent, ox-alpha, deepseek, grok-4.6, provider died, 402, model fell back, escalate model, worker model policy"
---

# Model routing

> # CAPABILITY FACTS — operator, 2026-08-29. Read before the ladder.
>
> Verbatim: *"deepseek-v4-flash-vision-exp has vision capabilities, grok 4.5 has been
> depreciated and 4.6 is its successor"*
>
> | model | status |
> |---|---|
> | `deepseek-v4-flash-vision-exp` | **HAS VISION.** It is the vision rung. |
> | `grok-4.5` | **DEPRECATED.** Do not route to it. |
> | `grok-4.6` | its successor, and the rung-2 escalation |
> | `ox-alpha` | retired, HTTP 404 since 2026-08-26 |
>
> **This corrects a claim still live in other surfaces of this repo.** Measured 2026-08-29,
> `.agents/skills/grok-worker-monitoring/SKILL.md:86-92` carries a capability table whose
> vision column reads "NO - text only" for deepseek and "VERIFIED" for ox-alpha, and
> `.grok/config.toml:115` states "Deepseek text models are never used for vision content"
> while forcing image tasks to `grok-4-fast`. That blanket claim is TRUE of
> `deepseek-v4-flash` and `-pro` and FALSE of `-vision-exp`; as written it routes every image
> task away from the correct rung. `agents/rules/LEX_AGENTIC.md:77` repeats the same stale
> routing. Those files are grok's; reported to it rather than edited by me.
>
> **The trap this creates:** if `grok-repo-agent-spawn.ts` still forces `grok-4-fast` on
> `requiresMultimodalReasoning`, it may override a correct `model:` argument. NOT VERIFIED —
> I have not read that file. Check before assuming a passed model survives.

> # THE LADDER, as of 2026-08-26 — operator directive, and it INVERTS everything below
>
> > "Promote deepseek flash and flash multimodal (when image is needed) to primary and ox only when
> > those fail"
>
> ## Worker agents AND the superagent
>
> | rung | model | when |
> |---|---|---|
> | **0** | `muse-spark-1.3-contributor` | **OPTIONAL cheapest worker/actor alias** — see the rung-0 note below. 403 until 18+ confirmed. NOT the default. |
> | **1** | `deepseek-v4-flash` | **cheapest default for workers, scouts, scheduled wakes, superagent** |
> | **1v** | `deepseek-v4-flash-vision-exp` | **when the slice genuinely needs the worker to read an image** — sideways, not a step down. This model HAS VISION (operator, 2026-08-29), contradicting the older tables named above. |
> | **2** | `grok-4.6` | **strong/smart** — escalate when flash is not enough (hard slice, UNABLE, measured flash failure). Successor to the DEPRECATED grok-4.5; never route to 4.5. |
> | ~~ox-alpha~~ | retired | HTTP 404 as of 2026-08-26. Do not pass `model: ox-alpha`. |
>
> **Rung 0 (2026-09-02, optional):** alias `muse-spark-1.3-contributor` → wire
> `meta/muse-spark-1.3-contributor`, OpenRouter chat_completions, `OPENROUTER_API_KEY`,
> 1,048,576 ctx. $0.10/$0.20 per 1M vs DeepSeek Flash **DIRECT** official off-peak
> $0.22/$0.66 (api-docs.deepseek.com, 2026-08-28) — cheaper than Flash direct. OpenRouter's
> own deepseek flash ($0.079/$0.159) is cheaper still, but Muse-vs-Flash was compared against
> Flash DIRECT; actor dialogue stays off OpenRouter DeepSeek. Contributor data-use: prompts/
> outputs may train Meta models — synthetic SP only. LIVE 2026-09-02: HTTP 403 until the
> operator confirms 18+ at openrouter.ai/settings/preferences. **Do NOT pass as the default
> worker model until a probe returns 200.** Ranked 0 in `MODEL_RANK` like flash, so a write
> role naming it still needs `modelDowngradeReason`. Flash remains the current default worker.
>
> Rung 1v is CONDITIONAL, not sequential. On an identical text-only probe the vision model spent 730
> output tokens against 135 for plain flash, 5.4x, for the same answer. Pixel grading is the
> orchestrator's job (`pixel-grading`), so a worker needing vision stays rare.
>
> ## ox-alpha IS RETIRED — measured 2026-08-26, so rung 2 is presently dead
>
> Every `--model ox-alpha` call returns **HTTP 404**:
>
> > Thank you for participating in the Stealth Ox Alpha testing period. This model was ZAI's
> > GLM-5.3 Flash. Use it now: https://openrouter.ai/z-ai/glm-5.3-flash
>
> Probed through `direnv exec` with the key present, so this is NOT the missing-key 401 this file
> spends several sections warning about; `deepseek-v4-flash` answered cleanly in the same shell
> seconds later. A dispatch naming it dies before emitting an end event. Measured on #700.
>
> `z-ai/glm-5.3-flash` is what ox-alpha actually was. It is NOT configured in `~/.grok/config.toml`
> and has not been probed here. Adding it is an operator decision.
>
> ## THE GATE WILL REFUSE RUNG 1 ON WRITE ROLES, AND YOU MUST NAME THE REASON
>
> `standard_execution` roles (`xr-systems-architect`, `asset-pipeline-lead`) have policy model
> `deepseek-v4-pro` (rank 1). `deepseek-v4-flash` is rank 0, so `resolveDispatchModel`
> (`dispatch-worker.ts:744`) throws `DOWNGRADE with no modelDowngradeReason`.
>
> That guard exists because five consecutive write slices silently ran flash when the default ignored
> the role, and it is right to demand a reason. **You now have one, and it is a measurement plus a
> directive rather than a preference.** Pass it:
>
> ```ts
> await dispatch(REPO, {
>   slice, role, prompt, proofs, worktree: true,
>   model: "deepseek-v4-flash",
>   modelDowngradeReason: "budget constraints",
>   maxTurns: 200,
> });
> ```
>
> **The reason is `"budget constraints"`, stated by the operator on 2026-08-26.** Use those words.
> Do not substitute a longer justification of your own: the guard asks who decided and why, and the
> answer is the operator and cost. The measured 404 retired ox as a RUNG; it is not the reason flash
> outranks pro on a write role, and conflating the two would leave the field wrong the moment ox
> returns.
>
> **Do NOT drop the `model` argument to dodge the gate.** That routes to `deepseek-v4-pro` by policy,
> which is no longer rung 1. I did exactly that on #700 before this directive and it dispatched on pro.
>
> `role-harness-policy.ts:164` still maps `standard_execution` to `deepseek-v4-pro`. Changing that
> table would move the rung for every consumer including the codex and openai columns, so it is not
> changed here; the downgrade reason is the sanctioned path until an operator says otherwise.
>
> ## What the rest of this file is still right about
>
> Everything below describes ox as rung 1 and is WRONG on that. It remains correct on: the
> 401-versus-outage discipline, `direnv exec` on every dispatch and probe, the three-failures
> trigger, never `pkill -f`, commit AND PUSH worker WIP early, and consults asking for a verdict in
> one call.

Two ladders, set by the operator on 2026-08-23. First available wins; step down only on a measured
failure, never on preference.

## CORRECTED 2026-08-26 — the 10x claim below is WITHDRAWN

The table in the next section is real arithmetic over raw ledger counts, and the conclusion I drew
from it is not supported. Read this first.

The ledger already records a cause classification, `deathCountsAgainstModel`, and using it dissolves
the gap:

| ox-alpha's 21 deaths | classification |
|---:|---|
| 2 | `deathClass: auth` — a MISSING KEY, i.e. my own invocation error |
| 5 | `against=False`, `class=unknown` — including #526's 145-turn death |
| 14 | UNCLASSIFIED, all from 2026-08-23..24, before the field existed |

**Zero ox deaths are attributed to the provider with evidence.** deepseek-v4-flash's only two
classified deaths are likewise `against=False`. So the "10x" compared ox's large UNCLASSIFIED
backlog against deepseek's exonerated pair — the difference measured how much of each model's
history predates the classifier, not how often each fails.

I wrote a "CEILING, not a clean rate" caveat and then published the headline anyway. A caveat under
a table nobody reads to the end is not a correction; it is a hedge.

**A real defect surfaced while checking this:** both `auth` deaths are marked
`deathCountsAgainstModel: true`. An auth failure is a missing `direnv exec` — the caller's error,
never the provider's — so the classifier's polarity is backwards on the one class it can identify
with certainty. Filed rather than patched here.

**What survives, and it is worth keeping:**
- ox does carry the largest absolute death count and every one of the six most expensive deaths
  (145, 84, 51, 23, 10, 2 turns), so a death on a LONG ox slice is expensive whatever its cause.
- Repeated dispatch is death-driven, not brief failure: #608 5 spawns / 4 deaths / 1 completion,
  #594 3/3/0, #526 2/2/0.
- **Commit AND PUSH worker WIP early.** Checked after writing it: 15 branches carried commits on no
  remote, including one at +460. Preservation that is not pushed is not preservation.

## THE MEASURED PRICE OF RUNG 1 — read this before defending ox

Everything below about ox being fine is about INVOCATION errors, and it is still true. This
section is about the residual after those, and it is not small. Measured 2026-08-25 over the whole
ledger (1,277 rows), counting only rows carrying a terminal phase:

| model | dispatches | death % | turns done | **deaths / 1000 turns** |
|---|---:|---:|---:|---:|
| **ox-alpha** | 97 | **21.6%** | 6,630 | **3.17** |
| deepseek-v4-flash | 87 | 2.3% | 6,273 | 0.32 |
| deepseek-v4-pro | 84 | 2.4% | 3,964 | 0.50 |
| grok-4.5 *(DEPRECATED 2026-08-29 — historical row, do not route here; 4.6 is the successor)* | 47 | 0.0% | 1,229 | 0.00 |

**Normalised by TURNS on purpose.** Ox runs the longest sessions (median 65, max 250), so more
exposure could have explained more deaths. It does not: ox still dies ~10x more per unit of work,
on the largest sample in the fleet.

**Every one of the six most expensive deaths is ox** — 145 turns lost on #526, then 84, 51, 23,
10, 2. And repeated dispatch is death-driven rather than brief failure: #608 took 5 spawns / 4
deaths / 1 completion, #594 3 spawns / 3 deaths / 0 completions, #526 2 / 2 / 0.

**Both things are true at once, and the reader must hold both:**

- A sub-60s ox death is still almost always YOUR invocation error — missing `direnv exec`, a
  `nohup` wrapper, a bad signature. Check that FIRST, every time. The eight-incident table below
  is unchanged and still the first thing to run.
- AND ox's residual failure rate is ~10x its alternatives on comparable volume. An unknown share
  of the 21 deaths are those same invocation errors, so **21.6% is a CEILING, not a clean provider
  rate** — but deepseek's 2.3% carries the same contamination, and a 10x gap is not explained by it.

**This does NOT countermand the operator directive.** Ox is rung 1 because it is free and because
the operator said so, and 76 completions including a 250-turn slice say it does real work. What
changes is that the price is now known rather than assumed: roughly **300 lost turns per ~100
dispatches**, concentrated in the long slices where a death costs the most.

**The operational consequence, and it is cheap:** on a long ox slice, commit the worker's WIP to
its branch EARLY and PUSH it — do not wait for a death to think about preservation. Measured this
week: three WIP commits made "so the work is not hostage to the next reap" were never pushed, so
they lived only in a local worktree that a prune would have destroyed. Preservation that is not
pushed is not preservation.

## Worker agents (anything dispatched through `grok` / `dispatch()`)

| rung | model | cost |
|---|---|---|
| 1 | `ox-alpha` | free |
| 2 | `deepseek-v4-flash` | cheap |
| 3 | `deepseek-v4-flash-vision-exp` | cheap, with vision |
| 4 | `grok-4.6` | not cheap, last resort |

> **RUNG 3 IS CONDITIONAL, NOT SEQUENTIAL.** Take `deepseek-v4-flash-vision-exp` ONLY when the slice
> genuinely needs the worker to read an image AND `ox-alpha` is unavailable. `ox-alpha` is itself
> multimodal (verified 2026-08-21 on an image whose filename gave nothing away), so while rung 1 is
> up there is no reason to reach for rung 3 at all. If no image is involved, rung 3 does not apply
> and rung 2 is the fallback. Measured cost of the mistake: on an identical text-only probe the
> vision model spent 730 output tokens against 135 for plain flash, 5.4x, for the same answer.
> Pixel grading is the orchestrator's job (`pixel-grading`), so a worker needing vision is rare.

## Superagent (the standing advisory / ox thread)

| rung | model | cost |
|---|---|---|
| 1 | `ox-alpha` | free |
| 2 | `grok-4.6` | not cheap, last resort |

No DeepSeek rung on the superagent. Its work is judgment, direction and verdicts, and the cheap
tier is not a substitute for that.

## Exactly how to call each one

Aliases are defined in `~/.grok/config.toml`. Use the ALIAS, never the wire model id.

| alias to pass | wire model | endpoint / backend | env key | context |
|---|---|---|---|---|
| `ox-alpha` | `stealth/ox-alpha` | `openrouter.ai/api/v1`, `chat_completions` | `OPENROUTER_API_KEY` | 1,048,576 |
| `deepseek-v4-flash` | `deepseek-v4-flash` | `api.deepseek.com`, `chat_completions` | `DEEPSEEK_API_KEY` | 1,000,000 |
| `deepseek-v4-flash-vision-exp` | `deepseek-v4-flash-vision-exp` | `api.deepseek.com`, `chat_completions` | `DEEPSEEK_API_KEY` | 1,000,000 |
| `grok-4.6` | built-in, no `[model.*]` block | native | bundled auth | `[models] default` |

### A worker slice — always through `dispatch()`, never raw

```ts
await dispatch(REPO, {
  prompt: brief.prompt,       // from briefFromIssue(issue), never hand-written
  slice: brief.slice,
  role: "asset-pipeline-lead",
  model: "ox-alpha",          // the rung, chosen from the ladder above
  maxTurns: 250,
  worktree: true,             // string | true. OMITTING IT MEANS NO ISOLATION.
  proofs: brief.proofs,
});
```

`dispatch(repoRoot, options)` takes TWO arguments. `worktree: true` is what adds the path-scoped deny
on the main checkout; without it the worker runs in the main tree.

### A consult, probe, or handback — raw `grok -p`

Per the Grok CLI's bundled headless-mode guide, which ships with the CLI install OUTSIDE this
repo (14-headless-mode.md under the grok user-guide directory in $HOME). The env prefix is NOT
optional: a bare
`grok -p` outside the sanctioned path skips the worker guard and the chokepoint denies it.

```bash
OPENCLINXR_RAW_GROK_SANCTIONED=1 OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1   ~/.grok/bin/grok -p "<prompt>"     --model <ALIAS>     --output-format json     --max-turns <N>     --cwd /Volumes/files/src/openclinxr
```

Flags that matter, all documented in that same bundled guide: `-p/--single` is the prompt and TAKES IT
AS ITS VALUE (`-p "<prompt>" --resume <id>` is correct; `-p --resume <id> "<prompt>"` aborts silently
and still exits 0). The answer is in `.text`, never `.result`, which is always null. `-r/--resume <ID>`
continues a thread; `--reasoning-effort` accepts `none|minimal|low|medium|high|xhigh|max` and a model
only accepts what its own menu advertises.

### Never

- Never set `RUST_LOG` or a debug file. Grok logs the bearer token in plaintext.
- Never `pkill -f grok` while any worker is live. Kill by PID.
- Never rotate models mid-fire to "try again". Step down once and record it.

## DIAGNOSED 2026-08-24 at the fourth death — two mechanisms, and the ladder is the real cost

Write-up + grok-4.6 consult + the discriminating grep, per the rule below. **This replaces every
earlier theory in this file.** Ox deaths are bimodal and the split is two distinct mechanisms:

**FAST (13–29 s) — the dispatch parent has no `OPENROUTER_API_KEY`.** `dispatch()` spawns with the
environment you hand it. Verbatim: *"Auth recovery succeeded but 4 authenticated inference requests
were still rejected (401)… Turn ran 7s wall-clock."* issue-608 is the control: 13 s/401, then with
only the environment changed, 409 s and a different error.

### ALWAYS launch through `direnv exec` — never reconstruct the environment by hand

```bash
direnv exec /Volumes/files/src/openclinxr env \
  OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_RAW_GROK_SANCTIONED=1 \
  pnpm -s exec tsx <your-dispatch-script>.mts
```

**Why this and not an export.** Every Bash tool call is a fresh NON-INTERACTIVE shell: no direnv hook,
no `~/.zshrc`, no key. The project's `.envrc` is `use mise`, and `mise.toml [env]._.file` loads
`.env.local` — which `.envrc` itself labels as the only place secrets belong: *"Secrets live in
.env.local (gitignored)… do not put API keys in this file."*

**An earlier version of this section told you to `grep ~/.zshrc` for the key. That was my workaround
and it is wrong.** It reads a file the project explicitly forbids for secrets, and it goes stale
silently the moment `.env.local` is rotated while the shell profile is not. Measured 2026-08-24: the
two happened to be byte-identical (`sha fc172a53`, both 73 chars), so the value was fine and the
METHOD was not. Do not depend on that coincidence.

Confirm before a long run — the dispatch script should print it, and it costs nothing:

```ts
console.log("key present in dispatch parent:", process.env.OPENROUTER_API_KEY ? "yes" : "NO");
```

**SLOW (161–1769 s) — a provider empty on the FIRST inference, amplified by the retry ladder.**
From `~/.grok/logs/unified.jsonl` for the 409 s issue-608 session:

```
empty_response events : 15        max_retries exhausted
distinct sampler ids  : 1         ONE request retried — no context accumulation
first attempt         : 00:31:34  spawn was 00:31:18 -> 16 SECONDS in, turn ~1
last  attempt         : 00:38:06  the 409s is ENTIRELY the ladder
```

**The model returned empty on the first call. The harness then spent 6.5 minutes retrying the
identical request 15 times.** This rules out accumulated context (one sampler id), prompt shape and
tool-looping (never reached turn 2), and turn depth. **Elapsed time measures the ladder, not the
fault** — so never read a long ox death as "it was working for a while".

### The delegation approach, changed at death #4

1. **Launch every dispatch and consult through `direnv exec`** (form above). Kills the fast cluster
   outright, and does not go stale when `.env.local` rotates.
2. **Kill on the FIRST `empty_response`.** Do not let 15 retries run — that is a 16 s failure wearing a
   409 s costume. Fresh session only; never `--resume` an empty.
3. **Consults: `--max-turns 1`, ask for a VERDICT, new session every time.** The measured consult death was
   a 4-call, 479,107-input-token path.
4. **Workers: keep `model: "ox-alpha"`, `maxTurns: 200`.** Do NOT cut maxTurns to treat a first-turn
   empty — the two are unrelated, and 56 dispatches completed including one at 250 turns.
5. **After a slow death, run the OXPROBE.** Probe dies → step to `deepseek-v4-flash` and record it.
   Probe lives → re-dispatch the slice once, fresh session, same model.

### The discriminator, if this recurs

```bash
grep <sessionId> ~/.grok/logs/unified.jsonl | grep empty_response
```

Read `attempt`, the timestamp against spawn, and `sampler_request_id`:

- attempt 1 within seconds of spawn, one sampler id → **provider empty at ambient context** (this case)
- attempts climbing over minutes → retry amplification, which is duration only
- empty only after many tool turns → accumulated context, a different fix
- no `empty_response` line at all → a third mechanism; stop theorising from the ledger

## FOURTH DIAGNOSIS, 2026-08-25 — the deaths track TRANSCRIPT SIZE, not provider health

Three `Provider returned error` deaths on #526 in one afternoon, and the discriminator rules out
every previously documented mechanism:

| # | session | died at | empty_response events |
|---|---|---|---:|
| 1 | dispatch 568bd27e | **turn 1** | 0 |
| 2 | dispatch 130ba229 | **turn 145**, after 145 good turns producing 19 correct files | 0 |
| 3 | `--resume` of 130ba229 | **immediately** | 0 |

`OXPROBE` returned `OXPROBE` / `end_turn` before AND after all three, through `direnv exec`, with
the key present. So this is NOT the 401 class (§ the key was there and the error text differs), NOT
the empty-response-plus-retry-ladder class (zero such events), and NOT provider downtime (the probe
works either side of each death).

**What correlates is accumulated context.** A 1-turn probe is tiny and always survives. Death 2 came
deep into a long session. Death 3 was a `--resume` of that same 145-turn transcript, which re-sends
the whole thing, and it died before doing any work. That is the "empty only after many tool turns →
accumulated context, a different fix" row of the discriminator, arriving as a hard provider error
rather than an empty.

**INFERRED, not proven** — I have not measured the transcript byte size at each death, and doing so
is the next step if this recurs.

### The approach change

**Do not `--resume` a long session after a provider death.** Commit the worker's WIP to its worktree
branch (§10j), then start a **FRESH session in the same worktree** with the state in the prompt —
`grok -p` with `--cwd <worktree>` and NO `--resume`. The committed tree carries the context the
transcript was carrying, at a fraction of the tokens.

**Do not reach for `dispatch({worktree: true})` to do that** — it runs `git reset --hard main` and
would discard the WIP commit you just made to protect the work. Bare `grok -p` with the env prefix
(§11p) does not touch the tree.

**A death after many productive turns is not a rung failure.** Measure what landed before treating
it as one: death 2 left a working generator, a locality fixture, a locality contract, an isolated
capture script and 14 rebaked rooms. Stepping down a rung there would have been a step down from a
model that was working.

**Consult still owed.** The three-failure rule requires a peer consult on the write-up, and this
entry records the diagnosis and the approach change without it. Do that before the next long
dispatch.

## THREE OX FAILURES = STOP GUESSING. Write it up, consult, change the approach.

**Operator directive, 2026-08-24.** Counting from the ledger's `died` rows for `model: ox-alpha`,
**three failures is a hard trigger.** At the third, you do not re-dispatch, you do not invent a fourth
theory, and you do not step down a rung and move on. You:

1. **Write a complete write-up.** Every ox death with its ledger timestamp, the elapsed
   spawn→death, the verbatim stderr, what changed between attempts, and what you already ruled out.
   No summarising — the exact error strings, because they have differed every time.
2. **Consult grok with it** and ask for a diagnosis and a concrete change to the delegation approach,
   not reassurance. Ask for the cause ranked, and say plainly which of your own hypotheses you have
   already been wrong about.
3. **Update the delegation approach here** with what comes back, and record which attempt number the
   change was made at.

**Why this exists.** Between 00:24 and 00:38 on 2026-08-24 I produced four ox dispatch deaths and a
different theory for each — provider fault, then missing key, then "the key fixed it", then a fourth
error entirely. Two of those theories went into THIS FILE as guidance and had to be retracted. The
pattern is generalising from one death, and it is worse than useless because it writes false rules.

**One death is an incident. Two is a coincidence. Three is a defect you do not understand, and the
correct response to not understanding something is to stop and find out.**

## OX IS PRIMARY FOR EVERYTHING DELEGATED — and you must ask for it BY NAME

**Operator directive, 2026-08-24: "Ox should be primary for everything you delegate."**

Passing no `model:` does NOT get you ox. It gets you the role's policy model:

```
MODEL_RANK = { deepseek-v4-flash: 0, deepseek-v4-pro: 1, grok-build: 2 }   <- ox-alpha is ABSENT
role asset-pipeline-lead -> standard_execution -> deepseek-v4-pro
```

Measured 2026-08-24: `dispatch(root, { role: "asset-pipeline-lead", … })` with **no** `model:` spawned
`issue-608` on `deepseek-v4-pro`. The role policy silently outranks the operator ladder whenever the
argument is omitted, and the earlier guard's advice — *"drop the model argument and let policy fill
it"* — routes AWAY from ox. That advice resolves a downgrade error; it does not honour this directive.

**So every dispatch names it:**

```ts
await dispatch(repoRoot, {
  slice, role, prompt, proofs, worktree: true,
  model: "ox-alpha",          // REQUIRED — omitting it routes to role-policy deepseek
  maxTurns: 200,              // stage under the ~300 empty-response zone
});
```

`ox-alpha` is not in `MODEL_RANK`, so it is accepted by being **unrecognised, not approved** — no
`modelDowngradeReason` is demanded and no guard will catch a wrong value. **This file is the
enforcement.** A dispatch whose ledger row shows a model other than `ox-alpha` without a recorded
measured failure is a defect, and the ledger is how you check:

```bash
grep '"phase":"spawned"' .openclinxr/openclaw/worker-sessions.jsonl | tail -5   # read the model field
```

Step off ox only on a measured failure from the list below, and record which rung you landed on.

## Before you say ox is down — it was you seven times out of eight

Measured 2026-08-23 across one session. `ox-alpha` as a DELEGATION channel, whole ledger:

```
completed 56 | died 10   ->  85% success
including issue-576 at 250 turns, which produced a landed fix
```

As a CONSULT channel the same day: `OXPROBE 43` against `ls`=43 in 24 s, a 515-byte direction check
answered in 89 s, and a 4 KB brief answered with 22,774 output tokens. **Ox works on both surfaces.**

In that same session I claimed "ox is not working" or stepped down a rung **eight times**. Seven were
my own invocation. Run this list before touching the ladder — every row is a real incident:

| symptom I saw | what it actually was | the tell |
|---|---|---|
| 0 bytes, 5 consults in a row | `nohup … &` around the call — `PROTO_VERIFY_DELEGATION:1501`, *"wrapper exits 0, log is 0 bytes"* | the harness backgrounds for you; a second layer detaches it |
| `http_status: 401`, auth rejected | the key comes from `.env.local` via mise/direnv and is **absent from every fresh non-interactive shell** | launch through `direnv exec`; never grep a shell profile |
| 0 bytes at 90 s, "it stalled" | `--output-format json` **buffers until completion** | byte count is not a first-token signal; read the session dir |
| `Cannot read properties of undefined (reading 'proofs')` | `dispatch(repoRoot, options)` takes **two positional args** | see `orchestrator-dispatch-loop` §Signatures |
| `role is required` | I omitted `role` | the error names the prior incident (#441-#447) |
| `DOWNGRADE with no modelDowngradeReason` | role policy outranks a bare `model:` | name the reason or drop the argument |
| `no_visible_content` | **4 model calls × ~120k = 479k total.** A single call at 139k succeeded the same hour | multi-turn consults re-send the prefix each call; see below |

**CORRECTED 2026-08-24, hours after this section was written — the claim it replaced was mine and
was false.** I wrote here that `dispatch()` sources the key "so workers run while my bare calls 401",
and that a sub-60 s death was a provider fault worth stepping down for. Both are wrong.

`dispatch()` spawns the worker with **whatever environment you hand it**. It does not read `~/.zshrc`.
Every ox dispatch death on record has the same cause:

```
Auth recovery succeeded but 4 authenticated inference requests were still rejected (401);
giving up after 3 retries. Turn ran 7s wall-clock.
```

| slice | ox outcome | what I called it | what it was |
|---|---|---|---|
| issue-605 | died, fell back to flash | provider fault | **401, missing key** |
| issue-607 | died 15 s, fell back to flash | provider fault, "the 15% tail" | **401, missing key** |
| issue-608 | died 13 s | provider fault | **401, missing key** |

Exporting the key and changing nothing else, issue-608 spawned on `ox-alpha` and ran. **So export it
in the dispatch parent shell, exactly as for a consult:**

```bash
direnv exec /Volumes/files/src/openclinxr env \
  OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_RAW_GROK_SANCTIONED=1 \
  ~/.grok/bin/grok -p "$(cat brief.md)" --model ox-alpha --output-format json --max-turns 1
```

**Never `grep` a shell profile for the key** — secrets live in `.env.local` via mise/direnv, and a
profile copy goes stale silently when that rotates.

**Consequences for the numbers above.** The `10 died` in the ledger is not a provider characteristic;
it is this defect, counted. **Ox's true failure rate is UNMEASURED** — every death on record has a
known non-provider cause. Treat the 85% as a floor, not an estimate.

**And there is no known genuine ox failure signature.** A sub-60 s death means check the key first.
Do not step down a rung on one until you have seen a death with the key demonstrably present.

**Never write "ox is down" without pasting the probe output next to it.** The probe is 24 s and
settles the question; an assertion without it has been wrong 7 times out of 8.

### The consult-shape rule this session added

`consult-session-hygiene` watches `inputTokens ÷ modelCalls` and alarms at 150k. The failure above
was at **119.8k per call — below the alarm** — because the damage is in the PRODUCT, not the
quotient: four calls re-sending the prefix reached 479k total.

The prompt shape chose that. Asking a consult to *"attack this specifically"* and *"disagree if the
evidence does not support it"* invites tool use and iteration; asking for a **verdict** returns in one
call. **Consults ask for a verdict. Investigation is what a dispatched worker with a worktree is
for**, and a generous `--max-turns` on a consult is a licence to accumulate, not a safety cap.

## Stepping down — the rule

A rung is abandoned on a MEASURED failure, and the measurement goes in the wake BLUF:

- provider `402`, an auth failure, or a non-retryable `400`
- a dispatch that dies without turns (check the ledger's `phase: "died"` and the elapsed time; an
  immediate death is a provider fault, a late one is usually the slice)
- the first `no_visible_content` in a turn, which is a fire alarm rather than a transient
  (`consult-session-hygiene`)

Pick rung 3 only when the slice genuinely needs the worker to read an image. Pixel grading stays
the orchestrator's job (`pixel-grading`), so needing vision is rare.

Never rotate models inside a running loop fire to "try again". Record the failure, step down once,
and say which rung you landed on.

## THERE WAS NO OUTAGE — the 401 was a dropped `direnv exec` (2026-08-24, the 8th of 8)

**Withdrawn in full, and rewritten here rather than appended, because the next reader starts at the top.**
I recorded an `ox-alpha` outage on two reproducible HTTP 401s and stepped the whole worker lane down to
`deepseek-v4-flash`. That was wrong. ox-alpha was never down.

**The control/treatment that settles it** — same prompt, same env vars, same `--cwd`, same model, one
difference:

| invocation | result |
|---|---|
| `~/.grok/bin/grok -p … --model ox-alpha` | `401 — Auth recovery succeeded but 4 authenticated inference requests were still rejected` |
| `direnv exec <repo> env … ~/.grok/bin/grok -p … --model ox-alpha` | `{"text":"OXPROBE","stopReason":"end_turn"}` |

And confirmed from outside the CLI entirely: `GET /api/v1/key` → **200** (valid, `is_free_tier: False`,
no limit), and `POST /api/v1/chat/completions` with `stealth/ox-alpha` → **200** with a real completion
from provider `Stealth`.

**Why the error message misleads.** *"Auth recovery succeeded but … still rejected (401)"* reads like an
upstream entitlement problem, so it invites exactly the wrong diagnosis. It is the CLI's own auth-recovery
path failing because `OPENROUTER_API_KEY` was never in its environment. **A bare `grok` has no key.** The
operator flagged this in as many words — *"your shell doesn't have access to the ox key by default, it's
in direnv"* — and `direnv exec` is codified as the canonical dispatch form for precisely this reason. The
two dispatches that landed #26 and #175 both used it; the two calls that "failed" both dropped it.

**The rule this earns, and it is the cheap one:** before writing that any model is down, run the SAME
command through `direnv exec` once. Seven seconds. Then, if it still fails, hit the provider's own HTTP
endpoint with the key to separate *your CLI* from *their service* — those are different failures with
different fixes, and the CLI's error text does not distinguish them.

**No step-down was warranted.** Workers stay on `ox-alpha`.

## `direnv exec` or the ladder lies to you — measured twice

**Both times I "found" an ox outage, the first symptom was a 401 and the first symptom was mine.**
A bare `pnpm exec tsx` / `grok` inherits **no** `OPENROUTER_API_KEY`; `direnv exec . <cmd>` supplies it.
The empty-string sha is `da39a3ee` — if a key hash reads `da39a3ee`, there is no key.

Every dispatch and every probe runs as `direnv exec . …`. Without it the failure is an auth
rejection dressed as a provider fault, and the ladder steps down for nothing.

**The tell that a step-down is real: the error CHANGES when you add `direnv exec`.**
2026-08-24, in order: `401 ... 4 authenticated inference requests were still rejected` (mine) →
add `direnv exec` → `Provider returned error` (theirs). Only the second is a measured rung failure.

### 2026-08-24 — ox-alpha rung DOWN, control/treatment in the same shell

| model | invocation | result |
|---|---|---|
| `ox-alpha` | `direnv exec` + raw `grok -p` | `Provider returned error`, **2 of 2** |
| `deepseek-v4-flash` | same shell, same second, same flags | `DSPROBE`, clean |

Same env, same key, same minute — the fault is the rung. Dispatched `#126` on rung 2.
Re-probe ox before assuming it is still down; it recovered mid-test once already (`#631`).

### `dispatch()` refuses a downgrade without a reason, and it is right

`role: "asset-pipeline-lead"` is `standard_execution` → policy model `deepseek-v4-pro`. Passing
`deepseek-v4-flash` throws unless `modelDowngradeReason` is set — *"Five consecutive write slices
silently ran flash because the default ignored the role."* Put the MEASUREMENT in that field, not
a preference.

## Probe before a long dispatch

A text echo proves nothing. Use a turn that must call a tool and whose answer you can check:

```bash
OPENCLINXR_RAW_GROK_SANCTIONED=1 OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 \
  ~/.grok/bin/grok -p "Count the files in the current directory using ls, then reply with exactly: OXPROBE <count>" \
  --model ox-alpha --output-format json --max-turns 4 --cwd /Volumes/files/src/openclinxr
```

Compare the count against `ls <repo> | wc -l`. All four rungs measured 2026-08-23 against a ground
truth of 43, identical prompt, `--max-turns 4`:

| model | exit | wall | answer | output tokens |
|---|---|---|---|---|
| `ox-alpha` | 0 | 34 s | `43` | 218 |
| `deepseek-v4-flash` | 0 | 13 s | `43` | 135 |
| `deepseek-v4-flash-vision-exp` | 0 | 18 s | `43` | 730 |
| `grok-4.6` | 0 | 24 s | `43` | 157 |

Every rung is LIVE. **The `402 Insufficient Balance` on DeepSeek recorded in `PROJECT_STATUS.md` no
longer reproduces** — both DeepSeek rungs answered here. Treat that 402 as a historical incident, and
re-probe rather than assuming it when a dispatch fails.

`ox-alpha` also held a 50+ minute worker (issue-576, session `ef42e49d`, 572 session lines) without
dying, so rung 1 is proven under sustained load and not only on a cold probe.

`grok-4.6` was the only rung that did not follow "reply with exactly" literally — it prefixed a
sentence of narration before the required string. It answered correctly. Worth knowing if you parse
a rung-4 reply with a strict matcher.

## What is NOT enforced — do not assume a guard catches you

**`ox-alpha` appears in zero executable files.** Grep `packages/openclinxr/agent-loop/src/` and
`tools/openclinxr/openclaw/` and it returns nothing. Consequences:

- `role-harness-policy.ts:157-183` still maps tiers to `deepseek-v4-flash` / `deepseek-v4-pro` /
  `grok-build`. Its `codex` column pins `gpt-5.4` / `gpt-5.5` while the installed CLI runs
  `gpt-5.6-sol`, a generation stale.
- `resolveDispatchModel`'s #461 downgrade guard compares against `MODEL_RANK`, which has three
  entries and none of them is `ox-alpha`. Passing `ox-alpha` is therefore accepted by being
  UNRECOGNIZED, not by being approved. The guard will stay silent on a wrong model too.
- `orchestrator-dispatch-loop` says "Never hand-pick a model". These ladders are the operator's
  standing exception to that line, and they are the only sanctioned one.

Until `MODEL_RANK` carries the ladder and a test pins it, this file is the enforcement. Treat a
dispatch whose `model:` was not chosen from a ladder above as a defect.

## OpenAI / codex, for analysis rather than for slices

Runs on the operator's ChatGPT login rather than a metered key, so it does not consume the token
budget a worker does. Use it for outside review and analysis, not as a worker rung. It is absent
from both ladders on purpose.

```bash
codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" -c sandbox_mode="read-only" \
  --skip-git-repo-check -o <answer.md> "$(cat <prompt.md>)" < /dev/null
```

**`< /dev/null` IS NOT OPTIONAL.** A backgrounded call inherits a pipe that never closes, so codex
prints `Reading additional input from stdin...` and blocks forever on a prompt it already has.
Measured 2026-08-23: 34 minutes at 0% CPU with no rollout file ever created. The tell is the log
containing only that one line — check for a rollout under `~/.codex/sessions/<date>/` before
concluding anything about the model, because no rollout means no turn ever began.

**Reasoning effort: `high`, not `xhigh`** (operator, 2026-08-23). Measured on an `xhigh` run over
616 s: `token_count -> reasoning` alone was **307.5 s, 50% of wall clock**, and model-side time
totalled **88%** against 12% local execution. Network is not the constraint — provider round-trip is
6-7 ms to openai/deepseek/openrouter — and neither is disk, at ~855 MB/s locally. The one lever that
moves this is reasoning effort. Reserve `xhigh` for a consult where a wrong answer costs a slice.

Note the opposite profile for Blender: 9.7 s per body at 100% CPU with no network at all. Model
calls are latency-bound and parallelise nearly free; bakes are CPU-bound and serialise. Schedule
them differently.

## Related

`consult-session-hygiene` (thread retirement budget, the `no_visible_content` alarm),
`board-conduit` (concurrency N-gate, ~300-turn worker staging),
`orchestrator-dispatch-loop` (dispatch signatures and traps),
`autonomy-boundaries` (escalate-last, which decides WHETHER to consult before this decides WHO).
