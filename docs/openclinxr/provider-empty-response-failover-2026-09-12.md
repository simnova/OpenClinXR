---
title: "Provider Empty Response Failover"
date: 2026-09-12
author: OpenClinXR
status: complete
category: openclaw
tags: [provider, failover, proxy, empty-response]
---

# Provider Empty Response Failover — 2026-09-12

## Measured outage

Two dispatches and a one-line probe (`Reply with exactly: ALIVE`) on `muse-spark-1` died with
`Internal error: "empty response from model (no_visible_content)"`. Session `e23d6dcc-fdbc-4b72-b913-e745a0393d78`
in `~/.grok/logs/unified.jsonl` held **16 empty_response events** from 19:24:15.604Z to 19:30:52.899Z
with one distinct `sampler_request_id` — the model returned empty on the first call and the harness
retried the identical request for 6.5 minutes. A second session (`147b8912-4899-46e2-b8ab-3e41c00c102d`)
reached 8 of the same before it was killed by PID.

Throughout the outage, `curl 127.0.0.1:38450/health` returned `{"ok":true,"circuits":{"openrouter":{"state":"closed"}}}`.

**Root cause:** The failover proxy's `forwardChat` returned immediately on `res.ok` (HTTP 200) without
inspecting the response body for content. `recordFailure` fires on 401/402/403/408/429/5xx and network
errors; an empty body arrives as 200 and is not one of them. The circuit stayed closed while the provider
produced nothing usable, and the Grok harness retried against the same dead provider.

**Working alternative:** `opencode-go-mimo` returned `{"text":"ALIVE","stopReason":"end_turn"}` in the
same minutes. Both cards were re-dispatched on `opencode-go-mimo` and ran clean (29 log rows, 0 empty_response).

## Fix

Added `isEmptyCompletion(body)` detection to the proxy. When the response is HTTP 200 but the parsed
body has no choices, no content, or an error field, the proxy now:

1. Records a failure on the provider's circuit (using status 429 so `cooldownMsFor` applies the
   `TRANSIENT_COOLDOWN_MS` tier — see rationale below).
2. Fails over to the secondary provider, the same way a 429 does.
3. Does NOT call `recordSuccess` — the circuit opens for 30 seconds.

If the last provider in the chain returns empty, the proxy returns the empty body with status 200
to the caller (same as today — no further failover target exists).

## Chosen cooldown and rationale

**Tier: `TRANSIENT_COOLDOWN_MS` (30 seconds).**

| Tier | Duration | When it fires |
|---|---|---|
| `QUOTA_COOLDOWN_MS` | 5 hours | 402 (billing) or 429 with numeric retry-after |
| `REGION_COOLDOWN_MS` | 1 hour | 403 (region blocked) |
| `TRANSIENT_COOLDOWN_MS` | 30 seconds | Everything else |

An empty completion is not a quota signal (no billing context), not a region block (no 403), and
not a missing key (no 401). It most closely matches the transient tier: the provider may recover
quickly, but the immediate next request should use a different provider. The 30-second half-open
window lets the circuit close again if the next probe returns real content, which is the right
recovery behavior for a transient empty response.

## Two-direction probe output

### Direction 1: Empty primary → failover to secondary (RED then GREEN)

Before the fix, an empty completion from the primary was returned as success:

```
via: openrouter       ← empty body passed through
calls: 1              ← secondary never tried
```

After the fix, the same empty primary triggers failover:

```
via: go               ← secondary used
calls: 2              ← primary tried then failed over
```

### Direction 2: Honest implementation → no failover (GREEN)

A provider returning real content must NOT be failed over:

```
via: openrouter       ← used directly
calls: 1              ← secondary never tried
content: "Real content" ← passed through intact
```

### Circuit behavior

Empty completion opens the circuit for `TRANSIENT_COOLDOWN_MS` (30 s), confirmed by
`breaker.snapshot()` showing `state: "open"` and `openForMs: 30_000`.

## Changed files

- `tools/openclinxr/openclaw/provider-failover-proxy.ts` — added `isEmptyCompletion`, updated `forwardChat`
- `tools/openclinxr/openclaw/the-proxy-fails-over-on-an-empty-completion.test.ts` — new test file
- `docs/openclinxr/provider-empty-response-failover-2026-09-12.md` — this document
