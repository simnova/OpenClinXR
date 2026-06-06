# Turbo Remote Cache Setup

OpenClinXR uses Turborepo 2.9 with remote caching **opt-in**. Local filesystem cache (`.turbo/cache`) always works; remote cache shares task outputs across machines and CI when credentials are present.

Root `turbo.json` sets `"remoteCache": { "enabled": true }`. Remote uploads/downloads still require login or `TURBO_TOKEN` / `TURBO_TEAM`.

## Option A: Vercel Remote Cache (recommended)

1. Install Turbo globally or use the repo devDependency: `pnpm exec turbo`.
2. Log in: `pnpm exec turbo login`
3. Link the repo: `pnpm exec turbo link`
4. Confirm status: `pnpm turbo:remote:status` (runs `turbo info`)

### CI environment variables (GitHub Actions)

```yaml
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ vars.TURBO_TEAM }} # or secrets.TURBO_TEAM
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
pnpm exec turbo login
pnpm exec turbo link
pnpm turbo:remote:status
pnpm packages:build:affected
```

To disable remote cache for one run: `TURBO_TOKEN= pnpm packages:build` or set `"remoteCache": { "enabled": false }` temporarily.

## Boundaries (advisory)

Tag-based import rules are configured in root `turbo.json`. Check violations without fixing product imports yet:

```bash
pnpm boundaries
```

Known baseline: cross-package relative imports (e.g. `data-mongodb` → `asset-registry` source paths) may report as boundary violations until refactored to workspace package imports. Tag rules (`production`/`internal` must not depend on `arena`) are enforced separately.