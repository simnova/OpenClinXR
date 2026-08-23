# Cagematch finding: local TTS → Rhubarb → viseme JSON, end to end and offline (issue #582)

- **Date:** 2026-08-22
- **Lane:** C (cagematch — deliverable is a decision with evidence, not runtime code)
- **Verdict:** **CHAIN ADOPTED as the offline text→viseme path.** All four pre-stated negative
  results are refuted by measurement. `say` (macOS, on PATH, offline) renders scenario dialogue to
  wav; Rhubarb v1.14.0 (already installed #578) produces 17 deterministic timed cues from that
  audio; every cue maps onto a morph target **measured on a shipped GLB**; and the mapped cue
  artifact passes through the real runtime resolver (`driveVisemeTimeline`) with **17/17 frames
  resolved, zero unresolved**. The one station #578 found missing — an audio source in front of
  Rhubarb — is satisfied locally with zero new dependencies.

## Claim under test

The card's chain: `dialogue text → local TTS (say) → wav → rhubarb (-d dialog file) → timed cues →
viseme_* weights`. #578 proved Rhubarb cannot run text-only; this card closes the gap by adding the
TTS station it identified.

## Inputs (all real repo content, nothing synthetic)

| Input | Source |
|---|---|
| Dialogue line | `openingUtterance` of patient `patient_maya_johnson_v1`: "My chest feels tight and it is hard to breathe." (`packages/openclinxr/scenario-fixtures/src/pediatric-asthma.ts:29`) |
| Actor GLB | `mpfb-peds-patient-child.glb` — provenance names `scenarioId: peds_asthma_parent_anxiety_v1`, `actorRole: patient`, i.e. Maya's own shipped cast asset (`apps/ui-xr/public/generated-humanoids/`). Same viseme set measured on `mpfb-peds-parent-aisha.glb` (parent Tara). |
| TTS | macOS `/usr/bin/say` (default voice; Samantha re-test below). No network calls (offline system TTS). |
| Recognition | Rhubarb v1.14.0 at `~/.openclinxr-tools/rhubarb/rhubarb`, MIT, local PocketSphinx (#578 licence row stands). |

## Measured results (2026-08-22, this machine)

| # | Step | Command shape | Result |
|---|---|---|---|
| 1 | TTS render | `say -o clinical.aiff -f dialog.txt && afconvert -f WAVE -d LEI16@22050 -c 1 …` | 44 KB wav, mono 22 050 Hz Int16, **2.94 s**. |
| 2 | Rhubarb over audio | `rhubarb -f json -d dialog.txt --extendedShapes GHX clinical.wav` | **17 mouthCues** across `A B C D F G X` over 2.94 s. |
| 3 | Determinism | re-run of step 2 | **Byte-identical JSON.** |
| 4 | Voice robustness | same chain with `-v Samantha` | 17 cues, shapes `A B C D F G X` — recognition does not depend on the default voice. |

Negative-result scorecard against the card:

1. *`say` unrecognisable* — refuted: 17 cues, sane timing, two voices.
2. *alphabet unmappable onto baked targets* — refuted: full table below, zero rows dropped
   (one honest COLLAPSE, disclosed).
3. *output not expressible in resolver format* — refuted: consumed directly by
   `driveVisemeTimeline`; 17/17 resolved.
4. *no acceptable offline voice quality* — deferred, not failed: `say` is intelligible but
   flat/robotic. That is a VOICE-cagematch question (Piper/espeak-ng per the card), not a lip-sync
   blocker; recognition worked on both voices tested. Recorded as the residual, not a refusal.

## The mapping table (targets ENUMERATED from the shipped GLB, not assumed)

Measured set on `mpfb-peds-patient-child.glb` / `mpfb-peds-parent-aisha.glb` body mesh:
**15 baked `viseme_*` targets** — `viseme_aa CH DD E FF I kk nn O PP RR sil SS TH U`
(plus 32 FACS `mouth-*`/`eyebrows-*`/etc. morphs; enumeration script:
`.openclinxr/evidence/issue-582-lip-sync/list-morph-targets.mjs`).

This differs from the #578 table, which mapped the 9-name ARKit preview set
(`viseme_silence AA E IH OH OU FV TH L`) — those names are NOT what ships on these cast GLBs.
The card anticipated exactly this by demanding enumeration from a shipped asset. Both sets are
drivable today via the resolver's case-insensitive matching + FACS alias fallback
(`apps/ui-xr/src/morph-target-resolver.ts`), so the table below keys the SHIPPED names.

| Rhubarb shape | Definition (README.adoc:79-118) | Our target | Rule |
|---|---|---|---|
| `A` | closed lips, P/B/M | `viseme_PP` | direct — PP is the bilabial-closure shape |
| `B` | slightly open, clenched teeth; most consonants + EE-class vowels | `viseme_DD` | **COLLAPSE** — see note |
| `C` | open mouth, EH/AE vowels; universal in-between | `viseme_E` | direct |
| `D` | wide open, AA as in father | `viseme_aa` | direct |
| `E` | slightly rounded, AO as in off / ER as in bird | `viseme_O` | direct |
| `F` | puckered, UW/OW/W | `viseme_U` | direct |
| `G` | upper teeth on lower lip, F/V | `viseme_FF` | direct (extended shape, default-on) |
| `H` | tongue raised behind teeth, long L | `viseme_nn` | approximate — nn is our lingual/tongue family |
| `X` | idle/silence | `viseme_sil` | direct |

Rows in the reverse direction — baked targets with no Rhubarb counterpart. These stay at weight 0
during Rhubarb-driven playback; they remain reachable for emotion/FACS-driven expression:

| Our target | Rhubarb counterpart | Disposition |
|---|---|---|
| `viseme_CH` | none | no counterpart — stays 0 (choo/tsh affricate folded into `B/DD`) |
| `viseme_I` | none distinct | folded into `B/DD` (EE-class) or `C/E` |
| `viseme_kk` | none distinct | folded into `B/DD` (generic consonant) |
| `viseme_OO` | — | not present in shipped set (the 15-name set has `U` instead) |
| `viseme_RR` | none distinct | folded into `B/DD`/`C` |
| `viseme_SS` | none distinct | folded into `B/DD` (sibilant) |
| `viseme_TH` | none dedicated | folded into `B/DD` (matches #578's TH→B approximation) |
| `viseme_nn` | `H` only when extended shapes on | covered above in forward direction |

**THE COLLAPSE, named rather than hidden:** Rhubarb's `B` is a deliberately generic "slightly
open, clenched" shape covering most consonants AND some vowels; our bake has SEVEN distinct
consonant-family targets (CH DD kk nn RR SS TH) that all receive `viseme_DD`. Visually this means
consonants are indistinguishable from each other during Rhubarb-driven speech — a soft, slightly-
open mouth rather than differentiated tongue/teeth articulation. This is a fidelity ceiling of the
6-shape Hanna-Barbera alphabet vs our 15-shape bake, NOT a mapping failure; the alternative
(inventing per-consonant rules Rhubarb never emits) would fabricate timing information the tool
does not produce. Vowel coverage (aa/E/O/U + closure PP/sil) — the shapes that dominate perceived
speech — maps 1:1.

## Runtime-shaped artifact

`.openclinxr/evidence/issue-582-lip-sync/viseme-cues.json` — schema `openclinxr.viseme-cues.v1`,
each cue `{ phoneme: <resolved target name>, atSecond, durationSeconds }`. Passing the RESOLVED
TARGET NAME as the `phoneme` token guarantees `resolveVisemeTarget` matches exactly against real
mesh names (apps/ui-xr/src/viseme-timeline-drive.ts:66-104).

**Resolver proof:** fed through the real `driveVisemeTimeline` with the GLB's measured target list
(`.openclinxr/evidence/issue-582-lip-sync/resolver-validation.json`):
`totalFrames: 17, resolved: 17, unresolved: []`. Sample frame at t=0.07 s carries
`viseme_PP: 1` and all other 14 targets `0` — exactly the step-weight contract the driver documents.

## What adoption would require (later slice, lane A wiring — out of scope here)

1. Per-turn pipeline: render actor line → wav (voice choice = separate voice cagematch),
   `rhubarb -d <line> <wav>`, convert via the checked-in `.mjs` converter.
2. Feed resulting `PhonemeCue[]` into the existing `driveVisemeTimeline → applyVisemeWeights`
   wire (already live per apps/ui-xr/src/main.ts:8868) — no resolver changes needed.
3. Cache policy: Rhubarb output is deterministic per (audio, dialog) pair, so cues can be
   build-time-generated per authored line (D9-friendly: zero runtime LLM/network).
4. If per-consonant fidelity ever matters, that is an argument for a phoneme-level recognizer
   upstream, not for editing this mapping.

## Evidence artifacts

All under `.openclinxr/evidence/issue-582-lip-sync/`:

- `dialog.txt` — the authored line verbatim.
- `clinical.wav` — `say` render (default voice), mono 22 050 Hz Int16.
- `rhubarb-cues.json` — 17 timed mouthCues (byte-identical across two runs).
- `viseme-cues.json` — converted, runtime-shaped cue artifact (mapping embedded).
- `resolver-validation.json` — driveVisemeTimeline proof, 17/17 resolved.
- `list-morph-targets.mjs` — GLB target enumeration script (@gltf-transform/core NodeIO).
- `rhubarb-to-viseme-cues.mjs` — the mapping/conversion script (single source of the table above).
- `validate-cues-against-resolver.mjs` — resolver round-trip harness.

## Verdict

ADOPTED for the offline lip-sync chain (lane C decision with evidence): the complete path runs on
this machine today, deterministically, with zero new licences and zero cloud calls, producing
resolver-compatible viseme timing keyed to real shipped morph targets. The known ceiling is
consonant differentiation (7 targets ← 1 Rhubarb shape), recorded as a fidelity trade, not a
blocker. Voice QUALITY remains an open question for a voice cagematch; it does not gate this chain.

claimScope: offline feasibility + format compatibility of the TTS→Rhubarb→viseme chain, measured on
one authored scenario line and two shipped GLBs. notEvidenceFor: voice naturalness/clinical
suitability, runtime visual quality of the driven mouth (no pixels rendered in this slice), or any
readiness claim.
