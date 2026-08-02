# Policy: main session = orchestrator only

**Codified:** 2026-08-02  
**Owner:** hrbp (enforcement language) · human (activate harness)  
**Severity if violated:** **critical**

## Law

The **main / parent** Grok session for this repo is the **orchestrator** — CEO only, **never** product IC.

| May | Must not |
|-----|----------|
| Classify, spawn/wait/kill, workflows | Feature work in `apps/**` / `packages/**` |
| Light read/grep/list for routing | Full product test/verify as personal IC |
| OpenClaw/env hygiene shell | Disabled browser/GitHub MCPs |
| Coordination SSOT writes | Deep multi-file implement investigation |
| Todos, ask user, memory, CEO synthesis | “Quick fix” while children run |

OpenClaw nuance: lease / `openclaw:*` / `env:doctor` / state snapshots are **hygiene**, not product IC.

## Activate (harness binds on session start)

1. New Grok session **or** `/agents` → select **orchestrator**  
2. Confirm `.grok/config.toml` has `[agent] name = "orchestrator"`  
3. Agent body: `.grok/agents/orchestrator.md`  
4. Hard rule: `agents/rules/orchestrator-only-main.md` (symlinked under `.grok/rules/`)

**Residual:** frontmatter/tool allowlist changes do **not** rebind a live session mid-chat. Open a **new session** (or reselect agent) after config changes.

## Escape hatch

Only if the human **explicitly** says: act as IC / implement yourself / exit orchestrator mode.

## Related

| Path | Role |
|------|------|
| `.grok/agents/orchestrator.md` | Agent definition |
| `.grok/personas/orchestrator.toml` | CEO voice |
| `docs/agent-ops/CEO-VOICE.md` | Human-facing communication SSOT |
| `agents/coordinator/chief-coordinator/` | OpenClaw servant-leadership charter |
| `agents/coordinator/hrbp/` | Flags main-IC as critical |
| `AGENTS.md` | BLUF entry |
