# Worktree promote (isolation close-loop)

**Owner:** implementer / chief-coordinator (parent)  
**Policy tier:** standard_execution · **BOD status:** APPROVED Wave C-worktree 2026-08-02  
**CLI SSOT:** `tools/openclinxr/openclaw/worktree-promote.ts`  
**Path-scope SSOT:** `docs/agent-ops/PATH-SCOPE.md` + `role-harness-policy.ts` → `pathScope.writeRoots`

## Why

Writers spawn with `isolation=worktree` so product edits stay off main until reviewed. Without a promote step, handoff + code land only in `~/.grok/worktrees/...` and never reach the main workspace verify/post-slice path.

## Parent flow

1. **team-spawn** with isolation recommendation:  
   `pnpm openclaw:team-spawn -- --slice-id <id> --phase execute`  
   Writers should show `isolation=worktree` (top-level + nested). Parent **must pass** `isolation=worktree` into harness `spawn_subagent` (Wave A).
2. **Child works in worktree** — edits under role `writeRoots` + handoff JSON only.
3. **Promote into main** (parent / integrator on main workspace):  
   ```bash
   pnpm openclaw:worktree:list
   pnpm openclaw:worktree:status  -- --slice-id <id> --role <roleId>
   pnpm openclaw:worktree:promote -- --slice-id <id> --role <roleId> [--worktree-path <path>] [--dry-run]
   ```
4. **Verify / post-slice on main** — `pnpm openclaw:slice:verify`, checkpoint, `pnpm openclaw:post-slice`.

## Commands

| Script | Action |
|---|---|
| `pnpm openclaw:worktree:list` | List dirs under `~/.grok/worktrees` matching openclinxr / repo basename (path + mtime) |
| `pnpm openclaw:worktree:status -- --slice-id <id> --role <roleId>` | Resolve worktree; `git status --short`; list changed files |
| `pnpm openclaw:worktree:promote -- --slice-id <id> --role <roleId> [--worktree-path] [--dry-run]` | Copy allowed changed files into main; write promote report |

### Discovery order (worktree path)

1. `--worktree-path`
2. env `OPENCLINXR_WORKTREE`
3. Newest `~/.grok/worktrees/*openclinxr*` / `src-openclinxr/subagent-*` that contains  
   `.openclinxr/slices/<slice-id>/handoffs/<role>.json`
4. Else newest matching worktree (status/promote may still run; prefer handoff match)

### Promote allowlist

For each changed path in the worktree (`git status --short`):

- **Allow** if `pathMatchesAnyGlob(path, writeRoots)` from `getRepoRoleHarnessPolicy(roleId).pathScope`
- **Allow** if path is `.openclinxr/slices/**/handoffs/<role>.json`
- **Refuse** otherwise — listed in report `skipped[]` with clear reason

Deletes are not copied (listed skipped). No force-delete of worktrees without a future `--force` cleanup flag.

### Report + exit codes

Report path: `.openclinxr/openclaw/worktree-promote-<slice>-<role>.json`

| Field | Meaning |
|---|---|
| `promoted[]` | Paths copied (or would-copy on `--dry-run`) |
| `skipped[]` | Path-scope refused, deletes, etc. |
| `errors[]` | Hard failures (missing source, copy errors) |

| Exit | When |
|---|---|
| **0** | Intended promotions ok (or nothing to promote) |
| **2** | One or more path-scope skips while changed files were attempted |
| **1** | Hard errors (unknown role, missing worktree, git/copy failure) |

## Standing rules

- Parent still **must pass** `isolation=worktree` — promote does not replace spawn discipline.
- Promote is **not** a substitute for Option 2 handoff path-scope audit (`verifySliceBrief`).
- Do not promote outside writeRoots; residual → parent / other role.
- Do not auto-delete worktrees after promote (optional cleanup later, requires `--force`).

## Related

- `docs/agent-ops/PATH-SCOPE.md` — writeRoots + isolation enforcement matrix
- `packages/openclinxr/agent-loop/src/role-harness-policy.ts` — `pathScope`, `pathMatchesAnyGlob`
- `tools/openclinxr/openclaw/slice-team-cli.ts` — team-spawn isolation assert
- `agents/rules/orchestrator-only-main.md` — parent isolation pass-through
