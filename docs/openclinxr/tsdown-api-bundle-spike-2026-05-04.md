# tsdown API Bundle Spike

Date: 2026-05-04

## Goal

Evaluate whether `tsdown` can reduce the Azure Functions-compatible API deploy artifact without changing runtime behavior.

## Commands Run

```bash
pnpm view tsdown version license description --json
pnpm --filter @openclinxr/api smoke:azure
pnpm dlx tsdown@0.21.10 src/index.ts --platform node --format esm --target node20 --minify --sourcemap --out-dir /tmp/openclinxr-tsdown-api-spike --clean --deps.never-bundle @azure/functions-core
pnpm dlx --allow-build=@rolldown/binding-darwin-arm64 --package tsdown@0.21.10 --package @rolldown/binding-darwin-arm64@1.0.0-rc.17 tsdown --version
node /tmp/openclinxr-tsdown-tool/node_modules/tsdown/dist/run.mjs --config /tmp/openclinxr-tsdown-api.config.mjs
pnpm --filter @openclinxr/api smoke:azure
```

## Findings

- `tsdown` 0.21.10 is MIT licensed and documented as a Rolldown-powered library bundler with tree shaking, minification, sourcemaps, platform targets, workspace mode, and dependency controls.
- `pnpm dlx tsdown@0.21.10` failed locally before building because the transient Rolldown rc.17 native Darwin ARM64 binding was not visible.
- Adding the binding package to the `dlx` environment moved past the native-binding issue but exposed a Node 21.7.1 `util.styleText` compatibility failure in that transient path.
- Package-managed execution under the repo's Node 22.19.0 worked.
- The default `tsdown` output was only 10.78 kB because dependencies are external by default; that output is not Azure deploy-equivalent.
- With explicit dependency bundling for `@openclinxr/*`, `hono`, and `graphql`, `tsdown` produced `deploy/dist/index.js` at 538.86 kB plus a 1.97 MB sourcemap.
- The prior Rolldown deploy bundle was 1,355.35 kB plus a 2,317.32 kB sourcemap.
- `pnpm --filter @openclinxr/api smoke:azure` passed after switching `build:azure` to the `tsdown` config.

## Decision

Use package-managed `tsdown` for the API Azure deploy build path and keep the prior Rolldown config available as `build:azure:rolldown` for fallback/comparison. Keep `deps.onlyBundle` explicit so new bundled third-party dependencies require deliberate config changes.
