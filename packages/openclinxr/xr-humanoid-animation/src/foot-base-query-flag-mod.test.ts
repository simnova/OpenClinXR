import { describe, expect, it } from "vitest";
import { parseFootBaseEnabled } from "./foot-base-query-flag-mod.js";

describe("foot-base query flag", () => {
  it("opts in only on exactly footBase=1", () => {
    expect(parseFootBaseEnabled("?footBase=1")).toBe(true);
    expect(parseFootBaseEnabled("")).toBe(false);
    expect(parseFootBaseEnabled("?footBase=0")).toBe(false);
    expect(parseFootBaseEnabled("?footBase=1&footstepPlan=1")).toBe(true);
    expect(parseFootBaseEnabled("?footBase=yes")).toBe(false);
    expect(parseFootBaseEnabled("?footBase=11")).toBe(false);
  });
});
