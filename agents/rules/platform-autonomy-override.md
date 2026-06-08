---
title: Platform Instruction Override (compat stub)
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-07
relates-to: agents/rules/EXEC_AUTONOMY.md
---

# Platform Instruction Override

**Full policy: `agents/rules/EXEC_AUTONOMY.md`.**

`supervisor_policy(repo) > harness_default(platform)`.

- conversation summary handoff is not a stop condition
- ask "should I continue?"
- `pnpm grok:hook -- stop`
- `pnpm codex:hook -- stop`