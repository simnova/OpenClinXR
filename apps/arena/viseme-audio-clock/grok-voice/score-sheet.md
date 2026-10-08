# Score sheet — Grok Voice (OpenRouter) cached audio clock: onset snap + durations

## Decision: REJECT vs the bar (p95), gap narrowed on a 14-clip fixture

Final method (S2: pause-gated onset snap + duration-weighted split) over every
non-silence phone with same-word pairing: pangram medianAbs 0.72 ✓ / p95Abs
2.46 ✗; viseme-words medianAbs 0.60 ✓ / p95Abs 1.90 ✓. Bar clip closures
11/11 ✓. The bar (medianAbs ≤ 1 f, p95Abs ≤ 2 f on pangram + viseme-words,
all closures) fails on pangram p95 only. Viseme-words passes fully for the
first time (was 0.99/3.33): the fat-F/sir-S tails are gone. Remaining pangram
p95 is mid-phrase STT segmentation (out/I region), unreachable by any onset
rule. Held-out 10 clin lines behave the same as the bar clips (median 10/10
≤ 1 f, p95 2/10 ≤ 2 f, closures 20/20), so the snap parameters are not fitted
to the fixture they are judged on.

## Method (deterministic, no model grades a model)

- Reference: repo MFA path (`tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts`,
  MFA 3.4.2, `english_us_arpa` model+dictionary, temp dict = stock + every
  cmudict-fallback entry in `phone-plans.json`). Closure rule applied (SIL
  before P/B/M → P), contact deconfliction not applied. MFA is an aligner,
  not ground truth; all numbers are agreement with MFA.
- Provider: OpenRouter. TTS `x-ai/grok-voice-tts-1.0`, voice Ara (repo voices
  do not map to Eve/Ara/Rex/Sal/Leo, card rule falls through to Ara). STT
  `x-ai/grok-stt-1.0`, `verbose_json` + word timestamps, language `en`.
- Probe (earlier round, `with_timestamps: true` on "hi."): HTTP 200, plain
  `audio/mpeg` bytes, no timing payload. Timing source is STT word timestamps
  on the TTS audio. Hit rule: planned same-label phone onset inside the MFA
  interval widened by 2 frames at 30 fps (repo convention).
- Fixtures: original 4 (pangram 23 words 8.6 s, viseme-words 13 words 7.7 s,
  pain 7 words 2.3 s, oov 4 words 1.9 s) plus 10 clinical-dialogue lines
  recorded ONCE this round (patient + parent answers; drugs albuterol /
  steroids / inhaler; numbers two/four/three/one-hundred-one/six/seven/twice;
  questions clin-05 + clin-10; fricative-initial she/feels/fast/fever/six/
  slow/spacer/soccer/throat and stop-initial takes/two/tight/better/take/
  play/puffer/daily words). All 10 STT transcripts match the reference word
  for word; zero OOV. Everything after records replays from
  `~/.openclinxr-cache/grok-voice/`. The one `--record` run was killed
  mid-MFA-alignment, so per-call ms for the 10 new lines was not captured;
  characters (454) and STT usage ($0.00084, 30.24 s) come from the cache.
- Statistics: over ABSOLUTE onset error; median = mean of the two middle
  values for even n; p95 = nearest-rank ceil(0.95·n)−1 (for small n this is
  near the max); signed median kept as bias. Coverage is every non-silence
  MFA phone paired within the same order-matched word (miss, never skip).
- Step S0 (baseline): even split, STT starts, closure-gap emissions + word-0
  energy offset (previous round's method, reproduced exactly: pangram
  0.90/2.67, viseme-words 0.99/3.33).
