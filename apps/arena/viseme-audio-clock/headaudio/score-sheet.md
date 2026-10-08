# Score sheet — HeadAudio vs wawa-lipsync live audio clock bake-off

## Decision: REJECT both for next-slice adoption

Neither candidate detects bilabial closure reliably enough to serve as the live actor-turn audio clock. HeadAudio carries some signal (labiodental hits, OOV speech activity). wawa-lipsync carries none under this protocol.

## Method (deterministic, no model grades a model)

- Reference: repo MFA path (`tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts`, MFA 3.4.2, `english_us_arpa` model+dictionary). MFA is an aligner, not ground truth; all hit/onset numbers are agreement with MFA, stated beside every claim below.
- Fixture clips (reused, nothing authored): `pangram.aiff` (b1819951…), `viseme-words.aiff` (54abeaa9…), `i-feel-the-pain-is-better-now.aiff` (61ab9f37…).
- OOV clip generated locally: `say -v Samantha -r 100 -o cache/oov-albuterol.aiff "Give the albuterol now."` (sha256 71b3c9b7…; 1.683 s). MFA aligns "albuterol" as `spn` (untranscribed noise) — confirms out-of-vocabulary status.
- Harness: Playwright Chromium, real-time `AudioContext`, buffer-source playback, 30 fps sampling. HeadAudio at tester.html defaults (vadMode 1, gates −40/−50 dB, silMode 1 uncalibrated, speakerMeanHz 150). wawa-lipsync `Lipsync` defaults (fftSize 2048, history 10), analyser fed by buffer source.
- Closure signal: HeadAudio eased `viseme_PP` weight (max 0.75); wawa binary PP indicator (it outputs one discrete viseme, no weights). Hit = classifier predicts PP inside the MFA P/B/M interval widened by 2 frames at 30 fps. Same with FF for F/V. Onset event = first hit frame; error = event − MFA onset, in frames. Accuracy from rep0; stability = hit range over 20 reps. RTF = audio s / wall s, p50/p95 over 20 runs per clip per candidate (160 runs total).

## Results (agreement with MFA, which is not ground truth)

| clip | candidate | closure hits | labiodental hits | onset med (fr) | onset p95 (fr) | RTF p50/p95 |
|---|---|---|---|---|---|---|
| pangram | headaudio | 0/3 | 2/4 | — | — | 0.929/0.930 |
| viseme-words | headaudio | 0/6 | 1/1 | — | — | 0.952/0.952 |
| pain | headaudio | 2/4 | 0/1 | −1.4 | 3.7 | 0.861/0.862 |
| oov | headaudio | n/a (0 PBM) | 0/1 | — | — | 0.715/0.717 |
| pangram | wawa | 0/3 | 0/4 | — | — | 0.930/0.931 |
| viseme-words | wawa | 0/6 | 0/1 | — | — | 0.953/0.953 |
| pain | wawa | 0/4 | 0/1 | — | — | 0.862/0.863 |
| oov | wawa | n/a (0 PBM) | 0/1 | — | — | 0.717/0.719 |

Overall RTF across all 80 runs per candidate: headaudio p50 0.929 / p95 0.952; wawa p50 0.929 / p95 0.953. Both keep up with real time (RTF < 1 is expected for live clocks; short-clip RTF ≈ 0.72 is fixed per-run overhead, not compute shortfall).

OOV mouth activity (speech span vs words-gap digital-silence baseline): headaudio 0.980 vs 0.023 → ACTIVE above silence level. wawa 0.979 vs 0.954 → NOT above silence level (wawa emits `sil` on only ~5% of silence-gap frames; its silence output is near-nonfunctional here).

## Measured reasons

- HeadAudio bilabial recall is 2/13 across fixtures, and the 2 pain hits share one PP episode spanning two adjacent P intervals — one distinct event. Its PP output is single-frame blips (whole-clip peak 0.118 vs 0.75 class max) except that one sustained episode. FF sustains to full weight, so the pipeline works; PP specifically does not fire.
- wawa-lipsync predicts PP off-target (11 pangram frames, none inside any P/B/M window), never predicts FF on any clip, and cannot separate speech from digital silence. Zero measurable closure or labiodental signal.
- Run-to-run stability is perfect (hit ranges 0,0 and 2,2 across 20 reps), so the negative result is not sampling noise.
- Batch MFA context: ~41–47 s per align on this Mac (load-dominated), confirming batch MFA cannot serve live turns. This bake-off does not change that; it only rejects these two live alternatives.

## Repro

`node scripts/capture.mjs` (serves in-process, 160 runs) then `node scripts/analyze.mjs` → `results.jsonl`. Per-interval detail (phones, bounds, hit, errFrames, peakWeight) is in `results.jsonl` `clip_score` lines. Raw frames: `cache/runs/`. MFA cues: `cache/mfa-*.json`.
