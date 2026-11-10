# Provenance — bothy-board skill

Vendored from the BothyBoard instance. The protocol body is upstream verbatim;
the one local amendment is the pair of conditional Grok and Codex harness links,
inserted after the "Tool names" line in § Connect. Keep the addendum content
synchronized with the personal Bothy copy; the link spelling differs so the repo
symlinked Claude view and the personal Codex view both resolve.

| field | value |
|---|---|
| source | https://bothyboard.com/skills/bothy-board/SKILL.md |
| fetched | 2026-11-09 |
| upstream bytes | 8069 |
| upstream sha256 | a48b294203b3c4ca0f89653ed6f97a1cd778f7c360410ccd01b2138a2ce64286 |
| local bytes | 8383 |
| local sha256 | abcff92364aec9b133623aa4b0825ad127ad7ff6215a7d4f6db1c0b0a6fb592c |
| local amendment | conditional links to `GROK-HARNESS.md` and `CODEX-HARNESS.md` |
| upstream additions since 2026-09-03 | § Scope (`projectId`, `{scoped:false}`), § Monitor (MCP Events `events/subscribe`/`events/poll`), mailbox `since`/`excludeGrokSessionId`/`taskIds`, review holds `write_roots` until `proofs.set` |
| moved out | the local "Create-only fields" section (2026-09-10) now lives in `OPENCLINXR-PROJECT-BINDING.md` |
| tool naming | underscore form `bothy-board_tasks_next` since 2026-09-03; dotted aliases still dispatch |
| new upstream tools | `tasks_delete`, `tasks_restore`, `trash_list` (29 tools total) |
| scope gating | the unauth `GET /api/mcp` lists all 29; an authenticated client sees only its PAT's scopes |

## PAT scopes and the tools each covers

From the Connect page, 2026-09-03. Reconciled against the live catalogue: 29 names on both
sides, none missing in either direction. A tool absent from your client is a SCOPE result, not a
stale inventory — `tasks_delete` and friends never appear for a token without `tasks:delete`.

| scope | tools | default worker |
|---|---|---|
| `board:read` | `sync` `tasks_next` `tasks_get` `team_members` `projects_list` `projects_fields_list` | yes |
| `tasks:write` | `tasks_create` `tasks_update` `tasks_claim` `tasks_release` `tasks_treatments_fail` `tasks_decompose` `tasks_comment` | yes |
| `sessions` | `sessions_mint` `sessions_bind` `sessions_resume` | yes |
| `mailbox` | `mailbox_poll` `mailbox_post` | yes |
| `worktrees` | `worktrees_register` | yes |
| `agents` | `agents_heartbeat` | yes |
| `factory:plant` | `tasks_plant` `tasks_import` `projects_create` `projects_fields_set` `projects_fields_applyTemplate` | no |
| `factory:land` | `tasks_proofs_set` | no |
| `tasks:delete` | `tasks_delete` `tasks_restore` `trash_list` | no |

All names carry the `bothy-board_` prefix. 20 of 29 are default-worker reachable; the 9 that are
not are the plant, land and delete groups. An orchestrator PAT that can plant and land is NOT a
default worker token.
| tool index | https://bothyboard.com/llms.txt |
| unauth tool list | GET https://bothyboard.com/api/mcp |

Refresh and verify drift:

```sh
curl -fsSL https://bothyboard.com/skills/bothy-board/SKILL.md -o /tmp/bothy-SKILL.md
diff -u /tmp/bothy-SKILL.md <(sed '/^Grok Build/,/^\[CODEX-HARNESS/d' .agents/skills/bothy-board/SKILL.md | cat -s)
```

`.claude/skills/bothy-board/SKILL.md` is a symlink to this copy, matching the
`gh-body-file` precedent.

## Repo-local addendum

`OPENCLINXR-PROJECT-BINDING.md` sits beside this file and carries what is specific to this
repo: project ids, the 2026-11-09 scoping measurement, card-schema traps, create-only fields,
and payload costs. It is NOT vendored and may be edited freely. Keep repo-specific guidance there so
`SKILL.md` stays diffable against upstream. `.grok` resolves it through `[skills] paths` in
`.grok/config.toml`, which is set to `.agents/skills`.
