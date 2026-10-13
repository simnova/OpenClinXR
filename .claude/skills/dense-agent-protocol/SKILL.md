---
name: dense-agent-protocol
description: Format for AGENT-TO-AGENT text only - worker briefs, handbacks, consult prompts, result envelopes and BothyBoard card fields - as keyed dense records (KEY::value), numbered ids, sourced WHY lines, one key holding the complete set for its concept. Load BEFORE writing a brief, a handback, a consult prompt or a board card. Not for operator-facing prose.
---

# Dense agent protocol

The single source is the shared skill: read `.agents/skills/dense-agent-protocol/SKILL.md` and
follow it. This file exists only so the Claude harness lists the skill; it carries no rules of its
own, so the two cannot drift.
