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
| Meta Immersive Web SDK MCP tooling | `src-meta-iwsdk-github-2026`; `src-iwsdk-ai-docs-2026`; `src-iwsdk-npm-metadata-2026-05-04`; `src-iwsdk-local-spike-2026-05-04` | XR scene screenshots, controller input simulation, scene/ECS inspection, and WebXR debugging spikes. | Advisory until installed in an isolated committed spike. The local scratch spike built under explicit Node 22, but found Vite 8 peer mismatch, Rolldown native-binding setup friction, 287 MB install size, a 504.47 kB app chunk, 1116.3 kB injected dev runtime, LGPL sharp/libvips, and `@iwsdk/reference` docs-vs-npm version drift. Do not add IWSDK to the production XR runtime, required verification, reference warmup, or optional `@meta-quest/hzdb` path until those are resolved and legal/procurement clears the dependency shape. |

The executable source of truth is `recommendWorkflowSkillsForWorkOrder` in `packages/openclinxr/agent-loop`.

Changed-package work should prefer the `packages:*:affected` scripts for local package verification, then finish with the full `pnpm verify` gate before a clean commit.

## Multi-Harness / Standardized Discovery

`.agents/skills/` (populated according to the recommendations above and `skills-lock.json`) is the single source of truth for workflow skills in this repo.

To make these skills available to standard agent harnesses without duplication or symlinks:

- Grok: A project-scoped `.grok/config.toml` (at repo root) includes the path:
  ```toml
  [skills]
  paths = [".agents/skills"]
  ```
  (See `.grok/config.toml` and the Grok skills documentation for details on additional paths and priority.)

- Other harnesses (Claude, Cursor, etc.): Configure their equivalent "additional skills paths" or "custom skills directory" setting to point at `.agents/skills/` (or a sub-path). This keeps one canonical location while supporting many tools.

This approach prioritizes standardization across harnesses while preserving the project's internal agent tooling expectations.
