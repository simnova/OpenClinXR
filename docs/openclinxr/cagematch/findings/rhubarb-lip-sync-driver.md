# Cagematch finding: Rhubarb Lip Sync as the offline viseme driver (issue #578)

- **Date:** 2026-08-22
- **Lane:** C (cagematch — deliverable is a decision with evidence, not working code)
- **Verdict:** **REFUSED for the offline text→viseme role.** Negative result 2 of the card's
  pre-stated outcomes: Rhubarb requires audio; its `-d`/`--dialogFile` is an *aid* to audio word
  recognition, never a standalone text→viseme path. The tool itself is healthy, MIT-licensed,
  installed, and its timed mouth-cue output on audio is real and mappable — so the refusal is
  scoped to D9's "offline, no TTS" shape, not to the tool.

## Claim under test

D9's lip-sync row names "Rhubarb → viseme JSON → existing morphs (offline, no NVIDIA)". The card
asked whether `-d` dialog-text mode produces viseme timing from a transcript without audio.
Nobody here had run the binary (card's own premise audit).

## Acquisition (step zero)

- Installed from the official release:
  `https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v1.14.0/Rhubarb-Lip-Sync-1.14.0-macOS.zip`
  → `~/.openclinxr-tools/rhubarb/` (out-of-repo, alongside cmudict/infinigen/mesh2motion-app/trellis2-apple).
- Version v1.14.0 (latest at time of test). Binary runs on this machine (Apple Silicon macOS) after
  quarantine clear. Not vendored into the monorepo.
- Licence: **MIT** (Rhubarb core); bundled third-party deps are MIT/BSD-family per its LICENSE.md —
  no AGPL/copyleft. Recorded in `docs/openclinxr/third-party-asset-licence-ledger.md`.
- Network posture: the binary performs no network calls during a run (local PocketSphinx + phonetic
  recognizers; `res/sphinx` ships inside the install).

## Measured results (all commands run 2026-08-22 on this machine)

| # | Probe | Invocation | Result |
|---|---|---|---|
| 1 | Dialog text, no input file | `rhubarb -f json -d dialog.txt` | Refused: `Required argument missing: inputFile`. The positional input file is mandatory. |
| 2 | Text file as the input | `rhubarb -f json -d dialog.txt dialog.txt` | Refused: `Unsupported file extension '.txt'`. Only `.wav`/`.ogg` accepted as input. |
| 3 | Silent `.wav` + full dialog file | `rhubarb -f json -d dialog.txt silence.wav` | Runs, but emits exactly one idle cue `{0.00–4.00, X}` — zero information from the text. See `rhubarb-silence-plus-dialog.json` in the evidence dir. |
| 4 | Local TTS audio + same dialog file | `say … \| rhubarb -f json -d dialog.txt clinical.wav` | Works: 18 timed cues across A–F/X over 2.91 s. See `rhubarb-tts-audio-cues.json`. |

Probe 3 is the decisive one: with audio present but carrying no speech, the complete dialog text
produces no viseme timing whatsoever. Combined with probes 1–2 there is no invocation shape that
turns text alone into timed mouth shapes. This matches the README verbatim (`README.adoc:155`):
with `-d`, "Rhubarb Lip Sync will **still perform word recognition internally**, but it will prefer
words and phrases that occur in the dialog file."

## Why the old ledger row was wrong about *why* — and what stands

The licence ledger carried a 2026-08-13 row refusing Rhubarb because "this repo has zero audio
assets". The repo-level fact was right, but this slice measured the tool directly and the deeper
finding is structural:

1. Rhubarb's recognizers consume an audio waveform; text can only bias recognition of that
   waveform. There is no text-only code path to switch on.
2. Therefore the missing prerequisite is not merely "audio files" but **a deterministic TTS station**
   upstream of any lip-sync driver. This machine already has one (`say`), which produced clean,
   correctly-timed cues in probe 4 — so the audio dependency is cheap to satisfy locally when a
   runtime voice track exists.
3. D14 (2026-08-22 operator amendment) unlocks generative motion/lip-sync exploration in cagematch;
   it does not change what Rhubarb's CLI can consume. An offline text→viseme driver would need a
   different engine (e.g. a grapheme/phoneme-to-viseme mapper over CMU dict — note
   `~/.openclinxr-tools/cmudict/` is already installed) or acceptance of a local TTS render step.

## Mouth-shape alphabet (measured from README.adoc + live JSON)

Rhubarb emits 6 basic shapes (Hanna-Barbera standard) plus up to 3 extended: `A` closed (P/B/M),
`B` slightly open clenched (most consonants, EE), `C` open (EH/AE; also in-between), `D` wide open
(AA), `E` slightly rounded (AO/ER), `F` puckered (UW/OW/W); extended `G` teeth-on-lip (F/V),
`H` long-L, `X` idle/silence.

## Mapping table onto our baked targets

Our target set enumerated from shipped GLBs (12 preview actors in `apps/ui-xr/dist/_regen-preview/`,
each carrying 25 morph targets): `viseme_silence, viseme_AA, viseme_E, viseme_IH, viseme_OH,
viseme_OU, viseme_FV, viseme_L, viseme_TH` — matching the bake list at
`tools/openclinxr/asset-pipeline/anny/automate_blender.py:562` and the 15-target visemes02 pack
(4 targets not present in these preview GLBs). Explicit entry per target:

| Our baked target | Rhubarb counterpart | Mapping rule | Note |
|---|---|---|---|
| `viseme_silence` | **X** | direct | X is Rhubarb's explicit idle/silence shape. |
| `viseme_AA` | **D** ("AA" as in father) | direct | Same vowel class by Rhubarb's own definition. |
| `viseme_E` | **C** (EH/AE vowels) | direct | C is the open-mouth EH/AE shape. |
| `viseme_FV` | **G** (F/V, teeth on lip) | direct | G is optional (`--extendedShapes GHX` default includes it). |
| `viseme_L` | **H** (long L) | direct | H is optional; included by default. |
| `viseme_TH` | **B** (closest: clenched-teeth consonant) | approximate | Rhubarb has no TH-specific shape; B is its generic consonant closure. Approximation, not invention — B is what Rhubarb itself assigns to TH-adjacent consonant contexts. |
| `viseme_OH` | **E** (AO as in off) | direct | E covers AO/ER rounded-open class. |
| `viseme_OU` | **F** (UW/OW/W pucker) | direct | |
| `viseme_IH` | **B** (EE-class vowel per README: "some vowels such as the 'EE' sound") | approximate | IH sits between our E and IH targets; B is Rhubarb's narrow-spread shape. No dedicated IH shape exists. |

**No unmapped targets** — every one of our 9 baked names has an entry, two of them approximate
(`TH→B`, `IH→B`). Conversely, Rhubarb's `A` (P/B/M bilabial closure) has no distinct target in the
9-name set; it would collapse onto `viseme_silence` or `viseme_silence`+jaw if ever driven. That
collapse is acceptable for a first pass and is called out rather than hidden.

## What would adoption require (for the follow-on card, not this one)

1. A TTS/audio-render step producing the actor's line as `.wav` (macOS `say` proven above; a
   cross-platform or WebXR-side equivalent would need its own cagematch).
