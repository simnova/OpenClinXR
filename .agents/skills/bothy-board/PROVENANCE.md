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
`gh-body-file` precedent. `.grok` resolves it through `[skills] paths` in
`.grok/config.toml`, which is set to `.agents/skills`.
