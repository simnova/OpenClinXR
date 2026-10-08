# Score sheet — Grok Voice (OpenRouter) cached audio clock bake-off

## Decision: REJECT for next-slice adoption (full-phone scoring)

Correcting both measurement defects flipped the verdict back: scored over
every non-silence phone with same-word pairing, the clock meets the median
clauses but fails p95 on both bar clips. Pangram medianAbs 0.96 → 0.9 f
(✓) but p95Abs 2.67 f (✗); viseme-words medianAbs 1.14 → 0.99 f (✓) but
p95Abs 3.33 f (✗). Closures on the bar clip set hold 11/11 (all four
clips 14/14). The p95 tails are genuine STT word-start lag on a few words
(fat-F +3.33 f, sir-S +4.62 f: STT starts 110–150 ms after MFA), not
pairing artifacts — so the result is negative and this card closes.

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
- Follow-up plan (this round, recomputed offline with `--recompute`, zero
  API calls — the run completed with `OPENROUTER_API_KEY` unset):
  (a) closure-gap rule: the same predicate the MFA cue source applies
  (`tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts`,
  `applyMfaClosureRule`: silence immediately before a P/B/M initial is the
  closure and labels P). No published package entrypoint exports that
  function and a relative import into another package's src is refused by
  the architecture rule, so the predicate is vendored verbatim into
  `measure.ts` (BILABIAL = P/B/M, gap-before-it becomes P) with provenance
  stated there — not re-derived. Necessary adaptation, stated openly: MFA
  relabels a phone-tier SIL interval while the STT plan has none, so the
  same predicate EMITS a P phone spanning the STT inter-word gap (or the
  leading silence for word 0) when the next word starts with P/B/M.
  Closure onset is the audio-energy quiet point (end of the last 10-ms
  frame at or above threshold with frame end inside the gap, clamped to
  the gap, falling back to gap start when the whole gap is quiet).
  (b) leading-silence offset: per-clip energy onset (first 10-ms frame at
  or above threshold on the ffmpeg 16 kHz mono decode of the cached TTS
  mp3) re-anchors word 0 only (`firstWordStartS` = STT start − max(0,
  STT start − onset)); later words keep STT bounds because their lag is
  per-word duration drift, not a uniform clock offset. Threshold −40 dBFS
  peak per 10-ms frame: mp3 encoder idle noise measures ≤ −51 dB in the
  leading frames of all four clips while speech onset measures ≥ −29 dB,
  so −40 dB separates the two with ≥ 11 dB margin on both sides — chosen
  from the audio alone, never fitted to MFA.
  Closure-gap rule source: `measure.ts` `ClosureSpan`/`PlanOpts` block
  (predicate vendored verbatim from `mfa-align.ts:applyMfaClosureRule`).
  Vendoring warning: no published entrypoint exports that function, so a
  change there will NOT propagate here. `grok-voice.test.ts` carries a
  snapshot test of the source text that fails on divergence and forces a
  deliberate re-vendor.
- Plan inputs (counterweight): the plan reads reference words, STT word
  bounds, dictionary pronunciations (`phone-plans.json`), and
  `audio-anchors.json` (STT-gap bounds + cached-audio energy frames +
  stated threshold) — never `mfa-cues.json`. `buildPhonePlan` takes no MFA
  parameter; `grok-voice.test.ts` asserts its code contains no MFA input
  and that the committed anchors re-derive from cached mp3 bytes via an
  independent ffmpeg decode. A plan that read MFA to place closures would
  pass by construction; this one cannot.
- Leading silence: threshold −40 dBFS peak per 10-ms frame, source =
  offline ffmpeg 16 kHz mono decode of the cached TTS mp3 bytes (same
  toolchain as the record path). Measured offsets (STT word-0 start −
  energy onset, clamped ≥ 0): pangram 30 ms (0.140 − 0.110),
  viseme-words 0 ms (0.100 − 0.100), pain 82 ms (0.222 − 0.140),
  oov 0 ms (0.161 − 0.170 → clamped). Emission onsets (tQuiet):
  beige 0.750, put-lead 0.0, bed 6.09, book 7.17, pain-P 0.68,
  better-B 1.33. Full per-clip record in `audio-anchors.json`.
- Replay proof: `grok-voice.test.ts` stubs `fetch` to throw, recomputes all
  four clip scores from cache, and asserts deep equality with `results.jsonl`
  (6 tests pass, incl. the closure-emission unit test, the no-MFA-input
  counterweight test, the independent audio re-decode test, and the
  vendored-predicate divergence test). 20 replay runs (cache read + full scoring): p50 0.58 ms,
  p95 1.67 ms (`replay-timings.json`).

## Results (agreement with MFA, which is not ground truth)

| clip | phone hits (n scored) | paired n | medianAbs (fr) | p95Abs (fr) | bias signed med (fr) | STT word drift med (ms) |
|---|---|---|---|---|---|---|
| pangram | 66/73 | 69 | 0.9 | 2.67 | 0.42 | 45 |
| viseme-words | 34/41 | 35 | 0.99 | 3.33 | 0.66 | 37 |
| pain | 16/17 | 17 | 0.71 | 3.18 | 0.46 | 65 |
| oov | 16/16 | 16 | 0.66 | 3.66 | 0.64 | 28 |

