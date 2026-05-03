# Technology Approach Brief

Date: 2026-05-03
Status: Development-team guidance

## Purpose

This brief reconciles the original OpenClinXR assets with the newest user-supplied technology notes. It gives the development team a pragmatic path that is TypeScript/React first, Quest 3 conscious, Azure B1 compatible for a single-user pilot, and grounded in open-source or commercially supportable technology with license risk explicitly called out.

## Design Posture

The first product should be a single-user, fully functional clinical-skills exam skeleton with high-fidelity station data, optimized WebXR assets, deterministic actor fixtures, human review, trace replay, and optional LLM/voice adapters.

The first product should not try to generate humans, textures, clothes, animation, and clinical dialogue live on Azure B1. Heavy generation belongs in an offline asset pipeline on an M4 Max MacBook Pro or a separate workstation/container. Runtime delivery on Quest 3 should load already optimized GLB/KTX2/meshopt assets from static storage or CDN.

The second product maturity layer is behavioral fidelity: actors should have structured communication styles, bounded emotional resistance, and emotion/style QA. This is needed so stations can test empathy, de-escalation, health literacy, family pressure, and interprofessional communication rather than only medical fact recall.

## License Posture

Preferred licenses for runtime dependencies:

- MIT.
- Apache-2.0.
- BSD-style.
- CC0/CC-BY assets when attribution is manageable.

Allowed with caution:

- MPL-2.0 for standalone tools such as Penpot, provided modified MPL files are handled correctly and the tool is not embedded into OpenClinXR runtime.
- Commercial APIs or SDKs behind replaceable adapters after privacy, data-use, and procurement review.

Avoid in runtime and distributed product:

- AGPL.
- GPL.
- Strong copyleft plugins or source code.
- Any model weights with non-commercial, research-only, unclear, or downstream-incompatible terms.

Tooling with GPL/AGPL can be evaluated only as isolated internal authoring infrastructure if counsel approves and output-asset licenses are clean. Do not copy GPL/AGPL code into OpenClinXR.

## Recommended Stack

### WebXR Examinee Runtime

- React 19 + TypeScript.
- Three.js + React Three Fiber.
- `@react-three/xr` for WebXR interaction surfaces.
- glTF/GLB as the runtime 3D delivery format.
- KTX2/Basis Universal texture compression.
- Meshopt compression for geometry and animation.
- Baked lighting, baked facial/body clips, and lightweight runtime blending.
- Zustand or CellixJS-compatible state adapters for local client state.
- HTML-in-canvas or texture-backed React surfaces for case notes, EHR panels, vitals, and order panels.

The examinee should spend most time inside WebXR. Browser DOM and Ant Design components should not be the primary examinee UI once the station starts, except where rendered into a texture or used in a non-XR fallback mode.

### Administrative Web Apps

- React 19 + TypeScript.
- React Router for route ownership, nested administrative layouts, and workstation-friendly deep links.
- Ant Design 6 for enterprise UI components.
- Ant Design Pro layout patterns for admin/faculty/scenario-author screens.
- `@xyflow/react` for scenario graph editing.
- Storybook 10.3 for component workshop, documentation, and interaction tests.
- Serenity/JS for domain-language acceptance tests across API, admin UI, and workflow flows.
- Vitest for unit and component tests.
- Playwright for browser automation and visual/regression checks.

Penpot is the preferred design collaboration tool. OpenPencil is a promising MIT-licensed alternative for local/headless design workflows. Legacy Pencil Project should be avoided because its GPL licensing conflicts with the license posture.

### Backend

