# @cellix/config-vitest Changelog

## 1.0.0-openclinxr.0 - 2026-05-03

- Copied the CellixJS `@cellix/config-vitest` package intent into `packages/cellix/config-vitest`.
- Preserved Cellix's `tsgo` typechecking posture using `@typescript/native-preview` while updating the package for this workspace's TypeScript 6 setup.
- Kept Node/unit Vitest config lightweight by default and moved Storybook browser testing behind an async opt-in factory with deliberately non-installed optional packages.
- Preserved the original intent: reusable Vitest base, Node, Storybook-browser, and path utility config helpers for Cellix-style TypeScript packages.
