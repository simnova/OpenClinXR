---
name: consult-session-hygiene
description: "Running long-lived superagent/peer consult threads without losing them. Token-per-call retirement budget, the no_visible_content fire alarm, why resume pricing is regressive, and the restore-stall signature. Load before resuming any consult thread or when a consult goes quiet."
---

# Consult session hygiene

**Model for this thread:** `ox-alpha` first, `grok-4.6` as the last resort. No DeepSeek rung on
the superagent. Full ladders and the fallback rule live in the `model-routing` skill.

Two superagent threads died on 2026-08-22. The superagent diagnosed itself from its own session
artifacts; everything here is its forensics plus what I measured. Each failure mode is **n=1** — these
are conservative first cuts, to be tightened with the third incident.

## The two deaths were NOT the same failure

| | thread A | thread B |
|---|---|---|
| state | 3,662 messages, 18 MB updates, 7.7 MB events | 967 messages, 4.3 MB updates, 1.93 MB chat history |
| behaviour | **never reached inference** — stalled in restore | resumed fine 7 times, then died on content |
| signature | `sid=None`, 6.95 s CPU across 15 min, 3 ESTABLISHED conns, zero output | `no_visible_content` x6 over 43 min, then a 400 |
| control | fresh session answered in <45 s | fresh session answered the same question in ~9 min |

Same accumulator — session bulk — three independent limits: the **restore path**, the provider's
**effective context envelope**, and **retry amplification**. They trip at different points and need
different counters. "One bounded session life" is too coarse.

## The 400 is the last error, not the disease

Thread B's fatal turn began ~20:57. The first `empty response from model (no_visible_content)` fired at
**21:01:47**. The harness retried **six times across 43 minutes**, re-sending the identical ~246k-token
prefix each time, before a non-retryable 400 ended it. **The retry ladder turned a 5-minute loss into a
47-minute one.** Output for those 47 minutes: 2,743 tokens, zero answer.

**FIRE ALARM: the first `no_visible_content` in a turn — kill the dispatch and re-ask in a fresh
session.** It is not transient the way a 429 is. This single rule would have saved the day.

## The watch number

**`inputTokens ÷ modelCalls`** from the last completed turn.

- **≥150k/call** — finish the current question, start no new work in that thread.
- **≥200k/call** — forced retirement; the next question goes to a fresh session.

Thread B's curve: `143k → 164k → 175k → 180k → 185k → 206k → 230k → 246k(dead)`. Monotonic all day,
death at the all-time high.

Secondary tells, in descending earliness: first `no_visible_content` anywhere; image payloads entering a
thread already over 100k/call; resume count ≥4 in a day on one thread; chat history >1 MB. **Session
bytes lag** — 4.3 MB coexisted with healthy turns all afternoon — so rank bytes below the token ratio.

## Local gauges read healthy while the provider was already past its limit

`signals.json` said `contextWindowUsage: 22` (235k of 1,048,576) and `compactionCount: 0` at the moment
of death. **Do not trust nominal context-window percentages.** The failure lives in the gap between the
nominal window in the model config and the provider's effective envelope, and nothing local reports the
latter. Record an *effective* envelope per provider — the largest context that completed cleanly —
beside the nominal one.

## A prefix cache working perfectly is also the fingerprint of the problem

Thread B: `cachedReadTokens 3,893,184` of `inputTokens 4,923,022` (79%), `cacheCreationTokens: 0` — a
stable append-only prefix, the cache behaving exactly as designed. Caching cuts **cost per call** and
does nothing about the failure, which tracks **total context size**. High cache-read is not a health
signal.

## Images are the heaviest thing you can put in a thread you intend to keep

Four of the five largest messages in thread B were base64 room-capture PNGs — 198/197/181/180/163 KB,
~920 KB total — sitting at message indices 352–386 of 387, immediately before the fatal exchange and in
the prefix of **every call thereafter**.

**Grade captures in a throwaway session, or accept that the thread retires immediately after.**

## Resume pricing is regressive

The day's ledger for thread B: 8 turns, 33.3M input tokens, 113k output, 138 minutes of API time — and
the resumes were genuinely buying things (an audit, override reviews, a pulse consult, two landed
commits). Then the marginal resume cost 4.92M tokens and 47 minutes for zero words, where the fresh
control took ~9 minutes.

Every future question inherits the full prefix tax **plus** the accumulated fragility, so the pattern
guarantees eventual negative margin even when each individual resume feels cheap.

**Default to a FRESH session per consult.** Reserve one persistent thread for genuinely iterative
negotiation — the argue-back-and-forth class — and cap it at **3 resumes or 150k/call, whichever comes
first**.

## Before any resume, and during it

- **Pre-flight:** check `updates.jsonl` line count and chat-history bytes. Above **~600 update lines**
  or **~1 MB** of chat history, harvest what you need and start fresh instead.
- **Verify the session contains your brief** before trusting a resumed reply — a wrong id does not
  error, it confabulates.
- **During resume: if no first token in 120 s, kill it.** That signature — no sid, near-zero CPU delta,
  established connections — is the restore stall, and waiting demonstrably buys nothing.

## Starting fresh: say so explicitly

A fresh session loads project memory and will happily invent continuity. Every fresh consult opens with
what died, that there is no continuity, and an instruction not to pretend otherwise — then carries the
measurements it needs inline.

## What is NOT determined

Why empty generations begin at ~246k on this route when a different model carried 235k two days earlier.
The 400 response body is discarded before logging, so the context-envelope and image-payload hypotheses
remain confounded. **Capture the full response body on terminal API errors** — that would likely settle
it on the next occurrence.
