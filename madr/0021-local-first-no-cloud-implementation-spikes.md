# MADR 0021: Use Local-First No-Cloud Spikes For The Next Implementation Planning Loop

Status: Accepted for planning
Date: 2026-05-03

## Context

The user asked for additional iteration without incurring cloud or third-party API charges. Prior plans allowed Grok and other cloud providers as production candidates, but the next implementation plan should prove as much as possible locally.

## Decision

All implementation-planning spikes must default to local-only execution:

- Mock providers for CI and normal tests.
- No Grok, cloud LLM, or paid speech API calls.
- No automatic model weight downloads during verification.
- Optional local runtimes behind explicit install and benchmark gates.
- Benchmark records stored in `docs/openclinxr/spikes/`.

## Consequences

Positive:

- Keeps cost controlled.
- Improves reproducibility.
- Forces provider abstraction to be real.
- Gives a safe path for local Qwen/DeepSeek/VibeVoice experiments.

Negative:

- Local model quality may lag frontier cloud providers.
- Setup complexity increases.
- Some voice/XR assumptions remain unproven until tools are installed.

## Reversal Trigger

Revisit only after local mock and optional local runtime gates are complete and leadership approves a paid provider benchmark budget.

## Sources

- `src-local-hardware-spike-2026-05-03`
- `src-vibevoice-github-2026`
- `src-mlx-lm-github-2026`
