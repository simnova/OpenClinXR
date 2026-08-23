---
name: model-routing
description: "The operator's model ladders for worker agents and the superagent, with the fallback rule and the probe. Load BEFORE passing `model:` to dispatch(), before spawning any worker or subagent, before opening or resuming a superagent consult, and whenever a dispatch dies on a provider error. Carries what is enforced in code and what is NOT, so a wrong model is never assumed to be caught by a guard."
when-to-use: "dispatch a worker, pass a model, which model, spawn subagent, resume superagent, ox-alpha, deepseek, grok-4.6, provider died, 402, empty response, model fell back, escalate model, worker model policy"
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

## Superagent (the standing advisory / ox thread)

| rung | model | cost |
|---|---|---|
| 1 | `ox-alpha` | free |
| 2 | `grok-4.6` | not cheap, last resort |

No DeepSeek rung on the superagent. Its work is judgment, direction and verdicts, and the cheap
tier is not a substitute for that.

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

Compare the count against `ls <repo> | wc -l`. Verified 2026-08-23: 43 of 43, 26 s cold, and a
worker held `ox-alpha` for 50+ minutes and 572 session lines on issue-576 without dying.

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
