# Cellix Package Adoption Brief

Date: 2026-05-03
Status: Guidance for development team

## Current Decision

Keep `packages/cellix/*` empty except for the governance README until a specific package is needed by implementation. The CellixJS shared package set is MIT licensed and directionally aligned with this repo, but copying packages now would create extra compatibility obligations before OpenClinXR has a proven need.

Use `packages/cellix/*` only for unmodified shared packages copied from `CellixJs/cellixjs/packages/cellix`. If any package needs OpenClinXR-specific changes, copy it into `packages/openclinxr/*`, change that local copy, and remove the copied external version from `packages/cellix/*`.

## Packages Reviewed

| Cellix package | Fit for OpenClinXR | Recommendation |
| --- | --- | --- |
| `@cellix/api-services-spec` | Aligns with API service metadata and fluent startup thinking. | Revisit when Azure Functions handler metadata becomes executable deployment config. |
| `@cellix/archunit-tests` | Aligns with architecture fitness tests. | Do not copy; OpenClinXR already has a native `packages/openclinxr/architecture-rules` package using ArchUnitTS directly. |
| `@cellix/config-rolldown` | Relevant to Azure Functions deployment bundling. | Strong later candidate after API deployment target is locked. |
| `@cellix/config-typescript` | Shared TS config package. | Do not copy yet; current root configs are small and verified. |
| `@cellix/config-vitest` | Shared Vitest config including browser-oriented setup. | Revisit when Storybook or browser component testing becomes blocking. |
| `@cellix/domain-seedwork` | DDD primitives, aggregate roots, repositories, unit of work, value objects. | Strong later candidate for richer domain model maturity, but avoid now to keep current pure functions simple. |
| `@cellix/event-bus-seedwork-node` | Node event bus with OpenTelemetry dependency. | Revisit when trace/event workflow needs a real async domain-event bus. |
| `@cellix/graphql-core` and `@cellix/graphql-codegen` | GraphQL schema/codegen utilities. | Revisit when generated resolver manifests replace the current static GraphQL contract package. |
| `@cellix/mongoose-seedwork` | Mongoose repository seedwork. | Do not copy now; package peers `mongoose` `^8.0.0` and `mongodb` `^6.0.0`, while OpenClinXR currently verifies against `mongoose` `9.6.1`. |
| `@cellix/server-mongodb-memory-mock-seedwork` | Local MongoDB memory server seedwork. | Possible later candidate, but current `packages/openclinxr/data-mongodb` already verifies with `mongodb-memory-server`. |
| `@cellix/server-oauth2-mock-seedwork` | OAuth/OIDC mock server. | Later candidate when auth flows become in scope. |
| `@cellix/ui-core` | Ant Design 6, React, React Router UI core. | Later candidate for admin portal maturity; do not copy until auth and component inventory are better understood. |

## Adoption Rules

- Do not edit files under `packages/cellix/*` after copying from CellixJS.
- Do not copy a Cellix package unless it directly advances a verified implementation slice.
- Before copying, record source URL, commit/date accessed, license posture, package peer dependencies, and why a normal npm dependency or OpenClinXR-local package is insufficient.
- After copying, add ArchUnitTS rules that describe the dependency direction between `packages/openclinxr/*` and the copied `packages/cellix/*` package.
- If compatibility changes are needed, move the modified package under `packages/openclinxr/*` and treat it as OpenClinXR-owned code.

## Near-Term Candidate

The first likely candidate is `@cellix/config-rolldown`, because the API is intended to remain Azure Functions-compatible and the Cellix package includes deployment preparation tooling. The next likely candidates are `@cellix/domain-seedwork` and `@cellix/graphql-codegen`, but both should wait until current simple packages become limiting.
