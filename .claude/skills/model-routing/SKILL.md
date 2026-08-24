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
| `http_status: 401`, auth rejected | `OPENROUTER_API_KEY` lives in `~/.zshrc` and is **absent from every fresh Bash shell** | `dispatch()` sources it, so workers run while my bare calls 401 |
| 0 bytes at 90 s, "it stalled" | `--output-format json` **buffers until completion** | byte count is not a first-token signal; read the session dir |
| `Cannot read properties of undefined (reading 'proofs')` | `dispatch(repoRoot, options)` takes **two positional args** | see `orchestrator-dispatch-loop` §Signatures |
| `role is required` | I omitted `role` | the error names the prior incident (#441-#447) |
| `DOWNGRADE with no modelDowngradeReason` | role policy outranks a bare `model:` | name the reason or drop the argument |
| `no_visible_content` | **4 model calls × ~120k = 479k total.** A single call at 139k succeeded the same hour | multi-turn consults re-send the prefix each call; see below |

**The ONE genuine ox failure signature** is a dispatch that dies **under ~60 s after spawn with no
turns** — measured at 15 s on issue-607. That is the 15% tail, it is a provider fault, and stepping
to `deepseek-v4-flash` is the correct response. Anything else, suspect yourself first.

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

`codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s read-only` runs on the operator's
ChatGPT login rather than a metered key, so it does not consume the token budget a worker does. Use
it for outside review and analysis (`PROTO_VERIFY_DELEGATION` §10r), not as a worker rung. It is
absent from both ladders on purpose.

## Related

`consult-session-hygiene` (thread retirement budget, the `no_visible_content` alarm),
`board-conduit` (concurrency N-gate, ~300-turn worker staging),
`orchestrator-dispatch-loop` (dispatch signatures and traps),
`autonomy-boundaries` (escalate-last, which decides WHETHER to consult before this decides WHO).
