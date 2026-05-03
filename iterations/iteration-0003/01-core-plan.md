# Core Team Plan

## Lead Position

OpenClinXR should start as a single-user, fully functional XR clinical-skills exam skeleton. The first milestone should be deterministic and auditable, with LLM/voice adapters enabled behind gates. Heavy asset and model generation happens offline or through external providers; Quest 3 and Azure B1 serve optimized experiences and orchestration.

## Development Handoff Additions

The core team produced or updated:

- `docs/openclinxr/technology-approach-brief.md`
- `docs/openclinxr/asset-generation-pipeline.md`
- `docs/openclinxr/webxr-azure-quest-performance-brief.md`
- `docs/openclinxr/virtual-patient-agent-model.md`
- `docs/openclinxr/communication-style-and-emotion-qa.md`
- `docs/openclinxr/sample-case-bank-v1.md`
- `docs/openclinxr/admin-ux-and-testing-brief.md`
- `docs/openclinxr/model-provider-and-voice-routing.md`
- MADRs 0016 through 0020

## Architecture Shape

The TypeScript implementation should use a monorepo with domain packages for exam blueprint, scenario bank, actor runtime, trace ledger, review workflow, model gateway, asset registry, and shared schemas. Bun/Hono is preferred for the first API/runtime path, with MongoDB-compatible persistence and static/CDN asset delivery.

The XR runtime uses WebSocket first, not WebTransport first. WebTransport remains a spike behind an interface after Quest 3 and Azure/proxy compatibility are measured.

## Virtual Patient And Actor Runtime

Every actor is a bounded generative agent:

- Case memory.
- Short-term conversation memory.
- Reflection/planning memory.
- Station-state/action policy.
- Communication-style and emotion policy.

The Laverde paper inspired memory stream, retrieval, reflection, and explicit/implicit/fictional response QA. The Bodonhelyi paper inspired first-message mood setting, author-note refresh, structured communication profiles, bounded stubbornness, and emotion/sentiment QA.

## Asset Pipeline

The asset path is offline and manifest-driven:

- Scenario case spec.
- Asset manifest.
- Human generation.
- Clothes/skin authoring.
- Rigging and retargeting.
- Animation clips.
- Environment/equipment kit.
- Optimization bake.
- Quest 3 visual/performance/license QA.
- Asset registry.

Anny is the preferred permissive human-generation candidate. MakeHuman/MPFB is authoring-only until counsel approves source/output boundaries. StableGen is optional isolated authoring because current repo licensing is GPL-3.0. Mesh2Motion is a promising permissive rigging/animation path. NVIDIA ACE/Audio2Face is a commercial adapter, not the open-source baseline.

## Admin UX And Testing

Non-examinee workflows use Ant Design 6, Ant Design Pro conventions, Storybook, Serenity/JS, Playwright, Vitest, Penpot, and OpenPencil. Examinee UX remains mostly in WebXR with canvas/texture-backed data surfaces for EHR, vitals, notes, and doorway instructions.

## Case Bank

The first seed bank has 12 station specifications across ED, pediatrics, ward, telehealth, OB, psychiatry, stroke, sepsis, urgent care, oncology, surgery, and primary care. Each case includes environment needs, actor roster, hidden truth, event schedule, dialogue fixtures, 3D asset requirements, trace tags, and communication-style intent.

## Core Recommendation

Proceed to a later implementation plan only after reviewing this handoff and completing the first technical spikes:

- Quest 3 runtime smoke.
- WebSocket latency.
- ASR/TTS medical vocabulary and turn-taking.
- Model-provider grounding/style adherence.
- Asset bundle size and frame stability.
- License review for asset tools and `@react-three/xr`.
