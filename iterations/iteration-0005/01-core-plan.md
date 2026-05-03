# Core Plan

## Architecture

The first implementation uses a pnpm TypeScript monorepo:

- `apps/api`
- `apps/ui-admin`
- `apps/ui-xr`
- `packages/shared-schemas`
- `packages/domain`
- `packages/scenario-fixtures`
- `packages/scenario-runtime`
- `packages/trace-ledger`
- `packages/review-workflow`
- `packages/data-mongodb`
- `packages/model-gateway`
- `packages/voice-gateway`
- `packages/asset-registry`
- `packages/test-harness`

## Sequencing

Build pure schemas and domain before UI. Use in-memory repositories before MongoDB. Use mock providers before local model and voice runtimes. Use desktop fallback before Quest 3 testing.

## Added Artifact

- `docs/openclinxr/code-implementation-plan.md`

This establishes the package map, phase gates, dependencies, and first milestone definition of done.
