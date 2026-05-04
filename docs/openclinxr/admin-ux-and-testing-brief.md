# Admin UX And Testing Brief

Date: 2026-05-03
Status: Development-team guidance

## Purpose

OpenClinXR needs two different UX postures:

- Examinee UX: immersive WebXR, minimal administrative chrome, stable in-headset text surfaces.
- Non-examinee UX: dense, reviewable, auditable administrative workflows for scenario authors, psychometricians, faculty reviewers, legal/compliance, and operations.

The administrative experience should feel like a serious clinical education workbench, not a marketing site.

## Design Tooling

Preferred design path:

- Penpot for collaborative product design, component mapping, and inspectable UX handoff.
- OpenPencil as an MIT-licensed local/headless design exploration option.
- Avoid GPL-heavy design tools in the runtime or distributed developer workflow.

UX artifacts to maintain:

- Scenario authoring flow.
- Actor-card editor.
- Communication-style editor.
- Environment/equipment manifest editor.
- Exam blueprint builder.
- Psychometric coverage matrix.
- Review queue.
- Trace replay.
- Faculty scoring packet.
- Claims/consent/privacy governance views.
- Asset QA dashboard.

## Administrative UI Stack

Use:

- React 19 and TypeScript.
- React Router for nested administrative routes, deep links, loader/action boundaries where useful, and role-specific workbench navigation.
- Ant Design 6 components.
- Ant Design Pro v6 layout conventions. Runtime use of `@ant-design/pro-components` should stay behind a compatibility gate until the AntD 6-compatible v3 line resolves cleanly in the selected Vite/Vitest/NodeNext toolchain. On 2026-05-03 npm metadata showed the old `latest` tag at `2.8.10` with AntD 4/5 peers, while the v3 prerelease line was available at `3.1.12-0` with `antd: ^6.0.0`; a local import spike found package-resolution issues in the current toolchain.
- The [Ant Design CLI skill](https://github.com/ant-design/ant-design-cli/blob/main/skills/antd/SKILL.md) is a good optional guardrail for admin UI work: query exact-version component APIs, demos, semantic class names, and tokens before authoring forms/tables/layouts, use structured JSON output, and run AntD lint/doctor checks after substantial component changes. Keep installation deliberate and package-managed where possible; no global `antd` CLI is assumed.
- Tailwind CSS v4 is acceptable for admin layout utilities when it reduces local CSS surface area, while Ant Design tokens should remain the source of truth for component theming.
- `@xyflow/react` for scenario graph and state-machine editing.
- Apollo GraphQL as the admin query layer for review/governance workbench flows once the operation contract is stable enough to justify GraphQL over REST.
- GraphQL Code Generator for typed route/workbench queries, mutations, subscriptions, fragments, and resolver contracts. The first package-managed generator slice now emits typed station-run queue snapshot documents for `apps/ui-admin`, while avoiding Apollo-version-specific generated hooks until compatibility is proven.
- [Apollo GraphQL Skills](https://github.com/apollographql/skills) can be installed deliberately for agent-assisted schema, operation, and client review, but should not replace generated-document drift checks, Apollo Client compatibility tests, or the choice to avoid Apollo-version-specific generated hooks until verified.
- Zod or JSON Schema-driven forms where feasible.
- Storybook 10.3 for component states and visual review.
- `@storybook/addon-mcp` should be considered once Storybook stories become a maintained admin workbench artifact, because it can expose component/story context to local agents that help write and test stories. Keep it optional until Storybook and `@storybook/addon-vitest` are installed deliberately.

Development-team familiarity should bias implementation choices toward pnpm, Mongoose, Apollo GraphQL, GraphQL Code Generator, TurboRepo, Biome, React Router, Knip, and E18E for non-XR surfaces and developer tooling. When TurboRepo becomes active, use package-local task scripts, root-level `turbo run` delegation, changed-package `--affected` workflows, and uncached persistent dev tasks. The examinee runtime can stay thinner and more performance-oriented, especially where Quest 3 frame stability is more important than admin developer ergonomics.

Recommended shell:

- Top navigation for product area.
- Left side navigation for domain module.
- Route modules for scenario authoring, exam assembly, review queue, trace replay, assets, governance, and system operations.
- Dense tables with filters for scenario bank, reviews, assets, and traces.
- Drawer-based edit flows for narrow metadata.
- Full-page editors for scenario graph, station timeline, and trace replay.
- Inline status tags for review state, risk state, source coverage, and publication blockers.

## Core Admin Screens

1. Scenario Bank
   - Search, filters, specialty, environment, status, version, owner.
   - Open station draft, duplicate, archive, submit for review.

2. Scenario Editor
   - Doorway instructions.
   - Hidden truth and disclosure rules.
   - Actor roster.
   - Environment/equipment manifest.
   - Event schedule.
   - Dialogue fixtures.
   - Communication profiles.
   - Rubric and trace tags.

3. Scenario Graph
   - State nodes for doorway, encounter, note, scoring, debrief.
   - Event edges for learner action, actor interruption, vitals change, timer event.
   - Validation badges for unreachable or unreviewed states.

4. Exam Blueprint Builder
   - Ordered station list.
   - Coverage heatmap against skills, EPAs, specialties, and station types.
   - Psychometric metadata and form lock.

5. Review Queue
   - Clinical, psychometric, legal/compliance, simulation QA, asset QA.
   - Required comments for rejection.
   - Versioned sign-off and publication gate.

6. Trace Replay
   - Timeline with learner utterances, actor responses, vitals, environment events, model calls, and scoring events.
   - Grounding audit badges for explicit, implicit, fictional, blocked.
   - Video/XR reconstruction hooks when available.

7. Asset QA
   - Station bundle size, triangle counts, texture budgets, draw calls, license coverage, Quest smoke status.

## Examinee WebXR UI

In-headset text and data surfaces:

- Doorway instructions.
- Simulated EHR.
- Vitals.
- Orders/results.
- Patient note.
- Handoff prompts.

Use texture-backed or canvas-rendered React panels for complex data. Keep panel layout stable and readable. Avoid Ant Design-heavy DOM overlays in immersive mode unless they are rendered to a canvas or used only in desktop fallback.

## Test Pyramid

Automated from the first implementation sprint:

- Domain unit tests with Vitest.
- Contract tests for scenario schemas, actor response schemas, trace events, and model-provider adapters.
- GraphQL Code Generator checks for the current GraphQL schema/documents, including generated document drift checks now and generated client operations/resolver signatures as the Apollo layer matures.
- Storybook stories for every admin component state.
- Storybook interaction tests for form validation, review state changes, and graph editor controls.
- Optional Storybook MCP workbench for agent-assisted story authoring and UI state inspection after the Storybook lane is explicit.
- Serenity/JS acceptance tests in domain language.
- Biome formatting/lint checks once adopted by the workspace.
- Knip checks for unused files, exports, dependencies, and stale workspace references.
- E18E dependency-health checks for modernization and ecosystem-risk review.
- Playwright tests for admin UI and non-XR fallback.
- Synthetic WebGL/WebXR smoke tests in browser automation.
- Asset QA scripts for GLB integrity, texture format, bundle size, material count, and triangle count.

Manual/device gates:

- Quest 3 station launch.
- 72 FPS minimum idle and actor-response smoke.
- Hand/controller interactions.
- In-XR text readability.
- Audio turn-taking.
- Trace replay fidelity.

## Serenity/JS Acceptance Vocabulary

Example screenplay tasks:

```text
Given Sam is a Scenario Author
When Sam drafts an ED chest pain station
And Sam adds a patient, nurse, spouse, event schedule, rubric, and asset manifest
Then the station remains blocked until clinical, psychometric, legal, and simulation QA reviews are complete
```

```text
Given Priya is a Faculty Reviewer
When Priya opens a completed station replay
Then Priya can inspect learner utterances, actor responses, grounding badges, required trace events, and the submitted patient note before scoring
```

## Local LLM And Simulation Tests

On the M4 Max development mode:

- Run local model adapters for fixture and regression tests when model license permits.
- Use fixed seeds and snapshot traces for dialogue-policy regression.
- Do not treat local model output as production equivalent.
- Benchmark local latency, memory, and prompt adherence separately from cloud providers.

## Sources

- `src-penpot-github-2026`
- `src-openpencil-2026`
- `src-npm-stack-metadata-2026-05-03`
- `src-graphql-codegen-docs-2026`
- `src-apollo-graphql-skills-2026`
- `src-knip-e18e-tooling-2026`
- `src-ant-design-pro-v6-release-2026`
- `src-ant-design-cli-skill-2026`
- `src-turborepo-skill-2026`
- `src-storybook-10-3-2026`
- `src-storybook-addon-mcp-2026`
- `src-serenity-js-screenplay-2026`
- `src-mdn-webxr-performance-2026`
