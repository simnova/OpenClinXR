import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

export const mongoMemoryServerTestOptions = {
  binary: {
    version: "7.0.24",
  },
  instance: {
    launchTimeout: 60_000,
  },
};

export type MongoMemoryTestContext = {
  server: MongoMemoryServer;
  client: MongoClient;
  db: Db;
  close(): Promise<void>;
};

export async function createMongoMemoryTestContext(): Promise<MongoMemoryTestContext> {
  const server = await MongoMemoryServer.create(mongoMemoryServerTestOptions);
  const client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db("openclinxr_test");

  return {
    server,
    client,
    db,
    async close() {
      await client.close();
      await server.stop();
    },
  };
}
