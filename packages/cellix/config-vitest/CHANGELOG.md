# @cellix/config-vitest Changelog

## 1.0.0-openclinxr.2 - 2026-09-02

- Refreshed from CellixJS `adf3bc9deb`: ArchUnit paths excluded from default typecheck-during-test and coverage, matching upstream `node.config.ts` / `base.config.ts`.
- Still local: worktree exclude list (Vitest ignores `.gitignore`); `typecheck.enabled: false` (packages typecheck via `tsgo`); coverage provider `v8` (this workspace does not install istanbul); Storybook stays an optional factory.

## 1.0.0-openclinxr.1 - 2026-08-31

- Ported CellixJS `archConfig` and the per-package `mergeConfig(nodeConfig, …)` consumer pattern.
- Shared `worktreeExcludePatterns` (`src/worktree-excludes.ts`) is consumed by both `nodeConfig` and `archConfig`.
- `nodeConfig` excludes those worktrees and `src/archunit-tests/**`. Vitest does not read `.gitignore`.
- Typecheck-during-test stays opt-in (`typecheck.enabled: false`); packages still typecheck with `tsgo -p tsconfig.vitest.json`.

## 1.0.0-openclinxr.0 - 2026-05-03

- Copied the CellixJS `@cellix/config-vitest` package intent into `packages/cellix/config-vitest`.
- Preserved Cellix's `tsgo` typechecking posture using `@typescript/native-preview` while updating the package for this workspace's TypeScript 6 setup.
- Kept Node/unit Vitest config lightweight by default and moved Storybook browser testing behind an async opt-in factory with deliberately non-installed optional packages.
- Preserved the original intent: reusable Vitest base, Node, Storybook-browser, and path utility config helpers for Cellix-style TypeScript packages.