Measurement correction (round 2): the first two rounds computed median and
p95 over SIGNED onset errors. A signed p95 is the upper tail only, so large
early (negative) errors were invisible — viseme-words reported p95 3.0 f
while two pairings sat at −150/−118 f. All statistics below run over
ABSOLUTE error (`medianAbsFrames`, `p95AbsFrames` in `results.jsonl`); the
signed median is kept as `biasMedianFrames`. The pass bar scores
medianAbs ≤ 1 f and p95Abs ≤ 2 f.

Measurement correction (round 3): median now uses the mean of the two
middle values for even n (previously the lower middle element — pangram's
old closure-only errors [−1.34, −1.15, −0.3, 0.06] reported bias −1.15
beside medianAbs 0.3, which cannot both hold; true values −0.725 and
0.725). p95 uses nearest-rank index ceil(0.95·n)−1; stated plainly, with
small n this is the max — the 4-phone closure subset previously reported
reached it exactly. Coverage is now every non-silence MFA phone (n scored
per clip above), paired within the same order-matched word; a phone with
no same-label planned counterpart in its word is a miss, never a skip
(unpaired = scored − paired: pangram 4, viseme-words 6, mostly dictionary
pronunciation variants such as MFA dog D AA1 G vs plan D AO1 G). Global
nearest-same-label pairing is refused: it paired across words and reported
acoustic distances of up to 150 f as clock errors. The bar was judged on
the paired n per clip shown above. Both the before column (89e80b0ed
method) and the after column were recomputed offline from the cache with
the corrected method.

Before → after (same corrected measures, same pass bar):

| clip | phone hits (n) | paired n | medianAbs (fr) | p95Abs (fr) | bias (fr) |
|---|---|---|---|---|---|
| pangram | 65/73 → 66/73 | 68 → 69 | 1.0 → 0.9 | 15.6 → 2.67 | 0.55 → 0.42 |
| viseme-words | 32/41 → 34/41 | 33 → 35 | 1.41 → 0.99 | 93.08 → 3.33 | 1.2 → 0.66 |
| pain | 16/17 → 16/17 | 17 → 17 | 1.19 → 0.71 | 3.18 → 3.18 | 0.71 → 0.46 |
| oov | 16/16 → 16/16 | 16 → 16 | 0.66 → 0.66 | 3.66 → 3.66 | 0.64 → 0.64 |

Closure totals, stated exactly: on the bar clip set (pangram +
viseme-words) 8/11 → 11/11; across all four clips 11/14 → 14/14. No other
denominator is used anywhere in this sheet.

Per-interval misses now: the old −100 f-class closure pairings are gone
(replaced by gap emissions within −0.9…0.0 f), but the full-phone p95 tails
are genuine STT word-start lag on a few words (viseme-words fat-F +3.33 f,
sir-S +4.62 f: STT starts 110–150 ms after MFA) plus even-split compression
inside words — neither reachable by a gap or onset rule.

Pass bar (card): onset medianAbs ≤ 1 fr and p95Abs ≤ 2 fr on pangram and
viseme-words, all closures hit, homophone check holds. Score: pangram
medianAbs 0.9 ✓, p95Abs 2.67 ✗, words medianAbs 0.99 ✓, p95Abs 3.33 ✗,
closures 4/4 and 7/7 ✓, homophone (phone→F OW N starts F; though DH OW ≠ cough
K AO F) ✓. p95 fails on both bar clips → REJECT (negative result closes the card).

Latency (5 recorded calls each): TTS p50 484 ms / p95 692 ms;
STT p50 517 ms / p95 2056 ms (one slow oov call). Replay p50 0.58 ms —
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
- Follow-up resolution: the closure-gap emission absorbs the silence
  mechanism (all six closure pairings now land within −0.9…0.0 f of MFA
  from STT-gap + audio-energy inputs alone) and the leading-silence offset
  re-anchors clip start (30/0/82/0 ms per clip, audio-measured). What
  remains is a systematic early bias on pangram (−1.15 f, from intra-word
  even-split compression on "jumped": 281 ms in STT time against 330 ms in
  MFA time) — visible now that bias is reported separately from magnitude.
  No gap or onset rule reaches inside a word; per-phone durations would be
  a different slice.

## Repro

Recorded once: `direnv exec /Volumes/files/src/openclinxr pnpm exec tsx
apps/arena/viseme-audio-clock/grok-voice/record.ts` (paid calls only here).
Recompute offline: same with `--recompute` (no network). Test:
`pnpm exec vitest run apps/arena/viseme-audio-clock/grok-voice`.
Per-interval detail in `results.jsonl` `clip_score` lines; MFA cues in
`mfa-cues.json`; cache keys + generation ids in `cache-manifest.json`.