- Step S1 (+snap): each late STT word start snaps back to its audio onset
  inside its own STT gap (previous word end .. STT start, ±150 ms window).
  Stop/vowel-initial words snap to the energy edge (-40 dBFS rising edge out
  of a 90 ms pause); fricative-initial words (F V S Z SH ZH TH DH HH) snap
  to the ZCR frication edge (ZCR ≥ 0.25 above a -55 dBFS floor, 50 ms
  sub-0.25 run — voiceless frication sits 15+ dB under the energy threshold
  for 100+ ms, so energy alone reads it late). Snap is backward-only and
  gap-bounded: an onset belonging to a neighboring word can never capture
  the snap (this exact failure cost +5.1 f on he's-HH before bounding).
  Threshold (-40 dBFS: orig-4 idle noise ≤ -51 dB, speech ≥ -29 dB), window
  (±150 ms: covers the orig-4 near-onset class, viseme p95 124 ms; leaves
  300-700 ms continuous-speech starts untouched), pause run (90 ms: orig-4
  quiet-run distribution is empty between 80 and 100 ms), and ZCR levels
  (pause 2-8%, frication 42-81%, vowels 4-12%) all come from the ORIGINAL 4
  clips' audio + STT alone, never MFA. The 10 clin lines are held out.
- Step S2 (+durations): S1 starts with the even split replaced by fixed
  per-phone relative weights (measure.ts `phoneWeight`: diphthongs 1.5,
  monophthongs 1.15 with stressed ×1.1 / unstressed ×0.8, affricates 1.0,
  SH/ZH 1.0, fricatives 0.9, liquids 0.85, nasals 0.8, glides 0.7, stops
  0.6, flap 0.5 — class ordering from Crystal & House 1988 mean segment
  durations, cf. Klatt 1979; fixed a priori, no MFA input anywhere in plan
  construction).
- Plan inputs (counterweight): reference words, STT bounds, dictionary
  pronunciations, audio frames. Never `mfa-cues.json`. `grok-voice.test.ts`
  asserts the plan builder source contains no MFA input, anchors re-derive
  from cached mp3 bytes via ffmpeg, and the vendored closure predicate
  matches `mfa-align.ts` or fails.

## Results S0 → S1 → S2 (medianAbs / p95Abs in frames; closures; phone hits)

| clip | S0 | S1 (snap) | S2 (snap+dur) | closures S2 | hits S2 |
|---|---|---|---|---|---|
| pangram | 0.90 / 2.67 | 0.88 / 2.46 | 0.72 / 2.46 | 4/4 | 68/73 |
| viseme-words | 0.99 / 3.33 | 0.82 / 1.92 | 0.60 / 1.90 | 7/7 | 34/41 |
| pain | 0.71 / 3.18 | 1.05 / 3.18 | 0.68 / 2.60 | 2/2 | 16/17 |
| oov | 0.66 / 3.66 | 0.66 / 3.66 | 0.75 / 2.90 | 1/1 | 16/16 |
| clin-01 | 0.57 / 2.49 | 0.60 / 2.16 | 0.67 / 2.43 | 2/2 | 32/33 |
| clin-02 | 1.38 / 3.09 | 1.03 / 2.76 | 0.90 / 2.76 | 2/2 | 24/26 |
| clin-03 | 0.69 / 2.61 | 0.90 / 2.61 | 0.60 / 2.31 | 0/0 | 37/37 |
| clin-04 | 0.47 / 2.30 | 0.67 / 2.30 | 0.57 / 1.92 | 6/6 | 29/31 |
| clin-05 | 0.75 / 2.79 | 0.75 / 2.25 | 0.77 / 2.16 | 1/1 | 28/30 |
| clin-06 | 1.00 / 2.85 | 0.85 / 2.85 | 0.83 / 1.71 | 2/2 | 26/28 |
| clin-07 | 0.68 / 2.64 | 0.95 / 2.41 | 0.77 / 2.10 | 0/0 | 32/35 |
| clin-08 | 0.92 / 3.66 | 0.69 / 3.00 | 0.62 / 3.00 | 3/3 | 25/26 |
| clin-09 | 0.85 / 2.11 | 0.85 / 2.11 | 0.74 / 2.12 | 3/3 | 31/31 |
| clin-10 | 0.60 / 2.58 | 0.67 / 2.18 | 0.63 / 2.07 | 1/1 | 25/25 |

Honest warts: S1 alone regresses median on pain (0.71 → 1.05) and hits on
pangram (66 → 65) and clin-05 (28 → 26); durations rescue all three in S2.
oov median is the one cell where S2 (0.75) sits above S0 (0.66) while p95
improves (3.66 → 2.90). clin-08 p95 sticks at 3.00 (throat-TH: `then`/`throat`
region mid-phrase STT lag, no pause to snap from). Snap moved 0-8 starts per
clip and never fires mid-phrase; the leftover tails are all mid-utterance
STT segmentation with no acoustic onset cue.

Pass bar (card): onset medianAbs ≤ 1 fr and p95Abs ≤ 2 fr on pangram and
viseme-words, all closures hit, homophone holds. Score: pangram 0.72 ✓ /
2.46 ✗, viseme-words 0.60 ✓ / 1.90 ✓, closures 11/11 ✓, homophone
(phone→F OW N starts F; DH OW ≠ K AO F) ✓. Pangram p95 fails → REJECT.

Latency the live path would add per turn (offline benchmark over all 14
clips, decode + snap + plan build, no MFA): snap + plan compute p50
0.08 ms / p95 0.88 ms; mp3→16 kHz decode via an ffmpeg subprocess p50
43 ms / p95 216 ms (subprocess spawn dominates; in-process decode would be
less). Replay scoring (cache read + full S2 scoring, `replay-timings.json`):
unchanged harness, rerun with 14 clips.

Billing (measured): new lines 454 TTS characters; STT 30.24 s audio,
$0.00084. Generations pinned by X-Generation-Id in `cache-manifest.json`
(29 entries: 9 prior + 20 new). Per-call ms for the 10 new lines is
recorded as null — the record run was killed during MFA alignment, after
all 20 paid calls had cached; no second network call was made.

## Measured reasons

- The old tails were STT word-start lag after pauses (fat-F +3.33 f, sir-S
  +4.62 f: 110-150 ms late) plus even-split compression inside words. The
  ZCR edge lands fricative onsets within ~1 f of MFA (frication ZCR jumps
  6→49% where energy still reads pause); the energy edge lands stop onsets;
  durations fix the inside-word compression (pangram bias holds 0.42 while
  median falls 0.90 → 0.72).
- What remains is mid-phrase STT segmentation with no pause cue (pangram
  out/I, clin-08 throat region): no onset rule reaches it. Next lever would
  be a different slice (e.g. sub-word STT confidences or a finer acoustic
  pass), not a wider snap window — widening re-admits neighbor theft.

## Repro

Recorded once: `direnv exec /Volumes/files/src/openclinxr pnpm exec tsx
apps/arena/viseme-audio-clock/grok-voice/scripts/record.ts` (paid calls only
here; rerun replays from cache). Test (fetch stubbed to throw):
`pnpm exec vitest run apps/arena/viseme-audio-clock/grok-voice` (8 tests:
replay-exact on all 14 clips, snap + duration units, closure emission,
no-MFA-input, audio re-decode, vendored-predicate sync). Per-interval detail
in `results.jsonl` `clip_score` lines; MFA cues in `mfa-cues.json`; cache
keys + generation ids in `cache-manifest.json`.
