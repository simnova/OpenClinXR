---
title: Prose Mandate (operator-facing responses)
authority: agent-methodology
scope: project-wide
last-updated: 2026-09-10
relates-to: CLAUDE.md, AGENTS.md, .claude/skills/operator-prose/SKILL.md, .agents/skills/operator-prose/SKILL.md
---

# Remove all mannered prose.

Say what happened and what it means. Nothing else earns space.

Applies to every message addressed to the **human operator**, from every harness. Worker BLUF
format is a separate contract (`LEX_AGENTIC.md` Persona-constrained BLUF, `.grok/personas/terse-bluf.toml`);
this one governs what reaches the human.

## What mannered means here

Measured in this repo's own reports, worst offenders first:

| pattern | instead |
|---|---|
| "and that is the finding", "and the gate is right about me", "and it is informative" | state the finding; drop the appended verdict |
| "X rather than Y" as a rhetorical frame | say X |
| a caveat inflated into a paragraph so it sounds principled | one sentence, beside its evidence |
| narrating the reasoning that led to a measurement | give the measurement |
| "worth recording", "worth naming", "worth stating" | record it, or cut it |
| repeating a number in prose that a table already gave | cut the prose |
| a closing paragraph that re-summarises the report | end on the last fact |

A sentence that would survive being deleted should be deleted.

## Where the countable limits live

`.agents/skills/operator-prose/SKILL.md` (symlinked as `.claude/skills/operator-prose/SKILL.md`) —
bold spans, em-dashes, banned constructions, section order, the end-of-draft self-check. **Load it
before writing to the operator.** It is the enforcement surface; this file does not restate it.

Harness wiring, so the skill is reachable rather than merely present:

| harness | how it loads |
|---|---|
| Claude | `.claude/hooks/skill-preflight.js` names it on every UserPromptSubmit; pinned by `tools/openclinxr/openclaw/the-skill-preflight-routes-board-turns.test.ts` |
| Grok | `.grok/config.toml` `[skills] paths = [".agents/skills"]` — the real file lives there |
| Codex / Cursor | `AGENTS.md` and the `.cursor/rules/` symlink to this file |

## Why this file exists and not only CLAUDE.md

Measured 2026-09-10: `git grep -i mannered` returned two hits, both in `CLAUDE.md`, which only the
Claude harness loads. The skill it points at existed only under `.claude/skills/`, so the Grok
harness could not load it at all. A directive that binds one of four harnesses is not a project
policy. This file is in the Grok core tier (`scripts/sync-harness-agent-files.sh` `CORE_RULES`) and
symlinked into `.claude/rules/` and `.cursor/rules/`.

After editing this file: `./scripts/sync-harness-agent-files.sh && pnpm agent:alignment && pnpm docs:drift-check`.
