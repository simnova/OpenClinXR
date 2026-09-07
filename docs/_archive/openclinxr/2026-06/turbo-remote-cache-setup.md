# Turbo Cache Setup (Shared Local + Optional Remote)

**Status (2026-08-05):** living **current-reference** how-to. Per-worktree cold rebuilds are a major parallel-agent tax; shared local filesystem cache is the default mitigation. Remote cache remains optional for multi-machine / CI.

OpenClinXR pins Turborepo **2.9.14**. Root `turbo.json` sets `"remoteCache": { "enabled": true }` (still requires credentials). Root `package.json` turbo scripts set a **shared absolute local cache** outside every worktree.

## Shared local filesystem cache (default for all worktrees)

### Why not `cacheDir` in `turbo.json`?

Verified against installed turbo **2.9.14**:

| Mechanism | Honored? | Absolute path outside worktree? |
|-----------|----------|----------------------------------|
| `TURBO_CACHE_DIR` env | **Yes** | **Yes** (required path for `~/.cache/...`) |
| `--cache-dir <path>` CLI | **Yes** | **Yes** |
| `cacheDir` in `turbo.json` | Relative only | **No** — absolute path is a hard parse error: *“If absolute paths are required, use `--cache-dir` or `TURBO_CACHE_DIR`.”* |

Relative `cacheDir` (e.g. `.turbo/cache`) is worktree-local and also **disables** turbo’s built-in “shared worktree cache” redirect to the main worktree. It does **not** solve multi-worktree cold cost when agents need one machine-wide path.

### Default path

Root scripts default:

```bash
TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-$HOME/.cache/openclinxr/turbo}"
```

- Lives under `~/.cache/` (outside any git worktree).
- Override anytime: `export TURBO_CACHE_DIR=/path/to/shared`.
- Turbo creates the directory on first write.

Scripts wired: `packages:typecheck|test|build|lint` (+ `:agent` / `:affected`), `architecture`, `boundaries`, `boundaries:check`, `turbo:remote:status`.

Raw `pnpm exec turbo …` / global `turbo` does **not** inherit this unless you export `TURBO_CACHE_DIR` in the shell (or pass `--cache-dir`).

### Built-in worktree sharing vs this default

With no override, turbo 2.9.14 prints `using shared worktree cache` and redirects to the **main worktree** `.turbo/cache`. That helps linked worktrees but:

1. Depends on the main worktree existing and being writable.
2. Does not apply to separate clones.
3. Is replaced when `TURBO_CACHE_DIR` / `--cache-dir` is set (by design).

OpenClinXR prefers the absolute `~/.cache/openclinxr/turbo` path so every agent worktree resolves the same directory.

### Concurrency safety (verified 2026-08-05)

Turbo **2.9.14** local FS cache is safe for concurrent writers to one directory on this machine:

- 2 parallel `turbo run typecheck --only --force` on the **same** package → exit 0 both; artifact `zstd -t` clean; subsequent run `FULL TURBO` hit.
- 4 parallel typechecks on **different** packages into one `TURBO_CACHE_DIR` → 4× exit 0; all `.tar.zst` valid; all hashes restore as cache hits.

Do **not** point `TURBO_CACHE_DIR` at a network filesystem without a separate proof. Local APFS/SSD only for the default path.

### Measured cold vs warm (typecheck graph)

Same machine, turbo 2.9.14, `turbo run typecheck --filter '@openclinxr/*' --filter '@cellix/*'` (67 tasks), empty vs populated `TURBO_CACHE_DIR`:

| Scenario | Cached | Wall time |
|----------|--------|-----------|
| Cold (`--force` into empty shared dir) | 0 / 67 | **~15.6 s** (real ~15.7 s) |
| Warm (same `TURBO_CACHE_DIR`, no force) | 67 / 67 | **~275 ms** FULL TURBO |
| “New worktree” sim (wipe local `.turbo/runs`, keep shared dir) | 67 / 67 | **~249 ms** FULL TURBO |

First populate after switching to the shared path is a one-time cold; later worktrees hit the shared dir.

## Option A: Vercel Remote Cache (multi-machine / CI)

1. Install Turbo globally or use the repo devDependency: `pnpm exec turbo`.
2. Log in: `pnpm exec turbo login`
3. Link the repo: `pnpm exec turbo link`
4. Confirm status: `pnpm turbo:remote:status` (runs `turbo info`)

### CI environment variables (GitHub Actions)

```yaml
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ vars.TURBO_TEAM }} # or secrets.TURBO_TEAM
  # Optional: align CI local FS cache if the runner has a durable disk
  # TURBO_CACHE_DIR: ${{ runner.temp }}/openclinxr-turbo
```

Create `TURBO_TOKEN` from the Vercel Turborepo token page for the linked team. `TURBO_TEAM` is the team slug (or use `teamId` in `turbo.json` when self-hosting via Vercel API).

### GitHub Actions snippet

```yaml
- name: Install
  run: pnpm install --frozen-lockfile

- name: Build (remote cache)
  run: pnpm packages:build:affected
  env:
    TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
    TURBO_TEAM: ${{ vars.TURBO_TEAM }}
```

Use the same env block for `packages:typecheck:affected`, `packages:test:affected`, and `packages:lint:affected`.

## Option B: Self-hosted remote cache

Point Turbo at a compatible remote cache API:

```jsonc
// turbo.json (root) — optional overrides
{
  "remoteCache": {
    "enabled": true,
    "apiUrl": "https://your-cache.example.com",
    "loginUrl": "https://your-cache.example.com"
  }
}
```

Set `TURBO_TOKEN` (and `TURBO_TEAM` if required) in CI and developer shells. See your cache provider docs for token format.

## Local developer workflow

```bash
# Shared local cache is automatic via pnpm scripts (see above).
pnpm packages:typecheck:agent

# Optional multi-machine remote:
pnpm exec turbo login
pnpm exec turbo link
pnpm turbo:remote:status
pnpm packages:build:affected
```

To disable remote cache for one run: `TURBO_TOKEN= pnpm packages:build` or set `"remoteCache": { "enabled": false }` temporarily.

To use a different shared local path: `TURBO_CACHE_DIR=/tmp/my-turbo pnpm packages:build`.

## Boundaries (advisory)

Tag-based import rules are configured in root `turbo.json`. Check violations without fixing product imports yet:

```bash
pnpm boundaries
```

Known baseline: cross-package relative imports (e.g. `data-mongodb` → `asset-registry` source paths) may report as boundary violations until refactored to workspace package imports. Tag rules (`production`/`internal` must not depend on `arena`) are enforced separately.
