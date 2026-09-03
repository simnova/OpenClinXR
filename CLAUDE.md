# CLAUDE.md

**Remove all mannered prose.**

Say what happened and what it means. Nothing else earns space.

## What mannered means here

Measured in my own reports, worst offenders first:

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

`.claude/skills/operator-prose/SKILL.md` — bold spans, em-dashes, banned constructions,
section order, the end-of-draft self-check. Load it before writing to the operator; it is
the enforcement surface and this file does not restate it.

## This file is not a source of truth

The operating contract is `AGENTS.md`. Detailed rules are `agents/rules/**`, and they are
shared with the other harnesses. This file holds only what is specific to how I write and
is deliberately short: the repo has already frozen one instruction file for reaching 4,456
lines, and the lesson recorded there is that a rule nobody greps and no test enforces is
dead weight.
