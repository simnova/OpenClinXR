# 0063 — mise loads local secrets for the main checkout and every lane worktree

- Status: **accepted**
- Date: 2026-11-09
- Deciders: operator (direction, 2026-11-09)
- Known-good inputs: `mise.toml` `[env] _.file = [".env", ".env.local"]`; `.env.local.example`; mise 2026.10.8

## Context

Agents need local secrets in their shell, starting with `BOTHY_BOARD_PAT` for the BothyBoard MCP endpoint (`.mcp.json` sends `Bearer ${BOTHY_BOARD_PAT}`) and for `tools/openclinxr/openclaw/board-bothy-dequeue.ts`. The tracked `mise.toml` already loads `.env` and `.env.local` from the folder that holds it, in the direnv style: the variables appear when a shell enters the checkout and leave when it exits. Neither file existed on the operator machine, so the PAT was first placed in the global mise config, which exports it to every directory.

Worktrees live in two places:

- Claude worktrees: `<repo>/.claude/worktrees/<name>` (the desktop app's "Inside the project" setting).
- Grok worktrees: `~/.grok/worktrees/src-openclinxr/<lane>`. `grok -w` and `grok worktree create` have no location option, and the repo dispatcher root (`managedWorktreeRoot`, `OPENCLINXR_WT_ROOT`) uses the same folder. Grok keeps working this way.

A worktree's own `mise.toml` loads the worktree's own `.env.local`, which is gitignored and so never present in a fresh worktree. Passing the variable down from a parent process does not survive either: measured 2026-11-09, a shell started in the main checkout had the PAT, and an interactive zsh started from it in a Grok lane folder did not, because `mise activate` in `~/.zshrc` drops variables it set for a directory whose config does not set them.

## Decision

1. **One secrets file:** `/Volumes/files/src/OpenClinXR/.env.local` (gitignored, mode 600). Keys follow `.env.local.example`. No secret goes into any `*.toml`, `.envrc`, the global mise config, `~/.grok/config.toml`, or a launchd environment.
2. **Claude worktrees** under `<repo>/.claude/worktrees/` need nothing more: mise reads config in parent directories, so the main checkout's `mise.toml` loads its `.env.local` there.
3. **Grok worktrees** read it through one untracked file, `~/.grok/worktrees/src-openclinxr/mise.local.toml`, trusted once with `mise trust`:

   ```toml
   [env]
   _.file = "/Volumes/files/src/OpenClinXR/.env.local"
   ```

   Every lane under that folder inherits it by the same parent-directory walk. The file holds a path, not a secret.
4. **Grok's `[session] load_envrc`** (Grok docs, configuration) is not used for this. `.envrc` is gitignored, so `grok -w` worktrees do not get one, and the docs do not say whether `load_envrc` runs `use mise` or reads only `export` lines. `[shell_environment_policy] set` is not used either: it writes the value into `~/.grok/config.toml` in plain text.

## Verification (2026-11-09)

| directory | `BOTHY_BOARD_PAT` from `mise env` / interactive zsh |
|---|---|
| main checkout | set / set |
| `<repo>/.claude/worktrees/mise-env-madr` | set / not run |
| `~/.grok/worktrees/src-openclinxr/hair-groom-2` | set / set |
| `~` | unset / unset |

`board-bothy-dequeue.ts` `selectNextBothyCard` returned `ok: true` from the main checkout. A live `grok -p` run in a lane was not tested: Grok was not signed in on that shell.

## Consequences

- A new machine needs three steps: copy `.env.local.example` to `.env.local` and fill it, `mise trust` the checkout, then create and trust the Grok parent file above.
- Apps that do not start from a mise-activated shell (the desktop app launched from the Dock) do not see these variables. Their MCP `${VAR}` expansion fails until they are started from a shell inside the checkout.
- If the Grok worktree root moves (`OPENCLINXR_WT_ROOT`), the parent file moves with it.
