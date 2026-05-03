# Cellix Shared Packages

This folder is reserved for shared Cellix-compatible packages copied from `CellixJs/cellixjs` and used as external library code.

Dependency upgrades, the code changes required by those upgrades, bug fixes, and narrow build/runtime compatibility fixes are allowed here when they preserve the package's core Cellix purpose. Each copied package must keep a root `CHANGELOG.md` noting local changes and why they remain within original intent. If OpenClinXR needs project-specific behavior, copy the relevant package into `packages/openclinxr/`, make changes there, and remove the local copy from `packages/cellix/`.
