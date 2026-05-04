import { describe, expect, it } from "vitest";
import { mongoMemoryServerTestOptions } from "./mongo-memory-context.js";

describe("MongoDB memory test context", () => {
  it("keeps MongoDB startup tolerant under parallel package test load", () => {
    expect(mongoMemoryServerTestOptions.binary?.version).toBe("7.0.24");
    expect(mongoMemoryServerTestOptions.instance?.launchTimeout).toBeGreaterThanOrEqual(60_000);
  });
});
