# Core Revision

## Accepted Red Team Changes

The core team accepts the adversarial constraints.

Phase 1 runtime rule:

- No live body, texture, clothing, or full-motion generation.
- No live Blender, StableGen, Audio2Face, or local LLM inference on Azure B1.
- No live body gesture generation on Quest 3.
- Use deterministic fixtures and optimized placeholder assets first.

License rule:

- Runtime asset ingestion requires provenance and license metadata.
- GPL/AGPL tools are forbidden runtime dependencies.
- Tool outputs require counsel review when terms are ambiguous.

Device rule:

- A station cannot be simulation-QA approved without Quest 3 smoke testing.

Provider rule:

- Model/voice providers must pass a benchmark harness before production use.

Score-use rule:

- All learner reports remain formative/local until psychometric evidence supports broader claims.

## Revised First Implementation Scope

Build a one-station deterministic ED chest pain skeleton that exercises:

- Scenario bank CRUD.
- Actor cards with communication profiles.
- Environment/equipment manifest.
- Station statechart.
- Encounter timer and patient note timer.
- Mock patient, spouse, and nurse responses.
- Trace events.
- Review packet.
- Asset registry records.
- Admin screens with Ant Design.
- Storybook/Serenity/Vitest/Playwright test scaffold.

The voice and LLM adapters can exist as contracts and mocks first.

## Deferred Until Spikes Pass

- Live cloud voice in the exam runtime.
- WebTransport default transport.
- Mesh2Motion/Audio2Face production pipeline.
- Multi-user concurrent exam delivery.
- Automated scoring beyond human-reviewed formative scoring.
