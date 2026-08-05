# @cellix/server-mongodb-memory-mock

## 1.0.0-openclinxr.0

### Added

- `mongoMemoryServerTestOptions` — shared MongoDB 7.0.24 memory-server configuration with tolerant launch timeout for parallel test loads.
- `MongoMemoryTestContext` type — groups a `MongoMemoryServer`, `MongoClient`, and `Db` instance with a `close()` teardown method.
- `createMongoMemoryTestContext(databaseName?)` — factory that boots an in-memory MongoDB server, connects a client, and returns a ready-to-use test context. The default database name is `"test_db"`.
