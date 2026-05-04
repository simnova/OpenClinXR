import { describe, expect, it } from "vitest";
import { mongoMemoryServerTestOptions } from "./mongoose-memory-context.js";

describe("Mongoose memory test context", () => {
  it("keeps MongoDB startup tolerant under parallel package test load", () => {
    expect(mongoMemoryServerTestOptions.binary?.version).toBe("7.0.24");
    expect(mongoMemoryServerTestOptions.instance?.launchTimeout).toBeGreaterThanOrEqual(60_000);
  });
});
