import { describe, expect, it } from "vitest";
import * as index from "./index.js";
import * as types from "./types.js";

describe("xr-station-room package", () => {
  it("exports buildStationRoomShell", () => {
    expect(typeof index.buildStationRoomShell).toBe("function");
  });

  it("exports types", () => {
    // Types are type-only exports, so they don't exist at runtime
    // Just verify the module loads
    expect(types).toBeDefined();
  });
});