2. `rhubarb -f json -d <line.txt> <line.wav>` per actor turn.
3. Cue→weight conversion: each `mouthCue` interval sets the mapped target's weight (1 inside its
   window, 0 outside; adjacent windows blended at boundaries) against the mapping table above.
   Output is exactly the timed `viseme_*` values the back half (#462/#463/#464/#469) consumes.
4. Provenance: record rhubarb version + recognizer (`pocketSphinx` vs `phonetic`) + seed-free
   determinism check per D13-style recording discipline.

## Evidence artifacts

Heavy artifacts referenced relative to repo root:

- `.openclinxr/evidence/issue-578/rhubarb-silence-plus-dialog.json` — probe 3 (text produces nothing).
- `.openclinxr/evidence/issue-578/rhubarb-tts-audio-cues.json` — probe 4 (audio path works, 18 cues).
- Install + raw session transcripts: `~/.openclinxr-tools/rhubarb-selftest/`.

## Verdict

REFUSED for the named offline role (negative result 2). The card closes successfully without
adoption: acquisition succeeded, licence passes our bars, the tool runs, the alphabet maps — but
the one claim the card exists to verify ("dialog-text mode → viseme timing without audio") is
false, measured four ways. A positive path exists only behind a TTS render step, which changes
the pipeline shape and belongs to a separate slice.
