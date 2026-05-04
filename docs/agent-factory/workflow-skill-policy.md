# Workflow Skill Recommendation Policy

Use workflow skills as local agent aids, not as hidden runtime dependencies. A skill recommendation should tell the agent which expert reference/tooling to consult, when to consult it, and what guardrails keep it from changing the architecture silently.

## Recommended Skills

| Skill | Use When | Guardrail |
| --- | --- | --- |
| [Apollo GraphQL Skills](https://github.com/apollographql/skills) | GraphQL schema, operation, Apollo Client, Rover, GraphQL MCP, or codegen review. | Advisory only; back changes with generated documents, repo tests, and selected Apollo/GraphQL Code Generator versions. |
| [Turborepo Skill](https://github.com/vercel/turborepo/blob/main/skills/turborepo/SKILL.md) | Package task orchestration, affected-package CI, cache behavior, or monorepo build graph work. | Keep task logic package-local, root scripts delegated through `turbo run`, telemetry disabled in scripts, and remote cache opt-in. |
| [Ant Design CLI Skill](https://github.com/ant-design/ant-design-cli/blob/main/skills/antd/SKILL.md) | Ant Design 6 component props, demos, semantic class names, design tokens, linting, or doctor checks. | Prefer package-managed execution and query exact-version APIs with JSON output before writing components. |
| ArchUnitTS | Import boundaries, cycle checks, package naming, or architecture decision enforcement. | Keep rules narrow, package-local, and part of `pnpm verify`. |
| Storybook MCP Addon | Maintained Storybook stories become agent-inspectable component artifacts. | Optional until installed deliberately; use alongside tests, not instead of tests. |

The executable source of truth is `recommendWorkflowSkillsForWorkOrder` in `packages/openclinxr/agent-loop`.
