# MADR 0026: Use mongodb-memory-server For Local MongoDB Tests

Date: 2026-05-03
Status: Accepted

## Context

The first OpenClinXR implementation needs MongoDB-shaped repository tests without requiring Docker, Atlas, Cosmos DB, or a manually installed MongoDB server. The user suggested `mongodb-memory-server` for local MongoDB.

## Decision

Use `mongodb-memory-server` for local repository contract and integration tests.

Use in-memory repositories for baseline unit and API tests. Use `MongoMemoryServer` for CRUD/index behavior and `MongoMemoryReplSet` when testing transaction-sensitive behavior.

## Consequences

Positive:

- Local Mongo tests remain in the npm/TypeScript workflow.
- Developers can run repository tests without cloud database setup.
- Contract tests can exercise the real MongoDB driver and indexes.

Negative:

- The default package downloads a `mongod` binary during install/postinstall or first setup.
- Tests are not fully offline until the binary is cached.
- It is still not a substitute for production MongoDB performance and operational testing.

## Implementation Notes

- Pin `mongodb-memory-server` and the MongoDB binary version.
- Document cache path and skip behavior.
- Keep repository contract tests shared between in-memory, Mongo memory, and future production Mongo implementations.

## Sources

- `src-mongodb-memory-server-2026`
- `src-mongodb-memory-server-config-2026`

