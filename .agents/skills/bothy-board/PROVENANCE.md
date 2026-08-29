# Provenance — bothy-board skill

Vendored VERBATIM from the BothyBoard instance. Do not hand-edit `SKILL.md`;
re-fetch instead, so a diff against upstream stays meaningful.

| field | value |
|---|---|
| source | https://bothyboard.com/skills/bothy-board/SKILL.md |
| fetched | 2026-08-29 |
| bytes | 4087 |
| sha256 | 0110fce77056ce4f4748931e4fc3cd3de4a7296e7917d0c13a97e354fed876a3 |
| tool index | https://bothyboard.com/llms.txt |
| unauth tool list | GET https://bothyboard.com/api/mcp |

Refresh and verify drift:

```sh
curl -fsSL https://bothyboard.com/skills/bothy-board/SKILL.md -o /tmp/bothy-SKILL.md
diff /tmp/bothy-SKILL.md .agents/skills/bothy-board/SKILL.md
```

`.claude/skills/bothy-board/SKILL.md` is a symlink to this copy, matching the
`gh-body-file` precedent.

## Repo-local addendum

`OPENCLINXR-PROJECT-BINDING.md` sits beside this file and carries what is specific to this
repo — chiefly that `bothy-board.sync` with no `projectId` silently returns Harbor, not
OpenClinXR. It is NOT vendored and may be edited freely. Keep repo-specific guidance there so
`SKILL.md` stays diffable against upstream. `.grok` resolves it through `[skills] paths` in
`.grok/config.toml`, which is set to `.agents/skills`.
