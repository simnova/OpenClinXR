import { describe, expect, it } from "vitest";
import { connect } from "./index.js";

// Host-only: connecting where nothing listens must reject instead of hanging.
describe("xr-sync-client connection failure", () => {
  it("rejects when no server listens", async () => {
    await expect(connect("ws://127.0.0.1:1")).rejects.toThrow();
  }, 15000);
});
