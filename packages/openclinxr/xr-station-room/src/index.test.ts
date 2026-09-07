import { describe, expect, it } from "vitest";

describe("xr-station-room package", () => {
  it("exports buildStationRoomShell", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.buildStationRoomShell).toBe("function");
  });

  it("exports types", async () => {
    const mod = await import("./types.js");
    // Types are type-only exports, so they don't exist at runtime
    // Just verify the module loads
    expect(mod).toBeDefined();
  });
});