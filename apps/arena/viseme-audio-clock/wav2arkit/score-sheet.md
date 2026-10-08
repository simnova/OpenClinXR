# Score sheet — wav2arkit_cpu ONNX bake-off vs MFA

Arena-only (`apps/arena/README.md` contract). Every promotion gate stays false. No production, Quest, or clinical claim. Decision with evidence, not adoption.

Candidate: `myned-ai/wav2arkit_cpu` (HF revision `48b7d27`, Apache-2.0 per card + README; no LICENSE file ships — see NOTICE.md). 16 kHz mono float32 in, 52 ARKit blendshapes at 30 fps out, `onnxruntime` 1.30.0 CPU. **Single-identity limitation (recorded):** the card bakes in one identity encoder (`identity 11` of 12); all outputs are that single speaker identity regardless of input voice. Machine: MacBook Pro, Apple M1 Max, 64 GB (this card's runs).

## Reference timing (MFA is an aligner, not ground truth)

MFA aligns the known transcript, so phone boundaries come from words, not acoustic discovery. The table below grades the candidate against MFA intervals; MFA itself is not a correctness oracle.

| Clip | MFA source | Cue-file sha256 |
|---|---|---|
| `pangram` (77 phones) | committed `docs/openclinxr/mouth-dynamics/viseme-eval/pangram/metrics.json` `.mfa` (MFA 3.4.2, `english_us_arpa`) | metrics.json `b0222d86e99fd8bdcbb8cae9a963ff910794b98efe29fd543873c7fba2fddf90` |
| `viseme-words` (51 phones) | committed `docs/openclinxr/mouth-dynamics/viseme-eval/viseme-words/metrics.json` `.mfa` (MFA 3.4.2) | metrics.json `db5ccf984f6091fcaba5eaed46e27647f62bf5ddb5d89c05bf09e0c82f4e093a` |
| `i-feel-the-pain-is-better-now` (21 cues) | live MFA 3.4.2 run on this machine via `tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts` (`runMfaAlign` + closure rule + contact deconfliction); 40.9 s wall incl. env load | `.cache/step3.TextGrid` `9bdc4e05e0263e9b3f36669332e4a8cb19b385b9727439b8e0609cb74050cd45` |
| OOV `Give the albuterol now.` | n/a (activity test only) | audio `71b3c9b7f6e982e1b0027fb514bba53e280c72d01978c8b1122eb2c12c435f2d` |

Full cue intervals: `mfa-cues.json` (this folder). Method: `measure.py` (this folder); 16 kHz conversions in gitignored `.cache/`.

## Exact signal formulas (stated before numbers)

- `closure(t) = mouthClose(t) − jawOpen(t)`
- `labiodental(t) = (mouthRollLower(t) + mouthLowerDownLeft(t) + mouthLowerDownRight(t)) / 3`
- `activity(t) = (mouthLowerDownLeft(t) + mouthLowerDownRight(t)) / 2 + jawOpen(t)`
- Silence baseline: 1 s digital zeros through the same session → `closureP95 = −0.0085`, `labiodentalP95 = 0.0320`, `activityP95 = 0.0647` (means: closure −0.0118, labio 0.0298, activity 0.0622).
- Peak: local maximum strictly above the same signal's silence p95 (edges compare one neighbour).
- Hit: any such peak with frame index in `[round(start·30) − 2, round(end·30) + 2)` for the MFA interval.
- Onset event per MFA phone: `argmax |activity(t) − activity(t−1)|` in `[onset − 9f, onset + 9f]`; error = `|event − round(onset·30)|` frames; median/p95 over all phones in the clip.

Model output range on speech was small: `mouthClose` clip-max 0.07–0.16, `jawOpen` clip-max 0.19–0.25, `mouthRollLower` clip-max 0.03–0.05; speech carried mainly by `mouthLowerDownL/R` (clip-max 0.43–0.70). Source: `measure.py` probe, this machine.

## Results

| Clip | Bilabial closure hits (P/B/M peak in window) | Labiodental hits (F/V peak in window) | Onset error median / p95 (frames @30fps) | Wall p50 / p95 (20 runs) | RTF p50 / p95 (audio s / compute s) |
|---|---|---|---|---|---|
| `pangram` (8.79 s, 264 fr) | **1 / 3** | **0 / 4** | **5 / 9** | 0.291 s / 0.302 s | 30.3x / 30.9x |
| `viseme-words` (13.15 s, 395 fr) | **3 / 6** | **0 / 1** | **3 / 9** | 0.435 s / 0.442 s | 30.3x / 30.9x |
| `i-feel-the-pain-is-better-now` (4.13 s, 124 fr) | **0 / 4** | **0 / 1** | **5 / 9** | 0.138 s / 0.155 s | 30.0x / 30.7x |
| OOV `Give the albuterol now.` (1.68 s, 51 fr) | n/a | n/a | n/a | 0.059 s / 0.061 s | 28.5x / 28.9x |

Pooled fixture RTF (60 runs): **p50 30.2x, p95 30.9x**. The card's ~22x realtime claim **remeasured faster**: ~30x on this M1 Max (single timed run per clip agreed: 29.0x / 29.4x / 30.4x / 28.6x; the 20-run medians above are the record).

OOV: candidate mouth activity mean **0.4017** vs silence activity p95 **0.0647** → **active = true**. The candidate moves its mouth during OOV speech; it does not stay at silence level.

Totals: closure **4 / 13**, labiodental **0 / 6**. Median onset lag 3–5 frames (100–167 ms), p95 9 frames (300 ms).

## ARKit → MPFB mouth-target map (table only, no wiring)

The repo's MPFB mouth set observed in `tools/openclinxr/evidence/parent-fitted-teeth/viseme-eval.ts` (`EVAL_ARPABET_TO_OVR`) and the viseme-eval stills is 15 names: 14 speech (`aa E I O U PP FF TH DD kk CH SS nn RR`) + `sil`. The card says 13; the table below maps all 52 ARKit keys onto that observed set (nearest single target; `sil` = no mouth target). Proposal only — nothing is wired.

| ARKit key | Nearest MPFB target | Note |
|---|---|---|
| `jawOpen` | `viseme_aa` | open vowel posture |
| `mouthClose` | `viseme_PP` | bilabial seal component |
| `mouthPressLeft` / `mouthPressRight` | `viseme_PP` | pressed closure |
| `mouthFunnel` | `viseme_O` | rounded |
| `mouthPucker` | `viseme_O` | rounded |
| `mouthStretchLeft` / `mouthStretchRight` | `viseme_E` | spread |
| `mouthDimpleLeft` / `mouthDimpleRight` | `viseme_E` | spread |
| `mouthSmileLeft` / `mouthSmileRight` | `viseme_E` | spread |
| `mouthRollLower` | `viseme_FF` | lower-lip-to-teeth tuck component |
| `mouthRollUpper` | `viseme_FF` | upper component of same tuck |
| `mouthLowerDownLeft` / `mouthLowerDownRight` | `viseme_FF` (open vowels need `aa` blend) | lower-lip drop; F/V tuck when combined with roll, openness otherwise |
| `mouthUpperUpLeft` / `mouthUpperUpRight` | `viseme_E` | upper-teeth show |
| `mouthShrugLower` / `mouthShrugUpper` | `sil` | small shrug, no viseme |
| `mouthFrownLeft` / `mouthFrownRight` | `sil` | expression, no viseme |
| `mouthLeft` / `mouthRight` | `sil` | lateral shift, no viseme |
| `jawForward` / `jawLeft` / `jawRight` | `sil` | jaw shift, no viseme |
| `tongueOut` | `viseme_TH` | tongue visible (nearest) |
| `mouthFunnel` (dup, see above) | `viseme_O` | — |
| `browDownLeft` / `browDownRight` / `browInnerUp` / `browOuterUpLeft` / `browOuterUpRight` | `sil` | non-mouth |
| `cheekPuff` / `cheekSquintLeft` / `cheekSquintRight` | `sil` | non-mouth |
| `eyeBlinkLeft` / `eyeBlinkRight` / `eyeLookDownLeft` / `eyeLookDownRight` / `eyeLookInLeft` / `eyeLookInRight` / `eyeLookOutLeft` / `eyeLookOutRight` / `eyeLookUpLeft` / `eyeLookUpRight` / `eyeSquintLeft` / `eyeSquintRight` / `eyeWideLeft` / `eyeWideRight` | `sil` | non-mouth |
| `noseSneerLeft` / `noseSneerRight` | `sil` | non-mouth |
| (no single-key equivalent) | `viseme_I` | needs narrow-spread combo; none of the 52 alone is it |
| (no single-key equivalent) | `viseme_DD` | alveolar tongue posture; no ARKit tongue-tip key |
| (no single-key equivalent) | `viseme_kk` | velar; no ARKit key |
| (no single-key equivalent) | `viseme_CH` | palatalaffricate groove; no single key |
| (no single-key equivalent) | `viseme_SS` | sibilant groove; no single key |
| (no single-key equivalent) | `viseme_nn` | nasal tongue posture; no single key |
| (no single-key equivalent) | `viseme_RR` | rhotic bunching; no single key |
| (no single-key equivalent) | `viseme_U` | close-rounded; closest combo is pucker + funnel, no single key |
| (no single-key equivalent) | `viseme_TH` (beyond `tongueOut`) | interdental; `tongueOut` is the only tongue key |

## Verdict: REJECT

Speed passes (pooled RTF p50 30.2x / p95 30.9x exceeds the ~22x claim; OOV mouth active above silence), but timing accuracy fails the live-clock purpose: bilabial closure 4/13, labiodental 0/6, onset median 3–5 frames with p95 9 frames. `mouthClose` never exceeds 0.16 and `mouthRollLower` never exceeds 0.05 on any fixture clip, so the closure/labiodental events a live actor turn needs are absent from the output. Combined with the baked single identity (11), this candidate is not the live audio clock. A negative result closes the card; no wiring was added (`apps/ui-xr` and `packages/` untouched).
