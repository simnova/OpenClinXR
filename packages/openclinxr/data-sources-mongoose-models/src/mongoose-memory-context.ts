import { MongoMemoryServer } from "mongodb-memory-server";
import { Mongoose } from "mongoose";

export const mongoMemoryServerTestOptions = {
  binary: {
    version: "7.0.24",
  },
  instance: {
    launchTimeout: 60_000,
  },
};

export type MongooseMemoryTestContext = {
  server: MongoMemoryServer;
  mongoose: Mongoose;
  close: () => Promise<void>;
};

export async function createMongooseMemoryTestContext(): Promise<MongooseMemoryTestContext> {
  const server = await MongoMemoryServer.create(mongoMemoryServerTestOptions);
  const mongoose = new Mongoose();
  await mongoose.connect(server.getUri());

  return {
    server,
    mongoose,
    close: async () => {
      await mongoose.disconnect();
      await server.stop();
    },
  };
}
