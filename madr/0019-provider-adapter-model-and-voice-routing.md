# MADR 0019: Route Models And Voice Through Auditable Provider Adapters

Status: Accepted for planning
Date: 2026-05-03

## Context

The user wants Grok APIs considered for production, local LLM feasibility on an M4 Max, and future ability to add tools and skills. Clinical simulation, voice, and scenario generation need model flexibility without compromising auditability.

## Decision

All LLM, ASR, TTS, and voice calls go through provider adapters with typed contracts and trace provenance. The first implementation should include a mock provider, local development provider, and one cloud provider after privacy/procurement review. Grok voice/reasoning models are a production candidate, not a hard dependency.

## Consequences

Positive:

- Keeps station logic independent from provider APIs.
- Supports benchmarking, failover, and future model upgrades.
- Preserves prompt/model/memory/guardrail provenance for faculty review.
- Allows local development without production claims.

Negative:

- Adds adapter and test harness work early.
- Provider-specific streaming features may be harder to expose cleanly.
- Cost and privacy reviews remain mandatory before production use.

## Reversal Trigger

Revisit only if a single provider becomes contractually required and offers capabilities that cannot be modeled through the adapter without unacceptable latency or fidelity loss.

## Sources

- `src-xai-grok-voice-think-fast-2026`
- `src-xai-voice-api-docs-2026`
- `src-llama-cpp-github-2026`
- `src-local-laverde-llm-agents-pdf-2025`
- `src-local-bodonhelyi-medical-communication-pdf-2025`
