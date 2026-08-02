# Capability evolution (tool / model / MCP)

Agents escalate constraints; **hrbp** triages; human only for paid/cloud/secrets.

## When to escalate

Material block: missing CLI, wrong model tier, need re-enable MCP for a bounded session, new skill.

## Process

1. Agent emits `CAPABILITY_CONSTRAINT` in FINAL + files `docs/agent-ops/capability-requests/` from TEMPLATE.
2. Parent routes residual to **hrbp**.
3. hrbp: approve / reject / defer; apply definition changes under `.grok/agents|personas` or role-harness-policy (via implementer if code).
4. Prefer **CLI** over re-enabling MCP (`docs/TOOLING.md`).
5. Human only for: paid APIs, secrets, production deploy, clinical claim expansion.

## Defaults (OpenClinXR)

| Need | Prefer |
|------|--------|
| Browser | `pnpm playwright:*`, `pnpm browser:agent` |
| GitHub | `gh` |
| Toolchain | `pnpm env:doctor` |
| Diagrams | drawio MCP (optional) |
| Mongo Atlas agent | mongodb plugin (optional) |
