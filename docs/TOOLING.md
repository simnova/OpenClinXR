# Toolchain: mise, PATH, and agent shells

OpenClinXR uses [mise](https://mise.jdx.dev) the same way as atlantis-cameras-v2: **project pins win**, secrets stay out of `.envrc`, and agents must run from an activated environment.

## Pins (source of truth)

| Tool | Pin (`mise.toml`) | package.json |
|------|-------------------|--------------|
| Node | major **24** (Active LTS) | `engines.node`: `>=24.15.0` |
| pnpm | **11.18.0** (current 11.x) | `packageManager`: `pnpm@11.18.0` |
| Python | **3.13** via **mise** (not system/Framework) | Anny/asset/voice `python3` scripts |
| Bun | **1.3.13** | optional local experiments |

Legacy `.nvmrc` / `.node-version` are kept in sync with Node **24** for tools that still read them. Prefer `mise` over `nvm use`.

Do **not** run `corepack enable` for this repo — mise owns the pnpm pin; corepack rewires node/pnpm and fights `mise.toml`.

## Modes

| Mode | What you get | What you **don’t** get |
|------|----------------|-------------------------|
| **Shim-only** (`~/.local/share/mise/shims` on PATH) | `node`, `pnpm`, `python3`, `bun` shims | `[env]._.path` (root `node_modules/.bin`), `_.file` env loading |
| **Activated** (`eval "$(mise activate zsh)"` / `mise env` / **direnv**) | Tools **plus** root `node_modules/.bin` on PATH, and `.env` / `.env.local` loaded | Package-local bins still not global |

## Host shell setup (once per machine)

Recommended stack (matches this workstation after 2026-08-01):

| Layer | Where | Role |
|-------|--------|------|
| **mise shims** | `~/.zshenv` → `$HOME/.local/share/mise/shims` first on PATH | Always resolve `node`/`pnpm`/`python3`/`bun` (agents + bare shells) |
| **direnv hook** | `~/.zshrc` → `eval "$(direnv hook zsh)"` | On `cd` into a trusted repo, run `use mise` |
| **project `.envrc`** | gitignored; from `.envrc.example` | `use mise` only — tools + `node_modules/.bin` + `.env.local` |
| **Do not** | `eval "$(mise activate zsh)"` **and** direnv `use mise` | Double-applies; pick direnv+shims (this repo) |

```bash
# once per machine
mkdir -p ~/.config/direnv/lib
mise direnv activate > ~/.config/direnv/lib/use_mise.sh
# ~/.zshenv should contain:
#   export PATH="$HOME/.local/share/mise/shims:$PATH"
# ~/.zshrc should contain:
#   eval "$(direnv hook zsh)"
# (and re-assert shims after other PATH prepends — see host ~/.zshrc comments)

# once per clone
mise trust
mise install
cp .envrc.example .envrc          # if missing
cp .env.local.example .env.local  # fill keys
direnv allow
mise run doctor
pnpm install
```

`.envrc` should be `use mise` only — never API keys.

Open a **new** terminal tab after changing `~/.zshenv` / `~/.zshrc`, or run `exec zsh -l`.

## Symptoms

1. `node: command not found` / `env: node: No such file or directory`  
   → mise not activated and shims not on PATH.
2. Node **v22.x** while engines require **≥24.15**  
   → cwd is not resolving project `mise.toml`, or only global `~/.config/mise` is applied. `cd` into repo and `mise current`.
3. `pnpm -v` is not **11.18.x** while pin is **11.18.0**  
   → stale `packageManager` field or corepack intercept; fix package.json + `mise install` + reshim.
4. Root `tsx` / `turbo` missing after install  
   → not activated; root `node_modules/.bin` not on PATH. `eval "$(mise env -s zsh)"`.
5. Grok / agent desktops  
   → direnv runs only in interactive shells that `cd` into the repo. Launch the agent from a terminal already inside the repo after direnv/mise has loaded, or export keys in the parent environment.

## Language servers (Grok LSP)

Configured in **`.grok/lsp.json`** (keep root **`.lsp.json` identical**).

| Server | Binary (repo-local) | Role |
|--------|---------------------|------|
| **typescript** | `./node_modules/.bin/typescript-language-server` | Sole owner of `.ts`/`.tsx`/`.js` — hover, definition, symbols (timeout 90s) |
| **python** | `./node_modules/.bin/pyright-langserver` | Anny/asset/voice Python (`pyrightconfig.json`) |

**Do not** register **knip-language-server** on the same extensions as typescript in Grok. The agent `lsp` tool **single-routes** by file extension; knip only implements diagnostics/code actions, so shared `.ts` maps yield `-32601 Unhandled method` on hover/definition. Unused-export hygiene stays **CLI**: `pnpm hygiene:knip` / `pnpm knip`. `@knip/language-server` may remain installed for editors that multiplex multiple servers.

Monorepo note: package sources use per-package `tsconfig.json` (see `tsconfig.ide.json` solution for IDE). Root `tsconfig.json` only includes a few guardrail files — file-scoped `lsp` ops (hover/definition) load the nearest package project after open; bare `workspaceSymbol` before any open can report “No Project”.

Pins: `typescript-language-server`, `pyright` in root `devDependencies` (required). `@knip/language-server` optional.

```bash
pnpm hygiene:lsp          # structural + extension-collision + live tsls hover smoke
pnpm hygiene:knip         # CLI knip gate (CI-style report; not Grok LSP)
pnpm env:doctor           # includes LSP bin checks
```

After changing `.grok/lsp.json`, **restart Grok** so servers reload. Prefer **repo-local** bins over PATH globals. Enable agent tool: `[features] lsp_tools = true` (project + user).

## Package / turbo scripts (agent vs human)

OpenClinXR keeps **boundaries**, package tags, and `--affected` scripts. From ATL we adopt **quiet turbo logs for agents only** — not multi-app `portless` orchestration.

| Script | Audience | Notes |
|--------|----------|--------|
| `packages:typecheck` / `test` / `lint` / `build` | Human / CI full logs | Existing filters `@openclinxr/*` + `@cellix/*` |
| `packages:*:affected` | Incremental | Unchanged |
| `packages:typecheck:agent` (and test/lint/build `:agent`) | **Agents** | `--ui=stream --output-logs=errors-only` — less token noise |
| `verify:packages` | Packages graph gate | typecheck + test + lint + **boundaries** |
| `verify:packages:agent` | Agents | Quiet variants + boundaries |
| Root `verify` / `agent:verify` | Release / evidence matrix | **Do not** replace with packages-only |

**Portless (do not confuse with ATL):**

| | OpenClinXR | Atlantis ICD |
|--|------------|--------------|
| Meaning | Per-app Vite `dev:portless` = `vite --port ${PORT:-…} --strictPort` | Multi-app `portless` CLI + free-port / named `*.localhost` launcher |
| In turbo | `dev` is `cache: false`; evidence scripts pass `PORT` | Large `globalPassThroughEnv` for ICD/VITE ports |
| Policy | Optional host Portless trust; **not** a mandatory monorepo dep | First-class `pnpm run dev` |

Do **not** copy ATL `ICD_*` / go2rtc env into `turbo.json`.

**Engines:** `.npmrc` has `engine-strict=true` — Node `>=24.15.0` and pnpm `>=11.18.0` required. Use mise + `pnpm env:doctor` before install.

**Turbo version:** pinned `2.9.14` (2026-08). Bump to 2.10.x deferred until a measured OCX benefit (boundaries/`--affected` smoke), not parity with ATL alone.

**Shared local turbo cache (worktrees):** root `package.json` turbo scripts set
`TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-$HOME/.cache/openclinxr/turbo}"` so all agent worktrees share one filesystem cache **outside** any worktree. Verified on 2.9.14: absolute `cacheDir` in `turbo.json` is rejected; use `TURBO_CACHE_DIR` or `--cache-dir`. Concurrent writers to one local cache dir are safe (see `docs/_archive/openclinxr/2026-06/turbo-remote-cache-setup.md`). Remote cache (`remoteCache.enabled` + `TURBO_TOKEN`/`TURBO_TEAM`) remains optional for multi-machine/CI.

**Turbo env:** `globalEnv` keeps `CI` + `NODE_ENV` only. Do not import ATL ICD/portless pass-through lists. Revisit task-level `env` only if wrong cache hits involve `OPENCLINXR_BUILD_*` / `VITE_*` in package builds. `TURBO_CACHE_DIR` is a path override (not a hash input) and is set by scripts, not `globalEnv`.

## Environment doctor (consolidated)

**Single deterministic entrypoint** for host/toolchain review (not an LLM agent):

```bash
pnpm env:doctor              # human report + JSON
pnpm env:doctor:json         # stdout JSON only
pnpm env:doctor:strict       # warnings → exit 2
mise run doctor              # alias
```

| Item | Path |
|------|------|
| Implementation | `tools/openclinxr/openclaw/env-doctor.ts` |
| Latest report | `.openclinxr/env-doctor-latest.json` (gitignored under `.openclinxr/`) |
| Wired into | `pnpm openclaw:preflight` (runs first) |

**Exit codes:** `0` ok (or warn without `--strict-warn`), `1` hard fail, `2` warnings only with `--strict-warn`.

Checks: mise pins, node 24 LTS, pnpm 11.18+, **python 3.13 mise-based**, turbo CLI, `node_modules`/lockfile, PATH/direnv, and an **MCP → CLI preference matrix**.

Legacy wrapper: `tooling/scripts/mise-doctor.sh` → `pnpm env:doctor`.

### MCP → CLI (implemented policy)

Prefer **CLIs via the shell tool** over always-on MCP servers. **Enforced in config**, not only documented.

| MCP | Status | Prefer CLI instead | Re-enable MCP only when |
|-----|--------|--------------------|-------------------------|
| **playwright** | **disabled** (project) | `pnpm playwright:codegen` / `playwright:test` / `playwright:help` | Multi-step stateful browser agent loops |
| **chrome-devtools** | **disabled** (project); plugin removed (user) | playwright / `pnpm browser:agent` / evidence scripts | CDP-only profiling |
| **agent-browser** | **disabled** (user MCP); CLI stays | `pnpm browser:agent` / `agent-browser <cmd>` | Host cannot shell |
| **grok_com_github** | **disabled** / not declared | `pnpm gh:status` / `gh pr` / `gh issue` / `gh api` | Never use transport-less stub |
| **mongodb** | optional (user plugin) | `mongosh` + evidence scripts | Active Atlas agent work |
| **drawio** | enabled (user) when needed | — | Architecture diagram sessions |
| **mise** | **do not add** | `pnpm env:doctor` / `mise` | — |

**Config hooks**

- Project `.grok/config.toml`: `[mcp_servers.playwright]` / `chrome-devtools` with `enabled = false`  
- User: `grok mcp disable playwright|chrome-devtools|agent-browser|grok_com_github`; agent-browser MCP `enabled = false`; chrome-devtools-mcp plugin removed from `[plugins].enabled`  
- Verify: `grok inspect` (only drawio + mongodb when optional) / `grok mcp list` (others marked disabled)

**Agent rule:** run `pnpm env:doctor` for toolchain; use package scripts for browsers/GitHub. Do not load MCP schemas when a CLI one-liner works.

`env:doctor` embeds this matrix in JSON (`mcpCliMatrix`).

## Secrets

- **Gitignored:** `.envrc`, `.env.local`, `.env.openclinxr.local`
- **Committed examples:** `.envrc.example`, `.env.local.example`
- Load path: mise `[env]._.file = [".env", ".env.local"]` when activated
