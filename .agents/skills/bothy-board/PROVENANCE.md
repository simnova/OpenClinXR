# Provenance — bothy-board skill

Vendored from the BothyBoard instance. The protocol body remains upstream-derived;
the one local amendment below is a conditional Codex Desktop link. Keep the
addendum content synchronized with the personal Bothy copy; the link spelling
differs so the repo symlinked Claude view and the personal Codex view both resolve.

| field | value |
|---|---|
| source | https://bothyboard.com/skills/bothy-board/SKILL.md |
| fetched | 2026-09-03 |
| upstream bytes | 4196 |
| upstream sha256 | 2541a9925c05708c541d11ab7fe85e4276cf538e0ad443ac577bc777f3918f53 |
| local bytes | 4511 |
| local sha256 | 4c957c9d623e053b0aaaca45952c12d5cafcb6f73e206393ea5938efccabc822 |
| local amendment | conditional links to `GROK-HARNESS.md` and `CODEX-HARNESS.md` |
| tool naming | underscore form `bothy-board_tasks_next` since 2026-09-03; dotted aliases still dispatch |
| new upstream tools | `tasks_delete`, `tasks_restore`, `trash_list` (29 tools total) |
| tool index | https://bothyboard.com/llms.txt |
| unauth tool list | GET https://bothyboard.com/api/mcp |

Refresh and verify drift:

```sh
curl -fsSL https://bothyboard.com/skills/bothy-board/SKILL.md -o /tmp/bothy-SKILL.md
diff -u /tmp/bothy-SKILL.md <(sed '/Codex Desktop/,/^$/d' .agents/skills/bothy-board/SKILL.md)
```

`.claude/skills/bothy-board/SKILL.md` is a symlink to this copy, matching the
`gh-body-file` precedent.

## Repo-local addendum

`OPENCLINXR-PROJECT-BINDING.md` sits beside this file and carries what is specific to this
repo — chiefly that `bothy-board.sync` with no `projectId` silently returns Harbor, not
OpenClinXR. It is NOT vendored and may be edited freely. Keep repo-specific guidance there so
`SKILL.md` stays diffable against upstream. `.grok` resolves it through `[skills] paths` in
`.grok/config.toml`, which is set to `.agents/skills`.
