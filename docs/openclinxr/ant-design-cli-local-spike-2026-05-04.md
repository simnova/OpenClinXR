# Ant Design CLI Local Spike

Date: 2026-05-04
Status: Advisory tooling evidence

## Commands Run

```bash
pnpm view @ant-design/cli version license description --json
pnpm dlx @ant-design/cli@6.3.7 env apps/ui-admin --format json
pnpm dlx @ant-design/cli@6.3.7 doctor --format json
pnpm dlx @ant-design/cli@6.3.7 info Button --version 6.3.7 --format json
pnpm dlx @ant-design/cli@6.3.7 lint src --format json
```

`doctor`, `info`, and the app-scoped `env` probe were run locally without cloud or paid API usage. `doctor` and `info` were run from `apps/ui-admin` so the CLI could inspect the app-local Ant Design dependency graph.

## Results

- `@ant-design/cli` package metadata: version `6.3.7`, license `MIT`.
- `env` detected `antd 6.3.7`, `react 19.2.5`, `react-dom 19.2.5`, `vite 8.0.10`, `typescript 6.0.3`, and `pnpm 10.33.0`.
- `doctor` returned 9 pass checks, 1 warning, and 0 failures. The warning was SSR-specific: no `@ant-design/cssinjs` package is installed for SSR style extraction. The admin app is a Vite SPA, so this is not a current blocker.
- `info Button --version 6.3.7 --format json` returned structured Button metadata and props, so component API lookup is useful for future AntD 6 UI work.
- `lint src --format json` failed with `ERR_REQUIRE_ESM` inside the transient `oxc-parser` path used by `@ant-design/cli` under `pnpm dlx`. Do not add AntD CLI lint as a blocking `pnpm verify` gate until this is resolved or reproduced with a package-managed workspace install.

## Guidance

Use Ant Design CLI as an advisory tool for exact-version component APIs, demos, tokens, and environment checks. Keep `doctor` available as a manual preflight after substantial admin UI changes. Defer a blocking `antd lint` gate and any root package script until the `pnpm dlx` lint crash is fixed or a stable workspace-installed invocation is verified.
