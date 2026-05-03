# MongoDB Memory Server Test Strategy

Date: 2026-05-03
Status: accepted local implementation guidance

## Decision

Use `mongodb-memory-server` as the default local MongoDB integration-test path for OpenClinXR repository contract tests.

The first implementation should still start with pure domain tests and in-memory repositories. `mongodb-memory-server` becomes the local database test layer after repository interfaces exist.

## Why This Fits

- It keeps local MongoDB testing inside the TypeScript/npm workflow.
- It avoids requiring Docker or a manually installed MongoDB for normal contributor tests.
- It supports realistic driver-level repository tests for indexes, queries, and persistence behavior.
- It can use replica-set mode when repository behavior needs transactions or change-stream-like semantics.

## Package Guidance

Recommended default:

```text
mongodb-memory-server
```

Recommended usage:

- Use `MongoMemoryServer` for simple repository CRUD and index tests.
- Use `MongoMemoryReplSet` for transaction-sensitive tests and anything meant to behave like production replica-set MongoDB.
- Keep package versions pinned.
- Pin the MongoDB binary version used by tests.
- Prefer a deterministic cache path in local docs or package config.
- Do not require this package for unit tests that can run against pure in-memory repositories.

## Important Caveat

The default npm package downloads a `mongod` binary into a cache directory during install/postinstall. That is acceptable for local developer integration tests, but it means the test layer is not fully offline until the binary has been cached.

Therefore:

- Baseline `pnpm test` may include Mongo memory tests only after the binary is available or the tests can skip clearly.
- CI/local verification should print whether Mongo memory tests ran or skipped.
- Air-gapped or classroom setups need a preseeded MongoDB binary cache or `MONGOMS_SYSTEM_BINARY`.

## Repository Contract Pattern

Each repository should have the same contract tests across implementations:

- In-memory implementation.
- `mongodb-memory-server` implementation.
- Future production MongoDB implementation.

Contract coverage:

- Scenario version lookup.
- Review status filtering.
- Station run trace append and ordered replay.
- Event sequence uniqueness.
- Review packet source references.
- Source and claim ledger lookups.
- Index declaration checks.

## First Implementation Tasks

1. Add `packages/data-mongodb`.
2. Define repository interfaces that match the in-memory API repositories.
3. Add `createMongoMemoryTestContext`.
4. Add `MongoMemoryServer` CRUD/index tests.
5. Add `MongoMemoryReplSet` tests only where transactions or replica-set behavior matter.
6. Add skip output when the binary is unavailable.
7. Document cache and binary version in the package README.

## Acceptance Criteria

- Repository contract tests pass against the in-memory implementation.
- Repository contract tests pass against `mongodb-memory-server` after the binary is available.
- Tests fail if trace sequence order is broken.
- Tests fail if required indexes are missing.
- Tests do not require a cloud database or production connection string.

## Implementation Status

Implemented on 2026-05-03:

- `packages/data-mongodb` added.
- `mongodb-memory-server@11.1.0` added.
- `mongodb@7.2.0` added.
- MongoDB binary version pinned to `7.0.24`.
- Local tests passed using cached binary `mongod-arm64-darwin-7.0.24`.

Current repositories:

- `MongoScenarioRepository`
- `MongoTraceRepository`

Current tests:

- Versioned scenario save/read.
- Approved scenario query.
- Trace append and ordered replay.
- Duplicate trace sequence rejection through unique index.

## Sources

- `src-mongodb-memory-server-2026`
- `src-mongodb-memory-server-config-2026`
