# Core Revision

## Adopted Changes

The Core team accepts the red-team narrowing. The implementation plan will now use a dual-track first sprint:

- Track 1: CLI/test-harness proof of the station lifecycle.
- Track 2: minimal API/admin/XR shell that consumes the same fixture and trace contracts.

No optional local LLM, voice, MongoDB, asset-generation, Bun, or Quest-specific dependency may block Track 1.

## Revised First Sprint Definition

The first sprint is complete only when:

1. A deterministic ED chest pain station simulation runs in tests.
2. The generated trace replays in order.
3. Review packet flags observed and missing behaviors.
4. API exposes the same lifecycle through in-memory repositories.
5. Admin displays the review packet.
6. XR fallback displays doorway, timer, mock dialogue, and note panel.
7. Mock model and voice providers emit audit records.
8. A verification command proves all of the above without cloud keys or model downloads.

## Package Freeze For First Sprint

Allowed default packages:

- TypeScript
- Vitest
- AJV
- TypeBox
- Hono
- React
- Vite
- Ant Design
- Three.js or equivalent only after license intake
- Playwright after the first app exists

Deferred:

- MongoDB runtime dependency
- Bun install
- MLX LM
- llama.cpp
- Ollama
- VibeVoice
- MakeHuman/ANNY/StableGen/SMPLitex asset generation
- Serenity/JS
- Storybook beyond a first admin component story

## Claim-Language Guard

Every user-visible and documentation-facing feature should use these terms:

- "training simulation"
- "faculty review"
- "scenario review"
- "practice station"
- "trace-supported review"

Avoid:

- "diagnosis engine"
- "automated licensure scoring"
- "ECFMG replacement"
- "USMLE equivalent"
- "validated high-stakes exam"

## Updated Test Priority

1. Schema contract tests.
2. Domain transition tests.
3. Trace append/replay tests.
4. Review packet tests.
5. Test harness station simulation.
6. API contract tests.
7. Admin review gate test.
8. XR nonblank rendering test.
9. Provider health-state tests.
10. Dependency-license gate test.

