# MADR 0023: Treat VibeVoice As A Local Voice Candidate Behind Safety Gates

Status: Accepted for planning
Date: 2026-05-03

## Context

The user proposed Microsoft VibeVoice as a local alternative to Grok voice. VibeVoice is promising, but its repository warns about misuse, bias, inaccuracy, and real-world/commercial caution.

## Decision

Add VibeVoice to the local voice strategy as an optional adapter candidate, not a default runtime.

Required gates:

- License and model-card review.
- Isolated local install.
- First-audio latency benchmark.
- Real-time factor benchmark.
- Synthetic voice disclosure UX.
- Misuse and impersonation review.
- Medical phrase pronunciation review.

## Consequences

Positive:

- Gives a local speech path without cloud API charges.
- Keeps voice provider abstraction honest.
- Enables eventual expressive local TTS experiments.

Negative:

- Installation and model downloads may be heavy.
- Research warning language may limit production use.
- Voice misuse risk is substantial and must be governed.

## Reversal Trigger

Promote VibeVoice only if local benchmark, safety, license, disclosure, and faculty-review gates pass.

## Sources

- `src-vibevoice-github-2026`
- `src-local-hardware-spike-2026-05-03`
