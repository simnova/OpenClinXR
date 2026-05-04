# VibeVoice Local Voice Spike

Date: 2026-05-04
Status: Operator approved local install/benchmark; execution in progress; runtime remains disabled for production

## Purpose

This note records the safe first step for evaluating VibeVoice as an optional local voice research path for OpenClinXR. It does not wire a voice runtime into the app, does not enable learner assessment use, and does not permit cloud-backed calls, paid APIs, real-patient voice cloning, or committed model weights/audio.

## Source Posture

Primary source record:

- `src-vibevoice-github-2026`

Planning claims from the source record:

- The VibeVoice repository reports an MIT license.
- The repository describes VibeVoice-ASR, VibeVoice-TTS, and VibeVoice-Realtime-0.5B model families.
- VibeVoice-Realtime-0.5B is described as a streaming text-to-speech model with low first-audio latency.
- The repository warns about biased, inaccurate, unexpected, or harmful outputs and deepfake/disinformation misuse risk.
- The repository records that the older long-form TTS code was removed after misuse concerns.

Unproven for OpenClinXR:

- Local install success on this machine.
- Local first-audio latency, memory use, thermal behavior, and stability.
- Medical-education fitness, voice-safety posture, commercial or institutional approval, or clinical validation.
- License compatibility for model weights, speaker presets, demo assets, and any derivative voice assets.

## Allowed Evaluation Scope

VibeVoice may be evaluated only as a disabled, local, developer-only research candidate for:

- Synthetic standardized-patient speech synthesis.
- Turn-taking latency experiments.
- Non-production speech fallback comparison.
- Possible ASR/STT comparison if model terms and safety review permit.

VibeVoice must not be used for:

- Real patient voice cloning.
- Impersonating clinicians, patients, family members, public figures, or identifiable people.
- Production learner assessment.
- Any high-stakes scoring or credentialing claim.
- Cloud-backed calls, paid API calls, or CI-required execution.

## Required Gates Before Install

1. Legal/license intake for repository code, model weights, speaker presets, demo assets, and any downstream converted or quantized artifacts.
2. Voice-safety review covering disclosure UX, misuse prevention, identity policy, accent/bias risk, content moderation, and retention of generated audio.
3. Operator approval of install path, disk footprint, model ID, source URL, uninstall command, and expected runtime.
4. Local-only environment plan with no default app wiring, no CI requirement, and no checked-in model weights.

## Required Gates Before Runtime Enablement

1. `vibevoice` or an approved wrapper is visible to `pnpm local:runtime:probe`.
2. `OPENCLINXR_LOCAL_VOICE_RUNTIME` and `OPENCLINXR_LOCAL_VOICE_ID` are set in an untracked local env file.
3. `OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED=true` and `OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED=true` are set only after the operator-approved install path and safety/license checklist are recorded.
4. `pnpm local:provider:benchmark -- --env-file .env.openclinxr.local --output docs/openclinxr/local-provider-benchmark-YYYY-MM-DD.json` records readiness without cloud calls.
5. A separate first-audio benchmark records first audible latency, total synthesis time, prompt text, generated duration, memory/CPU/GPU posture, thermal notes, and a transcript/synthesis evidence sample.
6. The result remains labeled `disabled` or `dev_only` until legal, clinical simulation QA, and safety reviewers approve a narrow pilot use.

## Current Decision

Patrick approved [proposal-local-voice-runtime.md](../../../proposals/approved/proposal-local-voice-runtime.md) on 2026-05-04 10:40:15 EDT. Codex may install and benchmark the local `microsoft/VibeVoice-Realtime-0.5B` spike using only the approved local cache paths and private env file. VibeVoice remains disabled for production and learner assessment.

## Approved Install Record

| Item | Approved value |
| --- | --- |
| Repository source | `https://github.com/microsoft/VibeVoice.git` |
| Repository HEAD checked before install | `e73d1e17c3754f046352014856a922f8208fb5d3` |
| Model ID | `microsoft/VibeVoice-Realtime-0.5B` |
| Model card license | MIT |
| Expected primary model file | `model.safetensors`, linked size `2,035,332,888` bytes |
| Install root | `/Users/patrick/.cache/openclinxr/vibevoice` |
| Repository clone | `/Users/patrick/.cache/openclinxr/vibevoice/VibeVoice` |
| Python venv | `/Users/patrick/.cache/openclinxr/vibevoice/.venv` |
| Wrapper command | `/Users/patrick/.local/bin/vibevoice` |
| Hugging Face cache | `/Users/patrick/.cache/openclinxr/huggingface` |
| Uninstall command | `rm -rf /Users/patrick/.cache/openclinxr/vibevoice /Users/patrick/.cache/openclinxr/huggingface/models--microsoft--VibeVoice-Realtime-0.5B /Users/patrick/.local/bin/vibevoice` |
| Private env file | `.env.openclinxr.local`, ignored by git |

## Open Blockers

- `vibevoice` local wrapper availability is pending installation.
- `OPENCLINXR_LOCAL_VOICE_RUNTIME` is pending private env setup.
- `OPENCLINXR_LOCAL_VOICE_ID` is pending private env setup.
- `OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED` is pending private env setup.
- `OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED` is pending private env setup.
- First-audio benchmark is pending.
- No legal, safety, or clinical simulation QA signoff exists.
