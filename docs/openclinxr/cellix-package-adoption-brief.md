# Cellix Package Adoption Brief

Date: 2026-05-03
Status: Guidance for development team

## Current Decision

Keep `packages/cellix/*` empty except for the governance README until a specific package is needed by implementation. The CellixJS shared package set is MIT licensed and directionally aligned with this repo, but copying packages now would create extra compatibility obligations before OpenClinXR has a proven need.

Use `packages/cellix/*` for shared packages copied or derived from `CellixJs/cellixjs/packages/cellix`. Dependency upgrades such as Mongoose, MongoDB, Rolldown, Vitest, and TypeScript are allowed inside `packages/cellix/*` when they preserve the package's core functionality, including the code changes needed to make those upgraded dependencies work. Bug fixes are also allowed when they stay within the package's original intent. If a package needs OpenClinXR-specific behavior, product semantics, or API changes, copy it into `packages/openclinxr/*`, change that local copy, and remove the copied external version from `packages/cellix/*`.

OpenClinXR should prefer latest compatible packages. This means keeping Mongoose 9, targeting current Rolldown releases rather than older beta pins, and treating Cellix config packages as patterns until their version assumptions are deliberately reconciled.

## Packages Reviewed

| Cellix package | Fit for OpenClinXR | Recommendation |
| --- | --- | --- |
| `@cellix/api-services-spec` | Aligns with API service metadata and fluent startup thinking. | Revisit when Azure Functions handler metadata becomes executable deployment config. |
| `@cellix/archunit-tests` | Aligns with architecture fitness tests. | Do not copy; OpenClinXR already has a native `packages/openclinxr/architecture-rules` package using ArchUnitTS directly. |
| `@cellix/config-rolldown` | Relevant to Azure Functions deployment bundling. It peers Rolldown beta.55, while latest npm Rolldown metadata now reports `1.0.0-rc.18`. | Mirror the pattern locally first in `packages/openclinxr/config-rolldown`; do not vendor until the Rolldown version decision is verified. |
| `@cellix/config-typescript` | Shared TS config package. | Copied as `packages/cellix/config-typescript`, upgraded for the local TypeScript 6 posture, and wired into the root `tsconfig.base.json`. |
| `@cellix/config-vitest` | Shared Vitest config including browser-oriented setup. | Revisit when Storybook or browser component testing becomes blocking. |
| `@cellix/domain-seedwork` | DDD primitives, aggregate roots, repositories, unit of work, value objects. | Strong later candidate for richer domain model maturity, but avoid now to keep current pure functions simple. |
| `@cellix/event-bus-seedwork-node` | Node event bus with OpenTelemetry dependency. | Revisit when trace/event workflow needs a real async domain-event bus. |
| `@cellix/graphql-core` and `@cellix/graphql-codegen` | GraphQL schema/codegen utilities. | Revisit when generated resolver manifests replace the current static GraphQL contract package. |
| `@cellix/mongoose-seedwork` | Mongoose repository seedwork. | Do not copy now; package peers `mongoose` `^8.0.0` and `mongodb` `^6.0.0`, while OpenClinXR is intentionally staying on `mongoose` `9.6.1` or newer compatible latest releases. |
| `@cellix/server-mongodb-memory-mock-seedwork` | Local MongoDB memory server seedwork. | Possible later candidate, but current `packages/openclinxr/data-mongodb` already verifies with `mongodb-memory-server`. |
| `@cellix/server-oauth2-mock-seedwork` | OAuth/OIDC mock server. | Later candidate when auth flows become in scope. |
| `@cellix/ui-core` | Ant Design 6, React, React Router UI core. | Later candidate for admin portal maturity; do not copy until auth and component inventory are better understood. |

## Adoption Rules

- Keep edits under `packages/cellix/*` limited to dependency/version upgrades, the code changes required by those upgrades, bug fixes, build-system compatibility, and narrow portability fixes that preserve the package's core Cellix purpose.
- Every copied `packages/cellix/<package>` workspace must include a root `CHANGELOG.md` describing local dependency upgrades, bug fixes, compatibility changes, and the reason they remain within the package's original intent.
- Do not copy a Cellix package unless it directly advances a verified implementation slice.
- Before copying, record source URL, commit/date accessed, license posture, package peer dependencies, planned dependency upgrades, and why a normal npm dependency or OpenClinXR-local package is insufficient.
- After copying, add ArchUnitTS rules that describe the dependency direction between `packages/openclinxr/*` and the copied `packages/cellix/*` package.
- If product-specific behavior changes are needed, move the modified package under `packages/openclinxr/*` and treat it as OpenClinXR-owned code.

## Near-Term Candidate

The first active Cellix-derived package is `packages/cellix/config-typescript`, because it is data-only configuration and can be safely upgraded while preserving original intent. The first project-owned compatibility spike is the `@cellix/config-rolldown` pattern, because the API is intended to remain Azure Functions-compatible and the Cellix package includes deployment preparation tooling. OpenClinXR now starts that path with `packages/openclinxr/config-rolldown`, a local compatibility spike that keeps package ownership project-specific while the team validates latest Rolldown behavior. The next likely candidates are `@cellix/domain-seedwork` and `@cellix/graphql-codegen`, but both should wait until current simple packages become limiting.
