# @cellix/config-typescript Changelog

## 1.0.3-openclinxr.0 - 2026-05-03

- Copied the CellixJS `@cellix/config-typescript` package shape into `packages/cellix/config-typescript`.
- Updated the config contents for OpenClinXR's latest-package posture with TypeScript 6-compatible local settings.
- Removed Cellix repo-specific `ts-scope-trimmer-plugin` usage because it is not installed in this workspace and is not required for the package's core purpose of sharing TypeScript config.
- Preserved the original intent: reusable base, Node, and Vitest TypeScript configs for Cellix-style TypeScript packages.