- Bun + Hono as the TypeScript API runtime.
- Hono for REST, middleware, request validation, and lightweight service boundaries.
- Apollo GraphQL as the preferred query/BFF layer for administrative workbenches once domain contracts stabilize.
- GraphQL Code Generator for typed operations, resolver signatures, and generated client/admin SDK artifacts once the GraphQL schema is introduced.
- Bun native WebSockets for the first real-time channel.
- A transport adapter interface that can later support WebTransport where the browser, server, and Azure/proxy path all support HTTP/3 end to end.
- MongoDB API compatible persistence, with Azure Cosmos DB or MongoDB Atlas depending on deployment.
- Mongoose as the team-familiar ODM candidate for mature admin-facing schemas, while low-level trace replay can keep thin repository contracts for ordered append/upsert performance.
- Object storage/CDN for optimized assets.
- Worker queue for asset-processing jobs, never synchronous heavy processing on B1.

### Monorepo And Developer Tooling

- pnpm workspaces are the preferred package-management baseline; keep npm scripts only as compatibility shims where they already exist, and avoid introducing npm-first workflows.
- TurboRepo should be adopted when package count and CI time justify task caching, affected-package execution, and clearer build graph ownership.
- Biome should be the default lint/format candidate because it is fast, TypeScript-friendly, and easier to standardize across apps/packages than a loose formatter/linter mix.
- Knip should be added as the unused-files/exports/dependencies gate once package boundaries stabilize.
- E18E should be used as an ecosystem-health and dependency-modernization signal when evaluating package choices and periodic upgrades.
- Use `@graphql-codegen/cli` with the client preset for route/workbench query documents and TypeScript resolver plugins for server contracts; avoid older Apollo-specific generated hooks until compatibility with the selected Apollo Client version is verified.
- Keep package boundaries compatible with CellixJS-style domain cells so TurboRepo tasks can map cleanly to domain ownership.

### LLM And Voice

Provider adapter interface:

- Cloud frontier model adapter for scenario generation, review assistance, and actor dialogue.
- xAI Grok adapters for production voice experiments, especially `grok-voice-think-fast-1.0` and xAI streaming STT/TTS APIs if privacy and procurement reviews pass.
- Local LLM adapter for M4 Max development using llama.cpp, Ollama, or MLX-compatible tooling.

LLM/voice outputs must remain traceable:

- Prompt ID.
- Model ID/version.
- Provider.
- Retrieved memory IDs.
- Actor card version.
- Safety policy version.
- Response text/audio reference.
- Guardrail decision.
- Latency.
- Cost estimate.

## Original Asset Decisions To Preserve

From the original architecture bundle:

- Bun/Hono control plane.
- CellixJS-style actor/cell boundaries.
- MongoDB/Cosmos document model.
- Record/replay trace ledger.
- Scenario graph and state machine.
- Emotion, attention, and reaction engine.
- Aggressive pre-baking.
- Penpot + Ant Design for administrative UX.
- Quest 3 pass-through/WebXR orientation.

Changes from this pass:

- Treat WebTransport as a spike, not the default B1 transport.
- Treat StableGen as optional isolated authoring because it is GPL-3.0.
- Treat MakeHuman/MPFB code as authoring-only because source is AGPL/GPL, while CC0 assets remain attractive.
- Promote Anny as the preferred permissive human-generation baseline.
- Promote Mesh2Motion as a permissive rigging/animation aid.
- Treat NVIDIA ACE/Audio2Face as a commercial adapter, not open-source baseline.

## Recommended Dependency Table

