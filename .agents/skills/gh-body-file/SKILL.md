---
name: gh-body-file
description: Never pass issue/PR/comment text to gh via --body "...". Backticks in the string are shell command substitution and silently mangle the published body. Always --body-file from a quoted heredoc, then verify.
when-to-use: gh issue create, gh issue comment, gh issue edit, gh pr create, gh pr comment, gh api body, markdown with backticks, code fences in an issue, command not found from a gh call
---

# Publish gh bodies from a file, never from an inline string

## Problem

`gh issue create --body "…"` and `gh issue comment --body "…"` take a **double-quoted shell string**. Backticks inside it are **command substitution**. The shell executes the backticked text, substitutes the (empty) output, and `gh` publishes the mangled result. Exit code is `0`. The issue URL is returned. Nothing looks wrong.

Markdown bodies are full of backticks — inline code, file paths, identifiers, fenced blocks. So this fires on almost any well-written issue.

**Observed twice in one session, same repo, ~1 hour apart:**

```
(eval):2: command not found: toigo_flats
(eval):2: command not found: crudegown.mhclo
(eval):2: command not found: actor-casting.ts
```

Each time the issue published with **empty table cells** where the code spans had been. The second incident happened *after* the lesson was written into a tick report — prose did not bind. This skill exists because remembering was not enough.

## Rule

**Any body containing a backtick — or that might later — goes through a file.**

```bash
cat > /tmp/body.md <<'EOF'
Use `--body-file`, not `--body`.
EOF
gh issue create --repo owner/repo --title "..." --body-file /tmp/body.md
gh issue comment 123 --repo owner/repo --body-file /tmp/body.md
gh issue edit    123 --repo owner/repo --body-file /tmp/body.md
```

The heredoc delimiter **must be quoted** — `<<'EOF'`, not `<<EOF`. An unquoted delimiter re-introduces `$` and backtick expansion inside the heredoc itself.

## Editing a comment that is already mangled

`gh issue comment` has no edit form. Patch it through the API, and read the body from a file with `-F body=@`:

```bash
CID=$(gh api repos/owner/repo/issues/478/comments --jq '.[-1].id')
gh api -X PATCH repos/owner/repo/issues/comments/$CID -F body=@/tmp/body.md
```

`-F body=@file` reads the file; `-f body="…"` would put you back in string-quoting territory.

## Verify — the failure is silent, so check

```bash
gh api repos/owner/repo/issues/comments/$CID --jq '.body' | grep -c 'some`backticked`ref'
```

A count of `0` on something you know you wrote means it was eaten. Do this whenever the body carried code spans and you did not use a file.

## Sibling zsh trap, same genus

Unquoted `$VAR` in a `for` loop **does not word-split in zsh** (unlike bash). This silently iterates once with the whole string:

```bash
LIST="a b c"
for x in $LIST; do ...; done        # zsh: ONE iteration, x="a b c"
LIST=(a b c)
for x in "${LIST[@]}"; do ...; done # correct
```

Observed cost: a scan reported `product=0` for all seven assets because the loop body ran once against the concatenated string. The measurement looked clean and was entirely wrong.

## The general shape

Both bugs share it: **the shell interpreted data as code, exited 0, and produced a plausible-looking wrong result.** When a command that writes text somewhere reports success, verify the text arrived — do not infer it from the exit code.
