# CLAUDE.md

**Remove all mannered prose.**

Say what happened and what it means. Nothing else earns space.

## The rule is shared, not mine

The table of mannered patterns and their replacements now lives in
`agents/rules/MANDATE_PROSE.md`, which every harness loads — it is in the Grok core tier
(`scripts/sync-harness-agent-files.sh` `CORE_RULES`), symlinked into `.claude/rules/` and
`.cursor/rules/`, and stated in the `AGENTS.md` BLUF. It was moved there on 2026-09-10
after `git grep -i mannered` returned two hits, both in this file, which only Claude reads.
A directive binding one of four harnesses is not a project policy.

The headline stays here because this file is loaded on every Claude turn and the rule is
the first thing that should be true of a response.

## Where the countable limits live

`.agents/skills/operator-prose/SKILL.md`, symlinked as `.claude/skills/operator-prose/SKILL.md`
— bold spans, em-dashes, banned constructions, section order, the end-of-draft self-check.
Load it before writing to the operator; it is the enforcement surface and neither this file
nor `MANDATE_PROSE.md` restates it. `.claude/hooks/skill-preflight.js` names it on every
UserPromptSubmit, because automatic selection from `description` did not fire for it across
a whole 713-message session.

## This file is not a source of truth

The operating contract is `AGENTS.md`. Detailed rules are `agents/rules/**`, and they are
shared with the other harnesses. This file holds only what is specific to how I write and
is deliberately short: the repo has already frozen one instruction file for reaching 4,456
lines, and the lesson recorded there is that a rule nobody greps and no test enforces is
dead weight.