| Area | Recommendation | License posture | Notes |
| --- | --- | --- | --- |
| Human base mesh | Anny | Apache-2.0 code, CC0 adapted assets | Primary pipeline candidate for body diversity and age range |
| Human fallback | MakeHuman/MPFB/MakeHuman assets | Source AGPL/GPL, core assets CC0 | Use outputs/assets only after license review; do not embed source |
| Clothes | MakeClothes / MakeHuman assets | MIT plugin, CC0 assets where verified | Keep per-asset license metadata |
| Skin/textures | Authored Blender/PBR, CC0 texture libraries, optional StableGen isolated | StableGen GPL-3.0 | Avoid runtime/distribution; use only if counsel approves |
| Auto-rig/animation | Mesh2Motion | MIT code, CC0 exported animation content claimed | QA every rig and retarget |
| Face/lip sync | Baked visemes, optional NVIDIA ACE/Audio2Face | Commercial/proprietary terms | Adapter only; no hard dependency |
| WebXR | Three.js, R3F, @react-three/xr | Mostly MIT-compatible; verify @react-three/xr license file | Device-test Quest 3 early |
| Admin UI | Ant Design 6, Pro Components, React Router | MIT | Use Ant Design Pro layout conventions and route-based workbench modules |
| Graph editor | @xyflow/react | MIT | Scenario graph, state machine, review workflows |
| Admin query layer | Apollo GraphQL | MIT | Add after REST/domain contracts stabilize; best fit for trace/review/schema-rich admin screens |
| GraphQL typing | GraphQL Code Generator | MIT | Generate typed admin operations and resolver signatures from schema/documents |
| Mongo ODM | Mongoose | MIT | Candidate for scenario, review, user-facing admin schemas; keep trace repositories performance-oriented |
| Testing | Vitest, Storybook, Serenity/JS, Playwright | MIT/Apache-2.0 mix | Add headset smoke tests outside browser emulation |
| Backend | Bun, Hono | MIT | Use WebSocket first; spike WebTransport |
| Package manager | pnpm | MIT | Preferred over npm for workspace security posture and deterministic dependency management |
| Monorepo orchestration | TurboRepo | MPL-2.0 | Good fit once CI caching/affected builds matter; verify deployment implications |
| Lint/format | Biome | MIT/Apache-2.0 | Candidate single-command style and lint gate |
| Dependency hygiene | Knip, E18E | ISC/MIT mix; verify exact package licenses | Detect unused exports/dependencies and flag ecosystem modernization opportunities |
| Local LLM | llama.cpp/Ollama/MLX | Verify runtime and model licenses | Feasible for dev/demo on M4 Max, not validated clinically |

## Development Team Guidance

1. Start with deterministic station seed data and optimized placeholder assets.
2. Build every runtime interface as provider-agnostic.
3. Keep generated assets versioned and reproducible through manifests.
4. Keep Quest 3 frame stability more important than visual detail.
5. Keep B1 Azure as orchestration only.
6. Require license metadata for every source asset, generated mesh, texture, animation, and voice.
7. Run LLM and speech providers behind adapters so Grok, local LLMs, and future providers can be swapped without changing station logic.
8. Use Storybook and Serenity/JS from the start so non-XR workflows remain testable while XR testing matures.
9. Treat communication style as a first-class actor-card property with explicit QA, not as a loose prompt adjective.
10. Bias implementation decisions toward the support team's known tools where they do not weaken runtime performance or governance: pnpm, Mongoose, Apollo GraphQL, GraphQL Code Generator, TurboRepo, Biome, React Router, Knip, and E18E are preferred candidates for the admin/control-plane and developer-tooling surface.

## Sources

- `src-internal-openclinxr-architecture-bundle`
- `src-anny-github-2026`
- `src-makehuman-community-license-2026`
- `src-makehuman-makeclothes-github-2026`
- `src-stablegen-github-2026`
- `src-mesh2motion-2026`
- `src-nvidia-ace-audio2face-2026`
- `src-xai-grok-voice-think-fast-2026`
- `src-xai-voice-api-docs-2026`
- `src-mdn-webtransport-2026`
- `src-mdn-webxr-performance-2026`
- `src-penpot-github-2026`
- `src-openpencil-2026`
- `src-npm-stack-metadata-2026-05-03`
- `src-graphql-codegen-docs-2026`
- `src-knip-e18e-tooling-2026`
- `src-storybook-10-3-2026`
- `src-serenity-js-screenplay-2026`
- `src-azure-app-service-plan-docs-2026`
- `src-llama-cpp-github-2026`
- `src-local-bodonhelyi-medical-communication-pdf-2025`
