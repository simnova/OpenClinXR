# Workflow Skill Recommendation Policy

Use workflow skills as local agent aids, not as hidden runtime dependencies. A skill recommendation should tell the agent which expert reference/tooling to consult, when to consult it, and what guardrails keep it from changing the architecture silently.

## Recommended Skills

| Skill | Source Record | Use When | Guardrail |
| --- | --- | --- | --- |
| [Apollo GraphQL Skills](https://github.com/apollographql/skills) | `src-apollo-graphql-skills-2026` | GraphQL schema, operation, Apollo Client, Rover, GraphQL MCP, or codegen review. | Advisory only; back changes with generated documents, repo tests, and selected Apollo/GraphQL Code Generator versions. |
| [Turborepo Skill](https://github.com/vercel/turborepo/blob/main/skills/turborepo/SKILL.md) | `src-turborepo-skill-2026` | Package task orchestration, affected-package CI, cache behavior, or monorepo build graph work. | Keep task logic package-local, root scripts delegated through `turbo run`, telemetry disabled in scripts, and remote cache opt-in. |
| [Ant Design CLI Skill](https://github.com/ant-design/ant-design-cli/blob/main/skills/antd/SKILL.md) | `src-ant-design-cli-skill-2026`; local spike `src-ant-design-cli-local-spike-2026-05-04` | Ant Design 6 component props, demos, semantic class names, design tokens, or doctor checks. | Prefer package-managed execution and query exact-version APIs with JSON output before writing components; keep `antd lint` advisory until the local `ERR_REQUIRE_ESM` failure is resolved. |
| ArchUnitTS | `src-archunit-ts-github-2026` | Import boundaries, cycle checks, package naming, or architecture decision enforcement. | Keep rules narrow, package-local, and part of `pnpm verify`. |
| Storybook MCP Addon | `src-storybook-addon-mcp-2026` | Maintained Storybook stories become agent-inspectable component artifacts. | Optional until installed deliberately; use alongside tests, not instead of tests. |
| Meta Immersive Web SDK MCP tooling | `src-meta-iwsdk-github-2026`; `src-iwsdk-ai-docs-2026`; `src-iwsdk-npm-metadata-2026-05-04` | XR scene screenshots, controller input simulation, scene/ECS inspection, and WebXR debugging spikes. | Advisory until installed in an isolated spike. Validate Vite 8 compatibility, package size, local model/reference downloads, and Quest 3 behavior before adding to required verification. Do not use optional `@meta-quest/hzdb` without legal review. |

The executable source of truth is `recommendWorkflowSkillsForWorkOrder` in `packages/openclinxr/agent-loop`.

Changed-package work should prefer the `packages:*:affected` scripts for local package verification, then finish with the full `pnpm verify` gate before a clean commit.
