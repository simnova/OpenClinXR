# Background Agent Model Assignment Policy

Use the smallest model that can complete the delegated task without lowering review quality. Background agents should be assigned intentionally rather than uniformly.

## Policy Tiers

| Tier | Model | Reasoning | Use |
| --- | --- | --- | --- |
| `fast_bounded` | `gpt-5.4-mini` | `low` | Read-only scouting, narrow gap checks, quick sidecar review, and nonblocking context collection. |
| `standard_execution` | `gpt-5.4` | `medium` | Bounded implementation or documentation slices with clear ownership and ordinary integration risk. |
| `expert_review` | `gpt-5.4` | `high` | Clinical, legal, psychometric, security, architecture, or QA review that needs specialist depth. |
| `frontier_thinking` | `gpt-5.5` | `high` or `xhigh` | Cross-domain adversarial review, leadership preflight, and final synthesis. Reserve `xhigh` for hard thinking, not routine execution. |

## Work Order Mapping

- `core_revision`: `standard_execution`
- `physician_specialty_review`: `expert_review`
- `legal_governance_review`: `expert_review`
- `adversarial_counterplan`: `frontier_thinking` with `gpt-5.5` and `xhigh`
- `leadership_preflight`: `frontier_thinking` with `gpt-5.5` and `high`
- `leadership_review`: `frontier_thinking` with `gpt-5.5` and `xhigh`

The executable source of truth is `recommendBackgroundAgentModel` and `recommendAgentModelForWorkOrder` in `packages/openclinxr/agent-loop`.
