# 0062 — Two-tier lip sync: baked clips for scripted turns, live clock for dynamic turns

- Status: **draft**
- Date: 2026-10-08
- Deciders: operator (direction, 2026-10-08); worker card `tsk_edba82577ad9cc4a`
- Known-good inputs: `FrozenActorTurnPlan` (`packages/openclinxr/capability-gateway/src/deterministic-dialogue-adapter.ts:76`); MFA alignment (`tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts`); viseme-eval scoring on main

## Context

Operator direction 2026-10-08: the exam mixes two lip-sync qualities. Scripted humanoid lines get pre-built animated clips with higher-quality sync; realtime interactions get lower-quality sync. Design and plant the seam in this card; do not build both tiers in one card.

Tier BAKED covers any actor turn whose text is known before the exam: scripted lines and `FrozenActorTurnPlan` output. The turn is synthesized at build time, aligned offline with MFA (the current capture default), and stored as audio plus viseme/bone track in the encounter bundle, so the exam plays it with no LLM, TTS, or aligner at runtime (D9 dark factory).

Tier LIVE covers dynamic turns whose text exists only at runtime. The turn uses the cheapest audio clock that passes the viseme arena, falling back to the current dictionary dwell timing.

## Arena results on main (inputs, not passes)

| Candidate | Commit | Verdict |
|---|---|---|
| wav2arkit_cpu ONNX | `b73a5bb9e` | Reject: closure 4/13, labiodental 0/6, onset p95 9 f |
| HeadAudio / wawa-lipsync | `d3e2bae16` | Reject both: HeadAudio closure 2/13, wawa no measurable signal |
| Grok Voice via OpenRouter (TTS + STT word timestamps, closure-gap rule, audio-measured leading silence) | `7cf9edc73` | Reject on p95 only: closures 14/14, medianAbs 0.9/0.99 f, p95Abs 2.67/3.33 f vs bar 2; tails are STT word-start lag 110–150 ms |

Score sheets: `apps/arena/viseme-audio-clock/wav2arkit/score-sheet.md`, `apps/arena/viseme-audio-clock/headaudio/score-sheet.md`, `apps/arena/viseme-audio-clock/grok-voice/score-sheet.md`. Grok Voice responses are cached and replayable at `~/.openclinxr-cache/grok-voice/`. Both Grok Voice cards have reported (`tsk_978648d9f4f21c45` in `89e80b0ed`, follow-up `tsk_d46e2da016fff444` in `7cf9edc73`); no live candidate passed.

## Decision

1. **Per-turn selector `lipSyncTier` on the turn plan** (`"baked" | "live"`; default `"live"`). Any turn produced as a `FrozenActorTurnPlan` (scripted line known before the exam) is baked-eligible and carries `"baked"` once its bundle entry exists. Dynamic turns carry `"live"`. The selector lives on the plan, not in caller state, so review packets and replay can read it off the frozen record.
2. **Bundle storage format and cache key.** A baked turn is stored in the encounter bundle as `{ audioUri, visemeCueTrack, boneTrack, contentHash, alignerVersion }`: PCM audio, an MFA-aligned ARPABET→OVR cue track (`mapArpabetTrack` input shape in `packages/openclinxr/xr-dialogue/src/viseme-cue-track.ts`), and the derived bone/morph track. The cache key is the content hash over `(spokenTextForTts, voiceId, aligner name + version, cue-map version)`; identical scripted lines across stations share one entry. Runtime lookup is hash-only: no LLM, no TTS, no aligner at exam time.
3. **Fallback order.** Baked entry present and hash-verified → play baked. Baked missing or hash mismatch → live clock. Live clock unavailable or unhealthy → current dictionary dwell timing (`viseme-dwell.ts`). Each step down is visible in the playback evidence (same convention as the existing `openClinXrActorTurnPlaybackFallback` slot flags).
4. **Trace records which tier played.** The per-turn trace entry records `lipSyncTierPlayed` (`"baked" | "live" | "dwell"`), the bundle content hash when baked, and the fallback reason when the played tier differs from the planned tier. Review and replay resolve the tier through the existing trace-tag join (`resolveLiveActorTurnForTrace`), extended with these fields — no new trace plane.
5. **Live-tier choice is an explicit cost decision, not an arena pass.** No live candidate has passed the bar (medianAbs ≤ 1 f and p95Abs ≤ 2 f): Grok Voice meets the median clauses and all closures but fails p95 on both bar clips (2.67/3.33 f), with tails from genuine STT word-start lag. The follow-up card either accepts that ~90–110 ms p95 cost for live turns or keeps the dictionary dwell fallback as the live tier. Either outcome is recorded as a cost accepted, never as a pass.

## Consequences

- Follow-up card 1 builds the baked synthesis pipeline (synthesize → MFA-align → hash → bundle entry) plus hash-verified playback of the baked cue times verbatim.
- Follow-up card 2 builds the live tier against the cost decision above.
- This card plants only the seam: this MADR plus a RED test in `packages/openclinxr/xr-dialogue` asserting a turn carrying a baked track plays that track's cue times verbatim.

## Out of scope

Building the baked synthesis pipeline or the live clock; making the live-tier cost decision (follow-up card 2).
