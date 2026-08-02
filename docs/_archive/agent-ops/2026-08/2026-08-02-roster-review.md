# Agent roster review — 2026-08-02

Reviewer: hrbp (bootstrap audit)  
Cadence: ad-hoc (Grok 4.5 modernization + CLI-first MCP)

## Summary

- Agents reviewed: 14 OpenClaw roles under `agents/**` (+ dual harness outputs)
- Critical: 0 (after this change set)
- Major: historical (pre-change) — fat spawn seeds, no YAML frontmatter, MCP-centric instructions
- Top 3 actions (done this session):
  1. Introduce **hrbp** role + `docs/agent-ops/**`
  2. Upgrade `.grok/agents/*.md` to **Grok-native YAML frontmatter** (`mcpInheritance: none`, tool denylist)
  3. Strip multi-KB spawn seeds from agent identity files; use `pnpm grok:agent:spawn-spec` at runtime

## Findings (before → after)

| Dimension | Before (legacy) | After |
|-----------|-----------------|--------|
| **Grok agent format** | Pointer MD with embedded spawn seed (context bloat) | YAML frontmatter per user-guide 16-subagents |
| **Agents vs Personas** | Blurred (persona text in seed) | Personas in `.grok/personas/`; agents declare tools/model |
| **MCP** | Charters/personas referenced grok_com_github, playwright MCP | CLI-first in LEX/charter/persona; `mcpInheritance: none` |
| **SoD** | Write scopes in policy notes only | Explicit in agent body + role-harness-policy |
| **HRBP / cadence** | Missing | `hrbp` role + REVIEW-CADENCE / RACI / CAPABILITY-EVOLUTION |
| **Success criteria** | Persona BLUF / handoff JSON | Still role-specific; agentic-io-contract for FINAL |

## Per-agent scorecard (post-change)

| Agent | SoD | Success | Tools/MCP | Model/effort | Notes |
|-------|-----|---------|-----------|--------------|-------|
| chief-coordinator | PASS | PASS | PASS (no write tools) | flash / fast_bounded | Orchestration only |
| hrbp | PASS | PASS | PASS (agent-ops write roots) | pro / standard_execution write | New |
| openclaw-drift-police | PASS | PASS | PASS | flash | Coordination drift |
| productivity-skeptic | PASS | PASS | PASS | flash | Adversarial |
| visual-realism-adversary | PASS | PASS | PASS | flash | Adversarial |
| implementation-plan-gap-attacker | PASS | PASS | PASS | flash | Adversarial |
| implementation-planning-lead | PASS | PASS | PASS | pro | Plan sequencing |
| asset-pipeline-lead | PASS | PASS | PASS | pro + write | Anny/assets |
| rigging-animation-specialist | PASS | PASS | PASS | pro + write | |
| xr-systems-architect | PASS | PASS | PASS | pro + write | UI-XR |
| pediatrics-physician | PASS | PASS | PASS | pro expert | Clinical wording |
| clinical-safety-critic | PASS | PASS | PASS | pro expert | |
| license-provenance-specialist | PASS | PASS | PASS | pro expert | |
| vp-engineering-delivery | PASS | PASS | PASS | grok-build frontier | Composer surface |

## SoD matrix (write roots — summary)

| Concern | Sole / primary | Conflicts |
|---------|----------------|-----------|
| PROJECT_STATUS / lease | chief-coordinator | Others read/consult |
| Agent definitions / agent-ops | hrbp | drift-police on process only |
| Asset pipeline tools | asset-pipeline-lead | rigging when assigned |
| UI-XR / XR packages | xr-systems-architect | |
| Protected guardrail docs | none (do not weaken) | drift-police enforces |

## CLI-first / MCP audit

| Disabled MCP | Agent guidance |
|--------------|----------------|
| playwright | `pnpm playwright:*` |
| chrome-devtools | playwright / browser:agent CLI |
| agent-browser | `pnpm browser:agent` (CLI enabled) |
| grok_com_github | `gh` / `pnpm gh:status` |

All generated `.grok/agents/*.md` set **`mcpInheritance: none`**.

## Revisions applied

- `agents/coordinator/hrbp/**` — new role
- `packages/.../role-harness-policy.ts` — hrbp policy
- `tools/agent-factory/generate-harness-agents.ts` — modern Grok frontmatter
- `.grok/agents/*.md` — regenerated
- `.grok/personas/hrbp.toml`, `.grok/roles/hrbp.toml`, `.grok/prompts/agentic-io-contract.md`
- `docs/agent-ops/**` — governance pack

## Residual

- Optional: further slim `.claude`/`.cursor` pointers; add harness-neutral FINAL contract if multi-vendor spawn increases
- Optional: `pnpm agent:harness:prove` after next policy tweak
- Human: none required for this bootstrap

## Follow-up (same day): CEO main session

- Added `.grok/agents/orchestrator.md` + `[agent] name = "orchestrator"`
- Hard rule `agents/rules/orchestrator-only-main.md` + CEO-VOICE / MAIN-SESSION docs
- HRBP: main product IC remains **critical**

## VERDICT

**ROSTER_HEALTHY** (post-modernization + CEO main) — re-review after next new role or MCP policy change. Open **new Grok session** to bind orchestrator tool allowlist.
