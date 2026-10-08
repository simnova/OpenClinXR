# Score sheet — Grok Voice (OpenRouter) cached audio clock bake-off

## Decision: REJECT for next-slice adoption

STT word timestamps on Grok TTS audio track every true stop/fricative onset
within ~3 frames of MFA, but the card's pass bar fails on both scored clips
(p95 onset error, all-closures-hit), so the result is negative and this card
closes. The misses have one identified mechanism (closure-silence intervals,
below) — a follow-up slice would need an STT-gap closure rule, not this clock
as measured.

## Method (deterministic, no model grades a model)

- Reference: repo MFA path (`tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts`,
  MFA 3.4.2, `english_us_arpa` model+dictionary, temp dict = stock + one
  appended `albuterol` line from cmudict). Closure rule applied (SIL before
  P/B/M → P), contact deconfliction not applied (runtime halo concern, not
  timing). MFA is an aligner, not ground truth; all numbers are agreement
  with MFA.
- Provider: OpenRouter. TTS `x-ai/grok-voice-tts-1.0`, voice Ara (the repo
  selects `Samantha`/mock voices for these fixtures, none maps to
  Eve/Ara/Rex/Sal/Leo, so the card rule falls through to Ara). STT
  `x-ai/grok-stt-1.0`, `verbose_json` + word timestamps, language `en`.
- Probe (one call, `with_timestamps: true` on "hi."): HTTP 200, plain
  `audio/mpeg` bytes, no timing payload. The parameter is accepted and
  ignored — TTS returns no character timings. Timing source is therefore STT
  word timestamps on the TTS audio (second preference in the card order).
- Joining rule: each STT word span is split uniformly across that word's
  dictionary phones (even subdivision). Phones from the MFA dictionary
  (45 words) then cmudict (1: albuterol); per-word sources in
  `phone-plans.json`. The repo dialogue pronunciation map was dropped: it
  reaches across a package boundary and is not on xr-dialogue's public
  surface (architecture rule). Closure/labiodental hit: a planned same-label phone
  onset falls inside the MFA interval widened by 2 frames at 30 fps
  (known-good convention from wav2arkit/headaudio).
- Fixtures: pangram (23 words, 8.6 s), viseme-words (13 words, 7.7 s),
  pain sentence (7 words, 2.3 s), OOV "Give the albuterol now." (4 words,
  1.9 s). Each recorded ONCE (5 TTS + 5 STT paid calls total, incl. probes);
  everything after replays from `~/.openclinxr-cache/grok-voice/`.
- Replay proof: `grok-voice.test.ts` stubs `fetch` to throw, recomputes all
  four clip scores from cache, and asserts deep equality with `results.jsonl`
  (2 tests pass). 20 replay runs (cache read + full scoring): p50 0.56 ms,
  p95 1.43 ms (`replay-timings.json`).

## Results (agreement with MFA, which is not ground truth)

| clip | closure hits | labiodental hits | onset med (fr) | onset p95 (fr) | STT word drift med (ms) |
|---|---|---|---|---|---|
| pangram | 3/4 | 4/4 | −1.15 | 36.95 | 45 |
| viseme-words | 5/7 | 1/1 | 0.3 | 3.0 | 37 |
| pain | 2/2 | 1/1 | 1.68 | 1.86 | 65 |
| oov | 1/1 | 1/1 | 1.62 | 1.62 | 21 |

Pass bar (card): onset median ≤ 1 fr and p95 ≤ 2 fr on pangram and
viseme-words, all closures hit, homophone check holds. Score: pangram
median 1.15 ✗, pangram p95 ✗, words median ✓, words p95 (3.0) ✗, closures
3/4 and 5/7 ✗, homophone (phone→F OW N starts F; though DH OW ≠ cough
K AO F) ✓. Bar fails → REJECT.

Latency (5 recorded calls each): TTS p50 484 ms / p95 692 ms;
STT p50 517 ms / p95 2056 ms (one slow oov call). Replay p50 0.56 ms —
three orders of magnitude below any live path, but replay speed does not
rescue the timing misses above.

Billing (measured): 246 TTS characters (USD not itemized — TTS returns raw
bytes; cost is characters-billed per OpenRouter pricing); STT 21.22 s audio,
$0.000589. Generations pinned by X-Generation-Id in `cache-manifest.json`.

## Measured reasons

- Every miss traces to pre-burst closure silence, not to wrong words. MFA's
  closure rule relabels SIL-before-P/B/M as P; the even-split plan anchors
  onsets at STT word starts (≈ the burst), so it cannot land inside the
  silence: pangram 36.95 f pairs jumped-P with the silence before beige-B
  (the beige B itself hit at 0.1 f); viseme-words −118/−150 f pair
  tip-P with silences before bed-B/book-B (both B onsets hit at 0.5 f).
  STT word timestamps structurally cannot recover closure silence — the same
  rule that helps MFA would have to be re-applied to STT word gaps.
- Word-boundary agreement itself is good: STT word-start drift vs MFA
  medians 21–65 ms; zero word mismatches; all four STT transcripts match the
  reference word for word (punctuation aside).
- Clip-start disagreement is real: put-P onset error 3.0 f comes from TTS
  leading silence (MFA starts the phone at 0.00 s, STT starts the word at
  0.10 s) — a further ~100 ms systematic a live clock would have to absorb.

## Repro

Recorded once: `direnv exec /Volumes/files/src/openclinxr pnpm exec tsx
apps/arena/viseme-audio-clock/grok-voice/record.ts` (paid calls only here).
Recompute offline: same with `--recompute` (no network). Test:
`pnpm exec vitest run apps/arena/viseme-audio-clock/grok-voice`.
Per-interval detail in `results.jsonl` `clip_score` lines; MFA cues in
`mfa-cues.json`; cache keys + generation ids in `cache-manifest.json`.
