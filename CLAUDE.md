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

## Why it lives here and not in the shared tier

Operator direction, 2026-09-10: *"this fix is necessary for claude only - so we can have baseline
agentic config that applies to all, then layer on top of that harness specific needs such as that
line."*

It was briefly promoted to a shared-tier rule (MANDATE_PROSE, added in 7729a9f4 and deleted in
d4a7a8c2) and the Grok core tier on the reasoning
that a directive binding one of four harnesses is not a project policy. That reasoning was wrong
about the architecture: the shared tier is the BASELINE, and a harness layers its own needs on top.
Grok already has its own voice contract (`.grok/personas/terse-bluf.toml` mirroring
`WORKER_TONE_DIRECTIVE`), so promoting this one imposed a second, conflicting one on it. Do not
promote it again. The layering contract is stated in `agents/rules/README.md`.

## This file is not a source of truth

The operating contract is `AGENTS.md`. Detailed rules are `agents/rules/**`, and they are
shared with the other harnesses. This file holds only what is specific to how I write and
is deliberately short: the repo has already frozen one instruction file for reaching 4,456
lines, and the lesson recorded there is that a rule nobody greps and no test enforces is
dead weight.
