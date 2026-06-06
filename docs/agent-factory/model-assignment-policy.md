# Background Agent Model Assignment Policy

**Rehydrate + Hyper Note (2026-05-28 per AGENTS):** Before model assignment or delegation, rehydrate using AGENTS.md + Current State Snapshot + Efficiency Quick Ref from the 3 state files (snapshots first; grep tool + limits). Lease before writes. Primary: OpenClaw continuous slices on current product (UI-XR runtime evidence consumer + materialization for peds_asthma on M1 Max 64GB); full iteration loop only for synthesis. Use fast/cheap models for targeted reads, mechanical validation, narrow patches (per model policy). Reserve frontier for adversarial/senior/ambiguous. After agentic doc changes, run alignment+drift. See AGENTS "Hyper Token-Efficient & Long-Run Practices".

Use the smallest model that can complete the delegated task without lowering review quality. Background agents should be assigned intentionally rather than uniformly.

## Policy Tiers

| Tier | OpenAI default | Grok harness | Codex Desktop | Reasoning | Use |
| --- | --- | --- | --- | --- | --- |
| `fast_bounded` | `gpt-5.4-mini` | `deepseek-v4-flash` | `gpt-5.4-mini` | `low` | Read-only scouting, narrow gap checks, quick sidecar review, and nonblocking context collection. |
| `standard_execution` | `gpt-5.4` | `deepseek-v4-pro` | `gpt-5.4` | `medium` | Bounded implementation or documentation slices with clear ownership and ordinary integration risk. |
| `expert_review` | `gpt-5.4` | `deepseek-v4-pro` | `gpt-5.4` | `high` | Clinical, legal, psychometric, security, architecture, or QA review that needs specialist depth. |
| `frontier_thinking` | `gpt-5.5` | `grok-build` | `gpt-5.5` | `high` or `xhigh` | Cross-domain adversarial review, leadership preflight, and final synthesis. Reserve `xhigh` for hard thinking, not routine execution. |

## Harness Notes

### Grok

- Prefer direct DeepSeek (`deepseek-v4-flash` for scouts, `deepseek-v4-pro` for implementation/review) when the API key/env is available.
- Use `grok-build` for frontier leadership/adversarial synthesis.
- Do **not** route Grok subagents through Moonbridge when direct DeepSeek is available.

### Codex Desktop

- Codex cannot select DeepSeek models in the native model picker. Use the tier-appropriate OpenAI model in `.codex/agents/*.toml`.
- **Moonbridge is Codex-only optional assist** for bounded first-pass review on `fast_bounded` and `expert_review` roles (`pnpm local:moonbridge:probe`). It is not a substitute for implementation judgment or protected-claim review.
- Upgrade to frontier Codex models for implementation slices and readiness/protected-claim judgment.

### Production pipeline assist (generic)

Asset generation, scene optimization, and factory QA are not fully procedural today. A production pipeline may still use a swappable `ModelAssistProvider` (Moonbridge now; DeepSeek or other approved online models later) for **bounded agentic evaluation and optimization** behind explicit gates. Procedural-only operation remains the long-term goal; online AI is permitted where it materially improves generated assets or scene quality without bypassing review gates.

Moonbridge and direct DeepSeek are **not** runtime/provider readiness claims. They are assist tiers only.

## Repo Role Defaults

Per-role harness policy (model tier, sandbox, skills, Moonbridge eligibility) lives in `packages/openclinxr/agent-loop/src/role-harness-policy.ts`. Codex custom agents are generated from that file via `pnpm agent:harness:sync`.

| Role | Tier | Codex sandbox | Moonbridge on Codex |
| --- | --- | --- | --- |
| chief-coordinator, openclaw-drift-police, gap-attacker, productivity-skeptic, visual-realism-adversary | `fast_bounded` | read-only | yes (first-pass only) |
| implementation-planning-lead, asset-pipeline-lead, rigging-animation-specialist, xr-systems-architect | `standard_execution` | read-only or workspace-write | no |
| pediatrics-physician, clinical-safety-critic, license-provenance-specialist | `expert_review` | read-only | yes (first-pass only) |
| vp-engineering-delivery | `frontier_thinking` | read-only | no |

## Work Order Mapping

- `core_revision`: `standard_execution`
- `physician_specialty_review`: `expert_review`
- `legal_governance_review`: `expert_review`
- `adversarial_counterplan`: `frontier_thinking` with `xhigh` on OpenAI/Codex or `grok-build` on Grok
- `leadership_preflight`: `frontier_thinking` with `high`
- `leadership_review`: `frontier_thinking` with `xhigh`

## Memory Write-Back

After a slice produces a durable lesson for a consulted role:

```bash
pnpm agent:memory:append -- --role <role-id> --topic <topic> --lesson "<text>"
```

This appends to `agents/<group>/<role>/memory.md` and rebuilds `.agent-factory/memory-index.json`.

## Executable Sources Of Truth

- `recommendBackgroundAgentModel`, `recommendAgentModelForWorkOrder`, and `recommendWorkflowSkillsForWorkOrder` in `packages/openclinxr/agent-loop`
- `repoRoleHarnessPolicies` in `packages/openclinxr/agent-loop/src/role-harness-policy.ts`
- Generated `.codex/agents/*.toml` from `pnpm agent:harness:sync`