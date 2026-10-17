import { describe, expect, it } from "vitest";
import { parseFootBaseEnabled } from "./foot-base.js";

describe("foot-base query flag", () => {
  it("opts out only on exactly footBase=0", () => {
    expect(parseFootBaseEnabled("?footBase=1")).toBe(true);
    expect(parseFootBaseEnabled("")).toBe(true);
    expect(parseFootBaseEnabled("?footBase=0")).toBe(false);
    expect(parseFootBaseEnabled("?footBase=1&footstepPlan=1")).toBe(true);
    expect(parseFootBaseEnabled("?footBase=0&footstepPlan=1")).toBe(false);
  });
});
