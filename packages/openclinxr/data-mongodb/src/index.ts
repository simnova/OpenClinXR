/** Re-export for tools composition roots (pnpm: bare `mongodb` is not resolvable from tools/). */
export { MongoClient } from "mongodb";
export { createMongoApiPersistenceSink } from "./persistence-sink.js";
