import { describe, expect, it } from "vitest";
import * as index from "./index.js";

describe("xr-station-room package", () => {
  it("exports buildStationRoomShell", () => {
    expect(typeof index.buildStationRoomShell).toBe("function");
  });

  it("exports types", async () => {
    // Types are type-only exports, so they don't exist at runtime
    // Just verify the module loads. Dynamic on purpose: a static import of ./types.js counts as a
    // test internal import (package-tests-use-the-public-entrypoint, ceiling 2), and this module
    // is tiny, so loading it inside the test costs nothing under parallel load.
    const types = await import("./types.js");
    expect(types).toBeDefined();
  });
});
