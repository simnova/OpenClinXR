# Provenance — bothy-board skill

Vendored from the BothyBoard instance. The protocol body remains upstream-derived;
the one local amendment below is a conditional Codex Desktop link. Keep the
addendum content synchronized with the personal Bothy copy; the link spelling
differs so the repo symlinked Claude view and the personal Codex view both resolve.

| field | value |
|---|---|
| source | https://bothyboard.com/skills/bothy-board/SKILL.md |
| fetched | 2026-08-29 |
| upstream bytes | 4087 |
| upstream sha256 | 0110fce77056ce4f4748931e4fc3cd3de4a7296e7917d0c13a97e354fed876a3 |
| local bytes | 4209 |
| local sha256 | 01af8ba7bb786b9d7e1afc33794b9a5e43abec37ec2e5062cfbc9ebd3f08cde3 |
| local amendment | conditional link to `CODEX-HARNESS.md` |
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
