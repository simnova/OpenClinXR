# @cellix/config-typescript Changelog

## 1.0.3-openclinxr.3 - 2026-09-02

- Refreshed from CellixJS `adf3bc9deb` (2026-08-27, `CellixJs/cellixjs` main): `${configDir}` test excludes, `lib: ES2023`, NodeNext `nodenext` resolution, standalone vitest tsconfig.
- Still omitted from upstream: `ts-scope-trimmer-plugin` (not installed here); `allowImportingTsExtensions` / `rewriteRelativeImportExtensions` / `verbatimModuleSyntax` / `erasableSyntaxOnly` (this workspace emits `.js` specifiers); `noUnusedLocals` / `noUnusedParameters` / `skipLibCheck: false` (would fail the current tree).
- `tsconfig.node.json` still sets `noEmit: false` for composite emit (`TS6310`).

## 1.0.3-openclinxr.2 - 2026-08-31

- `tsconfig.node.json` sets `noEmit: false` so composite project references can emit (`TS6310`). Typecheck scripts still pass `--noEmit`. Source-first packages keep `noEmit: true` locally.

## 1.0.3-openclinxr.1 - 2026-08-31

- Workspace `apps/` and `packages/` tsconfigs now `extends` this package the same way CellixJS does (`@cellix/config-typescript/node` | `base` | `vitest`), instead of the repo-root stub. Root `tsconfig.json` is a solution file (`files: []` + project references) matching Cellix's "apps compose packages" graph; the two-file tools typecheck lives in `tsconfig.root-tools.json`.

## 1.0.3-openclinxr.0 - 2026-05-03

- Copied the CellixJS `@cellix/config-typescript` package shape into `packages/cellix/config-typescript`.
- Updated the config contents for OpenClinXR's latest-package posture with TypeScript 6-compatible local settings.
- Removed Cellix repo-specific `ts-scope-trimmer-plugin` usage because it is not installed in this workspace and is not required for the package's core purpose of sharing TypeScript config.
- Preserved the original intent: reusable base, Node, and Vitest TypeScript configs for Cellix-style TypeScript packages.
