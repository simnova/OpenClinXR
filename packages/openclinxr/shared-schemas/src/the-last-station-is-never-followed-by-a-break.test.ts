import { describe, expect, it } from "vitest";
import * as entrypoint from "./index.js";

// C56 RED: one rule for "no break after the last station", exported from the package entrypoint.
const effectiveBreakAfterStationOrders = (entrypoint as unknown as {
  effectiveBreakAfterStationOrders: (stationOrders: readonly number[], breakAfterStationOrders: readonly number[]) => number[];
}).effectiveBreakAfterStationOrders;

describe("the last station is never followed by a break", () => {
  it("([1,2],[2]) -> []", () => {
    expect(effectiveBreakAfterStationOrders([1, 2], [2])).toEqual([]);
  });
  it("([1,2,3],[1,3]) -> [1]", () => {
    expect(effectiveBreakAfterStationOrders([1, 2, 3], [1, 3])).toEqual([1]);
  });
  it("([1,2,3],[3,1,1]) -> [1] (sorted, unique)", () => {
    expect(effectiveBreakAfterStationOrders([1, 2, 3], [3, 1, 1])).toEqual([1]);
  });
  it("([1,2],[]) -> []", () => {
    expect(effectiveBreakAfterStationOrders([1, 2], [])).toEqual([]);
  });
  it("CW5: non-contiguous orders ([1,3,5],[3,5]) -> [3]", () => {
    expect(effectiveBreakAfterStationOrders([1, 3, 5], [3, 5])).toEqual([3]);
  });
  it("CW5: unsorted station orders ([2,1],[1,2]) -> [1]; last is the max order, never index length-1", () => {
    expect(effectiveBreakAfterStationOrders([2, 1], [1, 2])).toEqual([1]);
  });
  it("is exported as a function from the entrypoint", () => {
    expect(typeof effectiveBreakAfterStationOrders).toBe("function");
  });
  it("drops a break order that is not a station order", () => {
    expect(effectiveBreakAfterStationOrders([1, 2, 3], [1, 7])).toEqual([1]);
  });
});
