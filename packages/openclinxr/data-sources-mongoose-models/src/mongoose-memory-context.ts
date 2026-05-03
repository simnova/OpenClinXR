import { Mongoose } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

export type MongooseMemoryTestContext = {
  server: MongoMemoryServer;
  mongoose: Mongoose;
  close: () => Promise<void>;
};

export async function createMongooseMemoryTestContext(): Promise<MongooseMemoryTestContext> {
  const server = await MongoMemoryServer.create({
    binary: {
      version: "7.0.24",
    },
  });
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
