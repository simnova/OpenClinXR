---
name: model-routing
description: "The operator's model ladders for worker agents and the superagent, with the fallback rule and the probe. Load BEFORE passing `model:` to dispatch(), before spawning any worker or subagent, before opening or resuming a superagent consult, and whenever a dispatch dies on a provider error. Carries what is enforced in code and what is NOT, so a wrong model is never assumed to be caught by a guard. ALSO load before writing that a model is broken, dead, stalled, unresponsive, or returning nothing: ox measured 85% delegation success and 7 of 8 \"ox is down\" claims in one session were the caller's own invocation error (nohup, missing key, buffered json, wrong signature, missing role)."
when-to-use: "ox is down, ox not working, model is broken, dispatch died, 0 bytes, empty response, no_visible_content, stalled, unresponsive, step down a rung, dispatch a worker, pass a model, which model, spawn subagent, resume superagent, ox-alpha, deepseek, grok-4.6, provider died, 402, model fell back, escalate model, worker model policy"
---

# Model routing

Two ladders, set by the operator on 2026-08-23. First available wins; step down only on a measured
failure, never on preference.

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

Per `~/.grok/docs/user-guide/14-headless-mode.md`. The env prefix is NOT optional: a bare
`grok -p` outside the sanctioned path skips the worker guard and the chokepoint denies it.

```bash
OPENCLINXR_RAW_GROK_SANCTIONED=1 OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1   ~/.grok/bin/grok -p "<prompt>"     --model <ALIAS>     --output-format json     --max-turns <N>     --cwd /Volumes/files/src/openclinxr
```

Flags that matter, all documented in `14-headless-mode.md`: `-p/--single` is the prompt and TAKES IT
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

**FAST (13–29 s) — missing `OPENROUTER_API_KEY` in the dispatch parent.** `dispatch()` spawns with the
environment you hand it and does not read `~/.zshrc`. Verbatim: *"Auth recovery succeeded but 4
authenticated inference requests were still rejected (401)… Turn ran 7s wall-clock."* Fixed by
exporting the key. issue-608 is the control: 13 s/401, then with only the key changed, 409 s and a
different error.

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

1. **Export `OPENROUTER_API_KEY` in the dispatch parent** before every dispatch and consult. Kills the
   fast cluster outright.
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
| `http_status: 401`, auth rejected | `OPENROUTER_API_KEY` lives in `~/.zshrc` and is **absent from every fresh Bash shell** | applies to CONSULTS **and DISPATCHES** — see the correction below |
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
export OPENROUTER_API_KEY=$(grep -m1 OPENROUTER_API_KEY ~/.zshrc | sed -E 's/.*=["'"'"']?([^"'"'"' ]+).*/\1/')
```

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
